import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../js/api-client.js";
import { createApiJournalRepository } from "../js/api-journal-repository.js";

test("uses encoded journal endpoints and preserves the repository result shape", async () => {
  const calls = [];
  const entry = {
    lessonId: "lesson/1",
    studentId: "student 1",
    grades: ["10"],
    attendance: "",
    homework: "Повторить тему",
  };
  const repository = createApiJournalRepository({
    async request(path, options = {}) {
      calls.push({ path, options });
      return { entry };
    },
  });

  assert.equal(
    await repository.getJournalEntry("lesson/1", "student 1"),
    entry,
  );
  const saved = await repository.saveJournalEntry(entry);

  assert.equal(
    calls[0].path,
    "lessons/lesson%2F1/students/student%201/journal",
  );
  assert.equal(calls[1].options.method, "PUT");
  assert.deepEqual(calls[1].options.body, {
    grades: ["10"],
    attendance: "",
    comment: "",
    homework: "Повторить тему",
    materials: [],
  });
  assert.deepEqual(saved, { entry, persisted: true });
});

test("returns null for a missing entry and propagates other API errors", async () => {
  const missingRepository = createApiJournalRepository({
    async request() {
      throw new ApiError("Не найдено", { status: 404 });
    },
  });
  assert.equal(
    await missingRepository.getJournalEntry("lesson-1", "student-1"),
    null,
  );

  const failedRepository = createApiJournalRepository({
    async request() {
      throw new ApiError("Нет доступа", { status: 403 });
    },
  });
  await assert.rejects(
    failedRepository.getJournalEntry("lesson-1", "student-1"),
    { status: 403 },
  );
});

test("merges an API journal entry into the same lesson view as the demo store", async () => {
  const repository = createApiJournalRepository({
    async request(path) {
      if (path.endsWith("/work")) {
        return {
          lessonWork: {
            lessonId: "lesson-1",
            homework: "Новое задание",
            materials: [],
          },
        };
      }
      return {
        entry: {
          grades: ["8", "9"],
          attendance: "absent",
        },
      };
    },
  });

  const merged = await repository.mergeLessonForStudent(
    { id: "lesson-1", homework: "Старое задание", grade: "" },
    "student-1",
  );

  assert.equal(merged.grade, "8 / 9");
  assert.equal(merged.attendance, "absent");
  assert.equal(merged.homework, "Новое задание");
});

test("uses lesson-level homework and term-grade endpoints", async () => {
  const calls = [];
  const repository = createApiJournalRepository({
    async request(path, options = {}) {
      calls.push({ path, options });
      if (path.endsWith("/grades")) return { termGrades: [] };
      if (path.endsWith("/work"))
        return { lessonWork: { lessonId: "lesson-1" } };
      return { termGrade: { value: "9" } };
    },
  });

  await repository.saveLessonWork({
    lessonId: "lesson-1",
    homework: "§ 2",
    materials: ["https://example.test/material"],
  });
  await repository.getTermGrades("term-1", "assignment-1");
  await repository.saveTermGrade({
    termId: "term-1",
    assignmentId: "assignment-1",
    studentId: "student-1",
    value: "9",
  });

  assert.equal(calls[0].path, "lessons/lesson-1/work");
  assert.equal(calls[0].options.method, "PUT");
  assert.match(
    calls[1].path,
    /terms\/term-1\/assignments\/assignment-1\/grades/,
  );
  assert.equal(calls[2].options.body.value, "9");
});

test("rejects journal requests without stable identifiers", async () => {
  const repository = createApiJournalRepository({
    async request() {
      throw new Error("must not be called");
    },
  });

  await assert.rejects(repository.getJournalEntry("", "student-1"), {
    name: "TypeError",
    message: "lessonId is required",
  });
});
