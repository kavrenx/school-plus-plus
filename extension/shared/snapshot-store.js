(function registerSnapshotStore(scope) {
  const MAX_NETWORK_RECORDS = 120;
  const MAX_PAYLOAD_BYTES = 1_900_000;

  function createEmptySnapshot(now = new Date().toISOString()) {
    return {
      schemaVersion: 1,
      source: "e-schools.by",
      capturedAt: now,
      pages: {},
      network: {},
    };
  }

  function mergePage(snapshot, page) {
    const next = cloneSnapshot(snapshot);
    next.capturedAt = page.capturedAt || new Date().toISOString();
    next.pages[page.key] = page;
    if (page.profile) next.profile = page.profile;
    return fitPayload(next);
  }

  function mergeNetworkRecord(snapshot, record) {
    const next = cloneSnapshot(snapshot);
    let compacted = compactNetworkRecord(record);
    const key =
      compacted.key || `${compacted.method || "GET"}:${compacted.url}`;
    const existing = next.network[key];
    if (!compacted.weekStart && existing?.weekStart) {
      compacted = { ...compacted, weekStart: existing.weekStart };
    }
    next.network[key] = compacted;
    const records = Object.entries(next.network).sort(([, first], [, second]) =>
      String(first.capturedAt).localeCompare(String(second.capturedAt)),
    );
    while (records.length > MAX_NETWORK_RECORDS) {
      const [oldestKey] = records.shift();
      delete next.network[oldestKey];
    }
    next.capturedAt = record.capturedAt || next.capturedAt;
    return fitPayload(next);
  }

  function fitPayload(snapshot) {
    const next = cloneSnapshot(snapshot);
    if (getByteLength(next) > MAX_PAYLOAD_BYTES) {
      next.pages = Object.fromEntries(Object.entries(next.pages).slice(-4));
    }
    const network = Object.entries(next.network).sort(([, first], [, second]) =>
      String(first.capturedAt).localeCompare(String(second.capturedAt)),
    );
    while (getByteLength(next) > MAX_PAYLOAD_BYTES && network.length) {
      const [oldestKey] = network.shift();
      delete next.network[oldestKey];
    }
    return next;
  }

  function compactNetworkRecord(record = {}) {
    if (!/\/students\/[^/]+\/lessons(?:\?|$)/.test(record.url || ""))
      return record;
    return {
      ...record,
      body: Array.isArray(record.body)
        ? record.body.map((day) => ({
            date: day?.date,
            day_of_week: day?.day_of_week,
            slots: Array.isArray(day?.slots)
              ? day.slots.map((slot) => ({
                  homework: slot?.homework,
                  lesson_mark: compactLessonMark(slot?.lesson_mark),
                  lesson_marks: compactLessonMarks(slot?.lesson_marks),
                  marks: compactLessonMarks(slot?.marks),
                  mark: compactLessonMark(slot?.mark),
                  grades: compactLessonMarks(slot?.grades),
                  grade: compactLessonMark(slot?.grade),
                  scores: compactLessonMarks(slot?.scores),
                  score: compactLessonMark(slot?.score),
                  student_mark: compactLessonMark(slot?.student_mark),
                  student_marks: compactLessonMarks(slot?.student_marks),
                  lesson_template_id: slot?.lesson_template_id,
                  lesson_uuid: slot?.lesson_uuid,
                  number: slot?.number,
                  start_time: slot?.start_time,
                  subject_id: slot?.subject_id,
                  subject_title: slot?.subject_title,
                  teacher_id: slot?.teacher_id,
                }))
              : [],
          }))
        : record.body,
    };
  }

  function compactLessonMark(mark) {
    if (Array.isArray(mark)) return compactLessonMarks(mark);
    if (mark !== null && typeof mark !== "object") return mark;
    if (!mark || typeof mark !== "object") return mark;
    return {
      author: mark.author,
      comment: mark.comment,
      kind: mark.kind,
      mark: mark.mark,
      grade: mark.grade,
      score: mark.score,
      type: mark.type,
      uuid: mark.uuid,
      value: mark.value,
    };
  }

  function compactLessonMarks(marks) {
    return Array.isArray(marks) ? marks.map(compactLessonMark) : marks;
  }

  function getSnapshotStats(snapshot) {
    const value = snapshot || createEmptySnapshot();
    return {
      capturedAt: value.capturedAt,
      pages: Object.keys(value.pages || {}).length,
      networkRecords: Object.keys(value.network || {}).length,
      bytes: getByteLength(value),
      ready:
        Object.keys(value.pages || {}).length > 0 ||
        Object.keys(value.network || {}).length > 0,
    };
  }

  function createDiagnostics(snapshot) {
    const value = snapshot || createEmptySnapshot();
    return {
      schemaVersion: value.schemaVersion,
      source: value.source,
      capturedAt: value.capturedAt,
      pages: Object.values(value.pages || {}).map((page) => ({
        key: page.key,
        route: page.route,
        kind: page.kind,
        tables: (page.tables || []).map((table) => ({
          headers: table.headers || [],
          rowCount: table.rows?.length || 0,
          columnCount: Math.max(
            0,
            ...(table.rows || []).map((row) => row.length),
          ),
        })),
      })),
      network: Object.values(value.network || {}).map((record) => ({
        key: record.key,
        url: record.url,
        method: record.method,
        status: record.status,
        bodyShape: describeShape(record.body),
      })),
    };
  }

  function describeShape(value, depth = 0) {
    if (depth > 16) return "depth-limit";
    if (value === null) return "null";
    if (Array.isArray(value))
      return {
        type: "array",
        length: value.length,
        items: value.length ? describeShape(value[0], depth + 1) : "unknown",
      };
    if (typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          describeShape(item, depth + 1),
        ]),
      );
    if (typeof value !== "string") return typeof value;
    if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return "iso-date";
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(value)) return "date-dd.mm.yyyy";
    if (/^\d{2}:\d{2}(?::\d{2})?$/.test(value)) return "time";
    return value ? "string" : "empty-string";
  }

  function getByteLength(value) {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  }

  function cloneSnapshot(snapshot) {
    return snapshot
      ? JSON.parse(JSON.stringify(snapshot))
      : createEmptySnapshot();
  }

  scope.SchoolppSnapshotStore = Object.freeze({
    createEmptySnapshot,
    createDiagnostics,
    getSnapshotStats,
    mergeNetworkRecord,
    mergePage,
  });
})(globalThis);
