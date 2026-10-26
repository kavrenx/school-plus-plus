import assert from "node:assert/strict";
import test from "node:test";
import { createSyncTimings, SYNC_TIMINGS_KEY } from "../js/sync-timings.js";

function fixture(search = "", values = new Map()) {
  let time = 0;
  const windowRef = {
    location: {
      href: `https://schoolpp.invalid/userscripts-sync.html${search}`,
    },
    performance: { now: () => time },
    sessionStorage: {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };
  return {
    windowRef,
    values,
    tick: (ms) => {
      time += ms;
    },
  };
}

test("timing is opt-in and preserves synchronous and asynchronous results and errors", async () => {
  const off = fixture(),
    normal = createSyncTimings(off.windowRef);
  normal.begin();
  assert.equal(
    normal.measure("cache_read", () => 7),
    7,
  );
  assert.equal(off.values.size, 0);
  const f = fixture("?syncTiming=1"),
    timing = createSyncTimings(f.windowRef);
  timing.begin();
  assert.equal(
    timing.measure("export_parse", () => {
      f.tick(3.25);
      return 9;
    }),
    9,
  );
  assert.equal(
    await timing.measure("cloud_save", async () => {
      f.tick(100);
      return 11;
    }),
    11,
  );
  const failure = new Error("private error / token / student");
  assert.throws(
    () =>
      timing.measure("cache_read", () => {
        throw failure;
      }),
    (error) => error === failure,
  );
  await assert.rejects(
    timing.measure("bridge_ping", async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  const report = JSON.parse(timing.text());
  assert.equal(report.timings.length, 4);
  assert.equal(report.timings[0].ms, 3.3);
  assert.deepEqual(
    report.timings.slice(-2).map((entry) => entry.status),
    ["error", "error"],
  );
  assert.doesNotMatch(timing.text(), /private|token|student/);
});

test("a same-tab return restores only bounded allowlisted timings and can disable them", () => {
  const f = fixture("?syncTiming=1"),
    timing = createSyncTimings(f.windowRef);
  timing.begin();
  for (let i = 0; i < 80; i++) timing.record("cache_read", i);
  timing.record("private-user-id", 1);
  timing.record("cache_read", Infinity);
  const value = JSON.parse(f.values.get(SYNC_TIMINGS_KEY));
  value.token = "PRIVATE_TOKEN";
  value.timings[0].payload = "PRIVATE_DIARY";
  value.timings.push({ stage: "PRIVATE_NAME", ms: 1, status: "ok" });
  f.values.set(SYNC_TIMINGS_KEY, JSON.stringify(value));
  const returned = createSyncTimings(
    fixture("?returned=1", f.values).windowRef,
  );
  returned.finish("complete");
  assert.equal(returned.enabled, true);
  assert.equal(JSON.parse(returned.text()).timings.length, 60);
  assert.doesNotMatch(returned.text(), /PRIVATE/);
  assert.equal(JSON.parse(returned.text()).outcome, "complete");
  assert.equal(
    createSyncTimings(fixture("?syncTiming=0", f.values).windowRef).enabled,
    false,
  );
  assert.equal(
    createSyncTimings(fixture("?returned=1", f.values).windowRef).enabled,
    false,
  );
});

test("expired reports and storage failures cannot block synchronization", () => {
  const f = fixture();
  f.values.set(
    SYNC_TIMINGS_KEY,
    JSON.stringify({
      version: 1,
      startedAt: Date.now() - 16 * 60000,
      timings: [],
    }),
  );
  assert.equal(createSyncTimings(f.windowRef).enabled, false);
  const denied = fixture("?syncTiming=1");
  Object.defineProperty(denied.windowRef, "sessionStorage", {
    get() {
      throw new Error("denied");
    },
  });
  const timing = createSyncTimings(denied.windowRef);
  timing.begin();
  assert.equal(
    timing.measure("cache_read", () => "available"),
    "available",
  );
  timing.finish("failed");
  assert.equal(JSON.parse(timing.text()).outcome, "failed");
});
