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

document.addEventListener("DOMContentLoaded", () => {
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

  const schoolData = SCHOOL_DATA || {};
  const diary = normalizeDiaryData(SCHOOL_DIARY || { weeks: [] }, DAY_ORDER, schoolData);
  const accounts = createAuthAccounts(diary.school.users);
  const storage = createSafeStorage(getBrowserStorage(window), {
    onError: ({ operation, error }) =>
      console.warn(`Не удалось выполнить операцию с хранилищем: ${operation}`, error),
  });
  const repositories = createDemoRepositories({
    storage,
    storageKeys: STORAGE_KEYS,
  });
  const userStore = repositories.users;
  const journalStore = repositories.journal;
  const modalController = createModalController();
  connectionStatusText.textContent = t("connectionOffline");
  const notificationController = createNotificationController({
    element: appNotification,
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
  const presentationController = createPresentationController({
    root: document,
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
    presentationController.bind();
    bindEvents();

    const savedUser = userStore.getSavedUser(accounts);
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

});
