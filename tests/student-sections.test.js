import assert from "node:assert/strict";
import test from "node:test";
import {
  completeAcademicWeeks,
  findWeekForDate,
  shortAcademicYear,
  termLabel,
} from "../js/academic-navigation.js";
import {
  getResultColumns,
  getResultDisplayColumns,
  getEffectiveResultColumn,
  getDisplayFinalAverage,
  getCurrentResultPeriod,
  getResultCell,
  getFinalAverage,
} from "../js/result-periods.js";
import { renderAchievementTable } from "../js/achievement-view.js";
import {
  holidayDuration,
  orderBellSchedules,
  renderStudentSchedule,
} from "../js/student-schedule.js";

const year = {
  id: "year",
  title: "2026/2027",
  startsOn: "2026-09-01",
  endsOn: "2027-08-31",
  terms: [1, 2, 3, 4].map((n) => ({ id: `q${n}`, order: n })),
};
function result(finals = {}, assessmentPeriod = "quarter") {
  return {
    assignment: { title: "Математика", assessmentPeriod },
    annual: finals.year || "",
    halfYearFinals: { year_half_1: finals.half || "" },
    periods: year.terms.map((term, index) => ({
      term,
      final: finals[term.id] || "",
      records: [
        {
          lesson: { id: `lesson-${index}`, date: `2026-09-0${index + 1}` },
          entry: {
            grades: index === 0 ? ["8", "10"] : index === 1 ? ["6"] : [],
          },
        },
      ],
    })),
  };
}

test("academic calendar includes all summer dates and rejects dates outside the year", () => {
  const weeks = completeAcademicWeeks([], year);
  assert.equal(findWeekForDate(weeks, "2026-08-31", year), -1);
  assert.equal(findWeekForDate(weeks, "2027-09-01", year), -1);
  assert.ok(findWeekForDate(weeks, "2027-08-31", year) >= 0);
  assert.ok(findWeekForDate(weeks, "2026-11-04", year) >= 0);
  assert.equal(shortAcademicYear(year.title), "26/27");
  assert.equal(termLabel(year.terms[2]), "III четверть");
});

test("half year average weights individual grades and keeps final marks separate", () => {
  const columns = getResultColumns(year);
  assert.equal(columns.length, 7);
  const half = columns[2];
  assert.deepEqual(getResultCell(result({ half: "9" }), half), {
    final: "9",
    average: 8,
  });
  assert.equal(getResultCell(result(), columns.at(-1)).average, 8);
  assert.equal(
    getFinalAverage(
      [result({ q1: "8" }), result({ q1: "10" }), result()],
      columns[0],
    ),
    9,
  );
  assert.equal(getFinalAverage([result()], columns[0]), null);
  const display = getResultDisplayColumns(year);
  const halfYearResult = result({ half: "9" }, "half-year");
  assert.equal(getEffectiveResultColumn(halfYearResult, display[0]), null);
  assert.equal(
    getEffectiveResultColumn(halfYearResult, display[1]).type,
    "half",
  );
  assert.equal(getDisplayFinalAverage([halfYearResult], display[1]), 9);
});

test("result table displays final or forecast, behavior and subject links", () => {
  const html = renderAchievementTable([result({ q1: "7" })], year, {
    q1: "хорошее",
  });
  assert.ok(html.includes("<strong>7</strong>"));
  assert.ok(html.includes('class="result-forecast"'));
  assert.ok(html.includes("хорошее"));
  assert.ok(html.includes("Средний балл"));
  assert.equal(html.includes("data-achievement-subject"), true);
  assert.equal((html.match(/result-period-value/g) || []).length, 15);
});

test("half-year subjects use two periods instead of quarter duplicates", () => {
  const html = renderAchievementTable(
    [result({ q1: "2", q2: "3", half: "9" }, "half-year")],
    year,
  );
  assert.equal(html.includes("<strong>2</strong>"), false);
  assert.equal(html.includes("<strong>3</strong>"), false);
  assert.ok(html.includes("<strong>9</strong>"));
  const current = getCurrentResultPeriod(
    result({}, "half-year"),
    year,
    "q2",
    "2026-12-01",
  );
  assert.equal(current.title, "I полугодие");
  assert.deepEqual(current.grades, [8, 10, 6]);
});

test("holiday length is inclusive and preferred shift comes first", () => {
  assert.equal(holidayDuration("2026-12-25", "2027-01-10"), 17);
  assert.equal(holidayDuration("2027-01-10", "2026-12-25"), null);
  const shifts = [
    { id: "first", order: 1 },
    { id: "second", order: 2 },
  ];
  assert.equal(orderBellSchedules(shifts, "second")[0].id, "second");
  assert.equal(shifts[0].id, "first");
});

test("schedule renders supplied restrictions and escapes source content", () => {
  const model = {
    school: {
      academicYear: year,
      schedule: {
        holidays: [
          {
            title: "<Осенние>",
            startsOn: "2026-11-01",
            endsOn: "2026-11-08",
            applicability: "Для 1–2 классов",
          },
        ],
      },
    },
  };
  const html = renderStudentSchedule(model, { id: "s" }, "holidays", {
    formatIsoDateLong: (date) => date,
  });
  assert.ok(html.includes("&lt;Осенние&gt;"));
  assert.ok(html.includes("Для 1–2 классов"));
  assert.ok(html.includes("8 дней"));
});

test("schedule preserves lesson zero, merges group lines and shortens subjects", () => {
  const model = {
    school: {
      academicYear: year,
      schedule: {
        bellSchedules: [
          {
            id: "second",
            order: 2,
            title: "2 смена",
            variants: [
              {
                title: "пн, вт",
                lessons: [{ number: 0, startsAt: "13:05", endsAt: "13:50" }],
              },
            ],
          },
        ],
        lessonSchedule: [
          {
            id: "monday",
            title: "Понедельник",
            lessons: [
              {
                time: "10:00–10:45",
                subject: "Иностранный язык",
                groups: [
                  { teacher: "Первый учитель", room: "85" },
                  { teacher: "Второй учитель", room: "28" },
                ],
              },
            ],
          },
          { id: "saturday", title: "Суббота", lessons: [] },
        ],
      },
    },
  };
  const user = { id: "s", classId: "class" };
  const bells = renderStudentSchedule(model, user, "bells", {});
  assert.match(bells, /<td>0<\/td>/);
  const lessons = renderStudentSchedule(model, user, "lessons", {});
  assert.ok(lessons.includes("Англ. язык"));
  assert.ok(lessons.includes("Первый учитель"));
  assert.ok(lessons.includes("Второй учитель"));
  assert.equal(lessons.includes("Суббота"), false);
});
