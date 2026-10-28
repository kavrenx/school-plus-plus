import assert from "node:assert/strict";
import test from "node:test";
import { createStartupDiaryLoad } from "../js/startup-history.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture({ getCachedUser } = {}) {
  const snapshot = deferred(),
    complete = deferred(),
    listeners = new Set();
  const states = [],
    changes = [];
  let owner = "owner-a",
    sameDiary = true;
  const auth = {
    getCachedUser: getCachedUser || (async () => ({ id: owner })),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const job = createStartupDiaryLoad({
    repository: {
      loadProgressively: () => ({
        snapshot: snapshot.promise,
        complete: complete.promise,
      }),
    },
    auth,
    ownerId: owner,
  });
  return {
    job,
    snapshot,
    complete,
    listeners,
    states,
    changes,
    finish: () =>
      job.finish({
        onState: (state) => states.push(state),
        onChanges: (events) => changes.push(events),
        isSameDiary: () => sameDiary,
      }),
    changeOwner(next) {
      owner = next;
      for (const fn of listeners)
        fn(
          next ? "SIGNED_IN" : "SIGNED_OUT",
          next ? { user: { id: next } } : null,
        );
    },
    changeDiary() {
      sameDiary = false;
    },
  };
}

test("history completes after the early snapshot and releases its auth listener", async () => {
  const f = fixture(),
    data = { payload: { source: "synthetic" } };
  const finishing = f.finish();
  f.snapshot.resolve(data);
  assert.deepEqual(await f.job.snapshot, data);
  assert.deepEqual(f.states, ["loading"]);
  assert.equal(f.changes.length, 0);
  f.complete.resolve({ ...data, changes: [{ id: "event" }] });
  await finishing;
  assert.deepEqual(f.states, ["loading", "ready"]);
  assert.deepEqual(f.changes, [[{ id: "event" }]]);
  assert.equal(f.listeners.size, 0);
  await f.finish();
  assert.equal(f.changes.length, 1);
});

test("owner A -> B -> A cannot use either phase of an old startup read", async () => {
  const f = fixture();
  f.changeOwner("owner-b");
  f.changeOwner("owner-a");
  f.snapshot.resolve({ payload: { source: "synthetic" } });
  f.complete.resolve({ changes: [{ id: "old-owner-event" }] });
  assert.equal(await f.job.snapshot, null);
  await f.finish();
  assert.deepEqual(f.states, []);
  assert.deepEqual(f.changes, []);
  assert.equal(f.listeners.size, 0);
});

test("same-owner auth notifications do not discard a valid read", async () => {
  const f = fixture();
  for (const listener of f.listeners) {
    listener("INITIAL_SESSION", { user: { id: "owner-a" } });
    listener("TOKEN_REFRESHED", { user: { id: "owner-a" } });
    listener("SIGNED_IN", { user: { id: "owner-a" } });
  }
  f.snapshot.resolve({ payload: { source: "synthetic" } });
  assert.ok((await f.job.snapshot).payload);
  f.complete.resolve({ changes: [] });
  await f.finish();
  assert.deepEqual(f.states, ["loading", "ready"]);
  assert.equal(f.listeners.size, 0);
});

test("a session change while checking the early snapshot prevents displaying it", async () => {
  const user = deferred(),
    f = fixture({ getCachedUser: () => user.promise });
  f.snapshot.resolve({ payload: { source: "synthetic" } });
  await Promise.resolve();
  f.changeOwner(null);
  user.resolve({ id: "owner-a" });
  assert.equal(await f.job.snapshot, null);
  f.complete.resolve({ changes: [] });
  await f.finish();
  assert.equal(f.listeners.size, 0);
});

test("page cancellation and a different diary both discard late history without importing it", async () => {
  for (const cancel of [false, true]) {
    const f = fixture();
    f.snapshot.resolve({ payload: { source: "synthetic" } });
    await f.job.snapshot;
    const finishing = f.finish();
    if (cancel) f.job.cancel();
    else f.changeDiary();
    f.complete.resolve({ changes: [{ id: "late" }] });
    await finishing;
    assert.deepEqual(f.changes, []);
    assert.deepEqual(f.states, ["loading"]);
    assert.equal(f.listeners.size, 0);
  }
});

test("history failure shows an unavailable state while preserving already displayed data", async () => {
  for (const rejected of [false, true]) {
    const f = fixture();
    f.snapshot.resolve({ payload: { source: "synthetic" } });
    assert.ok((await f.job.snapshot).payload);
    const finishing = f.finish();
    if (rejected) f.complete.reject(Error("private server details"));
    else f.complete.resolve({ payload: { source: "synthetic" } });
    await finishing;
    assert.deepEqual(f.states, ["loading", "unavailable"]);
    assert.deepEqual(f.changes, []);
    assert.equal(f.listeners.size, 0);
  }
});

test("failed session checks cannot import history and cleanup also covers synchronous repository failure", async () => {
  const f = fixture({
    getCachedUser: async () => {
      throw Error("blocked session");
    },
  });
  f.snapshot.resolve({ payload: { source: "synthetic" } });
  await assert.rejects(f.job.snapshot, /blocked session/);
  const finishing = f.finish();
  f.complete.resolve({ changes: [{ id: "not-allowed" }] });
  await finishing;
  assert.deepEqual(f.changes, []);
  assert.equal(f.listeners.size, 0);
  let unsubscribed = false;
  assert.throws(
    () =>
      createStartupDiaryLoad({
        ownerId: "owner",
        auth: {
          onChange: () => () => {
            unsubscribed = true;
          },
        },
        repository: {
          loadProgressively: () => {
            throw Error("failed");
          },
        },
      }),
    /failed/,
  );
  assert.equal(unsubscribed, true);
});
