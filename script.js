import { SCHOOL_DIARY } from "./data/diary-data.js";
import { SCHOOL_DATA } from "./data/school-data.js";
import { STORAGE_KEYS, DAY_ORDER, TEXT } from "./js/app-config.js";
import { createDemoRepositories } from "./js/demo-repositories.js";
import {
  createConnectionController,
  createNotificationController,
} from "./js/feedback-controller.js";
import { normalizeDiaryData } from "./js/diary-model.js";
import { createModalController } from "./js/modal-controller.js";
import { createProfileController } from "./js/profile-controller.js";
import { createPresentationController } from "./js/presentation-controller.js";
import { createScreenController } from "./js/screen-controller.js";
import { createSafeStorage, getBrowserStorage } from "./js/safe-storage.js";
import { createStudentDashboardController } from "./js/student-dashboard-controller.js";
import { createImportedFinalGradesView } from "./js/imported-final-grades.js";
import { mount as mountTeacherMode } from "./js/teacher-mode.js";
import { createThemeController } from "./js/theme-controller.js";
import { escapeHtml, hideMessage, showMessage } from "./js/ui-utils.js";
import { registerIcons } from "./js/icons.js";
import { createLocalPreviewData, createPreviewStorage } from "./js/local-preview-data.js";
import {
  notifyExtensionImported,
  requestExtensionSnapshot,
  subscribeToExtensionSnapshots,
} from "./js/extension-import.js";
import { adaptESchoolsSnapshot } from "./js/e-schools-adapter.js";
import { requestStartupExtensionSnapshot } from "./js/startup-diary-source.js";
import { createStartupDiaryLoad } from "./js/startup-history.js";
import { createDiaryChangeTracker } from "./js/diary-changes.js";
import { createAnalyticsPreviewData, createPreviewChangeBaseline } from "./js/analytics-preview.js";
import {
  ONBOARDING_KEY,
  createOnboardingController,
} from "./js/onboarding-controller.js";
import { createDeviceController } from "./js/device-controller.js";
import { createDiaryRevisionWatcher } from "./js/device-repository.js";
import { createLinkedDiaryCache } from "./js/linked-diary-cache.js";
import { createMobileViewportController } from "./js/mobile-viewport.js";
import { formatDiaryFreshness } from "./js/diary-freshness.js";
import { readIOSPreview } from "./js/ios-shortcut-preview.js";
import { createUserscriptClient, readUserscriptCache, readUserscriptDiary, shouldRefreshUserscript, USERSCRIPT_CACHE } from "./js/userscript-client.js";
import { createUserscriptImporter } from "./js/userscript-import.js";
import { createUserscriptAutoSync } from "./js/userscript-auto-sync.js";
import { transitionToUserscriptSync } from "./js/userscript-progress.js";
import { EXTENSION_STORE_URLS } from "./js/release-config.js";
import { createSupabaseServices } from "./js/supabase-services.js";
import { createSupportController } from "./js/support-controller.js";
import { createActivityReporter } from "./js/site-activity.js";
import { createSiteStatusWatcher } from "./js/site-status.js";
import {
  renderMaintenancePage,
  setMaintenanceNotice,
} from "./js/status-page.js";

registerIcons();

document.addEventListener("DOMContentLoaded", async () => {
  const mobileViewport = createMobileViewportController(window);
  mobileViewport.start();
  window.addEventListener("pagehide", mobileViewport.stop);
  window.addEventListener("pageshow", (event) => { if (event.persisted) mobileViewport.start(); });
  const mode = import.meta.env.VITE_APP_MODE || "local";
  const services = createSupabaseServices();
  let cloudUserPromise = null;
  let supportOwnerLabel = "Пользователь";
  let initialSiteStatus = { maintenanceEnabled: false, updatedAt: null };
  let restoringRoute = false;
  let appRouteReady = false;
  let studentDashboardController = null;
  let deviceController = null;
  let diaryRevisionWatcher = null;
  let deviceAccess = { role: "unpaired" };
  let authUser = null;
  const browserStorage = createSafeStorage(getBrowserStorage(window));
  const linkedCache = createLinkedDiaryCache(browserStorage);

  function settleWithin(promise, duration, fallback) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise((resolve) => window.setTimeout(() => resolve(fallback), duration)),
    ]);
  }

  function readRoute() {
    const hash = window.location.hash.replace(/^#\/?/, "").split("?")[0];
    if (hash.startsWith("connect/"))
      return { area: "connect", page: hash.slice("connect/".length) || "diary" };
    if (["diary", "schedule", "results", "profile"].includes(hash))
      return { area: "app", page: hash };
    return { area: "", page: "" };
  }

  function writeRoute(area, page, replace = false) {
    if (restoringRoute) return;
    const hash = area === "connect" ? `#connect/${page}` : `#${page}`;
    if (window.location.hash === hash) return;
    const method = replace ? "replaceState" : "pushState";
    window.history[method]({ schoolpp: true, area, page }, "", hash);
  }

  async function ensureCloudUser() {
    if (!services) throw new Error("Подключение сервера не настроено.");
    if (!cloudUserPromise) {
      cloudUserPromise = (async () => {
        const current = await services.auth.getUser();
        if (current) return current;
        const result = await services.auth.signInAnonymously();
        return result.user;
      })().catch((error) => {
        cloudUserPromise = null;
        throw error;
      });
    }
    return cloudUserPromise;
  }

  const reportActivity = createActivityReporter({
    services: mode === "cloud" ? services : null,
    ensureUser: ensureCloudUser,
    navigatorRef: window.navigator,
  });
  if (mode === "cloud") void reportActivity("page_view");

  const relayParams = new URLSearchParams(window.location.search);
  let userscriptOwner;
  try { userscriptOwner = await services?.auth.getCachedUser(); } catch { /* Cached data remain scoped to a known session. */ }
  const userscriptDiary = readUserscriptDiary(browserStorage, userscriptOwner?.id);
  const userscriptCache = import.meta.env.DEV && !userscriptDiary ? readUserscriptCache(browserStorage) : null;
  const iosPreviewRequested = import.meta.env.DEV && relayParams.get("ios-import") === "preview";
  const iosPreview = iosPreviewRequested ? readIOSPreview(window.sessionStorage) || userscriptCache : null;
  if (iosPreviewRequested && !iosPreview?.snapshot) {
    window.location.replace(new URL("ios-setup.html#iosFullTest", window.location.href));
    return;
  }
  const isLocalPreview = Boolean(iosPreview) || mode === "local" && ["diary", "analytics"].includes(relayParams.get("preview"));
  const diaryNetworkEnabled = Boolean(services) && !isLocalPreview;
  const pairingCode = new URLSearchParams(window.location.hash.split("?")[1] || "").get("pair") || "";
  const relayAction = relayParams.get("extension-action");
  const relayImport = relayParams.get("extension-sync") === "background";
  if (mode === "cloud" && (relayImport || relayAction === "delete")) {
    document.body.innerHTML =
      '<main class="relay-status" role="status">Обновляем School++…</main>';
    try {
      await ensureCloudUser();
      if (relayAction === "delete") {
        await services.diary.remove();
        browserStorage.removeItem(USERSCRIPT_CACHE);
      } else {
        const snapshot = await requestExtensionSnapshot(window, 4_000);
        if (!snapshot) throw new Error("Расширение не передало данные.");
        await services.diary.save(snapshot);
        void reportActivity("sync_received");
      }
      notifyExtensionImported(window);
      document.querySelector(".relay-status").textContent = "Готово";
    } catch (error) {
      console.warn("Не удалось сохранить фоновое обновление.", error);
      document.querySelector(".relay-status").textContent =
        "Не удалось обновить данные";
    }
    return;
  }

  if (relayParams.get("preview") === "maintenance") {
    renderMaintenancePage(document, { preview: true });
    return;
  }

  if (mode === "cloud" && services) {
    try {
      initialSiteStatus = await settleWithin(services.status.get(), 5_000, initialSiteStatus);
      if (initialSiteStatus.maintenanceEnabled) {
        renderMaintenancePage(document);
        return;
      }
    } catch (error) {
      console.warn("Не удалось проверить состояние сервиса.", error);
    }
  }

  const presentationController = createPresentationController({
    root: document,
    windowRef: window,
  });
  presentationController.bind();

  const supportController = createSupportController({
    root: document,
    windowRef: window,
    repositoryProvider: async () => {
      await ensureCloudUser();
      return services.support;
    },
    ownerLabelProvider: () => supportOwnerLabel,
    onOpen: () => void reportActivity("support_opened"),
  });
  supportController.bind();

  if (diaryNetworkEnabled) {
    try {
      authUser = await services.auth.getCachedUser();
      const cached = linkedCache.read(authUser?.id);
      if (cached) deviceAccess = cached.access;
      else {
        authUser = await settleWithin(ensureCloudUser(), 4_000, null);
        if (authUser) deviceAccess = await settleWithin(services.devices.access(), 4_000, deviceAccess);
      }
    } catch { /* A local extension diary remains usable if the server is unavailable. */ }
  }

  const onboarding = createOnboardingController({
    root: document,
    windowRef: window,
    storeUrls: EXTENSION_STORE_URLS,
    initialStep: pairingCode ? "mobile" : readRoute().area === "connect" ? readRoute().page : "",
    shortcutSetupUrl: import.meta.env.DEV ? new URL("ios-setup.html", window.location.href).href : "",
    userscriptSetupUrl: new URL("userscripts-setup.html", window.location.href).href,
    pairingCode,
    onMobileOpen: () => void deviceController?.resumeClient(),
    requestSubmitter: async (request) => {
      await ensureCloudUser();
      return services.support.createDiaryRequest(request);
    },
    eventReporter: reportActivity,
    onStepChange: (step) => writeRoute("connect", step, !window.location.hash),
  });
  deviceController = createDeviceController({
    root: document, windowRef: window,
    origin: (import.meta.env.DEV && import.meta.env.VITE_PAIRING_ORIGIN) || window.location.href,
    repositoryProvider: async () => { authUser = await ensureCloudUser(); return services.devices; },
    prepareOwner: async () => {
      authUser = await ensureCloudUser();
      const access = await services.devices.access();
      if (access.role === "linked") return;
      const snapshot = await requestExtensionSnapshot(window, 2_500) || localData.rawSnapshot;
      if (snapshot) await services.diary.save(snapshot);
      const events = changeTracker.getState().changes;
      if (events.length && !(await services.devices.history()).length) await services.devices.saveEvents(events.map(({ read: _read, ...event }) => event));
      deviceAccess = await services.devices.access();
    },
    onPaired: async () => {
      authUser = await ensureCloudUser();
      deviceAccess = await services.devices.access();
      const snapshot = await services.devices.readLinked();
      if (!adaptESchoolsSnapshot(snapshot?.payload)?.diary?.weeks?.length) throw new Error("Дневник пока не готов. Обнови данные на компьютере и попробуй снова.");
      linkedCache.save(authUser.id, deviceAccess, snapshot);
      onboarding.complete();
      window.location.reload();
    },
    onDisconnected: disconnectLinkedDevice,
  });
  deviceController.bind();
  window.addEventListener("popstate", () => {
    const route = readRoute();
    let normalizeAppRoute = false;
    restoringRoute = true;
    try {
      if (appRouteReady) {
        studentDashboardController?.showSection(
          route.area === "app" ? route.page : "diary",
          false,
        );
        normalizeAppRoute = route.area !== "app";
      } else if (route.area === "connect") onboarding.navigateToStep(route.page);
    } finally {
      restoringRoute = false;
    }
    if (normalizeAppRoute) writeRoute("app", "diary", true);
  });
  if (iosPreview) {
    document.getElementById("onboardingScreen").classList.add("hidden");
    document.getElementById("onboardingScreen").setAttribute("aria-hidden", "true");
  } else if (
    mode === "local" &&
    ["diary", "analytics"].includes(new URLSearchParams(window.location.search).get("preview"))
  ) {
    onboarding.complete();
    try {
      window.localStorage.removeItem(ONBOARDING_KEY);
    } catch {
      /* Preview mode must not affect the next real onboarding check. */
    }
  } else if (deviceAccess.role === "linked" && !["methods", "device-choice"].includes(readRoute().page)) onboarding.complete();
  else await onboarding.start();
  const dashboardScreen = document.getElementById("dashboardScreen");
  const presentationScreen = document.getElementById("presentationScreen");
  const teacherScreen = document.getElementById("teacherScreen");
  const themeIcon = document.getElementById("themeIcon");
  const themeText = document.getElementById("themeText");
  const logoutModal = document.getElementById("logoutModal");
  const cancelLogoutBtn = document.getElementById("cancelLogoutBtn");
  const confirmLogoutBtn = document.getElementById("confirmLogoutBtn");
  const appNotification = document.getElementById("appNotification");
  const connectionStatus = document.getElementById("connectionStatus");
  const connectionStatusText = document.getElementById("connectionStatusText");
  document.getElementById("logoutModalTitle").textContent =
    "Вернуться к подключению?";
  logoutModal.querySelector("p").textContent =
    "Сохранённые данные останутся в School++ и в расширении.";
  confirmLogoutBtn.textContent = "Продолжить";

  let startupDiaryLoadReady = null;
  let startupHistoryCancelled = false;
  window.addEventListener("pagehide", (event) => {
    // BFCache pauses this document; the read rechecks its owner when resumed.
    if (event.persisted) return;
    startupHistoryCancelled = true;
    void startupDiaryLoadReady?.then((load) => load?.cancel()).catch(() => {});
  });
  let localData = await loadAppData();
  const analyticsPreview = mode === "local" && relayParams.get("preview") === "analytics";
  const previewValues = new Map();
  if (iosPreview) previewValues.set(STORAGE_KEYS.theme, browserStorage.getItem(STORAGE_KEYS.theme));
  const changeTracker = createDiaryChangeTracker(analyticsPreview || iosPreview ? { getItem: (key) => previewValues.get(key), setItem: (key, value) => previewValues.set(key, value) } : createSafeStorage(getBrowserStorage(window)));
  if (analyticsPreview) {
    const previewNow = Date.now();
    const baseline = createPreviewChangeBaseline(localData);
    baseline.importedAt = new Date(previewNow - 2 * 86_400_000).toISOString();
    changeTracker.record(baseline);
    const previousDay = structuredClone(baseline);
    previousDay.importedAt = new Date(previewNow - 86_400_000).toISOString();
    const marked = previousDay.journalEntries.find((entry) => entry.grades.length && entry.grades[0] !== "зачёт");
    if (marked) marked.grades = ["5"];
    changeTracker.record(previousDay);
    localData.importedAt = new Date(previewNow).toISOString();
  }
  if (localData.hasSyncedData) changeTracker.record(localData);
  if (Array.isArray(localData.sharedChanges) && localData.sharedChanges.length) changeTracker.importShared(localData.sharedChanges);
  const diaryPreview =
    mode === "local" &&
    new URLSearchParams(window.location.search).get("preview") === "diary";
  if (!localData.hasSyncedData && !diaryPreview) {
    try {
      window.localStorage.removeItem(ONBOARDING_KEY);
    } catch {
      /* The onboarding still opens for the current visit. */
    }
    await onboarding.start();
    window.location.reload();
    return;
  }
  let lastExtensionRefresh = 0;
  subscribeToExtensionSnapshots(window, async (snapshot) => {
    if (analyticsPreview || iosPreview || deviceAccess.role === "linked") return;
    if (Date.now() - lastExtensionRefresh < 2_000) return;
    lastExtensionRefresh = Date.now();
    const nextImport = adaptESchoolsSnapshot(snapshot);
    if (nextImport?.diary?.weeks?.length) changeTracker.record(nextImport);
    if (diaryNetworkEnabled) {
      try {
        await ensureCloudUser();
        await services.diary.save(snapshot);
        void reportActivity("sync_received");
        notifyExtensionImported(window);
      } catch (error) {
        console.warn("Не удалось сохранить обновление дневника.", error);
        return;
      }
    }
    window.location.reload();
  });
  const schoolData = localData.school;
  const diary = normalizeDiaryData(localData.diary, DAY_ORDER, schoolData);
  const accounts = normalizeUsers(diary.school.users);
  const syncedStudent = accounts.find((account) => account.role === "student");
  supportOwnerLabel =
    syncedStudent?.displayName ||
    [syncedStudent?.firstName, syncedStudent?.lastName].filter(Boolean).join(" ") ||
    "Ученик";
  const storage = createPreviewStorage(createSafeStorage(analyticsPreview || iosPreview ? { getItem: (key) => previewValues.get(key), setItem: (key, value) => previewValues.set(key, value), removeItem: (key) => previewValues.delete(key) } : getBrowserStorage(window), {
    onError: ({ operation, error }) =>
      console.warn(`Не удалось выполнить операцию с хранилищем: ${operation}`, error),
  }));
  const repositories = createDemoRepositories({
    storage,
    storageKeys: STORAGE_KEYS,
  });
  const journalStore = repositories.journal;
  importJournalEntries(journalStore, localData.journalEntries);
  const modalController = createModalController();
  connectionStatusText.textContent = t("connectionOffline");
  const notificationController = createNotificationController({
    element: appNotification,
  });
  const siteStatusWatcher =
    mode === "cloud" && services
      ? createSiteStatusWatcher({
          repository: services.status,
          windowRef: window,
          onChange: (status) =>
            setMaintenanceNotice(document, status.maintenanceEnabled),
        })
      : null;
  siteStatusWatcher?.start(initialSiteStatus);
  const connectionController = createConnectionController({
    element: connectionStatus,
    windowRef: window,
    onRestored: () =>
      notificationController.show(t("connectionRestored"), {
        type: "success",
      }),
  });
  const { close: closeModal, open: openModal } = modalController;
  const screenController = createScreenController({
    screens: [presentationScreen, dashboardScreen, teacherScreen],
  });
  const themeController = createThemeController({
    root: document.body,
    icon: themeIcon,
    label: themeText,
    storage,
    storageKey: STORAGE_KEYS.theme,
    translate: t,
  });
  studentDashboardController = createStudentDashboardController({
    root: document,
    diary,
    translate: t,
    onLogout: () => openModal(logoutModal),
    onThemeToggle: themeController.toggle,
    journalStore: createImportedFinalGradesView(
      journalStore, () => localData.finalGrades,
    ),
    readOnlyDevice: deviceAccess.role === "linked",
    extensionMaterialsAvailable: !userscriptDiary,
    changeTracker,
    coverageNotice: localData.coverage && !localData.coverage.hasSchedule ? "Расписание получено не полностью. Количество оставшихся уроков может быть неточным." : "",
    onSectionChange: (section) => {
      if (appRouteReady) writeRoute("app", section);
    },
  });
  const profileController = createProfileController({
    root: document,
    avatarRepository: repositories.avatars,
    translate: t,
    modal: { close: closeModal, open: openModal },
    feedback: { hide: hideMessage, show: showMessage },
    notify: notificationController.show,
  });
  let teacherMode = null;

  init();
  if (startupDiaryLoadReady) {
    const scope = changeTracker.getState().scope;
    void startupDiaryLoadReady.then((load) => load?.finish({
      isSameDiary: () => changeTracker.getState().scope === scope,
      onChanges: (changes) => {
        if (changes.length) changeTracker.importShared(changes);
      },
      onState: (state) => studentDashboardController.refreshChanges(state),
    })).catch(() => { console.warn("Не удалось загрузить историю изменений."); });
  }
  const devicesButton = document.getElementById("studentDevicesButton");
  if (devicesButton) devicesButton.hidden = !diaryNetworkEnabled || deviceAccess.role === "linked";
  setDiaryFreshness();
  if (diaryNetworkEnabled) {
    deviceController.start();
    diaryRevisionWatcher = createDiaryRevisionWatcher({
      repository: services.devices, windowRef: window, initialAccess: deviceAccess,
      initialRevision: localData.cloudUpdatedAt,
      onUpdate: async (access) => {
        const saved = access.role === "linked" ? await services.devices.readLinked() : await services.diary.load();
        const imported = adaptESchoolsSnapshot(saved?.payload);
        if (!imported?.diary?.weeks?.length) return;
        if (access.role === "linked") linkedCache.save(authUser?.id, access, saved);
        if (!localData.importedAt || !imported.importedAt || imported.importedAt >= localData.importedAt) {
          localData = { ...imported, rawSnapshot: saved.payload, hasSyncedData: true, cloudUpdatedAt: saved.updated_at };
          changeTracker.record(localData);
          if (Array.isArray(saved.changes) && (access.role === "linked" || saved.changes.length)) changeTracker.importShared(saved.changes);
          importJournalEntries(journalStore, imported.journalEntries);
          studentDashboardController.updateDiary(normalizeDiaryData(imported.diary, DAY_ORDER, imported.school));
          setDiaryFreshness();
        }
      },
      onRevoked: disconnectLinkedDevice,
      onHealthy: () => setDiaryFreshness(),
      onError: () => setDiaryFreshness(true),
    });
    diaryRevisionWatcher.start();
    window.addEventListener("pagehide", () => diaryRevisionWatcher.stop());
    window.addEventListener("pageshow", (event) => { if (event.persisted) { diaryRevisionWatcher.start(); void diaryRevisionWatcher.check(); } });
  }

  function setDiaryFreshness(unavailable = false) {
    const node = document.getElementById("studentSyncFreshness");
    if (!node) return;
    node.textContent = formatDiaryFreshness(localData.importedAt);
    node.title = unavailable ? "Не удаётся обновить данные. Показываем последнюю сохранённую версию." : "";
    node.classList.toggle("is-unavailable", unavailable);
  }

  async function disconnectLinkedDevice() {
    diaryRevisionWatcher?.stop(); deviceController?.stop();
    linkedCache.clear();
    browserStorage.removeItem(ONBOARDING_KEY);
    browserStorage.removeItem("schoolpp_empty_schoolPlusPlus_journalEntries");
    browserStorage.removeItem("schoolpp_diary_changes_v1");
    window.history.replaceState(null, "", "#connect/mobile");
    window.location.reload();
  }

  function init() {
    if (userscriptDiary && deviceAccess.role !== "linked" && !iosPreview) {
      const update = document.getElementById("studentSyncButton");
      const syncStatus = document.getElementById("studentSyncStatus");
      const synchronize = () => void transitionToUserscriptSync(window, new URL("userscripts-sync.html", window.location.href).href);
      if (update) { update.hidden = false; update.addEventListener("click", synchronize); }
      if (userscriptDiary.cloudPending) {
        if (syncStatus) { syncStatus.hidden = false; syncStatus.textContent = "Дневник сохранён на телефоне. Ожидаем подтверждение сервера…"; }
        void createUserscriptImporter({ services, storage: browserStorage }).retryUpload().then((saved) => {
          if (syncStatus) { syncStatus.hidden = saved; syncStatus.textContent = saved ? "" : "Дневник доступен на телефоне. Сохранение на сервере можно повторить кнопкой синхронизации."; }
        }).catch(() => { if (syncStatus) syncStatus.textContent = "Дневник доступен на телефоне. Для сохранения на сервере проверь соединение."; });
      }
      createUserscriptAutoSync({
        windowRef: window, ownerId: userscriptOwner.id,
        getCache: () => readUserscriptDiary(browserStorage, userscriptOwner.id), onSync: synchronize,
      }).start();
    }
    if (iosPreview) {
      const notice = document.createElement("p");
      notice.className = "ios-preview-notice";
      notice.textContent = "Тест данных с iPhone · данные на сервере не изменяются. ";
      const back = document.createElement("a");
      back.href = new URL("ios-setup.html#iosFullTest", window.location.href).href;
      if (iosPreview.snapshot.import?.transport === "userscript-test") {
        back.href = new URL("userscripts-setup.html", window.location.href).href;
        const update = document.createElement("button");
        update.type = "button";
        update.className = "onboarding-secondary";
        update.textContent = "Обновить данные с iPhone";
        update.addEventListener("click", () => { window.location.href = new URL("userscripts-setup.html?sync=1", window.location.href).href; });
        notice.append(update, document.createTextNode(" "));
        let checkingUserscript = false;
        const maybeRefresh = () => {
          if (checkingUserscript || !shouldRefreshUserscript(userscriptCache, browserStorage) || document.visibilityState !== "visible") return;
          checkingUserscript = true;
          void createUserscriptClient(window).ping().then(() => {
            if (document.visibilityState === "visible") window.location.href = new URL("userscripts-setup.html?sync=1", window.location.href).href;
          }).catch(() => { update.textContent = "Включи Userscripts для обновления"; }).finally(() => { checkingUserscript = false; });
        };
        document.addEventListener("visibilitychange", maybeRefresh);
        window.addEventListener("focus", maybeRefresh);
        maybeRefresh();
      }
      back.textContent = "Вернуться к проверке";
      notice.append(back);
      dashboardScreen.prepend(notice);
    }
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    themeController.load();
    connectionController.bind();
    studentDashboardController.bind();
    profileController.bind();
    bindEvents();

    const savedUser = syncedStudent || accounts[0];
    if (savedUser) {
      appRouteReady = true;
      const initialRoute = readRoute();
      const initialSection =
        initialRoute.area === "app" ? initialRoute.page : "diary";
      writeRoute("app", initialSection, true);
      showAppForUser(savedUser);
      studentDashboardController.showSection(initialSection, false);
    } else {
      returnToOnboarding();
    }
  }

  function bindEvents() {
    cancelLogoutBtn.addEventListener("click", () => closeModal(logoutModal));
    confirmLogoutBtn.addEventListener("click", logout);
    document.querySelectorAll("[data-close-modal]").forEach((button) => {
      button.addEventListener("click", () => {
        closeModal(document.getElementById(button.dataset.closeModal));
      });
    });

    document.querySelectorAll(".modal-overlay").forEach((modal) => {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) closeModal(modal);
      });
    });

    document.addEventListener("keydown", (event) => {
      modalController.handleKeydown(event);
    });
  }

  function t(key) {
    return TEXT[key] ?? key;
  }

  function showAppForUser(user) {
    profileController.setUser(user);
    if (user?.role === "teacher") {
      showTeacherDashboard(user);
      return;
    }

    if (user?.role === "admin") {
      showAdminDashboard(user);
      return;
    }

    showStudentDashboard(user);
  }

  function showStudentDashboard(user) {
    destroyTeacherMode();
    studentDashboardController.show(user);
    screenController.show(dashboardScreen);
    resetPageScroll();
  }

  function showTeacherDashboard(user) {
    studentDashboardController.destroy();
    teacherMode?.destroy();
    teacherMode = mountTeacherMode(teacherScreen, {
      user,
      model: diary,
      store: journalStore,
      onLogout: () => openModal(logoutModal),
      onThemeToggle: themeController.toggle,
      syncTheme: () => themeController.syncControl(teacherScreen),
      notify: notificationController.show,
    });
    screenController.show(teacherScreen);
    resetPageScroll();
  }

  function showAdminDashboard(user) {
    studentDashboardController.destroy();
    destroyTeacherMode();
    teacherScreen.innerHTML = `
      <header class="topbar teacher-topbar">
        <span class="brand-mark">SCHOOL++</span>
        <div class="topbar-actions">
          <button class="support-btn" type="button" data-open-support>
            <school-icon name="headset-outline" aria-hidden="true"></school-icon>
            <span>Поддержка</span>
          </button>
          <button class="theme-toggle" type="button" data-admin-theme>
            <span class="theme-icon"></span>
            <span class="theme-text"></span>
          </button>
          <button class="logout-btn" type="button" data-admin-logout>${t("logout")}</button>
        </div>
      </header>
      <main class="teacher-layout admin-placeholder" id="adminMainContent">
        <section class="teacher-hero">
          <div>
            <p class="card-label">Администратор</p>
            <h1>${escapeHtml(user.displayName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Администратор")}</h1>
            <p>Панель администратора появится позже.</p>
          </div>
        </section>
      </main>
    `;
    const adminThemeButton = teacherScreen.querySelector("[data-admin-theme]");
    themeController.syncControl(adminThemeButton);
    adminThemeButton?.addEventListener("click", () => {
      themeController.toggle();
      themeController.syncControl(adminThemeButton);
    });
    teacherScreen.querySelector("[data-admin-logout]")?.addEventListener("click", () => openModal(logoutModal));
    screenController.show(teacherScreen);
    resetPageScroll();
  }

  function destroyTeacherMode() {
    teacherMode?.destroy();
    teacherMode = null;
  }

  function resetPageScroll() {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  function logout() {
    profileController.setUser(null);
    closeModal(logoutModal);
    returnToOnboarding();
  }

  function returnToOnboarding() {
    if (iosPreview) {
      window.location.href = new URL("ios-setup.html#iosFullTest", window.location.href).href;
      return;
    }
    try {
      window.localStorage.removeItem(ONBOARDING_KEY);
    } catch {
      /* Reload still returns to the current connection flow. */
    }
    window.location.reload();
  }

  async function loadAppData() {
    if (iosPreview) return { ...iosPreview.data, rawSnapshot: iosPreview.snapshot, hasSyncedData: true };
    if (mode === "local" && relayParams.get("preview") === "analytics") return createAnalyticsPreviewData(SCHOOL_DIARY, SCHOOL_DATA);
    if (deviceAccess.role === "linked") {
      const cached = linkedCache.read(authUser?.id);
      const saved = cached?.snapshot || await services.devices.readLinked();
      const imported = adaptESchoolsSnapshot(saved?.payload);
      if (imported?.diary?.weeks?.length) return { ...imported, rawSnapshot: saved.payload, sharedChanges: saved.changes || [], hasSyncedData: true, cloudUpdatedAt: saved.updated_at };
      throw new Error("Не удалось загрузить подключённый дневник.");
    }
    if (userscriptDiary) return { ...userscriptDiary.data, rawSnapshot: userscriptDiary.snapshot, hasSyncedData: true };
    if (diaryNetworkEnabled) {
      startupDiaryLoadReady = ensureCloudUser().then((owner) => {
        if (startupHistoryCancelled) return null;
        return createStartupDiaryLoad({
          repository: services.diary, auth: services.auth, ownerId: owner.id,
        });
      });
    }
    const savedDiaryPromise =
      diaryNetworkEnabled
        ? settleWithin(
            startupDiaryLoadReady.then((load) => load?.snapshot),
            5_000,
            null,
          ).catch((error) => {
            console.warn("Не удалось загрузить сохранённый дневник.", error);
            return null;
          })
        : Promise.resolve(null);
    try {
      const snapshot = await requestStartupExtensionSnapshot(window);
      if (snapshot) {
        if (diaryNetworkEnabled) {
          void (async () => {
            try {
              const cloudUser = await settleWithin(ensureCloudUser(), 5_000, null);
              if (!cloudUser) return;
              await settleWithin(services.diary.save(snapshot), 7_000, null);
              void reportActivity("sync_received");
              notifyExtensionImported(window);
            } catch (error) {
              console.warn("Не удалось сохранить данные расширения в облаке.", error);
            }
          })();
        }
        const imported = adaptESchoolsSnapshot(snapshot);
        if (imported?.diary?.weeks?.length)
          return { ...imported, rawSnapshot: snapshot, hasSyncedData: true };
      }
    } catch (error) {
      console.warn("Не удалось получить данные расширения.", error);
    }
    if (diaryNetworkEnabled) {
      const saved = await savedDiaryPromise;
      try {
        const imported = adaptESchoolsSnapshot(saved?.payload);
        if (imported?.diary?.weeks?.length)
          return { ...imported, rawSnapshot: saved.payload, sharedChanges: saved.changes || [], hasSyncedData: true, cloudUpdatedAt: saved.updated_at };
      } catch (error) {
        console.warn("Не удалось разобрать сохранённый дневник.", error);
      }
    }
    return {
      ...createLocalPreviewData(SCHOOL_DIARY, SCHOOL_DATA),
      hasSyncedData: false,
    };
  }

  function normalizeUsers(users = []) {
    return users.filter(Boolean).map((user) => {
      const id = user.id || user.userId;
      return { ...user, id, userId: user.userId || id };
    });
  }

  function importJournalEntries(store, entries = []) {
    if (typeof store.saveJournalEntries === "function") {
      store.saveJournalEntries(entries);
      return;
    }
    entries.forEach((entry) => store.saveJournalEntry(entry));
  }
});
