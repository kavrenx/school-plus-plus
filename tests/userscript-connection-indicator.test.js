import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createUserscriptConnectionIndicator } from "../js/userscript-connection-indicator.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
function fixture(client, options = {}) {
  const windowRef = new Window({
    url: "http://example.invalid/userscripts-setup.html",
  });
  windowRef.document.body.innerHTML =
    '<div id="connection"><strong data-connection-title></strong><p data-connection-detail></p></div>';
  const element = windowRef.document.getElementById("connection");
  const indicator = createUserscriptConnectionIndicator({
    windowRef,
    element,
    client,
    ...options,
  });
  return {
    windowRef,
    element,
    indicator,
    close() {
      indicator.stop();
      windowRef.close();
    },
  };
}

test("an automatic check shows a red error even when neither userscript executed", async () => {
  const error = Object.assign(new Error("No reply"), {
    diagnostic: { injected: false },
  });
  let reported;
  const page = fixture(
    {
      ping: async () => {
        throw error;
      },
    },
    {
      onError: (value) => {
        reported = value;
      },
    },
  );
  try {
    await page.indicator.check();
    assert.equal(page.element.dataset.state, "error");
    assert.match(page.element.textContent, /Не удалось подтвердить запуск/);
    assert.match(page.element.textContent, /Причина пока не определена/);
    assert.equal(reported, error);
  } finally {
    page.close();
  }
});

test("a successful short probe does not falsely turn the main script status green", async () => {
  const error = Object.assign(new Error("No main reply"), {
    diagnostic: {
      injected: false,
      launchCheck: { state: "executed", originAllowed: true },
    },
  });
  const page = fixture({
    ping: async () => {
      throw error;
    },
  });
  try {
    await page.indicator.check();
    assert.equal(page.element.dataset.state, "error");
    assert.match(
      page.element.textContent,
      /Короткая проверка запустилась, но основной скрипт/,
    );
  } finally {
    page.close();
  }
});

test("late injection recovers a red indicator and overlapping checks share one ping", async () => {
  let ready = false,
    calls = 0;
  const page = fixture({
    ping: async () => {
      calls++;
      if (!ready)
        throw Object.assign(new Error("No reply"), {
          diagnostic: { injected: false },
        });
      return { version: "0.1.1-test" };
    },
  });
  try {
    await Promise.all([page.indicator.check(), page.indicator.check()]);
    assert.equal(calls, 1);
    assert.equal(page.element.dataset.state, "error");
    ready = true;
    page.windowRef.document.documentElement.setAttribute(
      "data-schoolpp-userscript",
      "ready",
    );
    await settle();
    assert.equal(calls, 2);
    assert.equal(page.element.dataset.state, "success");
    assert.match(page.element.textContent, /0\.1\.1-test/);
    page.indicator.stop();
    page.windowRef.document.documentElement.setAttribute(
      "data-schoolpp-userscript",
      "again",
    );
    await settle();
    assert.equal(calls, 2);
  } finally {
    page.close();
  }
});
