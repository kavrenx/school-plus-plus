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
import {
  ONBOARDING_KEY,
  createOnboardingController,
} from "./js/onboarding-controller.js";
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
  const mode = import.meta.env.VITE_APP_MODE || "local";
  const services = createSupabaseServices();
  let cloudUserPromise = null;
  let supportOwnerLabel = "Пользователь";
  let initialSiteStatus = { maintenanceEnabled: false, updatedAt: null };
  let restoringRoute = false;
  let appRouteReady = false;
  let studentDashboardController = null;

  function settleWithin(promise, duration, fallback) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise((resolve) => window.setTimeout(() => resolve(fallback), duration)),
    ]);
  }

  function readRoute() {
    const hash = window.location.hash.replace(/^#\/?/, "");
    if (hash.startsWith("connect/"))
      return { area: "connect", page: hash.slice("connect/".length) || "diary" };
    if (["diary", "schedule", "results"].includes(hash))
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
  const relayAction = relayParams.get("extension-action");
  const relayImport = relayParams.get("extension-sync") === "background";
  if (mode === "cloud" && (relayImport || relayAction === "delete")) {
    document.body.innerHTML =
      '<main class="relay-status" role="status">Обновляем School++…</main>';
    try {
      await ensureCloudUser();
      if (relayAction === "delete") {
        await services.diary.remove();
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

  const onboarding = createOnboardingController({
    root: document,
    windowRef: window,
    storeUrls: EXTENSION_STORE_URLS,
    requestSubmitter: async (request) => {
      await ensureCloudUser();
      return services.support.createDiaryRequest(request);
    },
    eventReporter: reportActivity,
    onStepChange: (step) => writeRoute("connect", step, !window.location.hash),
  });
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
  if (
    mode === "local" &&
    new URLSearchParams(window.location.search).get("preview") === "diary"
  ) {
    onboarding.complete();
    try {
      window.localStorage.removeItem(ONBOARDING_KEY);
    } catch {
      /* Preview mode must not affect the next real onboarding check. */
    }
  } else await onboarding.start();
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

  const localData = await loadAppData();
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
    if (Date.now() - lastExtensionRefresh < 2_000) return;
    lastExtensionRefresh = Date.now();
    if (mode === "cloud" && services) {
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
  const storage = createPreviewStorage(createSafeStorage(getBrowserStorage(window), {
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
  window.addEventListener("pagehide", () => siteStatusWatcher?.stop(), {
    once: true,
  });
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
    journalStore,
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

  function init() {
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
    try {
      window.localStorage.removeItem(ONBOARDING_KEY);
    } catch {
      /* Reload still returns to the current connection flow. */
    }
    window.location.reload();
  }

  async function loadAppData() {
    const savedDiaryPromise =
      mode === "cloud" && services
        ? settleWithin(
            (async () => {
              await ensureCloudUser();
              return services.diary.load();
            })(),
            5_000,
            null,
          ).catch((error) => {
            console.warn("Не удалось загрузить сохранённый дневник.", error);
            return null;
          })
        : Promise.resolve(null);
    try {
      const snapshot = await requestExtensionSnapshot(window, 2_500);
      if (snapshot) {
        if (mode === "cloud" && services) {
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
          return { ...imported, hasSyncedData: true };
      }
    } catch (error) {
      console.warn("Не удалось получить данные расширения.", error);
    }
    if (mode === "cloud" && services) {
      const saved = await savedDiaryPromise;
      try {
        const imported = adaptESchoolsSnapshot(saved?.payload);
        if (imported?.diary?.weeks?.length)
          return { ...imported, hasSyncedData: true };
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
    entries.forEach((entry) => store.saveJournalEntry(entry));
  }
});
