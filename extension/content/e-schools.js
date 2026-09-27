(function connectESchoolsPage() {
  const api = globalThis.browser || globalThis.chrome;
  const parser = globalThis.SchoolppEschoolParser;
  const syncEngine = globalThis.SchoolppSyncEngine;
  const weekNavigation = globalThis.SchoolppWeekNavigation;
  const pageRequests = new Map();
  let activeSync = null;
  let activeSyncController = null;
  let automaticSyncTimer = 0;
  let lessonCaptureVersion = 0;
  let networkSaveQueue = Promise.resolve();

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.source !== "schoolpp-e-schools-hook"
    )
      return;
    if (event.data.type === "SCHOOLPP_NETWORK_RECORD") {
      const record = event.data.record;
      if (/\/students\/[^/]+\/lessons(?:\?|$)/.test(record?.url || ""))
        lessonCaptureVersion += 1;
      networkSaveQueue = networkSaveQueue
        .then(() =>
          api.runtime.sendMessage({
            type: "SCHOOLPP_SAVE_NETWORK",
            record,
          }),
        )
        .catch(() => {});
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
    await loadEndpoint("/api/v1/education/diary/school_year", signal).catch(
      (error) => {
        if (signal.aborted) throw error;
      },
    );
    await loadEndpoint("/api/v1/education/diary/time_activities", signal).catch(
      (error) => {
        if (signal.aborted) throw error;
      },
    );
    let weekCoverage = await warmDiaryWeeks(signal);
    if (!weekCoverage.complete) {
      await reportProgress("Повторно проверяем недели дневника", "running");
      weekCoverage = await warmDiaryWeeks(signal);
    }
    await collectCurrentPage();
    const discovered = new Set();
    const completedUrls = new Set();
    const attempts = new Map();
    const outcomes = new Map();
    const items = [];
    const itemCounts = new Map();
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
          const label = syncEngine.getSyncLabel(url);
          itemCounts.set(label, (itemCounts.get(label) || 0) + 1);
          items.splice(
            0,
            items.length,
            ...[...itemCounts].map(([itemLabel, count]) =>
              count > 1 ? `${itemLabel} (${count})` : itemLabel,
            ),
          );
        }
      });
      await reportProgress("Составляем список данных", "running", {
        items,
        currentIndex: processed,
      });
      await mapWithConcurrency(urls, 6, async (url) => {
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
      });
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

    const missingWeekCount = weekCoverage.missing?.length || 0;
    const skipped =
      discovered.size - completedUrls.size + (missingWeekCount ? 1 : 0);
    const phase = skipped ? "warning" : "success";
    const label = missingWeekCount
      ? `Не удалось получить ${missingWeekCount} ${getWeekWord(missingWeekCount)}`
      : skipped
        ? `Обновлено ${completedUrls.size} из ${discovered.size} разделов`
        : "Синхронизация завершена";
    await reportProgress(label, phase, {
      items,
      currentIndex: items.length,
      report: [
        ...[...discovered].map((url) => ({
          url,
          outcome: outcomes.get(url) || "unavailable",
          attempts: attempts.get(url) || 0,
        })),
        ...(missingWeekCount
          ? [
              {
                url: "diary-weeks",
                outcome: "unavailable",
                attempts: 2,
              },
            ]
          : []),
      ],
    });
    return { ok: true, warning: skipped ? label : "" };
  }

  function getWeekWord(value) {
    const tens = value % 100;
    const ones = value % 10;
    if (tens >= 11 && tens <= 14) return "учебных недель";
    if (ones === 1) return "учебную неделю";
    if (ones >= 2 && ones <= 4) return "учебные недели";
    return "учебных недель";
  }

  async function warmDiaryWeeks(signal) {
    const originalHash = location.hash;
    const stored = await api.runtime.sendMessage({
      type: "SCHOOLPP_GET_SNAPSHOT",
    });
    const bounds = getAcademicBounds(stored?.snapshot);
    if (!getVisibleWeek()) {
      const classId = getClassId(stored?.snapshot, stored?.syncTargets);
      if (!classId) return { complete: false, missing: [] };
      const diaryHash = `#/diary?activeClass=${encodeURIComponent(classId)}`;
      if (location.hash !== diaryHash) location.hash = diaryHash;
      await waitForVisibleWeek(signal, 7_000);
    }
    let current = getVisibleWeek();
    if (!current) return { complete: false, missing: [] };

    await reportProgress("Загружаем недели дневника", "running");
    const visited = new Set();
    const captureFailures = new Set();
    for (let step = 0; step < 60; step += 1) {
      if (signal.aborted) throw createAbortError();
      current = getVisibleWeek();
      if (!current) break;
      visited.add(current.key);
      await collectCurrentPage();
      if (bounds.startsOn && current.start <= bounds.startsOn) break;
      const result = await moveWeek("previous", current.key, signal);
      if (!result.changed) break;
      if (!result.captured) {
        const changedWeek = getVisibleWeek();
        if (changedWeek) captureFailures.add(changedWeek.start);
      }
    }

    const today = getMinskDate();
    const traversalEnd = getDiaryTraversalEnd(stored?.snapshot, today, bounds);
    for (let step = 0; step < 60; step += 1) {
      if (signal.aborted) throw createAbortError();
      current = getVisibleWeek();
      if (!current) break;
      visited.add(current.key);
      await collectCurrentPage();
      if (traversalEnd && current.end >= traversalEnd) break;
      if (bounds.endsOn && current.end >= bounds.endsOn) break;
      const result = await moveWeek("next", current.key, signal);
      if (!result.changed) break;
      if (!result.captured) {
        const changedWeek = getVisibleWeek();
        if (changedWeek) captureFailures.add(changedWeek.start);
      }
    }
    if (visited.size > 1) await waitForRetry(350, signal);
    if (originalHash && originalHash !== location.hash) {
      location.hash = originalHash;
      await waitForRetry(250, signal);
    }
    await networkSaveQueue;
    const latest = await api.runtime.sendMessage({
      type: "SCHOOLPP_GET_SNAPSHOT",
    });
    return getLessonWeekCoverage(
      latest?.snapshot,
      traversalEnd,
      visited,
      captureFailures,
    );
  }

  function getDiaryTraversalEnd(snapshot, today, bounds) {
    const terms = getAcademicTerms(snapshot);
    const current = terms.find(
      (term) => term.startsOn <= today && today <= term.endsOn,
    );
    const upcoming = terms.find((term) => today < term.startsOn);
    const target = current?.endsOn || upcoming?.endsOn || today;
    return clampDate(target, bounds.startsOn, bounds.endsOn);
  }

  function getAcademicTerms(snapshot) {
    const activityRecord = Object.values(snapshot?.network || {}).find((item) =>
      /\/diary\/time_activities(?:\?|$)/.test(item?.url || ""),
    );
    return (Array.isArray(activityRecord?.body) ? activityRecord.body : [])
      .filter((activity) => {
        const text = `${activity?.title || ""} ${activity?.description || ""} ${activity?.type || ""}`;
        return /четверт|quarter|term/i.test(text);
      })
      .map((activity) => ({
        startsOn: timestampToIso(activity.start_date),
        endsOn: timestampToIso(activity.end_date),
      }))
      .filter(
        (term) => term.startsOn && term.endsOn && term.startsOn <= term.endsOn,
      )
      .sort((first, second) => first.startsOn.localeCompare(second.startsOn));
  }

  function getLessonWeekCoverage(
    snapshot,
    targetDate,
    visited = new Set(),
    captureFailures = new Set(),
  ) {
    const expected = new Set();
    for (const term of getAcademicTerms(snapshot)) {
      const start = term.startsOn;
      const end = term.endsOn;
      if (!start || !end) continue;
      const cappedEnd = targetDate && targetDate < end ? targetDate : end;
      for (
        let week = mondayForIso(start);
        week && week <= cappedEnd;
        week = addIsoDays(week, 7)
      ) {
        if (!targetDate || week <= targetDate) expected.add(week);
      }
    }

    const captured = new Set();
    Object.values(snapshot?.network || {})
      .filter((record) =>
        /\/students\/[^/]+\/lessons(?:\?|$)/.test(record?.url || ""),
      )
      .forEach((record) => {
        const dates = (Array.isArray(record.body) ? record.body : [])
          .map((day) => timestampToIso(day?.date))
          .filter(Boolean);
        if (dates.length) captured.add(mondayForIso(dates.sort()[0]));
      });
    const networkCaptured = new Set(captured);
    visited.forEach((key) => captured.add(String(key).split(":")[0]));
    const missing = [...expected].filter(
      (week) =>
        !captured.has(week) ||
        (captureFailures.has(week) && !networkCaptured.has(week)),
    );
    return {
      complete: expected.size > 0 && missing.length === 0,
      expected: [...expected],
      captured: [...captured],
      missing,
    };
  }

  function getMinskDate() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Minsk",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
  }

  function getVisibleWeek() {
    const page = parser.collectPage(document, location);
    const dates = (page.tables || [])
      .flatMap((table) => table.headers || [])
      .flatMap((value) => String(value).match(/\b\d{2}\.\d{2}\.\d{4}\b/g) || [])
      .map(ddmmyyyyToIso)
      .filter(Boolean)
      .sort();
    if (!dates.length) return null;
    const start = mondayForIso(dates[0]);
    const end = addIsoDays(start, 6);
    return {
      start,
      end,
      key: `${start}:${end}`,
    };
  }

  function ddmmyyyyToIso(value) {
    const match = String(value).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
  }

  function mondayForIso(value) {
    const [year, month, day] = String(value).split("-").map(Number);
    if (!year || !month || !day) return "";
    const date = new Date(Date.UTC(year, month - 1, day));
    const offset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
  }

  function addIsoDays(value, amount) {
    const [year, month, day] = String(value).split("-").map(Number);
    if (!year || !month || !day) return "";
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }

  function getAcademicBounds(snapshot) {
    const record = Object.values(snapshot?.network || {}).find((item) =>
      /\/diary\/school_year(?:\?|$)/.test(item?.url || ""),
    );
    return {
      startsOn: timestampToIso(record?.body?.start_ts),
      endsOn: timestampToIso(record?.body?.end_ts),
    };
  }

  function timestampToIso(value) {
    if (/^\d{4}-\d{2}-\d{2}/.test(String(value || "")))
      return String(value).slice(0, 10);
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return "";
    const date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }

  function clampDate(value, minimum, maximum) {
    if (minimum && value < minimum) return minimum;
    if (maximum && value > maximum) return maximum;
    return value;
  }

  function getClassId(snapshot, knownUrls = []) {
    const values = [
      ...Object.values(snapshot?.network || {}).map((item) => item?.url || ""),
      ...Object.values(snapshot?.pages || {}).map((item) => item?.route || ""),
      ...(knownUrls || []),
      location.href,
    ];
    for (const value of values) {
      const match = String(value).match(
        /(?:\/classes\/|[?&](?:activeClass|class)=)([^/?&#]+)/,
      );
      if (match) return decodeURIComponent(match[1]);
    }
    return "";
  }

  async function waitForVisibleWeek(signal, timeout) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      if (signal.aborted) throw createAbortError();
      if (getVisibleWeek()) return true;
      await waitForRetry(120, signal);
    }
    return false;
  }

  async function moveWeek(direction, previousKey, signal) {
    const buttons = findWeekButtons(direction);
    for (const button of buttons) {
      const captureVersion = lessonCaptureVersion;
      button.click();
      const startedAt = Date.now();
      while (Date.now() - startedAt < 2_000) {
        if (signal.aborted) throw createAbortError();
        await waitForRetry(120, signal);
        const week = getVisibleWeek();
        if (week && week.key !== previousKey) {
          const captured = await waitForLessonCapture(
            captureVersion,
            3_500,
            signal,
          );
          await networkSaveQueue;
          await waitForRetry(120, signal);
          return { changed: true, captured };
        }
      }
    }
    return { changed: false, captured: false };
  }

  function findWeekButtons(direction) {
    return weekNavigation.findWeekButtons(document, direction);
  }

  async function waitForLessonCapture(version, timeout, signal) {
    const startedAt = Date.now();
    while (
      lessonCaptureVersion === version &&
      Date.now() - startedAt < timeout
    ) {
      if (signal.aborted) throw createAbortError();
      await waitForRetry(100, signal);
    }
    return lessonCaptureVersion !== version;
  }

  async function mapWithConcurrency(values, limit, operation) {
    let index = 0;
    const workers = Array.from(
      { length: Math.min(limit, values.length) },
      async () => {
        while (index < values.length) {
          const current = values[index];
          index += 1;
          await operation(current);
        }
      },
    );
    await Promise.all(workers);
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
    await networkSaveQueue;
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
      return "Сессия e‑schools.by закончилась. Войди в дневник снова.";
    if (error.message === "NO_DATA")
      return "Не удалось определить данные дневника. Обнови страницу.";
    if (error.message === "SOURCE_UNAVAILABLE")
      return "Дневник не ответил. Проверь соединение и попробуй ещё раз.";
    if (error instanceof TypeError)
      return "e‑schools.by недоступен. Проверь интернет или отключи VPN.";
    return "Не удалось синхронизировать данные. Попробуй ещё раз.";
  }
})();
