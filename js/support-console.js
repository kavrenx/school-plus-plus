import { registerIcons } from "./icons.js";
import { createSupabaseServices } from "./supabase-services.js";
import { createSupportController } from "./support-controller.js";

const OPERATOR_EMAIL = "support@schoolpp.com";

registerIcons();

document.addEventListener("DOMContentLoaded", async () => {
  const login = document.getElementById("supportConsoleLogin");
  const workspace = document.getElementById("supportConsoleWorkspace");
  const form = document.getElementById("supportConsoleForm");
  const loginInput = document.getElementById("supportConsoleLoginInput");
  const passwordInput = document.getElementById("supportConsolePassword");
  const error = document.getElementById("supportConsoleError");
  const logout = document.getElementById("supportConsoleLogout");
  const services = createSupabaseServices(import.meta.env, {
    storageKey: "schoolpp_support_session",
  });

  if (!services) {
    showError("Подключение сервера не настроено.");
    form.querySelector("button").disabled = true;
    return;
  }

  const controller = createSupportController({
    root: document,
    windowRef: window,
    repositoryProvider: async () => services.support,
  });
  controller.bind();

  async function showWorkspace() {
    const user = await services.auth.getUser();
    if (!user || !(await services.support.isAgent())) {
      if (user) await services.auth.signOut();
      throw new Error("Доступ есть только у оператора поддержки.");
    }
    login.hidden = true;
    workspace.hidden = false;
    await controller.open();
  }

  try {
    if (await services.auth.getUser()) await showWorkspace();
  } catch {
    login.hidden = false;
    workspace.hidden = true;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    error.hidden = true;
    try {
      const enteredLogin = loginInput.value.trim().toLowerCase();
      if (enteredLogin !== "support" && enteredLogin !== OPERATOR_EMAIL)
        throw new Error("Неверный логин или пароль.");
      await services.auth.signIn(OPERATOR_EMAIL, passwordInput.value);
      passwordInput.value = "";
      await showWorkspace();
    } catch (reason) {
      try {
        if (await services.auth.getUser()) await services.auth.signOut();
      } catch {
        /* The original sign-in error is more useful. */
      }
      showError(
        reason?.message === "Доступ есть только у оператора поддержки."
          ? reason.message
          : "Неверный логин или пароль.",
      );
    } finally {
      button.disabled = false;
    }
  });

  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      controller.close();
      await services.auth.signOut();
      workspace.hidden = true;
      login.hidden = false;
      loginInput.focus();
    } finally {
      logout.disabled = false;
    }
  });

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
  }
});

export { OPERATOR_EMAIL };
