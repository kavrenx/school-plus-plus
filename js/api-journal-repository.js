import { ApiError } from "./api-client.js";
import { mergeJournalEntryIntoLesson } from "./journal-store.js";
import { assertRepositoryContract } from "./repository-contracts.js";

function createApiJournalRepository(apiClient) {
  if (typeof apiClient?.request !== "function") {
    throw new TypeError("An API client is required");
  }

  async function getJournalEntry(lessonId, studentId, { signal } = {}) {
    try {
      const payload = await apiClient.request(
        `lessons/${encodeId(lessonId, "lessonId")}/students/${encodeId(studentId, "studentId")}/journal`,
        { signal },
      );
      return payload?.entry ?? payload ?? null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  async function getLessonEntries(lessonId, { signal } = {}) {
    const payload = await apiClient.request(
      `lessons/${encodeId(lessonId, "lessonId")}/journal`,
      { signal },
    );
    const entries = payload?.entries ?? payload;
    return Array.isArray(entries) ? entries : [];
  }

  async function saveJournalEntry(entry, { signal } = {}) {
    const payload = await apiClient.request(
      `lessons/${encodeId(entry?.lessonId, "lessonId")}/students/${encodeId(entry?.studentId, "studentId")}/journal`,
      { method: "PUT", body: createJournalMutation(entry), signal },
    );
    return {
      entry: payload?.entry ?? payload,
      persisted: true,
    };
  }

  async function getLessonWork(lessonId, { signal } = {}) {
    try {
      const payload = await apiClient.request(
        `lessons/${encodeId(lessonId, "lessonId")}/work`,
        { signal },
      );
      return payload?.lessonWork ?? payload ?? null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  async function saveLessonWork(work, { signal } = {}) {
    const payload = await apiClient.request(
      `lessons/${encodeId(work?.lessonId, "lessonId")}/work`,
      {
        method: "PUT",
        body: {
          homework: work?.homework || "",
          noHomework: Boolean(work?.noHomework),
          materials: Array.isArray(work?.materials) ? work.materials : [],
        },
        signal,
      },
    );
    return {
      lessonWork: payload?.lessonWork ?? payload,
      persisted: true,
    };
  }

  async function getTermGrade(termId, assignmentId, studentId, { signal } = {}) {
    try {
      const payload = await apiClient.request(
        `terms/${encodeId(termId, "termId")}/assignments/${encodeId(assignmentId, "assignmentId")}/students/${encodeId(studentId, "studentId")}/grade`,
        { signal },
      );
      return payload?.termGrade ?? payload ?? null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  async function getTermGrades(termId, assignmentId, { signal } = {}) {
    const payload = await apiClient.request(
      `terms/${encodeId(termId, "termId")}/assignments/${encodeId(assignmentId, "assignmentId")}/grades`,
      { signal },
    );
    const entries = payload?.termGrades ?? payload;
    return Array.isArray(entries) ? entries : [];
  }

  async function saveTermGrade(entry, { signal } = {}) {
    const payload = await apiClient.request(
      `terms/${encodeId(entry?.termId, "termId")}/assignments/${encodeId(entry?.assignmentId, "assignmentId")}/students/${encodeId(entry?.studentId, "studentId")}/grade`,
      {
        method: "PUT",
        body: { value: entry?.value || "" },
        signal,
      },
    );
    return {
      termGrade: payload?.termGrade ?? payload,
      persisted: true,
    };
  }

  async function mergeLessonForStudent(baseLesson, studentId, options) {
    if (!baseLesson || !studentId) return baseLesson;
    const [entry, lessonWork] = await Promise.all([
      getJournalEntry(baseLesson.id, studentId, options),
      getLessonWork(baseLesson.id, options),
    ]);
    return mergeJournalEntryIntoLesson(baseLesson, entry, lessonWork);
  }

  return assertRepositoryContract("journal", {
    getJournalEntry,
    getLessonEntries,
    getLessonWork,
    getTermGrade,
    getTermGrades,
    mergeLessonForStudent,
    saveJournalEntry,
    saveLessonWork,
    saveTermGrade,
  });
}

function createJournalMutation(entry) {
  return {
    grades: Array.isArray(entry.grades) ? entry.grades : [],
    attendance: entry.attendance || "",
    comment: entry.comment || "",
    homework: entry.homework || "",
    materials: Array.isArray(entry.materials) ? entry.materials : [],
  };
}

function encodeId(value, fieldName) {
  const id = String(value ?? "").trim();
  if (!id) throw new TypeError(`${fieldName} is required`);
  return encodeURIComponent(id);
}

export { createApiJournalRepository, createJournalMutation };
