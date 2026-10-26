import assert from "node:assert/strict";
import test from "node:test";
import {
  createUserscriptDiaryStorage,
  USERSCRIPT_CACHE,
} from "../js/userscript-client.js";
import { createUserscriptImporter } from "../js/userscript-import.js";
import { createSyntheticUserscriptExport } from "./helpers/userscript-export.js";

function fixture() {
  const values = new Map();
  let parses = 0;
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => {
      values.set(key, value);
      return true;
    },
  };
  const diary = createUserscriptDiaryStorage(storage, {
    measure: (stage, run) => {
      if (stage === "export_parse") parses++;
      return run();
    },
  });
  return {
    storage,
    diary,
    values,
    get parses() {
      return parses;
    },
  };
}

test("one sync parses an unchanged export once while every read checks the stored envelope", () => {
  const f = fixture(),
    text = createSyntheticUserscriptExport();
  f.diary.parse(text);
  f.diary.save("owner", text, { now: 10 });
  f.diary.read("owner", 10);
  f.diary.save("owner", text, { now: 10, cloudPending: false });
  assert.equal(f.diary.read("owner", 10).cloudPending, false);
  assert.equal(f.parses, 1);
  const saved = JSON.parse(f.values.get(USERSCRIPT_CACHE));
  f.values.set(USERSCRIPT_CACHE, JSON.stringify({ ...saved, userId: "other" }));
  assert.equal(f.diary.read("owner", 10), null);
  assert.ok(f.diary.read("other", 10));
  assert.equal(f.parses, 2);
  f.values.delete(USERSCRIPT_CACHE);
  assert.equal(f.diary.read("other", 10), null);
});

test("changed, incomplete, future-dated and damaged stored copies cannot reuse validation", () => {
  const f = fixture();
  f.diary.save("owner", createSyntheticUserscriptExport(), { now: 10 });
  const original = JSON.parse(f.values.get(USERSCRIPT_CACHE));
  const changed = createSyntheticUserscriptExport({ mark: "7" });
  f.values.set(
    USERSCRIPT_CACHE,
    JSON.stringify({ ...original, text: changed }),
  );
  assert.equal(f.diary.read("owner", 10).summary.recognizedMarks, 5);
  assert.equal(f.parses, 2);
  const incomplete = JSON.parse(changed);
  incomplete.snapshot.import.complete = false;
  for (const value of [
    JSON.stringify({ ...original, text: JSON.stringify(incomplete) }),
    JSON.stringify({ ...original, savedAt: 11 }),
    "{damaged",
  ]) {
    f.values.set(USERSCRIPT_CACHE, value);
    assert.equal(f.diary.read("owner", 10), null);
  }
});

test("callers cannot mutate the privately validated snapshot or model", () => {
  const f = fixture(),
    text = createSyntheticUserscriptExport();
  const parsed = f.diary.parse(text);
  parsed.snapshot.import.complete = false;
  parsed.data.journalEntries[0].grades = ["1"];
  const saved = f.diary.save("owner", text);
  saved.snapshot.import.complete = false;
  const read = f.diary.read("owner");
  assert.equal(read.snapshot.import.complete, true);
  assert.deepEqual(read.data.journalEntries[0].grades, ["9", "9"]);
  read.data.journalEntries.length = 0;
  assert.equal(f.diary.read("owner").data.journalEntries.length, 5);
  assert.equal(f.parses, 1);
});

test("a shared sync store preserves owner checks and a newer pending upload", async () => {
  const f = fixture(),
    old = createSyntheticUserscriptExport(),
    newer = createSyntheticUserscriptExport({ mark: "7" });
  let finish,
    writes = 0;
  const services = {
    auth: { getUser: async () => ({ id: "owner" }) },
    devices: { access: async () => ({ role: "owner" }) },
    diary: {
      save: async () => {
        writes++;
        await new Promise((resolve) => {
          finish = resolve;
        });
      },
    },
  };
  const importer = createUserscriptImporter({
    ...f,
    services,
    diaryStorage: f.diary,
  });
  const pending = importer.commit(old, "owner");
  await new Promise((resolve) => setImmediate(resolve));
  f.diary.save("owner", newer);
  finish();
  assert.equal((await pending).cloudSaved, true);
  assert.equal(f.diary.read("owner").text, newer);
  assert.equal(f.diary.read("owner").cloudPending, true);
  await assert.rejects(importer.commit(newer, "other"), /Сеанс School/);
  assert.equal(writes, 1);
});
