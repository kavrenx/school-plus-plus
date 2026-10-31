import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerOperation } from "../js/owner-operation.js";
import { createOwnerSession, deferred } from "./helpers/owner-session.js";

test("owner guard permits same-owner auth notifications but cancels A to B to A", async () => {
  const session = createOwnerSession();
  const scope = createOwnerOperation({
    getIdentity: session.getIdentity,
    subscribe: session.subscribeIdentity,
  });
  assert.equal(await scope.assertCurrent(), "owner-a");
  session.change("owner-a", "TOKEN_REFRESHED");
  assert.equal(await scope.assertCurrent(), "owner-a");
  const pending = deferred();
  const stopped = assert.rejects(scope.wait(pending.promise), /Сеанс/);
  session.change("owner-b");
  session.change("owner-a");
  await stopped;
  await assert.rejects(scope.assertCurrent(), /Сеанс/);
  pending.resolve("late");
  scope.dispose();
  assert.equal(session.active, 0);
});

test("a late identity read cannot bind work to an obsolete or missing owner", async () => {
  const session = createOwnerSession();
  const pending = deferred();
  const scope = createOwnerOperation({
    getIdentity: () => pending.promise,
    subscribe: session.subscribeIdentity,
  });
  session.change("owner-b");
  pending.resolve("owner-a");
  await assert.rejects(scope.assertCurrent(), /Сеанс/);
  scope.dispose();
  const empty = createOwnerOperation({ getIdentity: async () => "" });
  await assert.rejects(empty.assertCurrent(), /Сеанс/);
  empty.dispose();
});

test("parent cancellation rejects stalled work and subscriptions are released", async () => {
  const session = createOwnerSession();
  const parent = new AbortController();
  const scope = createOwnerOperation({
    getIdentity: session.getIdentity,
    subscribe: session.subscribeIdentity,
    signal: parent.signal,
  });
  await scope.assertCurrent();
  const work = assert.rejects(scope.wait(new Promise(() => {})), /cancelled/);
  parent.abort(new Error("cancelled"));
  await work;
  scope.dispose();
  scope.dispose();
  assert.equal(session.active, 0);
});

test("a signed-out preparation can bind its new anonymous user but cannot cross users", async () => {
  const session = createOwnerSession("");
  const scope = createOwnerOperation({
    getIdentity: session.getIdentity,
    subscribe: session.subscribeIdentity,
    captureIdentity: false,
  });
  session.change("new-owner");
  scope.bind("new-owner");
  assert.equal(await scope.assertCurrent(), "new-owner");
  session.change("");
  await assert.rejects(scope.assertCurrent(), /Сеанс/);
  scope.dispose();
});
