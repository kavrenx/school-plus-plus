import assert from "node:assert/strict";
import test from "node:test";

import { getDemoDataKeys, resetDemoData } from "../js/demo-data-reset.js";

const storageKeys = {
  user: "session",
  theme: "theme",
  profilePrefix: "profile_",
  avatarPrefix: "avatar_",
  legacyAvatar: "avatar",
};
const accounts = [
  { id: "student_demo", login: "student" },
  { id: "teacher/demo", login: "teacher" },
];

test("collects only resettable demo keys and keeps the theme separate", () => {
  assert.deepEqual(
    getDemoDataKeys({
      accounts,
      storageKeys,
      journalStorageKey: "journal",
    }),
    [
      "session",
      "avatar",
      "journal",
      "profile_student",
      "avatar_student_demo",
      "profile_teacher",
      "avatar_teacher%2Fdemo",
    ],
  );
});

test("resets demo changes without deleting interface preferences", () => {
  const values = new Map([
    ["session", "student"],
    ["avatar", "legacy"],
    ["journal", "changed"],
    ["profile_student", "changed"],
    ["avatar_student_demo", "changed"],
    ["theme", "dark"],
  ]);
  const storage = {
    removeItem(key) {
      values.delete(key);
      return true;
    },
  };

  const result = resetDemoData({
    storage,
    accounts,
    storageKeys,
    journalStorageKey: "journal",
  });

  assert.equal(result.persisted, true);
  assert.equal(values.get("theme"), "dark");
  assert.equal(values.has("journal"), false);
  assert.equal(values.has("profile_student"), false);
});

test("reports when a reset could not be persisted", () => {
  const storage = { removeItem: () => false };
  const result = resetDemoData({
    storage,
    accounts,
    storageKeys,
    journalStorageKey: "journal",
  });

  assert.equal(result.persisted, false);
});
