import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthAccounts,
  findAccountByCredentials,
  findAccountByInviteCode,
} from "../js/auth-model.js";

test("normalizes canonical school users for the authentication layer", () => {
  const accounts = createAuthAccounts([
    {
      id: "student-1",
      role: "student",
      login: "student",
      password: "current-password",
      inviteCode: "INVITE-1",
      firstName: "Даниил",
    },
  ]);

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].id, "student-1");
  assert.equal(accounts[0].userId, "student-1");
  assert.equal(accounts[0].password, "current-password");
  assert.equal(accounts[0].inviteCode, "INVITE-1");
});

test("keeps distinct roles and ignores records without a login", () => {
  const accounts = createAuthAccounts([
    { firstName: "Без логина" },
    {
      id: "teacher-1",
      role: "teacher",
      login: "teacher",
      password: "teacher-password",
    },
    {
      id: "admin-1",
      role: "admin",
      login: "admin",
      password: "admin-password",
    },
  ]);

  assert.deepEqual(
    accounts.map(({ login, role }) => ({ login, role })),
    [
      { login: "teacher", role: "teacher" },
      { login: "admin", role: "admin" },
    ],
  );
});

test("finds exact credentials and normalized invite codes", () => {
  const accounts = [
    {
      login: "student",
      password: "student-password",
      inviteCode: "INVITE-1",
    },
  ];

  assert.equal(
    findAccountByCredentials(accounts, "student", "student-password"),
    accounts[0],
  );
  assert.equal(
    findAccountByCredentials(accounts, "Student", "student-password"),
    null,
  );
  assert.equal(findAccountByCredentials(accounts, "student", "wrong"), null);
  assert.equal(findAccountByInviteCode(accounts, "INVITE-1"), accounts[0]);
  assert.equal(findAccountByInviteCode(accounts, "invite1"), accounts[0]);
  assert.equal(findAccountByInviteCode(accounts, "INVI-TE-2"), null);
});
