function createUserscriptProgress({
  windowRef,
  element,
  wait = (ms) => new Promise((resolve) => windowRef.setTimeout(resolve, ms)),
}) {
  const doc = windowRef.document;
  const view = element || doc.createElement("section");
  view.className = "userscript-progress";
  view.setAttribute("aria-label", "Синхронизация дневника");
  view.innerHTML = `<div class="userscript-progress-content">
    <svg class="userscript-progress-symbol" viewBox="0 0 80 80" aria-hidden="true">
      <circle class="userscript-progress-ring" cx="40" cy="40" r="29"/>
      <path class="userscript-progress-check" d="m22 41 12 12 25-27"/>
      <path class="userscript-progress-cross" d="m25 25 30 30m0-30L25 55"/>
    </svg>
    <p class="userscript-progress-status" role="status" aria-live="polite" aria-atomic="true"></p>
    <p class="userscript-progress-detail"></p>
    <div class="userscript-progress-actions"></div>
  </div>`;
  if (!element) doc.body.append(view);
  const status = view.querySelector(".userscript-progress-status");
  const detail = view.querySelector(".userscript-progress-detail");
  const actions = view.querySelector(".userscript-progress-actions");
  let revision = 0;
  const originalInert = new Map();
  function show() {
    view.hidden = false;
    doc.body.classList.add("userscript-progress-open");
    for (const child of doc.body.children) {
      if (child !== view && child.tagName !== "SCRIPT") {
        if (!originalInert.has(child)) originalInert.set(child, child.inert);
        child.inert = true;
      }
    }
  }
  function render(state, text, description = "", buttons = []) {
    show();
    view.dataset.state = state;
    view.setAttribute("aria-busy", String(state === "loading"));
    status.textContent = text;
    detail.textContent = description;
    actions.replaceChildren();
    for (const { label, run, primary = false } of buttons) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = primary ? "primary-btn" : "onboarding-secondary";
      button.textContent = label;
      button.addEventListener("click", async () => {
        if (button.disabled) return;
        button.disabled = true;
        try {
          await run();
        } finally {
          button.disabled = false;
        }
      });
      actions.append(button);
    }
  }
  return {
    element: view,
    destroy() {
      revision++;
      view.remove();
      doc.body.classList.remove("userscript-progress-open");
      for (const [child, inert] of originalInert) child.inert = inert;
    },
    async phase(text) {
      const current = ++revision;
      if (status.textContent) {
        status.classList.add("is-changing");
        await wait(120);
      }
      if (current !== revision) return;
      render("loading", text);
      status.classList.remove("is-changing");
    },
    success(buttons = [], description = "") {
      revision++;
      render("success", "Готово!", description, buttons);
    },
    error(description, buttons) {
      revision++;
      status.classList.remove("is-changing");
      render(
        "error",
        "Не удалось завершить синхронизацию",
        description,
        buttons,
      );
    },
  };
}

async function transitionToUserscriptSync(windowRef, url) {
  if (windowRef.document.body.classList.contains("userscript-progress-open"))
    return;
  const progress = createUserscriptProgress({ windowRef });
  const restore = (event) => {
    if (!event.persisted) return;
    progress.destroy();
    windowRef.removeEventListener("pageshow", restore, true);
  };
  windowRef.addEventListener("pageshow", restore, true);
  await progress.phase("Проверка расширения");
  await new Promise((resolve) => windowRef.setTimeout(resolve, 200));
  windowRef.location.href = url;
}

export { createUserscriptProgress, transitionToUserscriptSync };
