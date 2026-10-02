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
  const runtimeStartup = createEvent();
  const alarmEvent = createEvent();
  const notificationClick = createEvent();
  const tabRemoved = createEvent();
  const openedPopups = [];
  const badges = [];
  const chrome = {
    runtime: {
      onMessage: runtimeMessage,
      onInstalled: createEvent(),
      onStartup: runtimeStartup,
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
      onRemoved: tabRemoved,
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
    action: {
      async openPopup(options) {
        openedPopups.push(options);
      },
      async setBadgeBackgroundColor(options) {
        badges.push({ background: options.color });
      },
      async setBadgeText(options) {
        badges.push({ text: options.text });
      },
    },
    windows: {
      async update() {
        return {};
      },
    },
  };
  const context = vm.createContext({
    chrome,
    console,
    Date,
    TextEncoder,
    setTimeout,
    clearTimeout,
  });
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
    badges,
    createdTabs,
    notifications,
    openedPopups,
    queryTabs,
    reloadedTabs,
    removedTabs,
    runtimeStartup,
    send,
    settle,
    tabRemoved,
    updatedTabs,
    chrome,
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

test("browser startup immediately checks previously synchronized data", async () => {
  const harness = createBackgroundHarness();
  await harness.settle();
  harness.values.set("schoolpp_sync_state", {
    phase: "success",
    lastSyncAt: new Date().toISOString(),
    nextSyncAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  });

  harness.runtimeStartup.listeners[0]();
  await harness.settle();

  assert.equal(harness.createdTabs.length, 1);
  assert.equal(harness.createdTabs[0].url, "https://diary.e-schools.by/");
  assert.equal(harness.createdTabs[0].active, false);
});

test("failed background updates retry every two minutes and limit notifications", async () => {
  const harness = createBackgroundHarness();
  await harness.settle();
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= 21; attempt += 1) {
    await harness.send({
      type: "SCHOOLPP_SYNC_PROGRESS",
      progress: { phase: "running", label: "Получаем данные" },
    });
    await harness.send({ type: "SCHOOLPP_SYNC_STALLED", label: "Отключи VPN" });
    await harness.send({
      type: "SCHOOLPP_SYNC_PROGRESS",
      progress: { phase: "error", label: "Дневник не ответил" },
    });
    const state = harness.values.get("schoolpp_sync_state");
    assert.equal(state.consecutiveFailures, attempt);
    assert.equal(state.retrying, true);
  }

  const state = harness.values.get("schoolpp_sync_state");
  assert.ok(Date.parse(state.nextSyncAt) >= startedAt + 2 * 60_000);
  assert.ok(Date.parse(state.nextSyncAt) < Date.now() + 2 * 60_000 + 2_000);
  assert.equal(harness.notifications.length, 3);
  assert.ok(harness.alarms.has("schoolpp_auto_sync"));

  await harness.send({
    type: "SCHOOLPP_SYNC_PROGRESS",
    progress: { phase: "success", label: "Готово" },
  });
  assert.equal(
    harness.values.get("schoolpp_sync_state").consecutiveFailures,
    0,
  );
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
  assert.equal(harness.openedPopups.length, 0);

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

test("partial updates keep the retry sequence until a complete success", async () => {
  const harness = createBackgroundHarness();
  await harness.settle();
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await harness.send({
      type: "SCHOOLPP_SYNC_PROGRESS",
      progress: { phase: "running", label: "Получаем данные" },
    });
    await harness.send({
      type: "SCHOOLPP_SYNC_PROGRESS",
      progress: {
        phase: attempt % 2 ? "warning" : "error",
        label: "Получено не всё",
      },
    });
    assert.equal(
      harness.values.get("schoolpp_sync_state").consecutiveFailures,
      attempt,
    );
    assert.equal(harness.values.get("schoolpp_sync_state").retrying, true);
  }
  assert.equal(harness.notifications.length, 2);
  assert.ok(
    Date.parse(harness.values.get("schoolpp_sync_state").nextSyncAt) <=
      Date.now() + 120_000,
  );
  await harness.send({
    type: "SCHOOLPP_SYNC_PROGRESS",
    progress: { phase: "success", label: "Готово" },
  });
  assert.equal(
    harness.values.get("schoolpp_sync_state").consecutiveFailures,
    0,
  );
  assert.equal(harness.values.get("schoolpp_sync_state").retrying, false);
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
  assert.deepEqual(harness.badges.at(-1), { text: "!" });
});

test("a slow request does not report failure before a successful retry", async () => {
  const harness = createBackgroundHarness();
  await harness.settle();
  const result = await harness.send({
    type: "SCHOOLPP_SYNC_STALLED",
    label: "e‑schools.by долго не отвечает. Отключи VPN.",
  });

  assert.equal(result.ok, true);
  assert.equal(harness.notifications.length, 0);
  await harness.send({
    type: "SCHOOLPP_SYNC_PROGRESS",
    progress: { phase: "success", label: "Готово" },
  });
  assert.equal(harness.notifications.length, 0);
  assert.equal(harness.values.get("schoolpp_sync_state").phase, "success");
  assert.deepEqual(harness.badges.at(-1), { text: "" });
});

test("manual sync opens the diary from another site and waits for its bridge", async () => {
  const harness = createBackgroundHarness();
  await harness.settle();
  const commands = [];
  let readyChecks = 0;
  harness.chrome.tabs.sendMessage = async (tabId, message) => {
    commands.push({ tabId, type: message.type });
    if (message.type === "SCHOOLPP_PING" && ++readyChecks === 1)
      throw new Error("Receiving end does not exist");
    if (message.type === "SCHOOLPP_SYNC") {
      await harness.send(
        {
          type: "SCHOOLPP_SYNC_PROGRESS",
          progress: { phase: "success", label: "Готово" },
        },
        { tab: { id: tabId } },
      );
    }
    return { ok: true };
  };
  const result = await harness.send({ type: "SCHOOLPP_START_SYNC" });
  assert.equal(result.ok, true);
  assert.equal(harness.createdTabs[0].url, "https://diary.e-schools.by/");
  assert.equal(harness.createdTabs[0].active, true);
  assert.equal(readyChecks, 2);
  assert.equal(
    commands.filter((item) => item.type === "SCHOOLPP_SYNC").length,
    1,
  );
  assert.equal(harness.values.get("schoolpp_sync_state").phase, "success");
  assert.equal(harness.notifications.length, 0);
  assert.equal(harness.openedPopups.length, 0);
});

test("manual sync reuses a diary tab and reports its failed result once", async () => {
  const harness = createBackgroundHarness();
  await harness.settle();
  harness.queryTabs.push({ id: 44, url: "https://diary.e-schools.by/" });
  harness.chrome.tabs.sendMessage = async (tabId, message) => {
    if (message.type !== "SCHOOLPP_SYNC") return { ok: true };
    await Promise.all([
      harness.send(
        {
          type: "SCHOOLPP_SYNC_PROGRESS",
          progress: { phase: "error", label: "Дневник не ответил" },
        },
        { tab: { id: tabId } },
      ),
      harness.send(
        {
          type: "SCHOOLPP_SYNC_PROGRESS",
          progress: { phase: "error", label: "Дневник не ответил" },
        },
        { tab: { id: tabId } },
      ),
    ]);
    return { ok: false, error: "Дневник не ответил" };
  };
  const result = await harness.send({ type: "SCHOOLPP_START_SYNC" });
  assert.equal(result.ok, false);
  assert.equal(harness.createdTabs.length, 0);
  assert.equal(harness.notifications.length, 1);
  assert.equal(
    harness.values.get("schoolpp_sync_state").consecutiveFailures,
    1,
  );
});

test("closing an automatic diary tab reports the failed update", async () => {
  const harness = createBackgroundHarness();
  await harness.settle();
  await harness.send({
    type: "SCHOOLPP_SYNC_PROGRESS",
    progress: { phase: "success", label: "Первая синхронизация завершена" },
  });
  harness.alarmEvent.listeners[0]({ name: "schoolpp_auto_sync" });
  await harness.settle();

  harness.tabRemoved.listeners[0](92);
  await harness.settle();

  assert.equal(harness.notifications.length, 1);
  assert.match(harness.notifications[0].message, /Открой e.school/i);
  assert.equal(harness.values.has("schoolpp_background_tab"), false);
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
