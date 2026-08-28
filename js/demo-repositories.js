import { createAvatarRepository } from "./avatar-repository.js";
import { createJournalStore } from "./journal-store.js";
import { assertRepositoryCollection } from "./repository-contracts.js";
import { createUserStore } from "./user-store.js";

function createDemoRepositories({ storage, storageKeys }) {
  return Object.freeze(assertRepositoryCollection({
    avatars: createAvatarRepository(storage, {
      avatarPrefix: storageKeys.avatarPrefix,
      legacyAvatarKey: storageKeys.legacyAvatar,
    }),
    journal: createJournalStore(storage),
    users: createUserStore(storage, storageKeys),
  }));
}

export { createDemoRepositories };
