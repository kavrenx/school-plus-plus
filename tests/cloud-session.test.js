import assert from "node:assert/strict";
import test from "node:test";
import {
  createCloudSession,
  getCloudErrorMessage,
} from "../js/cloud-session.js";

function harness(getUser) {
  const events = [];
  const scheduled = [];
  let listener;
  let unsubscribed = false;
  const session = createCloudSession({
    auth: {
      getUser,
      onChange(callback) {
        listener = callback;
        return () => {
          unsubscribed = true;
        };
      },
    },
    onUser: (user) => events.push(["user", user.id]),
    onSignedOut: () => events.push(["out"]),
    onRecovery: (user) => events.push(["recovery", user.id]),
    onError: (error) => events.push(["error", error.message]),
    schedule: (callback) => scheduled.push(callback),
  });
  return {
    session,
    events,
    scheduled,
    emit: (event) => listener(event),
    isUnsubscribed: () => unsubscribed,
  };
}

test("sign out invalidates an outstanding user lookup", async () => {
  let resolve;
  const h = harness(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = h.session.refresh();
  h.emit("SIGNED_OUT");
  resolve({ id: "old-user" });
  await pending;
  assert.deepEqual(h.events, [["out"]]);
});

test("auth event defers SDK calls and password update stays in recovery until completed", async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    return { id: "user" };
  });
  h.emit("PASSWORD_RECOVERY");
  assert.equal(calls, 0);
  h.scheduled.shift()();
  await Promise.resolve();
  assert.deepEqual(h.events, [["recovery", "user"]]);
  h.emit("USER_UPDATED");
  h.scheduled.shift()();
  await Promise.resolve();
  assert.equal(h.events.at(-1)[0], "recovery");
  await h.session.finishRecovery();
  assert.deepEqual(h.events.at(-1), ["user", "user"]);
});

test("missing session shows login while network failure is reported", async () => {
  const h = harness(async () => {
    const error = new Error("No session");
    error.name = "AuthSessionMissingError";
    throw error;
  });
  await h.session.refresh();
  assert.deepEqual(h.events, [["out"]]);
  const failed = harness(async () => {
    throw new Error("network");
  });
  await failed.session.refresh();
  assert.deepEqual(failed.events, [["error", "network"]]);
});

test("disposed controller ignores queued auth work and unsubscribes", () => {
  const h = harness(() => {
    assert.fail("No work after disposal");
  });
  h.emit("SIGNED_IN");
  h.session.dispose();
  h.scheduled.shift()();
  assert.equal(h.isUnsubscribed(), true);
  assert.deepEqual(h.events, []);
});

test("public errors do not expose raw server details", () => {
  assert.equal(
    getCloudErrorMessage({ code: "invalid_credentials" }),
    "Неверная почта или пароль.",
  );
  assert.equal(
    getCloudErrorMessage({ message: "private SQL details" }).includes(
      "private",
    ),
    false,
  );
});
