import assert from "node:assert/strict";
import test from "node:test";
import {
  getSubjectResult,
  getStudentSubjects,
} from "../js/achievement-model.js";
import { createJournalStore } from "../js/journal-store.js";
import {
  renderAchievementTable,
  renderSubjectDetails,
} from "../js/achievement-view.js";

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
  const html = renderSubjectDetails(
    result,
    "q1",
    { formatIsoDateLong: (date) => date },
    () => true,
  );
  assert.ok(html.includes("8 / 9"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes('data-achievement-lesson="l1"'));
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
  assert.ok(html.includes("8,5"));
  assert.equal(getSubjectResult(model, store, assignment, "other").annual, "");
  store.saveTermGrade({
    termId: "year",
    assignmentId: "math",
    studentId: "s",
    value: "",
  });
  assert.equal(getSubjectResult(model, store, assignment, "s").annual, "");
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
