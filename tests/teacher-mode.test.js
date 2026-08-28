import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAssignmentSummary,
  formatRegisterSummary,
  formatStudentCount,
  getRegisterPageTargetIndex,
  getSelectedTerm,
  getTeacherDaySummary,
  parseMaterialInput,
} from "../js/teacher-mode.js";

test("moves date navigation by the currently visible range", () => {
  assert.equal(getRegisterPageTargetIndex("next", [0, 1, 2, 3, 4], 20), 4);
  assert.equal(getRegisterPageTargetIndex("previous", [4, 5, 6, 7, 8], 20), 0);
  assert.equal(getRegisterPageTargetIndex("next", [0, 1], 20), 1);
});

test("normalizes web materials and reports unsafe values", () => {
  assert.deepEqual(
    parseMaterialInput(
      "https://example.test/task\nhttp://example.test/video\njavascript:alert(1)",
    ),
    {
      materials: ["https://example.test/task", "http://example.test/video"],
      invalidCount: 1,
    },
  );
});

test("describes the teacher overview without administrative wording", () => {
  assert.equal(
    getTeacherDaySummary(0),
    "На сегодня занятий нет. Ниже — ваши классы и предметы.",
  );
  assert.equal(
    getTeacherDaySummary(4),
    "Сегодня 4 урока. Ниже — ваши классы и предметы.",
  );
  assert.equal(formatAssignmentSummary(3, 6), "3 класса · 6 журналов");
  assert.equal(formatStudentCount(21), "21 ученик");
  assert.equal(formatRegisterSummary(10, 42), "10 учеников · 42 занятия");
});

test("selects the current term and falls back to the latest term", () => {
  const terms = [
    {
      id: "term-1",
      startsOn: "2026-09-01",
      endsOn: "2026-10-30",
    },
    {
      id: "term-2",
      startsOn: "2026-11-09",
      endsOn: "2026-12-24",
    },
  ];

  assert.equal(getSelectedTerm(terms, "", "2026-09-14")?.id, "term-1");
  assert.equal(getSelectedTerm(terms, "", "2027-08-01")?.id, "term-2");
  assert.equal(getSelectedTerm(terms, "term-1", "2027-08-01")?.id, "term-1");
});
