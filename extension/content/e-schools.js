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
  const lessonCaptureByWeek = new Map();
  let latestLessonCapture = null;
  let networkSaveQueue = Promise.resolve();
  let connectionWatchdog = 0;
  let syncDeadlineTimer = 0;
  let syncTimedOut = false;
  let materialCollectionPromise = null;
  const CONNECTION_STALL_MS = 20_000;
  const MAX_SYNC_DURATION_MS = 90_000;

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.source !== "schoolpp-e-schools-hook"
    )
      return;
    if (event.data.type === "SCHOOLPP_NETWORK_RECORD") {
      const record = decorateLessonRecord(event.data.record);
      if (/\/students\/[^/]+\/lessons(?:\?|$)/.test(record?.url || "")) {
        lessonCaptureVersion += 1;
        latestLessonCapture = { version: lessonCaptureVersion, record };
        if (record.weekStart)
          lessonCaptureByWeek.set(record.weekStart, lessonCaptureVersion);
      }
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
    if (message?.type === "SCHOOLPP_PING") {
      sendResponse({ ok: true });
      return true;
    }
    if (message?.type === "SCHOOLPP_COLLECT_PAGE") {
      collectCurrentPage()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === "SCHOOLPP_RESOLVE_MATERIAL") {
      resolveLessonMaterial(message.material)
        .then(sendResponse)
        .catch((error) =>
          sendResponse({ ok: false, error: getPublicError(error) }),
        );
      return true;
    }
    if (message?.type === "SCHOOLPP_SYNC") {
      if (!activeSync) {
        activeSyncController = new AbortController();
        startConnectionWatchdog();
        activeSync = synchronize(activeSyncController.signal)
          .catch(async (error) => {
            if (error.name === "AbortError" && syncTimedOut) {
              const message = getSyncTimeoutMessage();
              await reportProgress(message, "error");
              return { ok: false, error: message };
            }
            if (error.name === "AbortError")
              return { ok: false, cancelled: true };
            const publicError = getPublicError(error);
            await reportProgress(publicError, "error");
            throw new Error(publicError);
          })
          .finally(() => {
            stopConnectionWatchdog();
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
      startConnectionWatchdog();
      activeSync = synchronize(activeSyncController.signal)
        .catch(async (error) => {
          if (error.name === "AbortError" && syncTimedOut) {
            await reportProgress(getSyncTimeoutMessage(), "error");
            return;
          }
          if (error.name === "AbortError") return;
          await reportProgress(getPublicError(error), "error");
        })
        .finally(() => {
          stopConnectionWatchdog();
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
    await Promise.all(
      [
        "/api/v1/education/diary/school_year",
        "/api/v1/education/diary/time_activities",
        "/api/v1/education/diary/time_activities/week_activities",
      ].map((url) =>
        runWithTimeout(
          (requestSignal) => loadEndpoint(url, requestSignal),
          6_000,
          signal,
        ).catch((error) => {
          if (signal.aborted) throw error;
          return "unavailable";
        }),
      ),
    );
    await networkSaveQueue;
    const weekSeed = await api.runtime.sendMessage({
      type: "SCHOOLPP_GET_SNAPSHOT",
    });
    const directWeekRequests = syncEngine.buildDiaryWeekRequests(
      weekSeed?.snapshot,
      weekSeed?.syncTargets,
    );
    let weekCoverage = { complete: false, missing: [] };
    if (!directWeekRequests.length) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt) {
          await reportProgress(
            `Повторно проверяем пропущенные недели · ${attempt + 1}/3`,
            "running",
          );
          await waitForRetry(500, signal);
        }
        weekCoverage = await warmDiaryWeeks(signal);
        if (weekCoverage.complete) break;
      }
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
    const pageResourceUrls = new Set(
      directWeekRequests.map((request) => request.url),
    );
    const directWeekStarts = new Map(
      directWeekRequests.map((request) => [request.url, request.weekStart]),
    );

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
            (requestSignal) =>
              loadEndpoint(url, requestSignal, directWeekStarts.get(url)),
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

    if (directWeekRequests.length) {
      await networkSaveQueue;
      const latest = await api.runtime.sendMessage({
        type: "SCHOOLPP_GET_SNAPSHOT",
      });
      weekCoverage = getLessonWeekCoverage(
        latest?.snapshot,
        "",
        new Set(),
        directWeekRequests.map((request) => request.weekStart),
      );
    }

    let materialProgressQueue = Promise.resolve();
    const materialSync = await syncLessonMaterials(signal, (progress) => {
      materialProgressQueue = materialProgressQueue.then(() =>
        reportProgress("Получаем прикреплённые материалы", "running", {
          items: [...items, "Прикреплённые материалы"],
          currentIndex: processed + progress,
        }),
      );
    });
    await materialProgressQueue;
    if (signal.aborted) throw createAbortError();

    if (!discovered.size) throw new Error("NO_DATA");

    if (!completedUrls.size) {
      if ([...outcomes.values()].some((outcome) => outcome === "unauthorized"))
        throw new Error("AUTH_REQUIRED");
      throw new Error("SOURCE_UNAVAILABLE");
    }

    const missingWeekCount = weekCoverage.missing?.length || 0;
    const skipped =
      discovered.size -
      completedUrls.size +
      (missingWeekCount ? 1 : 0) +
      (materialSync.failed ? 1 : 0);
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
        ...(materialSync.failed
          ? [{ url: "lesson-materials", outcome: "unavailable", attempts: 2 }]
          : []),
      ],
    });
    return { ok: true, warning: skipped ? label : "" };
  }

  async function syncLessonMaterials(signal, onProgress = () => {}) {
    await networkSaveQueue;
    const stored = await api.runtime.sendMessage({
      type: "SCHOOLPP_GET_SNAPSHOT",
    });
    const requests = syncEngine.buildLessonAttachmentRequests(stored?.snapshot);
    if (!requests.length) return { completed: 0, failed: 0 };

    let completed = 0;
    let failed = 0;
    let progress = 0;
    await mapWithConcurrency(requests, 6, async (request) => {
      let response = null;
      for (let attempt = 0; attempt < 2 && !response; attempt += 1) {
        try {
          response = await runWithTimeout(
            (requestSignal) => fetchViaPage(request.url, requestSignal),
            6_000,
            signal,
          );
          if (response.status < 200 || response.status >= 300) response = null;
        } catch (error) {
          if (signal.aborted) throw error;
          if (attempt === 0) await waitForRetry(180, signal);
        }
      }
      if (!response) {
        failed += 1;
      } else {
        const discoveredMaterials = parser.collectApiMaterials(response.body);
        const materials = discoveredMaterials.map((material, index) => ({
          url: createMaterialPlaceholder(request, material, index),
          title: material.title || `Материал ${index + 1}`,
          id: material.id || "",
          source: "e-schools",
          sourceLessonId: request.sourceLessonId,
          sourceEndpoint: request.url,
          sourceDate: request.date,
          sourceLessonNumber: request.number,
          sourceStartTime: String(request.startTime || "").slice(0, 5),
          sourceSubject: request.subject,
        }));
        if (materials.length) {
          await api.runtime.sendMessage({
            type: "SCHOOLPP_MERGE_LESSON_MATERIALS",
            lessonId: request.lessonId,
            materials,
          });
        }
        completed += 1;
      }
      progress += 1;
      onProgress(progress);
    });
    return { completed, failed };
  }

  function createMaterialPlaceholder(request, material, index) {
    const identity = material.id || material.title || index + 1;
    return `https://diary.e-schools.by/#/diary?schoolpp-material=${encodeURIComponent(`${request.lessonId}:${identity}`)}`;
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
    let captureFailures = 0;
    for (let step = 0; step < 60; step += 1) {
      if (signal.aborted) throw createAbortError();
      current = getVisibleWeek();
      if (!current) break;
      visited.add(current.key);
      await collectCurrentPage();
      if (bounds.startsOn && current.start <= bounds.startsOn) break;
      const result = await moveWeek("previous", current.key, signal);
      captureFailures = result.captured ? 0 : captureFailures + 1;
      if (captureFailures >= 3) {
        throw new Error("SOURCE_UNAVAILABLE");
      }
      if (!result.changed) break;
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
      captureFailures = result.captured ? 0 : captureFailures + 1;
      if (captureFailures >= 3) {
        throw new Error("SOURCE_UNAVAILABLE");
      }
      if (!result.changed) break;
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
    return getLessonWeekCoverage(latest?.snapshot, traversalEnd, visited);
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
    expectedWeeks = [],
  ) {
    const expected = new Set(expectedWeeks.filter(Boolean));
    if (!expected.size) {
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
    }

    const captured = new Set();
    Object.values(snapshot?.network || {})
      .filter((record) =>
        /\/students\/[^/]+\/lessons(?:\?|$)/.test(record?.url || ""),
      )
      .forEach((record) => {
        if (record.weekStart) captured.add(record.weekStart);
        const dates = (Array.isArray(record.body) ? record.body : [])
          .map((day) => timestampToIso(day?.date))
          .filter(Boolean);
        if (dates.length) captured.add(mondayForIso(dates.sort()[0]));
      });
    const missing = [...expected].filter((week) => !captured.has(week));
    return {
      complete: expected.size > 0 && missing.length === 0,
      expected: [...expected],
      captured: [...captured],
      visited: [...visited].map((key) => String(key).split(":")[0]),
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

  function decorateLessonRecord(record = {}, useVisibleWeek = true) {
    if (!/\/students\/[^/]+\/lessons(?:\?|$)/.test(record?.url || ""))
      return record;
    const dates = (Array.isArray(record.body) ? record.body : [])
      .map((day) => timestampToIso(day?.date))
      .filter(Boolean)
      .sort();
    const weekStart =
      (dates.length ? mondayForIso(dates[0]) : "") ||
      (useVisibleWeek ? getVisibleWeek()?.start : "") ||
      "";
    return weekStart ? { ...record, weekStart } : record;
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
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Minsk",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
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
    for (let round = 0; round < 2; round += 1) {
      const buttons = findWeekButtons(direction);
      for (const button of buttons) {
        const captureVersion = lessonCaptureVersion;
        button.click();
        const startedAt = Date.now();
        while (Date.now() - startedAt < 2_500) {
          if (signal.aborted) throw createAbortError();
          await waitForRetry(120, signal);
          const week = getVisibleWeek();
          if (week && week.key !== previousKey) {
            await collectCurrentPage();
            const captured = await waitForLessonCapture(
              captureVersion,
              week.start,
              4_000,
              signal,
            );
            await networkSaveQueue;
            await waitForRetry(180, signal);
            return { changed: true, captured, week };
          }
        }
      }
      await waitForRetry(350, signal);
    }
    return { changed: false, captured: false };
  }

  function findWeekButtons(direction) {
    return weekNavigation.findWeekButtons(document, direction);
  }

  async function waitForLessonCapture(version, weekStart, timeout, signal) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      if (signal.aborted) throw createAbortError();
      if ((lessonCaptureByWeek.get(weekStart) || 0) > version) return true;
      if (latestLessonCapture?.version > version) {
        const corrected = {
          ...latestLessonCapture.record,
          weekStart,
        };
        lessonCaptureByWeek.set(weekStart, latestLessonCapture.version);
        latestLessonCapture = {
          ...latestLessonCapture,
          record: corrected,
        };
        networkSaveQueue = networkSaveQueue.then(() =>
          api.runtime.sendMessage({
            type: "SCHOOLPP_SAVE_NETWORK",
            record: corrected,
          }),
        );
        await networkSaveQueue;
        return true;
      }
      await waitForRetry(100, signal);
    }
    return (lessonCaptureByWeek.get(weekStart) || 0) > version;
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

  async function loadEndpoint(url, signal, weekStart = "") {
    const response = await fetchViaPage(url, signal);
    if (response.status === 401) return "unauthorized";
    if (response.status < 200 || response.status >= 300) return "unavailable";
    const body = response.body;
    let record = decorateLessonRecord(
      {
        key: `GET:${url}`,
        url,
        method: "GET",
        status: response.status,
        capturedAt: new Date().toISOString(),
        body,
      },
      false,
    );
    if (
      weekStart &&
      /\/students\/[^/]+\/lessons(?:\?|$)/.test(record?.url || "")
    )
      record = { ...record, weekStart };
    await api.runtime.sendMessage({
      type: "SCHOOLPP_SAVE_NETWORK",
      record,
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
    if (page.kind === "diary" && activeSyncController) {
      const discovered = await collectVisibleLessonMaterials();
      page.lessonMaterials = mergeLessonMaterialRows(
        page.lessonMaterials || [],
        discovered,
      );
    }
    return api.runtime.sendMessage({ type: "SCHOOLPP_SAVE_PAGE", page });
  }

  function collectVisibleLessonMaterials() {
    if (materialCollectionPromise) return materialCollectionPromise;
    materialCollectionPromise = discoverVisibleLessonMaterials().finally(() => {
      materialCollectionPromise = null;
    });
    return materialCollectionPromise;
  }

  async function discoverVisibleLessonMaterials() {
    const descriptors = parser.collectLessonMaterialRows(document);
    const lessonRows = [...document.querySelectorAll("table tr")].filter(
      (row) => {
        const text = parser.cleanText(row.textContent);
        return (
          /^\d{1,2}:\d{2}/u.test(text) ||
          /(?:^|\s)(?:0|\d+)\.\s*\S+/u.test(text)
        );
      },
    );
    const result = descriptors
      .filter((row) => row.attachments.length)
      .map((row) => ({ ...row, candidates: undefined }));
    for (let index = 0; index < descriptors.length; index += 1) {
      const descriptor = descriptors[index];
      const row = lessonRows[index];
      if (!row || !descriptor.candidates.length) continue;
      const candidates = [
        ...row.querySelectorAll("button, [role='button'], a"),
      ].filter(isMaterialTrigger);
      for (const candidate of candidates) {
        if (candidate.tagName === "A" && candidate.href) continue;
        const before = new Set(
          parser.collectVisibleMaterials(document).map((item) => item.url),
        );
        candidate.click();
        await waitForRetry(180, activeSyncController.signal);
        const attachments = parser
          .collectVisibleMaterials(document)
          .filter((item) => !before.has(item.url))
          .map((item) => ({
            ...item,
            source: "e-schools",
            sourceDate: descriptor.date,
            sourceLessonNumber: descriptor.number,
            sourceStartTime: descriptor.startTime,
            sourceSubject: descriptor.subject,
          }));
        if (attachments.length) {
          result.push({
            date: descriptor.date,
            number: descriptor.number,
            startTime: descriptor.startTime,
            subject: descriptor.subject,
            homework: descriptor.homework,
            attachments,
          });
        }
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        await waitForRetry(40, activeSyncController.signal);
      }
    }
    return mergeLessonMaterialRows([], result);
  }

  function isMaterialTrigger(element) {
    const signature = [
      element.className,
      element.getAttribute?.("title"),
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("data-testid"),
      element.getAttribute?.("data-tooltip"),
      element.innerHTML?.slice(0, 800),
    ]
      .filter(Boolean)
      .join(" ");
    return /(?:paperclip|attach|attachment|material|document|download|file|скреп|влож|файл)/iu.test(
      signature,
    );
  }

  function mergeLessonMaterialRows(current, incoming) {
    const merged = new Map();
    [...current, ...incoming].forEach((row) => {
      const key = [
        row.date,
        row.number ?? "",
        row.startTime || "",
        String(row.subject || "").toLocaleLowerCase("ru"),
      ].join("|");
      const existing = merged.get(key);
      const attachments = [
        ...(existing?.attachments || []),
        ...(row.attachments || []),
      ];
      const unique = new Map(
        attachments.map((item) => [`${item.url}|${item.title}`, item]),
      );
      merged.set(key, {
        ...existing,
        ...row,
        attachments: [...unique.values()],
      });
    });
    return [...merged.values()];
  }

  async function resolveLessonMaterial(material = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      if (material.sourceEndpoint) {
        const response = await fetchViaPage(
          material.sourceEndpoint,
          controller.signal,
        );
        if (response.status >= 200 && response.status < 300) {
          const direct = chooseMaterial(
            parser.collectApiMaterials(response.body),
            material,
          );
          if (direct?.url)
            return {
              ok: true,
              url: direct.url,
              title: direct.title || material.title,
            };
        }
      }
      if (!location.hash.includes("/diary")) {
        location.hash = "#/diary";
        const visible = await waitForVisibleWeek(controller.signal, 8_000);
        if (!visible)
          return { ok: false, error: "Не удалось открыть страницу дневника." };
      }
      const targetWeek = mondayForIso(material.sourceDate || "");
      if (targetWeek) {
        const moved = await moveToMaterialWeek(targetWeek, controller.signal);
        if (!moved)
          return { ok: false, error: "Не удалось открыть нужную неделю." };
      }
      const resolved = await openMaterialLink(material, controller.signal);
      return resolved
        ? { ok: true, url: resolved.url, title: resolved.title }
        : {
            ok: false,
            error: "Материал не найден. Обнови данные и попробуй ещё раз.",
          };
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function moveToMaterialWeek(targetWeek, signal) {
    for (let step = 0; step < 42; step += 1) {
      const visible = getVisibleWeek();
      if (!visible) {
        await waitForRetry(160, signal);
        continue;
      }
      if (visible.start === targetWeek) return true;
      const direction = visible.start < targetWeek ? "next" : "previous";
      const button = findWeekButtons(direction)[0];
      if (!button) return false;
      const previousKey = visible.key;
      button.click();
      const startedAt = Date.now();
      while (Date.now() - startedAt < 3_000) {
        await waitForRetry(120, signal);
        const next = getVisibleWeek();
        if (next && next.key !== previousKey) break;
      }
    }
    return getVisibleWeek()?.start === targetWeek;
  }

  async function openMaterialLink(material, signal) {
    const descriptors = parser.collectLessonMaterialRows(document);
    const lessonRows = [...document.querySelectorAll("table tr")].filter(
      (row) => {
        const text = parser.cleanText(row.textContent);
        return (
          /^\d{1,2}:\d{2}/u.test(text) ||
          /(?:^|\s)(?:0|\d+)\.\s*\S+/u.test(text)
        );
      },
    );
    const targetIndex = descriptors.findIndex((row) =>
      isMatchingMaterialRow(row, material),
    );
    if (targetIndex < 0) return null;
    const descriptor = descriptors[targetIndex];
    const row = lessonRows[targetIndex];
    const direct = chooseMaterial(descriptor.attachments, material);
    if (direct) return direct;
    const candidates = [
      ...row.querySelectorAll("button, [role='button'], a"),
    ].filter(isMaterialTrigger);
    for (const candidate of candidates) {
      if (candidate.tagName === "A" && candidate.href) continue;
      const before = new Set(
        parser.collectVisibleMaterials(document).map((item) => item.url),
      );
      candidate.click();
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await waitForRetry(100, signal);
        const found = parser
          .collectVisibleMaterials(document)
          .filter((item) => !before.has(item.url));
        const selected = chooseMaterial(found, material);
        if (selected) return selected;
      }
    }
    return null;
  }

  function isMatchingMaterialRow(row, material) {
    if (material.sourceDate && row.date !== material.sourceDate) return false;
    if (
      material.sourceLessonNumber != null &&
      Number(row.number) !== Number(material.sourceLessonNumber)
    )
      return false;
    if (
      material.sourceStartTime &&
      row.startTime !== String(material.sourceStartTime).slice(0, 5)
    )
      return false;
    return true;
  }

  function chooseMaterial(items, material) {
    if (!items?.length) return null;
    const title = String(material.title || "").toLocaleLowerCase("ru");
    return (
      items.find((item) =>
        title
          ? String(item.title || "")
              .toLocaleLowerCase("ru")
              .includes(title)
          : false,
      ) || items[0]
    );
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
      if (phase === "running") touchConnectionWatchdog();
      else stopConnectionWatchdog();
    } catch {
      /* Progress reporting must never hold the data sync. */
    }
  }

  function startConnectionWatchdog() {
    syncTimedOut = false;
    clearTimeout(syncDeadlineTimer);
    syncDeadlineTimer = window.setTimeout(() => {
      syncTimedOut = true;
      activeSyncController?.abort();
    }, MAX_SYNC_DURATION_MS);
    touchConnectionWatchdog();
  }

  function touchConnectionWatchdog() {
    clearTimeout(connectionWatchdog);
    if (!activeSyncController) return;
    connectionWatchdog = window.setTimeout(() => {
      syncTimedOut = true;
      activeSyncController?.abort();
    }, CONNECTION_STALL_MS);
  }

  function stopConnectionWatchdog() {
    clearTimeout(connectionWatchdog);
    clearTimeout(syncDeadlineTimer);
    connectionWatchdog = 0;
    syncDeadlineTimer = 0;
  }

  function getSyncTimeoutMessage() {
    return "Синхронизация заняла слишком много времени. Отключи VPN, проверь соединение и попробуй снова.";
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
