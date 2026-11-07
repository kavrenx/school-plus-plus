import assert from "node:assert/strict";
import test from "node:test";
import {
  bindAndroidDiarySync,
  startAndroidDiarySync,
} from "../js/android-diary-sync.js";
import { createSyntheticUserscriptExport } from "./helpers/userscript-export.js";

const revision = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const attempt = `schoolpp-android-sync-v1:${"a".repeat(32)}`;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function exportDiary(edit = () => {}) {
  const value = JSON.parse(createSyntheticUserscriptExport());
  value.snapshot.import.transport = "android";
  edit(value);
  return JSON.stringify(value);
}

function fixture({ role = "unpaired", version = 2 } = {}) {
  let user = { id: "schoolpp-owner" };
  let notify;
  const calls = [];
  const messages = [];
  const port = {
    closed: false,
    postMessage: (message) => messages.push(message),
    close: () => {
      port.closed = true;
    },
  };
  const services = {
    auth: {
      getUser: async () => user,
      getCachedUser: async () => user,
      onChange: (listener) => {
        notify = listener;
        return () => {
          notify = null;
        };
      },
    },
    devices: { access: async () => ({ role }) },
    diary: {
      getWriteContext: async ({ expectedOwner }) => {
        calls.push(["prepare", expectedOwner]);
        return { version, revision };
      },
      save: async (snapshot, options) => {
        calls.push(["save", snapshot, options]);
      },
    },
  };
  return {
    services,
    port,
    calls,
    messages,
    change(id) {
      user = { id };
      notify?.("SIGNED_IN", { user });
    },
  };
}

test("Android fixes the owner and revision before collection and acknowledges only confirmed saves", async () => {
  const f = fixture();
  let confirm;
  const save = f.services.diary.save;
  f.services.diary.save = async (...args) => {
    await save(...args);
    await new Promise((resolve) => (confirm = resolve));
  };
  let opened = false;
  startAndroidDiarySync({ ...f, onSaved: () => (opened = true) });
  await tick();
  assert.deepEqual(f.messages, ["ready"]);
  assert.deepEqual(f.calls, [["prepare", "schoolpp-owner"]]);
  f.port.onmessage({ data: exportDiary() });
  await tick();
  assert.deepEqual(f.messages, ["ready"]);
  assert.equal(opened, false);
  const [, snapshot, options] = f.calls[1];
  assert.equal(snapshot.import.transport, "android");
  assert.equal(options.expectedOwner, "schoolpp-owner");
  assert.deepEqual(options.writeContext, { version: 2, revision });
  confirm();
  await tick();
  assert.deepEqual(f.messages, ["ready", "saved"]);
  assert.equal(opened, true);
  assert.equal(f.port.closed, true);
});

test("Android rejects linked devices and requires a versioned writer", async () => {
  for (const [options, error] of [
    [{ role: "linked" }, "linked_device"],
    [{ version: 1 }, "diary_write_context_required"],
  ]) {
    const f = fixture(options);
    startAndroidDiarySync(f);
    await tick();
    f.port.onmessage({ data: exportDiary() });
    assert.deepEqual(f.messages, [`error:${error}`]);
    assert.ok(f.calls.every(([action]) => action !== "save"));
    assert.equal(f.port.closed, true);
  }
});

test("Android rejects incomplete, foreign transport and mismatched week exports before save", async () => {
  for (const edit of [
    (value) => (value.snapshot.import.complete = false),
    (value) => (value.snapshot.import.transport = "userscript"),
    (value) => (value.snapshot.import.expectedWeeks = 2),
    (value) => (value.report.checks.collection.failedWeeks = 1),
  ]) {
    const f = fixture();
    startAndroidDiarySync(f);
    await tick();
    f.port.onmessage({ data: exportDiary(edit) });
    await tick();
    assert.deepEqual(f.messages, ["ready", "error:invalid_snapshot"]);
    assert.equal(f.calls.length, 1);
  }
});

test("Android cannot commit after a transient owner change or cancellation", async () => {
  for (const cancel of [
    (f) => {
      f.change("different-owner");
      f.change("schoolpp-owner");
    },
    (f) => f.port.onmessage({ data: "cancel" }),
  ]) {
    const f = fixture();
    startAndroidDiarySync(f);
    await tick();
    cancel(f);
    f.port.onmessage({ data: exportDiary() });
    await tick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.port.closed, true);
    assert.ok(!f.messages.includes("saved"));
  }
});

test("Android cancels an outstanding save and cannot acknowledge a late result", async () => {
  const f = fixture();
  let finish;
  const save = f.services.diary.save;
  f.services.diary.save = async (...args) => {
    await save(...args);
    await new Promise((resolve) => (finish = resolve));
  };
  startAndroidDiarySync(f);
  await tick();
  f.port.onmessage({ data: exportDiary() });
  await tick();
  f.port.onmessage({ data: "cancel" });
  assert.equal(f.calls[1][2].signal.aborted, true);
  finish();
  await tick();
  assert.deepEqual(f.messages, ["ready"]);
});

test("Android forwards a revision conflict without silently retrying the write", async () => {
  const f = fixture();
  const save = f.services.diary.save;
  f.services.diary.save = async (...args) => {
    await save(...args);
    throw Object.assign(new Error("conflict"), {
      code: "diary_snapshot_conflict",
    });
  };
  startAndroidDiarySync(f);
  await tick();
  f.port.onmessage({ data: exportDiary() });
  await tick();
  assert.deepEqual(f.messages, ["ready", "error:diary_snapshot_conflict"]);
  assert.equal(f.calls.length, 2);
});

test("Android bridge accepts only the native top-level channel and closes it when the page leaves", async () => {
  const f = fixture();
  const handlers = {};
  const windowRef = {
    addEventListener: (type, fn) => (handlers[type] = fn),
  };
  windowRef.top = windowRef;
  bindAndroidDiarySync(windowRef, f);
  const bootstrap = {
    isTrusted: true,
    source: null,
    data: attempt,
    ports: [f.port],
  };
  for (const invalid of [
    { isTrusted: false },
    { source: {} },
    { ports: [] },
    { data: "invalid" },
  ]) {
    handlers.message({ ...bootstrap, ...invalid });
  }
  await tick();
  assert.deepEqual(f.messages, []);
  handlers.message(bootstrap);
  await tick();
  assert.deepEqual(f.messages, ["ready"]);
  handlers.pagehide();
  assert.equal(f.port.closed, true);
});
