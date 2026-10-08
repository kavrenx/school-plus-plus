import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateGradeOptions,
  getSubjectAnalytics,
  projectGrades,
} from "../js/subject-analytics.js";

test("analytics preserves paired marks, counts duplicates and orders lessons by date", () => {
  const stats = getSubjectAnalytics([
    { lesson: { id: "b", date: "2026-09-30" }, entry: { grades: ["9", "9"] } },
    { lesson: { id: "a", date: "2026-09-16" }, entry: { grades: ["8", "9"] } },
    {
      lesson: { id: "c", date: "2026-10-01" },
      entry: { grades: ["зачёт", "Н"] },
    },
  ]);
  assert.equal(stats.count, 4);
  assert.equal(stats.average, 8.75);
  assert.deepEqual(
    stats.points.map((point) => point.grades),
    [
      [8, 9],
      [9, 9],
    ],
  );
  assert.equal(stats.points[0].average, 8.5);
  assert.equal(stats.distribution.find((item) => item.grade === 9).count, 3);
  assert.equal(getSubjectAnalytics([]).average, null);
});

test("recent average uses the last five individual marks without overwriting full average", () => {
  const stats = getSubjectAnalytics(
    [1, 2, 3, 8, 9, 10].map((grade, index) => ({
      lesson: { id: String(index), date: `2026-09-0${index + 1}` },
      entry: { grades: [grade] },
    })),
  );
  assert.equal(stats.recentCount, 5);
  assert.equal(stats.recentAverage, 6.4);
  assert.equal(stats.average, 5.5);
});

test("rounded and exact targets produce different valid plans", () => {
  const rounded = calculateGradeOptions([8], 9, 2);
  const exact = calculateGradeOptions([8], 9, 2, "exact");
  assert.deepEqual(rounded.options[0].grades, [9]);
  assert.deepEqual(exact.options[0].grades, [10]);
  assert.equal(calculateGradeOptions([9], 9, 2).status, "reached");
  assert.equal(calculateGradeOptions([2, 2], 10, 2).status, "impossible");
  assert.equal(calculateGradeOptions([], 9, 0).status, "impossible");
  assert.equal(calculateGradeOptions([], 0, 2).status, "invalid");
});

test("all proposed combinations meet the target and the first needs the fewest marks", () => {
  for (const grades of [[], [3, 4], [7, 8, 9, 9], [9, 9]]) {
    for (let target = 1; target <= 10; target++) {
      for (const mode of ["rounded", "exact"]) {
        const plan = calculateGradeOptions(grades, target, 20, mode);
        if (plan.status !== "possible") continue;
        assert.ok(plan.options.length <= 5);
        assert.equal(
          new Set(plan.options.map((item) => item.grades.join(","))).size,
          plan.options.length,
        );
        for (const option of plan.options) {
          assert.ok(option.grades.length <= 20);
          assert.ok(
            option.grades.every(
              (grade) => Number.isInteger(grade) && grade >= 1 && grade <= 10,
            ),
          );
          const result = projectGrades(grades, option.grades);
          assert.ok(result.projectedAverage >= plan.threshold - 1e-10);
          assert.equal(result.projectedAverage, option.projectedAverage);
        }
        const sum = grades.reduce((total, grade) => total + grade, 0);
        for (let count = 1; count < plan.options[0].count; count++)
          assert.ok(
            (sum + count * 10) / (grades.length + count) < plan.threshold,
          );
      }
    }
  }
});

test("trying marks is reversible and does not mutate imported grades", () => {
  const grades = [6, 8];
  assert.equal(projectGrades(grades, [10, 10]).projectedAverage, 8.5);
  assert.equal(projectGrades(grades, []).projectedAverage, 7);
  assert.deepEqual(grades, [6, 8]);
});
