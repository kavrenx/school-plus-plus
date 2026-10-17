import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createUserscriptSyncController } from "../js/userscript-sync-controller.js";
import { createUserscriptProgress } from "../js/userscript-progress.js";
import {
  USERSCRIPT_PENDING,
  USERSCRIPT_CACHE,
  saveUserscriptDiary,
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
function fixture({ cacheOwner = "", cloudSaved = true, result } = {}) {
  const windowRef = new Window({
    url: "https://schoolpp.com/userscripts-sync.html",
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
