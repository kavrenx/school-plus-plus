(function registerSyncEngine(scope) {
  const BLOCKED_URL = /(?:auth|login|logout|password|token|session|captcha)/i;
  const ALLOWED_URL =
    /^\/api\/v1\/(?:education\/(?:diary|planning)\/|institution\/schools\/[^/]+\/premises(?:\?|$))/;
  const PREMISES_QUERY = encodeURIComponent(
    JSON.stringify({
      expr: {
        units: [{ field: "dt_delete", operator: "ISNULL", operands: [] }],
        operator: "AND",
      },
      sorting: { audience_number: "ASC" },
    }),
  );

  function discoverSyncUrls(snapshot, knownUrls = []) {
    const urls = new Set([
      "/api/v1/education/diary/school_year",
      "/api/v1/education/diary/time_activities",
    ]);
    const records = Object.values(snapshot?.network || {});
    const pages = Object.values(snapshot?.pages || {});
    for (const record of records) {
      if (
        record.method === "GET" &&
        ALLOWED_URL.test(record.url || "") &&
        !BLOCKED_URL.test(record.url)
      )
        urls.add(record.url);
    }
    for (const url of knownUrls) {
      if (ALLOWED_URL.test(url || "") && !BLOCKED_URL.test(url)) urls.add(url);
    }

    const allUrls = [
      ...records.map((record) => record.url || ""),
      ...knownUrls,
    ];
    const schoolId = firstMatch(allUrls, /\/schools\/([^/?]+)/);
    const studentId = firstMatch(allUrls, /\/students\/([^/?]+)/);
    const classId =
      firstMatch(allUrls, /\/classes\/([^/?]+)/) ||
      firstMatch(
        pages.map((page) => page.route || ""),
        /[?&](?:activeClass|class)=([^&]+)/,
      );

    if (schoolId) {
      urls.add(`/api/v1/education/diary/schools/${schoolId}/bells/whole`);
      urls.add(
        `/api/v1/institution/schools/${schoolId}/premises?q=${PREMISES_QUERY}`,
      );
    }
    if (schoolId && classId) {
      urls.add(
        `/api/v1/education/diary/schools/${schoolId}/classes/${classId}/timetables/whole`,
      );
      urls.add(
        `/api/v1/education/planning/classes/${classId}/educational_subjects`,
      );
    }
    if (schoolId && classId && studentId) {
      const base = `/api/v1/education/diary/schools/${schoolId}`;
      urls.add(`${base}/students/${studentId}/classes`);
      urls.add(`${base}/students/${studentId}/classes/${classId}/subjects`);
      urls.add(
        `${base}/classes/${classId}/students/${studentId}/educational_subjects`,
      );
      urls.add(`${base}/classes/${classId}/students/${studentId}/final/whole`);
    }
    return [...urls];
  }

  function firstMatch(values, pattern) {
    for (const value of values) {
      const match = String(value).match(pattern);
      if (match) return decodeURIComponent(match[1]);
    }
    return "";
  }

  function selectApiResourceUrls(resourceNames, origin) {
    const urls = new Set();
    for (const value of resourceNames || []) {
      try {
        const target = new URL(value, origin);
        if (
          target.origin === origin &&
          ALLOWED_URL.test(target.pathname) &&
          !BLOCKED_URL.test(target.href)
        )
          urls.add(`${target.pathname}${target.search}`);
      } catch {
        /* Ignore browser resource entries that are not valid URLs. */
      }
    }
    return [...urls];
  }

  function getSyncLabel(url) {
    if (url.includes("/lessons?")) return "Уроки и отметки";
    if (url.includes("/final/")) return "Итоговые отметки";
    if (url.includes("/timetables/")) return "Расписание уроков";
    if (url.includes("/bells/")) return "Расписание звонков";
    if (url.includes("/premises")) return "Кабинеты";
    if (url.includes("time_activities")) return "Четверти и каникулы";
    if (url.includes("/planning/")) return "Учебные предметы";
    if (url.includes("/educational_subjects")) return "Предметы ученика";
    if (url.includes("/subjects")) return "Учителя";
    if (url.includes("/classes")) return "Класс";
    if (url.includes("school_year")) return "Учебный год";
    return "Данные дневника";
  }

  function selectSyncUrls(urls) {
    const selected = new Map();
    for (const url of urls) selected.set(getSyncKey(url), url);
    return [...selected.values()];
  }

  function getSyncKey(url) {
    if (url.includes("school_year")) return "school-year";
    if (url.includes("time_activities")) return "time-activities";
    if (url.includes("/lessons?")) return `lessons:${url}`;
    if (url.includes("/final/")) return "final";
    if (url.includes("/timetables/")) return "timetable";
    if (url.includes("/bells/")) return "bells";
    if (url.includes("/premises")) return "premises";
    if (url.includes("/planning/")) return "planning-subjects";
    if (url.includes("/educational_subjects")) return "student-subjects";
    if (url.includes("/subjects")) return "teachers";
    if (url.includes("/classes")) return "class";
    return String(url).split("?")[0];
  }

  scope.SchoolppSyncEngine = Object.freeze({
    discoverSyncUrls,
    getSyncLabel,
    selectApiResourceUrls,
    selectSyncUrls,
  });
})(globalThis);
