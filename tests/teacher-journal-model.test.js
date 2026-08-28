import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENDANCE_STATUS,
  LESSON_PROGRESS,
  calculateGradeStats,
  formatGradeAverage,
  getJournalCellPresentation,
  groupAssignmentsByClass,
  resolveLessonProgress,
  resolveStudentAttendance,
} from "../js/teacher-journal-model.js";

const lesson = {
  date: "2026-09-01",
  endsAt: "10:45",
  status: "scheduled",
};

test("keeps an untouched lesson unmarked even after its scheduled end", () => {
  const progress = resolveLessonProgress({
    lesson,
    instant: new Date("2026-09-01T08:00:00.000Z"),
    timeZone: "Europe/Minsk",
  });

  assert.equal(progress, LESSON_PROGRESS.scheduled);
  assert.equal(
    resolveStudentAttendance(null, progress),
    ATTENDANCE_STATUS.unmarked,
  );
});

test("completes an edited lesson after time and infers presence", () => {
  const progress = resolveLessonProgress({
    lesson,
    entries: [{ studentId: "student-1", grades: ["9"] }],
    instant: new Date("2026-09-01T08:00:00.000Z"),
    timeZone: "Europe/Minsk",
  });

  assert.equal(progress, LESSON_PROGRESS.completed);
  assert.equal(
    resolveStudentAttendance(null, progress),
    ATTENDANCE_STATUS.present,
  );
});

test("does not infer presence for the rest of the class before lesson end", () => {
  const progress = resolveLessonProgress({
    lesson,
    entries: [{ studentId: "student-1", comment: "Не готов к уроку" }],
    instant: new Date("2026-09-01T07:30:00.000Z"),
    timeZone: "Europe/Minsk",
  });

  assert.equal(progress, LESSON_PROGRESS.inProgress);
  assert.equal(
    resolveStudentAttendance(null, progress),
    ATTENDANCE_STATUS.unmarked,
  );
});

test("keeps an explicit absence after automatic completion", () => {
  assert.equal(
    resolveStudentAttendance(
      { attendance: "absent" },
      LESSON_PROGRESS.completed,
    ),
    ATTENDANCE_STATUS.absent,
  );
});

test("treats lesson-level homework as teacher activity", () => {
  const progress = resolveLessonProgress({
    lesson,
    lessonWork: { homework: "§ 2, № 4", updatedAt: "2026-09-01T07:20:00Z" },
    instant: new Date("2026-09-01T08:00:00.000Z"),
    timeZone: "Europe/Minsk",
  });

  assert.equal(progress, LESSON_PROGRESS.completed);
});

test("does not treat an empty saved lesson work object as activity", () => {
  const progress = resolveLessonProgress({
    lesson,
    lessonWork: { updatedAt: "2026-09-01T07:20:00Z" },
    instant: new Date("2026-09-01T08:00:00.000Z"),
    timeZone: "Europe/Minsk",
  });

  assert.equal(progress, LESSON_PROGRESS.scheduled);
});

test("groups teacher assignments into naturally ordered classes", () => {
  const groups = groupAssignmentsByClass([
    { id: "a", classId: "11a", classTitle: '11 "А"' },
    { id: "b", classId: "7b", classTitle: '7 "Б"' },
    { id: "c", classId: "7b", classTitle: '7 "Б"' },
  ]);

  assert.deepEqual(
    groups.map((group) => [group.classTitle, group.assignments.length]),
    [
      ['7 "Б"', 2],
      ['11 "А"', 1],
    ],
  );
});

test("calculates a term average only from numeric grades", () => {
  const stats = calculateGradeStats([
    { grades: ["8", "9"] },
    { grades: ["зачёт"] },
    { grades: ["10", "незачёт"] },
  ]);

  assert.equal(stats.count, 3);
  assert.equal(stats.average, 9);
  assert.equal(formatGradeAverage(stats.average), "9,0");
  assert.equal(formatGradeAverage(null), "—");
});

test("presents absence before grades and marks comments separately", () => {
  assert.deepEqual(
    getJournalCellPresentation({
      attendance: "absent",
      grades: ["9"],
      comment: "Причина",
    }),
    { label: "Н", kind: "absent", hasComment: true },
  );
  assert.deepEqual(getJournalCellPresentation({ grades: ["зачёт", "10"] }), {
    label: "зач. / 10",
    kind: "grade",
    hasComment: false,
  });
  assert.equal(
    getJournalCellPresentation({ comment: "Не готов" }).kind,
    "comment",
  );
});
