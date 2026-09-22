import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createSupportController } from "../js/support-controller.js";

function createMarkup(document) {
  document.body.innerHTML = `
    <button data-open-support>Поддержка</button>
    <button id="supportBackdrop" data-close-support hidden></button>
    <aside id="supportPanel" hidden><header><button data-support-menu></button><strong id="supportTitle"></strong><button data-close-support></button></header>
      <section id="supportMenu" hidden><button data-support-new></button><div id="supportConversationList"></div></section>
      <div id="supportMessages"></div>
      <section id="supportEmpty"><button data-support-prompt>Другой вопрос</button></section>
      <p id="supportStatus" hidden></p>
      <form id="supportForm"><input id="supportInput"><button id="supportSend"></button></form>
      <button id="supportCloseConversation" hidden></button>
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
  assert.equal(messages[0].body, "Не получается синхронизировать");
  assert.match(
    window.document.getElementById("supportMessages").textContent,
    /Не получается синхронизировать/,
  );
  controller.destroy();
  await window.happyDOM.close();
});
