import { calculateGradeStats } from "./teacher-journal-model.js";

function getResultColumns(year) {
  const terms = year.terms;
  const halves = [0, 1].map((index) => ({
    id: year.halfYears?.[index]?.id || `${year.id}_half_${index + 1}`,
    label: index === 0 ? "I" : "II",
    type: "half",
    termIds: terms.slice(index * 2, index * 2 + 2).map((term) => term.id),
  }));
  const quarters = terms.map((term, index) => ({
    id: term.id,
    label: ["I", "II", "III", "IV"][index],
    type: "quarter",
    termIds: [term.id],
  }));
  return [
    ...quarters.slice(0, 2),
    halves[0],
    ...quarters.slice(2),
    halves[1],
    {
      id: year.id,
      label: "Год",
      type: "year",
      termIds: terms.map((term) => term.id),
    },
  ];
}
function getResultCell(result, column) {
  const periods = result.periods.filter((period) =>
    column.termIds.includes(period.term.id),
  );
  const final =
    column.type === "quarter"
      ? periods[0]?.final
      : column.type === "year"
        ? result.annual
        : result.halfYearFinals?.[column.id];
  const entries = periods.flatMap((period) =>
    period.records.map((record) => record.entry),
  );
  return { final: final ?? "", average: calculateGradeStats(entries).average };
}
function getResultDisplayColumns(year) {
  const columns = getResultColumns(year);
  return columns
    .filter((column) => column.type !== "half")
    .map((column) => ({
      ...column,
      half: columns.find(
        (item) => item.type === "half" && item.termIds.at(-1) === column.id,
      ),
    }));
}
function isHalfYearSubject(result) {
  const value =
    result.assignment.assessmentPeriod ||
    result.assignment.reportingPeriod ||
    result.assignment.gradingPeriod ||
    "quarter";
  return ["half-year", "halfYear", "half", "semester"].includes(value);
}
function getCurrentResultPeriod(result, year, currentTermId, todayIso = "") {
  const columns = getResultColumns(year);
  const currentTerm =
    year.terms.find((term) => term.id === currentTermId) || year.terms[0];
  if (!currentTerm) return null;

  const column = isHalfYearSubject(result)
    ? columns.find(
        (item) =>
          item.type === "half" && item.termIds.includes(currentTerm.id),
      )
    : columns.find(
        (item) =>
          item.type === "quarter" && item.termIds.includes(currentTerm.id),
      );
  if (!column) return null;

  const periods = result.periods.filter((period) =>
    column.termIds.includes(period.term.id),
  );
  const records = periods
    .flatMap((period) => period.records)
    .sort((first, second) =>
      `${first.lesson.date}_${first.lesson.startsAt || ""}`.localeCompare(
        `${second.lesson.date}_${second.lesson.startsAt || ""}`,
      ),
    );
  const lessons = periods
    .flatMap((period) => period.lessons || [])
    .sort((first, second) =>
      `${first.date}_${first.startsAt || ""}`.localeCompare(
        `${second.date}_${second.startsAt || ""}`,
      ),
    );
  const completedLessonIds = new Set(records.map(({ lesson }) => lesson.id));
  const remainingLessons = lessons.filter(
    (lesson) =>
      (!todayIso || lesson.date >= todayIso) &&
      !completedLessonIds.has(lesson.id),
  );
  const grades = records.flatMap(({ entry }) =>
    (entry.grades || []).filter(isNumericGrade).map(Number),
  );

  return {
    column,
    title: `${column.label} ${column.type === "half" ? "полугодие" : "четверть"}`,
    records,
    grades,
    lessons,
    remainingLessons,
    average: calculateGradeStats([{ grades }]).average,
  };
}

function isNumericGrade(value) {
  const grade = Number(value);
  return Number.isInteger(grade) && grade >= 1 && grade <= 10;
}
function getEffectiveResultColumn(result, displayColumn) {
  if (displayColumn.type === "year") return displayColumn;
  if (!isHalfYearSubject(result)) return displayColumn;
  return displayColumn.half || null;
}
function getDisplayFinalAverage(results, displayColumn) {
  return calculateGradeStats(
    results.map((result) => {
      const column = getEffectiveResultColumn(result, displayColumn);
      return { grades: [column ? getResultCell(result, column).final : ""] };
    }),
  ).average;
}
function getFinalAverage(results, column) {
  return calculateGradeStats(
    results.map((result) => ({
      grades: [getResultCell(result, column).final],
    })),
  ).average;
}
export {
  getResultColumns,
  getResultDisplayColumns,
  getEffectiveResultColumn,
  getDisplayFinalAverage,
  getResultCell,
  getFinalAverage,
  getCurrentResultPeriod,
};
