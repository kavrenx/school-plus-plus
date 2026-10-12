import assert from "node:assert/strict";
import test from "node:test";
import {
  compareChangeSnapshots,
  createDiaryChangeTracker,
  createChangeSnapshot,
  renderDiaryChanges,
  groupDiaryChanges,
  getChangeSyncDay,
  matchesChangeSearch,
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

test("change days use synchronization time in the school timezone rather than lesson date", () => {
  const changes = [
    {
      ...row(),
      type: "grades",
      after: ["8"],
      syncedAt: "2026-10-11T21:30:00Z",
      detectedAt: "2026-10-13T10:00:00Z",
    },
    {
      ...row(),
      type: "homework",
      after: "§8",
      detectedAt: "2026-10-12T12:00:00Z",
    },
    {
      ...row(),
      type: "grades",
      after: ["9"],
      detectedAt: "2026-10-11T12:00:00Z",
    },
  ];
  assert.equal(getChangeSyncDay(changes[0]), "2026-10-12");
  const groups = groupDiaryChanges(changes);
  assert.deepEqual(
    groups.map((group) => [group.day, group.changes.length]),
    [
      ["2026-10-12", 2],
      ["2026-10-11", 1],
    ],
  );
  assert.equal(groups[0].changes[0].type, "homework");
  const html = renderDiaryChanges({ changes }, (date) => date, {
    today: "2026-10-12",
  });
  assert.match(html, /data-change-day="2026-10-12" aria-expanded="true"/);
  assert.match(html, /data-change-day="2026-10-11" aria-expanded="false"/);
});

test("search matches subject aliases, grades and filenames without confusing a grade with a date", () => {
  const grade = {
    ...row({ subject: "Русск. лит." }),
    type: "grades",
    before: ["8"],
    after: ["9", "9"],
  };
  assert.ok(matchesChangeSearch(grade, "русская литература"));
  assert.ok(matchesChangeSearch(grade, "9/9"));
  assert.ok(matchesChangeSearch(grade, "9"));
  assert.equal(matchesChangeSearch(grade, "10"), false);
  assert.equal(
    matchesChangeSearch({ ...grade, before: [], after: ["1", "10"] }, "1/1"),
    false,
  );
  const material = {
    ...row(),
    type: "materials",
    after: ["Расчёт задачи.PDF"],
  };
  assert.ok(matchesChangeSearch(material, "расчет pdf"));
  assert.ok(matchesChangeSearch(material, "файл"));
  assert.equal(matchesChangeSearch(material, "9"), false);
  const homework = {
    ...row(),
    type: "homework",
    after: "Подготовиться к диктанту",
  };
  assert.ok(matchesChangeSearch(homework, "РУССКИЙ диктанту"));
  assert.equal(matchesChangeSearch(homework, "биология"), false);
});

test("search preserves grouping, opens matching days and handles empty results", () => {
  const changes = [
    {
      ...row(),
      type: "grades",
      after: ["9"],
      detectedAt: "2026-10-12T10:00:00Z",
    },
    {
      ...row(),
      type: "grades",
      after: ["9"],
      detectedAt: "2026-10-10T10:00:00Z",
    },
  ];
  const html = renderDiaryChanges({ changes }, (date) => date, {
    query: "9",
    today: "2026-10-12",
  });
  assert.match(html, /Найдено: 2/);
  assert.match(html, /data-change-day="2026-10-10" aria-expanded="true"/);
  assert.ok(
    renderDiaryChanges({ changes }, (date) => date, {
      query: "химия",
    }).includes("Ничего не найдено"),
  );
  const restored = renderDiaryChanges({ changes }, (date) => date, {
    today: "2026-10-12",
    expandedDays: new Map([
      ["2026-10-10", true],
      ["2026-10-12", false],
    ]),
  });
  assert.match(restored, /data-change-day="2026-10-12" aria-expanded="false"/);
  assert.match(restored, /data-change-day="2026-10-10" aria-expanded="true"/);
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
