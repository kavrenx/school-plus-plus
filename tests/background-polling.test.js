import assert from "node:assert/strict";
import test from "node:test";
import { createSiteStatusWatcher } from "../js/site-status.js";
import {
  createDeviceRepository,
  createDiaryRevisionWatcher,
} from "../js/device-repository.js";
import { createDeviceController } from "../js/device-controller.js";
import { createPollingWindow } from "./helpers/polling-window.js";

test("an unchanged snapshot with absent SQL history does not download again on the first poll", async () => {
  for (const empty of [null, undefined, ""]) {
    const f = createPollingWindow();
    let downloads = 0;
    const watcher = createDiaryRevisionWatcher({
      windowRef: f.window,
      initialAccess: { role: "owner" },
      initialRevision: "snapshot-1",
      repository: {
        revision: async () => ({
          access: { role: "owner" },
          updatedAt: "snapshot-1",
          changesUpdatedAt: empty,
        }),
      },
      onUpdate: () => downloads++,
    });
    try {
      watcher.start();
      await f.advance(10_000);
      assert.equal(downloads, 0);
    } finally {
      watcher.stop();
      await f.window.happyDOM.close();
    }
  }
});

test("normalizing absent history still detects existing, newly created, removed history and changed snapshots", async () => {
  const f = createPollingWindow();
  const next = {
    access: { role: "owner" },
    updatedAt: "snapshot-1",
    changesUpdatedAt: "history-1",
  };
  let downloads = 0;
  const watcher = createDiaryRevisionWatcher({
    windowRef: f.window,
    initialAccess: next.access,
    initialRevision: next.updatedAt,
    initialChangesRevision: null,
    repository: { revision: async () => next },
    onUpdate: () => downloads++,
  });
  try {
    watcher.start();
    await watcher.check();
    assert.equal(downloads, 1); // Unknown existing history must still be read.
    next.changesUpdatedAt = null;
    await watcher.check();
    assert.equal(downloads, 2);
    next.changesUpdatedAt = undefined;
    await watcher.check();
    assert.equal(downloads, 2);
    next.changesUpdatedAt = "history-2";
    await watcher.check();
    assert.equal(downloads, 3);
    next.updatedAt = "snapshot-2";
    await watcher.check();
    assert.equal(downloads, 4);
  } finally {
    watcher.stop();
    await f.window.happyDOM.close();
  }
});

test("public status pauses in background, wakes immediately and keeps its foreground cadence", async () => {
  const f = createPollingWindow();
  let calls = 0;
  const changes = [];
  const watcher = createSiteStatusWatcher({
    windowRef: f.window,
    repository: {
      async get() {
        calls++;
        return { maintenanceEnabled: true };
      },
    },
    onChange: (status) => changes.push(status.maintenanceEnabled),
  });
  try {
    watcher.start();
    f.visibility(true);
    await watcher.check();
    await f.advance(600_000);
    assert.equal(calls, 0);
    assert.equal(f.timers.size, 0);
    f.visibility(false);
    await f.flush();
    assert.equal(calls, 1);
    assert.deepEqual(changes, [true]);
    await f.advance(60_000);
    assert.equal(calls, 5);
    assert.equal(f.timers.size, 1);
    watcher.stop();
    f.visibility(false);
    f.window.dispatchEvent(new f.window.Event("online"));
    f.page("pageshow");
    await f.advance(60_000);
    assert.equal(calls, 5);
    assert.equal(f.timers.size, 0);
  } finally {
    watcher.stop();
    await f.window.happyDOM.close();
  }
});

test("public status resumes from BFCache and discards older responses and stopped work", async () => {
  const f = createPollingWindow();
  const pending = [];
  const changes = [];
  const watcher = createSiteStatusWatcher({
    windowRef: f.window,
    repository: { get: () => new Promise((resolve) => pending.push(resolve)) },
    onChange: (status) => changes.push(status.maintenanceEnabled),
  });
  try {
    watcher.start();
    const old = watcher.check();
    f.page("pagehide");
    await f.advance(60_000);
    assert.equal(pending.length, 1);
    assert.equal(f.timers.size, 0);
    f.page("pageshow");
    assert.equal(pending.length, 2);
    pending[1]({ maintenanceEnabled: true });
    await f.flush();
    pending[0]({ maintenanceEnabled: false });
    await old;
    assert.deepEqual(changes, [true]);
    assert.equal(f.timers.size, 1);
    const late = watcher.check();
    watcher.stop();
    pending[2]({ maintenanceEnabled: false });
    await late;
    assert.deepEqual(changes, [true]);
    assert.equal(f.timers.size, 0);
  } finally {
    watcher.stop();
    await f.window.happyDOM.close();
  }
});

test("public status coalesces wake events and retries a failed request on the usual interval", async () => {
  const f = createPollingWindow();
  let calls = 0,
    reject;
  const watcher = createSiteStatusWatcher({
    windowRef: f.window,
    repository: {
      get() {
        calls++;
        if (calls === 1)
          return new Promise((_, fail) => {
            reject = fail;
          });
        return Promise.resolve({ maintenanceEnabled: false });
      },
    },
  });
  try {
    watcher.start();
    const first = watcher.check();
    for (let i = 0; i < 5; i++) {
      f.visibility(false);
      f.window.dispatchEvent(new f.window.Event("online"));
    }
    await f.advance(60_000);
    assert.equal(calls, 1);
    assert.equal(f.timers.size, 0);
    reject(new Error("offline"));
    assert.equal(await first, null);
    assert.equal(f.timers.size, 1);
    await f.advance(15_000);
    assert.equal(calls, 2);
  } finally {
    watcher.stop();
    await f.window.happyDOM.close();
  }
});

test("revision checks keep server authorization and the five-second revocation check after background pause", async () => {
  const f = createPollingWindow();
  let auth = 0,
    rpc = 0,
    revoked = 0;
  const repository = createDeviceRepository({
    auth: {
      async getUser() {
        auth++;
        return { data: { user: { id: "synthetic-member" } } };
      },
    },
    async rpc(name) {
      assert.equal(name, "get_my_diary_revision");
      rpc++;
      return {
        data: {
          access:
            rpc < 3
              ? { role: "linked", ownerId: "synthetic-owner" }
              : { role: "unpaired" },
        },
        error: null,
      };
    },
  });
  const watcher = createDiaryRevisionWatcher({
    windowRef: f.window,
    repository,
    initialAccess: { role: "linked", ownerId: "synthetic-owner" },
    onUpdate: () => assert.fail("unchanged snapshot"),
    onRevoked: () => revoked++,
  });
  try {
    watcher.start();
    f.visibility(true);
    await f.advance(600_000);
    assert.equal(auth, 0);
    assert.equal(f.timers.size, 0);
    f.visibility(false);
    await f.flush();
    assert.equal(auth, 1);
    await f.advance(10_000);
    assert.equal(rpc, 3);
    assert.equal(auth, rpc);
    assert.equal(revoked, 1);
    assert.equal(f.timers.size, 0);
  } finally {
    watcher.stop();
    await f.window.happyDOM.close();
  }
});

test("revision wake events do not fork timers while a request is pending; old runs cannot revoke a restarted watcher", async () => {
  const f = createPollingWindow();
  const pending = [];
  const access = { role: "linked", ownerId: "synthetic-owner" };
  let updates = 0;
  const watcher = createDiaryRevisionWatcher({
    windowRef: f.window,
    repository: {
      revision: () =>
        new Promise((resolve, reject) => pending.push({ resolve, reject })),
    },
    initialAccess: access,
    onUpdate: () => updates++,
    onRevoked: () => assert.fail("obsolete revocation"),
    onError: () => assert.fail("obsolete error"),
  });
  try {
    watcher.start();
    const first = watcher.check();
    for (let i = 0; i < 5; i++) f.visibility(false);
    await f.advance(60_000);
    assert.equal(pending.length, 1);
    assert.equal(f.timers.size, 0);
    watcher.stop();
    watcher.start();
    const second = watcher.check();
    pending[1].resolve({ access, updatedAt: "new", changesUpdatedAt: "" });
    await second;
    pending[0].resolve({ access: { role: "unpaired" } });
    await first;
    assert.equal(updates, 1);
    assert.equal(f.timers.size, 1);
    const oldError = watcher.check();
    watcher.stop();
    watcher.start();
    pending[2].reject(new Error("old network failure"));
    await oldError;
    assert.equal(f.timers.size, 1);
  } finally {
    watcher.stop();
    await f.window.happyDOM.close();
  }
});

test("device discovery pauses its timer in background but resumes pending owner approval immediately", async () => {
  const f = createPollingWindow();
  let calls = 0;
  let pairChecks = 0;
  const pending = [];
  const controller = createDeviceController({
    root: f.window.document,
    windowRef: f.window,
    repositoryProvider: async () => ({
      pairing: async (id) => {
        assert.equal(id, "synthetic-request");
        pairChecks++;
        return { id, status: "pending", verificationCode: "ABCD" };
      },
      list() {
        calls++;
        return new Promise((resolve) => pending.push(resolve));
      },
    }),
  });
  controller.bind();
  try {
    controller.start();
    f.visibility(true);
    await f.advance(600_000);
    assert.equal(calls, 0);
    assert.equal(f.timers.size, 0);
    f.visibility(false);
    await f.flush();
    for (let i = 0; i < 5; i++) f.visibility(false);
    await f.advance(60_000);
    assert.equal(calls, 1);
    assert.equal(f.timers.size, 0);
    pending[0]({
      access: { role: "owner" },
      devices: [],
      pending: {
        id: "synthetic-request",
        status: "pending",
        verificationCode: "ABCD",
      },
    });
    await f.flush();
    assert.match(
      f.window.document.querySelector(".device-verification").textContent,
      /ABCD/,
    );
    // Pending approval retains its fast 2-second polling.
    await f.advance(2_000);
    assert.equal(calls, 1);
    assert.equal(pairChecks, 1);
    assert.equal(f.timers.size, 1);
  } finally {
    controller.stop();
    await f.window.happyDOM.close();
  }
});
