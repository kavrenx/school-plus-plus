import assert from "node:assert/strict";
import test from "node:test";
import {
  createStudentStorage,
  studentSourceContext,
} from "../js/student-storage.js";
import { createSafeStorage } from "../js/safe-storage.js";
import { createPreviewStorage } from "../js/local-preview-data.js";
import { createDemoRepositories } from "../js/demo-repositories.js";
import { createDiaryChangeTracker } from "../js/diary-changes.js";
import { adaptESchoolsSnapshot } from "../js/e-schools-adapter.js";
import { STORAGE_KEYS } from "../js/app-config.js";
import { createSyntheticUserscriptExport } from "./helpers/userscript-export.js";

const context = {
  viewerId: "viewer-a",
  ownerId: "owner-a",
  schoolId: "school-a",
  studentId: "external-a",
  yearId: "year-a",
};
const user = { id: "student_demo" };
function fixture(initial = {}) {
  const values = new Map(Object.entries(initial));
  const storage = createSafeStorage({
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  });
  const scoped = (scope) => createStudentStorage(storage, scope);
  const repositories = (scope) =>
    createDemoRepositories({
      storage: createPreviewStorage(scoped(scope)),
      storageKeys: STORAGE_KEYS,
    });
  return { values, storage, scoped, repositories };
}

test("accounts, linked owners and external students stay isolated despite identical internal student IDs", () => {
  const f = fixture();
  const first = f.repositories(context);
  first.avatars.save(user, "data:image/webp;base64,synthetic-a");
  first.journal.saveJournalEntry({
    lessonId: "same-lesson",
    studentId: user.id,
    grades: ["9", "9"],
    homework: "Synthetic A",
  });
  first.journal.saveTermGrade({
    termId: "term",
    assignmentId: "assignment",
    studentId: user.id,
    grade: "9",
  });
  for (const changed of [
    { viewerId: "viewer-b" },
    { ownerId: "owner-b" },
    { studentId: "external-b" },
    { schoolId: "school-b" },
  ]) {
    const next = f.repositories({ ...context, ...changed });
    assert.equal(next.avatars.get(user), null);
    assert.equal(next.journal.getJournalEntry("same-lesson", user.id), null);
    assert.equal(
      next.journal.getTermGrade("term", "assignment", user.id),
      null,
    );
  }
  const restored = f.repositories(context);
  assert.match(restored.avatars.get(user), /synthetic-a/);
  assert.deepEqual(
    restored.journal.getJournalEntry("same-lesson", user.id).grades,
    ["9", "9"],
  );
});

test("a new school year retains the pupil's photo but starts a separate journal and change history", () => {
  const f = fixture();
  const first = f.repositories(context);
  first.avatars.save(user, "data:image/webp;base64,synthetic-a");
  first.journal.saveJournalEntry({
    lessonId: "same-lesson",
    studentId: user.id,
    grades: ["9"],
  });
  const history = createDiaryChangeTracker(f.scoped(context));
  const imported = adaptESchoolsSnapshot(
    JSON.parse(createSyntheticUserscriptExport()).snapshot,
  );
  history.record(imported);
  history.importShared([{ id: "synthetic-event", type: "grades" }]);
  const next = f.repositories({ ...context, yearId: "year-b" });
  assert.match(next.avatars.get(user), /synthetic-a/);
  assert.equal(next.journal.getJournalEntry("same-lesson", user.id), null);
  assert.deepEqual(
    createDiaryChangeTracker(
      f.scoped({ ...context, yearId: "year-b" }),
    ).getState().changes,
    [],
  );
  assert.equal(
    createDiaryChangeTracker(f.scoped(context)).getState().changes.length,
    1,
  );
});

test("unattributed legacy data is preserved without being adopted; theme stays shared", () => {
  const legacyAvatar = "schoolpp_empty_schoolPlusPlus_avatar_student_demo";
  const f = fixture({
    [legacyAvatar]: "synthetic-legacy-photo",
    schoolpp_diary_changes_v1: '{"rows":{},"changes":[{"id":"legacy"}]}',
    schoolPlusPlus_theme: "dark",
  });
  const scoped = f.scoped(context);
  assert.equal(f.repositories(context).avatars.get(user), null);
  assert.deepEqual(createDiaryChangeTracker(scoped).getState().changes, []);
  assert.equal(f.values.get(legacyAvatar), "synthetic-legacy-photo");
  assert.match(f.values.get("schoolpp_diary_changes_v1"), /legacy/);
  assert.equal(scoped.getItem("schoolPlusPlus_theme"), "dark");
  scoped.setItem("schoolPlusPlus_theme", "light");
  assert.equal(f.storage.getItem("schoolPlusPlus_theme"), "light");
});

test("invalidated or unidentified scopes cannot read legacy data or persist delayed writes", () => {
  const f = fixture();
  const first = f.scoped(context);
  first.setItem("example", "owned");
  first.invalidate();
  assert.equal(first.getItem("example"), null);
  assert.equal(first.setItem("example", "late"), false);
  assert.equal(first.removeItem("example"), false);
  assert.equal(f.scoped(context).getItem("example"), "owned");
  const incomplete = f.scoped({ ...context, studentId: "" });
  assert.equal(incomplete.getItem("example"), null);
  const count = f.values.size;
  assert.equal(incomplete.setItem("example", "memory-only"), false);
  assert.equal(incomplete.getItem("example"), "memory-only");
  assert.equal(f.values.size, count);
  assert.equal(incomplete.isPersistent(), false);
});

test("source scope comes from source IDs, not display name or the shared internal pupil ID", () => {
  const imported = adaptESchoolsSnapshot(
    JSON.parse(createSyntheticUserscriptExport()).snapshot,
  );
  const source = studentSourceContext(imported);
  assert.equal(source.schoolId, "synthetic-school");
  assert.equal(source.studentId, "synthetic-student");
  assert.ok(source.yearId);
});
