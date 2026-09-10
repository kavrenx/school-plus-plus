import { calculateGradeStats } from "./teacher-journal-model.js";

// Annual results use the academic year ID as the period key in the result repository.
function getSubjectResult(model, store, assignment, studentId) {
  const periods = model.school.academicYear.terms.map((term) => {
    const lessons = model.getLessonsForAssignmentTerm(assignment, term.id)
      .filter((lesson) => lesson.status !== "cancelled");
    const records = lessons.map((lesson) => ({
      lesson,
      entry: store.getJournalEntry(lesson.id, studentId),
    })).filter(({ entry }) => entry && (entry.grades?.length || entry.comment || entry.attendance === "absent"));
    return {
      term,
      records,
      ...calculateGradeStats(records.map(({ entry }) => entry)),
      absent: records.filter(({ entry }) => entry.attendance === "absent").length,
      final: store.getTermGrade(term.id, assignment.id, studentId)?.value || "",
    };
  });
  return {
    assignment,
    periods,
    quarterAverage: calculateGradeStats(periods.map((period) => ({ grades: [period.final] }))).average,
    annual: store.getTermGrade(model.school.academicYear.id, assignment.id, studentId)?.value || "",
  };
}

function getStudentSubjects(model, studentId) {
  const classItem = model.school.classes.find((item) => item.studentIds.includes(studentId));
  if (!classItem) return [];
  const student = model.school.studentsById[studentId];
  const templates = model.lessonTemplates.filter((item) => item.classId === classItem.id &&
    (!item.groupId || student?.groupIds?.includes(item.groupId)));
  const subjects = new Map();
  for (const template of templates) {
    const assignment = model.school.teacherAssignments.find((item) => item.classId === classItem.id &&
      item.subjectId === template.subjectId && (item.groupId || "") === (template.groupId || ""));
    const key = assignment?.id || `${classItem.id}:${template.subjectId}:${template.groupId || ""}`;
    subjects.set(key, {
      ...template,
      ...assignment,
      id: key,
      title: model.school.subjectsById[template.subjectId]?.title || model.subjects.find((item) => item.id === template.subjectId)?.title || template.subjectId,
    });
  }
  return [...subjects.values()].sort((a, b) => a.title.localeCompare(b.title, "ru"));
}

export { getSubjectResult, getStudentSubjects };
