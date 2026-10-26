import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createPublicUserscriptClient } from "../js/userscript-client.js";
import { runSchoolppUserscript } from "../js/userscript-runtime.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
function fixture({ observe = true } = {}) {
  const window = new Window({ url: "https://schoolpp.com" });
  const timers = new Map();
  const requests = [];
  let nextTimer = 0;
  let activeObservers = 0;
  const scope = {
    document: window.document,
    location: window.location,
    crypto: window.crypto,
    setTimeout(fn, ms) {
      const id = ++nextTimer;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  if (observe) {
    scope.MutationObserver = class extends window.MutationObserver {
      observe(...args) {
        activeObservers++;
        super.observe(...args);
      }
      disconnect() {
        activeObservers--;
        super.disconnect();
      }
    };
  }
  window.document.addEventListener("schoolpp-userscript-request-v2", (event) =>
    requests.push(JSON.parse(event.detail)),
  );
  function mark(state) {
    window.document.documentElement.setAttribute(
      "data-schoolpp-userscript",
      JSON.stringify({ version: "1.0.1", state }),
    );
  }
  async function inject(gm = {}) {
    const runtime = { document: window.document, location: window.location };
    runtime.top = runtime;
    await runSchoolppUserscript(runtime, gm, null, {
      origins: [window.location.origin],
      version: "1.0.1",
      transport: "userscript",
    });
    await settle();
  }
  const gm = Object.fromEntries(
    ["getValue", "setValue", "deleteValue", "getTab", "saveTab"].map((name) => [
      name,
      () => assert.fail("readiness must not access diary or tab storage"),
    ]),
  );
  return {
    window,
    client: createPublicUserscriptClient(scope),
    timers,
    requests,
    mark,
    inject: () => inject(gm),
    injectIncompatible: () => inject(null),
    activeObservers: () => activeObservers,
    async expire() {
      const [id, timer] = timers.entries().next().value;
      assert.equal(timer.ms, 2000);
      timers.delete(id);
      timer.fn();
      await settle();
    },
    close: () => window.close(),
  };
}

test("late readiness retries ping before its timeout without touching GM storage", async () => {
  const f = fixture();
  try {
    let ready = false;
    const pending = f.client.ping().then(() => (ready = true));
    await f.inject();
    assert.equal(
      ready,
      true,
      "readiness should not wait for the 2-second timer",
    );
    await pending;
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[0].id, f.requests[1].id);
    assert.equal(f.timers.size, 0);
    assert.equal(f.activeObservers(), 0);
    f.mark("ready");
    await settle();
    assert.equal(f.requests.length, 2, "completed checks leave no observer");
  } finally {
    f.close();
  }
});

test("a ready marker and foreign replies cannot substitute for a matching response", async () => {
  const f = fixture();
  const doc = f.window.document;
  doc.addEventListener("schoolpp-userscript-request-v2", (event) => {
    const request = JSON.parse(event.detail);
    for (const change of [
      { origin: "https://example.com" },
      { id: "b".repeat(32) },
      { source: "schoolpp-userscript-v1" },
    ]) {
      const response = doc.createEvent("CustomEvent");
      response.initCustomEvent(
        "schoolpp-userscript-response-v2",
        false,
        false,
        JSON.stringify({
          source: "schoolpp-userscript-v2",
          origin: f.window.location.origin,
          id: request.id,
          type: "ready",
          compatible: true,
          ...change,
        }),
      );
      doc.dispatchEvent(response);
    }
  });
  try {
    const failed = assert.rejects(f.client.ping(), {
      code: "bridge_no_response",
    });
    f.mark("ready");
    await settle();
    for (let i = 0; i < 5; i++) {
      f.mark("ready");
      await settle();
    }
    assert.equal(
      f.requests.length,
      2,
      "marker changes cause at most one resend",
    );
    for (let i = 0; i < 3; i++) await f.expire();
    await failed;
    assert.equal(f.requests.length, 4);
    assert.equal(f.activeObservers(), 0);
  } finally {
    f.close();
  }
});

test("late incompatible runtime still fails the compatibility check immediately", async () => {
  const f = fixture();
  try {
    const failed = assert.rejects(f.client.ping(), {
      code: "unsupported_manager",
    });
    await f.injectIncompatible();
    assert.equal(f.requests.length, 2);
    assert.equal(f.timers.size, 0);
    await failed;
    assert.equal(f.activeObservers(), 0);
  } finally {
    f.close();
  }
});

test("injection during a fallback attempt wakes only the current request", async () => {
  const f = fixture();
  try {
    const pending = f.client.ping();
    await f.expire();
    await f.inject();
    assert.equal(f.timers.size, 0);
    await pending;
    assert.equal(f.requests.length, 3);
    assert.notEqual(f.requests[0].id, f.requests[1].id);
    assert.equal(f.requests[1].id, f.requests[2].id);
    assert.equal(f.activeObservers(), 0);
  } finally {
    f.close();
  }
});

test("an already ready runtime answers once and releases readiness observers", async () => {
  const f = fixture();
  try {
    await f.inject();
    assert.equal((await f.client.ping()).compatible, true);
    assert.equal(f.requests.length, 1);
    assert.equal(f.timers.size, 0);
    assert.equal(f.activeObservers(), 0);
  } finally {
    f.close();
  }
});

test("concurrent readiness checks retain separate IDs and clean up independently", async () => {
  const f = fixture();
  try {
    const pending = Promise.all([f.client.ping(), f.client.ping()]);
    await f.inject();
    assert.equal(f.timers.size, 0);
    await pending;
    assert.equal(f.requests.length, 4);
    assert.equal(new Set(f.requests.map(({ id }) => id)).size, 2);
    assert.equal(f.activeObservers(), 0);
  } finally {
    f.close();
  }
});

test("without MutationObserver the existing three bounded attempts still work", async () => {
  const f = fixture({ observe: false });
  try {
    const failed = assert.rejects(f.client.ping(), {
      code: "bridge_no_response",
    });
    for (let i = 0; i < 3; i++) await f.expire();
    await failed;
    assert.equal(f.requests.length, 3);
    assert.equal(f.timers.size, 0);
  } finally {
    f.close();
  }
});

test("readiness changes never resend start, receive, ack or cancel", async () => {
  for (const type of ["start", "receive", "ack", "cancel"]) {
    const f = fixture();
    try {
      const failed = assert.rejects(f.client[type]("a".repeat(32)), {
        code: "bridge_no_response",
      });
      f.mark("ready");
      await settle();
      assert.equal(f.requests.length, 1);
      await f.expire();
      await failed;
      assert.equal(f.activeObservers(), 0);
    } finally {
      f.close();
    }
  }
});
