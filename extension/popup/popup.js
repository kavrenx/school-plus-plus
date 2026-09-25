const api = globalThis.browser || globalThis.chrome;
const status = document.querySelector(".status");
const statusTitle = document.getElementById("statusTitle");
const statusText = document.getElementById("statusText");
const syncButton = document.getElementById("syncButton");
const syncLabel = document.getElementById("syncLabel");
const syncProgress = document.getElementById("syncProgress");
const syncDetail = document.getElementById("syncDetail");
const sources = document.getElementById("sources");
const sourcesCount = document.getElementById("sourcesCount");
const sourcesList = document.getElementById("sourcesList");
const diagnosticsButton = document.getElementById("diagnosticsButton");
const openSchoolppButton = document.getElementById("openSchoolppButton");
const clearButton = document.getElementById("clearButton");
const helpButton = document.getElementById("helpButton");
const settingsButton = document.getElementById("settingsButton");
const settingsPanel = document.getElementById("settingsPanel");
const backgroundSyncToggle = document.getElementById("backgroundSyncToggle");
let activeTab = null;
let canSync = false;
let syncing = false;
let syncRunId = 0;
let manualSyncActive = false;
let suppressProgressUntil = 0;
let backgroundSyncEnabled = false;
let latestStats = null;
let latestSyncState = {};
let statusClock = 0;

async function initialize() {
  [activeTab] = await api.tabs.query({ active: true, currentWindow: true });
  canSync = /^https:\/\/diary\.e-schools\.by\//.test(activeTab?.url || "");
  const result = await api.runtime.sendMessage({ type: "SCHOOLPP_GET_STATUS" });
  backgroundSyncEnabled =
    Boolean(result?.stats?.ready) && result?.settings?.backgroundSync !== false;
  backgroundSyncToggle.checked = backgroundSyncEnabled;
  backgroundSyncToggle.disabled = !result?.stats?.ready;
  renderStatus(result?.stats, result?.syncState);
  restoreProgress(result?.syncState || {});
}

settingsButton.addEventListener("click", () => {
  const expanded = settingsButton.getAttribute("aria-expanded") === "true";
  settingsButton.setAttribute("aria-expanded", String(!expanded));
  settingsPanel.hidden = expanded;
});

backgroundSyncToggle.addEventListener("change", async () => {
  const requested = backgroundSyncToggle.checked;
  backgroundSyncToggle.disabled = true;
  try {
    const result = await api.runtime.sendMessage({
      type: "SCHOOLPP_SET_SETTINGS",
      settings: { backgroundSync: requested },
    });
    if (!result?.ok) throw new Error(result?.error || "SETTINGS_FAILED");
    backgroundSyncEnabled = result.settings.backgroundSync;
    backgroundSyncToggle.checked = backgroundSyncEnabled;
    await initialize();
  } catch {
    backgroundSyncToggle.checked = !requested;
    showError("Не удалось сохранить настройку. Попробуй ещё раз.");
  } finally {
    backgroundSyncToggle.disabled = !latestStats?.ready;
  }
});

function renderStatus(stats, syncState = {}) {
  latestStats = stats || null;
  latestSyncState = syncState;
  renderSources(
    syncState.items || [],
    syncState.currentIndex || 0,
    syncState.phase,
  );
  status.classList.remove("is-error", "is-ready", "is-checking");
  clearButton.hidden = !stats?.ready;
  diagnosticsButton.hidden = !stats?.ready;
  openSchoolppButton.hidden = !syncState.lastSyncAt;
  syncButton.disabled = !canSync || syncing;
  if (stats?.ready) {
    status.classList.add("is-ready");
    statusTitle.textContent = "Данные готовы";
    setLinkedText(statusText, getReadyStatusText(syncState));
    syncLabel.textContent = "Синхронизировать снова";
    startStatusClock();
    return;
  }
  stopStatusClock();
  if (syncState.lastError) {
    status.classList.add("is-error");
    statusTitle.textContent = "Синхронизация не выполнена";
    setLinkedText(statusText, syncState.lastError);
    return;
  }
  if (!canSync) {
    statusTitle.textContent = "Нужна первая синхронизация";
    setLinkedText(
      statusText,
      "Открой e‑schools.by и синхронизируй данные. После этого они смогут обновляться автоматически.",
    );
    return;
  }
  statusTitle.textContent = "Готово к подключению";
  statusText.textContent =
    "Нажми кнопку — нужные данные соберутся автоматически.";
}

function renderProgress(progress) {
  if (!syncing) return;
  if (progress.phase === "error") return;
  syncDetail.textContent = progress.label || "Синхронизация данных";
  if (progress.items)
    renderSources(progress.items, progress.currentIndex || 0, progress.phase);
}

function renderSources(items) {
  sources.hidden = !items.length;
  if (!items.length) return;
  sourcesCount.textContent = `(${items.length})`;
  sourcesList.replaceChildren(
    ...items.map((label) => {
      const item = document.createElement("li");
      item.textContent = label;
      return item;
    }),
  );
}

syncButton.addEventListener("click", async () => {
  if (!canSync || syncing) return;
  const startedAt = Date.now();
  const runId = ++syncRunId;
  suppressProgressUntil = 0;
  syncing = true;
  manualSyncActive = true;
  showSyncingStatus();
  syncButton.disabled = true;
  syncButton.classList.remove("is-success");
  syncLabel.textContent = "Синхронизация";
  syncProgress.hidden = false;
  syncDetail.hidden = false;
  renderProgress({ label: "Подключаемся к дневнику" });
  await wait(150);
  let syncResponse = null;
  let syncFailed = false;
  try {
    syncResponse = await withTimeout(
      api.tabs.sendMessage(activeTab.id, { type: "SCHOOLPP_SYNC" }),
      45_000,
    );
    if (!syncResponse?.ok)
      throw new Error(
        syncResponse?.error || "Не удалось синхронизировать данные.",
      );
    renderProgress({
      label: syncResponse.warning || "Готово",
      phase: syncResponse.warning ? "warning" : "success",
    });
    await wait(Math.max(0, 1500 - (Date.now() - startedAt)));
    syncButton.classList.add("is-success");
    syncLabel.textContent = "Всё синхронизировано";
    await wait(500);
  } catch (error) {
    if (runId !== syncRunId) return;
    syncFailed = true;
    showError(getPublicPopupError(error));
  } finally {
    if (runId !== syncRunId) return;
    syncing = false;
    manualSyncActive = false;
    syncProgress.hidden = true;
    syncDetail.hidden = true;
    syncButton.classList.remove("is-success");
    syncButton.disabled = !canSync;
    if (syncFailed) {
      syncLabel.textContent = "Повторить синхронизацию";
      return;
    }
    try {
      const result = await withTimeout(
        api.runtime.sendMessage({ type: "SCHOOLPP_GET_STATUS" }),
        4_000,
      );
      renderStatus(result?.stats, result?.syncState);
    } catch {
      renderCompletedFallback(syncResponse?.warning);
    }
  }
});

api.runtime.onMessage.addListener((message) => {
  if (message?.type !== "SCHOOLPP_SYNC_PROGRESS") return;
  if (Date.now() < suppressProgressUntil) return;
  const progress = message.progress || {};
  if (!manualSyncActive && progress.phase === "error") {
    syncing = false;
    syncProgress.hidden = true;
    syncDetail.hidden = true;
    syncButton.disabled = !canSync;
    showError(progress.label || "Не удалось синхронизировать данные.");
    return;
  }
  if (!syncing && progress.phase === "running") {
    syncing = true;
    restoreProgress(progress);
  }
  renderProgress(progress);
  if (
    !manualSyncActive &&
    (progress.phase === "success" || progress.phase === "warning")
  )
    void finishBackgroundSync(progress);
});

clearButton.addEventListener("click", async () => {
  syncRunId += 1;
  suppressProgressUntil = Date.now() + 3_000;
  syncing = false;
  manualSyncActive = false;
  syncProgress.hidden = true;
  syncDetail.hidden = true;
  syncButton.classList.remove("is-success");
  if (activeTab?.id) {
    try {
      await api.tabs.sendMessage(activeTab.id, {
        type: "SCHOOLPP_CANCEL_SYNC",
      });
    } catch {
      /* The source page may already be closed. */
    }
  }
  await api.runtime.sendMessage({ type: "SCHOOLPP_CLEAR_SNAPSHOT" });
  syncLabel.textContent = "Синхронизировать";
  await initialize();
});

diagnosticsButton.addEventListener("click", async () => {
  const result = await api.runtime.sendMessage({
    type: "SCHOOLPP_GET_DIAGNOSTICS",
  });
  if (!result?.ok)
    return showError(result?.error || "Не удалось создать файл.");
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(result.diagnostics, null, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "schoolpp-e-schools-structure.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

helpButton.addEventListener("click", async () => {
  await api.tabs.create({ url: api.runtime.getURL("help/help.html") });
  window.close();
});

openSchoolppButton.addEventListener("click", async () => {
  await api.runtime.sendMessage({ type: "SCHOOLPP_OPEN_APP" });
  window.close();
});

function showError(text) {
  stopStatusClock();
  status.classList.add("is-error");
  statusTitle.textContent = "Не удалось синхронизировать";
  setLinkedText(statusText, text);
}

function showSyncingStatus() {
  stopStatusClock();
  status.classList.remove("is-error", "is-ready");
  status.classList.add("is-checking");
  statusTitle.textContent = "Получаем данные";
  statusText.textContent = "Не закрывай вкладку дневника.";
}

function restoreProgress(syncState) {
  if (syncState.phase !== "running") return;
  syncing = true;
  showSyncingStatus();
  syncButton.disabled = true;
  syncLabel.textContent = "Синхронизация";
  syncProgress.hidden = false;
  syncDetail.hidden = false;
  renderProgress(syncState);
}

async function finishBackgroundSync(progress) {
  renderProgress(progress);
  syncButton.classList.add("is-success");
  syncLabel.textContent = "Всё синхронизировано";
  await wait(650);
  syncing = false;
  syncProgress.hidden = true;
  syncDetail.hidden = true;
  syncButton.classList.remove("is-success");
  const result = await api.runtime.sendMessage({ type: "SCHOOLPP_GET_STATUS" });
  renderStatus(result?.stats, result?.syncState);
}

function renderCompletedFallback(warning = "") {
  stopStatusClock();
  status.classList.remove("is-error", "is-checking");
  status.classList.add("is-ready");
  statusTitle.textContent = "Данные готовы";
  statusText.textContent = warning || "Синхронизация завершена.";
  syncLabel.textContent = "Синхронизировать снова";
  syncButton.disabled = !canSync;
}

function setLinkedText(element, text) {
  const domainPattern = /((?:diary\.)?e(?:\.|-|‑)schools?\.by)/gi;
  const exactDomainPattern = /^(?:diary\.)?e(?:\.|-|‑)schools?\.by$/i;
  const parts = String(text).split(domainPattern);
  element.replaceChildren(
    ...parts.map((part) => {
      if (!exactDomainPattern.test(part)) return document.createTextNode(part);
      const link = document.createElement("a");
      link.href = "https://diary.e-schools.by/";
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = part;
      link.style.whiteSpace = "nowrap";
      return link;
    }),
  );
}

function getPublicPopupError(error) {
  const message = String(error?.message || "");
  if (
    message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection")
  )
    return "Обнови страницу e‑schools.by после установки расширения.";
  return message || "Не удалось синхронизировать данные. Попробуй ещё раз.";
}

function formatNextSync(value) {
  if (!value) return "примерно через 15 минут";
  const remaining = Math.max(0, new Date(value).getTime() - Date.now());
  if (remaining === 0) return "сейчас";
  if (remaining <= 60_000) {
    const seconds = Math.max(1, Math.ceil(remaining / 1_000));
    return `через ${seconds} ${pluralWord(seconds, "секунду", "секунды", "секунд")}`;
  }
  const minutes = Math.max(1, Math.ceil(remaining / 60_000));
  return `через ${minutes} ${pluralWord(minutes, "минуту", "минуты", "минут")}`;
}

function getReadyStatusText(syncState = latestSyncState) {
  if (syncState.lastError)
    return "Сохранённые данные доступны. Последнюю проверку можно повторить.";
  if (!backgroundSyncEnabled)
    return "Фоновое обновление выключено. Для ручной синхронизации открой e‑schools.by.";
  if (syncState.lastWarning)
    return `${syncState.lastWarning}. Следующая проверка ${formatNextSync(syncState.nextSyncAt)}.`;
  if (syncState.lastSyncAt)
    return `Следующая проверка ${formatNextSync(syncState.nextSyncAt)}.`;
  return "Можно начать синхронизацию.";
}

function startStatusClock() {
  stopStatusClock();
  if (
    !latestStats?.ready ||
    !backgroundSyncEnabled ||
    latestSyncState.lastError ||
    !latestSyncState.nextSyncAt
  )
    return;
  statusClock = window.setInterval(() => {
    if (syncing) return;
    setLinkedText(statusText, getReadyStatusText());
  }, 1_000);
}

function stopStatusClock() {
  if (!statusClock) return;
  window.clearInterval(statusClock);
  statusClock = 0;
}

function pluralWord(value, one, few, many) {
  const tens = value % 100;
  const ones = value % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (ones === 1) return one;
  if (ones >= 2 && ones <= 4) return few;
  return many;
}

function wait(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function withTimeout(promise, duration) {
  return Promise.race([
    promise,
    wait(duration).then(() => {
      throw new Error(
        "Дневник отвечает слишком долго. Обнови страницу и попробуй ещё раз.",
      );
    }),
  ]);
}

void initialize().catch((error) => showError(getPublicPopupError(error)));
