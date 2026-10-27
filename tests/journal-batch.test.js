import assert from "node:assert/strict";
import test from "node:test";
import {
  createJournalStore,
  JOURNAL_STORAGE_KEY,
} from "../js/journal-store.js";

function fixture(initial) {
  const values = new Map(
    initial ? [[JOURNAL_STORAGE_KEY, JSON.stringify(initial)]] : [],
  );
  const stats = { reads: 0, writes: 0 };
  let fail = false;
  const storage = {
    getItem(key) {
      stats.reads++;
      return values.get(key);
    },
    setItem(key, value) {
      stats.writes++;
      if (fail) return false;
      values.set(key, value);
    },
  };
  return {
    store: createJournalStore(storage),
    values,
    stats,
    setFailure(value) {
      fail = value;
    },
  };
}
function withoutTimestamps(value) {
  return JSON.parse(
    JSON.stringify(value, (key, item) =>
      ["updatedAt", "createdAt"].includes(key) ? undefined : item,
    ),
  );
}
function document(f) {
  return withoutTimestamps(JSON.parse(f.values.get(JOURNAL_STORAGE_KEY)));
}
const entry = (lessonId, studentId = "synthetic-student", values = {}) => ({
  lessonId,
  studentId,
  ...values,
});
const material = {
  url: "https://example.test/file",
  title: "Задание",
  source: "e-schools",
  sourceLessonId: "synthetic-lesson",
  sourceEndpoint:
    "/api/v1/education/diary/lessons/synthetic-lesson/attachments_and_links",
};

test("batch matches ordered single writes for pairs, pass/fail, attendance, text and materials", () => {
  const single = fixture(),
    batch = fixture();
  const entries = [
    entry("one", undefined, {
      grades: ["9", "9"],
      homework: " ДЗ ",
      comment: " Комментарий ",
      materials: [material],
      attendance: "absent",
      authorId: "synthetic-author",
    }),
    entry("two", undefined, {
      grades: ["зачёт", "незачёт"],
      materials: ["https://example.test/link"],
    }),
    entry("three", undefined, {
      grades: ["8", "10", "1"],
      attendance: "present",
    }),
  ];
  const original = structuredClone(entries);
  entries.forEach((value) => single.store.saveJournalEntry(value));
  const result = batch.store.saveJournalEntries(entries);
  assert.equal(result.persisted, true);
  assert.deepEqual(document(batch), document(single));
  assert.deepEqual(entries, original);
  assert.deepEqual(batch.stats, { reads: 1, writes: 1 });
  assert.deepEqual(
    batch.store.getJournalEntry("one", "synthetic-student").grades,
    ["9", "9"],
  );
  assert.equal(
    batch.store.getJournalEntry("one", "synthetic-student").materials[0]
      .sourceEndpoint,
    material.sourceEndpoint,
  );
});

test("batch replaces only targeted lesson/student pairs and preserves work and final grades", () => {
  const single = fixture(),
    batch = fixture();
  for (const f of [single, batch]) {
    f.store.saveJournalEntry(
      entry("same", "student-a", {
        grades: ["9", "9"],
        materials: [material],
        homework: "old",
        comment: "old",
        attendance: "absent",
      }),
    );
    f.store.saveJournalEntry(entry("same", "student-b", { grades: ["10"] }));
    f.store.saveJournalEntry(entry("other", "student-a", { grades: ["6"] }));
    f.store.saveLessonWork({ lessonId: "same", homework: "Shared work" });
    f.store.saveTermGrade({
      termId: "half-1",
      assignmentId: "subject",
      studentId: "student-a",
      value: "зачёт",
    });
    f.stats.reads = f.stats.writes = 0;
  }
  const entries = [entry("same", "student-a", { grades: ["7"] })];
  single.store.saveJournalEntry(entries[0]);
  batch.store.saveJournalEntries(entries);
  assert.deepEqual(document(batch), document(single));
  assert.deepEqual(batch.stats, { reads: 1, writes: 1 });
  const value = batch.store.getJournalEntry("same", "student-a");
  assert.deepEqual(value.grades, ["7"]);
  assert.deepEqual(value.materials, []);
  assert.equal(value.attendance, "");
  assert.equal(
    batch.store.getTermGrade("half-1", "subject", "student-a").value,
    "зачёт",
  );
});

test("duplicate input pairs keep the last mutation including removal of old second grades", () => {
  const single = fixture(),
    batch = fixture();
  const entries = [
    entry("one", "s", { grades: ["9", "9"], materials: [material] }),
    entry("two", "s", { grades: ["10"] }),
    entry("one", "s", { grades: ["6"] }),
  ];
  entries.forEach((value) => single.store.saveJournalEntry(value));
  batch.store.saveJournalEntries(entries);
  assert.deepEqual(document(batch), document(single));
  assert.deepEqual(batch.store.getJournalEntry("one", "s").grades, ["6"]);
});

test("empty batch does not read, migrate or write storage", () => {
  const f = fixture({ schemaVersion: 2 });
  assert.deepEqual(f.store.saveJournalEntries([]), {
    entries: [],
    persisted: true,
  });
  assert.deepEqual(f.stats, { reads: 0, writes: 0 });
});

test("failed persistence leaves the previous persisted document intact and permits retry", () => {
  const f = fixture();
  f.store.saveJournalEntry(entry("one", "s", { grades: ["9"] }));
  const before = f.values.get(JOURNAL_STORAGE_KEY);
  f.setFailure(true);
  assert.equal(
    f.store.saveJournalEntries([entry("one", "s", { grades: ["6"] })])
      .persisted,
    false,
  );
  assert.equal(f.values.get(JOURNAL_STORAGE_KEY), before);
  f.setFailure(false);
  assert.equal(
    f.store.saveJournalEntries([entry("one", "s", { grades: ["6"] })])
      .persisted,
    true,
  );
  assert.deepEqual(f.store.getJournalEntry("one", "s").grades, ["6"]);
});

test("malformed batch input cannot partially commit earlier entries", () => {
  const f = fixture();
  f.store.saveJournalEntry(entry("old", "s", { grades: ["9"] }));
  const before = f.values.get(JOURNAL_STORAGE_KEY);
  f.stats.reads = f.stats.writes = 0;
  assert.throws(() =>
    f.store.saveJournalEntries([entry("new", "s", { grades: ["8"] }), null]),
  );
  assert.equal(f.values.get(JOURNAL_STORAGE_KEY), before);
  assert.deepEqual(f.stats, { reads: 0, writes: 0 });
});

test("batch preserves migration semantics for legacy and version two documents", () => {
  for (const initial of [
    {
      old: entry("old", "s", {
        grades: ["9"],
        updatedAt: "2026-10-01T12:00:00.000Z",
      }),
    },
    {
      schemaVersion: 2,
      gradeEntries: {
        old: {
          id: "old",
          lessonId: "old",
          studentId: "s",
          value: "9",
          position: 0,
        },
      },
      attendanceEntries: {},
      homeworkEntries: {},
      commentEntries: {},
      materialEntries: {},
    },
  ]) {
    const single = fixture(initial),
      batch = fixture(initial);
    const entries = [entry("new", "s", { grades: ["8", "8"] })];
    single.store.saveJournalEntry(entries[0]);
    batch.store.saveJournalEntries(entries);
    assert.deepEqual(document(batch), document(single));
    assert.equal(
      JSON.parse(batch.values.get(JOURNAL_STORAGE_KEY)).schemaVersion,
      3,
    );
  }
});

test("batch remains compatible with subsequent single-entry edits and reload", () => {
  const f = fixture();
  f.store.saveJournalEntries([
    entry("one", "s", { grades: ["9", "9"] }),
    entry("two", "s", { grades: ["зачёт"] }),
  ]);
  f.store.saveJournalEntry(entry("one", "s", { grades: ["8"] }));
  const reload = fixture(JSON.parse(f.values.get(JOURNAL_STORAGE_KEY)));
  assert.deepEqual(reload.store.getJournalEntry("one", "s").grades, ["8"]);
  assert.deepEqual(reload.store.getJournalEntry("two", "s").grades, ["зачёт"]);
});
