import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  MAX_SUPPORT_ATTACHMENTS,
  createSupportController,
  validateSupportAttachment,
} from "../js/support-controller.js";

function createMarkup(document) {
  document.body.innerHTML = `
    <button data-open-support>Поддержка</button>
    <button id="supportBackdrop" data-close-support hidden></button>
    <aside id="supportPanel" hidden><header><button data-support-menu></button><strong id="supportTitle"></strong><button data-close-support></button></header>
      <section id="supportMenu" hidden><button data-support-new></button><div id="supportConversationList"></div></section>
      <div id="supportMessages"></div>
      <section id="supportEmpty"><button data-support-prompt>Другой вопрос</button></section>
      <p id="supportStatus" hidden></p>
      <form id="supportForm">
        <section id="supportAttachmentPreview" hidden></section>
        <span class="support-attach-control">
          <button id="supportAttachButton" type="button"></button>
          <span id="supportAttachMenu" hidden>
            <button type="button" data-support-file-kind="photo"></button>
            <button type="button" data-support-file-kind="video"></button>
            <button type="button" data-support-file-kind="file"></button>
          </span>
        </span>
        <textarea id="supportInput"></textarea>
        <small id="supportCharacterCount" hidden></small>
        <button id="supportSend"></button>
        <input type="file" data-support-file-input="photo">
        <input type="file" data-support-file-input="video">
        <input type="file" data-support-file-input="file">
      </form>
      <button id="supportCloseConversation" hidden></button>
      <section id="supportAttachmentDialog" hidden>
        <button type="button" data-close-support-attachment></button>
        <div id="supportAttachmentMedia"></div>
        <strong id="supportAttachmentName"></strong>
        <p id="supportAttachmentStatus"></p>
        <a id="supportAttachmentDownload" hidden></a>
      </section>
    </aside>`;
}

test("support creates a private conversation and sends the first message", async () => {
  const window = new Window({ url: "https://schoolpp.com/" });
  createMarkup(window.document);
  const conversations = [];
  const messages = [];
  const repository = {
    async getUser() {
      return { id: "student-1" };
    },
    async isAgent() {
      return false;
    },
    async listConversations() {
      return conversations;
    },
    async createConversation(subject, ownerLabel) {
      const record = {
        id: "conversation-1",
        owner_label: ownerLabel,
        subject,
        status: "open",
      };
      conversations.push(record);
      return record;
    },
    async listMessages(conversationId) {
      return messages.filter((item) => item.conversation_id === conversationId);
    },
    async sendMessage(conversationId, body) {
      messages.push({
        id: 1,
        conversation_id: conversationId,
        sender_id: "student-1",
        body,
        created_at: "2026-09-20T12:00:00Z",
      });
    },
    async markConversationRead() {},
    async closeConversation() {},
    subscribe() {
      return () => {};
    },
  };
  const controller = createSupportController({
    root: window.document,
    windowRef: window,
    repositoryProvider: async () => repository,
    ownerLabelProvider: () => "Тимур Споняков",
    onOpen: () => messages.push({ type: "opened" }),
  });
  controller.bind();
  await controller.open();

  const input = window.document.getElementById("supportInput");
  input.value = "Не получается синхронизировать";
  input.dispatchEvent(new window.Event("input"));
  window.document
    .getElementById("supportForm")
    .dispatchEvent(new window.Event("submit", { cancelable: true }));
  await new Promise((resolve) => window.setTimeout(resolve, 10));

  assert.equal(conversations[0].owner_label, "Тимур Споняков");
  assert.equal(messages[0].type, "opened");
  assert.equal(messages[1].body, "Не получается синхронизировать");
  assert.match(
    window.document.getElementById("supportMessages").textContent,
    /Не получается синхронизировать/,
  );
  controller.destroy();
  await window.happyDOM.close();
});

test("support marks incoming messages as read and shows receipts on own messages", async () => {
  const window = new Window({ url: "https://schoolpp.com/" });
  createMarkup(window.document);
  window.sessionStorage.setItem(
    "schoolpp_support_selected_conversation",
    "conversation-1",
  );
  let markedConversation = "";
  const repository = {
    async getUser() {
      return { id: "student-1" };
    },
    async isAgent() {
      return false;
    },
    async listConversations() {
      return [{ id: "conversation-1", subject: "Вопрос", status: "open" }];
    },
    async listMessages() {
      return [
        {
          id: 1,
          sender_id: "student-1",
          body: "Спасибо",
          created_at: "2026-09-20T12:00:00Z",
          read_at: "2026-09-20T12:01:00Z",
        },
        {
          id: 2,
          sender_id: "support-1",
          body: "Готово",
          created_at: "2026-09-20T12:02:00Z",
          read_at: null,
        },
      ];
    },
    async markConversationRead(conversationId) {
      markedConversation = conversationId;
    },
    async sendMessage() {},
    async closeConversation() {},
    subscribe() {
      return () => {};
    },
  };
  const controller = createSupportController({
    root: window.document,
    windowRef: window,
    repositoryProvider: async () => repository,
  });
  controller.bind();
  await controller.open();

  assert.equal(markedConversation, "conversation-1");
  assert.equal(
    window.document.querySelectorAll(".support-message-read").length,
    1,
  );
  assert.match(
    window.document.querySelector(".support-message.is-own").textContent,
    /Прочитано/,
  );
  controller.destroy();
  await window.happyDOM.close();
});

test("support restores a conversation only within the current tab session", async () => {
  const window = new Window({ url: "https://schoolpp.com/" });
  createMarkup(window.document);
  const repository = {
    async getUser() {
      return { id: "student-1" };
    },
    async isAgent() {
      return false;
    },
    async listConversations() {
      return [{ id: "conversation-1", subject: "Вопрос", status: "open" }];
    },
    async listMessages() {
      return [
        {
          id: 1,
          sender_id: "student-1",
          body: "Текст",
          created_at: new Date().toISOString(),
        },
      ];
    },
    async markConversationRead() {},
    async sendMessage() {},
    async closeConversation() {},
    subscribe() {
      return () => {};
    },
  };
  const controller = createSupportController({
    root: window.document,
    windowRef: window,
    repositoryProvider: async () => repository,
  });
  controller.bind();
  await controller.open();
  assert.equal(
    window.document.getElementById("supportMessages").textContent,
    "",
  );

  window.document.querySelector("[data-support-menu]").click();
  window.document.querySelector("[data-support-conversation]").click();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  assert.equal(
    window.sessionStorage.getItem("schoolpp_support_selected_conversation"),
    "conversation-1",
  );
  assert.match(
    window.document.getElementById("supportMessages").textContent,
    /Текст/,
  );

  window.document.querySelector("[data-support-new]").click();
  assert.equal(
    window.sessionStorage.getItem("schoolpp_support_selected_conversation"),
    null,
  );
  controller.destroy();
  await window.happyDOM.close();
});

test("support rejects messages longer than 2000 characters", async () => {
  const window = new Window({ url: "https://schoolpp.com/" });
  createMarkup(window.document);
  let sent = false;
  const repository = {
    async getUser() {
      return { id: "student-1" };
    },
    async isAgent() {
      return false;
    },
    async listConversations() {
      return [];
    },
    async createConversation() {
      throw new Error("must not create");
    },
    async listMessages() {
      return [];
    },
    async markConversationRead() {},
    async sendMessage() {
      sent = true;
    },
    async closeConversation() {},
    subscribe() {
      return () => {};
    },
  };
  const controller = createSupportController({
    root: window.document,
    windowRef: window,
    repositoryProvider: async () => repository,
  });
  controller.bind();
  await controller.open();
  const input = window.document.getElementById("supportInput");
  const counter = window.document.getElementById("supportCharacterCount");
  const send = window.document.getElementById("supportSend");
  input.value = "а".repeat(1980);
  input.dispatchEvent(new window.Event("input"));
  assert.equal(counter.hidden, false);
  assert.equal(counter.textContent, "1980/2000");
  assert.equal(counter.classList.contains("is-over-limit"), false);

  input.value = "а".repeat(2001);
  input.dispatchEvent(new window.Event("input"));
  assert.equal(counter.textContent, "2001/2000");
  assert.equal(counter.classList.contains("is-over-limit"), true);
  assert.equal(send.disabled, true);
  window.document
    .getElementById("supportForm")
    .dispatchEvent(new window.Event("submit", { cancelable: true }));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  assert.equal(sent, false);
  assert.match(
    window.document.getElementById("supportStatus").textContent,
    /2000/,
  );
  controller.destroy();
  await window.happyDOM.close();
});

test("support validates attachment types and practical size limits", () => {
  assert.equal(MAX_SUPPORT_ATTACHMENTS, 10);
  assert.deepEqual(
    validateSupportAttachment(
      { name: "photo.png", type: "image/png", size: 10 * 1024 * 1024 },
      "photo",
    ),
    { ok: true, message: "" },
  );
  assert.match(
    validateSupportAttachment(
      { name: "photo.pdf", type: "application/pdf", size: 100 },
      "photo",
    ).message,
    /изображение/i,
  );
  assert.match(
    validateSupportAttachment(
      { name: "movie.mp4", type: "video/mp4", size: 50 * 1024 * 1024 + 1 },
      "video",
    ).message,
    /50 МБ/,
  );
  assert.deepEqual(
    validateSupportAttachment(
      { name: "photo.jpg", type: "", size: 1024 },
      "photo",
    ),
    { ok: true, message: "" },
  );
});

test("support renders a Supabase attachment returned as one object", async () => {
  const window = new Window({ url: "https://schoolpp.com/" });
  createMarkup(window.document);
  window.sessionStorage.setItem(
    "schoolpp_support_selected_conversation",
    "conversation-1",
  );
  const repository = {
    async getUser() {
      return { id: "student-1" };
    },
    async isAgent() {
      return false;
    },
    async listConversations() {
      return [{ id: "conversation-1", subject: "Файл", status: "open" }];
    },
    async listMessages() {
      return [
        {
          id: 1,
          sender_id: "student-1",
          body: "",
          created_at: "2026-09-29T16:45:00Z",
          support_attachments: {
            id: "file-1",
            kind: "file",
            file_name: "Задание.docx",
            size_bytes: 2048,
            expires_at: "2026-10-02T16:45:00Z",
          },
        },
      ];
    },
    async markConversationRead() {},
    async closeConversation() {},
    subscribe() {
      return () => {};
    },
  };
  const controller = createSupportController({
    root: window.document,
    windowRef: window,
    repositoryProvider: async () => repository,
  });
  controller.bind();
  await controller.open();

  assert.match(
    window.document.getElementById("supportMessages").textContent,
    /Задание\.docx/,
  );
  assert.match(
    window.document.getElementById("supportMessages").textContent,
    /2 КБ/,
  );
  controller.destroy();
  await window.happyDOM.close();
});

test("support blocks a seventh message in one minute before it reaches the server", async () => {
  const window = new Window({ url: "https://schoolpp.com/" });
  createMarkup(window.document);
  window.sessionStorage.setItem(
    "schoolpp_support_selected_conversation",
    "conversation-1",
  );
  let sent = 0;
  const repository = {
    async getUser() {
      return { id: "student-1" };
    },
    async isAgent() {
      return false;
    },
    async listConversations() {
      return [{ id: "conversation-1", subject: "Вопрос", status: "open" }];
    },
    async listMessages() {
      return [];
    },
    async markConversationRead() {},
    async sendMessage() {
      sent += 1;
    },
    async closeConversation() {},
    subscribe() {
      return () => {};
    },
  };
  const controller = createSupportController({
    root: window.document,
    windowRef: window,
    repositoryProvider: async () => repository,
  });
  controller.bind();
  await controller.open();
  const input = window.document.getElementById("supportInput");
  const form = window.document.getElementById("supportForm");
  for (let index = 0; index < 7; index += 1) {
    input.value = `Сообщение ${index + 1}`;
    input.dispatchEvent(new window.Event("input"));
    form.dispatchEvent(new window.Event("submit", { cancelable: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  assert.equal(sent, 6);
  assert.match(
    window.document.getElementById("supportStatus").textContent,
    /Слишком много сообщений/,
  );
  controller.destroy();
  await window.happyDOM.close();
});

test("operator conversation list stays open on desktop", async () => {
  const window = new Window({ url: "https://schoolpp.com/support" });
  createMarkup(window.document);
  window.document.body.classList.add("support-console-page");
  window.matchMedia = () => ({ matches: true });
  const repository = {
    async getUser() {
      return { id: "support-1" };
    },
    async isAgent() {
      return true;
    },
    async listConversations() {
      return [
        {
          id: "conversation-1",
          owner_label: "Тимур",
          subject: "Вопрос",
          status: "open",
        },
      ];
    },
    async listMessages() {
      return [];
    },
    async markConversationRead() {},
    async sendMessage() {},
    async closeConversation() {},
    subscribe() {
      return () => {};
    },
  };
  const controller = createSupportController({
    root: window.document,
    windowRef: window,
    repositoryProvider: async () => repository,
  });
  controller.bind();
  await controller.open();
  const menu = window.document.getElementById("supportMenu");
  menu.hidden = false;
  window.document.querySelector("[data-support-conversation]").click();

  assert.equal(menu.hidden, false);
  controller.destroy();
  await window.happyDOM.close();
});
