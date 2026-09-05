import assert from "node:assert/strict";
import test from "node:test";
import { selectLesson, renderLessonView } from "../js/teacher-lesson-view.js";

const lessons = [
  { id: "one", date: "2026-09-01", startsAt: "14:00", endsAt: "14:45" },
  { id: "two", date: "2026-09-04", startsAt: "14:00", endsAt: "14:45" },
  { id: "three", date: "2026-09-07", startsAt: "14:00", endsAt: "14:45" },
];

test("opens today, the latest past lesson on weekends, or the first upcoming lesson", () => {
  assert.equal(selectLesson(lessons, "", "2026-09-04").id, "two");
  assert.equal(selectLesson(lessons, "", "2026-09-05").id, "two");
  assert.equal(selectLesson(lessons, "", "2026-08-31").id, "one");
  assert.equal(selectLesson(lessons, "one", "2026-09-05").id, "one");
  assert.equal(selectLesson(lessons, "old-term", "2026-09-05").id, "two");
  assert.equal(selectLesson([], "", "2026-09-05"), null);
});

test("shows saved grades and explicit no-homework without accepting markup", () => {
  const html = renderLessonView({
    lesson: { ...lessons[0], homework: "Old homework" },
    lessons,
    students: [{ id: "s1", lastName: "<img src=x>", firstName: "Аня" }],
    store: {
      getLessonWork: () => ({ noHomework: true }),
      getLessonEntries: () => [
        {
          studentId: "s1",
          grades: ["8", "9"],
          comment: "<script>alert(1)</script>",
        },
      ],
    },
    dateTools: { formatIsoDateLong: (date) => date },
    today: "2026-09-01",
  });
  assert.ok(html.includes("8 / 9"));
  assert.ok(html.includes("Домашнего задания нет"));
  assert.ok(!html.includes("Old homework"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes('data-open-entry="one" data-student-id="s1"'));
  assert.match(html, /aria-label="Предыдущий урок" disabled/);
});
