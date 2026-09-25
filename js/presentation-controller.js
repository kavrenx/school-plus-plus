const PRESENTATION_KEYS = new Map([
  ["ArrowDown", 1],
  ["PageDown", 1],
  [" ", 1],
  ["ArrowUp", -1],
  ["PageUp", -1],
]);

function getTargetScene(currentScene, direction, sceneCount) {
  if (!Number.isInteger(sceneCount) || sceneCount < 1) return 0;
  const nextScene = currentScene + Math.sign(direction || 0);
  return Math.min(sceneCount - 1, Math.max(0, nextScene));
}

function readWheelIntent(accumulator, delta, threshold = 90) {
  if (!Number.isFinite(delta) || delta === 0) {
    return { accumulator, direction: 0 };
  }

  const nextAccumulator =
    accumulator && Math.sign(accumulator) !== Math.sign(delta)
      ? delta
      : accumulator + delta;

  if (Math.abs(nextAccumulator) < threshold) {
    return { accumulator: nextAccumulator, direction: 0 };
  }

  return { accumulator: 0, direction: Math.sign(nextAccumulator) };
}

function createPresentationController({
  root,
  body = root.body,
  windowRef = globalThis.window,
  schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout,
  transitionMs = 760,
  sceneTransitionMs = 680,
  wheelThreshold = 90,
}) {
  const page = root.documentElement;
  const elements = {
    loginScreen: root.getElementById("loginScreen"),
    screen: root.getElementById("presentationScreen"),
    backButton: root.getElementById("presentationBackBtn"),
    finalButton: root.getElementById("presentationFinalBtn"),
    hint: root.getElementById("presentationHint"),
    counter: root.getElementById("presentationCounter"),
    announcement: root.getElementById("presentationAnnouncement"),
    copies: Array.from(root.querySelectorAll("[data-presentation-copy]")),
    dots: Array.from(root.querySelectorAll("[data-presentation-dot]")),
  };
  const sceneCount = elements.copies.length;
  const reducedMotion = Boolean(
    windowRef?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
  );
  let active = false;
  let locked = false;
  let currentScene = 0;
  let wheelAccumulator = 0;
  let touchStartY = null;
  let transitionTimer = null;
  let wheelResetTimer = null;
  let originScreen = elements.loginScreen;
  let originTrigger = root.getElementById("presentationTrigger");

  function bind() {
    root.addEventListener("click", handleTriggerClick);
    elements.backButton?.addEventListener("click", close);
    elements.finalButton?.addEventListener("click", close);
    elements.screen?.addEventListener("wheel", handleWheel, { passive: false });
    elements.screen?.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    elements.screen?.addEventListener("touchend", handleTouchEnd, {
      passive: true,
    });
    windowRef?.addEventListener("keydown", handleKeydown);
    renderScene(0);
  }

  function open(trigger = null) {
    if (active || locked || !elements.screen) return;

    originTrigger =
      trigger?.closest?.("[data-presentation-trigger]") ||
      root.getElementById("presentationTrigger");
    originScreen = originTrigger?.closest("section") || elements.loginScreen;
    if (!originScreen) return;

    active = true;
    locked = true;
    currentScene = 0;
    wheelAccumulator = 0;
    renderScene(0);

    page?.classList.add("presentation-active");
    body.classList.add("presentation-active", "presentation-opening");
    originScreen.classList.add("is-leaving-presentation");
    originScreen.setAttribute("aria-hidden", "true");
    elements.screen.classList.remove("hidden", "is-leaving-presentation");
    elements.screen.classList.add("is-entering-presentation");
    elements.screen.setAttribute("aria-hidden", "false");

    setTransitionTimer(() => {
      originScreen.classList.add("hidden");
      originScreen.classList.remove("is-leaving-presentation");
      elements.screen.classList.remove("is-entering-presentation");
      body.classList.remove("presentation-opening");
      locked = false;
      elements.backButton?.focus({ preventScroll: true });
    }, motionDuration(transitionMs));
  }

  function close() {
    if (!active || locked || !elements.screen || !originScreen) return;

    locked = true;
    wheelAccumulator = 0;
    body.classList.add("presentation-closing");
    page?.classList.add("presentation-closing");
    originScreen.classList.remove("hidden");
    originScreen.classList.add("is-returning-presentation");
    originScreen.setAttribute("aria-hidden", "false");
    elements.screen.classList.add("is-leaving-presentation");
    elements.screen.setAttribute("aria-hidden", "true");

    setTransitionTimer(() => {
      elements.screen.classList.add("hidden");
      elements.screen.classList.remove(
        "is-leaving-presentation",
        "is-scene-transitioning",
        "is-forward",
        "is-backward",
      );
      originScreen.classList.remove("is-returning-presentation");
      body.classList.remove("presentation-active", "presentation-closing");
      page?.classList.remove("presentation-active", "presentation-closing");
      delete body.dataset.presentationScene;
      active = false;
      locked = false;
      currentScene = 0;
      renderScene(0);
      originTrigger?.focus({ preventScroll: true });
    }, motionDuration(transitionMs));
  }

  function reset() {
    if (transitionTimer !== null) cancel(transitionTimer);
    if (wheelResetTimer !== null) cancel(wheelResetTimer);
    transitionTimer = null;
    wheelResetTimer = null;
    active = false;
    locked = false;
    currentScene = 0;
    wheelAccumulator = 0;
    touchStartY = null;

    body.classList.remove(
      "presentation-active",
      "presentation-opening",
      "presentation-closing",
    );
    page?.classList.remove("presentation-active", "presentation-closing");
    delete body.dataset.presentationScene;
    elements.loginScreen?.classList.remove(
      "hidden",
      "is-leaving-presentation",
      "is-returning-presentation",
    );
    elements.loginScreen?.setAttribute("aria-hidden", "false");
    elements.screen?.classList.add("hidden");
    elements.screen?.classList.remove(
      "is-entering-presentation",
      "is-leaving-presentation",
      "is-scene-transitioning",
      "is-forward",
      "is-backward",
    );
    elements.screen?.setAttribute("aria-hidden", "true");
    renderScene(0);
  }

  function navigate(direction) {
    if (!active || locked) return false;
    const nextScene = getTargetScene(currentScene, direction, sceneCount);
    if (nextScene === currentScene) return false;

    const previousScene = currentScene;
    currentScene = nextScene;
    locked = true;
    elements.screen.classList.remove("is-forward", "is-backward");
    elements.screen.classList.add(
      "is-scene-transitioning",
      direction > 0 ? "is-forward" : "is-backward",
    );
    renderScene(currentScene, previousScene);

    setTransitionTimer(() => {
      elements.screen.classList.remove(
        "is-scene-transitioning",
        "is-forward",
        "is-backward",
      );
      elements.copies.forEach((copy) =>
        copy.classList.remove("is-entering", "is-leaving"),
      );
      locked = false;
      if (currentScene === sceneCount - 1) {
        elements.screen.focus({ preventScroll: true });
      }
    }, motionDuration(sceneTransitionMs));
    return true;
  }

  function renderScene(scene, previousScene = null) {
    if (!elements.screen || !sceneCount) return;
    elements.screen.dataset.scene = String(scene);
    if (active) body.dataset.presentationScene = String(scene);

    elements.copies.forEach((copy, index) => {
      const isCurrent = index === scene;
      copy.classList.toggle("is-active", isCurrent);
      copy.classList.toggle("is-entering", isCurrent && previousScene !== null);
      copy.classList.toggle("is-leaving", index === previousScene);
      copy.setAttribute("aria-hidden", String(!isCurrent));
    });

    elements.dots.forEach((dot, index) => {
      dot.classList.toggle("is-active", index === scene);
      if (index === scene) dot.setAttribute("aria-current", "step");
      else dot.removeAttribute("aria-current");
    });

    const isFinal = scene === sceneCount - 1;
    setControlHidden(elements.backButton, isFinal);
    setControlHidden(elements.finalButton, !isFinal);
    elements.hint?.classList.toggle("is-hidden", isFinal);
    if (elements.counter) {
      elements.counter.textContent = `${scene + 1} / ${sceneCount}`;
    }
    if (elements.announcement) {
      const heading = elements.copies[scene]?.querySelector("h2")?.textContent;
      elements.announcement.textContent = heading || "";
    }
  }

  function handleWheel(event) {
    if (!active) return;
    event.preventDefault();
    if (locked || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

    const modeMultiplier =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? windowRef.innerHeight
          : 1;
    const intent = readWheelIntent(
      wheelAccumulator,
      event.deltaY * modeMultiplier,
      wheelThreshold,
    );
    wheelAccumulator = intent.accumulator;

    if (wheelResetTimer !== null) cancel(wheelResetTimer);
    wheelResetTimer = schedule(() => {
      wheelAccumulator = 0;
      wheelResetTimer = null;
    }, 180);

    if (intent.direction) navigate(intent.direction);
  }

  function handleTriggerClick(event) {
    const trigger = event.target.closest?.("[data-presentation-trigger]");
    if (trigger) open(trigger);
  }

  function handleKeydown(event) {
    if (!active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }

    const direction = PRESENTATION_KEYS.get(event.key);
    if (!direction) return;
    event.preventDefault();
    navigate(direction);
  }

  function handleTouchStart(event) {
    if (!active || locked) return;
    touchStartY = event.changedTouches?.[0]?.clientY ?? null;
  }

  function handleTouchEnd(event) {
    if (!active || locked || touchStartY === null) return;
    const touchEndY = event.changedTouches?.[0]?.clientY;
    if (!Number.isFinite(touchEndY)) return;
    const distance = touchStartY - touchEndY;
    touchStartY = null;
    if (Math.abs(distance) >= 48) navigate(Math.sign(distance));
  }

  function setTransitionTimer(callback, duration) {
    if (transitionTimer !== null) cancel(transitionTimer);
    transitionTimer = schedule(() => {
      transitionTimer = null;
      callback();
    }, duration);
  }

  function motionDuration(duration) {
    return reducedMotion ? 0 : duration;
  }

  return {
    bind,
    close,
    getScene: () => currentScene,
    isActive: () => active,
    navigate,
    open,
    reset,
  };
}

function setControlHidden(control, hidden) {
  if (!control) return;
  control.classList.toggle("is-hidden", hidden);
  control.setAttribute("aria-hidden", String(hidden));
  control.tabIndex = hidden ? -1 : 0;
}

export {
  createPresentationController,
  getTargetScene,
  readWheelIntent,
};
