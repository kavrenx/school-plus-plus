function createMobileViewportController(windowRef) {
  const root = windowRef.document.documentElement;
  const viewport = windowRef.visualViewport;
  let running = false;
  let frame = null;
  let lockedScroll = null;
  let savedBodyStyles;
  let restingHeight = windowRef.innerHeight;
  let anchorEditor = null;
  let viewportTimer = null;
  const settlingTimers = new Set();
  const editorSelector =
    "input:not([type='file']):not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), select:not([disabled]), [contenteditable='true']";
  const unzoomed = () => Math.abs((viewport?.scale || 1) - 1) < 0.05;
  const compact = windowRef.matchMedia(
    "(max-width: 760px), (max-height: 560px) and (orientation: landscape) and (max-width: 950px)",
  );
  const observer = new windowRef.MutationObserver(schedule);
  function unlockPage() {
    if (lockedScroll === null) return;
    const scroll = lockedScroll;
    lockedScroll = null;
    Object.assign(windowRef.document.body.style, savedBodyStyles);
    windowRef.scrollTo({ top: scroll, behavior: "auto" });
  }
  function syncPageLock() {
    const body = windowRef.document.body;
    const open = body.matches(
      ".subject-detail-open, .support-open, .modal-open",
    );
    if (compact.matches && open) {
      if (lockedScroll !== null) return;
      lockedScroll = windowRef.scrollY;
      savedBodyStyles = Object.fromEntries(
        ["position", "top", "left", "width"].map((key) => [
          key,
          body.style[key],
        ]),
      );
      Object.assign(body.style, {
        position: "fixed",
        top: `${-lockedScroll}px`,
        left: "0",
        width: "100%",
      });
    } else unlockPage();
  }
  function revealEditor(element, height, offset, anchor = false) {
    if (!compact.matches || !unzoomed()) return;
    const container = element.closest(
      ".subject-detail-drawer, .device-modal-card, .diary-request-panel, .onboarding-screen",
    );
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const header = container.querySelector(".subject-detail-header, header");
    const heading = header?.getBoundingClientRect();
    const top =
      Math.max(
        bounds.top,
        offset,
        heading?.bottom ?? bounds.top + (heading?.height || 0),
      ) + 16;
    const bottom = Math.min(bounds.bottom, offset + height) - 24;
    if (bottom <= top) return;
    const group = element.closest(
      "form, .grade-sandbox-controls, .diary-changes-search",
    );
    const target =
      group && group.getBoundingClientRect().height < bottom - top
        ? group
        : element;
    const rect = target.getBoundingClientRect();
    const delta = anchor
      ? rect.top - top
      : rect.bottom > bottom
        ? rect.bottom - bottom
        : rect.top < top
          ? rect.top - top
          : 0;
    if (Math.abs(delta) > 1) {
      // Set only this sheet's scroll position. Native focus scrolling can pan
      // the document as well, especially while an iOS keyboard is animating.
      if (container.matches(".onboarding-screen"))
        windowRef.scrollBy({ top: delta, behavior: "auto" });
      else container.scrollTop += delta;
    }
  }
  function update() {
    frame = null;
    if (!running) return;
    syncPageLock();
    const height = viewport?.height || windowRef.innerHeight;
    root.style.setProperty(
      "--mobile-visible-height",
      `${Math.round(height)}px`,
    );
    root.style.setProperty(
      "--mobile-visible-top",
      `${Math.round(viewport?.offsetTop || 0)}px`,
    );
    const active = windowRef.document.activeElement;
    const editing = active?.matches(editorSelector);
    if (!editing && unzoomed())
      restingHeight = Math.max(height, windowRef.innerHeight);
    root.classList.toggle(
      "mobile-keyboard-open",
      Boolean(
        editing &&
        unzoomed() &&
        Math.max(restingHeight, windowRef.innerHeight) - height > 120,
      ),
    );
    if (editing)
      revealEditor(
        active,
        height,
        viewport?.offsetTop || 0,
        anchorEditor === active,
      );
    anchorEditor = null;
  }
  function schedule() {
    if (running && frame === null)
      frame = windowRef.requestAnimationFrame(update);
  }
  function cancelSettling() {
    for (const timer of settlingTimers) windowRef.clearTimeout(timer);
    settlingTimers.clear();
    anchorEditor = null;
  }
  function handleFocus(event) {
    cancelSettling();
    if (!compact.matches) {
      schedule();
      return;
    }
    const editor =
      event.type === "focusin" && event.target.matches(editorSelector)
        ? event.target
        : null;
    if (editor) anchorEditor = editor;
    schedule();
    // WebKit may apply its native input scroll and final viewport dimensions
    // after the first resize event. Recheck for one bounded opening transition.
    for (const delay of [80, 180, 320, 500, 750, 1000]) {
      const timer = windowRef.setTimeout(() => {
        settlingTimers.delete(timer);
        if (editor && windowRef.document.activeElement === editor)
          anchorEditor = editor;
        schedule();
      }, delay);
      settlingTimers.add(timer);
    }
  }
  function handleViewport() {
    schedule();
    windowRef.clearTimeout(viewportTimer);
    viewportTimer = windowRef.setTimeout(schedule, 100);
  }
  function start() {
    if (running) return;
    running = true;
    viewport?.addEventListener("resize", handleViewport);
    viewport?.addEventListener("scroll", handleViewport);
    windowRef.addEventListener("resize", handleViewport);
    windowRef.document.addEventListener("focusin", handleFocus);
    windowRef.document.addEventListener("focusout", handleFocus);
    windowRef.document.addEventListener("touchmove", cancelSettling, {
      passive: true,
    });
    windowRef.document.addEventListener("wheel", cancelSettling, {
      passive: true,
    });
    compact.addEventListener("change", schedule);
    observer.observe(windowRef.document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    update();
  }
  function stop() {
    running = false;
    if (frame !== null) windowRef.cancelAnimationFrame(frame);
    frame = null;
    viewport?.removeEventListener("resize", handleViewport);
    viewport?.removeEventListener("scroll", handleViewport);
    windowRef.removeEventListener("resize", handleViewport);
    windowRef.document.removeEventListener("focusin", handleFocus);
    windowRef.document.removeEventListener("focusout", handleFocus);
    windowRef.document.removeEventListener("touchmove", cancelSettling);
    windowRef.document.removeEventListener("wheel", cancelSettling);
    cancelSettling();
    windowRef.clearTimeout(viewportTimer);
    compact.removeEventListener("change", schedule);
    observer.disconnect();
    unlockPage();
  }
  return { start, stop };
}

export { createMobileViewportController };
