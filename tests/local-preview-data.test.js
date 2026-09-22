import assert from "node:assert/strict";
import test from "node:test";
import { SCHOOL_DATA } from "../data/school-data.js";
import { SCHOOL_DIARY } from "../data/diary-data.js";
import { DAY_ORDER } from "../js/app-config.js";
import { normalizeDiaryData } from "../js/diary-model.js";
import {
  createLocalPreviewData,
  createPreviewStorage,
} from "../js/local-preview-data.js";

test("empty local screens retain calendar navigation without personal school data", () => {
  const originalName = SCHOOL_DATA.users[0].firstName;
  const data = createLocalPreviewData(SCHOOL_DIARY, SCHOOL_DATA);
  const model = normalizeDiaryData(data.diary, DAY_ORDER, data.school);
  assert.equal(model.lessons.length, 0);
  assert.equal(model.weeks.length, SCHOOL_DIARY.weeks.length);
  assert.equal(model.school.academicYear.terms.length, 4);
  assert.ok(
    model.school.users.every(
      (user) => user.displayName === "—" && user.email === "",
    ),
  );
  assert.equal(SCHOOL_DATA.users[0].firstName, originalName);
  assert.equal(data.school.users[0].password, "student");
  assert.equal(
    model.getStudentsForAssignment(
      model.getTeacherAssignments("teacher_demo")[0],
    ).length <= 1,
    true,
  );
});

test("empty local storage isolates previous profiles and marks while sharing theme", () => {
  const values = new Map([
    ["schoolPlusPlus_user", "old-user"],
    ["schoolPlusPlus_theme", "dark"],
  ]);
  const storage = createPreviewStorage({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
      return true;
    },
    removeItem: (key) => values.delete(key),
    isPersistent: () => true,
  });
  assert.equal(storage.getItem("schoolPlusPlus_user"), null);
  assert.equal(storage.getItem("schoolPlusPlus_theme"), "dark");
  storage.setItem("schoolPlusPlus_user", "new-user");
  assert.equal(values.get("schoolPlusPlus_user"), "old-user");
  assert.equal(storage.getItem("schoolPlusPlus_user"), "new-user");
});
