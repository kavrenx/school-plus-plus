import assert from "node:assert/strict";
import test from "node:test";
import {
  createDiaryHistoryRepository,
  makeSharedEvents,
} from "../js/cloud-diary-history.js";
import { createDiaryChangeTracker } from "../js/diary-changes.js";
import { adaptESchoolsSnapshot } from "../js/e-schools-adapter.js";

function snapshot(mark = "8", capturedAt = "2026-10-14T09:00:00Z") {
  return {
    source: "e-schools.by",
    capturedAt,
    network: {
      year: {
        url: "/api/v1/education/diary/school_year",
        status: 200,
        body: {
          uuid: "year",
          label: "2026/2027",
          start_ts: Date.parse("2026-09-01") / 1000,
          end_ts: Date.parse("2027-08-31") / 1000,
        },
      },
      lessons: {
        url: "/api/v1/education/diary/schools/s/classes/c/students/u/lessons?week_activity_uuid=w",
        status: 200,
        body: [
          {
            date: Date.parse("2026-10-14") / 1000,
            day_of_week: 3,
            slots: [
              {
                lesson_uuid: "physics",
                subject_title: "Физика",
                number: 2,
                lesson_marks: [{ mark }],
                homework: "§8",
              },
            ],
          },
        ],
      },
    },
  };
}

test("cloud changes describe real imported grades, with repeatable IDs and no first-import flood", async () => {
  const old = snapshot(),
    next = snapshot("9", "2026-10-14T10:00:00Z");
  const events = await makeSharedEvents(old, next);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "grades");
  assert.equal(events[0].subject, "Физика");
  assert.deepEqual(events[0].before, ["8"]);
  assert.deepEqual(events[0].after, ["9"]);
  assert.equal(events[0].syncedAt, next.capturedAt);
  assert.deepEqual(await makeSharedEvents(old, next), events);
  assert.deepEqual(await makeSharedEvents(null, next), []);
  assert.deepEqual(await makeSharedEvents(next, next), []);
});

test("history failure cannot invalidate a saved diary; failed diary saves never publish changes", async () => {
  let saved = snapshot(),
    failDiary = false,
    writes = 0;
  const repository = createDiaryHistoryRepository(
    {
      load: async () => ({ payload: saved }),
      save: async (next) => {
        if (failDiary) throw new Error("save failed");
        saved = next;
        return "saved";
      },
      remove: async () => {
        saved = null;
      },
    },
    {
      history: async () => [],
      saveEvents: async (events) => {
        assert.equal(events.length, 1);
        writes++;
        throw new Error("history failed");
      },
    },
  );
  await repository.load();
  assert.equal(
    await repository.save(snapshot("9", "2026-10-14T10:00:00Z")),
    "saved",
  );
  assert.equal(
    saved.network.lessons.body[0].slots[0].lesson_marks[0].mark,
    "9",
  );
  assert.equal(writes, 1);
  failDiary = true;
  await assert.rejects(
    repository.save(snapshot("10", "2026-10-14T11:00:00Z")),
    /save failed/,
  );
  assert.equal(writes, 1);
});

test("shared change reading state remains independent on each device", async () => {
  const storage = () => {
    const values = new Map();
    return {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
    };
  };
  const pc = createDiaryChangeTracker(storage()),
    phone = createDiaryChangeTracker(storage());
  const data = adaptESchoolsSnapshot(snapshot());
  pc.record(data);
  phone.record(data);
  const events = await makeSharedEvents(
    snapshot(),
    snapshot("9", "2026-10-14T10:00:00Z"),
  );
  pc.importShared(events);
  pc.markRead();
  phone.importShared(events);
  assert.equal(pc.getState().changes[0].read, true);
  assert.equal(phone.getState().changes[0].read, false);
  pc.importShared([...events, { ...events[0], id: "another", read: true }]);
  assert.equal(pc.getState().changes[0].read, true);
  assert.equal(pc.getState().changes[1].read, false);
});

test("a failed history upload survives a repository restart and stays scoped to its owner", async () => {
  const values = new Map(),
    storage = {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };
  let saved = snapshot(),
    identity = "computer",
    fail = true,
    received = [];
  const base = {
    load: async () => ({ payload: saved }),
    save: async (next) => {
      saved = next;
    },
    remove: async () => {},
  };
  const devices = {
    history: async () => [],
    saveEvents: async (events) => {
      if (fail) throw new Error("offline");
      received.push(...events);
    },
  };
  const options = { storage, getIdentity: async () => identity };
  await createDiaryHistoryRepository(base, devices, options).save(
    snapshot("9", "2026-10-14T10:00:00Z"),
  );
  assert.equal(values.size, 1);
  fail = false;
  identity = "another-browser-user";
  await createDiaryHistoryRepository(base, devices, options).load();
  assert.equal(received.length, 0);
  assert.equal(values.size, 1);
  identity = "computer";
  await createDiaryHistoryRepository(base, devices, options).load();
  assert.equal(received.length, 1);
  assert.equal(values.size, 0);
  assert.deepEqual(received[0].after, ["9"]);
});
