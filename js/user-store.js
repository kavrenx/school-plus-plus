function createUserStore(storage, storageKeys) {
  const userKey = storageKeys.user;
  const profilePrefix = storageKeys.profilePrefix;

  function saveUser(user) {
    const session = createSessionReference(user);
    if (!session) {
      clearUser();
      return;
    }
    storage.setItem(userKey, JSON.stringify(session));
  }

  function clearUser() {
    storage.removeItem(userKey);
  }

  function getSavedUser(accounts = []) {
    try {
      const raw = storage.getItem(userKey);
      const session = raw ? JSON.parse(raw) : null;

      if (!isValidSessionReference(session)) {
        clearUser();
        return null;
      }

      const canonicalUser = accounts.find((account) =>
        session.userId
          ? account.id === session.userId || account.userId === session.userId
          : account.login === session.login,
      );
      if (!canonicalUser) {
        clearUser();
        return null;
      }

      saveUser(canonicalUser);
      return canonicalUser;
    } catch {
      clearUser();
      return null;
    }
  }

  function getProfileKey(login) {
    return `${profilePrefix}${login || "guest"}`;
  }

  function getProfile(login) {
    try {
      const profile = JSON.parse(storage.getItem(getProfileKey(login)) || "{}");
      return profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
    } catch {
      return {};
    }
  }

  function saveProfile(login, profile) {
    storage.setItem(getProfileKey(login), JSON.stringify(profile));
  }

  function clearProfile(login) {
    storage.removeItem(getProfileKey(login));
  }

  function applyProfileOverrides(user) {
    if (!user || (user.role && user.role !== "student")) return user;
    return { ...user, ...getProfile(user.login) };
  }

  return {
    applyProfileOverrides,
    clearProfile,
    clearUser,
    getProfile,
    getSavedUser,
    saveProfile,
    saveUser,
  };
}

function createSessionReference(user) {
  if (!user || typeof user !== "object" || Array.isArray(user)) return null;
  const userId = user.id || user.userId;
  if (userId) return { version: 1, userId };
  if (user.login) return { version: 1, login: user.login };
  return null;
}

function isValidSessionReference(session) {
  return Boolean(
    session &&
      typeof session === "object" &&
      !Array.isArray(session) &&
      (session.userId || session.login),
  );
}

export { createSessionReference, createUserStore };
