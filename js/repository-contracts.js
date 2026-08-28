const REPOSITORY_CONTRACTS = Object.freeze({
  avatars: Object.freeze(["get", "save", "remove"]),
  journal: Object.freeze([
    "getJournalEntry",
    "getLessonEntries",
    "getLessonWork",
    "getTermGrade",
    "getTermGrades",
    "mergeLessonForStudent",
    "saveJournalEntry",
    "saveLessonWork",
    "saveTermGrade",
  ]),
  users: Object.freeze([
    "applyProfileOverrides",
    "clearProfile",
    "clearUser",
    "getProfile",
    "getSavedUser",
    "saveProfile",
    "saveUser",
  ]),
});

function assertRepositoryContract(name, repository) {
  const methods = REPOSITORY_CONTRACTS[name];
  if (!methods) throw new Error(`Unknown repository contract: ${name}`);
  if (!repository || typeof repository !== "object") {
    throw new TypeError(`Repository "${name}" is not available`);
  }

  const missingMethods = methods.filter(
    (method) => typeof repository[method] !== "function",
  );
  if (missingMethods.length) {
    throw new TypeError(
      `Repository "${name}" is missing methods: ${missingMethods.join(", ")}`,
    );
  }
  return repository;
}

function assertRepositoryCollection(repositories) {
  Object.keys(REPOSITORY_CONTRACTS).forEach((name) => {
    assertRepositoryContract(name, repositories?.[name]);
  });
  return repositories;
}

export {
  assertRepositoryCollection,
  assertRepositoryContract,
  REPOSITORY_CONTRACTS,
};
