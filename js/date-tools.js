const DAY_KEY_BY_JS_DAY = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function createDateTools({
  dayOrder,
  months,
  weekdays,
  weekdaysShort,
  locale = "ru-RU",
  timeZone = "UTC",
}) {
  const schoolTimeZone = normalizeTimeZone(timeZone);

  function getDayKeyByDate(date) {
    return DAY_KEY_BY_JS_DAY[date.getDay()];
  }

  function getDayKeyByIsoDate(value) {
    const parts = parseIsoDateParts(value);
    if (!parts) return "";
    return DAY_KEY_BY_JS_DAY[
      new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
    ];
  }

  function getDateForDay(weekStart, dayKey) {
    return parseIsoDate(getIsoDateForDay(weekStart, dayKey));
  }

  function getIsoDateForDay(weekStart, dayKey) {
    const dayIndex = dayOrder.indexOf(dayKey);
    return dayIndex < 0 ? "" : addIsoDays(weekStart, dayIndex);
  }

  function getSchoolDateIso(instant = new Date()) {
    if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: schoolTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
  }

  function parseIsoDate(value) {
    const parts = parseIsoDateParts(value);
    if (!parts) return new Date(Number.NaN);
    return new Date(parts.year, parts.month - 1, parts.day);
  }

  function toIsoDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatDateLong(date) {
    return `${date.getDate()} ${getMonthName(date)}`;
  }

  function formatIsoDateLong(value) {
    const date = parseIsoDate(value);
    return Number.isNaN(date.getTime()) ? "" : formatDateLong(date);
  }

  function formatWeekRange(week) {
    const start = parseIsoDate(week.start);
    const end = parseIsoDate(week.end);
    const sameMonth =
      start.getMonth() === end.getMonth() &&
      start.getFullYear() === end.getFullYear();
    const sameYear = start.getFullYear() === end.getFullYear();

    if (sameMonth) {
      return `${start.getDate()}–${end.getDate()} ${getMonthName(end)}`;
    }
    if (sameYear) {
      return `${start.getDate()} ${getMonthName(start)} – ${end.getDate()} ${getMonthName(end)}`;
    }
    return `${start.getDate()} ${getMonthName(start)} ${start.getFullYear()} – ${end.getDate()} ${getMonthName(end)} ${end.getFullYear()}`;
  }

  function formatWeekday(date, width = "long") {
    const names = width === "short" ? weekdaysShort : weekdays;
    const dayIndex = (date.getDay() + 6) % 7;
    return (
      names?.[dayIndex] ||
      new Intl.DateTimeFormat(locale, { weekday: width }).format(date)
    );
  }

  function formatIsoWeekday(value, width = "long") {
    const dayKey = getDayKeyByIsoDate(value);
    const dayIndex = dayOrder.indexOf(dayKey);
    const names = width === "short" ? weekdaysShort : weekdays;
    if (dayIndex < 0) return "";
    return names?.[dayIndex] || dayKey;
  }

  function getMonthName(date) {
    return (
      months?.[date.getMonth()] ||
      new Intl.DateTimeFormat(locale, { month: "long" }).format(date)
    );
  }

  return {
    formatDateLong,
    formatIsoDateLong,
    formatIsoWeekday,
    formatWeekRange,
    formatWeekday,
    getDateForDay,
    getDayKeyByDate,
    getDayKeyByIsoDate,
    getIsoDateForDay,
    getSchoolDateIso,
    isIsoDateInRange,
    parseIsoDate,
    timeZone: schoolTimeZone,
    toIsoDate,
  };
}

function addIsoDays(value, amount) {
  const parts = parseIsoDateParts(value);
  if (!parts || !Number.isInteger(amount)) return "";
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + amount),
  );
  return date.toISOString().slice(0, 10);
}

function isIsoDateInRange(value, start, end) {
  return Boolean(
    parseIsoDateParts(value) &&
      parseIsoDateParts(start) &&
      parseIsoDateParts(end) &&
      start <= value &&
      value <= end,
  );
}

function parseIsoDateParts(value) {
  const match = ISO_DATE_PATTERN.exec(String(value || ""));
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function normalizeTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export {
  addIsoDays,
  capitalize,
  createDateTools,
  isIsoDateInRange,
  parseIsoDateParts,
};
