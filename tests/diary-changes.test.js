import assert from "node:assert/strict";
import test from "node:test";
import {
  compareChangeSnapshots,
  createDiaryChangeTracker,
  createChangeSnapshot,
  renderDiaryChanges,
} from "../js/diary-changes.js";
import { createAnalyticsPreviewData } from "../js/analytics-preview.js";
import { SCHOOL_DIARY } from "../data/diary-data.js";
import { SCHOOL_DATA } from "../data/school-data.js";

const row = (values = {}) => ({
  date: "2026-09-30",
  subject: "Русский язык",
  number: 2,
  grades: ["9"],
  homework: "§8",
  materials: [],
  ...values,
});

test("changes detect paired duplicate grades, edited homework and a new material", () => {
  const before = { lesson: row() };
  const after = {
    lesson: row({
      grades: ["9", "9"],
      homework: "§9",
      materials: ["file-a"],
      materialNames: { "file-a": "Задание.pdf" },
    }),
  };
  const result = compareChangeSnapshots(before, after);
  assert.deepEqual(
    result.changes.map((item) => item.type),
    ["grades", "homework", "materials"],
  );
  assert.deepEqual(result.changes[2].after, ["Задание.pdf"]);
  assert.equal(compareChangeSnapshots(result.rows, after).changes.length, 0);
});

test("partial sync never invents removal or reports old data as new on recovery", () => {
  const before = {
    lesson: row({ materials: ["file-a"], materialNames: { "file-a": "A" } }),
    unseen: row(),
  };
  const partial = compareChangeSnapshots(before, {
    lesson: row({ grades: [], homework: "", materials: [] }),
  });
  assert.equal(partial.changes.length, 0);
  assert.deepEqual(partial.rows.lesson.grades, ["9"]);
  assert.equal(partial.rows.lesson.homework, "§8");
  assert.ok(partial.rows.unseen);
  assert.equal(compareChangeSnapshots(partial.rows, before).changes.length, 0);
});

test("first import is a baseline, changes survive reload and student identity isolates history", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  const first = createAnalyticsPreviewData(SCHOOL_DIARY, SCHOOL_DATA);
  const tracker = createDiaryChangeTracker(
    storage,
    () => "2026-10-05T13:00:00Z",
  );
  tracker.record(first);
  assert.equal(tracker.getState().changes.length, 0);
  const changed = structuredClone(first);
  const entry = changed.journalEntries.find((item) => item.grades.length);
  entry.grades = ["9", "9"];
  changed.importedAt = "2026-10-05T13:00:00Z";
  tracker.record(changed);
  assert.equal(tracker.getState().changes.length, 1);
  assert.equal(tracker.getState().changes[0].read, false);
  const restored = createDiaryChangeTracker(storage);
  restored.record(changed);
  assert.equal(restored.getState().changes.length, 1);
  restored.record(first);
  assert.equal(restored.getState().changes.length, 1);
  restored.markRead();
  assert.equal(restored.getState().changes[0].read, true);
  const other = structuredClone(changed);
  other.school.users.find((user) => user.role === "student").id = "other";
  restored.record(other);
  assert.equal(restored.getState().changes.length, 0);
});

test("change rendering escapes diary text and links the lesson date", () => {
  const html = renderDiaryChanges(
    {
      changes: [
        {
          date: "2026-09-30",
          subject: "<script>",
          number: 2,
          type: "homework",
          before: "§8",
          after: "<img>",
          read: false,
        },
      ],
    },
    (date) => date,
  );
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;img&gt;"));
  assert.ok(html.includes('data-change-date="2026-09-30"'));
});

test("lesson materials survive an empty journal material list and renewed signed links are not new files", () => {
  const data = createAnalyticsPreviewData(SCHOOL_DIARY, SCHOOL_DATA);
  const before = createChangeSnapshot(data);
  data.journalEntries.forEach((entry) => (entry.materials = []));
  const lesson = data.diary.weeks.flatMap((week) =>
    Object.values(week.days).flat(),
  )[0];
  lesson.materials = [
    {
      title: "Задание.pdf",
      url: "https://objectsstore.e-schools.by/journal/test?X-Amz-Signature=first",
    },
  ];
  const added = createChangeSnapshot(data);
  const difference = compareChangeSnapshots(before.rows, added.rows);
  assert.deepEqual(
    difference.changes.map((change) => change.type),
    ["materials"],
  );
  assert.deepEqual(difference.changes[0].after, ["Задание.pdf"]);
  lesson.materials[0].url =
    "https://objectsstore.e-schools.by/journal/test?X-Amz-Signature=renewed";
  assert.equal(
    compareChangeSnapshots(added.rows, createChangeSnapshot(data).rows).changes
      .length,
    0,
  );
});
