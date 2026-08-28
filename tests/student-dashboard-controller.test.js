import assert from "node:assert/strict";
import test from "node:test";
import {
  findInitialDayKey,
  findInitialTermId,
  findInitialWeekIndex,
  findInitialWeekIndexForTerm,
  getWeekIndexesForTerm,
  getDayPresentation,
  getDayTabTargetIndex,
  getHeroDescriptionKey,
  resolveDayState,
  shouldExpandAccountDetails,
} from "../js/student-dashboard-controller.js";

const weeks = [
  { start: "2026-05-18", end: "2026-05-24" },
  { start: "2026-05-25", end: "2026-05-31" },
];

test("selects the week containing the current date", () => {
  assert.equal(findInitialWeekIndex(weeks, "2026-05-27"), 1);
  assert.equal(findInitialWeekIndex(weeks, "2026-08-24"), 0);
});

test("selects a quarter and keeps week navigation inside it", () => {
  const terms = [
    { id: "term-1", startsOn: "2025-09-01", endsOn: "2025-10-31" },
    { id: "term-2", startsOn: "2025-11-10", endsOn: "2025-12-24" },
  ];
  const termWeeks = [
    { termId: "term-1", start: "2025-09-01", end: "2025-09-07" },
    { termId: "term-1", start: "2025-09-08", end: "2025-09-14" },
    { termId: "term-2", start: "2025-11-10", end: "2025-11-16" },
  ];

  assert.equal(findInitialTermId(terms, "2025-09-03"), "term-1");
  assert.equal(findInitialTermId(terms, "2026-01-10"), "term-2");
  assert.deepEqual(getWeekIndexesForTerm(termWeeks, terms[0]), [0, 1]);
  assert.equal(findInitialWeekIndexForTerm(termWeeks, [0, 1], "2026-01-10"), 1);
});

test("selects today only when it belongs to the displayed week", () => {
  assert.equal(
    findInitialDayKey(weeks[1], "2026-05-27", "wednesday"),
    "wednesday",
  );
  assert.equal(findInitialDayKey(weeks[1], "2026-08-24", "monday"), "monday");
  assert.equal(findInitialDayKey(null, "2026-05-27", "wednesday"), "monday");
});

test("does not turn an empty weekday into weekend entertainment", () => {
  const week = {
    dayStates: {
      monday: { type: "empty" },
      saturday: { type: "weekend" },
    },
  };

  assert.equal(resolveDayState(week, "monday", []).type, "empty");
  assert.equal(resolveDayState(week, "saturday", []).type, "weekend");
});

test("keeps the weekend message concise", () => {
  const presentation = getDayPresentation(
    { type: "weekend" },
    [],
    (key) => key,
  );

  assert.deepEqual(presentation, { note: "В этот день уроков нет." });
});

test("moves through day tabs with standard keyboard controls", () => {
  assert.equal(getDayTabTargetIndex(0, "ArrowRight", 7), 1);
  assert.equal(getDayTabTargetIndex(0, "ArrowLeft", 7), 6);
  assert.equal(getDayTabTargetIndex(3, "Home", 7), 0);
  assert.equal(getDayTabTargetIndex(3, "End", 7), 6);
  assert.equal(getDayTabTargetIndex(3, "Enter", 7), null);
});

test("collapses account details only in the compact phone layout", () => {
  assert.equal(shouldExpandAccountDetails(true), false);
  assert.equal(shouldExpandAccountDetails(false), true);
});

test("gives the first school day its own playful caption", () => {
  assert.equal(
    getHeroDescriptionKey("2026-09-01", false, true),
    "firstSeptember",
  );
  assert.equal(getHeroDescriptionKey("2026-08-31", true, false), "summerBreak");
  assert.equal(getHeroDescriptionKey("2026-09-02", false, true), "schoolDay");
});
