import assert from "node:assert/strict";
import test from "node:test";
import {
  createJournalStore,
  JOURNAL_SCHEMA_VERSION,
  JOURNAL_STORAGE_KEY,
  MAX_GRADES_PER_LESSON,
  migrateVersionTwoDocument,
} from "../js/journal-store.js";

function createLocalStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("saves a journal entry and merges it into a student lesson", () => {
  const store = createJournalStore(createLocalStorage());
  store.saveJournalEntry({
    lessonId: "lesson-1",
    studentId: "student-1",
    grades: ["9", "10"],
    attendance: "absent",
    comment: "Хорошая работа",
    homework: "Повторить тему",
    materials: ["https://example.test/material"],
  });

  const merged = store.mergeLessonForStudent(
    { id: "lesson-1", homework: "Старое задание", grade: "" },
    "student-1",
  );

  assert.equal(merged.grade, "9 / 10");
  assert.equal(merged.attendance, "absent");
  assert.equal(merged.homework, "Повторить тему");
  assert.equal(merged.journalEntry.comment, "Хорошая работа");
  assert.equal(merged.journalEntry.materials.length, 1);
});

test("keeps the base lesson when there is no entry for the student", () => {
  const store = createJournalStore(createLocalStorage());
  const lesson = { id: "lesson-2", homework: "Задание", grade: "8" };

  assert.equal(store.mergeLessonForStudent(lesson, "student-2"), lesson);
});

test("keeps no more than two distinct grades for one lesson", () => {
  const store = createJournalStore(createLocalStorage());
  const result = store.saveJournalEntry({
    lessonId: "lesson-3",
    studentId: "student-3",
    grades: ["8", "9", "10", "9"],
  });

  assert.equal(result.entry.grades.length, MAX_GRADES_PER_LESSON);
  assert.deepEqual(result.entry.grades, ["8", "9"]);
  assert.equal(
    store.mergeLessonForStudent({ id: "lesson-3", grade: "" }, "student-3")
      .grade,
    "8 / 9",
  );
});

test("stores journal fields as separate versioned entities", () => {
  const storage = createLocalStorage();
  const store = createJournalStore(storage);

  store.saveJournalEntry({
    lessonId: "lesson-4",
    studentId: "student-4",
    authorId: "teacher-1",
    grades: ["8", "10"],
    attendance: "absent",
    comment: "Стало лучше",
    homework: "Задача 12",
    materials: ["https://example.test/one", "https://example.test/two"],
  });

  const document = JSON.parse(storage.getItem(JOURNAL_STORAGE_KEY));
  assert.equal(document.schemaVersion, JOURNAL_SCHEMA_VERSION);
  assert.equal(Object.keys(document.gradeEntries).length, 2);
  assert.equal(Object.keys(document.attendanceEntries).length, 1);
  assert.equal(Object.keys(document.homeworkEntries).length, 1);
  assert.equal(Object.keys(document.commentEntries).length, 1);
  assert.equal(Object.keys(document.materialEntries).length, 2);
  assert.equal(Object.values(document.gradeEntries)[0].authorId, "teacher-1");
});

test("migrates a legacy composite journal entry without losing data", () => {
  const legacyEntry = {
    id: "lesson-5_student-5",
    lessonId: "lesson-5",
    studentId: "student-5",
    grades: ["7", "9"],
    attendance: "absent",
    comment: "Нужно повторить правило",
    homework: "Параграф 5",
    materials: ["https://example.test/rule"],
    updatedAt: "2026-08-24T12:00:00.000Z",
  };
  const storage = createLocalStorage({
    [JOURNAL_STORAGE_KEY]: JSON.stringify({
      [legacyEntry.id]: legacyEntry,
    }),
  });
  const store = createJournalStore(storage);

  const migrated = store.getJournalEntry("lesson-5", "student-5");
  const document = JSON.parse(storage.getItem(JOURNAL_STORAGE_KEY));

  assert.deepEqual(migrated.grades, ["7", "9"]);
  assert.equal(migrated.attendance, "absent");
  assert.equal(migrated.comment, "Нужно повторить правило");
  assert.equal(migrated.homework, "Параграф 5");
  assert.deepEqual(migrated.materials, ["https://example.test/rule"]);
  assert.equal(migrated.updatedAt, legacyEntry.updatedAt);
  assert.equal(document.schemaVersion, JOURNAL_SCHEMA_VERSION);
  assert.equal(Object.keys(document.gradeEntries).length, 2);
});

test("stores homework once per lesson and exposes it to every student", () => {
  const store = createJournalStore(createLocalStorage());
  store.saveLessonWork({
    lessonId: "lesson-shared",
    homework: "§ 8, № 12",
    materials: ["https://example.test/task"],
    authorId: "teacher-1",
  });

  const first = store.mergeLessonForStudent(
    { id: "lesson-shared", homework: "Старое" },
    "student-1",
  );
  const second = store.mergeLessonForStudent(
    { id: "lesson-shared", homework: "Старое" },
    "student-2",
  );

  assert.equal(first.homework, "§ 8, № 12");
  assert.equal(second.homework, "§ 8, № 12");
  assert.deepEqual(first.lessonWork.materials, ["https://example.test/task"]);
});

test("removes lesson work when homework and materials are cleared", () => {
  const store = createJournalStore(createLocalStorage());
  store.saveLessonWork({
    lessonId: "lesson-shared",
    homework: "§ 8",
  });
  store.saveLessonWork({
    lessonId: "lesson-shared",
    homework: "",
    noHomework: false,
    materials: [],
  });

  assert.equal(store.getLessonWork("lesson-shared"), null);
});

test("saves, changes and clears a quarter grade", () => {
  const store = createJournalStore(createLocalStorage());
  store.saveTermGrade({
    termId: "term-1",
    assignmentId: "assignment-1",
    studentId: "student-1",
    value: "10",
  });

  assert.equal(
    store.getTermGrade("term-1", "assignment-1", "student-1").value,
    "10",
  );
  assert.equal(store.getTermGrades("term-1", "assignment-1").length, 1);

  store.saveTermGrade({
    termId: "term-1",
    assignmentId: "assignment-1",
    studentId: "student-1",
    value: "",
  });
  assert.equal(store.getTermGrades("term-1", "assignment-1").length, 0);
});

test("migrates a version two document without losing student entries", () => {
  const migrated = migrateVersionTwoDocument({
    schemaVersion: 2,
    gradeEntries: {
      grade: {
        lessonId: "lesson-1",
        studentId: "student-1",
        value: "8",
      },
    },
    attendanceEntries: {},
    homeworkEntries: {},
    commentEntries: {},
    materialEntries: {},
  });

  assert.equal(migrated.schemaVersion, JOURNAL_SCHEMA_VERSION);
  assert.equal(migrated.gradeEntries.grade.value, "8");
  assert.deepEqual(migrated.lessonWorkEntries, {});
  assert.deepEqual(migrated.termGradeEntries, {});
});
