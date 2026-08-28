import assert from "node:assert/strict";
import test from "node:test";
import { validateProfile } from "../js/profile-controller.js";

test("requires the student's first and last name", () => {
  assert.equal(
    validateProfile({ firstName: "", lastName: "Романов", email: "" }),
    "name",
  );
  assert.equal(
    validateProfile({ firstName: "Даниил", lastName: "", email: "" }),
    "name",
  );
});

test("accepts an empty or valid email and rejects malformed addresses", () => {
  assert.equal(
    validateProfile({ firstName: "Даниил", lastName: "Романов", email: "" }),
    null,
  );
  assert.equal(
    validateProfile({
      firstName: "Даниил",
      lastName: "Романов",
      email: "student@example.test",
    }),
    null,
  );
  assert.equal(
    validateProfile({
      firstName: "Даниил",
      lastName: "Романов",
      email: "student@",
    }),
    "email",
  );
});
