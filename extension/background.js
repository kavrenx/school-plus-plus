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
const BACKGROUND_TIMEOUT_MINUTES = 2;
const CLOUD_RELAY_TIMEOUT_ALARM = "schoolpp_cloud_relay_timeout";
const NOTIFICATION_ID = "schoolpp-sync-problem";
const DIARY_URL = "https://diary.e-schools.by/";
const SCHOOLPP_URL = "https://schoolpp.com/";
const SCHOOLPP_URL_PATTERNS = api.runtime
  .getManifest?.()
  ?.content_scripts?.find((entry) => entry.js?.includes("content/schoolpp.js"))
  ?.matches || ["https://schoolpp.com/*"];
const SYNC_INTERVAL_MINUTES = 15;
const SYNC_INTERVAL_MS = SYNC_INTERVAL_MINUTES * 60_000;
const RETRY_INTERVAL_MINUTES = 2;
const RETRY_INTERVAL_MS = RETRY_INTERVAL_MINUTES * 60_000;
const ALARM_TOLERANCE_MS = 2_000;
const NOTIFICATION_COOLDOWN = 6 * 60 * 60 * 1_000;
const store = globalThis.SchoolppSnapshotStore;
const settingsPolicy = globalThis.SchoolppExtensionSettings;
let snapshotMutationQueue = Promise.resolve();
let syncStateMutationQueue = Promise.resolve();
let manualSyncPromise = null;

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
  if (message.type === "SCHOOLPP_SYNC_PROGRESS" && !message.serialized) {
    const operation = syncStateMutationQueue.then(() =>
      handleMessage({ ...message, serialized: true }, sender),
    );
    syncStateMutationQueue = operation.catch(() => {});
    return operation;
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
  if (message.type === "SCHOOLPP_MERGE_LESSON_MATERIALS") {
    return queueSnapshotMutation(async () => {
      const snapshot = await loadSnapshot();
      const next = store.mergeLessonMaterials(
        snapshot,
        message.lessonId,
        message.materials,
      );
      await saveSnapshot(next);
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
  if (message.type === "SCHOOLPP_GET_LESSON_MATERIALS") {
    await snapshotMutationQueue;
    return {
      ok: true,
      materials: store.getLessonMaterials(
        await loadSnapshot(),
        message.lessons || message.lessonIds,
      ),
    };
  }
  if (message.type === "SCHOOLPP_GET_STATUS") {
    const settings = await loadSettings();
    const backgroundTab = await getBackgroundTab();
    return {
      ok: true,
      stats: store.getSnapshotStats(await loadSnapshot()),
      syncState: await loadSyncState(),
      settings,
      backgroundTab: Boolean(
        sender.tab?.id && backgroundTab?.id === sender.tab.id,
      ),
      backgroundSyncActive: Boolean(backgroundTab?.id),
    };
  }
  if (message.type === "SCHOOLPP_GET_SETTINGS") {
    return { ok: true, settings: await loadSettings() };
  }
  if (message.type === "SCHOOLPP_SYNC_STALLED") {
    // A slow request can recover. Only the final result may notify the user.
    return { ok: true };
  }
  if (message.type === "SCHOOLPP_START_SYNC") {
    if (!manualSyncPromise)
      manualSyncPromise = runManualSync().finally(() => {
        manualSyncPromise = null;
      });
    return manualSyncPromise;
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
  if (message.type === "SCHOOLPP_RESOLVE_MATERIAL")
    return resolveSchoolMaterial(message.material);
  if (message.type === "SCHOOLPP_CLOUD_IMPORT_COMPLETE") {
    await closeCloudRelay(sender.tab?.id);
    return { ok: true };
  }
  if (message.type === "SCHOOLPP_SYNC_PROGRESS") {
    const now = new Date();
    const progress = message.progress || {};
    const previous = await loadSyncState();
    if (progress.phase === "error" && previous.phase === "error")
      return { ok: true, syncState: previous };
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
      next.lastWarning = "";
    } else if (next.phase === "success") {
      next.lastSyncAt = now.toISOString();
      next.nextSyncAt = new Date(
        now.getTime() + SYNC_INTERVAL_MINUTES * 60_000,
      ).toISOString();
      next.lastError = "";
      next.lastWarning = "";
      next.consecutiveFailures = 0;
      next.retrying = false;
    } else if (next.phase === "error" || next.phase === "warning") {
      next.lastError = next.phase === "error" ? next.label : "";
      next.lastWarning = next.phase === "warning" ? next.label : "";
      next.nextSyncAt = new Date(
        now.getTime() + RETRY_INTERVAL_MS,
      ).toISOString();
      next.consecutiveFailures = Number(previous.consecutiveFailures || 0) + 1;
      next.retrying = true;
    }
    await saveSyncState(next);
    if (["success", "warning", "error"].includes(next.phase))
      await ensureSyncAlarm(next.nextSyncAt);
    if (next.phase === "success") await clearSyncIssue();
    else if (
      next.phase === "warning" &&
      shouldNotifyFailure(next.consecutiveFailures)
    )
      await showSyncIssue("", next.label, { force: true });
    else if (
      next.phase === "error" &&
      shouldNotifyFailure(next.consecutiveFailures)
    )
      await showSyncIssue(next.label, "", { force: true });
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
        syncState: {
          phase: syncState.phase,
          label: syncState.label,
          lastSyncAt: syncState.lastSyncAt,
          nextSyncAt: syncState.nextSyncAt,
          lastError: syncState.lastError,
          lastWarning: syncState.lastWarning,
          consecutiveFailures: syncState.consecutiveFailures,
          retrying: syncState.retrying,
        },
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

async function resolveSchoolMaterial(material) {
  const tabs = await api.tabs.query({ url: "https://diary.e-schools.by/*" });
  let tab = tabs.find((item) => item.id);
  let temporary = false;
  if (!tab) {
    tab = await api.tabs.create({ url: `${DIARY_URL}#/diary`, active: false });
    temporary = true;
  }
  if (!tab?.id)
    return { ok: false, error: "Не удалось открыть электронный дневник." };
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const result = await api.tabs.sendMessage(tab.id, {
          type: "SCHOOLPP_RESOLVE_MATERIAL",
          material,
        });
        if (result?.ok && result.url) {
          await api.tabs.create({ url: result.url, active: true });
          return { ok: true, title: result.title || material?.title || "" };
        }
        if (result) return result;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    return {
      ok: false,
      error: "e-schools.by не ответил. Открой дневник и попробуй ещё раз.",
    };
  } finally {
    if (temporary)
      try {
        await api.tabs.remove(tab.id);
      } catch {
        /* The temporary tab may already be closed. */
      }
  }
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
      consecutiveFailures: 0,
      retrying: false,
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
  if (!syncState.lastSyncAt && !syncState.retrying && !syncState.nextSyncAt) {
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
  if (manualSyncPromise || (await getBackgroundTab())) return;
  const settings = await loadSettings();
  const syncState = await loadSyncState();
  if (!settings.backgroundSync) return;
  const retryTime = Date.parse(syncState.nextSyncAt || "");
  const retryDue =
    syncState.retrying &&
    (force || !Number.isFinite(retryTime) || retryTime <= Date.now());
  if (
    !retryDue &&
    !settingsPolicy.isAutomaticSyncDue(settings, syncState, Date.now(), force)
  )
    return;
  await handleMessage({
    type: "SCHOOLPP_SYNC_PROGRESS",
    progress: { phase: "running", label: "Подключаемся к дневнику" },
  });
  const tabs = await api.tabs.query({ url: "https://diary.e-schools.by/*" });
  const tab = tabs.find((item) => item.id);
  if (!tab) {
    const backgroundTab = await api.tabs.create({
      url: DIARY_URL,
      active: false,
    });
    if (!backgroundTab?.id) {
      await registerAutomaticFailure("Не удалось открыть дневник.");
      return;
    }
    await api.storage.local.set({
      [BACKGROUND_TAB_KEY]: { id: backgroundTab.id, createdAt: Date.now() },
    });
    await api.alarms.create(BACKGROUND_TIMEOUT_ALARM, {
      delayInMinutes: BACKGROUND_TIMEOUT_MINUTES,
    });
    return;
  }
  try {
    const result = await api.tabs.sendMessage(tab.id, {
      type: "SCHOOLPP_SYNC",
      automatic: true,
    });
    if (!result?.ok) {
      const latest = await loadSyncState();
      if (latest.phase !== "error")
        await registerAutomaticFailure(
          result?.error || "Не удалось синхронизировать данные.",
        );
    }
  } catch (error) {
    await registerAutomaticFailure(error?.message || "Дневник не ответил.");
  }
}

async function runManualSync() {
  const tabs = await api.tabs.query({ url: "https://diary.e-schools.by/*" });
  let tab = tabs.find((item) => item.id);
  let timeoutId;
  try {
    await handleMessage({
      type: "SCHOOLPP_SYNC_PROGRESS",
      progress: { phase: "running", label: "Подключаемся к дневнику" },
    });
    if (!tab) tab = await api.tabs.create({ url: DIARY_URL, active: true });
    if (!tab?.id) throw new Error("Не удалось открыть дневник.");
    const readyDeadline = Date.now() + 30_000;
    for (;;) {
      try {
        const ready = await api.tabs.sendMessage(tab.id, {
          type: "SCHOOLPP_PING",
        });
        if (ready?.ok) break;
      } catch {
        // Wait for the newly opened page to load its extension bridge.
      }
      if (Date.now() >= readyDeadline)
        throw new Error(
          "Дневник не открылся. Проверь соединение, отключи VPN и попробуй снова.",
        );
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const result = await Promise.race([
      api.tabs.sendMessage(tab.id, { type: "SCHOOLPP_SYNC" }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          void api.tabs
            .sendMessage(tab.id, { type: "SCHOOLPP_CANCEL_SYNC" })
            .catch(() => {});
          reject(
            new Error(
              "Дневник отвечает слишком долго. Отключи VPN и попробуй снова.",
            ),
          );
        }, 100_000);
      }),
    ]);
    if (!result?.ok)
      throw new Error(
        result?.error || "Синхронизация прервана. Попробуй снова.",
      );
    return result;
  } catch (error) {
    const latest = await loadSyncState();
    if (latest.phase !== "error") await registerAutomaticFailure(error.message);
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timeoutId);
  }
}

function shouldNotifyFailure(count) {
  return count === 1 || count % 10 === 0;
}

function registerAutomaticFailure(message) {
  const operation = syncStateMutationQueue.then(() =>
    saveAutomaticFailure(message),
  );
  syncStateMutationQueue = operation.catch(() => {});
  return operation;
}

async function saveAutomaticFailure(message) {
  const syncState = await loadSyncState();
  if (syncState.phase === "error") return;
  const consecutiveFailures = Number(syncState.consecutiveFailures || 0) + 1;
  const nextSyncAt = new Date(Date.now() + RETRY_INTERVAL_MS).toISOString();
  await saveSyncState({
    ...syncState,
    phase: "error",
    label: String(message || "Не удалось синхронизировать данные."),
    lastError: String(message || "Не удалось синхронизировать данные."),
    nextSyncAt,
    consecutiveFailures,
    retrying: true,
  });
  await ensureSyncAlarm(nextSyncAt);
  if (shouldNotifyFailure(consecutiveFailures))
    await showSyncIssue(message, "", { force: true });
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
  return (await getBackgroundTab())?.id === tabId;
}

async function getBackgroundTab() {
  const result = await api.storage.local.get(BACKGROUND_TAB_KEY);
  return result[BACKGROUND_TAB_KEY] || null;
}

async function finishBackgroundTabSync(tabId, syncState) {
  if (!tabId || !(await isBackgroundTab(tabId))) return;
  if (!["success", "warning", "error"].includes(syncState.phase)) return;
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

async function showSyncIssue(message, warning = "", { force = false } = {}) {
  const issue = settingsPolicy.describeSyncIssue(message, warning);
  const result = await api.storage.local.get(NOTIFICATION_STATE_KEY);
  const previous = result[NOTIFICATION_STATE_KEY] || {};
  const signature = `${issue.code}:${issue.title}`;
  await setIssueBadge();
  if (
    !force &&
    previous.signature === signature &&
    Date.now() - Number(previous.shownAt || 0) < NOTIFICATION_COOLDOWN
  )
    return;
  await api.notifications.create(NOTIFICATION_ID, {
    type: "basic",
    iconUrl: api.runtime.getURL("assets/icon128.png"),
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
  try {
    await api.action?.setBadgeText?.({ text: "" });
  } catch {
    /* The current browser may not expose action badges. */
  }
}

async function setIssueBadge() {
  try {
    await api.action?.setBadgeBackgroundColor?.({ color: "#b6483d" });
    await api.action?.setBadgeText?.({ text: "!" });
  } catch {
    /* System notification remains the primary signal. */
  }
}

api.runtime.onInstalled.addListener(() => void ensureSyncAlarm());
api.runtime.onStartup.addListener(() => {
  void (async () => {
    await closeCloudRelay();
    await ensureSyncAlarm();
    await runAutomaticSync(true);
  })();
});
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void runAutomaticSync(true);
  if (alarm.name === BACKGROUND_TIMEOUT_ALARM)
    void (async () => {
      const tab = await getBackgroundTab();
      if (!tab) return;
      try {
        await api.tabs.sendMessage(tab.id, { type: "SCHOOLPP_CANCEL_SYNC" });
      } catch {
        // The page may have failed before the content script loaded.
      }
      await closeBackgroundTab();
      await registerAutomaticFailure("Не удалось открыть дневник.");
    })();
  if (alarm.name === CLOUD_RELAY_TIMEOUT_ALARM) void closeCloudRelay();
});
api.notifications.onClicked.addListener((notificationId) => {
  if (notificationId !== NOTIFICATION_ID) return;
  void api.tabs.create({ url: DIARY_URL, active: true });
  void api.notifications.clear(NOTIFICATION_ID);
});
api.tabs.onRemoved?.addListener((tabId) => {
  void (async () => {
    if (!(await isBackgroundTab(tabId))) return;
    await api.storage.local.remove(BACKGROUND_TAB_KEY);
    await api.alarms.clear(BACKGROUND_TIMEOUT_ALARM);
    await registerAutomaticFailure("Не удалось открыть дневник.");
  })();
});
void ensureSyncAlarm();
