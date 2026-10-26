import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { Window } from "happy-dom";
import { createLocalUserscriptRoundtrip } from "../dev/userscript-roundtrip.js";
import {
  createUserscriptClient,
  TEST_PENDING,
  TEST_CACHE,
  USERSCRIPT_CACHE,
} from "../js/userscript-client.js";
import { runSchoolppUserscript } from "../js/userscript-runtime.js";
import {
  buildTestUserscript,
  userscriptDevPlugin,
} from "../scripts/userscript-dev-plugin.mjs";
import { createSyntheticUserscriptExport } from "./helpers/userscript-export.js";

const origin = "http://192.168.0.138:5174";
const id = "a".repeat(32);
function exported() {
  const value = JSON.parse(createSyntheticUserscriptExport());
  value.snapshot.import.transport = "userscript-test";
  return JSON.stringify(value);
}
function fixture({ storageFails = false } = {}) {
  const window = new Window({
    url: `${origin}/dev/userscript-sync.html?syncTiming=1`,
  });
  const values = new Map([[USERSCRIPT_CACHE, "synthetic production sentinel"]]);
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => {
      if (storageFails) return false;
      values.set(key, value);
    },
  };
  const calls = [];
  const client = {
    async ping() {
      calls.push("ping");
    },
    async start() {
      calls.push("start");
    },
    async receive() {
      calls.push("receive");
      return { status: "done", export: exported() };
    },
    async ack() {
      calls.push("ack");
    },
    async cancel() {
      calls.push("cancel");
    },
  };
  const flow = createLocalUserscriptRoundtrip({
    windowRef: window,
    storage,
    client,
  });
  const pending = (createdAt = Date.now()) =>
    window.sessionStorage.setItem(
      TEST_PENDING,
      JSON.stringify({ id, createdAt }),
    );
  return {
    window,
    values,
    storage,
    client,
    calls,
    flow,
    pending,
    close: () => window.close(),
  };
}

test("local installed v1 script completes a tab-bound round trip without production storage", async () => {
  const first = fixture(),
    returned = fixture();
  const diary = new Window({ url: "https://diary.e-schools.by" });
  const jobs = new Map();
  let tab = {};
  const gm = {
    getValue: async (key) => structuredClone(jobs.get(key)),
    setValue: async (key, value) => jobs.set(key, structuredClone(value)),
    deleteValue: async (key) => jobs.delete(key),
    getTab: async () => structuredClone(tab),
    saveTab: async (value) => {
      tab = structuredClone(value);
    },
  };
  function scope(window) {
    const state = {
      document: window.document,
      crypto: webcrypto,
      location: { origin: window.location.origin, assign() {}, replace() {} },
      AbortController,
      setTimeout,
      addEventListener: window.addEventListener.bind(window),
      performance: {
        getEntriesByType: () => [
          {
            name: "https://diary.e-schools.by/api/v1/education/diary/schools/s/classes/c/students/u/lessons?week_activity_uuid=w",
          },
        ],
      },
    };
    state.top = state;
    return state;
  }
  try {
    const script = buildTestUserscript([origin]);
    const initialScope = scope(first.window);
    vm.runInNewContext(script, {
      window: initialScope,
      document: first.window.document,
      GM: gm,
      URL,
      TextEncoder,
    });
    Object.assign(first.client, createUserscriptClient(first.window, 100));
    await first.flow.start();
    assert.equal(jobs.size, 1);
    const diaryScope = scope(diary);
    await runSchoolppUserscript(
      diaryScope,
      gm,
      (_scope, complete, options) => {
        assert.equal(options.transport, "userscript-test");
        complete(exported());
      },
      { origins: [origin], version: "0.1.1-test" },
    );
    const returnScope = scope(returned.window);
    vm.runInNewContext(script, {
      window: returnScope,
      document: returned.window.document,
      GM: gm,
      URL,
      TextEncoder,
    });
    for (let i = 0; i < first.window.sessionStorage.length; i++) {
      const key = first.window.sessionStorage.key(i);
      returned.window.sessionStorage.setItem(
        key,
        first.window.sessionStorage.getItem(key),
      );
    }
    // Recreate the controller as a new document would, restoring the timing report.
    const flow = createLocalUserscriptRoundtrip({
      windowRef: returned.window,
      storage: returned.storage,
      client: createUserscriptClient(returned.window, 100),
    });
    await flow.receive();
    assert.equal(jobs.size, 0);
    assert.deepEqual(tab, {});
    assert.equal(returned.window.sessionStorage.getItem(TEST_PENDING), null);
    assert.equal(JSON.parse(returned.values.get(TEST_CACHE)).text, exported());
    assert.equal(
      returned.values.get(USERSCRIPT_CACHE),
      "synthetic production sentinel",
    );
    const report = JSON.parse(flow.report());
    assert.equal(report.outcome, "complete");
    assert.equal(report.cloud, "not_run");
    assert.ok(report.timings.some(({ stage }) => stage === "start_total"));
    assert.ok(report.timings.some(({ stage }) => stage === "collection"));
    assert.doesNotMatch(
      flow.report(),
      /synthetic-student|Тестовый Ученик|schoolpp_job|http:/,
    );
  } finally {
    first.close();
    returned.close();
    diary.close();
  }
});

test("incomplete or production exports cannot replace the local test copy or get acknowledged", async () => {
  for (const bad of ["{}", createSyntheticUserscriptExport()]) {
    const f = fixture();
    try {
      f.pending();
      f.values.set(TEST_CACHE, "previous synthetic test copy");
      f.client.receive = async () => ({ status: "done", export: bad });
      await assert.rejects(f.flow.receive());
      assert.equal(f.values.get(TEST_CACHE), "previous synthetic test copy");
      assert.equal(
        f.values.get(USERSCRIPT_CACHE),
        "synthetic production sentinel",
      );
      assert.equal(f.calls.includes("ack"), false);
      assert.notEqual(f.window.sessionStorage.getItem(TEST_PENDING), null);
      assert.equal(JSON.parse(f.flow.report()).outcome, "failed");
    } finally {
      f.close();
    }
  }
});

test("storage refusal preserves the bound result for a later receive", async () => {
  const f = fixture({ storageFails: true });
  try {
    f.pending();
    await assert.rejects(f.flow.receive(), /сохранить/);
    assert.equal(f.calls.includes("ack"), false);
    assert.notEqual(f.window.sessionStorage.getItem(TEST_PENDING), null);
  } finally {
    f.close();
  }
});

test("ack failure keeps pending and the valid local copy, then permits retry", async () => {
  const f = fixture();
  try {
    f.pending();
    f.client.ack = async () => {
      throw new Error("synthetic private error");
    };
    await assert.rejects(f.flow.receive());
    assert.ok(f.values.has(TEST_CACHE));
    assert.notEqual(f.window.sessionStorage.getItem(TEST_PENDING), null);
    assert.doesNotMatch(f.flow.report(), /private/);
    f.client.ack = async () => {};
    await f.flow.receive();
    assert.equal(f.window.sessionStorage.getItem(TEST_PENDING), null);
    assert.equal(JSON.parse(f.flow.report()).outcome, "complete");
  } finally {
    f.close();
  }
});

test("missing or expired pending cannot request a result", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.flow.receive(), /истекла/);
    f.pending(Date.now() - 180001);
    await assert.rejects(f.flow.receive(), /истекла/);
    assert.deepEqual(f.calls, []);
  } finally {
    f.close();
  }
});

test("a failed readiness check neither starts collection nor creates pending", async () => {
  const f = fixture();
  try {
    f.client.ping = async () => {
      throw new Error("synthetic no script");
    };
    await assert.rejects(f.flow.start());
    assert.deepEqual(f.calls, []);
    assert.equal(f.window.sessionStorage.getItem(TEST_PENDING), null);
  } finally {
    f.close();
  }
});

test("a result rejected by the tab-bound bridge is never imported or acknowledged", async () => {
  const f = fixture();
  try {
    f.pending();
    f.client.receive = async () => {
      throw new Error("synthetic job_unavailable");
    };
    await assert.rejects(f.flow.receive());
    assert.equal(f.values.has(TEST_CACHE), false);
    assert.equal(f.calls.includes("ack"), false);
  } finally {
    f.close();
  }
});

test("only a dev GET return redirects to the fixed local page", () => {
  const plugin = userscriptDevPlugin();
  let middleware;
  plugin.configureServer({
    middlewares: {
      use(handler) {
        middleware = handler;
      },
    },
  });
  const headers = {};
  const response = {
    setHeader(key, value) {
      headers[key] = value;
    },
    end() {},
  };
  middleware(
    {
      method: "GET",
      url: "/userscripts-setup.html?returned=1&next=https://example.com",
    },
    response,
    () => assert.fail("expected local return"),
  );
  assert.equal(response.statusCode, 302);
  assert.equal(
    headers.Location,
    "/dev/userscript-sync.html?returned=1&syncTiming=1",
  );
  assert.equal(headers["Cache-Control"], "no-store");
  for (const request of [
    { url: "/userscripts-setup.html" },
    { url: "/userscripts-setup.html?returned=1", method: "POST" },
  ]) {
    let passed = false;
    middleware(request, {}, () => {
      passed = true;
    });
    assert.equal(passed, true);
  }
});
