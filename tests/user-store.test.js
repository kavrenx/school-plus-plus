import assert from "node:assert/strict";
import test from "node:test";
import { createUserStore } from "../js/user-store.js";

const STORAGE_KEYS = {
  user: "user",
  profilePrefix: "profile_",
};

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

test("restores the canonical student and applies saved profile fields", () => {
  const storage = createStorage();
  const store = createUserStore(storage, STORAGE_KEYS);
  const canonicalStudent = {
    id: "student-1",
    role: "student",
    login: "student",
    firstName: "Даниил",
    lastName: "Романов",
    className: "7Б",
  };

  store.saveUser({
    ...canonicalStudent,
    password: "must-not-be-saved",
    className: "Старое значение",
  });
  assert.deepEqual(JSON.parse(storage.getItem("user")), {
    version: 1,
    userId: "student-1",
  });
  store.saveProfile("student", {
    email: "student@example.test",
    className: "7А",
  });

  assert.deepEqual(store.getSavedUser([canonicalStudent]), {
    ...canonicalStudent,
    email: "student@example.test",
    className: "7А",
  });
});

test("migrates a legacy full-user session to a safe reference", () => {
  const canonicalTeacher = {
    id: "teacher-1",
    role: "teacher",
    login: "teacher",
    password: "canonical-password",
    firstName: "Марина",
    lastName: "Орлова",
  };
  const storage = createStorage({
    user: JSON.stringify({
      ...canonicalTeacher,
      role: "admin",
      password: "stored-password",
    }),
  });
  const store = createUserStore(storage, STORAGE_KEYS);

  assert.equal(store.getSavedUser([canonicalTeacher]), canonicalTeacher);
  assert.deepEqual(JSON.parse(storage.getItem("user")), {
    version: 1,
    userId: "teacher-1",
  });
});

test("clears a session when its canonical account no longer exists", () => {
  const storage = createStorage({
    user: JSON.stringify({ version: 1, userId: "missing-user" }),
  });
  const store = createUserStore(storage, STORAGE_KEYS);

  assert.equal(store.getSavedUser([]), null);
  assert.equal(storage.getItem("user"), null);
});

test("clears an invalid or corrupted saved session", () => {
  const storage = createStorage({ user: "{broken-json" });
  const store = createUserStore(storage, STORAGE_KEYS);

  assert.equal(store.getSavedUser(), null);
  assert.equal(storage.getItem("user"), null);
});

test("does not apply student profile fields to teachers", () => {
  const storage = createStorage();
  const store = createUserStore(storage, STORAGE_KEYS);
  const teacher = {
    role: "teacher",
    login: "teacher",
    firstName: "Марина",
    lastName: "Орлова",
  };

  store.saveProfile("teacher", { firstName: "Другое имя" });

  assert.equal(store.applyProfileOverrides(teacher), teacher);
});

test("returns an empty profile for malformed profile data", () => {
  const storage = createStorage({ profile_student: "[1,2,3]" });
  const store = createUserStore(storage, STORAGE_KEYS);

  assert.deepEqual(store.getProfile("student"), {});
});
