import { addIsoDays, parseIsoDateParts } from "./date-tools.js";

const ROMAN = ["I", "II", "III", "IV"];
function shortAcademicYear(title = "") {
  return title.replace(/\b\d{2}(\d{2})\b/g, "$1");
}
function termLabel(term, index = 0) {
  return `${ROMAN[(term.order || index + 1) - 1] || term.order} четверть`;
}
function completeAcademicWeeks(weeks, year) {
  const terms = getAcademicTerms(year);
  if (!terms.length) return weeks;
  const byStart = new Map(weeks.map((week) => [week.start, week]));
  const result = new Map();

  terms.forEach((term) => {
    const start = parseIsoDateParts(term.startsOn);
    const weekday = new Date(
      Date.UTC(start.year, start.month - 1, start.day),
    ).getUTCDay();
    for (
      let date = addIsoDays(term.startsOn, -((weekday + 6) % 7));
      date <= term.endsOn;
      date = addIsoDays(date, 7)
    ) {
      const existing = byStart.get(date);
      result.set(
        date,
        existing || {
        id: `week_${date}`,
        termId: term.id || "",
        start: date,
        end: addIsoDays(date, 6),
        days: {},
        dayStates: {},
        },
      );
    }
  });

  return [...result.values()].sort((first, second) =>
    first.start.localeCompare(second.start),
  );
}
function findWeekForDate(weeks, date, year) {
  if (!isInstructionDate(year, date)) return -1;
  return weeks.findIndex((week) => week.start <= date && date <= week.end);
}
function getInstructionWeekRange(week, year) {
  const term = getAcademicTerms(year).find(
    (item) => week.start <= item.endsOn && item.startsOn <= week.end,
  );
  if (!term) return { start: week.start, end: week.end };
  return {
    start: week.start < term.startsOn ? term.startsOn : week.start,
    end: week.end > term.endsOn ? term.endsOn : week.end,
  };
}
function isInstructionDate(year, date) {
  if (!parseIsoDateParts(date)) return false;
  const term = getAcademicTerms(year).find(
    (item) => item.startsOn <= date && date <= item.endsOn,
  );
  if (!term) return false;
  return !(year.breaks || []).some(
    (item) => item.startsOn <= date && date <= item.endsOn,
  );
}
function getAcademicTerms(year = {}) {
  return (year.terms || []).filter(
    (term) =>
      parseIsoDateParts(term.startsOn) &&
      parseIsoDateParts(term.endsOn) &&
      term.startsOn <= term.endsOn,
  );
}
export {
  completeAcademicWeeks,
  findWeekForDate,
  getInstructionWeekRange,
  isInstructionDate,
  shortAcademicYear,
  termLabel,
};
