import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { Window } from "happy-dom";
import { loadConfigFromFile } from "vite";
import { runSchoolppUserscript } from "../js/userscript-runtime.js";
import {
  createUserscriptClient,
  createPublicUserscriptClient,
  readUserscriptCache,
  saveUserscriptCache,
  shouldRefreshUserscript,
  TEST_ATTEMPT,
} from "../js/userscript-client.js";
import {
  buildTestUserscript,
  buildLaunchCheckUserscript,
  buildPublicUserscript,
  userscriptOrigins,
  userscriptDevPlugin,
} from "../scripts/userscript-dev-plugin.mjs";

const origin = "http://192.168.0.138:5174";
const config = { origins: [origin], version: "0.1.1-test" };
const id = "a".repeat(32);
const tick = () => new Promise((resolve) => setImmediate(resolve));
function dispatchBridge(doc, direction, message, target = doc) {
  const event = doc.createEvent("CustomEvent");
  event.initCustomEvent(
    `schoolpp-userscript-${direction}-v2`,
    true,
    false,
    JSON.stringify(message),
  );
  target.dispatchEvent(event);
}
function manager() {
  const values = new Map();
  let state = {};
  return {
    values,
    gm: {
      getValue: async (key) => structuredClone(values.get(key)),
      setValue: async (key, value) => values.set(key, structuredClone(value)),
      deleteValue: async (key) => values.delete(key),
      listValues: async () => [...values.keys()],
      getTab: async () => structuredClone(state),
      saveTab: async (value) => {
        state = structuredClone(value);
      },
    },
  };
}
function browser(url = origin) {
  const window = new Window({ url });
  window.document.body.innerHTML = "<main>synthetic fixture</main>";
  const listeners = new Map(),
    assigned = [],
    replaced = [],
    shadows = [];
  const createElement = window.document.createElement.bind(window.document);
  window.document.createElement = (...args) => {
    const element = createElement(...args);
    const attachShadow = element.attachShadow.bind(element);
    element.attachShadow = (options) => {
      const shadow = attachShadow(options);
      shadows.push(shadow);
      return shadow;
    };
    return element;
  };
  const scope = {
    document: window.document,
    crypto: webcrypto,
    AbortController,
    location: {
      origin: url,
      assign: (value) => assigned.push(value),
      replace: (value) => replaced.push(value),
    },
    performance: {
      getEntriesByType: () => [
        {
          name: "https://diary.e-schools.by/api/v1/education/diary/schools/s/classes/c/students/u/lessons?week_activity_uuid=w",
          startTime: 1,
        },
      ],
    },
    setTimeout,
    clearTimeout,
    addEventListener: (name, handler) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    removeEventListener: (name, handler) =>
      listeners.get(name)?.delete(handler),
    emit: (name, event) => {
      for (const handler of [...(listeners.get(name) || [])]) handler(event);
    },
    postMessage: (data, target) => {
      assert.equal(target, url);
      queueMicrotask(() =>
        scope.emit("message", { source: scope, origin: url, data }),
      );
    },
  };
  scope.top = scope;
  return { scope, assigned, replaced, shadows, close: () => window.close() };
}
function sampleExport() {
  const date = Date.parse("2026-10-12T00:00:00Z") / 1000;
  const record = (url, body) => ({ url, method: "GET", status: 200, body });
  return JSON.stringify({
    type: "schoolpp-ios-export-v1",
    report: {
      type: "schoolpp-ios-collection-v1",
      result: "collection_ready",
      checks: {
        collection: {
          expectedWeeks: 1,
          loadedWeeks: 1,
          failedWeeks: 0,
          lessons: 1,
          marks: 1,
        },
      },
    },
    snapshot: {
      source: "e-schools.by",
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      import: {
        transport: "userscript-test",
        complete: true,
        expectedWeeks: 1,
      },
      pages: {
        p: { studentIdentity: { name: "Примеров Ученик", classTitle: "8 Б" } },
      },
      network: {
        year: record("/api/v1/education/diary/school_year", {
          label: "2026/2027",
          start_ts: date - 40 * 86400,
          end_ts: date + 300 * 86400,
        }),
        lessons: record(
          "/api/v1/education/diary/schools/s/classes/c/students/u/lessons?week_activity_uuid=w",
          [
            {
              date,
              day_of_week: 1,
              slots: [
                {
                  subject_title: "Математика",
                  number: 1,
                  lesson_uuid: "lesson",
                  lesson_mark: { mark: "9" },
                },
              ],
            },
          ],
        ),
      },
    },
  });
}

test("same-tab round trip transfers the collection without clipboard and clears it after acknowledgement", async () => {
  const m = manager(),
    first = browser();
  const diary = browser("https://diary.e-schools.by"),
    returned = browser();
  try {
    await runSchoolppUserscript(
      first.scope,
      m.gm,
      () => assert.fail("school page must not collect"),
      config,
    );
    const client = createUserscriptClient(first.scope, 100);
    assert.equal((await client.ping()).compatible, true);
    await client.start(id);
    assert.deepEqual(first.assigned, ["https://diary.e-schools.by/"]);
    await runSchoolppUserscript(
      diary.scope,
      m.gm,
      (_scope, completion, options) => {
        assert.equal(options.transport, "userscript-test");
        assert.equal(options.timeoutMs, 45000);
        completion(sampleExport());
      },
      config,
    );
    assert.deepEqual(diary.replaced, [
      origin + "/userscripts-setup.html?returned=1",
    ]);
    await runSchoolppUserscript(returned.scope, m.gm, () => {}, config);
    const second = createUserscriptClient(returned.scope, 100);
    const result = await second.receive(id);
    assert.equal(result.status, "done");
    const saved = new Map();
    const storage = {
      getItem: (key) => saved.get(key),
      setItem: (key, value) => saved.set(key, value),
    };
    saveUserscriptCache(storage, result.export, 1000);
    assert.equal(readUserscriptCache(storage, 1001).summary.recognizedMarks, 1);
    await second.ack(id);
    assert.equal(m.values.size, 0);
    assert.equal((await m.gm.getTab()).schoolppTest, undefined);
  } finally {
    first.close();
    diary.close();
    returned.close();
  }
});

test("ordinary diary visits do not collect and a foreign tab cannot receive a result", async () => {
  const m = manager(),
    diary = browser("https://diary.e-schools.by"),
    page = browser();
  try {
    await runSchoolppUserscript(
      diary.scope,
      m.gm,
      () => assert.fail("no active request"),
      config,
    );
    assert.equal(diary.shadows.length, 0);
    m.values.set(`schoolpp_test_job:${id}`, {
      id,
      origin,
      createdAt: Date.now(),
      status: "done",
      export: "private",
    });
    await runSchoolppUserscript(page.scope, m.gm, () => {}, config);
    await assert.rejects(
      createUserscriptClient(page.scope, 100).receive(id),
      (error) => error.code === "job_unavailable",
    );
    assert.equal(m.values.get(`schoolpp_test_job:${id}`).export, "private");
  } finally {
    diary.close();
    page.close();
  }
});

test("foreign origin messages and repeated starts cannot create unintended runs", async () => {
  const m = manager(),
    page = browser();
  try {
    await runSchoolppUserscript(page.scope, m.gm, () => {}, config);
    dispatchBridge(page.scope.document, "request", {
      origin: "https://example.com",
      source: "schoolpp-userscript-web-v1",
      type: "start",
      id,
    });
    // Bubbling messages from another DOM target are not a document request.
    dispatchBridge(
      page.scope.document,
      "request",
      {
        origin,
        source: "schoolpp-userscript-web-v1",
        type: "start",
        id,
      },
      page.scope.document.body,
    );
    await tick();
    assert.equal(m.values.size, 0);
    const client = createUserscriptClient(page.scope, 100);
    await client.start(id);
    await assert.rejects(
      client.start("b".repeat(32)),
      (error) => error.code === "busy",
    );
    assert.equal(page.assigned.length, 1);
    await client.cancel(id);
    assert.equal(m.values.size, 0);
  } finally {
    page.close();
  }
});

test("cancelling a running collection cannot turn a late result into success", async () => {
  const m = manager(),
    page = browser(),
    diary = browser("https://diary.e-schools.by");
  let finishCollection;
  try {
    await runSchoolppUserscript(page.scope, m.gm, () => {}, config);
    await createUserscriptClient(page.scope, 100).start(id);
    const running = runSchoolppUserscript(
      diary.scope,
      m.gm,
      (_scope, completion, options) => {
        finishCollection = completion;
        options.signal.addEventListener(
          "abort",
          () => completion(JSON.stringify({ report: { result: "cancelled" } })),
          { once: true },
        );
      },
      config,
    );
    while (!finishCollection) await tick();
    diary.shadows[0].querySelector("[data-return]").click();
    await running;
    await tick();
    finishCollection(sampleExport());
    assert.equal(m.values.get(`schoolpp_test_job:${id}`).status, "error");
    assert.equal(m.values.get(`schoolpp_test_job:${id}`).code, "cancelled");
    assert.equal(m.values.get(`schoolpp_test_job:${id}`).export, undefined);
    assert.equal(diary.replaced.length, 1);
  } finally {
    page.close();
    diary.close();
  }
});

test("expired sign-in waits for login rather than retrying its own failed requests in a loop", async () => {
  const m = manager(),
    page = browser(),
    diary = browser("https://diary.e-schools.by");
  let calls = 0,
    stamp = 1;
  diary.scope.performance.getEntriesByType = () => [
    {
      name: "https://diary.e-schools.by/api/v1/education/diary/schools/s/classes/c/students/u/lessons?week_activity_uuid=w",
      startTime: stamp,
    },
  ];
  try {
    await runSchoolppUserscript(page.scope, m.gm, () => {}, config);
    await createUserscriptClient(page.scope, 100).start(id);
    const running = runSchoolppUserscript(
      diary.scope,
      m.gm,
      (_scope, completion) => {
        calls++;
        stamp++;
        completion(
          JSON.stringify({
            report: { result: "sign_in_or_session_unavailable" },
          }),
        );
      },
      config,
    );
    while (!calls) await tick();
    await new Promise((resolve) => setTimeout(resolve, 550));
    assert.equal(calls, 1);
    diary.shadows[0].querySelector("[data-return]").click();
    await running;
  } finally {
    page.close();
    diary.close();
  }
});

test("test installer grants only the necessary APIs and enforces exact configured origins", () => {
  const origins = userscriptOrigins(5174, origin);
  const code = buildTestUserscript(origins);
  assert.match(code, /@grant GM\.getTab/);
  assert.doesNotMatch(
    code,
    /@match \*|@grant GM\.xmlHttpRequest|sb_publishable|supabase_session/,
  );
  assert.ok(!code.includes("@match https://schoolpp.com"));
  assert.throws(() => userscriptOrigins(5174, "https://example.com"));
  assert.throws(() =>
    userscriptOrigins(5174, "http://192.168.evil.example:5174"),
  );
  assert.throws(() => userscriptOrigins(5174, origin + "/wrong"));
  assert.throws(() => userscriptOrigins(5174, "http://192.168.0.138:9999"));
  assert.doesNotThrow(() => new vm.Script(code));
  let middleware;
  const plugin = userscriptDevPlugin();
  plugin.configResolved({
    server: { port: 5174 },
    env: { VITE_PAIRING_ORIGIN: origin },
  });
  plugin.configureServer({
    middlewares: {
      use: (handler) => {
        middleware = handler;
      },
    },
  });
  const headers = {};
  let body;
  middleware(
    { url: "/schoolpp-test.user.js" },
    {
      setHeader: (key, value) => {
        headers[key] = value;
      },
      end: (value) => {
        body = value;
      },
    },
    () => assert.fail("installer must be served"),
  );
  assert.match(headers["Content-Type"], /text\/plain/);
  assert.equal(body, code);
});

test("refresh uses a freshness window and cooldown; invalid collections cannot replace a valid cache", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  saveUserscriptCache(storage, sampleExport(), 1000000);
  const previous = [...values];
  assert.throws(() => saveUserscriptCache(storage, "{}"));
  assert.deepEqual([...values], previous);
  const cache = readUserscriptCache(storage, 1000001);
  assert.equal(shouldRefreshUserscript(cache, storage, 1000001), false);
  assert.equal(shouldRefreshUserscript(cache, storage, 1700000), true);
  storage.setItem(TEST_ATTEMPT, "1699000");
  assert.equal(shouldRefreshUserscript(cache, storage, 1700000), false);
  assert.equal(readUserscriptCache(storage, 1000000 + 8 * 86400000), null);
});

test("installed script source runs independently in a userscript context", async () => {
  const m = manager(),
    page = browser();
  try {
    vm.runInNewContext(buildTestUserscript([origin]), {
      window: page.scope,
      GM: m.gm,
      URL,
      TextEncoder,
    });
    const ready = await createUserscriptClient(page.scope, 100).ping();
    assert.equal(ready.compatible, true);
    assert.equal(ready.version, "0.1.1-test");
  } finally {
    page.close();
  }
});

test("isolated content and page worlds communicate without window identity or postMessage", async () => {
  const page = browser(),
    m = manager();
  const isolated = {
    ...page.scope,
    postMessage: () => assert.fail("no window bridge"),
  };
  isolated.top = isolated;
  page.scope.postMessage = () => assert.fail("no window bridge");
  try {
    await runSchoolppUserscript(isolated, m.gm, () => {}, config);
    const client = createUserscriptClient(page.scope, 100);
    assert.equal((await client.ping()).version, config.version);
    await client.start(id);
    assert.equal(page.assigned.length, 1);
    await client.cancel(id);
    assert.equal(m.values.size, 0);
  } finally {
    page.close();
  }
});

test("missing, failed and incompatible injections have distinct safe diagnostics", async () => {
  const page = browser();
  try {
    const client = createUserscriptClient(page.scope, 5);
    await assert.rejects(client.ping(), (error) => {
      assert.equal(error.code, "bridge_no_response");
      assert.deepEqual(error.diagnostic, {
        transport: "dom-v2",
        injected: false,
      });
      assert.doesNotMatch(error.message, /скрипт не установлен/i);
      return true;
    });
    page.scope.document.documentElement.setAttribute(
      "data-schoolpp-userscript",
      JSON.stringify({
        version: config.version,
        state: "startup_failed",
        private: "must not leak",
      }),
    );
    await assert.rejects(client.ping(), (error) => {
      assert.equal(error.code, "startup_failed");
      assert.equal(error.diagnostic.state, "startup_failed");
      assert.equal(
        JSON.stringify(error.diagnostic).includes("must not leak"),
        false,
      );
      return true;
    });
    await runSchoolppUserscript(page.scope, null, () => {}, config);
    await assert.rejects(
      client.ping(),
      (error) => error.code === "unsupported_manager",
    );
  } finally {
    page.close();
  }
});

test("foreign origin and mismatched response IDs cannot impersonate an installed script", async () => {
  const page = browser(),
    doc = page.scope.document;
  doc.addEventListener("schoolpp-userscript-request-v2", (event) => {
    const request = JSON.parse(event.detail);
    dispatchBridge(doc, "response", {
      source: "schoolpp-userscript-v1",
      origin: "https://example.com",
      id: request.id,
      type: "ready",
      compatible: true,
    });
    dispatchBridge(doc, "response", {
      source: "schoolpp-userscript-v1",
      origin,
      id: "wrong",
      type: "ready",
      compatible: true,
    });
  });
  try {
    await assert.rejects(
      createUserscriptClient(page.scope, 5).ping(),
      (error) => error.code === "bridge_no_response",
    );
  } finally {
    page.close();
  }
});

test("Vite's bundled dev configuration produces a standalone working installer", async () => {
  // Config bundling transforms imported functions before toString() is used.
  const loaded = await loadConfigFromFile({
    command: "serve",
    mode: "development",
  });
  const plugin = loaded.config.plugins.find(
    (entry) => entry.name === "schoolpp-userscript",
  );
  plugin.configResolved({
    server: { port: 5174 },
    env: { VITE_PAIRING_ORIGIN: origin },
  });
  let middleware, source;
  plugin.configureServer({
    middlewares: {
      use(handler) {
        middleware = handler;
      },
    },
  });
  middleware(
    { url: "/schoolpp.user.js" },
    {
      setHeader() {},
      end(value) {
        source = value;
      },
    },
    () => assert.fail("installer expected"),
  );
  const page = browser("https://schoolpp.com"),
    m = manager();
  try {
    assert.doesNotMatch(source, /127\.0\.0\.1|localhost|192\.168\./);
    vm.runInNewContext(source, {
      window: page.scope,
      document: page.scope.document,
      GM: m.gm,
      URL,
      TextEncoder,
    });
    assert.equal(
      (await createPublicUserscriptClient(page.scope, 100).ping()).version,
      "1.0.1",
    );
  } finally {
    page.close();
  }
});

test("the standalone launch check is visible without GM, messages, storage or collection", async () => {
  const page = browser();
  const doc = page.scope.document;
  doc.defaultView.history.replaceState(null, "", "/userscripts-setup.html");
  doc.body.innerHTML = '<main><p id="userscriptStatus">Waiting</p></main>';
  const code = buildLaunchCheckUserscript([origin]);
  assert.match(code, /@grant none/);
  assert.match(code, /@run-at document-end/);
  assert.ok(!code.includes("diary.e-schools.by"));
  assert.ok(!code.includes("@match *"));
  page.scope.postMessage = () => assert.fail("launch check needs no bridge");
  try {
    vm.runInNewContext(code, { window: page.scope });
    vm.runInNewContext(code, { window: page.scope });
    assert.equal(doc.querySelectorAll("#schoolpp-launch-check").length, 1);
    assert.match(
      doc.getElementById("schoolpp-launch-check").textContent,
      /Userscripts выполнил скрипт/,
    );
    const client = createUserscriptClient(page.scope, 5);
    await assert.rejects(client.ping(), (error) => {
      assert.equal(error.diagnostic.injected, false);
      assert.equal(error.diagnostic.launchCheck.version, "1.0.0-launch");
      assert.equal(error.diagnostic.launchCheck.originAllowed, true);
      assert.equal(error.diagnostic.launchCheck.topWindowMatches, true);
      return true;
    });
    await runSchoolppUserscript(
      page.scope,
      manager().gm,
      () => assert.fail("must not collect"),
      config,
    );
    assert.equal((await client.ping()).compatible, true);
  } finally {
    page.close();
  }
});

test("launch diagnostics expose an origin or window mismatch instead of silently returning", async () => {
  const page = browser("http://192.168.0.138:9999"),
    doc = page.scope.document;
  page.scope.top = {};
  try {
    vm.runInNewContext(buildLaunchCheckUserscript([origin]), {
      window: page.scope,
    });
    const marker = JSON.parse(
      doc.documentElement.getAttribute("data-schoolpp-userscript-launch"),
    );
    assert.equal(marker.originAllowed, false);
    assert.equal(marker.topWindowMatches, false);
    assert.equal(doc.getElementById("schoolpp-launch-check"), null);
    marker.secret = "do not expose arbitrary marker content";
    doc.documentElement.setAttribute(
      "data-schoolpp-userscript-launch",
      JSON.stringify(marker),
    );
    await assert.rejects(
      createUserscriptClient(page.scope, 5).ping(),
      (error) => {
        assert.equal(error.diagnostic.launchCheck.originAllowed, false);
        assert.equal(error.diagnostic.launchCheck.topWindowMatches, false);
        assert.equal(
          JSON.stringify(error.diagnostic).includes(marker.secret),
          false,
        );
        return true;
      },
    );
  } finally {
    page.close();
  }
});

test("the launch check installer uses the configured local host and is served only by the dev plugin", () => {
  const plugin = userscriptDevPlugin();
  assert.equal(plugin.apply, "serve");
  plugin.configResolved({
    server: { port: 5174 },
    env: { VITE_PAIRING_ORIGIN: origin },
  });
  let middleware, source;
  plugin.configureServer({
    middlewares: {
      use(handler) {
        middleware = handler;
      },
    },
  });
  middleware(
    { url: "/schoolpp-launch-check.user.js" },
    {
      setHeader() {},
      end(value) {
        source = value;
      },
    },
    () => assert.fail("installer expected"),
  );
  assert.equal(
    source,
    buildLaunchCheckUserscript(userscriptOrigins(5174, origin)),
  );
  assert.match(source, /@match http:\/\/192\.168\.0\.138\/\*/);
  assert.doesNotMatch(source, /fetch\(|getValue\(|localStorage|sessionStorage/);
});

test("public and old test scripts cannot consume each other's jobs or responses", async () => {
  const m = manager(),
    page = browser(),
    diary = browser("https://diary.e-schools.by"),
    returned = browser();
  const production = { ...config, version: "1.0.1", transport: "userscript" };
  try {
    await runSchoolppUserscript(page.scope, m.gm, () => {}, config);
    await runSchoolppUserscript(page.scope, m.gm, () => {}, production);
    const client = createPublicUserscriptClient(page.scope, 100);
    assert.equal((await client.ping()).version, "1.0.1");
    await client.start(id);
    assert.equal(m.values.has(`schoolpp_job:${id}`), true);
    assert.equal(m.values.has(`schoolpp_test_job:${id}`), false);
    await runSchoolppUserscript(
      diary.scope,
      m.gm,
      (_scope, completion, options) => {
        assert.equal(options.transport, "userscript");
        const exported = JSON.parse(sampleExport());
        exported.snapshot.import.transport = "userscript";
        completion(JSON.stringify(exported));
      },
      production,
    );
    await runSchoolppUserscript(returned.scope, m.gm, () => {}, production);
    const result = await createPublicUserscriptClient(
      returned.scope,
      100,
    ).receive(id);
    assert.equal(result.status, "done");
    assert.equal(
      JSON.parse(result.export).snapshot.import.transport,
      "userscript",
    );
    await createPublicUserscriptClient(returned.scope, 100).ack(id);
    assert.equal(m.values.size, 0);
  } finally {
    page.close();
    diary.close();
    returned.close();
  }
});

test("a later sync can return to its saved diary without accepting late collection results", async () => {
  const m = manager(),
    page = browser(),
    diary = browser("https://diary.e-schools.by");
  const production = { ...config, transport: "userscript" };
  let finishCollection;
  try {
    await runSchoolppUserscript(page.scope, m.gm, () => {}, production);
    await createPublicUserscriptClient(page.scope, 100).start(id, {
      allowSkip: true,
    });
    const running = runSchoolppUserscript(
      diary.scope,
      m.gm,
      (_scope, completion, options) => {
        finishCollection = completion;
        options.signal.addEventListener(
          "abort",
          () => completion(JSON.stringify({ report: { result: "cancelled" } })),
          { once: true },
        );
      },
      production,
    );
    while (!finishCollection) await tick();
    const skip = diary.shadows[0].querySelector("[data-skip]");
    assert.equal(skip.hidden, false);
    skip.click();
    await running;
    await tick();
    finishCollection(sampleExport());
    assert.equal(m.values.get(`schoolpp_job:${id}`).status, "skipped");
    assert.equal(m.values.get(`schoolpp_job:${id}`).export, undefined);
    assert.deepEqual(diary.replaced, [
      origin + "/userscripts-sync.html?returned=1",
    ]);
  } finally {
    page.close();
    diary.close();
  }
});

test("a first sync never offers opening a nonexistent saved diary", async () => {
  const m = manager(),
    page = browser(),
    diary = browser("https://diary.e-schools.by");
  const production = { ...config, transport: "userscript" };
  try {
    await runSchoolppUserscript(page.scope, m.gm, () => {}, production);
    await createPublicUserscriptClient(page.scope, 100).start(id);
    await runSchoolppUserscript(
      diary.scope,
      m.gm,
      (_scope, done) => done(sampleExport()),
      production,
    );
    assert.equal(diary.shadows[0].querySelector("[data-skip]").hidden, true);
  } finally {
    page.close();
    diary.close();
  }
});

test("the published installer is limited to School++ and e-schools and contains no local origins", () => {
  const code = buildPublicUserscript();
  assert.match(code, /@name School\+\+ — синхронизация дневника/);
  assert.match(code, /@version 1\.0\.1/);
  assert.match(code, /@match https:\/\/schoolpp\.com\/\*/);
  assert.doesNotMatch(
    code,
    /@match http:|192\.168\.|@grant GM\.xmlHttpRequest|sb_publishable/,
  );
  assert.doesNotThrow(() => new vm.Script(code));
});
