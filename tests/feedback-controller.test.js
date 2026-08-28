import assert from "node:assert/strict";
import test from "node:test";

import {
  createConnectionController,
  createNotificationController,
} from "../js/feedback-controller.js";

function createElement() {
  const classes = new Set();
  const attributes = new Map();

  return {
    className: "",
    textContent: "",
    classList: {
      contains: (name) => classes.has(name),
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    getAttribute: (name) => attributes.get(name),
    setAttribute: (name, value) => attributes.set(name, value),
  };
}

test("notification replaces its timer and returns to an empty state", () => {
  const element = createElement();
  const timers = new Map();
  const cleared = [];
  let nextTimerId = 1;
  const notification = createNotificationController({
    element,
    setTimer(callback, duration) {
      const id = nextTimerId++;
      timers.set(id, { callback, duration });
      return id;
    },
    clearTimer(id) {
      cleared.push(id);
      timers.delete(id);
    },
  });

  notification.show("Профиль сохранён", { type: "success", duration: 2500 });
  assert.equal(element.textContent, "Профиль сохранён");
  assert.equal(element.className, "app-notification is-visible success");
  assert.equal(timers.get(1).duration, 2500);

  notification.show("Новое сообщение", { type: "unknown" });
  assert.deepEqual(cleared, [1]);
  assert.equal(element.className, "app-notification is-visible info");

  timers.get(2).callback();
  assert.equal(element.textContent, "");
  assert.equal(element.className, "app-notification");
});

test("connection state shows offline status and reports only a real recovery", () => {
  const element = createElement();
  const listeners = new Map();
  const restored = [];
  const windowRef = {
    navigator: { onLine: true },
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
  };
  const connection = createConnectionController({
    element,
    windowRef,
    onRestored: () => restored.push(true),
  });

  connection.bind();
  assert.equal(element.classList.contains("hidden"), true);
  assert.equal(element.getAttribute("aria-hidden"), "true");
  assert.equal(restored.length, 0);

  listeners.get("offline")();
  assert.equal(element.classList.contains("hidden"), false);
  assert.equal(element.getAttribute("aria-hidden"), "false");

  listeners.get("online")();
  assert.equal(element.classList.contains("hidden"), true);
  assert.equal(restored.length, 1);
});
