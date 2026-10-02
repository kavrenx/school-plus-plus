const MAX_SUPPORT_MESSAGE_LENGTH = 2000;
const SUPPORT_COUNTER_THRESHOLD = 1980;
const SELECTED_CONVERSATION_KEY = "schoolpp_support_selected_conversation";
const SUPPORT_ATTACHMENT_LIMITS = Object.freeze({
  photo: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  file: 20 * 1024 * 1024,
});
const SUPPORT_ATTACHMENT_LABELS = Object.freeze({
  photo: "Фото",
  video: "Видео",
  file: "Файл",
});
const MAX_SUPPORT_ATTACHMENTS = 10;

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
  const characterCount = root.getElementById("supportCharacterCount");
  const attachButton = root.getElementById("supportAttachButton");
  const attachMenu = root.getElementById("supportAttachMenu");
  const attachmentPreview = root.getElementById("supportAttachmentPreview");
  const attachmentDialog = root.getElementById("supportAttachmentDialog");
  const attachmentName = root.getElementById("supportAttachmentName");
  const attachmentStatus = root.getElementById("supportAttachmentStatus");
  const attachmentDownload = root.getElementById("supportAttachmentDownload");
  const attachmentMedia = root.getElementById("supportAttachmentMedia");
  const fileInputs = [...root.querySelectorAll("[data-support-file-input]")];
  let repository = null;
  let currentUser = null;
  let conversations = [];
  let selectedId = "";
  let agent = false;
  let unsubscribe = () => {};
  let refreshTimer = 0;
  let refreshGeneration = 0;
  let messageGeneration = 0;
  let pendingAttachments = [];
  let recentSendTimes = [];
  let renderedConversationId = "";
  let renderedMessagesSignature = "";
  const attachmentsById = new Map();
  const attachmentUrlCache = new Map();

  function bind() {
    root.addEventListener("click", handleClick);
    form.addEventListener("submit", handleSubmit);
    input.addEventListener("input", syncSendButton);
    input.addEventListener("keydown", handleComposerKeydown);
    fileInputs.forEach((element) =>
      element.addEventListener("change", handleFileSelection),
    );
    closeChat.addEventListener("click", () => void closeConversation());
    syncComposerHeight();
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
        if (!agent) selectedId = readSelectedConversation();
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
    closeAttachMenu();
    closeAttachmentDialog();
    root.body.classList.remove("support-open");
  }

  async function refresh() {
    const generation = ++refreshGeneration;
    const nextConversations = await repository.listConversations();
    if (generation !== refreshGeneration) return;
    conversations = nextConversations;
    if (selectedId && !conversations.some((item) => item.id === selectedId)) {
      selectedId = "";
      rememberSelectedConversation("");
    }
    if (agent && !selectedId) selectedId = conversations[0]?.id || "";
    renderConversationList();
    await renderConversation();
  }

  function scheduleRefresh() {
    windowRef.clearTimeout(refreshTimer);
    refreshTimer = windowRef.setTimeout(() => void refresh(), 650);
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
      attachmentsById.clear();
      renderedConversationId = "";
      renderedMessagesSignature = "";
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
    const signature = getMessageRecordsSignature(records);
    empty.hidden = records.length > 0;
    if (
      renderedConversationId !== conversation.id ||
      renderedMessagesSignature !== signature
    ) {
      const keepAtBottom =
        messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
      const fragment = root.createDocumentFragment();
      attachmentsById.clear();
      records.forEach((record) => {
        normalizeAttachmentRecords(
          record.support_attachments || record.attachments || [],
        ).forEach((attachment) => {
          if (attachment.id != null)
            attachmentsById.set(String(attachment.id), attachment);
        });
      });
      const existing = new Map(
        [...messages.querySelectorAll("[data-message-id]")].map((element) => [
          element.dataset.messageId,
          element,
        ]),
      );
      records.forEach((record) => {
        const recordSignature = getMessageRecordSignature(record);
        const current = existing.get(String(record.id));
        if (current?.dataset.recordSignature === recordSignature)
          fragment.append(current);
        else fragment.append(createMessageElement(record));
      });
      messages.replaceChildren(fragment);
      renderedConversationId = conversation.id;
      renderedMessagesSignature = signature;
      if (keepAtBottom || !messages.scrollTop)
        messages.scrollTop = messages.scrollHeight;
    }
    syncComposer(conversation);
    showStatus("");
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
    if (record.id != null) {
      article.dataset.messageId = String(record.id);
      article.dataset.recordSignature = getMessageRecordSignature(record);
    }
    const body = root.createElement("p");
    body.textContent = record.body;
    if (!record.body) body.hidden = true;
    const attachmentList = createMessageAttachments(
      record.support_attachments || record.attachments || [],
      pending,
    );
    const attachmentRecords = normalizeAttachmentRecords(
      record.support_attachments || record.attachments || [],
    );
    const mediaOnly =
      !record.body &&
      attachmentRecords.length > 0 &&
      attachmentRecords.every((item) =>
        ["photo", "video"].includes(item.kind),
      );
    article.classList.toggle("has-only-media", mediaOnly);
    article.classList.toggle(
      "has-single-media",
      mediaOnly && attachmentRecords.length === 1,
    );
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
    article.append(body);
    if (attachmentList) article.append(attachmentList);
    article.append(metadata);
    return article;
  }

  function createMessageAttachments(records, pending = false) {
    const attachmentRecords = normalizeAttachmentRecords(records);
    if (!attachmentRecords.length) return null;
    const container = root.createElement("div");
    container.className = "support-message-attachments";
    attachmentRecords.forEach((attachment, index) => {
      const id = String(attachment.id || `pending-${Date.now()}-${index}`);
      attachmentsById.set(id, attachment);
      const button = root.createElement("button");
      button.type = "button";
      button.className = `support-message-attachment is-${attachment.kind || "file"}`;
      button.dataset.supportAttachment = id;
      const expired = isAttachmentExpired(attachment);
      button.classList.toggle("is-expired", expired);
      button.disabled = pending;
      if (attachment.kind === "photo" || attachment.kind === "video") {
        const media = root.createElement(
          attachment.kind === "photo" ? "img" : "video",
        );
        media.alt = attachment.kind === "photo" ? "Фото" : "";
        if (media.tagName === "VIDEO") {
          media.muted = true;
          media.preload = "metadata";
        }
        if (attachment.preview_url) media.src = attachment.preview_url;
        else if (!pending) void hydrateAttachmentPreview(media, attachment);
        const meta = root.createElement("small");
        meta.textContent = `${SUPPORT_ATTACHMENT_LABELS[attachment.kind]} · ${formatFileSize(attachment.size_bytes)}`;
        button.append(media, meta);
      } else {
        const icon = root.createElement("school-icon");
        icon.setAttribute("name", getAttachmentIcon(attachment.kind));
        const copy = root.createElement("span");
        const label = root.createElement("strong");
        label.textContent = shortenFileName(attachment.file_name || "Вложение");
        label.title = attachment.file_name || "Вложение";
        const meta = root.createElement("small");
        meta.textContent = `${SUPPORT_ATTACHMENT_LABELS.file} · ${formatFileSize(attachment.size_bytes)}`;
        copy.append(label, meta);
        button.append(icon, copy);
      }
      container.append(button);
    });
    return container;
  }

  async function hydrateAttachmentPreview(media, attachment) {
    if (isAttachmentExpired(attachment)) return;
    const cached = attachmentUrlCache.get(String(attachment.id || ""));
    if (cached) {
      media.src = cached;
      return;
    }
    try {
      const url = await repository.getAttachmentUrl(attachment);
      if (url) attachmentUrlCache.set(String(attachment.id || ""), url);
      if (url && media.isConnected) media.src = url;
    } catch {
      /* The attachment dialog shows the detailed unavailable state. */
    }
  }

  function syncComposer(conversation) {
    const closed = conversation?.status === "closed";
    input.disabled = closed || (agent && !conversation);
    if (attachButton) attachButton.disabled = input.disabled;
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
    if ((!body && !pendingAttachments.length) || input.disabled) return;
    if (body.length > MAX_SUPPORT_MESSAGE_LENGTH) {
      showStatus(
        `Сообщение слишком длинное. Максимум ${MAX_SUPPORT_MESSAGE_LENGTH} символов.`,
        true,
      );
      return;
    }
    recentSendTimes = recentSendTimes.filter(
      (timestamp) => Date.now() - timestamp < 60_000,
    );
    if (recentSendTimes.length >= 6) {
      showStatus(
        "Слишком много сообщений за короткое время. Подожди минуту и продолжай.",
        true,
      );
      return;
    }
    send.disabled = true;
    const attachments = pendingAttachments;
    input.value = "";
    pendingAttachments = [];
    renderPendingAttachment();
    syncComposerHeight();
    ++messageGeneration;
    renderedMessagesSignature = "";
    empty.hidden = true;
    const optimisticMessage = createMessageElement(
      {
        sender_id: currentUser.id,
        body,
        created_at: new Date().toISOString(),
        support_attachments: attachments.map(createPendingAttachmentRecord),
      },
      { pending: true },
    );
    messages.append(optimisticMessage);
    messages.scrollTop = messages.scrollHeight;
    try {
      if (!selectedId) {
        const subjectSource =
          body || attachments[0]?.file.name || "Новое вложение";
        const conversation = await repository.createConversation(
          subjectSource.length > 54
            ? `${subjectSource.slice(0, 51)}…`
            : subjectSource,
          ownerLabelProvider(),
        );
        selectedId = conversation.id;
        rememberSelectedConversation(selectedId);
      }
      if (attachments.length)
        await repository.sendMessageWithAttachments(
          selectedId,
          body,
          attachments,
        );
      else await repository.sendMessage(selectedId, body);
      recentSendTimes.push(Date.now());
      await refresh();
      clearPendingPreviews(attachments);
    } catch (error) {
      optimisticMessage?.remove();
      if (!input.value) input.value = body;
      if (!pendingAttachments.length && attachments.length)
        pendingAttachments = attachments;
      renderPendingAttachment();
      syncComposerHeight();
      showStatus(getSupportSendError(error), true);
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
    const length = input.value.length;
    if (characterCount) {
      characterCount.textContent = `${length}/${MAX_SUPPORT_MESSAGE_LENGTH}`;
      characterCount.hidden = length < SUPPORT_COUNTER_THRESHOLD;
      characterCount.classList.toggle(
        "is-over-limit",
        length > MAX_SUPPORT_MESSAGE_LENGTH,
      );
    }
    send.disabled =
      input.disabled ||
      length > MAX_SUPPORT_MESSAGE_LENGTH ||
      (!input.value.trim() && !pendingAttachments.length);
    syncComposerHeight();
  }

  function syncComposerHeight() {
    if (!input || input.tagName !== "TEXTAREA") return;
    const current = input.getBoundingClientRect?.().height || 44;
    input.style.height = "0px";
    const target = Math.max(44, Math.min(132, input.scrollHeight || 44));
    input.style.height = `${current}px`;
    windowRef.requestAnimationFrame?.(() => {
      input.style.height = `${target}px`;
    });
  }

  function handleComposerKeydown(event) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (!send.disabled) form.requestSubmit?.();
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
    if (event.target.closest("#supportAttachButton")) {
      if (attachButton.disabled) return;
      const shouldOpen = Boolean(attachMenu.hidden);
      attachMenu.hidden = !shouldOpen;
      attachButton.setAttribute("aria-expanded", String(shouldOpen));
      return;
    }
    const fileKindButton = event.target.closest("[data-support-file-kind]");
    if (fileKindButton) {
      const kind = fileKindButton.dataset.supportFileKind;
      closeAttachMenu();
      fileInputs.find((element) => element.dataset.supportFileInput === kind)?.click();
      return;
    }
    if (event.target.closest("[data-remove-support-attachment]")) {
      const index = Number(
        event.target.closest("[data-remove-support-attachment]").dataset
          .removeSupportAttachment,
      );
      removePendingAttachment(index);
      return;
    }
    if (event.target.closest("[data-close-support-attachment]")) {
      closeAttachmentDialog();
      return;
    }
    const attachmentButton = event.target.closest("[data-support-attachment]");
    if (attachmentButton) {
      void openAttachment(attachmentButton.dataset.supportAttachment);
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
      rememberSelectedConversation("");
      closeMenuOnNarrowScreen();
      void renderConversation();
      return;
    }
    const conversation = event.target.closest("[data-support-conversation]");
    if (conversation) {
      selectedId = conversation.dataset.supportConversation;
      rememberSelectedConversation(selectedId);
      closeMenuOnNarrowScreen();
      renderConversationList();
      void renderConversation();
      return;
    }
    if (!event.target.closest(".support-attach-control")) closeAttachMenu();
  }

  function handleFileSelection(event) {
    const files = [...(event.currentTarget.files || [])];
    const kind = event.currentTarget.dataset.supportFileInput;
    event.currentTarget.value = "";
    if (!files.length) return;
    if (pendingAttachments.length + files.length > MAX_SUPPORT_ATTACHMENTS) {
      showStatus(
        `К одному сообщению можно прикрепить не больше ${MAX_SUPPORT_ATTACHMENTS} файлов.`,
        true,
      );
      return;
    }
    const prepared = [];
    for (const file of files) {
      const validation = validateSupportAttachment(file, kind);
      if (!validation.ok) {
        clearPendingPreviews(prepared);
        showStatus(validation.message, true);
        return;
      }
      prepared.push({
        file,
        kind,
        previewUrl:
          (kind === "photo" || kind === "video") &&
          windowRef.URL?.createObjectURL
            ? windowRef.URL.createObjectURL(file)
            : "",
      });
    }
    pendingAttachments.push(...prepared);
    renderPendingAttachment();
    showStatus("");
    syncSendButton();
  }

  function renderPendingAttachment() {
    if (!attachmentPreview) return;
    attachmentPreview.replaceChildren();
    attachmentPreview.hidden = !pendingAttachments.length;
    pendingAttachments.forEach((attachment, index) => {
      const card = root.createElement("article");
      card.className = `support-pending-file is-${attachment.kind}`;
      if (attachment.previewUrl) {
        const media = root.createElement(
          attachment.kind === "video" ? "video" : "img",
        );
        media.src = attachment.previewUrl;
        media.alt = "";
        if (media.tagName === "VIDEO") {
          media.muted = true;
          media.preload = "metadata";
        }
        card.append(media);
      } else {
        const icon = root.createElement("school-icon");
        icon.setAttribute("name", getAttachmentIcon(attachment.kind));
        card.append(icon);
      }
      const copy = root.createElement("div");
      if (attachment.kind === "file") {
        const name = root.createElement("strong");
        name.textContent = shortenFileName(attachment.file.name);
        name.title = attachment.file.name;
        copy.append(name);
      }
      const meta = root.createElement("small");
      meta.textContent = `${SUPPORT_ATTACHMENT_LABELS[attachment.kind]} · ${formatFileSize(attachment.file.size)}`;
      copy.append(meta);
      const remove = root.createElement("button");
      remove.type = "button";
      remove.className = "support-remove-attachment";
      remove.dataset.removeSupportAttachment = String(index);
      remove.setAttribute("aria-label", "Убрать вложение");
      const closeIcon = root.createElement("school-icon");
      closeIcon.setAttribute("name", "close-outline");
      remove.append(closeIcon);
      card.append(copy, remove);
      attachmentPreview.append(card);
    });
  }

  function removePendingAttachment(index) {
    const [removed] = pendingAttachments.splice(index, 1);
    clearPendingPreviews(removed ? [removed] : []);
    renderPendingAttachment();
    syncSendButton();
  }

  function clearPendingPreviews(attachments = pendingAttachments) {
    attachments.forEach((attachment) => {
      if (attachment.previewUrl && windowRef.URL?.revokeObjectURL)
        windowRef.URL.revokeObjectURL(attachment.previewUrl);
    });
  }

  function closeAttachMenu() {
    if (attachMenu) attachMenu.hidden = true;
    attachButton?.setAttribute("aria-expanded", "false");
  }

  async function openAttachment(id) {
    const attachment = attachmentsById.get(String(id));
    if (!attachment || !attachmentDialog) return;
    attachmentDialog.hidden = false;
    const fullName = attachment.file_name || "Вложение";
    attachmentName.textContent = shortenFileName(fullName, 42);
    attachmentName.title = fullName;
    attachmentStatus.textContent = "Готовим файл…";
    attachmentDownload.hidden = true;
    attachmentDownload.removeAttribute("href");
    attachmentMedia.replaceChildren();
    if (isAttachmentExpired(attachment)) {
      showExpiredAttachment();
      return;
    }
    try {
      const cacheKey = String(attachment.id || "");
      const url =
        attachment.preview_url ||
        attachmentUrlCache.get(cacheKey) ||
        (await repository.getAttachmentUrl(attachment));
      if (!url) {
        showExpiredAttachment();
        return;
      }
      if (cacheKey) attachmentUrlCache.set(cacheKey, url);
      attachmentStatus.textContent = "Вложение доступно в течение трёх дней.";
      attachmentDownload.href = url;
      attachmentDownload.download = attachment.file_name || "attachment";
      attachmentDownload.hidden = false;
      if (attachment.kind === "photo") {
        const image = root.createElement("img");
        image.src = url;
        image.alt = attachment.file_name || "Фото";
        attachmentMedia.append(image);
      } else if (attachment.kind === "video") {
        const video = root.createElement("video");
        video.src = url;
        video.controls = true;
        video.preload = "metadata";
        attachmentMedia.append(video);
      } else {
        const icon = root.createElement("school-icon");
        icon.setAttribute("name", "documents-outline");
        attachmentMedia.append(icon);
      }
    } catch {
      showExpiredAttachment();
    }
  }

  function showExpiredAttachment() {
    attachmentStatus.textContent =
      "Файл больше недоступен. Вложения автоматически удаляются через три дня.";
    attachmentDownload.hidden = true;
    const icon = root.createElement("school-icon");
    icon.setAttribute("name", "alert-outline");
    attachmentMedia.replaceChildren(icon);
  }

  function closeAttachmentDialog() {
    if (!attachmentDialog) return;
    attachmentDialog.hidden = true;
    attachmentMedia?.replaceChildren();
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
    clearPendingPreviews();
  }

  function readSelectedConversation() {
    try {
      return windowRef.sessionStorage?.getItem(SELECTED_CONVERSATION_KEY) || "";
    } catch {
      return "";
    }
  }

  function rememberSelectedConversation(value) {
    if (agent) return;
    try {
      if (value)
        windowRef.sessionStorage?.setItem(SELECTED_CONVERSATION_KEY, value);
      else windowRef.sessionStorage?.removeItem(SELECTED_CONVERSATION_KEY);
    } catch {
      /* Support remains available when session storage is blocked. */
    }
  }

  return { bind, close, destroy, open };
}

function validateSupportAttachment(file, kind) {
  if (!file || !Object.hasOwn(SUPPORT_ATTACHMENT_LIMITS, kind))
    return { ok: false, message: "Не удалось прочитать выбранный файл." };
  const contentType = inferAttachmentContentType(file, kind);
  if (kind === "photo" && !contentType.startsWith("image/"))
    return { ok: false, message: "Выбери изображение в разделе «Фото»." };
  if (kind === "video" && !contentType.startsWith("video/"))
    return { ok: false, message: "Выбери видео в разделе «Видео»." };
  const maximum = SUPPORT_ATTACHMENT_LIMITS[kind];
  if (Number(file.size) > maximum)
    return {
      ok: false,
      message: `${SUPPORT_ATTACHMENT_LABELS[kind]} слишком большое. Максимум ${formatFileSize(maximum)}.`,
    };
  return { ok: true, message: "" };
}

function normalizeAttachmentRecords(records) {
  return Array.isArray(records) ? records : records ? [records] : [];
}

function getMessageRecordsSignature(records = []) {
  return records.map(getMessageRecordSignature).join("|");
}

function getMessageRecordSignature(record = {}) {
  const attachments = normalizeAttachmentRecords(
    record.support_attachments || record.attachments || [],
  )
    .map(
      (item) =>
        `${item.id || ""}:${item.storage_path || ""}:${item.deleted_at || ""}`,
    )
    .join(",");
  return `${record.id || ""}:${record.read_at || ""}:${record.body || ""}:${attachments}`;
}

function shortenFileName(value, maximum = 34) {
  const name = String(value || "Вложение");
  if (name.length <= maximum) return name;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : "";
  const available = Math.max(8, maximum - extension.length - 1);
  return `${name.slice(0, available)}…${extension}`;
}

function createPendingAttachmentRecord({ file, kind, previewUrl = "" }) {
  return {
    id: `pending-${file.name}-${file.size}`,
    kind,
    file_name: file.name,
    content_type: inferAttachmentContentType(file, kind),
    size_bytes: file.size,
    preview_url: previewUrl,
    expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function inferAttachmentContentType(file, kind) {
  const declared = String(file?.type || "").trim().toLowerCase();
  if (declared) return declared;
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
  const known = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    heic: "image/heic",
    heif: "image/heif",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
  };
  return known[extension] ||
    (kind === "photo"
      ? "image/unknown"
      : kind === "video"
        ? "video/unknown"
        : "application/octet-stream");
}

function isAttachmentExpired(attachment, now = Date.now()) {
  return (
    Boolean(attachment?.deleted_at) ||
    (Number.isFinite(Date.parse(attachment?.expires_at || "")) &&
      Date.parse(attachment.expires_at) <= now)
  );
}

function getAttachmentIcon(kind) {
  if (kind === "photo") return "image-outline";
  if (kind === "video") return "video-outline";
  return "documents-outline";
}

function formatFileSize(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

function getSupportSendError(error) {
  const message = String(error?.message || error?.code || "");
  if (/RATE_LIMITED|too many|429/i.test(message))
    return "Слишком много сообщений за короткое время. Подожди немного и продолжай.";
  if (/ATTACHMENT_TOO_LARGE/i.test(message))
    return "Файл превышает допустимый размер.";
  if (/INVALID_ATTACHMENT_TYPE/i.test(message))
    return "Этот формат файла нельзя отправить выбранным способом.";
  return "Сообщение не отправлено. Попробуйте ещё раз.";
}

export {
  MAX_SUPPORT_MESSAGE_LENGTH,
  SUPPORT_ATTACHMENT_LIMITS,
  MAX_SUPPORT_ATTACHMENTS,
  createSupportController,
  shortenFileName,
  isAttachmentExpired,
  validateSupportAttachment,
};
