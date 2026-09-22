(function connectESchoolsPage() {
  const api = globalThis.browser || globalThis.chrome;
  const parser = globalThis.SchoolppEschoolParser;
  const syncEngine = globalThis.SchoolppSyncEngine;
  const pageRequests = new Map();
  let activeSync = null;
  let activeSyncController = null;
  let automaticSyncTimer = 0;

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.source !== "schoolpp-e-schools-hook"
    )
      return;
    if (event.data.type === "SCHOOLPP_NETWORK_RECORD") {
      void api.runtime.sendMessage({
        type: "SCHOOLPP_SAVE_NETWORK",
        record: event.data.record,
      });
      return;
    }
    if (event.data.type === "SCHOOLPP_FETCH_RESPONSE") {
      const pending = pageRequests.get(event.data.requestId);
      if (!pending) return;
      pageRequests.delete(event.data.requestId);
      if (event.data.result?.error)
        pending.reject(new Error(event.data.result.error));
      else pending.resolve(event.data.result);
      return;
    }
    if (event.data.type === "SCHOOLPP_RESOURCE_RESPONSE") {
      const pending = pageRequests.get(event.data.requestId);
      if (!pending) return;
      pageRequests.delete(event.data.requestId);
      pending.resolve(event.data.urls || []);
    }
  });

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SCHOOLPP_COLLECT_PAGE") {
      collectCurrentPage()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === "SCHOOLPP_SYNC") {
      if (!activeSync) {
        activeSyncController = new AbortController();
        activeSync = synchronize(activeSyncController.signal)
          .catch(async (error) => {
            if (error.name === "AbortError")
              return { ok: false, cancelled: true };
            const publicError = getPublicError(error);
            await reportProgress(publicError, "error");
            throw new Error(publicError);
          })
          .finally(() => {
            activeSync = null;
            activeSyncController = null;
          });
      }
      activeSync
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === "SCHOOLPP_CANCEL_SYNC") {
      const pendingSync = activeSync;
      activeSyncController?.abort();
      Promise.race([
        pendingSync || Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]).finally(() => sendResponse({ ok: true }));
      return true;
    }
    return undefined;
  });

  window.addEventListener("load", () => scheduleAutomaticSync(4_000), {
    once: true,
  });
  window.addEventListener("pageshow", () => scheduleAutomaticSync(4_000));
  window.addEventListener("hashchange", () => {
    void collectCurrentPage().catch(() => {});
    scheduleAutomaticSync(2_500);
  });

  function scheduleAutomaticSync(delay) {
    clearTimeout(automaticSyncTimer);
    automaticSyncTimer = window.setTimeout(() => {
      void runAutomaticSyncIfDue();
    }, delay);
  }

  async function runAutomaticSyncIfDue() {
    if (activeSync) return;
    try {
      const status = await api.runtime.sendMessage({
        type: "SCHOOLPP_GET_STATUS",
      });
      if (!status?.settings?.backgroundSync) return;
      if (!status?.syncState?.lastSyncAt && !status.backgroundTab) return;
      const nextSyncAt = Date.parse(status?.syncState?.nextSyncAt || "");
      if (
        !status.backgroundTab &&
        Number.isFinite(nextSyncAt) &&
        nextSyncAt > Date.now()
      )
        return;
      activeSyncController = new AbortController();
      activeSync = synchronize(activeSyncController.signal)
        .catch(async (error) => {
          if (error.name === "AbortError") return;
          await reportProgress(getPublicError(error), "error");
        })
        .finally(() => {
          activeSync = null;
          activeSyncController = null;
        });
      await activeSync;
    } catch {
      /* Opening the diary again will retry without disturbing its interface. */
    }
  }

  async function synchronize(signal) {
    await reportProgress("Подготавливаем синхронизацию", "running");
    await collectCurrentPage();
    const discovered = new Set();
    const completedUrls = new Set();
    const attempts = new Map();
    const outcomes = new Map();
    const items = [];
    let processed = 0;
    let progressQueue = Promise.resolve();
    const pageResourceUrls = new Set();

    for (let wave = 0; wave < 5; wave += 1) {
      const discoveredResources = await runWithTimeout(
        (requestSignal) => discoverPageResources(requestSignal),
        1_500,
        signal,
      ).catch((error) => {
        if (signal.aborted) throw error;
        return [];
      });
      syncEngine
        .selectApiResourceUrls(discoveredResources, location.origin)
        .forEach((url) => pageResourceUrls.add(url));
      const stored = await api.runtime.sendMessage({
        type: "SCHOOLPP_GET_SNAPSHOT",
      });
      const urls = syncEngine
        .selectSyncUrls(
          syncEngine.discoverSyncUrls(stored.snapshot, [
            ...(stored.syncTargets || []),
            ...pageResourceUrls,
          ]),
        )
        .filter(
          (url) => !completedUrls.has(url) && (attempts.get(url) || 0) < 3,
        );
      if (!urls.length) break;
      urls.forEach((url) => {
        attempts.set(url, (attempts.get(url) || 0) + 1);
        if (!discovered.has(url)) {
          discovered.add(url);
          items.push(syncEngine.getSyncLabel(url));
        }
      });
      await reportProgress("Составляем список данных", "running", {
        items,
        currentIndex: processed,
      });
      await Promise.all(
        urls.map(async (url) => {
          try {
            if (signal.aborted) throw createAbortError();
            const outcome = await runWithTimeout(
              (requestSignal) => loadEndpoint(url, requestSignal),
              6_000,
              signal,
            );
            outcomes.set(url, outcome);
            if (outcome === "completed") completedUrls.add(url);
          } catch (error) {
            if (signal.aborted) throw createAbortError();
            outcomes.set(url, "unavailable");
          } finally {
            if (!signal.aborted) {
              processed += 1;
              const currentIndex = processed;
              progressQueue = progressQueue.then(() =>
                reportProgress("Получаем данные", "running", {
                  items,
                  currentIndex,
                }),
              );
            }
          }
        }),
      );
      await progressQueue;
      if (wave < 4 && urls.some((url) => !completedUrls.has(url)))
        await waitForRetry(350, signal);
    }

    if (!discovered.size) throw new Error("NO_DATA");

    if (!completedUrls.size) {
      if ([...outcomes.values()].some((outcome) => outcome === "unauthorized"))
        throw new Error("AUTH_REQUIRED");
      throw new Error("SOURCE_UNAVAILABLE");
    }

    const skipped = discovered.size - completedUrls.size;
    const phase = skipped ? "warning" : "success";
    const label = skipped
      ? `Обновлено ${completedUrls.size} из ${discovered.size} разделов`
      : "Синхронизация завершена";
    await reportProgress(label, phase, {
      items,
      currentIndex: items.length,
      report: [...discovered].map((url) => ({
        url,
        outcome: outcomes.get(url) || "unavailable",
        attempts: attempts.get(url) || 0,
      })),
    });
    return { ok: true, warning: skipped ? label : "" };
  }

  async function loadEndpoint(url, signal) {
    const response = await fetchViaPage(url, signal);
    if (response.status === 401) return "unauthorized";
    if (response.status < 200 || response.status >= 300) return "unavailable";
    const body = response.body;
    await api.runtime.sendMessage({
      type: "SCHOOLPP_SAVE_NETWORK",
      record: {
        key: `GET:${url}`,
        url,
        method: "GET",
        status: response.status,
        capturedAt: new Date().toISOString(),
        body,
      },
    });
    return "completed";
  }

  function fetchViaPage(url, signal) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        pageRequests.delete(requestId);
        reject(createAbortError());
      };
      signal.addEventListener("abort", cancel, { once: true });
      pageRequests.set(requestId, {
        resolve: (value) => {
          signal.removeEventListener("abort", cancel);
          resolve(value);
        },
        reject: (error) => {
          signal.removeEventListener("abort", cancel);
          reject(error);
        },
      });
      window.postMessage(
        {
          source: "schoolpp-e-schools-content",
          type: "SCHOOLPP_FETCH_REQUEST",
          requestId,
          url,
        },
        location.origin,
      );
    });
  }

  function discoverPageResources(signal) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        pageRequests.delete(requestId);
        reject(createAbortError());
      };
      signal.addEventListener("abort", cancel, { once: true });
      pageRequests.set(requestId, {
        resolve: (value) => {
          signal.removeEventListener("abort", cancel);
          resolve(value);
        },
        reject: (error) => {
          signal.removeEventListener("abort", cancel);
          reject(error);
        },
      });
      window.postMessage(
        {
          source: "schoolpp-e-schools-content",
          type: "SCHOOLPP_RESOURCE_REQUEST",
          requestId,
        },
        location.origin,
      );
    });
  }

  async function runWithTimeout(operation, duration, parentSignal) {
    const controller = new AbortController();
    let timer;
    const cancel = () => controller.abort();
    parentSignal?.addEventListener("abort", cancel, { once: true });
    try {
      if (parentSignal?.aborted) throw createAbortError();
      return await Promise.race([
        operation(controller.signal),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            const error = new Error("TIMEOUT");
            error.name = "AbortError";
            reject(error);
          }, duration);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", cancel);
    }
  }

  function createAbortError() {
    const error = new Error("CANCELLED");
    error.name = "AbortError";
    return error;
  }

  function waitForRetry(duration, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(finish, duration);
      function finish() {
        signal.removeEventListener("abort", cancel);
        resolve();
      }
      function cancel() {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        reject(createAbortError());
      }
      signal.addEventListener("abort", cancel, { once: true });
    });
  }

  async function collectCurrentPage() {
    const page = parser.collectPage(document, location);
    return api.runtime.sendMessage({ type: "SCHOOLPP_SAVE_PAGE", page });
  }

  async function reportProgress(label, phase, details = {}) {
    try {
      await Promise.race([
        api.runtime.sendMessage({
          type: "SCHOOLPP_SYNC_PROGRESS",
          progress: { label, phase, ...details },
        }),
        new Promise((resolve) => setTimeout(resolve, 1_500)),
      ]);
    } catch {
      /* Progress reporting must never hold the data sync. */
    }
  }

  function getPublicError(error) {
    if (error.message === "AUTH_REQUIRED")
      return "Сессия e.school.by закончилась. Войди в дневник снова.";
    if (error.message === "NO_DATA")
      return "Не удалось определить данные дневника. Обнови страницу.";
    if (error.message === "SOURCE_UNAVAILABLE")
      return "Дневник не ответил. Проверь соединение и попробуй ещё раз.";
    if (error instanceof TypeError)
      return "e.school.by недоступен. Проверь интернет или отключи VPN.";
    return "Не удалось синхронизировать данные. Попробуй ещё раз.";
  }
})();
