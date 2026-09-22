import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function createEvent() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    listeners,
  };
}

function createBackgroundHarness() {
  const values = new Map();
  const alarms = new Map();
  const createdTabs = [];
  const removedTabs = [];
  const updatedTabs = [];
  const reloadedTabs = [];
  const queryTabs = [];
  const notifications = [];
  const runtimeMessage = createEvent();
  const alarmEvent = createEvent();
  const notificationClick = createEvent();
  const chrome = {
    runtime: {
      onMessage: runtimeMessage,
      onInstalled: createEvent(),
      onStartup: createEvent(),
      getURL: (path) => `chrome-extension://schoolpp/${path}`,
    },
    storage: {
      local: {
        async get(key) {
          if (Array.isArray(key))
            return Object.fromEntries(
              key.map((name) => [name, values.get(name)]),
            );
          return { [key]: values.get(key) };
        },
        async set(next) {
          Object.entries(next).forEach(([key, value]) =>
            values.set(key, value),
          );
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys])
            values.delete(key);
        },
      },
    },
    alarms: {
      onAlarm: alarmEvent,
      async create(name, details) {
        alarms.set(name, {
          ...details,
          scheduledTime:
            details.when ?? Date.now() + details.delayInMinutes * 60_000,
        });
      },
      async get(name) {
        return alarms.has(name) ? { name, ...alarms.get(name) } : undefined;
      },
      async clear(name) {
        return alarms.delete(name);
      },
    },
    tabs: {
      async query(details = {}) {
        const patterns = Array.isArray(details.url)
          ? details.url
          : [details.url];
        if (!details.url) return queryTabs;
        return queryTabs.filter((tab) =>
          patterns.some((pattern) =>
            String(tab.url || "").startsWith(
              String(pattern).replace(/\*$/, ""),
            ),
          ),
        );
      },
      async create(details) {
        const tab = { id: 91 + createdTabs.length, ...details };
        createdTabs.push(tab);
        return tab;
      },
      async remove(tabId) {
        removedTabs.push(tabId);
      },
      async update(tabId, details) {
        updatedTabs.push({ tabId, ...details });
        return { id: tabId, ...details };
      },
      async reload(tabId) {
        reloadedTabs.push(tabId);
      },
      async sendMessage() {
        return { ok: true };
      },
    },
    notifications: {
      onClicked: notificationClick,
      async create(id, details) {
        notifications.push({ id, ...details });
        return id;
      },
      async clear() {
        return true;
      },
    },
    windows: {
      async update() {
        return {};
      },
    },
  };
  const context = vm.createContext({ chrome, console, Date, TextEncoder });
  for (const path of [
    "../extension/shared/snapshot-store.js",
    "../extension/shared/extension-settings.js",
    "../extension/background.js",
  ])
    vm.runInContext(
      readFileSync(new URL(path, import.meta.url), "utf8"),
      context,
    );

  async function send(message, sender = {}) {
    return new Promise((resolve) => {
      runtimeMessage.listeners[0](message, sender, resolve);
    });
  }

  async function settle() {
    for (let index = 0; index < 3; index += 1)
      await new Promise((resolve) => setImmediate(resolve));
  }

  return {
    alarmEvent,
    alarms,
    createdTabs,
    notifications,
    queryTabs,
    reloadedTabs,
    removedTabs,
    send,
    settle,
    updatedTabs,
    values,
  };
}

test("background updating waits for the first sync and can be disabled", async () => {
  const harness = createBackgroundHarness();
  await harness.settle();
  const status = await harness.send({ type: "SCHOOLPP_GET_STATUS" });
  assert.equal(status.settings.backgroundSync, true);
  assert.equal(harness.alarms.has("schoolpp_auto_sync"), false);

  await harness.send({
    type: "SCHOOLPP_SYNC_PROGRESS",
    progress: { phase: "success", label: "Синхронизация завершена" },
  });
  assert.ok(harness.alarms.has("schoolpp_auto_sync"));
  const syncState = harness.values.get("schoolpp_sync_state");
  assert.equal(
    Date.parse(syncState.nextSyncAt) - Date.parse(syncState.lastSyncAt),
    15 * 60_000,
  );
  assert.equal(
    harness.alarms.get("schoolpp_auto_sync").periodInMinutes,
    undefined,
  );
  assert.equal(
    Number.isFinite(harness.alarms.get("schoolpp_auto_sync").when),
    true,
  );

  const disabled = await harness.send({
    type: "SCHOOLPP_SET_SETTINGS",
    settings: { backgroundSync: false },
  });
  assert.equal(disabled.settings.backgroundSync, false);
  assert.equal(harness.alarms.has("schoolpp_auto_sync"), false);
});

test("background updating opens an inactive diary tab and closes it after sync", async () => {
  const harness = createBackgroundHarness();
  await harness.settle();
  await harness.send({
    type: "SCHOOLPP_SYNC_PROGRESS",
    progress: { phase: "success", label: "Первая синхронизация завершена" },
  });
  harness.alarmEvent.listeners[0]({ name: "schoolpp_auto_sync" });
  await harness.settle();

  assert.equal(harness.createdTabs.length, 2);
  assert.equal(
    harness.createdTabs[0].url,
    "https://schoolpp.com/?extension-sync=background",
  );
  assert.equal(harness.createdTabs[1].id, 92);
  assert.equal(harness.createdTabs[1].url, "https://diary.e-schools.by/");
  assert.equal(harness.createdTabs[1].active, false);
  assert.equal(harness.values.get("schoolpp_background_tab").id, 92);

  await harness.send(
    {
      type: "SCHOOLPP_SYNC_PROGRESS",
      progress: { phase: "success", label: "Синхронизация завершена" },
    },
    { tab: { id: 92 } },
  );
  assert.deepEqual(harness.removedTabs, [92]);
  assert.equal(harness.values.has("schoolpp_background_tab"), false);
  assert.deepEqual(harness.notifications, []);
  const syncState = harness.values.get("schoolpp_sync_state");
  assert.equal(
    harness.alarms.get("schoolpp_auto_sync").when,
    Date.parse(syncState.nextSyncAt),
  );

  await harness.send(
    { type: "SCHOOLPP_CLOUD_IMPORT_COMPLETE" },
    { tab: { id: 91 } },
  );
  assert.deepEqual(harness.removedTabs, [92, 91]);
});

test("scheduled alarm starts syncing even at the edge of the saved deadline", async () => {
  const harness = createBackgroundHarness();
  await harness.settle();
  harness.values.set("schoolpp_sync_state", {
    phase: "idle",
    lastSyncAt: new Date(Date.now() - 120_000).toISOString(),
    nextSyncAt: new Date(Date.now() + 2_000).toISOString(),
  });

  harness.alarmEvent.listeners[0]({ name: "schoolpp_auto_sync" });
  await harness.settle();

  assert.equal(harness.createdTabs.length, 1);
  assert.equal(harness.createdTabs[0].active, false);
});

test("a background timeout closes the tab and creates one notification", async () => {
  const harness = createBackgroundHarness();
  await harness.settle();
  await harness.send({
    type: "SCHOOLPP_SYNC_PROGRESS",
    progress: { phase: "success", label: "Первая синхронизация завершена" },
  });
  harness.alarmEvent.listeners[0]({ name: "schoolpp_auto_sync" });
  await harness.settle();
  harness.alarmEvent.listeners[0]({ name: "schoolpp_background_timeout" });
  await harness.settle();

  assert.deepEqual(harness.removedTabs, [92]);
  assert.equal(harness.notifications.length, 1);
  assert.equal(harness.notifications[0].title, "Дневник недоступен");
});

test("deleting data cancels background updating", async () => {
  const harness = createBackgroundHarness();
  await harness.settle();
  await harness.send({
    type: "SCHOOLPP_SYNC_PROGRESS",
    progress: { phase: "success", label: "Синхронизация завершена" },
  });
  assert.equal(harness.alarms.has("schoolpp_auto_sync"), true);

  await harness.send({ type: "SCHOOLPP_CLEAR_SNAPSHOT" });

  assert.equal(harness.alarms.has("schoolpp_auto_sync"), false);
  assert.equal(harness.values.has("schoolpp_sync_state"), false);
  assert.equal(harness.createdTabs.length, 2);
  assert.equal(
    harness.createdTabs.at(-1).url,
    "https://schoolpp.com/?extension-action=delete",
  );
  assert.equal(harness.createdTabs.at(-1).active, false);
  assert.deepEqual(harness.removedTabs, [91]);
});

test("opening School++ reuses an existing tab", async () => {
  const harness = createBackgroundHarness();
  await harness.settle();
  harness.queryTabs.push({
    id: 44,
    windowId: 7,
    url: "https://schoolpp.com/diary",
  });

  const result = await harness.send({ type: "SCHOOLPP_OPEN_APP" });

  assert.equal(result.ok, true);
  assert.equal(result.created, false);
  assert.deepEqual(harness.updatedTabs, [{ tabId: 44, active: true }]);
  assert.deepEqual(harness.reloadedTabs, []);
});
