import assert from "node:assert/strict";
import test from "node:test";
import { cleanStudentName } from "../js/student-name.js";
import { adaptESchoolsSnapshot } from "../js/e-schools-adapter.js";
import { createSyntheticUserscriptExport } from "./helpers/userscript-export.js";

test("only known trailing navigation is removed from student names", () => {
  for (const name of [
    "Тестов Алексей Текущие",
    "Тестов АлексейТекущие уроки",
    "Тестов Алексей Итоговые отметки",
    "Тестов АлексейИтоговые",
  ])
    assert.equal(cleanStudentName(name), "Тестов Алексей");
  for (const name of [
    "Тестов Алексей Сергеевич",
    "Тестова Анна-Мария Сергеевна",
    "Тестов А.С.",
    "Текущиева Анна Ивановна",
  ])
    assert.equal(cleanStudentName(name), name);
  assert.equal(cleanStudentName(undefined), "");
});

test("old saved studentIdentity and profile names are cleaned without editing the raw snapshot", () => {
  for (const source of ["explicit", "profile", "heading"]) {
    const snapshot = JSON.parse(createSyntheticUserscriptExport()).snapshot;
    snapshot.pages = {
      p:
        source === "explicit"
          ? {
              studentIdentity: {
                name: "Тестов Алексей Текущие",
                classTitle: "8 Б",
              },
            }
          : source === "profile"
            ? { profile: { label: "Тестов Алексей Текущие" } }
            : {
                headings: [
                  "Электронный дневник обучающегося 8 Б класса, Тестов АлексейТекущие уроки",
                ],
              },
    };
    const original = JSON.stringify(snapshot);
    const adapted = adaptESchoolsSnapshot(snapshot);
    assert.equal(adapted.school.users[0].displayName, "Тестов Алексей");
    assert.equal(adapted.school.users[0].middleName, "");
    assert.equal(JSON.stringify(snapshot), original);
  }
});
