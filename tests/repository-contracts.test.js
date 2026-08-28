import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRepositoryContract,
  REPOSITORY_CONTRACTS,
} from "../js/repository-contracts.js";

test("accepts a repository that implements its declared contract", () => {
  const journal = Object.fromEntries(
    REPOSITORY_CONTRACTS.journal.map((method) => [method, () => {}]),
  );

  assert.equal(assertRepositoryContract("journal", journal), journal);
});

test("reports every missing repository method", () => {
  assert.throws(
    () => assertRepositoryContract("journal", { getJournalEntry() {} }),
    /getLessonEntries, getLessonWork, getTermGrade, getTermGrades, mergeLessonForStudent, saveJournalEntry, saveLessonWork, saveTermGrade/,
  );
});
