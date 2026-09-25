function createSupportController({
  root,
  windowRef = window,
  repositoryProvider,
  ownerLabelProvider = () => "Пользователь",
  onOpen = () => {},
}) {
  const panel = root.getElementById("supportPanel");
  const backdrop = root.getElementById("supportBackdrop");
  const menu = root.getElementById("supportMenu");
  const title = root.getElementById("supportTitle");
  const list = root.getElementById("supportConversationList");
  const messages = root.getElementById("supportMessages");
  const empty = root.getElementById("supportEmpty");
  const form = root.getElementById("supportForm");
  const input = root.getElementById("supportInput");
  const send = root.getElementById("supportSend");
  const closeChat = root.getElementById("supportCloseConversation");
  const status = root.getElementById("supportStatus");
  let repository = null;
  let currentUser = null;
  let conversations = [];
  let selectedId = "";
  let agent = false;
  let unsubscribe = () => {};
  let refreshTimer = 0;
  let refreshGeneration = 0;
  let messageGeneration = 0;

  function bind() {
    root.addEventListener("click", handleClick);
    form.addEventListener("submit", handleSubmit);
    input.addEventListener("input", syncSendButton);
    closeChat.addEventListener("click", () => void closeConversation());
  }

  async function open() {
    panel.hidden = false;
    backdrop.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    root.body.classList.add("support-open");
    onOpen();
    showStatus("Подключаем поддержку…");
    try {
      if (!repository) {
        repository = await repositoryProvider();
        currentUser = await repository.getUser();
        agent = await repository.isAgent();
        unsubscribe = repository.subscribe(scheduleRefresh);
      }
      await refresh();
      input.focus();
    } catch {
      showStatus(
        "Поддержка сейчас недоступна. Проверьте соединение и попробуйте ещё раз.",
        true,
      );
    }
  }

  function close() {
    panel.hidden = true;
    backdrop.hidden = true;
    panel.setAttribute("aria-hidden", "true");
    menu.hidden = true;
    root.body.classList.remove("support-open");
  }

  async function refresh() {
    const generation = ++refreshGeneration;
    const nextConversations = await repository.listConversations();
    if (generation !== refreshGeneration) return;
    conversations = nextConversations;
    if (!selectedId || !conversations.some((item) => item.id === selectedId))
      selectedId = conversations[0]?.id || "";
    renderConversationList();
    await renderConversation();
  }

  function scheduleRefresh() {
    windowRef.clearTimeout(refreshTimer);
    refreshTimer = windowRef.setTimeout(() => void refresh(), 120);
  }

  function renderConversationList() {
    list.replaceChildren();
    if (!conversations.length) {
      const item = root.createElement("p");
      item.className = "support-menu-empty";
      item.textContent = "Бесед пока нет.";
      list.append(item);
      return;
    }
    conversations.forEach((conversation) => {
      const button = root.createElement("button");
      button.type = "button";
      button.dataset.supportConversation = conversation.id;
      button.className = conversation.id === selectedId ? "is-active" : "";
      const strong = root.createElement("strong");
      strong.textContent = agent
        ? conversation.owner_label || `Обращение ${conversation.id.slice(0, 6)}`
        : conversation.subject;
      const small = root.createElement("small");
      small.textContent =
        conversation.status === "closed" ? "Беседа закрыта" : "Открыта";
      button.append(strong, small);
      list.append(button);
    });
  }

  async function renderConversation() {
    const generation = ++messageGeneration;
    const conversation = conversations.find((item) => item.id === selectedId);
    title.textContent = conversation
      ? agent
        ? conversation.owner_label || `Обращение ${conversation.id.slice(0, 6)}`
        : "Поддержка"
      : "Поддержка";
    closeChat.hidden =
      !agent || !conversation || conversation.status === "closed";
    if (!conversation) {
      messages.replaceChildren();
      empty.hidden = false;
      syncComposer(conversation);
      showStatus("");
      return;
    }
    const records = await repository.listMessages(conversation.id);
    if (
      generation !== messageGeneration ||
      conversation.id !== selectedId
    )
      return;
    const fragment = root.createDocumentFragment();
    empty.hidden = records.length > 0;
    records.forEach((record) => {
      fragment.append(createMessageElement(record));
    });
    messages.replaceChildren(fragment);
    syncComposer(conversation);
    showStatus("");
    messages.scrollTop = messages.scrollHeight;
    if (
      records.some(
        (record) => record.sender_id !== currentUser.id && !record.read_at,
      )
    )
      void repository.markConversationRead(conversation.id).catch(() => {});
  }

  function createMessageElement(record, { pending = false } = {}) {
    const article = root.createElement("article");
    const own = record.sender_id === currentUser.id;
    article.className = own ? "support-message is-own" : "support-message";
    article.classList.toggle("is-pending", pending);
    if (record.id != null) article.dataset.messageId = String(record.id);
    const body = root.createElement("p");
    body.textContent = record.body;
    const metadata = root.createElement("div");
    metadata.className = "support-message-meta";
    const time = root.createElement("time");
    time.dateTime = record.created_at;
    time.textContent = new Date(record.created_at).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    metadata.append(time);
    if (own && record.read_at) {
      const read = root.createElement("span");
      read.className = "support-message-read";
      read.textContent = "Прочитано";
      metadata.append(read);
    }
    article.append(body, metadata);
    return article;
  }

  function syncComposer(conversation) {
    const closed = conversation?.status === "closed";
    input.disabled = closed || (agent && !conversation);
    input.placeholder = closed
      ? "Беседа закрыта"
      : agent && !conversation
        ? "Выберите обращение"
        : "Напишите сообщение";
    syncSendButton();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const body = input.value.trim();
    if (!body || input.disabled) return;
    send.disabled = true;
    input.value = "";
    ++messageGeneration;
    empty.hidden = true;
    const optimisticMessage = createMessageElement(
      {
        sender_id: currentUser.id,
        body,
        created_at: new Date().toISOString(),
      },
      { pending: true },
    );
    messages.append(optimisticMessage);
    messages.scrollTop = messages.scrollHeight;
    try {
      if (!selectedId) {
        const conversation = await repository.createConversation(
          body.length > 54 ? `${body.slice(0, 51)}…` : body,
          ownerLabelProvider(),
        );
        selectedId = conversation.id;
      }
      await repository.sendMessage(selectedId, body);
      await refresh();
    } catch {
      optimisticMessage?.remove();
      if (!input.value) input.value = body;
      showStatus("Сообщение не отправлено. Попробуйте ещё раз.", true);
    } finally {
      syncSendButton();
    }
  }

  async function closeConversation() {
    if (!selectedId) return;
    closeChat.disabled = true;
    try {
      await repository.closeConversation(selectedId);
      await refresh();
    } catch {
      showStatus("Не удалось закрыть беседу.", true);
    } finally {
      closeChat.disabled = false;
    }
  }

  function syncSendButton() {
    send.disabled = input.disabled || !input.value.trim();
  }

  function showStatus(text, error = false) {
    status.textContent = text;
    status.hidden = !text;
    status.classList.toggle("is-error", error);
  }

  function handleClick(event) {
    if (event.target.closest("[data-open-support]")) {
      void open();
      return;
    }
    if (
      event.target.closest("[data-close-support]") ||
      event.target === backdrop
    ) {
      close();
      return;
    }
    if (event.target.closest("[data-support-menu]")) {
      menu.hidden = !menu.hidden;
      return;
    }
    const prompt = event.target.closest("[data-support-prompt]");
    if (prompt) {
      input.value = prompt.textContent.trim();
      input.focus();
      syncSendButton();
      return;
    }
    if (event.target.closest("[data-support-new]")) {
      selectedId = "";
      closeMenuOnNarrowScreen();
      void renderConversation();
      return;
    }
    const conversation = event.target.closest("[data-support-conversation]");
    if (conversation) {
      selectedId = conversation.dataset.supportConversation;
      closeMenuOnNarrowScreen();
      renderConversationList();
      void renderConversation();
    }
  }

  function closeMenuOnNarrowScreen() {
    if (
      !agent ||
      !root.body.classList.contains("support-console-page") ||
      !windowRef.matchMedia?.("(min-width: 761px)").matches
    )
      menu.hidden = true;
  }

  function destroy() {
    unsubscribe();
    windowRef.clearTimeout(refreshTimer);
  }

  return { bind, close, destroy, open };
}

export { createSupportController };
