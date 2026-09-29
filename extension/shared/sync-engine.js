(function registerSyncEngine(scope) {
  const BLOCKED_URL = /(?:auth|login|logout|password|token|session|captcha)/i;
  const ON_DEMAND_URL = /\/attachments_and_links(?:\?|$)/i;
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
      "/api/v1/education/diary/time_activities/week_activities",
    ]);
    const records = Object.values(snapshot?.network || {});
    const pages = Object.values(snapshot?.pages || {});
    for (const record of records) {
      if (
        record.method === "GET" &&
        ALLOWED_URL.test(record.url || "") &&
        !ON_DEMAND_URL.test(record.url || "") &&
        !BLOCKED_URL.test(record.url)
      )
        urls.add(record.url);
    }
    for (const url of knownUrls) {
      if (
        ALLOWED_URL.test(url || "") &&
        !ON_DEMAND_URL.test(url || "") &&
        !BLOCKED_URL.test(url)
      )
        urls.add(url);
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
          !ON_DEMAND_URL.test(target.pathname) &&
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
    if (url.includes("/time_activities/week_activities"))
      return "Учебные недели";
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

  function buildDiaryWeekRequests(snapshot, knownUrls = []) {
    const records = Object.values(snapshot?.network || {});
    const weekRecord = records.find((record) =>
      /\/diary\/time_activities\/week_activities(?:\?|$)/.test(
        record?.url || "",
      ),
    );
    const weeks = Array.isArray(weekRecord?.body) ? weekRecord.body : [];
    if (!weeks.length) return [];

    const allUrls = [
      ...records.map((record) => record?.url || ""),
      ...(knownUrls || []),
    ];
    let lessonUrl = allUrls.find((url) =>
      /\/classes\/[^/]+\/students\/[^/]+\/lessons(?:\?|$)/.test(url),
    );
    if (!lessonUrl) {
      const schoolId = firstMatch(allUrls, /\/schools\/([^/?]+)/);
      const classId = firstMatch(allUrls, /\/classes\/([^/?]+)/);
      const studentId = firstMatch(allUrls, /\/students\/([^/?]+)/);
      if (!schoolId || !classId || !studentId) return [];
      lessonUrl = `/api/v1/education/diary/schools/${schoolId}/classes/${classId}/students/${studentId}/lessons`;
    }

    const requests = new Map();
    for (const week of weeks) {
      const uuid = String(week?.uuid || "").trim();
      const weekStart = mondayFor(timestampToIso(week?.start_ts));
      if (!uuid || !weekStart) continue;
      const target = new URL(lessonUrl, "https://diary.e-schools.by");
      target.searchParams.set("week_activity_uuid", uuid);
      const url = `${target.pathname}${target.search}`;
      requests.set(url, { url, weekStart });
    }
    return [...requests.values()].sort((first, second) =>
      first.weekStart.localeCompare(second.weekStart),
    );
  }

  function buildLessonAttachmentRequests(snapshot) {
    const requests = new Map();
    const records = Object.values(snapshot?.network || {}).filter((record) =>
      /\/classes\/[^/]+\/students\/[^/]+\/lessons(?:\?|$)/.test(
        record?.url || "",
      ),
    );
    for (const record of records) {
      const base = String(record.url || "").split("?")[0];
      if (!base) continue;
      for (const day of Array.isArray(record.body) ? record.body : []) {
        for (const slot of Array.isArray(day?.slots) ? day.slots : []) {
          const lessonId = String(slot?.lesson_uuid || "").trim();
          const sourceLessonId = String(
            slot?.homework_source_id || lessonId,
          ).trim();
          if (!lessonId || !sourceLessonId || !hasLessonContent(slot)) continue;
          const url = `${base}/${encodeURIComponent(sourceLessonId)}/attachments_and_links`;
          requests.set(`${lessonId}:${sourceLessonId}`, {
            lessonId,
            sourceLessonId,
            url,
            date: timestampToIso(day?.date),
            number: slot?.number,
            startTime: String(slot?.start_time || ""),
            subject: String(slot?.subject_title || ""),
          });
        }
      }
    }
    return [...requests.values()];
  }

  function hasLessonContent(slot) {
    if (String(slot?.homework || "").trim()) return true;
    return [
      slot?.attachments,
      slot?.files,
      slot?.materials,
      slot?.documents,
      slot?.resources,
      slot?.homework_files,
      slot?.homework_attachments,
    ].some((value) => Array.isArray(value) && value.length);
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

  function mondayFor(value) {
    const [year, month, day] = String(value).split("-").map(Number);
    if (!year || !month || !day) return "";
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return date.toISOString().slice(0, 10);
  }

  function getSyncKey(url) {
    if (url.includes("school_year")) return "school-year";
    if (url.includes("/time_activities/week_activities"))
      return "week-activities";
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
    buildLessonAttachmentRequests,
    buildDiaryWeekRequests,
    discoverSyncUrls,
    getSyncLabel,
    selectApiResourceUrls,
    selectSyncUrls,
  });
})(globalThis);
