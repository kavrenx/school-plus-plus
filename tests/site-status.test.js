import assert from "node:assert/strict";
import test from "node:test";

import {
  createSiteStatusRepository,
  createSiteStatusWatcher,
  normalizeStatus,
} from "../js/site-status.js";

test("public site status normalizes missing and enabled values", () => {
  assert.deepEqual(normalizeStatus(null), {
    maintenanceEnabled: false,
    updatedAt: null,
  });
  assert.deepEqual(
    normalizeStatus({ maintenanceEnabled: true, updatedAt: "2026-09-26" }),
    { maintenanceEnabled: true, updatedAt: "2026-09-26" },
  );
});

test("site status repository reads only the public status RPC", async () => {
  const calls = [];
  const repository = createSiteStatusRepository({
    async rpc(name) {
      calls.push(name);
      return {
        data: { maintenanceEnabled: true, updatedAt: null },
        error: null,
      };
    },
  });

  assert.equal((await repository.get()).maintenanceEnabled, true);
  assert.deepEqual(calls, ["get_public_site_status"]);
});

test("site status watcher reports maintenance transitions without duplicates", async () => {
  const listeners = new Map();
  const changes = [];
  const statuses = [true, true, false];
  const windowRef = {
    clearTimeout() {},
    setTimeout() {
      return 1;
    },
    document: {
      hidden: false,
      addEventListener(name, listener) {
        listeners.set(name, listener);
      },
      removeEventListener(name) {
        listeners.delete(name);
      },
    },
  };
  const watcher = createSiteStatusWatcher({
    repository: {
      async get() {
        return normalizeStatus({ maintenanceEnabled: statuses.shift() });
      },
    },
    windowRef,
    onChange(status) {
      changes.push(status.maintenanceEnabled);
    },
  });

  watcher.start({ maintenanceEnabled: false });
  await watcher.check();
  await watcher.check();
  await watcher.check();

  assert.deepEqual(changes, [true, false]);
  assert.equal(listeners.has("visibilitychange"), true);
  watcher.stop();
  assert.equal(listeners.has("visibilitychange"), false);
});
