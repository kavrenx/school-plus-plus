import assert from "node:assert/strict";
import test from "node:test";
import { createDiaryWeeks } from "../data/diary-data.js";
import { SCHOOL_DIARY } from "../data/diary-data.js";
import { SCHOOL_DATA } from "../data/school-data.js";
import { normalizeDiaryData } from "../js/diary-model.js";
import { DAY_ORDER } from "../js/app-config.js";
import { createJournalStore } from "../js/journal-store.js";

test("creates a complete set of school weeks for every quarter", () => {
  const weeks = createDiaryWeeks([
    {
      id: "term-1",
      startsOn: "2025-09-01",
      endsOn: "2025-09-14",
    },
    {
      id: "term-2",
      startsOn: "2025-11-10",
      endsOn: "2025-11-16",
    },
  ]);

  assert.equal(weeks.length, 3);
  assert.equal(weeks[0].termId, "term-1");
  assert.equal(weeks[0].days.monday.length, 6);
  assert.equal(weeks[2].start, "2025-11-10");
  assert.notEqual(weeks[0].days.monday, weeks[1].days.monday);
});

test("aligns a Tuesday term start to Monday without inventing an August lesson", () => {
  const weeks = createDiaryWeeks([
    {
      id: "first",
      startsOn: "2026-09-01",
      endsOn: "2026-09-08",
    },
  ]);
  assert.equal(weeks[0].start, "2026-08-31");
  assert.equal(weeks[0].end, "2026-09-06");
  assert.equal(weeks[0].days.monday.length, 0);
  assert.equal(weeks[0].days.tuesday[0].subject, "География");
  assert.equal(weeks[1].days.tuesday.length, 6);
  assert.equal(weeks[1].days.wednesday.length, 0);
});

test("keeps the configured school year and both roles on the same dated lessons", () => {
  const model = normalizeDiaryData(SCHOOL_DIARY, DAY_ORDER, SCHOOL_DATA);
  const year = model.school.academicYear;
  assert.equal(model.meta.schoolYear, year.title);
  assert.equal(year.title, "2026/2027");
  for (const lesson of model.lessons) {
    assert.ok(lesson.date >= year.startsOn && lesson.date <= year.endsOn);
    const day = new Date(`${lesson.date}T12:00:00Z`).getUTCDay();
    assert.equal(lesson.dayKey, DAY_ORDER[(day + 6) % 7]);
  }
  const assignment = model
    .getTeacherAssignments("teacher_demo")
    .find(
      (item) => item.classId === "class_7b" && item.subjectId === "mathematics",
    );
  assert.ok(assignment);
  const teacherLessons = model.getLessonsForAssignmentTerm(
    assignment,
    year.terms[0].id,
  );
  const studentLesson = model.lessons.find(
    (lesson) =>
      lesson.date === "2026-09-01" && lesson.subjectId === "mathematics",
  );
  assert.ok(studentLesson);
  assert.equal(
    teacherLessons.find((lesson) => lesson.date === studentLesson.date).id,
    studentLesson.id,
  );
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  const teacherStore = createJournalStore(storage);
  teacherStore.saveJournalEntry({
    lessonId: studentLesson.id,
    studentId: "student_demo",
    grades: ["8", "9"],
    authorId: "teacher_demo",
  });
  teacherStore.saveLessonWork({
    lessonId: studentLesson.id,
    homework: "№ 12–14",
    authorId: "teacher_demo",
  });
  // A new repository models reopening the app after a reload or role change.
  const studentStore = createJournalStore(storage);
  const merged = studentStore.mergeLessonForStudent(
    studentLesson,
    "student_demo",
  );
  assert.equal(merged.grade, "8 / 9");
  assert.equal(merged.homework, "№ 12–14");
  assert.equal(
    studentStore.mergeLessonForStudent(studentLesson, "another_student").grade,
    "",
  );
});

test("skips invalid term ranges instead of producing malformed weeks", () => {
  assert.deepEqual(
    createDiaryWeeks([
      { startsOn: "bad", endsOn: "2026-09-30" },
      { startsOn: "2026-09-10", endsOn: "2026-09-01" },
    ]),
    [],
  );
});
