import { getAvatarStorageKey } from "./avatar-service.js";

function getDemoDataKeys({ accounts = [], storageKeys, journalStorageKey }) {
  const keys = new Set([
    storageKeys.user,
    storageKeys.legacyAvatar,
    journalStorageKey,
  ]);

  accounts.forEach((account) => {
    if (account?.login) keys.add(`${storageKeys.profilePrefix}${account.login}`);
    const avatarKey = getAvatarStorageKey(storageKeys.avatarPrefix, account);
    if (avatarKey) keys.add(avatarKey);
  });

  return [...keys].filter(Boolean);
}

function resetDemoData({ storage, accounts, storageKeys, journalStorageKey }) {
  const keys = getDemoDataKeys({
    accounts,
    storageKeys,
    journalStorageKey,
  });
  const removed = keys.map((key) => storage.removeItem(key) !== false);

  return {
    clearedKeys: keys,
    persisted: removed.every(Boolean),
  };
}

export { getDemoDataKeys, resetDemoData };
