const USERSCRIPT_TAB = "schoolpp_userscript_tab_v1";
const SYNC_INTERVAL = 15 * 60 * 1000;
const RETURN_WINDOW = 2 * 60 * 1000;

function rememberUserscriptReturn(session, ownerId, now = Date.now()) {
  try {
    session.setItem(
      USERSCRIPT_TAB,
      JSON.stringify({
        ownerId,
        baseline: now,
        returnedAt: now,
        launchedAt: 0,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function createUserscriptAutoSync({
  windowRef,
  ownerId,
  getCache,
  onSync,
  now = Date.now,
}) {
  const doc = windowRef.document;
  let state = {},
    timer,
    running = false,
    launched = false,
    entry = false;
  function save() {
    try {
      windowRef.sessionStorage.setItem(USERSCRIPT_TAB, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }
  function pause() {
    windowRef.clearTimeout(timer);
    timer = null;
  }
  function check() {
    pause();
    if (!running || launched || doc.visibilityState !== "visible") return;
    const cache = getCache();
    if (!cache) return;
    const baseline = Math.max(
      Number(state.baseline) || 0,
      Number(cache.savedAt) || 0,
    );
    if (entry || now() - baseline >= SYNC_INTERVAL) {
      state = { ownerId, baseline: now(), returnedAt: 0, launchedAt: now() };
      // Without per-tab storage, a return cannot be distinguished safely.
      if (!save()) return;
      launched = true;
      entry = false;
      onSync();
      return;
    }
    timer = windowRef.setTimeout(
      check,
      Math.max(1000, SYNC_INTERVAL - (now() - baseline)),
    );
  }
  function pagehide() {
    pause();
  }
  function pageshow(event) {
    if (event.persisted) {
      launched = false;
      entry = !(state.launchedAt && now() - state.launchedAt < RETURN_WINDOW);
    }
    check();
  }
  function start() {
    if (running) return;
    running = true;
    try {
      state = JSON.parse(
        windowRef.sessionStorage.getItem(USERSCRIPT_TAB) || "{}",
      );
    } catch {
      state = {};
    }
    if (state?.ownerId !== ownerId) state = {};
    const returned =
      state.returnedAt &&
      now() >= state.returnedAt &&
      now() - state.returnedAt < RETURN_WINDOW;
    const navigation =
      windowRef.performance?.getEntriesByType("navigation")?.[0]?.type ||
      "navigate";
    const recentBack =
      navigation === "back_forward" &&
      state.launchedAt &&
      now() - state.launchedAt < RETURN_WINDOW;
    entry = !returned && navigation !== "reload" && !recentBack;
    state = { ...state, ownerId, returnedAt: 0 };
    if (!save()) {
      running = false;
      return;
    }
    doc.addEventListener("visibilitychange", check);
    windowRef.addEventListener("focus", check);
    windowRef.addEventListener("pageshow", pageshow);
    windowRef.addEventListener("pagehide", pagehide);
    check();
  }
  function stop() {
    running = false;
    pause();
    doc.removeEventListener("visibilitychange", check);
    windowRef.removeEventListener("focus", check);
    windowRef.removeEventListener("pageshow", pageshow);
    windowRef.removeEventListener("pagehide", pagehide);
  }
  return { start, stop };
}

export {
  createUserscriptAutoSync,
  rememberUserscriptReturn,
  SYNC_INTERVAL,
  USERSCRIPT_TAB,
};
