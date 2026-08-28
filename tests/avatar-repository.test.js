import assert from "node:assert/strict";
import test from "node:test";
import { createAvatarRepository } from "../js/avatar-repository.js";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    removeItem(key) {
      values.delete(key);
      return true;
    },
    setItem(key, value) {
      values.set(key, value);
      return true;
    },
  };
}

function createRepository(storage) {
  return createAvatarRepository(storage, {
    avatarPrefix: "avatar_",
    legacyAvatarKey: "legacy_avatar",
  });
}

test("stores avatars behind a user-scoped repository", () => {
  const repository = createRepository(createStorage());
  const user = { id: "student-1" };

  assert.equal(repository.save(user, "data:image/webp;base64,demo"), true);
  assert.equal(repository.get(user), "data:image/webp;base64,demo");
  assert.equal(repository.remove(user), true);
  assert.equal(repository.get(user), null);
});

test("migrates a legacy avatar without exposing storage keys to the UI", () => {
  const storage = createStorage({
    legacy_avatar: "data:image/webp;base64,old",
  });
  const repository = createRepository(storage);

  assert.equal(
    repository.get({ id: "student-2" }),
    "data:image/webp;base64,old",
  );
  assert.equal(storage.getItem("legacy_avatar"), null);
  assert.equal(
    storage.getItem("avatar_student-2"),
    "data:image/webp;base64,old",
  );
});
