import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateGradeGoal,
  getSubjectResult,
  getStudentSubjects,
} from "../js/achievement-model.js";
import { createJournalStore } from "../js/journal-store.js";
import {
  renderAchievementTable,
  renderGradeGoalResult,
  renderSubjectDetails,
} from "../js/achievement-view.js";
import { getCurrentResultPeriod } from "../js/result-periods.js";

function fixture() {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key),
    setItem: (key, value) => {
      data.set(key, value);
      return true;
    },
  };
  const store = createJournalStore(storage);
  const terms = [1, 2, 3, 4].map((n) => ({
    id: `q${n}`,
    title: `${n} четверть`,
  }));
  const model = {
    school: { academicYear: { id: "year", title: "2026/2027", terms } },
    getLessonsForAssignmentTerm: (_assignment, id) =>
      id === "q1"
        ? [
            { id: "l1", date: "2026-09-01", startsAt: "09:00" },
            { id: "l2", date: "2026-09-02", startsAt: "09:00" },
            { id: "l3", date: "2026-09-03", status: "cancelled" },
            { id: "l4", date: "2026-09-04", startsAt: "09:00" },
          ]
        : [],
  };
  return {
    model,
    store,
    storage,
    assignment: { id: "math", title: "<Математика>" },
  };
}

test("subject report counts both grades, excludes cancelled lessons and separates absence", () => {
  const { model, store, assignment } = fixture();
  store.saveJournalEntry({
    lessonId: "l1",
    studentId: "s",
    grades: ["8", "9"],
    comment: "<script>",
  });
  store.saveJournalEntry({
    lessonId: "l2",
    studentId: "s",
    attendance: "absent",
  });
  store.saveJournalEntry({ lessonId: "l3", studentId: "s", grades: ["1"] });
  store.saveJournalEntry({ lessonId: "l4", studentId: "s", grades: ["зачёт"] });
  const result = getSubjectResult(model, store, assignment, "s");
  assert.equal(result.periods[0].count, 2);
  assert.equal(result.periods[0].average, 8.5);
  assert.equal(result.periods[0].absent, 1);
  assert.equal(result.periods[0].records.length, 3);
  assert.equal(result.periods[1].average, null);
  assert.equal(result.annual, "");
  const period = getCurrentResultPeriod(
    result,
    model.school.academicYear,
    "q1",
    "2026-09-02",
  );
  const html = renderSubjectDetails(result, period, {
    formatIsoDateLong: (date) => date,
  });
  assert.ok(html.includes("&lt;Математика&gt; <span>•</span> I четверть"));
  assert.match(html, /grade-tone-high[^>]*>[\s\S]*?<strong>8<\/strong>/);
  assert.match(html, /grade-tone-high[^>]*>[\s\S]*?<strong>9<\/strong>/);
  assert.ok(html.includes("2026-09-01"));
  assert.equal(html.includes("Пропуск"), false);
  assert.equal(html.includes("&lt;script&gt;"), false);
  assert.equal(period.remainingLessons.length, 0);
});

test("annual result persists separately and is never inferred from averages", () => {
  const { model, store, storage, assignment } = fixture();
  for (const [termId, value] of [
    ["q1", "8"],
    ["q2", "9"],
    ["q3", "зачёт"],
    ["year", "9"],
  ]) {
    store.saveTermGrade({
      termId,
      assignmentId: "math",
      studentId: "s",
      value,
    });
  }
  const result = getSubjectResult(
    model,
    createJournalStore(storage),
    assignment,
    "s",
  );
  assert.equal(result.quarterAverage, 8.5);
  assert.equal(result.annual, "9");
  assert.equal(result.periods[0].final, "8");
  const html = renderAchievementTable([result], model.school.academicYear);
  assert.ok(html.includes("&lt;Математика&gt;"));
  assert.ok(html.includes("Успеваемость 2026/2027"));
  assert.equal(html.includes("data-achievement-subject"), true);
  assert.equal(html.includes("Среднее<br>четвертных"), false);
  assert.equal(getSubjectResult(model, store, assignment, "other").annual, "");
  store.saveTermGrade({
    termId: "year",
    assignmentId: "math",
    studentId: "s",
    value: "",
  });
  assert.equal(getSubjectResult(model, store, assignment, "s").annual, "");
});

test("grade goal uses no more future grades than scheduled lessons", () => {
  assert.deepEqual(calculateGradeGoal([8], 9, 2), {
    status: "possible",
    target: 9,
    suggestedGrades: [9],
    projectedAverage: 8.5,
    remainingLessons: 2,
  });
  const impossible = calculateGradeGoal([2, 2, 2], 10, 2);
  assert.equal(impossible.status, "impossible");
  assert.equal(impossible.remainingLessons, 2);
  assert.ok(renderGradeGoalResult(impossible).includes("каждом из 2"));
  assert.equal(calculateGradeGoal([9, 9], 9, 2).status, "reached");
  assert.equal(calculateGradeGoal([], 11, 2).status, "invalid");
});

test("student subjects include unassigned subjects but exclude other classes and groups", () => {
  const model = {
    school: {
      classes: [{ id: "c", studentIds: ["s"] }],
      studentsById: { s: { groupIds: ["g1"] } },
      teacherAssignments: [{ id: "a", classId: "c", subjectId: "math" }],
      subjectsById: {
        math: { title: "Математика" },
        art: { title: "Искусство" },
      },
    },
    lessonTemplates: [
      { classId: "c", subjectId: "math" },
      { classId: "c", subjectId: "math" },
      { classId: "c", subjectId: "art", groupId: "g1" },
      { classId: "c", subjectId: "art", groupId: "g2" },
      { classId: "other", subjectId: "math" },
    ],
  };
  const subjects = getStudentSubjects(model, "s");
  assert.equal(subjects.length, 2);
  assert.ok(subjects.some((item) => item.id === "a"));
  assert.deepEqual(getStudentSubjects(model, "unknown"), []);
});

test("student results merge parallel groups of the same subject", () => {
  const model = {
    school: {
      classes: [{ id: "c", studentIds: ["s"] }],
      studentsById: { s: { groupIds: ["g1", "g2"] } },
      teacherAssignments: [
        { id: "info-1", classId: "c", subjectId: "info", groupId: "g1" },
        { id: "info-2", classId: "c", subjectId: "info", groupId: "g2" },
      ],
      subjectsById: { info: { title: "Информатика" } },
    },
    subjects: [],
    lessonTemplates: [
      { id: "t1", classId: "c", subjectId: "info", groupId: "g1" },
      { id: "t2", classId: "c", subjectId: "info", groupId: "g2" },
    ],
  };

  const subjects = getStudentSubjects(model, "s");
  assert.equal(subjects.length, 1);
  assert.equal(subjects[0].title, "Информатика");
  assert.deepEqual(
    subjects[0].variants.map((item) => item.id),
    ["info-1", "info-2"],
  );
});
