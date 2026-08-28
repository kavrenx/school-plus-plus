import assert from "node:assert/strict";
import test from "node:test";
import { createSafeStorage, getBrowserStorage } from "../js/safe-storage.js";

function createStorage(initialEntries = {}) {
  const values = new Map(Object.entries(initialEntries));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("uses persistent storage when it is available", () => {
  const source = createStorage();
  const storage = createSafeStorage(source);

  assert.equal(storage.setItem("theme", "dark"), true);
  assert.equal(storage.getItem("theme"), "dark");
  assert.equal(storage.removeItem("theme"), true);
  assert.equal(storage.getItem("theme"), null);
  assert.equal(storage.isPersistent(), true);
});

test("keeps the latest value in memory when a persistent write fails", () => {
  const source = createStorage({ profile: "old" });
  source.setItem = () => {
    throw new Error("Quota exceeded");
  };
  const errors = [];
  const storage = createSafeStorage(source, {
    onError: (failure) => errors.push(failure.operation),
  });

  assert.equal(storage.setItem("profile", "new"), false);
  assert.equal(storage.getItem("profile"), "new");
  assert.equal(storage.isPersistent(), false);
  assert.deepEqual(errors, ["write"]);
});

test("returns safe fallbacks when persistent storage is unavailable", () => {
  const unavailableStorage = {
    getItem() {
      throw new Error("Blocked");
    },
    removeItem() {
      throw new Error("Blocked");
    },
    setItem() {
      throw new Error("Blocked");
    },
  };
  const storage = createSafeStorage(unavailableStorage);

  assert.equal(storage.getItem("missing"), null);
  assert.equal(storage.setItem("draft", "value"), false);
  assert.equal(storage.getItem("draft"), "value");
  assert.equal(storage.removeItem("draft"), false);
  assert.equal(storage.getItem("draft"), null);
});

test("handles browsers that block access to the localStorage property", () => {
  const browserWindow = {};
  Object.defineProperty(browserWindow, "localStorage", {
    get() {
      throw new Error("Security error");
    },
  });

  const storage = createSafeStorage(getBrowserStorage(browserWindow));

  assert.equal(storage.isPersistent(), false);
  assert.equal(storage.setItem("session", "student"), false);
  assert.equal(storage.getItem("session"), "student");
});
