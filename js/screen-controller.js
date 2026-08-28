function createScreenController({
  screens,
  transitionMs = 180,
  schedule = window.setTimeout,
}) {
  function getActive() {
    return screens.find(
      (screen) => screen && !screen.classList.contains("hidden"),
    );
  }

  function show(toScreen) {
    if (!toScreen) return;
    const visibleScreens = screens.filter(
      (screen) =>
        screen &&
        screen !== toScreen &&
        !screen.classList.contains("hidden"),
    );

    if (
      !toScreen.classList.contains("hidden") &&
      visibleScreens.length === 0
    ) {
      toScreen.classList.remove("hidden", "screen-exit");
      toScreen.classList.add("screen-enter");
      schedule(
        () => toScreen.classList.remove("screen-enter"),
        transitionMs + 60,
      );
      return;
    }

    toScreen.classList.remove("hidden", "screen-exit");
    toScreen.classList.add("screen-enter");

    visibleScreens.forEach((fromScreen) => {
      fromScreen.classList.remove("screen-enter");
      fromScreen.classList.add("screen-exit");
      schedule(() => {
        fromScreen.classList.add("hidden");
        fromScreen.classList.remove("screen-exit");
      }, transitionMs);
    });

    schedule(
      () => toScreen.classList.remove("screen-enter"),
      transitionMs + 60,
    );
  }

  return { getActive, show };
}

export { createScreenController };
