import { getAvatarStorageKey } from "./avatar-service.js";

function createAvatarRepository(storage, { avatarPrefix, legacyAvatarKey }) {
  function get(user) {
    const key = getAvatarStorageKey(avatarPrefix, user);
    if (!key) return null;

    const avatar = storage.getItem(key);
    if (avatar) return avatar;

    const legacyAvatar = storage.getItem(legacyAvatarKey);
    if (!legacyAvatar) return null;
    if (storage.setItem(key, legacyAvatar) === false) return null;

    storage.removeItem(legacyAvatarKey);
    return legacyAvatar;
  }

  function save(user, avatar) {
    const key = getAvatarStorageKey(avatarPrefix, user);
    if (!key || !avatar) return false;

    const persisted = storage.setItem(key, avatar) !== false;
    storage.removeItem(legacyAvatarKey);
    return persisted;
  }

  function remove(user) {
    const key = getAvatarStorageKey(avatarPrefix, user);
    if (!key) return false;

    const avatarRemoved = storage.removeItem(key) !== false;
    const legacyRemoved = storage.removeItem(legacyAvatarKey) !== false;
    return avatarRemoved && legacyRemoved;
  }

  return { get, remove, save };
}

export { createAvatarRepository };
