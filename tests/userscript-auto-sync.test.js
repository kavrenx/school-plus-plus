import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  createUserscriptAutoSync,
  rememberUserscriptReturn,
  SYNC_INTERVAL,
  USERSCRIPT_TAB,
} from "../js/userscript-auto-sync.js";

function fixture({
  navigation = "navigate",
  returned = false,
  initialState,
} = {}) {
  const windowRef = new Window({ url: "https://schoolpp.com/#diary" });
  let time = 10_000_000,
    launches = 0,
    timerId = 0;
  let cache = { savedAt: time };
  const timers = new Map();
  Object.defineProperty(windowRef.document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  windowRef.performance.getEntriesByType = () => [{ type: navigation }];
  windowRef.setTimeout = (fn, ms) => {
    const id = ++timerId;
    timers.set(id, { fn, due: time + ms });
    return id;
  };
  windowRef.clearTimeout = (id) => timers.delete(id);
  if (initialState)
    windowRef.sessionStorage.setItem(
      USERSCRIPT_TAB,
      JSON.stringify(initialState),
    );
  if (returned)
    rememberUserscriptReturn(windowRef.sessionStorage, "owner", time);
  const auto = createUserscriptAutoSync({
    windowRef,
    ownerId: "owner",
    getCache: () => cache,
    now: () => time,
    onSync: () => launches++,
  });
  return {
    windowRef,
    auto,
    launches: () => launches,
    advance(ms) {
      time += ms;
      for (const [id, timer] of [...timers])
        if (timer.due <= time) {
          timers.delete(id);
          timer.fn();
        }
    },
    updateCache() {
      cache = { savedAt: time };
    },
    visibility(value) {
      Object.defineProperty(windowRef.document, "visibilityState", {
        configurable: true,
        value,
      });
      windowRef.document.dispatchEvent(new windowRef.Event("visibilitychange"));
    },
    close() {
      auto.stop();
      windowRef.close();
    },
  };
}

test("a new tab syncs immediately even when the saved diary is fresh", () => {
  const f = fixture();
  try {
    f.auto.start();
    assert.equal(f.launches(), 1);
    f.windowRef.dispatchEvent(new f.windowRef.Event("focus"));
    assert.equal(f.launches(), 1);
  } finally {
    f.close();
  }
});

test("reloading the tab is not another entry and still enforces the fifteen-minute deadline", () => {
  const f = fixture({ navigation: "reload" });
  try {
    f.auto.start();
    f.advance(SYNC_INTERVAL - 1);
    assert.equal(f.launches(), 0);
    f.advance(1);
    assert.equal(f.launches(), 1);
  } finally {
    f.close();
  }
});

test("returning after success or explicit skip does not loop back to the government diary", () => {
  const f = fixture({ returned: true });
  try {
    f.auto.start();
    assert.equal(f.launches(), 0);
    assert.equal(
      JSON.parse(f.windowRef.sessionStorage.getItem(USERSCRIPT_TAB)).returnedAt,
      0,
    );
    f.advance(SYNC_INTERVAL);
    assert.equal(f.launches(), 1);
  } finally {
    f.close();
  }
});

test("a hidden tab waits until visible, including when its timer was suspended", () => {
  const f = fixture({ navigation: "reload" });
  try {
    f.visibility("hidden");
    f.auto.start();
    f.advance(SYNC_INTERVAL + 60000);
    assert.equal(f.launches(), 0);
    f.visibility("visible");
    assert.equal(f.launches(), 1);
  } finally {
    f.close();
  }
});

test("newly saved data postpone the timeout, and open editors cannot postpone it indefinitely", () => {
  const f = fixture({ navigation: "reload" });
  try {
    f.auto.start();
    f.advance(SYNC_INTERVAL / 2);
    f.updateCache();
    f.windowRef.document.body.innerHTML = '<input id="goal">';
    f.windowRef.document.getElementById("goal").focus();
    f.advance(SYNC_INTERVAL / 2);
    assert.equal(f.launches(), 0);
    f.advance(SYNC_INTERVAL / 2);
    assert.equal(f.launches(), 1);
  } finally {
    f.close();
  }
});

test("browser-back during a recent sync does not create an immediate retry loop", () => {
  const f = fixture({
    navigation: "back_forward",
    initialState: {
      ownerId: "owner",
      baseline: 10_000_000,
      launchedAt: 10_000_000,
      returnedAt: 0,
    },
  });
  try {
    f.auto.start();
    assert.equal(f.launches(), 0);
    f.advance(SYNC_INTERVAL);
    assert.equal(f.launches(), 1);
  } finally {
    f.close();
  }
});

test("unavailable per-tab storage cannot create a sync-return loop", () => {
  const f = fixture();
  try {
    Object.defineProperty(f.windowRef, "sessionStorage", {
      get() {
        throw new Error("denied");
      },
    });
    f.auto.start();
    assert.equal(f.launches(), 0);
  } finally {
    f.close();
  }
});
