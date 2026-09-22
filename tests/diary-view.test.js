import assert from "node:assert/strict";
import test from "node:test";
import {
  countHomework,
  getSafeMaterialUrl,
  getLessonWord,
  renderDiaryEmptyState,
  renderDiaryTable,
} from "../js/diary-view.js";

const labels = {
  lessonHeader: "Урок",
  homeworkHeader: "Домашнее задание",
  gradeHeader: "Отметка",
  attendanceHeader: "Посещение",
  room: "каб.",
  noHomework: "нет дз",
};
const translate = (key) => labels[key] || key;

test("renders lesson and journal data while escaping user-controlled text", () => {
  const html = renderDiaryTable(
    [
      {
        number: 1,
        subject: "Биология <script>",
        time: "09:00–09:45",
        room: "12",
        homework: "§ 1 & 2",
        grade: "10",
        attendance: "absent",
        journalEntry: {
          comment: "Отлично <img>",
          materials: ["https://example.test/?a=1&b=2"],
        },
      },
    ],
    translate,
  );

  assert.match(html, /Биология &lt;script&gt;/);
  assert.match(html, /§ 1 &amp; 2/);
  assert.match(html, /Отлично &lt;img&gt;/);
  assert.match(html, /a=1&amp;b=2/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /data-label="Посещение"/);
  assert.match(html, /class="attendance-mark is-absent">Отсутствие</);
  assert.doesNotMatch(html, /<script>/);
});

test("shows inferred presence and lesson-level materials", () => {
  const html = renderDiaryTable(
    [
      {
        number: 1,
        subject: "Математика",
        time: "09:00–09:45",
        room: "12",
        homework: "№ 4",
        attendance: "present",
        lessonWork: { materials: ["https://example.test/task"] },
      },
    ],
    translate,
  );

  assert.match(html, /Присутствовал/);
  assert.match(html, /https:\/\/example\.test\/task/);
});

test("does not render a room label when a lesson has no room", () => {
  const html = renderDiaryTable(
    [
      {
        number: 1,
        subject: "Физическая культура",
        time: "09:00–09:45",
        room: "",
        homework: "",
        attendance: "",
      },
    ],
    translate,
  );

  assert.match(html, /09:00–09:45/);
  assert.doesNotMatch(html, /каб\./);
});

test("renders lesson zero and a plain clickable subject name", () => {
  const html = renderDiaryTable(
    [
      {
        number: 0,
        subjectId: "english",
        subject: "Англ. язык",
        time: "07:05–07:50",
      },
    ],
    translate,
  );

  assert.match(html, /<strong>0\. <button class="lesson-subject-link"/);
  assert.match(html, /data-diary-subject="english"/);
});

test("accepts only web links as lesson materials", () => {
  assert.equal(
    getSafeMaterialUrl("https://example.test/file.pdf"),
    "https://example.test/file.pdf",
  );
  assert.equal(getSafeMaterialUrl("javascript:alert(1)"), null);
  assert.equal(getSafeMaterialUrl("not a link"), null);
});

test("counts only actual homework assignments", () => {
  assert.equal(
    countHomework([
      { homework: "Прочитать главу" },
      { homework: "нет дз" },
      { homework: "No homework" },
      { homework: "—" },
      { homework: "" },
    ]),
    1,
  );
});

test("selects Russian lesson word forms", () => {
  assert.equal(getLessonWord(1), "урок");
  assert.equal(getLessonWord(2), "урока");
  assert.equal(getLessonWord(5), "уроков");
  assert.equal(getLessonWord(11), "уроков");
  assert.equal(getLessonWord(22), "урока");
});

test("renders an empty-day message without accepting markup", () => {
  const html = renderDiaryEmptyState({
    label: "Выходной",
    title: "Можно отдыхать!",
    description: "Уроков нет <script>",
  });

  assert.match(html, /Можно отдыхать!/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
