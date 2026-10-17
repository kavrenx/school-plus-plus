import assert from "node:assert/strict";
import test from "node:test";
import { createUserscriptImporter } from "../js/userscript-import.js";
import {
  readUserscriptDiary,
  saveUserscriptDiary,
  USERSCRIPT_CACHE,
} from "../js/userscript-client.js";
import { createCloudDiaryRepository } from "../js/cloud-diary-repository.js";

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
