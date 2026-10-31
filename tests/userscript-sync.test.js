import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createUserscriptSyncController } from "../js/userscript-sync-controller.js";
import { createUserscriptProgress } from "../js/userscript-progress.js";
import { runSchoolppUserscript } from "../js/userscript-runtime.js";
import {
  USERSCRIPT_PENDING,
  USERSCRIPT_CACHE,
  saveUserscriptDiary,
  createPublicUserscriptClient,
} from "../js/userscript-client.js";

function sample() {
  const record = (url, body) => ({ url, body, method: "GET", status: 200 });
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
      import: { transport: "userscript", complete: true, expectedWeeks: 1 },
      pages: {
        p: { studentIdentity: { name: "Примеров Тимур", classTitle: "8 Б" } },
      },
      network: {
        year: record("/api/v1/education/diary/school_year", {
          label: "2026/2027",
          start_ts: 1788220800,
          end_ts: 1811721600,
        }),
        lessons: record(
          "/api/v1/education/diary/schools/s/classes/c/students/u/lessons?week_activity_uuid=w",
          [
            {
              date: 1791763200,
              day_of_week: 1,
              slots: [
                {
                  subject_title: "Математика",
                  number: 1,
                  lesson_uuid: "l",
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
function fixture({
  cacheOwner = "",
  cloudSaved = true,
  result,
  timing = false,
} = {}) {
  const windowRef = new Window({
    url: `https://schoolpp.com/userscripts-sync.html${timing ? "?syncTiming=1" : ""}`,
  });
  windowRef.document.body.innerHTML = "<main>Guide fixture</main>";
  const storage = windowRef.localStorage;
  const events = [];
  let currentUser = "owner";
  if (cacheOwner)
    saveUserscriptDiary(storage, cacheOwner, sample(), { cloudPending: false });
  const services = {
    auth: { getCachedUser: async () => ({ id: currentUser }) },
  };
  const client = {
    ping: async () => events.push("ping"),
    start: async (_id, options) => events.push(["start", options]),
    cancel: async () => events.push("cancel"),
    ack: async () => events.push("ack"),
    receive: async () => result || { status: "done", export: sample() },
  };
  const importer = {
    prepare: async () => "owner",
    commit: async (text, userId) => {
      events.push("commit");
      saveUserscriptDiary(storage, userId, text, { cloudPending: !cloudSaved });
      return { userId, cloudSaved };
    },
    retryUpload: async () => false,
  };
  const progress = createUserscriptProgress({
    windowRef,
    wait: async () => {},
  });
  const controller = createUserscriptSyncController({
    windowRef,
    storage,
    services,
    client,
    importer,
    progress,
    wait: async (ms) => events.push(["wait", ms]),
    navigate: (url) => events.push(["navigate", url]),
  });
  return {
    windowRef,
    storage,
    events,
    client,
    importer,
    progress,
    controller,
    setUser: (id) => {
      currentUser = id;
    },
    pending() {
      windowRef.sessionStorage.setItem(
        USERSCRIPT_PENDING,
        JSON.stringify({
          id: "a".repeat(32),
          userId: "owner",
          createdAt: Date.now(),
        }),
      );
    },
    close: () => windowRef.close(),
  };
}

test("sync starts without exposing a guide or allowing a different owner's saved diary", async () => {
  for (const cacheOwner of ["", "owner", "someone-else"]) {
    const f = fixture({ cacheOwner });
    try {
      await f.controller.start();
      assert.equal(f.progress.element.dataset.state, "loading");
      assert.equal(f.windowRef.document.querySelector("main").inert, true);
      assert.deepEqual(
        f.events.find((event) => event[0] === "start"),
        ["start", { allowSkip: cacheOwner === "owner" }],
      );
      assert.equal(
        f.progress.element.querySelector("[role=status]").textContent,
        "Открываем ваш дневник…",
      );
    } finally {
      f.close();
    }
  }
});

test("outdated or unconfirmed script versions open the update guide before auth or collection", async () => {
  for (const code of ["script_update_required", "script_version_unknown"]) {
    const f = fixture({ cacheOwner: "owner" });
    try {
      const before = f.storage.getItem(USERSCRIPT_CACHE);
      f.client.ping = async () => {
        throw Object.assign(new Error("synthetic version error"), { code });
      };
      f.importer.prepare = () =>
        assert.fail("no auth before version compatibility");
      await f.controller.start();
      assert.ok(
        f.events.some(
          (event) =>
            Array.isArray(event) &&
            event[0] === "navigate" &&
            event[1] === "https://schoolpp.com/userscripts-setup.html?update=1",
        ),
      );
      assert.equal(
        f.events.some((event) => Array.isArray(event) && event[0] === "start"),
        false,
      );
      assert.equal(f.storage.getItem(USERSCRIPT_CACHE), before);
    } finally {
      f.close();
    }
  }
});

test("an old script on return opens the update guide without consuming pending or the cached diary", async () => {
  const f = fixture({ cacheOwner: "owner" });
  try {
    f.pending();
    const before = f.storage.getItem(USERSCRIPT_CACHE);
    const pending = f.windowRef.sessionStorage.getItem(USERSCRIPT_PENDING);
    f.client.ping = async () => {
      throw Object.assign(new Error("synthetic old script"), {
        code: "script_update_required",
      });
    };
    f.client.receive = () =>
      assert.fail("no result before version compatibility");
    await f.controller.receive();
    assert.ok(
      f.events.some(
        (event) =>
          Array.isArray(event) &&
          event[0] === "navigate" &&
          event[1].endsWith("?update=1"),
      ),
    );
    assert.equal(f.events.includes("ack"), false);
    assert.equal(f.events.includes("commit"), false);
    assert.equal(f.storage.getItem(USERSCRIPT_CACHE), before);
    assert.equal(
      f.windowRef.sessionStorage.getItem(USERSCRIPT_PENDING),
      pending,
    );
  } finally {
    f.close();
  }
});

test("a missing script becomes an actionable error without starting collection", async () => {
  const f = fixture();
  try {
    f.client.ping = async () => {
      throw new Error("Включите Userscripts");
    };
    await f.controller.start();
    assert.equal(f.progress.element.dataset.state, "error");
    assert.match(f.progress.element.textContent, /Включите Userscripts/);
    assert.match(f.progress.element.textContent, /Вернуться назад/);
    assert.equal(
      f.events.some((event) => event[0] === "start"),
      false,
    );
  } finally {
    f.close();
  }
});

test("a successful return saves and acknowledges before showing a tick and opening the diary", async () => {
  const f = fixture();
  try {
    f.pending();
    await f.controller.receive();
    assert.equal(f.progress.element.dataset.state, "success");
    assert.match(f.progress.element.textContent, /Готово!/);
    assert.ok(f.events.indexOf("commit") < f.events.indexOf("ack"));
    const last = f.events.at(-1);
    assert.deepEqual(last, ["navigate", "https://schoolpp.com/#diary"]);
    assert.deepEqual(f.events.at(-2), ["wait", 850]);
    assert.equal(f.windowRef.sessionStorage.getItem(USERSCRIPT_PENDING), null);
  } finally {
    f.close();
  }
});

test("a failed collection preserves the old diary and never claims success", async () => {
  const f = fixture({
    cacheOwner: "owner",
    result: { status: "error", code: "collection_failed" },
  });
  try {
    const before = f.storage.getItem(USERSCRIPT_CACHE);
    f.pending();
    await f.controller.receive();
    assert.equal(f.progress.element.dataset.state, "error");
    assert.equal(f.storage.getItem(USERSCRIPT_CACHE), before);
    assert.equal(f.events.includes("commit"), false);
    assert.equal(
      f.events.some((event) => event[0] === "navigate"),
      false,
    );
  } finally {
    f.close();
  }
});

test("skip opens only a saved diary in the requesting session and does not import", async () => {
  for (const cacheOwner of ["owner", "someone-else", ""]) {
    const f = fixture({ cacheOwner, result: { status: "skipped" } });
    try {
      f.pending();
      await f.controller.receive();
      assert.equal(f.events.includes("commit"), false);
      assert.equal(
        f.events.some((event) => event[0] === "navigate"),
        cacheOwner === "owner",
      );
      if (cacheOwner !== "owner")
        assert.equal(f.progress.element.dataset.state, "error");
    } finally {
      f.close();
    }
  }
});

test("a cloud failure offers retry or the local diary without a green success state", async () => {
  const f = fixture({ cloudSaved: false });
  try {
    f.pending();
    await f.controller.receive();
    assert.equal(f.progress.element.dataset.state, "error");
    assert.match(f.progress.element.textContent, /Повторить сохранение/);
    assert.match(f.progress.element.textContent, /Открыть без синхронизации/);
    assert.equal(
      f.events.some((event) => event[0] === "navigate"),
      false,
    );
    assert.ok(f.storage.getItem(USERSCRIPT_CACHE));
  } finally {
    f.close();
  }
});

test("a session change during the success animation blocks opening the previous owner's diary", async () => {
  const f = fixture();
  try {
    f.pending();
    f.client.ack = async () => {
      f.setUser("someone-else");
    };
    await f.controller.receive();
    assert.equal(f.progress.element.dataset.state, "error");
    assert.equal(
      f.events.some((event) => event[0] === "navigate"),
      false,
    );
  } finally {
    f.close();
  }
});

test("return waits for readiness before requesting the tab-bound result", async () => {
  const f = fixture();
  let resolvePing, resolveReceive;
  const started = [];
  f.client.ping = () => {
    started.push("ping");
    return new Promise((resolve) => {
      resolvePing = resolve;
    });
  };
  f.client.receive = () => {
    started.push("receive");
    return new Promise((resolve) => {
      resolveReceive = resolve;
    });
  };
  try {
    f.pending();
    const receiving = f.controller.receive();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, ["ping"]);
    assert.equal(f.events.includes("commit"), false);
    resolvePing();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, ["ping", "receive"]);
    assert.equal(f.events.includes("commit"), false);
    resolveReceive({ status: "done", export: sample() });
    await receiving;
    assert.equal(f.events.includes("commit"), true);
  } finally {
    f.close();
  }
});

test("a late Userscripts injection retries readiness without losing the returned export", async () => {
  const f = fixture({ cacheOwner: "owner" });
  const id = "a".repeat(32);
  const key = `schoolpp_job:${id}`;
  const result = sample();
  const jobs = new Map([
    [
      key,
      {
        id,
        origin: f.windowRef.location.origin,
        createdAt: Date.now(),
        status: "done",
        export: result,
      },
    ],
  ]);
  let tab = { schoolppSync: { id } };
  const gm = {
    getValue: async (name) => structuredClone(jobs.get(name)),
    setValue: async (name, value) => jobs.set(name, structuredClone(value)),
    deleteValue: async (name) => jobs.delete(name),
    getTab: async () => structuredClone(tab),
    saveTab: async (value) => {
      tab = structuredClone(value);
    },
  };
  const scope = {
    document: f.windowRef.document,
    location: { origin: f.windowRef.location.origin },
  };
  scope.top = scope;
  const requests = [];
  let injection;
  const observe = (event) => {
    const message = JSON.parse(event.detail);
    requests.push(message.type);
    if (requests.length === 1) {
      assert.equal(message.type, "ping");
      // The first request is sent before document-idle injection, as on Safari.
      // Install the real runtime only after that request has been dispatched.
      injection = Promise.resolve().then(() =>
        runSchoolppUserscript(scope, gm, null, {
          origins: [scope.location.origin],
          version: "1.0.1",
          transport: "userscript",
        }),
      );
    }
  };
  Object.assign(f.client, createPublicUserscriptClient(f.windowRef, 20));
  f.windowRef.document.addEventListener(
    "schoolpp-userscript-request-v2",
    observe,
  );
  try {
    f.pending();
    await f.controller.receive();
    await injection;
    assert.equal(f.progress.element.dataset.state, "success");
    assert.deepEqual(requests, ["ping", "ping", "receive", "ack"]);
    assert.ok(f.events.includes("commit"));
    assert.equal(jobs.has(key), false);
    assert.equal(f.windowRef.sessionStorage.getItem(USERSCRIPT_PENDING), null);
    assert.equal(JSON.parse(f.storage.getItem(USERSCRIPT_CACHE)).text, result);
  } finally {
    f.windowRef.document.removeEventListener(
      "schoolpp-userscript-request-v2",
      observe,
    );
    f.close();
  }
});

test("a received export cannot bypass a failed compatibility check", async () => {
  const f = fixture();
  let received = false;
  f.client.receive = async () => {
    received = true;
    return { status: "done", export: sample() };
  };
  f.client.ping = async () => {
    throw new Error("Unsupported Userscripts");
  };
  try {
    f.pending();
    await f.controller.receive();
    assert.equal(f.progress.element.dataset.state, "error");
    assert.equal(f.events.includes("commit"), false);
    assert.equal(f.events.includes("ack"), false);
    assert.equal(received, false);
  } finally {
    f.close();
  }
});

test("opt-in timings can be copied without diary data and opening still rechecks the owner", async () => {
  const f = fixture({ timing: true });
  let copied;
  Object.defineProperty(f.windowRef, "isSecureContext", { value: true });
  Object.defineProperty(f.windowRef.navigator, "clipboard", {
    value: {
      writeText: async (text) => {
        copied = text;
      },
    },
  });
  try {
    f.pending();
    await f.controller.receive();
    assert.equal(f.progress.element.dataset.state, "success");
    assert.equal(
      f.events.some((event) => event[0] === "navigate"),
      false,
    );
    const buttons = () => [...f.progress.element.querySelectorAll("button")];
    buttons()
      .find((button) => button.textContent === "Скопировать замеры")
      .click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(JSON.parse(copied).outcome, "complete");
    assert.doesNotMatch(
      copied,
      /owner|Примеров|Математика|snapshot|export"|https:/,
    );
    assert.match(copied, /return_total/);
    f.setUser("another-user");
    buttons()
      .find((button) => button.textContent === "Открыть дневник")
      .click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.progress.element.dataset.state, "error");
    assert.equal(
      f.events.some((event) => event[0] === "navigate"),
      false,
    );
  } finally {
    f.close();
  }
});

test("diagnostic success also rejects a session changed before acknowledgement", async () => {
  const f = fixture({ timing: true });
  try {
    f.pending();
    f.client.ack = async () => f.setUser("another-user");
    await f.controller.receive();
    assert.equal(f.progress.element.dataset.state, "error");
  } finally {
    f.close();
  }
});

test("sync pins the server revision before opening the source and restores it on return", async () => {
  const f = fixture();
  const context = {
    version: 2,
    revision: "00000000-0000-4000-8000-000000000001",
  };
  try {
    f.importer.getWriteContext = async (owner) => {
      assert.equal(owner, "owner");
      f.events.push("revision");
      return context;
    };
    const commit = f.importer.commit;
    f.importer.commit = async (text, owner, options) => {
      assert.deepEqual(options.writeContext, context);
      return commit(text, owner);
    };
    await f.controller.start();
    const pending = JSON.parse(
      f.windowRef.sessionStorage.getItem(USERSCRIPT_PENDING),
    );
    assert.deepEqual(pending.writeContext, context);
    assert.ok(
      f.events.indexOf("revision") <
        f.events.findIndex((event) => event[0] === "start"),
    );
    await f.controller.receive();
    assert.equal(f.progress.element.dataset.state, "success");
    assert.equal(f.windowRef.sessionStorage.getItem(USERSCRIPT_PENDING), null);
  } finally {
    f.close();
  }
});

test("a failed revision check does not open the source or discard the cached diary", async () => {
  const f = fixture({ cacheOwner: "owner" });
  try {
    const cached = f.storage.getItem(USERSCRIPT_CACHE);
    f.importer.getWriteContext = async () => {
      throw new Error("synthetic offline");
    };
    await f.controller.start();
    assert.equal(f.progress.element.dataset.state, "error");
    assert.equal(
      f.events.some((event) => event[0] === "start"),
      false,
    );
    assert.equal(f.storage.getItem(USERSCRIPT_CACHE), cached);
  } finally {
    f.close();
  }
});

test("a conflict offers a fresh sync and local diary, without acknowledgement or blind upload retry", async () => {
  const f = fixture({ cacheOwner: "owner" });
  try {
    f.pending();
    f.importer.commit = async (text, owner) => {
      saveUserscriptDiary(f.storage, owner, text);
      throw Object.assign(new Error("Обновлено на другом устройстве"), {
        code: "diary_snapshot_conflict",
      });
    };
    await f.controller.receive();
    assert.equal(f.progress.element.dataset.state, "error");
    const labels = [...f.progress.element.querySelectorAll("button")].map(
      (button) => button.textContent,
    );
    assert.ok(labels.includes("Синхронизировать заново"));
    assert.ok(labels.includes("Открыть без синхронизации"));
    assert.equal(labels.includes("Повторить сохранение"), false);
    assert.equal(f.events.includes("ack"), false);
    assert.ok(f.windowRef.sessionStorage.getItem(USERSCRIPT_PENDING));
  } finally {
    f.close();
  }
});
