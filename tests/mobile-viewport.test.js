import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { supportMediaQueryLists } from "./helpers/media-queries.js";
import { createMobileViewportController } from "../js/mobile-viewport.js";

function fixture(withViewport = true, width = 1024) {
  const window = new Window();
  window.happyDOM.setWindowSize({ width, height: 844 });
  supportMediaQueryLists(window);
  Object.defineProperty(window, "innerHeight", {
    value: 844,
    configurable: true,
  });
  const viewport = new window.EventTarget();
  Object.assign(viewport, { height: 844, offsetTop: 0, scale: 1 });
  Object.defineProperty(window, "visualViewport", {
    value: withViewport ? viewport : null,
    configurable: true,
  });
  const frames = new Map();
  let nextFrame = 0;
  window.requestAnimationFrame = (callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  const flush = () => {
    for (const [id, callback] of frames) {
      frames.delete(id);
      callback();
    }
  };
  const timers = new Map();
  let clock = 0;
  let timerId = 0;
  window.setTimeout = (callback, delay = 0) => {
    timers.set(++timerId, { callback, due: clock + delay });
    return timerId;
  };
  window.clearTimeout = (id) => timers.delete(id);
  const advance = (duration) => {
    clock += duration;
    for (const [id, timer] of timers) {
      if (timer.due <= clock) {
        timers.delete(id);
        timer.callback();
      }
    }
    flush();
  };
  const controller = createMobileViewportController(window);
  controller.start();
  return {
    window,
    viewport,
    frames,
    flush,
    advance,
    timers,
    controller,
    root: window.document.documentElement,
  };
}

test("a phone lifts the focused goal form above the keyboard and below its sticky heading", async () => {
  const f = fixture(true, 390);
  try {
    f.window.document.body.innerHTML =
      '<aside class="subject-detail-drawer"><header class="subject-detail-header"></header><form><input></form></aside>';
    const drawer = f.window.document.querySelector("aside");
    const form = drawer.querySelector("form");
    drawer.getBoundingClientRect = () => ({ top: 0, bottom: 360 });
    drawer.querySelector("header").getBoundingClientRect = () => ({
      height: 64,
    });
    form.getBoundingClientRect = () => ({ top: 530, bottom: 640, height: 110 });
    drawer.querySelector("input").focus();
    f.viewport.height = 360;
    f.viewport.dispatchEvent(new f.window.Event("resize"));
    f.flush();
    assert.equal(drawer.scrollTop, 450);
    assert.equal(f.root.classList.contains("mobile-keyboard-open"), true);
  } finally {
    f.controller.stop();
    await f.window.happyDOM.close();
  }
});

test("focus remains near the heading after a late keyboard resize and native scroll reset", async () => {
  const f = fixture(true, 390);
  try {
    f.window.document.body.innerHTML =
      '<aside class="subject-detail-drawer"><header class="subject-detail-header"></header><form><input></form></aside>';
    const drawer = f.window.document.querySelector("aside");
    const form = drawer.querySelector("form");
    drawer.getBoundingClientRect = () => ({
      top: 0,
      bottom: f.viewport.height,
    });
    drawer.querySelector("header").getBoundingClientRect = () => ({
      bottom: 64,
      height: 64,
    });
    form.getBoundingClientRect = () => ({
      top: 600 - drawer.scrollTop,
      bottom: 730 - drawer.scrollTop,
      height: 130,
    });
    form.querySelector("input").focus();
    f.flush();
    assert.equal(form.getBoundingClientRect().top, 80);
    // Some mobile browsers reset nested scrolling and expose the final height
    // late, with window.innerHeight already shrunk by the keyboard as well.
    drawer.scrollTop = 0;
    Object.defineProperty(f.window, "innerHeight", {
      value: 360,
      configurable: true,
    });
    Object.assign(f.viewport, { height: 360, scale: 0.9999999 });
    f.advance(500);
    assert.equal(form.getBoundingClientRect().top, 80);
    assert.equal(
      f.root.style.getPropertyValue("--mobile-visible-height"),
      "360px",
    );
    assert.equal(f.root.classList.contains("mobile-keyboard-open"), true);
    f.advance(600);
    assert.equal(f.timers.size, 0);
  } finally {
    f.controller.stop();
    await f.window.happyDOM.close();
  }
});

test("scrolling by hand cancels focus settling, and stopping cancels remaining timers", async () => {
  const f = fixture(true, 390);
  try {
    f.window.document.body.innerHTML = "<input>";
    f.window.document.querySelector("input").focus();
    assert.ok(f.timers.size > 0);
    f.window.document.dispatchEvent(new f.window.Event("touchmove"));
    assert.equal(f.timers.size, 0);
    f.viewport.dispatchEvent(new f.window.Event("resize"));
    assert.ok(f.timers.size > 0);
    f.controller.stop();
    assert.equal(f.timers.size, 0);
    f.advance(2000);
    assert.equal(f.frames.size, 0);
  } finally {
    f.controller.stop();
    await f.window.happyDOM.close();
  }
});

test("phone dialogs lock the background and restore its scroll position on close", async () => {
  const f = fixture(true, 390);
  try {
    Object.defineProperty(f.window, "scrollY", {
      value: 520,
      configurable: true,
    });
    let restored;
    f.window.scrollTo = (value) => {
      restored = value.top;
    };
    const body = f.window.document.body;
    body.classList.add("subject-detail-open");
    f.window.dispatchEvent(new f.window.Event("resize"));
    f.flush();
    assert.equal(body.style.position, "fixed");
    assert.equal(body.style.top, "-520px");
    body.classList.remove("subject-detail-open");
    f.window.dispatchEvent(new f.window.Event("resize"));
    f.flush();
    assert.equal(body.style.position, "");
    assert.equal(restored, 520);
  } finally {
    f.controller.stop();
    await f.window.happyDOM.close();
  }
});

test("mobile sheets follow the visible screen while typing and recover after the keyboard closes", async () => {
  const f = fixture();
  try {
    f.window.document.body.innerHTML = "<textarea></textarea>";
    f.window.document.querySelector("textarea").focus();
    Object.assign(f.viewport, { height: 410, offsetTop: 40 });
    f.viewport.dispatchEvent(new f.window.Event("resize"));
    f.flush();
    assert.equal(
      f.root.style.getPropertyValue("--mobile-visible-height"),
      "410px",
    );
    assert.equal(f.root.style.getPropertyValue("--mobile-visible-top"), "40px");
    assert.equal(f.root.classList.contains("mobile-keyboard-open"), true);
    f.window.document.querySelector("textarea").blur();
    Object.assign(f.viewport, { height: 844, offsetTop: 0 });
    f.viewport.dispatchEvent(new f.window.Event("resize"));
    f.flush();
    assert.equal(
      f.root.style.getPropertyValue("--mobile-visible-height"),
      "844px",
    );
    assert.equal(f.root.classList.contains("mobile-keyboard-open"), false);
  } finally {
    f.controller.stop();
    await f.window.happyDOM.close();
  }
});

test("pinch zoom is not mistaken for a keyboard and leaving the page stops updates", async () => {
  const f = fixture();
  try {
    f.window.document.body.innerHTML = "<input>";
    f.window.document.querySelector("input").focus();
    Object.assign(f.viewport, { height: 400, scale: 2 });
    f.viewport.dispatchEvent(new f.window.Event("resize"));
    f.flush();
    assert.equal(f.root.classList.contains("mobile-keyboard-open"), false);
    f.viewport.height = 300;
    f.viewport.dispatchEvent(new f.window.Event("resize"));
    f.controller.stop();
    f.flush();
    assert.equal(f.frames.size, 0);
    assert.equal(
      f.root.style.getPropertyValue("--mobile-visible-height"),
      "400px",
    );
    f.controller.start();
    assert.equal(
      f.root.style.getPropertyValue("--mobile-visible-height"),
      "300px",
    );
  } finally {
    f.controller.stop();
    await f.window.happyDOM.close();
  }
});

test("older browsers use normal resize events without VisualViewport", async () => {
  const f = fixture(false);
  try {
    Object.defineProperty(f.window, "innerHeight", {
      value: 600,
      configurable: true,
    });
    f.window.dispatchEvent(new f.window.Event("resize"));
    f.flush();
    assert.equal(
      f.root.style.getPropertyValue("--mobile-visible-height"),
      "600px",
    );
    assert.equal(f.root.classList.contains("mobile-keyboard-open"), false);
  } finally {
    f.controller.stop();
    await f.window.happyDOM.close();
  }
});
