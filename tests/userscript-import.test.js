import assert from "node:assert/strict";
import test from "node:test";
import { createUserscriptImporter } from "../js/userscript-import.js";
import {
  readUserscriptDiary,
  saveUserscriptDiary,
  USERSCRIPT_CACHE,
} from "../js/userscript-client.js";
import { createCloudDiaryRepository } from "../js/cloud-diary-repository.js";
import { createDiaryHistoryRepository } from "../js/cloud-diary-history.js";
import {
  createOwnerSession,
  deferred,
  flush,
} from "./helpers/owner-session.js";

function sampleExport() {
  const record = (url, body) => ({ url, body, method: "GET", status: 200 });
  return JSON.stringify({
    type: "schoolpp-ios-export-v1",
    report: {
      type: "schoolpp-ios-collection-v1",
      result: "collection_ready",
      checks: {
        collection: {
          expectedWeeks: 1,
          loadedWeeks: 1,
          failedWeeks: 0,
          lessons: 1,
          marks: 1,
        },
      },
    },
    snapshot: {
      source: "e-schools.by",
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      import: { transport: "userscript", complete: true, expectedWeeks: 1 },
      pages: {
        p: { studentIdentity: { name: "Примеров Ученик", classTitle: "8 Б" } },
      },
      network: {
        year: record("/api/v1/education/diary/school_year", {
          label: "2026/2027",
          start_ts: 1788220800,
          end_ts: 1811721600,
        }),
        lessons: record(
          "/api/v1/education/diary/schools/s/classes/c/students/u/lessons?week_activity_uuid=w",
          [
            {
              date: 1791763200,
              day_of_week: 1,
              slots: [
                {
                  subject_title: "Математика",
                  number: 1,
                  lesson_uuid: "l",
                  lesson_mark: { mark: "9" },
                },
              ],
            },
          ],
        ),
      },
    },
  });
}
function fixture({ role = "unpaired", save = async () => ({}) } = {}) {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  const services = {
    auth: {
      getUser: async () => ({ id: "owner" }),
      signInAnonymously: () => assert.fail("already signed in"),
    },
    devices: { access: async () => ({ role }) },
    diary: { save },
  };
  return { values, storage, services };
}

test("a public import persists a validated owner-scoped diary and sends the same snapshot to the server", async () => {
  let received, options;
  const f = fixture({
    save: async (snapshot, value) => {
      received = snapshot;
      options = value;
    },
  });
  const result = await createUserscriptImporter(f).commit(
    sampleExport(),
    "owner",
  );
  assert.equal(result.cloudSaved, true);
  assert.equal(received.import.transport, "userscript");
  assert.equal(options.expectedOwner, "owner");
  assert.ok(options.signal);
  assert.equal(readUserscriptDiary(f.storage, "owner").cloudPending, false);
  assert.equal(readUserscriptDiary(f.storage, "another-user"), null);
});

test("a failed cloud save keeps the diary usable and retry clears only the pending upload state", async () => {
  let fail = true;
  const f = fixture({
    save: async () => {
      if (fail) throw new Error("offline");
    },
  });
  const importer = createUserscriptImporter(f);
  const result = await importer.commit(sampleExport(), "owner");
  assert.equal(result.cloudSaved, false);
  const saved = readUserscriptDiary(f.storage, "owner");
  assert.equal(saved.summary.recognizedMarks, 1);
  assert.equal(saved.cloudPending, true);
  fail = false;
  assert.equal(await importer.retryUpload(), true);
  assert.equal(readUserscriptDiary(f.storage, "owner").savedAt, saved.savedAt);
  assert.equal(readUserscriptDiary(f.storage, "owner").cloudPending, false);
});

test("read-only linked access, a changed session and incomplete data never replace a valid diary", async () => {
  for (const condition of ["linked", "changed", "incomplete"]) {
    const f = fixture({
      role: condition === "linked" ? "linked" : "owner",
      save: () => assert.fail("must not write"),
    });
    saveUserscriptDiary(f.storage, "owner", sampleExport());
    const previous = f.values.get(USERSCRIPT_CACHE);
    await assert.rejects(
      createUserscriptImporter(f).commit(
        condition === "incomplete" ? "{}" : sampleExport(),
        condition === "changed" ? "other" : "owner",
      ),
    );
    assert.equal(f.values.get(USERSCRIPT_CACHE), previous);
  }
});

test("a storage refusal is reported before any server write", async () => {
  const f = fixture({ save: () => assert.fail("must not write") });
  f.storage.setItem = () => false;
  await assert.rejects(
    createUserscriptImporter(f).commit(sampleExport(), "owner"),
    /не разрешил сохранить/,
  );
});

test("a hung upload is aborted and remains pending rather than claiming cloud success", async () => {
  let signal;
  const f = fixture({
    save: (_snapshot, options) => {
      signal = options.signal;
      return new Promise(() => {});
    },
  });
  const result = await createUserscriptImporter({ ...f, timeoutMs: 20 }).commit(
    sampleExport(),
    "owner",
  );
  assert.equal(result.cloudSaved, false);
  assert.equal(signal.aborted, true);
  assert.equal(readUserscriptDiary(f.storage, "owner").cloudPending, true);
});

test("the database repository rechecks the expected owner before issuing an upsert", async () => {
  const repository = createCloudDiaryRepository({
    auth: { getUser: async () => ({ data: { user: { id: "changed" } } }) },
    from: () => assert.fail("must not write to changed account"),
  });
  await assert.rejects(
    repository.save({ source: "e-schools.by" }, { expectedOwner: "owner" }),
    /Сеанс School/,
  );
});

test("a timed-out auth read cannot later create an anonymous account", async () => {
  const auth = deferred();
  const f = fixture();
  f.services.auth.getUser = () => auth.promise;
  await assert.rejects(
    createUserscriptImporter({ ...f, timeoutMs: 15 }).prepare(),
    /не ответил/,
  );
  auth.resolve(null);
  await flush();
  assert.equal(f.values.size, 0);
});

test("a changed session during access validation cannot replace the local diary", async () => {
  const f = fixture();
  const session = createOwnerSession("owner");
  f.services.auth.getCachedUser = async () => ({
    id: await session.getIdentity(),
  });
  f.services.auth.onChange = session.subscribeIdentity;
  f.services.devices.access = async () => {
    session.change("another-owner");
    session.change("owner");
    return { role: "owner" };
  };
  saveUserscriptDiary(f.storage, "owner", sampleExport());
  const before = f.values.get(USERSCRIPT_CACHE);
  await assert.rejects(
    createUserscriptImporter(f).commit(sampleExport(), "owner"),
    /Сеанс/,
  );
  assert.equal(f.values.get(USERSCRIPT_CACHE), before);
  assert.equal(session.active, 0);
});

test("an older preparation finishing late cannot overwrite a newer import from another importer", async () => {
  const auth = deferred();
  let calls = 0,
    writes = 0;
  const f = fixture({ save: async () => writes++ });
  f.services.auth.getUser = () =>
    ++calls === 1 ? auth.promise : Promise.resolve({ id: "owner" });
  const first = createUserscriptImporter(f).commit(sampleExport(), "owner");
  const rejection = assert.rejects(first, /новая попытка/);
  await flush();
  const next = JSON.parse(sampleExport());
  next.snapshot.network.lessons.body[0].slots[0].lesson_mark.mark = "10";
  const text = JSON.stringify(next);
  await createUserscriptImporter(f).commit(text, "owner");
  auth.resolve({ id: "owner" });
  await rejection;
  assert.equal(readUserscriptDiary(f.storage, "owner").text, text);
  assert.equal(writes, 1);
});

test("a late successful upload cannot clear the pending state of a newer failed upload", async () => {
  const upload = deferred();
  let calls = 0;
  const f = fixture({
    save: async () => {
      if (++calls === 1) return upload.promise;
      throw new Error("offline");
    },
  });
  const old = createUserscriptImporter(f).commit(sampleExport(), "owner");
  await flush();
  const value = JSON.parse(sampleExport());
  value.snapshot.network.lessons.body[0].slots[0].lesson_mark.mark = "10";
  const text = JSON.stringify(value);
  const next = await createUserscriptImporter(f).commit(text, "owner");
  assert.equal(next.cloudSaved, false);
  upload.resolve();
  await old;
  const cached = readUserscriptDiary(f.storage, "owner");
  assert.equal(cached.text, text);
  assert.equal(cached.cloudPending, true);
});

test("timing out a queued cloud auth read releases the queue; retry uploads once and late auth cannot write", async () => {
  const auth = deferred();
  const f = fixture();
  const session = createOwnerSession("owner");
  let authCalls = 0,
    writes = 0,
    databaseCalls = 0;
  const baseline = JSON.parse(sampleExport()).snapshot;
  baseline.network.lessons.body[0].slots[0].lesson_mark.mark = "8";
  const base = createCloudDiaryRepository({
    auth: {
      getUser: () =>
        ++authCalls === 1
          ? auth.promise
          : Promise.resolve({ data: { user: { id: "owner" } } }),
    },
    from() {
      databaseCalls++;
      const query = {
        select: () => query,
        eq: () => query,
        abortSignal: () => query,
        maybeSingle: async () => ({ data: { payload: baseline }, error: null }),
        upsert: () => query,
        single: async () => {
          writes++;
          return { data: {}, error: null };
        },
      };
      return query;
    },
  });
  f.services.diary = createDiaryHistoryRepository(
    base,
    { history: async () => [], saveEvents: async () => {} },
    session,
  );
  const importer = createUserscriptImporter({ ...f, timeoutMs: 25 });
  const first = await importer.commit(sampleExport(), "owner");
  assert.equal(first.cloudSaved, false);
  assert.equal(readUserscriptDiary(f.storage, "owner").cloudPending, true);
  assert.equal(await importer.retryUpload(), true);
  auth.resolve({ data: { user: { id: "owner" } } });
  await flush();
  assert.equal(writes, 1);
  assert.equal(databaseCalls, 2);
  assert.equal(readUserscriptDiary(f.storage, "owner").cloudPending, false);
  assert.equal(session.active, 0);
});

test("retrying from the previous owner's screen cannot submit the next owner's cache", async () => {
  const f = fixture({ save: () => assert.fail("foreign retry") });
  f.services.auth.getUser = async () => ({ id: "owner-b" });
  saveUserscriptDiary(f.storage, "owner-b", sampleExport());
  const previous = f.values.get(USERSCRIPT_CACHE);
  await assert.rejects(
    createUserscriptImporter(f).retryUpload("owner-a"),
    /Сеанс/,
  );
  assert.equal(f.values.get(USERSCRIPT_CACHE), previous);
});

test("the pre-collection revision persists across importer recreation and offline retry without rebasing", async () => {
  const context = {
    version: 2,
    revision: "00000000-0000-4000-8000-000000000001",
  };
  const writes = [];
  let offline = true;
  const f = fixture({
    save: async (_snapshot, options) => {
      writes.push(options.writeContext);
      if (offline) throw new TypeError("synthetic offline");
    },
  });
  f.services.diary.getWriteContext = async () => context;
  const importer = createUserscriptImporter(f);
  assert.deepEqual(await importer.getWriteContext("owner"), context);
  assert.equal(
    (await importer.commit(sampleExport(), "owner", { writeContext: context }))
      .cloudSaved,
    false,
  );
  assert.deepEqual(
    readUserscriptDiary(f.storage, "owner").writeContext,
    context,
  );
  f.services.diary.getWriteContext = () =>
    assert.fail("retry must not adopt a new revision");
  offline = false;
  assert.equal(await createUserscriptImporter(f).retryUpload("owner"), true);
  assert.deepEqual(writes, [context, context]);
  assert.equal(readUserscriptDiary(f.storage, "owner").cloudPending, false);
  assert.deepEqual(
    readUserscriptDiary(f.storage, "owner").writeContext,
    context,
  );
});

test("a revision conflict preserves the local export and remains actionable rather than claiming an offline success", async () => {
  const context = { version: 2, revision: null };
  const text = sampleExport();
  const f = fixture({
    save: async () => {
      throw Object.assign(new Error("synthetic conflict"), {
        code: "diary_snapshot_conflict",
      });
    },
  });
  await assert.rejects(
    createUserscriptImporter(f).commit(text, "owner", {
      writeContext: context,
    }),
    { code: "diary_snapshot_conflict" },
  );
  const cached = readUserscriptDiary(f.storage, "owner");
  assert.equal(cached.cloudPending, true);
  assert.equal(cached.text, text);
  assert.deepEqual(cached.writeContext, context);
  await assert.rejects(createUserscriptImporter(f).retryUpload("owner"), {
    code: "diary_snapshot_conflict",
  });
});

test("an old pending export is explicitly tagged as legacy so the new server can reject blind retries", async () => {
  const writes = [];
  const f = fixture({
    save: async (_snapshot, options) => writes.push(options.writeContext),
  });
  saveUserscriptDiary(f.storage, "owner", sampleExport());
  assert.equal(await createUserscriptImporter(f).retryUpload("owner"), true);
  assert.deepEqual(writes, [{ version: 1 }]);
});
