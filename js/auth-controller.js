import {
  findAccountByCredentials,
  findAccountByInviteCode,
} from "./auth-model.js";
import {
  formatInviteCode,
  getEyeIcon,
  setFieldInvalid,
} from "./ui-utils.js";

function createAuthController({
  root,
  accounts,
  userStore,
  translate,
  modal,
  feedback,
  onAuthenticated,
}) {
  const elements = {
    loginForm: root.getElementById("loginForm"),
    loginInput: root.getElementById("loginInput"),
    passwordInput: root.getElementById("passwordInput"),
    loginError: root.getElementById("loginError"),
    forgotButton: root.getElementById("forgotPasswordBtn"),
    forgotModal: root.getElementById("forgotModal"),
    registerButton: root.getElementById("registerBtn"),
    registerModal: root.getElementById("registerModal"),
    registerStepCode: root.getElementById("registerStepCode"),
    registerStepAccount: root.getElementById("registerStepAccount"),
    inviteForm: root.getElementById("inviteForm"),
    inviteCodeInput: root.getElementById("inviteCodeInput"),
    inviteError: root.getElementById("inviteError"),
    demoAccountName: root.getElementById("demoAccountName"),
    demoAccountClass: root.getElementById("demoAccountClass"),
    enterDemoButton: root.getElementById("enterDemoBtn"),
  };
  let pendingDemoAccount = null;

  function bind() {
    elements.loginForm.addEventListener("submit", handleLogin);
    elements.loginForm.addEventListener("input", clearLoginError);
    elements.forgotButton.addEventListener("click", () =>
      modal.open(elements.forgotModal),
    );
    elements.registerButton.addEventListener("click", openRegister);
    elements.inviteCodeInput.addEventListener("input", formatInviteInput);
    elements.inviteForm.addEventListener("submit", handleInviteSubmit);
    elements.enterDemoButton.addEventListener("click", enterDemoAccount);

    renderPasswordToggles();
  }

  function handleLogin(event) {
    event.preventDefault();
    const login = elements.loginInput.value.trim();
    const password = elements.passwordInput.value;
    const account = findAccountByCredentials(accounts, login, password);

    if (!account) {
      setFieldInvalid(elements.loginInput, true);
      setFieldInvalid(elements.passwordInput, true);
      feedback.show(elements.loginError, translate("loginError"));
      return;
    }

    authenticateAccount(account);
  }

  function openRegister() {
    elements.inviteForm.reset();
    pendingDemoAccount = null;
    feedback.hide(elements.inviteError);
    setFieldInvalid(elements.inviteCodeInput, false);
    elements.registerStepCode.classList.remove("hidden");
    elements.registerStepAccount.classList.add("hidden");
    modal.open(elements.registerModal);
    elements.inviteCodeInput.focus();
  }

  function formatInviteInput() {
    elements.inviteCodeInput.value = formatInviteCode(
      elements.inviteCodeInput.value,
    );
    feedback.hide(elements.inviteError);
    setFieldInvalid(elements.inviteCodeInput, false);
  }

  function handleInviteSubmit(event) {
    event.preventDefault();
    const account = findAccountByInviteCode(
      accounts,
      elements.inviteCodeInput.value.trim(),
    );

    if (!account) {
      setFieldInvalid(elements.inviteCodeInput, true);
      feedback.show(elements.inviteError, translate("inviteError"));
      return;
    }

    pendingDemoAccount = account;
    const summary = getDemoAccountSummary(account);
    elements.demoAccountName.textContent = summary.name;
    elements.demoAccountClass.textContent = summary.className;
    elements.registerStepCode.classList.add("hidden");
    elements.registerStepAccount.classList.remove("hidden");
    elements.enterDemoButton.focus();
  }

  function enterDemoAccount() {
    if (!pendingDemoAccount) return;
    modal.close(elements.registerModal);
    authenticateAccount(pendingDemoAccount);
  }

  function authenticateAccount(account) {
    const user = userStore.applyProfileOverrides(account);
    userStore.saveUser(user);
    clearLoginError();
    onAuthenticated(user);
  }

  function renderPasswordToggles() {
    root.querySelectorAll("[data-toggle-password]").forEach((button) => {
      const input = root.getElementById(button.dataset.togglePassword);
      button.innerHTML = getEyeIcon(false);
      button.addEventListener("click", () => {
        const isHidden = input.type === "password";
        input.type = isHidden ? "text" : "password";
        button.innerHTML = getEyeIcon(isHidden);
        button.setAttribute(
          "aria-label",
          isHidden ? translate("hidePassword") : translate("showPassword"),
        );
      });
    });
  }

  function resetLogin() {
    elements.loginForm.reset();
    clearLoginError();
  }

  function clearLoginError() {
    setFieldInvalid(elements.loginInput, false);
    setFieldInvalid(elements.passwordInput, false);
    feedback.hide(elements.loginError);
  }

  return { bind, resetLogin };
}

function getDemoAccountSummary(account = {}) {
  const fallbackName = `${account.firstName || ""} ${account.lastName || ""}`.trim();
  return {
    name: account.displayName || fallbackName || account.login || "—",
    className: account.className || "—",
  };
}

export { createAuthController, getDemoAccountSummary };
