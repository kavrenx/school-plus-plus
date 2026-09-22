import { addIsoDays, parseIsoDateParts } from "./date-tools.js";

const ROMAN = ["I", "II", "III", "IV"];
function shortAcademicYear(title = "") {
  return title.replace(/\b\d{2}(\d{2})\b/g, "$1");
}
function termLabel(term, index = 0) {
  return `${ROMAN[(term.order || index + 1) - 1] || term.order} четверть`;
}
function completeAcademicWeeks(weeks, year) {
  const start = parseIsoDateParts(year.startsOn);
  if (!start || !parseIsoDateParts(year.endsOn)) return weeks;
  const weekday = new Date(
    Date.UTC(start.year, start.month - 1, start.day),
  ).getUTCDay();
  const byStart = new Map(weeks.map((week) => [week.start, week]));
  const result = [];
  for (
    let date = addIsoDays(year.startsOn, -((weekday + 6) % 7));
    date <= year.endsOn;
    date = addIsoDays(date, 7)
  ) {
    result.push(
      byStart.get(date) || {
        id: `week_${date}`,
        start: date,
        end: addIsoDays(date, 6),
        days: {},
        dayStates: {},
      },
    );
  }
  return result;
}
function findWeekForDate(weeks, date, year) {
  if (!parseIsoDateParts(date) || date < year.startsOn || date > year.endsOn)
    return -1;
  return weeks.findIndex((week) => week.start <= date && date <= week.end);
}
export { completeAcademicWeeks, findWeekForDate, shortAcademicYear, termLabel };
