import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const popupHtml = readFileSync(
  new URL("../extension/popup/popup.html", import.meta.url),
  "utf8",
).replace(/<script[^>]*><\/script>/u, "");
const popupScript = readFileSync(
  new URL("../extension/popup/popup.js", import.meta.url),
  "utf8",
);

async function renderPopup(statusResult, options = {}) {
  const window = new Window({ url: "chrome-extension://schoolpp/popup.html" });
  let currentTime = options.now ?? Date.now();
  const intervalCallbacks = new Map();
  let nextIntervalId = 1;
  if (options.now !== undefined) window.Date.now = () => currentTime;
  window.setInterval = (callback) => {
    const id = nextIntervalId++;
    intervalCallbacks.set(id, callback);
    return id;
  };
  window.clearInterval = (id) => intervalCallbacks.delete(id);
  window.document.write(popupHtml);
  window.chrome = {
    tabs: {
      query: async () => [{ id: 1, url: "https://schoolpp.com/" }],
      create: async () => ({}),
      sendMessage: async () => ({ ok: true }),
    },
    runtime: {
      getURL: (path) => `chrome-extension://schoolpp/${path}`,
      onMessage: { addListener() {} },
      sendMessage: async (message) =>
        message.type === "SCHOOLPP_GET_STATUS"
          ? statusResult
          : { ok: true, settings: message.settings },
    },
  };
  window.eval(popupScript);
  await new Promise((resolve) => setImmediate(resolve));
  return {
    document: window.document,
    window,
    advanceClock(duration) {
      currentTime += duration;
      for (const callback of intervalCallbacks.values()) callback();
    },
  };
}

test("popup asks for the first sync without promising a background check", async (t) => {
  const { document, window } = await renderPopup({
    ok: true,
    stats: { ready: false },
    syncState: {},
    settings: { backgroundSync: true },
  });
  t.after(() => {
    window.eval("stopStatusClock()");
    window.close();
  });
  assert.equal(
    document.getElementById("statusTitle").textContent,
    "Нужна первая синхронизация",
  );
  assert.match(
    document.getElementById("statusText").textContent,
    /После этого они смогут обновляться автоматически/,
  );
});

test("popup keeps prepared data ready while the diary tab is closed", async (t) => {
  const { document, window } = await renderPopup({
    ok: true,
    stats: { ready: true },
    syncState: {
      lastSyncAt: "2026-09-20T10:00:00.000Z",
      nextSyncAt: "2026-09-20T10:15:00.000Z",
    },
    settings: { backgroundSync: true },
  });
  t.after(() => {
    window.eval("stopStatusClock()");
    window.close();
  });
  assert.equal(
    document.getElementById("statusTitle").textContent,
    "Данные готовы",
  );
  assert.equal(
    document.querySelector(".status").classList.contains("is-ready"),
    true,
  );
});

test("popup counts down in seconds during the final minute", async (t) => {
  const now = Date.parse("2026-09-20T10:00:00.000Z");
  const { advanceClock, document, window } = await renderPopup(
    {
      ok: true,
      stats: { ready: true },
      syncState: {
        lastSyncAt: new Date(now - 10_000).toISOString(),
        nextSyncAt: new Date(now + 45_000).toISOString(),
      },
      settings: { backgroundSync: true },
    },
    { now },
  );
  t.after(() => {
    window.eval("stopStatusClock()");
    window.close();
  });
  assert.match(document.getElementById("statusText").textContent, /45 секунд/);
  advanceClock(10_000);
  assert.match(document.getElementById("statusText").textContent, /35 секунд/);
});
