import assert from "node:assert/strict";
import test from "node:test";
import { createModalController } from "../js/modal-controller.js";
import { createThemeController } from "../js/theme-controller.js";

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add(...names) {
      names.forEach((name) => classes.add(name));
    },
    contains(name) {
      return classes.has(name);
    },
    remove(...names) {
      names.forEach((name) => classes.delete(name));
    },
    toggle(name, force) {
      if (force) classes.add(name);
      else classes.delete(name);
    },
  };
}

test("opens and closes modals through the transition state", () => {
  let scheduledCallback = null;
  const modal = { classList: createClassList(["hidden"]) };
  const controller = createModalController({
    schedule(callback) {
      scheduledCallback = callback;
      return 1;
    },
    cancel() {},
  });

  controller.open(modal);
  assert.equal(modal.classList.contains("hidden"), false);

  controller.close(modal);
  assert.equal(modal.classList.contains("is-closing"), true);
  scheduledCallback();
  assert.equal(modal.classList.contains("hidden"), true);
  assert.equal(modal.classList.contains("is-closing"), false);
});

test("keeps keyboard focus inside a modal and returns it after closing", () => {
  let scheduledCallback = null;
  const body = { classList: createClassList() };
  const documentRoot = {
    activeElement: null,
    body,
    querySelectorAll: () => [],
  };
  const createFocusable = () => ({
    hidden: false,
    isConnected: true,
    closest: () => null,
    focus() {
      documentRoot.activeElement = this;
    },
    getAttribute: () => null,
  });
  const opener = createFocusable();
  const first = createFocusable();
  const last = createFocusable();
  const attributes = new Map();
  const modal = {
    classList: createClassList(["hidden"]),
    contains: (element) => element === first || element === last,
    querySelectorAll: () => [first, last],
    setAttribute: (name, value) => attributes.set(name, value),
  };
  documentRoot.activeElement = opener;
  documentRoot.querySelectorAll = () =>
    modal.classList.contains("hidden") || modal.classList.contains("is-closing")
      ? []
      : [modal];
  const controller = createModalController({
    documentRoot,
    queue: (callback) => callback(),
    schedule(callback) {
      scheduledCallback = callback;
      return 1;
    },
    cancel() {},
  });

  controller.open(modal);
  assert.equal(documentRoot.activeElement, first);
  assert.equal(attributes.get("aria-hidden"), "false");

  documentRoot.activeElement = last;
  let prevented = false;
  controller.handleKeydown({
    key: "Tab",
    shiftKey: false,
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(documentRoot.activeElement, first);

  controller.close(modal);
  assert.equal(documentRoot.activeElement, opener);
  assert.equal(attributes.get("aria-hidden"), "true");
  scheduledCallback();
  assert.equal(body.classList.contains("modal-open"), false);
});

test("loads and persists the selected color theme", () => {
  const values = new Map([["theme", "dark"]]);
  const root = { classList: createClassList() };
  const icon = { innerHTML: "" };
  const label = { textContent: "" };
  const storage = {
    getItem(key) {
      return values.get(key) || null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  const controller = createThemeController({
    root,
    icon,
    label,
    storage,
    storageKey: "theme",
    translate: (key) => ({ dark: "Тёмная", light: "Светлая" })[key],
  });

  assert.equal(controller.load(), "dark");
  assert.equal(root.classList.contains("dark"), true);
  assert.equal(label.textContent, "Светлая");
  assert.equal(icon.textContent, "☼");

  assert.equal(controller.toggle(), "light");
  assert.equal(root.classList.contains("dark"), false);
  assert.equal(values.get("theme"), "light");
  assert.equal(label.textContent, "Тёмная");
  assert.equal(icon.textContent, "◐");
});
