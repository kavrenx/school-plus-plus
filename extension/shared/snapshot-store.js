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

  function mergeLessonMaterials(snapshot, lessonId, materials = []) {
    const next = cloneSnapshot(snapshot);
    const normalizedId = String(lessonId || "").trim();
    if (!normalizedId || !Array.isArray(materials) || !materials.length)
      return next;
    Object.values(next.network || {}).forEach((record) => {
      if (!/\/students\/[^/]+\/lessons(?:\?|$)/.test(record?.url || "")) return;
      for (const day of Array.isArray(record.body) ? record.body : []) {
        for (const slot of Array.isArray(day?.slots) ? day.slots : []) {
          if (String(slot?.lesson_uuid || "").trim() !== normalizedId) continue;
          const merged = new Map();
          [...(slot.attachments || []), ...materials].forEach((item) => {
            if (!item || typeof item !== "object") return;
            const key = `${item.id || ""}|${item.url || ""}|${item.title || ""}`;
            if (key !== "||") merged.set(key, item);
          });
          slot.attachments = [...merged.values()].slice(0, 12);
        }
      }
    });
    next.capturedAt = new Date().toISOString();
    return fitPayload(next);
  }

  function getLessonMaterials(snapshot, lessons = []) {
    const requested = (Array.isArray(lessons) ? lessons : [])
      .map(normalizeRequestedLesson)
      .filter((lesson) => lesson.id)
      .slice(0, 40);
    const result = Object.fromEntries(
      requested.map((lesson) => [lesson.id, []]),
    );
    if (!requested.length) return result;

    const slots = [];

    Object.values(snapshot?.network || {}).forEach((record) => {
      if (!/\/students\/[^/]+\/lessons(?:\?|$)/.test(record?.url || "")) return;
      for (const day of Array.isArray(record.body) ? record.body : []) {
        for (const slot of Array.isArray(day?.slots) ? day.slots : []) {
          const lessonId = String(slot?.lesson_uuid || "").trim();
          const materials = Array.isArray(slot.attachments)
            ? slot.attachments
            : compactLessonAttachments(slot);
          if (!materials.length) continue;
          slots.push({
            id: lessonId,
            date: getSlotDate(record, day),
            number: Number(slot?.number) || 0,
            startTime: String(slot?.start_time || "").slice(0, 5),
            subject: normalizeSubject(slot?.subject_title),
            materials,
          });
        }
      }
    });

    requested.forEach((lesson) => {
      const exact = slots.filter((slot) => slot.id === lesson.id);
      const matching = exact.length
        ? exact
        : slots.filter(
            (slot) =>
              lesson.date &&
              slot.date === lesson.date &&
              lesson.subject &&
              slot.subject === lesson.subject,
          );
      const ranked = matching.sort(
        (first, second) =>
          lessonMatchScore(second, lesson) - lessonMatchScore(first, lesson),
      );
      const merged = new Map();
      ranked.forEach((slot) =>
        slot.materials.forEach((item) => {
          const key = materialIdentity(item);
          if (key && !merged.has(key)) merged.set(key, item);
        }),
      );
      result[lesson.id] = [...merged.values()].slice(0, 12);
    });
    return result;
  }

  function normalizeRequestedLesson(value) {
    if (value && typeof value === "object")
      return {
        id: String(value.id || "").trim(),
        date: String(value.date || "").slice(0, 10),
        number: Number(value.number) || 0,
        startTime: String(value.startTime || value.startsAt || "").slice(0, 5),
        subject: normalizeSubject(value.subject),
      };
    return {
      id: String(value || "").trim(),
      date: "",
      number: 0,
      startTime: "",
      subject: "",
    };
  }

  function getSlotDate(record, day) {
    const weekStart = String(record?.weekStart || "").slice(0, 10);
    const weekday = Number(day?.day_of_week);
    if (/^\d{4}-\d{2}-\d{2}$/.test(weekStart) && weekday >= 1 && weekday <= 7)
      return addIsoDays(weekStart, weekday - 1);
    return timestampToIso(day?.date);
  }

  function lessonMatchScore(slot, lesson) {
    return (
      (slot.id === lesson.id ? 100 : 0) +
      (lesson.number && slot.number === lesson.number ? 10 : 0) +
      (lesson.startTime && slot.startTime === lesson.startTime ? 8 : 0)
    );
  }

  function normalizeSubject(value) {
    return String(value || "")
      .toLocaleLowerCase("ru")
      .replace(/ё/g, "е")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
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

  function addIsoDays(value, amount) {
    const [year, month, day] = String(value).split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + amount));
    return date.toISOString().slice(0, 10);
  }

  function materialIdentity(item) {
    if (!item || typeof item !== "object") return "";
    return `${item.id || ""}|${item.url || ""}|${item.title || ""}`;
  }

  function fitPayload(snapshot) {
    const next = cloneSnapshot(snapshot);
    delete next.network["GET:/schoolpp/attachment-probe"];
    delete next.network["GET:/schoolpp/attachment-sync"];
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
                  homework_source_id: slot?.homework_source_id,
                  lesson_template_id: slot?.lesson_template_id,
                  lesson_uuid: slot?.lesson_uuid,
                  number: slot?.number,
                  start_time: slot?.start_time,
                  subject_id: slot?.subject_id,
                  subject_title: slot?.subject_title,
                  teacher_id: slot?.teacher_id,
                  attachments: compactLessonAttachments(slot),
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

  function compactLessonAttachments(slot) {
    const result = [];
    collectAttachmentValues(slot, result);
    const unique = new Map();
    result.forEach((item) => {
      const key = `${item.url || ""}:${item.id || ""}:${item.title || ""}`;
      if (key !== "::" && !unique.has(key)) unique.set(key, item);
    });
    return [...unique.values()].slice(0, 12);
  }

  function collectAttachmentValues(
    value,
    result,
    depth = 0,
    attachmentKey = false,
  ) {
    if (value == null || depth > 12) return;
    if (Array.isArray(value)) {
      value.forEach((item) =>
        collectAttachmentValues(item, result, depth + 1, attachmentKey),
      );
      return;
    }
    if (typeof value !== "object") {
      if (attachmentKey && typeof value === "string" && value.trim())
        result.push({ url: value.trim(), title: "" });
      return;
    }
    if (attachmentKey || hasAttachmentIdentity(value)) {
      const url = firstText(value, [
        "download_url",
        "downloadUrl",
        "file_url",
        "fileUrl",
        "url",
        "href",
        "link",
        "path",
      ]);
      const title = firstText(value, [
        "original_name",
        "originalName",
        "file_name",
        "filename",
        "name",
        "title",
        "label",
        "caption",
      ]);
      const id = firstText(value, [
        "uuid",
        "file_uuid",
        "fileId",
        "attachment_uuid",
        "document_uuid",
        "resource_uuid",
        "id",
      ]);
      if (url || title || id) {
        result.push({ url, title, id });
        return;
      }
    }
    Object.entries(value).forEach(([key, item]) => {
      const nextAttachmentKey =
        attachmentKey || /attach|file|material|document|resource/i.test(key);
      collectAttachmentValues(item, result, depth + 1, nextAttachmentKey);
    });
  }

  function hasAttachmentIdentity(value) {
    const keys = Object.keys(value || {});
    return (
      keys.some((key) =>
        /^(?:file_?name|filename|original_?name)$/i.test(key),
      ) &&
      keys.some((key) =>
        /^(?:url|href|link|path|download_?url|file_?url)$/i.test(key),
      )
    );
  }

  function firstText(value, keys) {
    const key = keys.find((item) => value?.[item] != null);
    return key ? String(value[key]).trim() : "";
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
        lessonMaterials: (page.lessonMaterials || []).map((row) => ({
          date: row.date,
          number: row.number,
          startTime: row.startTime,
          subject: row.subject,
          attachmentCount: row.attachments?.length || 0,
          attachmentFields: [
            ...new Set(
              (row.attachments || []).flatMap((item) =>
                Object.keys(item || {}),
              ),
            ),
          ].sort(),
        })),
        materialHints: (page.materialHints || []).slice(0, 20),
      })),
      network: Object.values(value.network || {}).map((record) => {
        const attachmentLocations = collectDiagnosticAttachmentLocations(
          record.body,
          record.weekStart,
        );
        return {
          key: record.key,
          url: record.url,
          method: record.method,
          status: record.status,
          bodyShape: describeShape(record.body),
          attachmentSamples: collectDiagnosticAttachments(record.body),
          attachmentLocations,
        };
      }),
    };
  }

  function describeShape(value, depth = 0) {
    if (depth > 16) return "depth-limit";
    if (value === null) return "null";
    if (Array.isArray(value)) {
      const shapes = value
        .slice(0, 64)
        .map((item) => describeShape(item, depth + 1));
      return {
        type: "array",
        length: value.length,
        items: shapes.length
          ? shapes.sort(
              (first, second) => shapeScore(second) - shapeScore(first),
            )[0]
          : "unknown",
      };
    }
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

  function shapeScore(value) {
    if (value == null || typeof value !== "object")
      return value === "unknown" ? 0 : 1;
    if (Array.isArray(value))
      return value.reduce((total, item) => total + shapeScore(item), 1);
    return Object.entries(value).reduce(
      (total, [key, item]) =>
        total +
        shapeScore(item) +
        (/attach|file|material|document|resource/i.test(key) ? 10 : 1),
      1,
    );
  }

  function collectDiagnosticAttachments(value) {
    const result = [];
    visit(value, 0);
    return result.slice(0, 12);

    function visit(item, depth) {
      if (item == null || depth > 8 || result.length >= 12) return;
      if (Array.isArray(item)) {
        item.forEach((entry) => visit(entry, depth + 1));
        return;
      }
      if (typeof item !== "object") return;
      if (Array.isArray(item.attachments)) {
        item.attachments.forEach((attachment) => {
          if (!attachment || typeof attachment !== "object") return;
          result.push({
            fields: Object.keys(attachment).sort(),
            hasUrl: Boolean(attachment.url),
            hasTitle: Boolean(attachment.title),
            hasId: Boolean(attachment.id),
          });
        });
      }
      Object.values(item).forEach((entry) => visit(entry, depth + 1));
    }
  }

  function collectDiagnosticAttachmentLocations(value, weekStart = "") {
    if (!Array.isArray(value)) return [];
    return value
      .flatMap((day) =>
        (Array.isArray(day?.slots) ? day.slots : [])
          .filter(
            (slot) =>
              Array.isArray(slot?.attachments) && slot.attachments.length,
          )
          .map((slot) => ({
            date: day?.date,
            dayOfWeek: day?.day_of_week,
            resolvedDate: getSlotDate({ weekStart }, day),
            lessonId: slot?.lesson_uuid,
            number: slot?.number,
            startTime: slot?.start_time,
            subject: slot?.subject_title,
            homeworkPresent: Boolean(slot?.homework),
            attachmentCount: slot.attachments.length,
            titles: slot.attachments
              .map((item) => String(item?.title || "").slice(0, 160))
              .filter(Boolean),
            hasSourceEndpoint: slot.attachments.some((item) =>
              Boolean(item?.sourceEndpoint),
            ),
          })),
      )
      .slice(0, 20);
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
    getLessonMaterials,
    getSnapshotStats,
    mergeLessonMaterials,
    mergeNetworkRecord,
    mergePage,
  });
})(globalThis);
