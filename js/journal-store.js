const JOURNAL_STORAGE_KEY = "schoolPlusPlus_journalEntries";
const JOURNAL_SCHEMA_VERSION = 3;
const MAX_GRADES_PER_LESSON = 2;

const STUDENT_COLLECTIONS = [
  "gradeEntries",
  "attendanceEntries",
  "homeworkEntries",
  "commentEntries",
  "materialEntries",
];

function createJournalStore(storage) {
  function getDocument() {
    try {
      const value = storage.getItem(JOURNAL_STORAGE_KEY);
      if (!value) return createEmptyDocument();

      const data = JSON.parse(value);
      if (data?.schemaVersion === JOURNAL_SCHEMA_VERSION) {
        return normalizeDocument(data);
      }

      if (data?.schemaVersion === 2) {
        const migrated = migrateVersionTwoDocument(data);
        saveDocument(migrated);
        return migrated;
      }

      const migrated = migrateLegacyJournal(data);
      saveDocument(migrated);
      return migrated;
    } catch {
      return createEmptyDocument();
    }
  }

  function saveDocument(document) {
    return storage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(document));
  }

  function getJournalEntry(lessonId, studentId) {
    return assembleJournalEntry(getDocument(), lessonId, studentId);
  }

  function saveJournalEntry(entry) {
    const document = getDocument();
    const normalized = normalizeEntry(entry);
    replaceStudentLessonEntities(document, normalized);
    const persisted = saveDocument(document) !== false;
    return { entry: normalized, persisted };
  }

  function getLessonEntries(lessonId) {
    const document = getDocument();
    const studentIds = new Set();

    STUDENT_COLLECTIONS.forEach((collectionName) => {
      Object.values(document[collectionName]).forEach((entity) => {
        if (entity.lessonId === lessonId) studentIds.add(entity.studentId);
      });
    });

    return Array.from(studentIds, (studentId) =>
      assembleJournalEntry(document, lessonId, studentId),
    ).filter(Boolean);
  }

  function mergeLessonForStudent(baseLesson, studentId) {
    if (!baseLesson || !studentId) return baseLesson;
    const entry = getJournalEntry(baseLesson.id, studentId);
    const lessonWork = getLessonWork(baseLesson.id);
    return mergeJournalEntryIntoLesson(baseLesson, entry, lessonWork);
  }

  function getLessonWork(lessonId) {
    const work = getDocument().lessonWorkEntries[getLessonWorkId(lessonId)];
    return work ? normalizeLessonWork(work) : null;
  }

  function saveLessonWork(work) {
    const document = getDocument();
    const normalized = normalizeLessonWork(work);
    if (
      normalized.noHomework ||
      normalized.homework ||
      normalized.materials.length
    ) {
      document.lessonWorkEntries[normalized.id] = normalized;
    } else {
      delete document.lessonWorkEntries[normalized.id];
    }
    const persisted = saveDocument(document) !== false;
    return { lessonWork: normalized, persisted };
  }

  function getTermGrade(termId, assignmentId, studentId) {
    const entry = getDocument().termGradeEntries[
      getTermGradeId(termId, assignmentId, studentId)
    ];
    return entry ? normalizeTermGrade(entry) : null;
  }

  function getTermGrades(termId, assignmentId) {
    return Object.values(getDocument().termGradeEntries)
      .filter(
        (entry) =>
          entry.termId === termId && entry.assignmentId === assignmentId,
      )
      .map(normalizeTermGrade);
  }

  function saveTermGrade(entry) {
    const document = getDocument();
    const normalized = normalizeTermGrade(entry);
    if (normalized.value) {
      document.termGradeEntries[normalized.id] = normalized;
    } else {
      delete document.termGradeEntries[normalized.id];
    }
    const persisted = saveDocument(document) !== false;
    return { termGrade: normalized, persisted };
  }

  return {
    getJournalEntry,
    getLessonEntries,
    getLessonWork,
    getTermGrade,
    getTermGrades,
    mergeLessonForStudent,
    saveJournalEntry,
    saveLessonWork,
    saveTermGrade,
  };
}

function createEmptyDocument() {
  return {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    gradeEntries: {},
    attendanceEntries: {},
    homeworkEntries: {},
    commentEntries: {},
    materialEntries: {},
    lessonWorkEntries: {},
    termGradeEntries: {},
  };
}

function normalizeDocument(document) {
  const normalized = createEmptyDocument();
  STUDENT_COLLECTIONS.forEach((collectionName) => {
    const collection = document?.[collectionName];
    if (!collection || typeof collection !== "object" || Array.isArray(collection)) {
      normalized[collectionName] = {};
      return;
    }

    normalized[collectionName] = Object.fromEntries(
      Object.entries(collection).filter(
        ([, entity]) =>
          entity &&
          typeof entity === "object" &&
          !Array.isArray(entity) &&
          entity.lessonId &&
          entity.studentId,
      ),
    );
  });
  normalized.lessonWorkEntries = normalizeEntityCollection(
    document?.lessonWorkEntries,
    (entry) => entry.lessonId,
  );
  normalized.termGradeEntries = normalizeEntityCollection(
    document?.termGradeEntries,
    (entry) => entry.termId && entry.assignmentId && entry.studentId,
  );
  return normalized;
}

function normalizeEntityCollection(collection, isValid) {
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(collection).filter(
      ([, entry]) =>
        entry && typeof entry === "object" && !Array.isArray(entry) && isValid(entry),
    ),
  );
}

function migrateVersionTwoDocument(document) {
  return normalizeDocument({
    ...document,
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    lessonWorkEntries: {},
    termGradeEntries: {},
  });
}

function migrateLegacyJournal(entries) {
  const document = createEmptyDocument();
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    return document;
  }

  Object.values(entries).forEach((entry) => {
    if (!entry?.lessonId || !entry?.studentId) return;
    const timestamp = entry.updatedAt || new Date().toISOString();
    replaceStudentLessonEntities(document, normalizeEntry(entry, timestamp));
  });

  return document;
}

function replaceStudentLessonEntities(document, entry) {
  STUDENT_COLLECTIONS.forEach((collectionName) => {
    Object.entries(document[collectionName]).forEach(([id, entity]) => {
      if (
        entity.lessonId === entry.lessonId &&
        entity.studentId === entry.studentId
      ) {
        delete document[collectionName][id];
      }
    });
  });

  entry.grades.forEach((value, index) => {
    const id = getEntityId(entry.lessonId, entry.studentId, "grade", index);
    document.gradeEntries[id] = {
      id,
      lessonId: entry.lessonId,
      studentId: entry.studentId,
      value,
      authorId: entry.authorId,
      position: index,
      createdAt: entry.updatedAt,
      updatedAt: entry.updatedAt,
    };
  });

  if (entry.attendance) {
    const id = getEntityId(entry.lessonId, entry.studentId, "attendance");
    document.attendanceEntries[id] = {
      id,
      lessonId: entry.lessonId,
      studentId: entry.studentId,
      status: entry.attendance,
      authorId: entry.authorId,
      updatedAt: entry.updatedAt,
    };
  }

  addTextEntity(document.homeworkEntries, entry, "homework", entry.homework);
  addTextEntity(document.commentEntries, entry, "comment", entry.comment);

  entry.materials.forEach((url, index) => {
    const id = getEntityId(entry.lessonId, entry.studentId, "material", index);
    document.materialEntries[id] = {
      id,
      lessonId: entry.lessonId,
      studentId: entry.studentId,
      url,
      title: "",
      authorId: entry.authorId,
      position: index,
      updatedAt: entry.updatedAt,
    };
  });
}

function addTextEntity(collection, entry, type, text) {
  if (!text) return;
  const id = getEntityId(entry.lessonId, entry.studentId, type);
  collection[id] = {
    id,
    lessonId: entry.lessonId,
    studentId: entry.studentId,
    text,
    authorId: entry.authorId,
    updatedAt: entry.updatedAt,
  };
}

function assembleJournalEntry(document, lessonId, studentId) {
  const grades = matchingEntities(
    document.gradeEntries,
    lessonId,
    studentId,
  ).sort(comparePosition);
  const attendance = matchingEntities(
    document.attendanceEntries,
    lessonId,
    studentId,
  )[0];
  const homework = matchingEntities(
    document.homeworkEntries,
    lessonId,
    studentId,
  )[0];
  const comment = matchingEntities(
    document.commentEntries,
    lessonId,
    studentId,
  )[0];
  const materials = matchingEntities(
    document.materialEntries,
    lessonId,
    studentId,
  ).sort(comparePosition);
  const entities = [...grades, attendance, homework, comment, ...materials].filter(
    Boolean,
  );

  if (!entities.length) return null;

  const latestEntity = [...entities]
    .filter((entity) => entity.updatedAt)
    .sort((first, second) =>
      first.updatedAt.localeCompare(second.updatedAt),
    )
    .at(-1);

  return {
    id: getEntryId(lessonId, studentId),
    lessonId,
    studentId,
    grades: normalizeGrades(grades.map((entity) => entity.value)),
    attendance: attendance?.status === "absent" ? "absent" : "",
    comment: comment?.text || "",
    homework: homework?.text || "",
    materials: materials.map((entity) => entity.url),
    authorId: latestEntity?.authorId || "",
    updatedAt: latestEntity?.updatedAt || "",
  };
}

function matchingEntities(collection, lessonId, studentId) {
  return Object.values(collection).filter(
    (entity) =>
      entity.lessonId === lessonId && entity.studentId === studentId,
  );
}

function comparePosition(first, second) {
  return (first.position ?? 0) - (second.position ?? 0);
}

function getEntryId(lessonId, studentId) {
  return `${lessonId}_${studentId}`;
}

function getEntityId(lessonId, studentId, type, index = 0) {
  return `${getEntryId(lessonId, studentId)}_${type}_${index + 1}`;
}

function normalizeEntry(entry, timestamp = new Date().toISOString()) {
  const lessonId = entry.lessonId;
  const studentId = entry.studentId;

  return {
    id: entry.id || getEntryId(lessonId, studentId),
    lessonId,
    studentId,
    grades: normalizeGrades(entry.grades),
    attendance: entry.attendance === "absent" ? "absent" : "",
    comment: entry.comment?.trim() || "",
    homework: entry.homework?.trim() || "",
    materials: Array.isArray(entry.materials)
      ? entry.materials.map((item) => item.trim()).filter(Boolean)
      : [],
    authorId: entry.authorId ? String(entry.authorId) : "",
    updatedAt: timestamp,
  };
}

function normalizeGrades(grades) {
  if (!Array.isArray(grades)) return [];
  return Array.from(
    new Set(grades.map((grade) => String(grade).trim()).filter(Boolean)),
  ).slice(0, MAX_GRADES_PER_LESSON);
}

function mergeJournalEntryIntoLesson(baseLesson, entry, lessonWork = null) {
  if (!baseLesson || (!entry && !lessonWork)) return baseLesson;
  const grades = normalizeGrades(entry?.grades);
  const grade = grades.join(" / ");
  const homework = lessonWork
    ? lessonWork.noHomework
      ? "нет дз"
      : lessonWork.homework || baseLesson.homework
    : entry?.homework?.trim() || baseLesson.homework;

  return {
    ...baseLesson,
    homework,
    grade: grade || baseLesson.grade,
    attendance: entry?.attendance || "",
    journalEntry: entry || null,
    lessonWork,
  };
}

function getLessonWorkId(lessonId) {
  return `${lessonId}_work`;
}

function normalizeLessonWork(work, timestamp = new Date().toISOString()) {
  const lessonId = String(work?.lessonId || "").trim();
  return {
    id: work?.id || getLessonWorkId(lessonId),
    lessonId,
    homework: work?.homework?.trim() || "",
    noHomework: Boolean(work?.noHomework),
    materials: Array.isArray(work?.materials)
      ? work.materials.map((item) => String(item).trim()).filter(Boolean)
      : [],
    authorId: String(work?.authorId || ""),
    updatedAt: work?.updatedAt || timestamp,
  };
}

function getTermGradeId(termId, assignmentId, studentId) {
  return `${termId}_${assignmentId}_${studentId}_term-grade`;
}

function normalizeTermGrade(entry, timestamp = new Date().toISOString()) {
  const termId = String(entry?.termId || "").trim();
  const assignmentId = String(entry?.assignmentId || "").trim();
  const studentId = String(entry?.studentId || "").trim();
  return {
    id: entry?.id || getTermGradeId(termId, assignmentId, studentId),
    termId,
    assignmentId,
    studentId,
    value: normalizeGradeValue(entry?.value),
    authorId: String(entry?.authorId || ""),
    updatedAt: entry?.updatedAt || timestamp,
  };
}

function normalizeGradeValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (/^(?:10|[1-9])$/.test(normalized)) return normalized;
  if (["зачёт", "незачёт"].includes(normalized)) return normalized;
  return "";
}

export {
  createJournalStore,
  getEntryId,
  JOURNAL_SCHEMA_VERSION,
  JOURNAL_STORAGE_KEY,
  MAX_GRADES_PER_LESSON,
  getLessonWorkId,
  getTermGradeId,
  mergeJournalEntryIntoLesson,
  migrateLegacyJournal,
  migrateVersionTwoDocument,
  normalizeGradeValue,
  normalizeGrades,
  normalizeLessonWork,
  normalizeTermGrade,
};
