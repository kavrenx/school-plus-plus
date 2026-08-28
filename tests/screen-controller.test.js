import assert from "node:assert/strict";
import test from "node:test";
import { createScreenController } from "../js/screen-controller.js";

function createScreen(initial = []) {
  const classes = new Set(initial);
  return {
    classList: {
      add(...names) {
        names.forEach((name) => classes.add(name));
      },
      contains(name) {
        return classes.has(name);
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
    },
  };
}

test("moves from the active screen to the requested screen", () => {
  const login = createScreen();
  const dashboard = createScreen(["hidden"]);
  const callbacks = [];
  const controller = createScreenController({
    screens: [login, dashboard],
    schedule(callback) {
      callbacks.push(callback);
    },
  });

  assert.equal(controller.getActive(), login);
  controller.show(dashboard);
  assert.equal(dashboard.classList.contains("hidden"), false);
  assert.equal(dashboard.classList.contains("screen-enter"), true);
  assert.equal(login.classList.contains("screen-exit"), true);

  callbacks.forEach((callback) => callback());
  assert.equal(login.classList.contains("hidden"), true);
  assert.equal(login.classList.contains("screen-exit"), false);
  assert.equal(dashboard.classList.contains("screen-enter"), false);
});

test("hides every stale visible screen when the requested screen is already visible", () => {
  const login = createScreen();
  const presentation = createScreen(["hidden"]);
  const dashboard = createScreen();
  const callbacks = [];
  const controller = createScreenController({
    screens: [login, presentation, dashboard],
    schedule(callback) {
      callbacks.push(callback);
    },
  });

  controller.show(login);

  assert.equal(login.classList.contains("screen-enter"), true);
  assert.equal(dashboard.classList.contains("screen-exit"), true);

  callbacks.forEach((callback) => callback());
  assert.equal(login.classList.contains("hidden"), false);
  assert.equal(dashboard.classList.contains("hidden"), true);
  assert.equal(dashboard.classList.contains("screen-exit"), false);
});
