import assert from "node:assert/strict";
import test from "node:test";
import { requestStartupExtensionSnapshot } from "../js/startup-diary-source.js";

function environment(navigator = {}) {
  const listeners = new Map(),
    timers = new Map(),
    messages = [];
  let timerId = 0;
  const window = {
    navigator,
    location: { origin: "https://schoolpp.com" },
    crypto: { randomUUID: () => "synthetic-request" },
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name) => listeners.delete(name),
    setTimeout: (run, ms) => {
      timers.set(++timerId, { run, ms });
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
    postMessage: (message, origin) => messages.push({ message, origin }),
  };
  return { window, listeners, timers, messages };
}

test("Apple mobile cloud fallback does not send a desktop request or start its timeout", async () => {
  for (const navigator of [
    { userAgent: "Mozilla/5.0 (iPhone) Mobile Safari" },
    { userAgent: "Mozilla/5.0 (iPhone) CriOS/140.0" },
    { userAgent: "iPad" },
    { userAgent: "Macintosh", maxTouchPoints: 5 },
  ]) {
    const f = environment(navigator);
    assert.equal(await requestStartupExtensionSnapshot(f.window), null);
    assert.equal(f.messages.length, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.listeners.size, 0);
  }
});

test("desktop and Android keep the original bridge timeout and matching response checks", async () => {
  for (const navigator of [
    { userAgent: "Windows Chrome/140.0" },
    { userAgent: "Macintosh", maxTouchPoints: 0 },
    { userAgent: "Android Mobile Firefox/140.0" },
    {},
  ]) {
    const f = environment(navigator);
    let resolved = false;
    const pending = requestStartupExtensionSnapshot(f.window).then((value) => {
      resolved = true;
      return value;
    });
    assert.equal(f.messages.length, 1);
    assert.equal(f.messages[0].origin, f.window.location.origin);
    assert.equal([...f.timers.values()][0].ms, 2500);
    const respond = (overrides) =>
      f.listeners.get("message")({
        source: f.window,
        origin: f.window.location.origin,
        data: {
          source: "schoolpp-extension",
          type: "SCHOOLPP_EXTENSION_RESPONSE",
          requestId: "synthetic-request",
          snapshot: { source: "synthetic" },
        },
        ...overrides,
      });
    respond({ origin: "https://example.invalid" });
    respond({ source: {} });
    respond({
      data: {
        source: "schoolpp-extension",
        type: "SCHOOLPP_EXTENSION_RESPONSE",
        requestId: "old-request",
        snapshot: {},
      },
    });
    await Promise.resolve();
    assert.equal(resolved, false);
    respond({});
    assert.deepEqual(await pending, { source: "synthetic" });
    assert.equal(f.timers.size, 0);
    assert.equal(f.listeners.size, 0);
  }
});

test("an unavailable desktop bridge times out to the cloud fallback and removes its listener", async () => {
  const f = environment({ userAgent: "Windows" });
  const pending = requestStartupExtensionSnapshot(f.window);
  [...f.timers.values()][0].run();
  assert.equal(await pending, null);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
});
