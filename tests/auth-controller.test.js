import assert from "node:assert/strict";
import test from "node:test";
import { getDemoAccountSummary } from "../js/auth-controller.js";

test("describes the demo account selected by an invite code", () => {
  assert.deepEqual(
    getDemoAccountSummary({
      login: "student",
      firstName: "Даниил",
      lastName: "Романов",
      className: '7 "Б"',
    }),
    { name: "Даниил Романов", className: '7 "Б"' },
  );
  assert.deepEqual(getDemoAccountSummary({ login: "student" }), {
    name: "student",
    className: "—",
  });
});
