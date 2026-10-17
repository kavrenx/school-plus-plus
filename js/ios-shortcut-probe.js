// Keep this function self-contained: its source is copied into Apple's
// Run JavaScript on Webpage action. It never uploads anything to School++.
// Default: anonymous probe. collect=true: private educational export to owner.
function runIOSShortcutProbe(scope, completion, options = {}) {
  const collecting = options.collect === true;
  const report = {
    type: collecting ? "schoolpp-ios-collection-v1" : "schoolpp-ios-probe-v1",
    page: "unknown",
    storageReadable: false,
    sessionCandidateFound: false,
    checks: {},
    result: "checking",
  };
  const started = Date.now();
  const controllers = new Set();
  const timers = new Set();
  let finished = false;
  let deadline;
  let snapshot;
  const onAbort = () => finish("cancelled");
  function finish(result) {
    if (finished) return;
    finished = true;
    options.signal?.removeEventListener("abort", onAbort);
    report.result = result;
    report.elapsedMs = Date.now() - started;
    scope.clearTimeout(deadline);
    for (const timer of timers) scope.clearTimeout(timer);
    for (const controller of controllers) controller.abort();
    // The probe returns only counters. Full collection explicitly returns an
    // educational snapshot for the owner's local preview, never session data.
    completion(
      JSON.stringify(
        collecting
          ? {
              type: "schoolpp-ios-export-v1",
              report,
              ...(result === "collection_ready" && snapshot
                ? { snapshot }
                : {}),
            }
          : report,
        null,
        collecting ? 0 : 2,
      ),
    );
  }
  if (scope.location?.origin !== "https://diary.e-schools.by") {
    finish("open_diary_in_safari");
    return;
  }
  report.page = "e-schools";
  if (options.signal?.aborted) {
    finish("cancelled");
    return;
  }
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (typeof scope.fetch !== "function" || !scope.AbortController) {
    finish("web_requests_unavailable");
    return;
  }
  deadline = scope.setTimeout(
    () => finish("time_limit"),
    collecting
      ? Math.min(45000, Math.max(1000, Number(options.timeoutMs) || 8200))
      : 4200,
  );

  function sessionHeaders() {
    const candidates = new Set();
    let inspected = 0;
    function inspect(value, depth = 0) {
      if (depth > 5 || ++inspected > 160 || candidates.size >= 2) return;
      if (typeof value === "string") {
        const text = value.trim().replace(/^Bearer\s+/i, "");
        if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(text)) candidates.add(text);
        else if (value.length < 100000 && /^[{["]/.test(value)) {
          try {
            inspect(JSON.parse(value), depth + 1);
          } catch {
            /* Not JSON. */
          }
        }
      } else if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
          if (!/password|refresh|secret|cookie/i.test(key))
            inspect(item, depth + 1);
        }
      }
    }
    for (const storageName of ["localStorage", "sessionStorage"]) {
      try {
        const storage = scope[storageName];
        if (!storage) continue;
        report.storageReadable = true;
        for (let i = 0; i < Math.min(storage.length, 80); i++) {
          const key = storage.key(i);
          if (
            /auth|token|session|persist|redux|user/i.test(key || "") &&
            !/password|refresh|secret|cookie/i.test(key)
          )
            inspect(storage.getItem(key));
        }
      } catch {
        /* Safari may deny storage in this execution context. */
      }
    }
    report.sessionCandidateFound = candidates.size > 0;
    // Session material stays in this short-lived invocation on the e-schools
    // origin. It is used only for read-only requests back to that same origin.
    return [
      "",
      ...candidates,
      ...[...candidates].map((token) => `Bearer ${token}`),
    ];
  }
  function lessonPath() {
    let entries = [];
    try {
      entries = scope.performance?.getEntriesByType("resource") || [];
    } catch {
      /* Optional. */
    }
    for (const entry of entries.slice(-1000).reverse()) {
      try {
        const url = new URL(entry.name, scope.location.origin);
        if (url.origin !== scope.location.origin) continue;
        const match = url.pathname.match(
          /^\/api\/v1\/education\/diary\/schools\/([\w-]{1,80})\/classes\/([\w-]{1,80})\/students\/([\w-]{1,80})\/lessons$/,
        );
        const week = url.searchParams.get("week_activity_uuid");
        if (match && /^[\w-]{1,80}$/.test(week || ""))
          return `${url.pathname}?week_activity_uuid=${encodeURIComponent(week)}`;
      } catch {
        /* Ignore unrelated resources. */
      }
    }
    return "";
  }
  async function read(path, authorization = "") {
    if (finished) return { status: 0, error: "cancelled" };
    const controller = new scope.AbortController();
    controllers.add(controller);
    let expired = false;
    const timer = scope.setTimeout(
      () => {
        expired = true;
        controller.abort();
      },
      collecting
        ? Math.min(
            5000,
            Math.max(500, Number(options.requestTimeoutMs) || 1800),
          )
        : 1100,
    );
    timers.add(timer);
    try {
      const response = await scope.fetch(`${scope.location.origin}${path}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        headers: authorization
          ? { Authorization: authorization, Accept: "application/json" }
          : { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) return { status: response.status, error: "http_error" };
      try {
        return { status: response.status, body: await response.json() };
      } catch {
        return { status: response.status, error: "not_json" };
      }
    } catch {
      return {
        status: 0,
        error: expired ? "request_timeout" : "network_error",
      };
    } finally {
      scope.clearTimeout(timer);
      timers.delete(timer);
      controllers.delete(controller);
    }
  }
  const list = (value) =>
    Array.isArray(value)
      ? value
      : Array.isArray(value?.data)
        ? value.data
        : Array.isArray(value?.results)
          ? value.results
          : [];
  const summary = (response) => ({
    status: response.status,
    ...(response.error ? { error: response.error } : {}),
  });
  function countMarks(slot) {
    function count(value, depth = 0) {
      if (value == null || depth > 4) return 0;
      if (Array.isArray(value))
        return value.reduce((sum, item) => sum + count(item, depth + 1), 0);
      if (typeof value === "object") {
        const key = ["mark", "value", "grade", "score"].find(
          (key) => value[key] !== undefined,
        );
        return key
          ? count(value[key], depth + 1)
          : Object.values(value).reduce(
              (sum, item) => sum + count(item, depth + 1),
              0,
            );
      }
      return String(value)
        .split("/")
        .filter((item) =>
          /^(?:[1-9]|10|зач[её]т|незач[её]т)$/i.test(item.trim()),
        ).length;
    }
    for (const key of [
      "lesson_mark",
      "lesson_marks",
      "marks",
      "mark",
      "grades",
      "grade",
      "scores",
      "score",
      "student_mark",
      "student_marks",
    ]) {
      const found = count(slot[key]);
      if (found) return found;
    }
    return 0;
  }
  function lessonCounts(body) {
    const days = list(body);
    const slots = days.flatMap((day) => list(day.slots));
    return {
      days: days.length,
      lessons: slots.length,
      marks: slots.reduce((sum, slot) => sum + countMarks(slot), 0),
      homework: slots.filter((slot) => Boolean(slot.homework)).length,
    };
  }

  async function collectAll(
    lessonUrl,
    firstResponse,
    year,
    weeks,
    authorization,
  ) {
    if (!lessonUrl) {
      finish("switch_week_then_retry");
      return;
    }
    const base = lessonUrl.split("?")[0];
    const ids = base.match(
      /\/schools\/([^/]+)\/classes\/([^/]+)\/students\/([^/]+)\/lessons$/,
    );
    const allWeeks = list(weeks.body);
    if (
      !allWeeks.length ||
      allWeeks.length > 60 ||
      new Set(allWeeks.map((week) => week?.uuid)).size !== allWeeks.length ||
      allWeeks.some((week) => !/^[\w-]{1,80}$/.test(String(week?.uuid || "")))
    ) {
      finish("invalid_week_list");
      return;
    }
    const capturedAt = new Date().toISOString();
    const network = {};
    // Only API bodies are exported. Session storage, request headers and browser
    // resource URLs never enter the snapshot. Defense in depth for unexpected
    // authentication fields in otherwise educational API responses.
    function educationalData(value, depth = 0) {
      if (depth > 18) throw new Error("PAYLOAD_DEPTH");
      if (typeof value === "string")
        return /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(
          value.replace(/^Bearer\s+/i, ""),
        )
          ? ""
          : value;
      if (Array.isArray(value))
        return value.map((item) => educationalData(item, depth + 1));
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value)
            .filter(
              ([key]) =>
                !/^(?:authorization|cookie|set-cookie|password|access_?token|refresh_?token|id_?token|session|secret)$/i.test(
                  key,
                ),
            )
            .map(([key, item]) => [key, educationalData(item, depth + 1)]),
        );
      return value;
    }
    function save(path, response, weekStart = "") {
      if (response.error) return;
      network[`GET:${path}`] = {
        url: path,
        method: "GET",
        status: response.status,
        capturedAt,
        ...(weekStart ? { weekStart } : {}),
        body: educationalData(response.body),
      };
    }
    save("/api/v1/education/diary/school_year", year);
    save("/api/v1/education/diary/time_activities/week_activities", weeks);
    const [school, classId, student] = ids.slice(1);
    const diaryRoot = `/api/v1/education/diary/schools/${school}`;
    const metadata = [
      ["activities", "/api/v1/education/diary/time_activities"],
      ["bells", `${diaryRoot}/bells/whole`],
      ["timetable", `${diaryRoot}/classes/${classId}/timetables/whole`],
      ["classes", `${diaryRoot}/students/${student}/classes`],
      [
        "teachers",
        `${diaryRoot}/students/${student}/classes/${classId}/subjects`,
      ],
      [
        "subjects",
        `${diaryRoot}/classes/${classId}/students/${student}/educational_subjects`,
      ],
      [
        "planning",
        `/api/v1/education/planning/classes/${classId}/educational_subjects`,
      ],
      [
        "final",
        `${diaryRoot}/classes/${classId}/students/${student}/final/whole`,
      ],
    ];
    report.checks.metadata = {};
    report.checks.collection = {
      expectedWeeks: new Set(allWeeks.map((week) => week.uuid)).size,
      loadedWeeks: 0,
      failedWeeks: 0,
      lessons: 0,
      marks: 0,
      homework: 0,
    };
    const current = new URL(lessonUrl, scope.location.origin).searchParams.get(
      "week_activity_uuid",
    );
    const jobs = [
      ...new Map(allWeeks.map((week) => [week.uuid, { week }])).values(),
      ...metadata.map(([name, path]) => ({ name, path })),
    ];
    let next = 0;
    async function worker() {
      while (!finished && next < jobs.length) {
        const job = jobs[next++];
        if (job.week) {
          const path = `${base}?week_activity_uuid=${encodeURIComponent(job.week.uuid)}`;
          const response =
            job.week.uuid === current
              ? firstResponse
              : await read(path, authorization);
          if (finished) return;
          if (response.error || !Array.isArray(response.body))
            report.checks.collection.failedWeeks++;
          else {
            let start = String(job.week.start_ts || "");
            if (!/^\d{4}-\d{2}-\d{2}/.test(start)) {
              const numeric = Number(start);
              const date = new Date(
                numeric < 10000000000 ? numeric * 1000 : numeric,
              );
              const parts =
                Number.isFinite(numeric) &&
                numeric > 0 &&
                Number.isFinite(date.getTime())
                  ? new Intl.DateTimeFormat("en-CA", {
                      timeZone: "Europe/Minsk",
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    }).formatToParts(date)
                  : [];
              const fields = Object.fromEntries(
                parts.map((part) => [part.type, part.value]),
              );
              start = fields.year
                ? `${fields.year}-${fields.month}-${fields.day}`
                : "";
            } else start = start.slice(0, 10);
            save(path, response, start);
            report.checks.collection.loadedWeeks++;
            const counts = lessonCounts(response.body);
            for (const key of ["lessons", "marks", "homework"])
              report.checks.collection[key] += counts[key];
            if (typeof options.onProgress === "function")
              options.onProgress({ ...report.checks.collection });
          }
        } else {
          const response = await read(job.path, authorization);
          if (finished) return;
          report.checks.metadata[job.name] = summary(response);
          save(job.path, response);
        }
      }
    }
    await Promise.all(Array.from({ length: 4 }, () => worker()));
    if (finished) return;
    if (
      report.checks.collection.failedWeeks ||
      report.checks.metadata.activities?.status !== 200 ||
      report.checks.metadata.activities?.error
    ) {
      finish("incomplete_collection");
      return;
    }
    const headings = [
      ...(scope.document?.querySelectorAll("h1, h2, h3") || []),
    ].map((element) =>
      String(element.textContent || "")
        .replace(/\s+/g, " ")
        .trim(),
    );
    const bodyText = String(
      scope.document?.body?.innerText ||
        scope.document?.body?.textContent ||
        "",
    )
      .slice(0, 30000)
      .replace(/\s+/g, " ");
    let fullName = "",
      classTitle = "";
    // A heading can contain only the label; Safari may render the name in a
    // sibling. Also ignore navigation labels only AFTER finding the diary.
    for (const text of [...headings, bodyText, headings.join(" ")]) {
      const identity = text.match(
        /электронный дневник обучающегося\s+(.{1,80}?)\s+класса\s*[,;:]?\s*(.*)/iu,
      );
      if (!identity) continue;
      if (!classTitle) classTitle = identity[1].trim();
      const nameText = identity[2]
        .split(/текущие\s*уроки|итоговые\s*отметки/iu)[0]
        .trim();
      const person = nameText.match(
        /^([\p{L}][\p{L}'’-]+)\s+((?:[\p{L}][\p{L}'’-]+)|(?:[\p{L}]\.\s*){1,2})(?:\s+([\p{L}][\p{L}'’-]+))?/u,
      );
      if (!person) continue;
      fullName = [
        person[1],
        person[2].trim(),
        /(?:вич|вна|оглы|кызы)$/iu.test(person[3] || "") ? person[3] : "",
      ]
        .filter(Boolean)
        .join(" ");
      classTitle = identity[1].trim();
      break;
    }
    snapshot = {
      schemaVersion: 1,
      source: "e-schools.by",
      capturedAt,
      pages: {
        shortcut: {
          key: "shortcut",
          kind: "diary",
          capturedAt,
          studentIdentity: {
            classTitle,
            name: fullName,
          },
        },
      },
      network,
      import: {
        transport: ["userscript-test", "userscript"].includes(options.transport)
          ? options.transport
          : "ios-shortcut",
        complete: true,
        expectedWeeks: report.checks.collection.expectedWeeks,
      },
    };
    report.checks.export = {
      bytes: new TextEncoder().encode(JSON.stringify(snapshot)).length,
    };
    if (report.checks.export.bytes > 1800000) {
      snapshot = null;
      finish("payload_too_large");
      return;
    }
    finish("collection_ready");
  }
  void (async () => {
    const headers = sessionHeaders();
    const lessons = lessonPath();
    let authorization = "";
    const path = lessons || "/api/v1/education/diary/school_year";
    let response;
    let attempts = 0;
    for (const candidate of headers) {
      response = await read(path, candidate);
      if (finished) return;
      report.checks.access = { ...summary(response), attempts: ++attempts };
      if (![401, 403].includes(response.status)) {
        authorization = candidate;
        break;
      }
    }
    if (lessons) {
      report.checks.lessons = {
        ...summary(response),
        ...lessonCounts(response.body),
      };
    } else report.checks.lessons = { error: "switch_week_then_retry" };
    if (response.error) {
      finish(
        response.status === 401 || response.status === 403
          ? "sign_in_or_session_unavailable"
          : response.error,
      );
      return;
    }
    const [year, weeks] = await Promise.all([
      read("/api/v1/education/diary/school_year", authorization),
      read(
        "/api/v1/education/diary/time_activities/week_activities",
        authorization,
      ),
    ]);
    if (finished) return;
    report.checks.year = summary(year);
    report.checks.weeks = {
      ...summary(weeks),
      availableWeeks: list(weeks.body).length,
    };
    if (collecting && !year.error && !weeks.error) {
      await collectAll(lessons, response, year, weeks, authorization);
      return;
    }
    finish(
      year.error || weeks.error
        ? "partial"
        : lessons
          ? "read_test_passed"
          : "switch_week_then_retry",
    );
  })().catch(() => finish("test_failed"));
}

function createIOSShortcutProbeScript() {
  return `(${runIOSShortcutProbe.toString()})(window, completion);`;
}

function createIOSShortcutCollectionScript() {
  return `(${runIOSShortcutProbe.toString()})(window, completion, {collect: true});`;
}

export {
  runIOSShortcutProbe,
  createIOSShortcutProbeScript,
  createIOSShortcutCollectionScript,
};
