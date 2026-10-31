import assert from "node:assert/strict";
import test from "node:test";
import {
  createDiaryHistoryRepository,
  makeSharedEvents,
} from "../js/cloud-diary-history.js";
import { createCloudDiaryRepository } from "../js/cloud-diary-repository.js";
import { createDeviceRepository } from "../js/device-repository.js";
import { createSyntheticUserscriptExport } from "./helpers/userscript-export.js";
import {
  createOwnerSession,
  deferred,
  flush,
} from "./helpers/owner-session.js";

const snapshot = (mark = "8") =>
  JSON.parse(createSyntheticUserscriptExport({ mark })).snapshot;
function storageFixture() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("queued writes and late reads are discarded across A to B to A; a later valid operation still works", async () => {
  const session = createOwnerSession();
  const read = deferred();
  let writes = 0,
    loads = 0;
  const repository = createDiaryHistoryRepository(
    {
      load: async () =>
        ++loads === 1 ? read.promise : { payload: snapshot() },
      save: async () => {
        writes++;
        return "saved";
      },
    },
    { history: async () => [], saveEvents: async () => {} },
    session,
  );
  const reading = repository.load();
  const saving = repository.save(snapshot("9"));
  const rejected = Promise.all([
    assert.rejects(reading, /Сеанс/),
    assert.rejects(saving, /Сеанс/),
  ]);
  await flush();
  session.change("owner-b");
  session.change("owner-a");
  await rejected;
  assert.equal(writes, 0);
  assert.equal(session.active, 0);
  read.resolve({ payload: snapshot("1") });
  assert.equal(await repository.save(snapshot("9")), "saved");
  assert.equal(writes, 1);
  assert.equal(session.active, 0);
});

test("an account switch after snapshot save cannot publish history into the next account", async () => {
  const session = createOwnerSession();
  const storage = storageFixture();
  let historyWrites = 0;
  const repository = createDiaryHistoryRepository(
    {
      load: async () => ({ payload: snapshot() }),
      save: async (_data, options) => {
        assert.equal(options.expectedOwner, "owner-a");
        session.change("owner-b");
      },
    },
    { saveEvents: async () => historyWrites++ },
    { ...session, storage },
  );
  await assert.rejects(repository.save(snapshot("9")), /Сеанс/);
  assert.equal(historyWrites, 0);
  assert.equal(storage.values.size, 0);
  assert.equal(session.active, 0);
});

test("previous snapshots are isolated by owner when the same repository is reused", async () => {
  const session = createOwnerSession();
  let baseline = snapshot("8");
  const published = [];
  const repository = createDiaryHistoryRepository(
    {
      load: async () => ({ payload: baseline }),
      save: async () => "saved",
    },
    {
      history: async () => [],
      saveEvents: async (events, options) =>
        published.push({ events, owner: options.expectedOwner }),
    },
    session,
  );
  await repository.load();
  session.change("owner-b");
  baseline = snapshot("4");
  await repository.save(snapshot("5"));
  assert.equal(published.length, 1);
  assert.equal(published[0].owner, "owner-b");
  assert.deepEqual(published[0].events[0].before, ["4"]);
});

test("a history upload cancelled by logout retains only the original owner's outbox", async () => {
  const session = createOwnerSession();
  const storage = storageFixture();
  const upload = deferred();
  const repository = createDiaryHistoryRepository(
    { load: async () => ({ payload: snapshot() }), save: async () => "saved" },
    {
      saveEvents: async (_events, options) => {
        assert.equal(options.expectedOwner, "owner-a");
        return upload.promise;
      },
    },
    { ...session, storage },
  );
  const saving = repository.save(snapshot("9"));
  const failure = assert.rejects(saving, /Сеанс/);
  await flush();
  assert.equal(storage.values.size, 1);
  session.change("");
  await failure;
  upload.resolve();
  await flush();
  assert.deepEqual(
    [...storage.values.keys()],
    ["schoolpp_changes_outbox_v1:owner-a"],
  );
  assert.equal(session.active, 0);
});

test("finishing an outbox request cannot delete events appended by another tab", async () => {
  const session = createOwnerSession();
  const storage = storageFixture();
  const key = "schoolpp_changes_outbox_v1:owner-a";
  const first = [{ id: "first", type: "grades" }];
  storage.setItem(key, JSON.stringify(first));
  const repository = createDiaryHistoryRepository(
    { load: async () => ({ payload: snapshot() }) },
    {
      saveEvents: async () =>
        storage.setItem(
          key,
          JSON.stringify([...first, { id: "another-tab", type: "grades" }]),
        ),
      history: async () => [],
    },
    { ...session, storage },
  );
  await repository.load();
  assert.equal(JSON.parse(storage.getItem(key)).length, 2);
});

test("queued snapshots are captured immutably and obsolete retry callbacks prevent upserts", async () => {
  const session = createOwnerSession();
  const blocked = deferred();
  const writes = [];
  let calls = 0;
  const repository = createDiaryHistoryRepository(
    {
      load: async () =>
        ++calls === 1 ? blocked.promise : { payload: snapshot() },
      save: async (value) => writes.push(value),
    },
    { history: async () => [], saveEvents: async () => {} },
    session,
  );
  const loading = repository.load();
  const value = snapshot("9");
  const saving = repository.save(value);
  value.network["week-0"].body[0].slots[0].lesson_mark.mark = "1";
  const cancelled = repository.save(snapshot("10"), {
    isCurrent: async () => false,
  });
  const rejection = assert.rejects(cancelled, /более новый/);
  blocked.resolve({ payload: snapshot() });
  await loading;
  await saving;
  await rejection;
  assert.equal(writes.length, 1);
  assert.equal(
    writes[0].network["week-0"].body[0].slots[0].lesson_mark.mark,
    "9",
  );
});

test("aborted authentication cannot issue late database writes or deletes", async () => {
  for (const operation of ["save", "load", "remove"]) {
    const auth = deferred();
    const controller = new AbortController();
    const repository = createCloudDiaryRepository({
      auth: { getUser: () => auth.promise },
      from: () => assert.fail("late database request"),
    });
    const options = { signal: controller.signal, expectedOwner: "owner-a" };
    const work =
      operation === "save"
        ? repository.save(snapshot(), options)
        : repository[operation](options);
    controller.abort(new Error("cancelled"));
    auth.resolve({ data: { user: { id: "owner-a" } } });
    await assert.rejects(work, /cancelled/);
  }
});

test("history RPCs recheck the expected owner and do not send an aborted request", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  const repository = createDeviceRepository({
    auth: { getUser: async () => ({ data: { user: { id: "owner-b" } } }) },
    rpc: () => assert.fail("foreign RPC"),
  });
  await assert.rejects(
    repository.saveEvents([], { expectedOwner: "owner-a" }),
    /Сеанс/,
  );
  await assert.rejects(
    repository.history({ signal: controller.signal }),
    /cancelled/,
  );
});

test("changing the source student cannot manufacture grade-change events", async () => {
  const before = snapshot("8"),
    after = snapshot("9");
  after.network["week-0"].url = after.network["week-0"].url.replace(
    "synthetic-student",
    "other-student",
  );
  assert.deepEqual(await makeSharedEvents(before, after), []);
});

test("a hung background load has a deadline and cannot block subsequent saves or apply a late result", async () => {
  const session = createOwnerSession();
  const slow = deferred();
  let loads = 0,
    writes = 0;
  const repository = createDiaryHistoryRepository(
    {
      load: async () =>
        ++loads === 1 ? slow.promise : { payload: snapshot() },
      save: async () => {
        writes++;
        return "saved";
      },
    },
    { history: async () => [], saveEvents: async () => {} },
    { ...session, timeoutMs: 15 },
  );
  await assert.rejects(repository.load(), /не ответил/);
  assert.equal(await repository.save(snapshot("9")), "saved");
  slow.resolve({ payload: snapshot("1") });
  await flush();
  assert.equal(writes, 1);
  assert.equal(session.active, 0);
});

test("a timeout of optional history does not invalidate an acknowledged snapshot or delete its outbox", async () => {
  const session = createOwnerSession();
  const storage = storageFixture();
  const repository = createDiaryHistoryRepository(
    { load: async () => ({ payload: snapshot() }), save: async () => "saved" },
    {
      saveEvents: async () => new Promise(() => {}),
      history: async () => new Promise(() => {}),
    },
    { ...session, storage, timeoutMs: 15 },
  );
  assert.equal(await repository.save(snapshot("9")), "saved");
  assert.equal(storage.values.size, 1);
  const read = repository.loadProgressively();
  assert.ok((await read.snapshot).payload);
  assert.equal((await read.complete).changes, undefined);
  assert.equal(storage.values.size, 1);
  assert.equal(session.active, 0);
});
