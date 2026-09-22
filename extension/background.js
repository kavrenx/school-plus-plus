if (typeof importScripts === "function") {
  importScripts("shared/snapshot-store.js", "shared/extension-settings.js");
}

const api = globalThis.browser || globalThis.chrome;
const SNAPSHOT_KEY = "schoolpp_pending_snapshot";
const SYNC_STATE_KEY = "schoolpp_sync_state";
const SYNC_TARGETS_KEY = "schoolpp_sync_targets";
const SETTINGS_KEY = "schoolpp_settings";
const BACKGROUND_TAB_KEY = "schoolpp_background_tab";
const CLOUD_RELAY_TAB_KEY = "schoolpp_cloud_relay_tab";
const NOTIFICATION_STATE_KEY = "schoolpp_notification_state";
const SYNC_ALARM = "schoolpp_auto_sync";
const BACKGROUND_TIMEOUT_ALARM = "schoolpp_background_timeout";
const CLOUD_RELAY_TIMEOUT_ALARM = "schoolpp_cloud_relay_timeout";
const NOTIFICATION_ID = "schoolpp-sync-problem";
const DIARY_URL = "https://diary.e-schools.by/";
const SCHOOLPP_URL = "https://schoolpp.com/";
const SCHOOLPP_URL_PATTERNS = [
  "https://schoolpp.com/*",
  "http://127.0.0.1:5173/*",
  "http://localhost:5173/*",
];
const SYNC_INTERVAL_MINUTES = 15;
const SYNC_INTERVAL_MS = SYNC_INTERVAL_MINUTES * 60_000;
const ALARM_TOLERANCE_MS = 2_000;
const NOTIFICATION_COOLDOWN = 6 * 60 * 60 * 1_000;
const store = globalThis.SchoolppSnapshotStore;
const settingsPolicy = globalThis.SchoolppExtensionSettings;
let snapshotMutationQueue = Promise.resolve();

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message, sender = {}) {
  if (!message || typeof message.type !== "string") {
    return { ok: false, error: "Некорректная команда." };
  }
  if (message.type === "SCHOOLPP_SAVE_PAGE") {
    return queueSnapshotMutation(async () => {
      const snapshot = await loadSnapshot();
      const next = store.mergePage(snapshot, message.page);
      await saveSnapshot(next);
      return { ok: true, stats: store.getSnapshotStats(next) };
    });
  }
  if (message.type === "SCHOOLPP_SAVE_NETWORK") {
    return queueSnapshotMutation(async () => {
      const snapshot = await loadSnapshot();
      const next = store.mergeNetworkRecord(snapshot, message.record);
      await saveSnapshot(next);
      await rememberSyncTarget(message.record);
      return { ok: true, stats: store.getSnapshotStats(next) };
    });
  }
  if (message.type === "SCHOOLPP_GET_SNAPSHOT") {
    await snapshotMutationQueue;
    const snapshot = await loadSnapshot();
    return {
      ok: true,
      snapshot,
      stats: store.getSnapshotStats(snapshot),
      syncTargets: await loadSyncTargets(),
    };
  }
  if (message.type === "SCHOOLPP_GET_STATUS") {
    const settings = await loadSettings();
    return {
      ok: true,
      stats: store.getSnapshotStats(await loadSnapshot()),
      syncState: await loadSyncState(),
      settings,
      backgroundTab: await isBackgroundTab(sender.tab?.id),
    };
  }
  if (message.type === "SCHOOLPP_GET_SETTINGS") {
    return { ok: true, settings: await loadSettings() };
  }
  if (message.type === "SCHOOLPP_SET_SETTINGS") {
    const settings = settingsPolicy.normalizeSettings(message.settings);
    await api.storage.local.set({ [SETTINGS_KEY]: settings });
    if (settings.backgroundSync) await ensureSyncAlarm();
    else {
      await api.alarms.clear(SYNC_ALARM);
      await closeBackgroundTab();
    }
    return { ok: true, settings };
  }
  if (message.type === "SCHOOLPP_OPEN_APP") return openSchoolpp();
  if (message.type === "SCHOOLPP_CLOUD_IMPORT_COMPLETE") {
    await closeCloudRelay(sender.tab?.id);
    return { ok: true };
  }
  if (message.type === "SCHOOLPP_SYNC_PROGRESS") {
    const now = new Date();
    const progress = message.progress || {};
    const previous = await loadSyncState();
    const next = {
      ...previous,
      phase: progress.phase || "running",
      label: String(progress.label || "Синхронизация данных"),
      items: Array.isArray(progress.items)
        ? progress.items
        : previous.items || [],
      currentIndex: Number.isInteger(progress.currentIndex)
        ? progress.currentIndex
        : previous.currentIndex || 0,
      report: Array.isArray(progress.report)
        ? sanitizeSyncReport(progress.report)
        : previous.report || [],
    };
    if (next.phase === "running") {
      next.lastError = "";
      next.lastWarning = "";
    } else if (next.phase === "success" || next.phase === "warning") {
      next.lastSyncAt = now.toISOString();
      next.nextSyncAt = new Date(
        now.getTime() + SYNC_INTERVAL_MINUTES * 60_000,
      ).toISOString();
      next.lastError = "";
      next.lastWarning = next.phase === "warning" ? next.label : "";
    } else if (next.phase === "error") {
      next.lastError = next.label;
      next.nextSyncAt = new Date(
        now.getTime() + SYNC_INTERVAL_MINUTES * 60_000,
      ).toISOString();
    }
    await saveSyncState(next);
    if (["success", "warning", "error"].includes(next.phase))
      await ensureSyncAlarm(next.nextSyncAt);
    if (["success", "warning"].includes(next.phase)) {
      const openTabs = await notifySchoolppTabs();
      if (!openTabs) await openCloudRelay();
    }
    await finishBackgroundTabSync(sender.tab?.id, next);
    return { ok: true, syncState: next };
  }
  if (message.type === "SCHOOLPP_GET_DIAGNOSTICS") {
    const syncState = await loadSyncState();
    return {
      ok: true,
      diagnostics: {
        ...store.createDiagnostics(await loadSnapshot()),
        syncReport: syncState.report || [],
      },
    };
  }
  if (message.type === "SCHOOLPP_CLEAR_SNAPSHOT") {
    return queueSnapshotMutation(async () => {
      const snapshot = await loadSnapshot();
      for (const record of Object.values(snapshot.network || {}))
        await rememberSyncTarget(record);
      await api.storage.local.remove([SNAPSHOT_KEY, SYNC_STATE_KEY]);
      await api.alarms.clear(SYNC_ALARM);
      await closeBackgroundTab();
      await closeCloudRelay();
      await openCloudRelay("delete");
      return { ok: true, stats: store.getSnapshotStats(null) };
    });
  }
  return { ok: false, error: "Неизвестная команда." };
}

function sanitizeSyncReport(report) {
  return report.slice(0, 80).map((item) => ({
    url: String(item?.url || "").slice(0, 2_000),
    outcome: ["completed", "unauthorized", "unavailable"].includes(
      item?.outcome,
    )
      ? item.outcome
      : "unavailable",
    attempts: Math.max(0, Math.min(3, Number(item?.attempts) || 0)),
  }));
}

function queueSnapshotMutation(operation) {
  const result = snapshotMutationQueue.then(operation, operation);
  snapshotMutationQueue = result.catch(() => {});
  return result;
}

async function loadSyncTargets() {
  const result = await api.storage.local.get(SYNC_TARGETS_KEY);
  return Array.isArray(result[SYNC_TARGETS_KEY])
    ? result[SYNC_TARGETS_KEY]
    : [];
}

async function loadSettings() {
  const result = await api.storage.local.get(SETTINGS_KEY);
  return settingsPolicy.normalizeSettings(result[SETTINGS_KEY]);
}

async function rememberSyncTarget(record) {
  const url = String(record?.url || "");
  if (
    record?.method !== "GET" ||
    !/^\/api\/v1\/(?:education\/(?:diary|planning)\/|institution\/schools\/[^/]+\/premises(?:\?|$))/.test(
      url,
    ) ||
    /(?:auth|login|logout|password|token|session|captcha)/i.test(url)
  )
    return;
  const targets = new Set(await loadSyncTargets());
  targets.add(url);
  await api.storage.local.set({ [SYNC_TARGETS_KEY]: [...targets].slice(-80) });
}

async function loadSnapshot() {
  const result = await api.storage.local.get(SNAPSHOT_KEY);
  return result[SNAPSHOT_KEY] || store.createEmptySnapshot();
}

async function saveSnapshot(snapshot) {
  await api.storage.local.set({ [SNAPSHOT_KEY]: snapshot });
}

async function loadSyncState() {
  const result = await api.storage.local.get(SYNC_STATE_KEY);
  return (
    result[SYNC_STATE_KEY] || {
      phase: "idle",
      label: "",
      lastSyncAt: "",
      nextSyncAt: "",
      lastError: "",
      lastWarning: "",
      items: [],
      currentIndex: 0,
    }
  );
}

async function saveSyncState(syncState) {
  await api.storage.local.set({ [SYNC_STATE_KEY]: syncState });
}

async function ensureSyncAlarm(requestedNextSyncAt = "") {
  const settings = await loadSettings();
  if (!settings.backgroundSync) {
    await api.alarms.clear(SYNC_ALARM);
    return;
  }
  const syncState = await loadSyncState();
  if (!syncState.lastSyncAt) {
    await api.alarms.clear(SYNC_ALARM);
    return;
  }
  const requestedTime = Date.parse(
    requestedNextSyncAt || syncState.nextSyncAt || "",
  );
  const existing = await api.alarms.get(SYNC_ALARM);
  if (
    !Number.isFinite(requestedTime) &&
    existing &&
    !existing.periodInMinutes &&
    Number(existing.scheduledTime) > Date.now()
  )
    return;
  const scheduledTime =
    Number.isFinite(requestedTime) && requestedTime > Date.now()
      ? requestedTime
      : Date.now() +
        (Number.isFinite(requestedTime) ? 1_000 : SYNC_INTERVAL_MS);
  if (
    existing &&
    !existing.periodInMinutes &&
    Math.abs(Number(existing.scheduledTime) - scheduledTime) <=
      (requestedNextSyncAt ? 0 : ALARM_TOLERANCE_MS)
  )
    return;
  if (existing) await api.alarms.clear(SYNC_ALARM);
  await api.alarms.create(SYNC_ALARM, { when: scheduledTime });
}

async function runAutomaticSync(force = false) {
  const settings = await loadSettings();
  const syncState = await loadSyncState();
  if (
    !settingsPolicy.isAutomaticSyncDue(settings, syncState, Date.now(), force)
  )
    return;
  const tabs = await api.tabs.query({ url: "https://diary.e-schools.by/*" });
  const tab = tabs.find((item) => item.id);
  if (!tab) {
    const backgroundTab = await api.tabs.create({
      url: DIARY_URL,
      active: false,
    });
    if (!backgroundTab?.id) {
      await showSyncIssue("Не удалось открыть дневник.");
      await scheduleAutomaticRetry();
      return;
    }
    await api.storage.local.set({
      [BACKGROUND_TAB_KEY]: { id: backgroundTab.id, createdAt: Date.now() },
    });
    await api.alarms.create(BACKGROUND_TIMEOUT_ALARM, { delayInMinutes: 1 });
    return;
  }
  try {
    const result = await api.tabs.sendMessage(tab.id, {
      type: "SCHOOLPP_SYNC",
      automatic: true,
    });
    if (!result?.ok || result.warning)
      await showSyncIssue(result?.error || "", result?.warning || "");
    else await clearSyncIssue();
  } catch (error) {
    await showSyncIssue(error?.message || "Дневник не ответил.");
    await scheduleAutomaticRetry();
  }
}

async function scheduleAutomaticRetry() {
  const syncState = await loadSyncState();
  const nextSyncAt = new Date(Date.now() + SYNC_INTERVAL_MS).toISOString();
  await saveSyncState({ ...syncState, nextSyncAt });
  await ensureSyncAlarm(nextSyncAt);
}

async function getSchoolppTabs() {
  const groups = await Promise.all(
    SCHOOLPP_URL_PATTERNS.map((url) => api.tabs.query({ url })),
  );
  return [...new Map(groups.flat().map((tab) => [tab.id, tab])).values()];
}

async function notifySchoolppTabs() {
  const tabs = await getSchoolppTabs();
  await Promise.allSettled(
    tabs.map((tab) =>
      api.tabs.sendMessage(tab.id, { type: "SCHOOLPP_SNAPSHOT_UPDATED" }),
    ),
  );
  return tabs.length;
}

async function openCloudRelay(action = "sync") {
  const stored = await api.storage.local.get(CLOUD_RELAY_TAB_KEY);
  if (stored[CLOUD_RELAY_TAB_KEY]?.id) return;
  const tab = await api.tabs.create({
    url:
      action === "delete"
        ? `${SCHOOLPP_URL}?extension-action=delete`
        : `${SCHOOLPP_URL}?extension-sync=background`,
    active: false,
  });
  if (!tab?.id) return;
  await api.storage.local.set({
    [CLOUD_RELAY_TAB_KEY]: { id: tab.id, createdAt: Date.now() },
  });
  await api.alarms.create(CLOUD_RELAY_TIMEOUT_ALARM, { delayInMinutes: 1 });
}

async function closeCloudRelay(tabId) {
  const result = await api.storage.local.get(CLOUD_RELAY_TAB_KEY);
  const storedId = result[CLOUD_RELAY_TAB_KEY]?.id;
  if (!storedId || (tabId && storedId !== tabId)) return;
  await api.storage.local.remove(CLOUD_RELAY_TAB_KEY);
  await api.alarms.clear(CLOUD_RELAY_TIMEOUT_ALARM);
  try {
    await api.tabs.remove(storedId);
  } catch {
    /* The relay tab may already be closed. */
  }
}

async function openSchoolpp() {
  const [tab] = await getSchoolppTabs();
  if (!tab?.id) {
    const created = await api.tabs.create({ url: SCHOOLPP_URL, active: true });
    return { ok: Boolean(created?.id), created: true };
  }
  await api.tabs.update(tab.id, { active: true });
  if (tab.windowId && api.windows?.update)
    await api.windows.update(tab.windowId, { focused: true });
  try {
    await api.tabs.sendMessage(tab.id, { type: "SCHOOLPP_EXTENSION_WAKE" });
  } catch {
    await api.tabs.reload(tab.id);
  }
  return { ok: true, created: false, tabId: tab.id };
}

async function isBackgroundTab(tabId) {
  if (!tabId) return false;
  const result = await api.storage.local.get(BACKGROUND_TAB_KEY);
  return result[BACKGROUND_TAB_KEY]?.id === tabId;
}

async function finishBackgroundTabSync(tabId, syncState) {
  if (!tabId || !(await isBackgroundTab(tabId))) return;
  if (!["success", "warning", "error"].includes(syncState.phase)) return;
  if (syncState.phase === "success") await clearSyncIssue();
  else
    await showSyncIssue(
      syncState.phase === "error" ? syncState.label : "",
      syncState.phase === "warning" ? syncState.label : "",
    );
  await closeBackgroundTab(tabId);
}

async function closeBackgroundTab(tabId) {
  const result = await api.storage.local.get(BACKGROUND_TAB_KEY);
  const storedId = result[BACKGROUND_TAB_KEY]?.id;
  if (!storedId || (tabId && tabId !== storedId)) return;
  await api.storage.local.remove(BACKGROUND_TAB_KEY);
  await api.alarms.clear(BACKGROUND_TIMEOUT_ALARM);
  try {
    await api.tabs.remove(storedId);
  } catch {
    /* The user may have already closed the temporary tab. */
  }
}

async function showSyncIssue(message, warning = "") {
  const issue = settingsPolicy.describeSyncIssue(message, warning);
  const result = await api.storage.local.get(NOTIFICATION_STATE_KEY);
  const previous = result[NOTIFICATION_STATE_KEY] || {};
  const signature = `${issue.code}:${issue.title}`;
  if (
    previous.signature === signature &&
    Date.now() - Number(previous.shownAt || 0) < NOTIFICATION_COOLDOWN
  )
    return;
  await api.notifications.create(NOTIFICATION_ID, {
    type: "basic",
    iconUrl: api.runtime.getURL("assets/icon.svg"),
    title: issue.title,
    message: issue.message,
  });
  await api.storage.local.set({
    [NOTIFICATION_STATE_KEY]: { signature, shownAt: Date.now() },
  });
}

async function clearSyncIssue() {
  await api.storage.local.remove(NOTIFICATION_STATE_KEY);
  try {
    await api.notifications.clear(NOTIFICATION_ID);
  } catch {
    /* A notification may not exist yet. */
  }
}

api.runtime.onInstalled.addListener(() => void ensureSyncAlarm());
api.runtime.onStartup.addListener(() => {
  void closeCloudRelay();
  void ensureSyncAlarm();
});
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void runAutomaticSync(true);
  if (alarm.name === BACKGROUND_TIMEOUT_ALARM)
    void (async () => {
      await showSyncIssue("Не удалось открыть дневник.");
      await closeBackgroundTab();
      await scheduleAutomaticRetry();
    })();
  if (alarm.name === CLOUD_RELAY_TIMEOUT_ALARM) void closeCloudRelay();
});
api.notifications.onClicked.addListener((notificationId) => {
  if (notificationId !== NOTIFICATION_ID) return;
  void api.tabs.create({ url: DIARY_URL, active: true });
  void api.notifications.clear(NOTIFICATION_ID);
});
void ensureSyncAlarm();
