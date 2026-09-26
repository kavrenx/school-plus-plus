import { SCHOOL_DIARY } from "./data/diary-data.js";
import { SCHOOL_DATA } from "./data/school-data.js";
import { STORAGE_KEYS, DAY_ORDER, TEXT } from "./js/app-config.js";
import { createAuthAccounts } from "./js/auth-model.js";
import { createAuthController } from "./js/auth-controller.js";
import { createDemoRepositories } from "./js/demo-repositories.js";
import { resetDemoData } from "./js/demo-data-reset.js";
import {
  createConnectionController,
  createNotificationController,
} from "./js/feedback-controller.js";
import { normalizeDiaryData } from "./js/diary-model.js";
import { JOURNAL_STORAGE_KEY } from "./js/journal-store.js";
import { createModalController } from "./js/modal-controller.js";
import { createProfileController } from "./js/profile-controller.js";
import { createPresentationController } from "./js/presentation-controller.js";
import { createScreenController } from "./js/screen-controller.js";
import { createSafeStorage, getBrowserStorage } from "./js/safe-storage.js";
import { createStudentDashboardController } from "./js/student-dashboard-controller.js";
import { createStudentClassController } from "./js/student-class-controller.js";
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
      initialSiteStatus = await services.status.get();
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
  const loginScreen = document.getElementById("loginScreen");
  const loginInput = document.getElementById("loginInput");
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
  const resetDemoButton = document.getElementById("resetDemoBtn");
  const resetDemoModal = document.getElementById("resetDemoModal");
  const cancelResetDemoButton = document.getElementById("cancelResetDemoBtn");
  const confirmResetDemoButton = document.getElementById("confirmResetDemoBtn");

  if (mode === "cloud") {
    document.getElementById("logoutModalTitle").textContent =
      "Вернуться к подключению?";
    logoutModal.querySelector("p").textContent =
      "Сохранённые данные останутся в School++ и в расширении.";
    confirmLogoutBtn.textContent = "Продолжить";
  }

  const localData = await loadAppData();
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
  const accounts = createAuthAccounts(diary.school.users);
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
  const userStore = repositories.users;
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
    screens: [loginScreen, presentationScreen, dashboardScreen, teacherScreen],
  });
  const themeController = createThemeController({
    root: document.body,
    icon: themeIcon,
    label: themeText,
    storage,
    storageKey: STORAGE_KEYS.theme,
    translate: t,
  });
  const studentDashboardController = createStudentDashboardController({
    root: document,
    diary,
    translate: t,
    onLogout: () => openModal(logoutModal),
    onThemeToggle: themeController.toggle,
    journalStore,
  });
  const studentClassController = createStudentClassController({
    root: document,
    model: diary,
    modal: { open: openModal },
  });
  const profileController = createProfileController({
    root: document,
    avatarRepository: repositories.avatars,
    userStore,
    accounts,
    translate: t,
    modal: { close: closeModal, open: openModal },
    feedback: { hide: hideMessage, show: showMessage },
    notify: notificationController.show,
    onUserChange(user) {
      studentDashboardController.updateUser(user);
      studentClassController.setUser(user);
    },
  });
  const authController = createAuthController({
    root: document,
    accounts,
    userStore,
    translate: t,
    modal: { close: closeModal, open: openModal },
    feedback: { hide: hideMessage, show: showMessage },
    onAuthenticated: showAppForUser,
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
    studentClassController.bind();
    profileController.bind();
    authController.bind();
    bindEvents();

    const savedUser =
      mode === "cloud"
        ? syncedStudent || accounts[0]
        : userStore.getSavedUser(accounts);
    if (savedUser) {
      showAppForUser(savedUser);
    } else {
      showLogin();
    }
  }

  function bindEvents() {
    cancelLogoutBtn.addEventListener("click", () => closeModal(logoutModal));
    confirmLogoutBtn.addEventListener("click", logout);
    resetDemoButton.addEventListener("click", () => openModal(resetDemoModal));
    cancelResetDemoButton.addEventListener("click", () => closeModal(resetDemoModal));
    confirmResetDemoButton.addEventListener("click", resetDemo);

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

  function showLogin() {
    destroyTeacherMode();
    studentDashboardController.destroy();
    screenController.show(loginScreen);
    presentationController.reset();
    resetPageScroll();
    loginInput.focus();
  }

  function showAppForUser(user) {
    profileController.setUser(user);
    studentClassController.setUser(user);
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
            <h1>${escapeHtml(user.displayName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.login)}</h1>
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
    if (mode === "cloud") {
      try {
        window.localStorage.removeItem(ONBOARDING_KEY);
      } catch {
        /* Reload still returns to the first-run route for this visit. */
      }
      window.location.reload();
      return;
    }
    userStore.clearUser();
    profileController.setUser(null);
    authController.resetLogin();
    closeModal(logoutModal);
    showLogin();
  }

  function resetDemo() {
    const result = resetDemoData({
      storage,
      accounts,
      storageKeys: STORAGE_KEYS,
      journalStorageKey: JOURNAL_STORAGE_KEY,
    });
    authController.resetLogin();
    profileController.setUser(null);
    closeModal(resetDemoModal);
    notificationController.show(
      t(result.persisted ? "demoResetSuccess" : "demoResetError"),
      { type: result.persisted ? "success" : "error" },
    );
  }

  async function loadAppData() {
    try {
      const snapshot = await requestExtensionSnapshot(window, 900);
      if (snapshot) {
        if (mode === "cloud" && services) {
          await ensureCloudUser();
          await services.diary.save(snapshot);
          void reportActivity("sync_received");
          notifyExtensionImported(window);
        }
        const imported = adaptESchoolsSnapshot(snapshot);
        if (imported?.diary?.weeks?.length) return imported;
      }
    } catch (error) {
      console.warn("Не удалось получить данные расширения.", error);
    }
    if (mode === "cloud" && services) {
      try {
        await ensureCloudUser();
        const saved = await services.diary.load();
        const imported = adaptESchoolsSnapshot(saved?.payload);
        if (imported?.diary?.weeks?.length) return imported;
      } catch (error) {
        console.warn("Не удалось загрузить сохранённый дневник.", error);
      }
    }
    return createLocalPreviewData(SCHOOL_DIARY, SCHOOL_DATA);
  }

  function importJournalEntries(store, entries = []) {
    entries.forEach((entry) => store.saveJournalEntry(entry));
  }
});
