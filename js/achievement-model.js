import { calculateGradeStats } from "./teacher-journal-model.js";
import { getResultColumns } from "./result-periods.js";

// Annual results use the academic year ID as the period key in the result repository.
function getSubjectResult(model, store, assignment, studentId) {
  const assignmentVariants = assignment.variants?.length
    ? assignment.variants
    : [assignment];
  const assignmentIds = [...new Set(assignmentVariants.map((item) => item.id))];
  const getFinal = (periodId) =>
    assignmentIds
      .map((assignmentId) =>
        store.getTermGrade(periodId, assignmentId, studentId)?.value,
      )
      .find((value) => value !== undefined && value !== null && value !== "") ||
    "";
  const periods = model.school.academicYear.terms.map((term) => {
    const lessons = [
      ...new Map(
        assignmentVariants
          .flatMap((item) => model.getLessonsForAssignmentTerm(item, term.id))
          .map((lesson) => [lesson.id, lesson]),
      ).values(),
    ]
      .filter((lesson) => lesson.status !== "cancelled");
    const records = lessons
      .map((lesson) => ({
        lesson,
        entry: store.getJournalEntry(lesson.id, studentId),
      }))
      .filter(
        ({ entry }) =>
          entry &&
          (entry.grades?.length ||
            entry.comment ||
            entry.attendance === "absent"),
      );
    return {
      term,
      lessons,
      records,
      ...calculateGradeStats(records.map(({ entry }) => entry)),
      absent: records.filter(({ entry }) => entry.attendance === "absent")
        .length,
      final: getFinal(term.id),
    };
  });
  return {
    assignment,
    periods,
    quarterAverage: calculateGradeStats(
      periods.map((period) => ({ grades: [period.final] })),
    ).average,
    annual: getFinal(model.school.academicYear.id),
    halfYearFinals: Object.fromEntries(
      getResultColumns(model.school.academicYear)
        .filter((column) => column.type === "half")
        .map((column) => [
          column.id,
          getFinal(column.id),
        ]),
    ),
  };
}

function getStudentSubjects(model, studentId) {
  const classItem = model.school.classes.find((item) =>
    item.studentIds.includes(studentId),
  );
  if (!classItem) return [];
  const student = model.school.studentsById[studentId];
  const templates = (
    model.lessonTemplates.length
      ? model.lessonTemplates
      : model.school.lessonTemplates || []
  ).filter(
    (item) =>
      item.classId === classItem.id &&
      (!item.groupId || student?.groupIds?.includes(item.groupId)),
  );
  const subjects = new Map();
  for (const template of templates) {
    const assignment = model.school.teacherAssignments.find(
      (item) =>
        item.classId === classItem.id &&
        item.subjectId === template.subjectId &&
        (item.groupId || "") === (template.groupId || ""),
    );
    const key = `${classItem.id}:${template.subjectId}`;
    const variant = {
      ...template,
      ...assignment,
      id:
        assignment?.id ||
        `${classItem.id}:${template.subjectId}:${template.groupId || ""}`,
      title:
        model.school.subjectsById[template.subjectId]?.title ||
        model.subjects.find((item) => item.id === template.subjectId)?.title ||
        template.subjectId,
    };
    const current = subjects.get(key);
    if (!current) {
      subjects.set(key, { ...variant, variants: [variant] });
      continue;
    }
    if (!current.variants.some((item) => item.id === variant.id))
      current.variants.push(variant);
  }
  return [...subjects.values()].sort((a, b) =>
    a.title.localeCompare(b.title, "ru"),
  );
}

function calculateGradeGoal(grades, target, remainingLessons) {
  const numericGrades = grades.map(Number).filter(isNumericGrade);
  const desired = Number(target);
  const available = Math.max(0, Math.floor(Number(remainingLessons) || 0));
  if (!Number.isInteger(desired) || desired < 1 || desired > 10) {
    return { status: "invalid" };
  }

  const currentAverage = numericGrades.length
    ? numericGrades.reduce((sum, grade) => sum + grade, 0) /
      numericGrades.length
    : null;
  const threshold = desired === 1 ? 1 : desired - 0.5;
  if (currentAverage !== null && currentAverage >= threshold) {
    return { status: "reached", currentAverage, target: desired };
  }

  const currentSum = numericGrades.reduce((sum, grade) => sum + grade, 0);
  for (let count = 1; count <= available; count += 1) {
    const requiredSum = Math.ceil(
      threshold * (numericGrades.length + count) - currentSum,
    );
    if (requiredSum > count * 10) continue;
    const safeSum = Math.max(count, requiredSum);
    const base = Math.floor(safeSum / count);
    const higherGrades = safeSum % count;
    const suggestedGrades = Array.from({ length: count }, (_, index) =>
      index < higherGrades ? base + 1 : base,
    ).sort((first, second) => first - second);
    if (suggestedGrades.every(isNumericGrade)) {
      const projectedAverage =
        (currentSum + suggestedGrades.reduce((sum, grade) => sum + grade, 0)) /
        (numericGrades.length + count);
      return {
        status: "possible",
        target: desired,
        suggestedGrades,
        projectedAverage,
        remainingLessons: available,
      };
    }
  }

  const bestAverage =
    available > 0
      ? (currentSum + available * 10) / (numericGrades.length + available)
      : currentAverage;
  return {
    status: "impossible",
    target: desired,
    remainingLessons: available,
    bestAverage,
  };
}

function isNumericGrade(value) {
  const grade = Number(value);
  return Number.isInteger(grade) && grade >= 1 && grade <= 10;
}

export { calculateGradeGoal, getSubjectResult, getStudentSubjects };
