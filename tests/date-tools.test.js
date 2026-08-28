import assert from "node:assert/strict";
import test from "node:test";
import {
  addIsoDays,
  capitalize,
  createDateTools,
  isIsoDateInRange,
  parseIsoDateParts,
} from "../js/date-tools.js";

const dateTools = createDateTools({
  dayOrder: [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ],
  months: [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
  ],
  weekdays: [
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
    "воскресенье",
  ],
  weekdaysShort: ["пн", "вт", "ср", "чт", "пт", "сб", "вс"],
});

test("parses and serializes local ISO dates without a timezone shift", () => {
  const date = dateTools.parseIsoDate("2026-05-25");

  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 4);
  assert.equal(date.getDate(), 25);
  assert.equal(dateTools.toIsoDate(date), "2026-05-25");
});

test("maps dates and school week days consistently", () => {
  const thursday = dateTools.getDateForDay("2026-05-25", "thursday");

  assert.equal(dateTools.toIsoDate(thursday), "2026-05-28");
  assert.equal(dateTools.getDayKeyByDate(thursday), "thursday");
  assert.equal(dateTools.formatWeekday(thursday), "четверг");
  assert.equal(dateTools.formatWeekday(thursday, "short"), "чт");
});

test("formats diary headings using configured Russian labels", () => {
  const date = dateTools.parseIsoDate("2026-05-25");

  assert.equal(dateTools.formatDateLong(date), "25 мая");
  assert.equal(
    dateTools.formatWeekRange({ start: "2026-05-25", end: "2026-05-31" }),
    "25–31 мая",
  );
  assert.equal(capitalize("понедельник"), "Понедельник");
});

test("keeps both months and years at calendar boundaries", () => {
  assert.equal(
    dateTools.formatWeekRange({ start: "2026-11-30", end: "2026-12-06" }),
    "30 ноября – 6 декабря",
  );
  assert.equal(
    dateTools.formatWeekRange({ start: "2026-12-28", end: "2027-01-03" }),
    "28 декабря 2026 – 3 января 2027",
  );
});

test("calculates the school date in its timezone instead of the device timezone", () => {
  const instant = new Date("2026-08-24T21:30:00.000Z");
  const minskTools = createDateTools({
    dayOrder: [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ],
    timeZone: "Europe/Minsk",
  });
  const newYorkTools = createDateTools({
    dayOrder: [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ],
    timeZone: "America/New_York",
  });

  assert.equal(minskTools.getSchoolDateIso(instant), "2026-08-25");
  assert.equal(newYorkTools.getSchoolDateIso(instant), "2026-08-24");
  assert.equal(minskTools.getDayKeyByIsoDate("2026-08-25"), "tuesday");
});

test("performs calendar arithmetic on date-only values", () => {
  assert.equal(addIsoDays("2026-12-28", 4), "2027-01-01");
  assert.equal(addIsoDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addIsoDays("2026-02-30", 1), "");
  assert.equal(parseIsoDateParts("2026-13-01"), null);
  assert.equal(
    isIsoDateInRange("2026-08-25", "2026-06-01", "2026-08-31"),
    true,
  );
});

test("formats ISO dates without depending on the device timezone", () => {
  assert.equal(dateTools.formatIsoDateLong("2027-01-01"), "1 января");
  assert.equal(dateTools.formatIsoWeekday("2027-01-01", "short"), "пт");
  assert.equal(
    dateTools.getIsoDateForDay("2026-12-28", "friday"),
    "2027-01-01",
  );
});
