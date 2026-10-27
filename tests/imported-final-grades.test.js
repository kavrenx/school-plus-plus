import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { adaptESchoolsSnapshot } from "../js/e-schools-adapter.js";
import { normalizeDiaryData } from "../js/diary-model.js";
import {
  getSubjectResult,
  getStudentSubjects,
} from "../js/achievement-model.js";
import { createJournalStore } from "../js/journal-store.js";
import { createImportedFinalGradesView } from "../js/imported-final-grades.js";
import { renderAchievementTable } from "../js/achievement-view.js";
import {
  getResultDisplayColumns,
  getResultCell,
} from "../js/result-periods.js";
import { DAY_ORDER } from "../js/app-config.js";

const root = "/api/v1/education/diary/schools/school-src";
const finalPath = `${root}/classes/class-src/students/student-src/final/whole`;
const at = (date) => Date.parse(`${date}T00:00:00Z`) / 1000;
function snapshot(
  marks = {},
  { status = 200, path = finalPath, missing = false } = {},
) {
  const record = (url, body) => ({ url, method: "GET", status: 200, body });
  return {
    schemaVersion: 1,
    source: "e-schools.by",
    capturedAt: "2026-10-27T12:00:00Z",
    pages: {
      diary: {
        studentIdentity: { classTitle: "8 Б", name: "Тестов Алексей Текущие" },
      },
    },
    network: {
      subjects: record(
        `${root}/students/student-src/classes/class-src/subjects`,
        [
          { id: "math-src", subject_title: "Математика" },
          { id: "art-src", subject_title: "Искусство" },
        ],
      ),
      educational: record(`${root}/students/student-src/educational_subjects`, [
        { uuid: "math-alias", name: "Математика" },
        { uuid: "art-alias", name: "Искусство" },
      ]),
      year: record("/api/v1/education/diary/school_year", {
        uuid: "year-src",
        label: "2026/2027",
        start_ts: at("2026-09-01"),
        end_ts: at("2027-08-31"),
      }),
      terms: record(
        "/api/v1/education/diary/time_activities",
        [
          ["2026-09-01", "2026-10-31"],
          ["2026-11-01", "2026-12-31"],
          ["2027-01-01", "2027-03-31"],
          ["2027-04-01", "2027-05-31"],
        ].map(([start, end], index) => ({
          uuid: `quarter-${index + 1}`,
          title: `${index + 1} четверть`,
          type: "quarter",
          start_date: at(start),
          end_date: at(end),
        })),
      ),
      planning: record(
        `/api/v1/education/planning/classes/class-src/educational_subjects`,
        [
          {
            uuid: "math-plan",
            school_subject: {
              as_json: {
                subject: {
                  as_json: { uuid: "math-catalog", value: "Математика" },
                },
              },
            },
            templates: [{ uuid: "math-template", study_hours: 1 }],
          },
          {
            uuid: "art-plan",
            school_subject: {
              as_json: { subject: { as_json: { value: "Искусство" } } },
            },
            templates: [{ uuid: "art-template", study_hours: 1 }],
          },
        ],
      ),
      lessons: record(
        `${root}/classes/class-src/students/student-src/lessons?week_activity_uuid=week-src`,
        [
          {
            date: at("2026-09-15"),
            day_of_week: 2,
            slots: [
              {
                lesson_uuid: "lesson-src",
                lesson_template_id: "math-template",
                subject_title: "Математика",
                number: 1,
                lesson_mark: { mark: "9/9" },
              },
              {
                lesson_uuid: "art-lesson-src",
                lesson_template_id: "art-template",
                subject_title: "Искусство",
                number: 2,
              },
            ],
          },
        ],
      ),
      ...(!missing
        ? {
            final: {
              ...record(path, { marks, behaviour: {}, diary_signature: {} }),
              status,
            },
          }
        : {}),
    },
  };
}
const final = (mark, subject_id = "math-alias") => ({
  mark,
  subject_id,
  kind: "final",
  type: "period",
  uuid: "synthetic-final",
});
function fixture(input) {
  const adapted = adaptESchoolsSnapshot(input);
  const values = new Map();
  const store = createJournalStore({
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  });
  store.saveJournalEntries(adapted.journalEntries);
  let current = adapted.finalGrades;
  const view = createImportedFinalGradesView(store, () => current);
  const model = normalizeDiaryData(adapted.diary, DAY_ORDER, adapted.school);
  const subjects = getStudentSubjects(model, "student_demo");
  const results = () =>
    subjects.map((subject) =>
      getSubjectResult(model, view, subject, "student_demo"),
    );
  return {
    adapted,
    store,
    view,
    model,
    subjects,
    results,
    setSource(value) {
      current = value;
    },
  };
}

test("official FIRST_QUARTER replaces the forecast through adapter, model, read view and table", () => {
  const input = snapshot({ "math-alias": { FIRST_QUARTER: final("7") } });
  const before = JSON.stringify(input);
  const f = fixture(input);
  const result = f
    .results()
    .find((item) => item.assignment.title === "Математика");
  assert.equal(result.periods[0].final, "7");
  assert.equal(result.periods[0].average, 9);
  assert.equal(
    result.assignment.assessmentPeriod,
    "quarter",
    "actual quarter final overrides once-weekly heuristic",
  );
  assert.equal(
    f.store.getTermGrade("quarter-1", result.assignment.id, "student_demo"),
    null,
    "not a persisted teacher edit",
  );
  const window = new Window();
  try {
    window.document.body.innerHTML = renderAchievementTable(
      f.results(),
      f.model.school.academicYear,
    );
    const row = window.document
      .querySelector(`[data-achievement-subject="${result.assignment.id}"]`)
      .closest("tr");
    assert.equal(row.querySelector("td strong").textContent, "7");
    assert.equal(
      row.querySelector("td").querySelector(".result-forecast"),
      null,
    );
    assert.equal(
      window.document.querySelector(".result-summary td strong").textContent,
      "7,0",
    );
  } finally {
    window.close();
  }
  assert.equal(JSON.stringify(input), before);
});

test("half-year, annual and pass/fail final periods preserve their existing IDs and values", () => {
  const f = fixture(
    snapshot({
      "math-plan": {
        FIRST_HALF_YEAR: final("8", "math-plan"),
        YEAR: final("9", "math-plan"),
      },
      "art-src": { FIRST_QUARTER: final("ЗАЧЕТ", "art-src") },
    }),
  );
  const results = f.results();
  const math = results.find((item) => item.assignment.title === "Математика");
  const art = results.find((item) => item.assignment.title === "Искусство");
  const columns = getResultDisplayColumns(f.model.school.academicYear);
  assert.equal(math.assignment.assessmentPeriod, "half-year");
  assert.equal(getResultCell(math, columns[1].half).final, "8");
  assert.equal(math.annual, "9");
  assert.equal(art.periods[0].final, "зачёт");
});

test("foreign student, failed request and missing final data do not become authoritative", () => {
  for (const options of [
    { path: finalPath.replace("student-src", "other-student") },
    { path: finalPath.replace("class-src", "other-class") },
    { path: `https://example.invalid${finalPath}` },
    { status: 500 },
    { missing: true },
  ])
    assert.equal(
      adaptESchoolsSnapshot(
        snapshot({ "math-src": { FIRST_QUARTER: final("7") } }, options),
      ).finalGrades,
      null,
    );
});

test("unknown subject, period, out-of-range and malformed marks are not invented as finals", () => {
  const f = fixture(
    snapshot({
      unknown: { FIRST_QUARTER: final("7", "unknown") },
      "math-src": {
        FIFTH_QUARTER: final("7"),
        FIRST_QUARTER: final("11"),
        SECOND_QUARTER: null,
      },
    }),
  );
  assert.deepEqual(f.adapted.finalGrades.entries, []);
  assert.equal(f.adapted.finalGrades.loaded, true);
});

test("source refresh and removal invalidate the read view without modifying unrelated local finals", () => {
  const f = fixture(snapshot({ "math-src": { FIRST_QUARTER: final("7") } }));
  const assignment = f.subjects.find((item) => item.title === "Математика").id;
  f.store.saveTermGrade({
    termId: "quarter-1",
    assignmentId: assignment,
    studentId: "student_demo",
    value: "5",
  });
  f.store.saveTermGrade({
    termId: "quarter-1",
    assignmentId: assignment,
    studentId: "other-student",
    value: "6",
  });
  assert.equal(
    f.view.getTermGrade("quarter-1", assignment, "student_demo").value,
    "7",
  );
  f.setSource({
    ...f.adapted.finalGrades,
    entries: f.adapted.finalGrades.entries.map((entry) => ({
      ...entry,
      value: "8",
    })),
  });
  assert.equal(
    f.view.getTermGrade("quarter-1", assignment, "student_demo").value,
    "8",
  );
  const received = f.view.getTermGrade("quarter-1", assignment, "student_demo");
  received.value = "1";
  assert.equal(
    f.view.getTermGrade("quarter-1", assignment, "student_demo").value,
    "8",
  );
  f.setSource({ ...f.adapted.finalGrades, entries: [] });
  assert.equal(
    f.view.getTermGrade("quarter-1", assignment, "student_demo"),
    null,
  );
  assert.equal(
    f.store.getTermGrade("quarter-1", assignment, "student_demo").value,
    "5",
  );
  assert.equal(
    f.view.getTermGrade("quarter-1", assignment, "other-student").value,
    "6",
  );
  assert.deepEqual(
    f.view.getTermGrades("quarter-1", assignment).map((item) => item.studentId),
    ["other-student"],
  );
  f.setSource(null);
  assert.equal(
    f.view.getTermGrade("quarter-1", assignment, "student_demo").value,
    "5",
  );
});

test("subjects without source assignments use the existing template assignment fallback", () => {
  const input = snapshot({
    "math-plan": { FIRST_QUARTER: final("7", "math-plan") },
  });
  input.network.subjects.body = [];
  const f = fixture(input);
  const result = f
    .results()
    .find((item) => item.assignment.title === "Математика");
  assert.ok(result);
  assert.equal(result.periods[0].final, "7");
});

test("catalog subject IDs in final marks resolve to the same canonical assignment", () => {
  const f = fixture(
    snapshot({
      "math-catalog": { FIRST_QUARTER: final("7", "math-catalog") },
    }),
  );
  assert.equal(
    f.results().find((item) => item.assignment.title === "Математика")
      .periods[0].final,
    "7",
  );
});
