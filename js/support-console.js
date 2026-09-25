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
  const viewButtons = Array.from(
    document.querySelectorAll("[data-support-console-view]"),
  );
  const conversationSection = document.getElementById(
    "supportConversationSection",
  );
  const requestSection = document.getElementById("supportRequestSection");
  const requestList = document.getElementById("supportRequestList");
  const requestView = document.getElementById("supportRequestView");
  const requestEmpty = document.getElementById("supportRequestEmpty");
  const requestCard = document.getElementById("supportRequestCard");
  const requestName = document.getElementById("supportRequestName");
  const requestUrl = document.getElementById("supportRequestUrl");
  const requestContact = document.getElementById("supportRequestContact");
  const requestDate = document.getElementById("supportRequestDate");
  const requestState = document.getElementById("supportRequestState");
  const requestFeedback = document.getElementById("supportRequestFeedback");
  const conversationWorkspace = [
    document.getElementById("supportWorkspaceHeader"),
    document.getElementById("supportWorkspaceChat"),
    document.getElementById("supportStatus"),
    document.getElementById("supportForm"),
    document.getElementById("supportCloseConversation"),
  ];
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
  let requests = [];
  let selectedRequestId = "";
  let requestsUnsubscribe = () => {};
  let activeView = "conversations";

  async function refreshRequests() {
    try {
      requests = await services.support.listDiaryRequests();
      if (
        selectedRequestId &&
        !requests.some((request) => request.id === selectedRequestId)
      )
        selectedRequestId = "";
      if (!selectedRequestId) selectedRequestId = requests[0]?.id || "";
      renderRequestList();
      renderRequest();
    } catch {
      requestList.replaceChildren();
      const message = document.createElement("p");
      message.className = "support-menu-empty";
      message.textContent = "Не удалось загрузить заявки.";
      requestList.append(message);
    }
  }

  function renderRequestList() {
    requestList.replaceChildren();
    if (!requests.length) {
      const message = document.createElement("p");
      message.className = "support-menu-empty";
      message.textContent = "Заявок пока нет.";
      requestList.append(message);
      return;
    }
    requests.forEach((request) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.supportRequest = request.id;
      button.className = request.id === selectedRequestId ? "is-active" : "";
      const strong = document.createElement("strong");
      strong.textContent = request.requester_name;
      const small = document.createElement("small");
      small.textContent = requestStatusLabel(request.status);
      button.append(strong, small);
      requestList.append(button);
    });
  }

  function renderRequest() {
    const request = requests.find((item) => item.id === selectedRequestId);
    requestEmpty.hidden = Boolean(request);
    requestCard.hidden = !request;
    requestFeedback.hidden = true;
    if (!request) return;
    requestName.textContent = request.requester_name;
    requestUrl.textContent = request.diary_url;
    requestContact.textContent = request.contact;
    requestDate.textContent = new Date(request.created_at).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    requestState.textContent = requestStatusLabel(request.status);
    requestState.dataset.status = request.status;
    requestCard.querySelector('[data-request-status="in_review"]').disabled =
      request.status !== "new";
    requestCard.querySelector('[data-request-status="closed"]').disabled =
      request.status === "closed";
  }

  function setView(view) {
    activeView = view;
    const showRequests = view === "requests";
    viewButtons.forEach((button) => {
      const active = button.dataset.supportConsoleView === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    conversationSection.hidden = showRequests;
    requestSection.hidden = !showRequests;
    conversationWorkspace.forEach((element) => {
      element?.classList.toggle("support-console-request-hidden", showRequests);
    });
    requestView.hidden = !showRequests;
    if (showRequests) void refreshRequests();
  }

  async function showWorkspace() {
    const user = await services.auth.getUser();
    if (!user || !(await services.support.isAgent())) {
      if (user) await services.auth.signOut();
      throw new Error("Доступ есть только у оператора поддержки.");
    }
    login.hidden = true;
    workspace.hidden = false;
    document.getElementById("supportMenu").hidden = false;
    await controller.open();
    requestsUnsubscribe();
    requestsUnsubscribe = services.support.subscribe(() => {
      if (activeView === "requests") void refreshRequests();
    });
    setView("conversations");
  }

  viewButtons.forEach((button) => {
    button.addEventListener("click", () =>
      setView(button.dataset.supportConsoleView),
    );
  });

  requestList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-support-request]");
    if (!button) return;
    selectedRequestId = button.dataset.supportRequest;
    renderRequestList();
    renderRequest();
  });

  requestCard.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-request-status]");
    if (!button || !selectedRequestId) return;
    button.disabled = true;
    requestFeedback.hidden = true;
    try {
      await services.support.updateDiaryRequestStatus(
        selectedRequestId,
        button.dataset.requestStatus,
      );
      await refreshRequests();
    } catch {
      requestFeedback.textContent = "Не удалось изменить статус заявки.";
      requestFeedback.hidden = false;
      button.disabled = false;
    }
  });

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
      requestsUnsubscribe();
      requestsUnsubscribe = () => {};
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

function requestStatusLabel(status) {
  return (
    {
      new: "Новая",
      in_review: "В работе",
      closed: "Закрыта",
    }[status] || "Новая"
  );
}

export { OPERATOR_EMAIL };
