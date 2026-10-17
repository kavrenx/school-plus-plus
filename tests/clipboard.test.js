import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { bindCopyButton, writeClipboardText } from "../js/clipboard.js";

const settle = () => new Promise((resolve) => setImmediate(resolve));
function fixture({ secure = false, clipboard } = {}) {
  const window = new Window({
    url: secure ? "https://example.invalid/" : "http://192.168.0.138:5174/",
  });
  Object.defineProperty(window, "isSecureContext", { value: secure });
  Object.defineProperty(window.navigator, "clipboard", { value: clipboard });
  window.document.body.innerHTML =
    '<button id="trigger">Скопировать</button><p id="status"></p><details><textarea id="source" readonly></textarea></details>';
  return window;
}

test("HTTP copies the entire script during the click using an attached field outside closed details", async () => {
  const window = fixture();
  const document = window.document;
  const button = document.getElementById("trigger");
  const source = document.getElementById("source");
  const status = document.getElementById("status");
  const text = `Первый тест\n${"(function(){completion('тест');})();\n".repeat(500)}`;
  source.value = text;
  let copied;
  document.execCommand = (command) => {
    assert.equal(command, "copy");
    const field = document.activeElement;
    assert.equal(field.parentElement, document.body);
    assert.equal(field.readOnly, false);
    assert.equal(field.selectionStart, 0);
    assert.equal(field.selectionEnd, text.length);
    copied = field.value;
    return true;
  };
  try {
    button.focus();
    bindCopyButton({ button, source, feedback: status, windowRef: window });
    button.click();
    assert.equal(
      copied,
      text,
      "copy must happen before yielding the user gesture",
    );
    await settle();
    assert.equal(document.querySelector("[data-clipboard-buffer]"), null);
    assert.ok(document.activeElement === button);
    assert.equal(source.closest("details").open, false);
    assert.equal(status.dataset.state, "success");
    assert.equal(status.textContent, "Скопировано.");
    assert.equal(button.textContent, "Скопировано ✓");
    assert.equal(button.disabled, false);
  } finally {
    window.close();
  }
});

test("HTTPS prefers Clipboard API and a rejection still attempts selection copying", async () => {
  const writes = [];
  const window = fixture({
    secure: true,
    clipboard: {
      writeText: async (text) => {
        writes.push(text);
      },
    },
  });
  let fallbackCalls = 0;
  window.document.execCommand = () => {
    fallbackCalls++;
    return true;
  };
  try {
    await writeClipboardText("первый", window);
    assert.deepEqual(writes, ["первый"]);
    assert.equal(fallbackCalls, 0);
    window.navigator.clipboard.writeText = async () => {
      throw new Error("NotAllowedError");
    };
    await writeClipboardText("второй", window);
    assert.equal(fallbackCalls, 1);
  } finally {
    window.close();
  }
});

test("a failed HTTP fallback can use Clipboard API without reporting premature success", async () => {
  let resolve;
  const window = fixture({
    clipboard: {
      writeText: () =>
        new Promise((done) => {
          resolve = done;
        }),
    },
  });
  window.document.execCommand = () => false;
  const button = window.document.getElementById("trigger");
  const feedback = window.document.getElementById("status");
  try {
    bindCopyButton({
      button,
      source: window.document.getElementById("source"),
      feedback,
      getText: () => "отчёт",
      windowRef: window,
    });
    button.click();
    assert.equal(button.getAttribute("aria-disabled"), "true");
    assert.equal(feedback.dataset.state, "pending");
    resolve();
    await settle();
    assert.equal(feedback.dataset.state, "success");
    assert.equal(button.disabled, false);
  } finally {
    window.close();
  }
});

test("denied copy shows a local manual fallback and never claims success", async () => {
  const window = fixture({
    secure: true,
    clipboard: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
  });
  window.document.execCommand = () => false;
  const source = window.document.getElementById("source");
  const button = window.document.getElementById("trigger");
  const feedback = window.document.getElementById("status");
  try {
    bindCopyButton({
      button,
      source,
      feedback,
      getText: () => "нужный скрипт",
      windowRef: window,
    });
    button.click();
    await settle();
    assert.equal(feedback.dataset.state, "error");
    assert.match(feedback.textContent, /Текст выделен/);
    assert.equal(source.closest("details").open, true);
    assert.equal(source.value, "нужный скрипт");
    assert.equal(source.selectionEnd, source.value.length);
    assert.equal(button.textContent, "Скопировать");
    assert.equal(button.disabled, false);
    assert.equal(
      window.document.querySelector("[data-clipboard-buffer]"),
      null,
    );
  } finally {
    window.close();
  }
});

test("each copy button keeps its own content and status when another is used", async () => {
  const window = fixture();
  window.document.body.innerHTML = "";
  const copied = [];
  window.document.execCommand = () => {
    copied.push(window.document.activeElement.value);
    return true;
  };
  try {
    const controls = ["probe", "collection", "summary"].map((name) => {
      const button = window.document.createElement("button");
      const source = window.document.createElement("textarea");
      const feedback = window.document.createElement("p");
      button.textContent = name;
      feedback.id = `${name}-status`;
      source.value = `${name}-text`;
      window.document.body.append(button, source, feedback);
      bindCopyButton({
        button,
        source,
        feedback,
        successText: `${name} скопирован`,
        windowRef: window,
      });
      return { button, source, feedback };
    });
    for (const { button } of controls) {
      button.click();
      await settle();
    }
    assert.deepEqual(copied, ["probe-text", "collection-text", "summary-text"]);
    for (const { button, feedback } of controls) {
      assert.equal(feedback.dataset.state, "success");
      assert.equal(button.getAttribute("aria-describedby"), feedback.id);
    }
  } finally {
    window.close();
  }
});
