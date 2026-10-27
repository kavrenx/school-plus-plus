import { getTermGradeId } from "./journal-store.js";

// Student-only read overlay. Official source finals are derived from the raw
// snapshot and never written as local teacher edits. A newer snapshot can also
// remove a final; missing source metadata keeps the existing repository behavior.
function createImportedFinalGradesView(repository, getFinalGrades) {
  let previous,
    indexed = new Map(),
    assignments = new Set(),
    periods = new Set();
  function state() {
    const source = getFinalGrades();
    if (source !== previous) {
      previous = source;
      indexed = new Map(
        (source?.entries || []).map((entry) => [
          getTermGradeId(entry.termId, entry.assignmentId, entry.studentId),
          entry,
        ]),
      );
      assignments = new Set(source?.assignmentIds || []);
      periods = new Set(source?.periodIds || []);
    }
    return source;
  }
  function applies(source, termId, assignmentId, studentId) {
    return (
      source?.loaded === true &&
      source.studentId === studentId &&
      assignments.has(assignmentId) &&
      periods.has(termId)
    );
  }
  return {
    ...repository,
    getTermGrade(termId, assignmentId, studentId) {
      const source = state();
      if (!applies(source, termId, assignmentId, studentId))
        return repository.getTermGrade(termId, assignmentId, studentId);
      const entry = indexed.get(
        getTermGradeId(termId, assignmentId, studentId),
      );
      return entry ? { ...entry } : null;
    },
    getTermGrades(termId, assignmentId) {
      const source = state();
      const existing = repository.getTermGrades(termId, assignmentId);
      if (!applies(source, termId, assignmentId, source?.studentId))
        return existing;
      return [
        ...existing.filter((entry) => entry.studentId !== source.studentId),
        ...[...indexed.values()]
          .filter(
            (entry) =>
              entry.termId === termId && entry.assignmentId === assignmentId,
          )
          .map((entry) => ({ ...entry })),
      ];
    },
  };
}

export { createImportedFinalGradesView };
