const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function createModalController({
  transitionMs = 180,
  schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout,
  queue = globalThis.queueMicrotask || ((callback) => callback()),
  documentRoot = globalThis.document,
} = {}) {
  const timers = new WeakMap();
  const returnFocus = new WeakMap();

  function open(modal) {
    if (!modal) return;
    const timer = timers.get(modal);
    if (timer) cancel(timer);

    const activeElement = documentRoot?.activeElement;
    if (activeElement?.focus) returnFocus.set(modal, activeElement);

    modal.classList.remove("hidden");
    modal.classList.remove("is-closing");
    modal.setAttribute?.("aria-hidden", "false");
    documentRoot?.body?.classList.add("modal-open");

    queue(() => getFocusableElements(modal)[0]?.focus());
  }

  function close(modal) {
    if (!modal || modal.classList.contains("hidden")) return;

    const timer = timers.get(modal);
    if (timer) cancel(timer);

    modal.classList.add("is-closing");
    modal.setAttribute?.("aria-hidden", "true");
    restoreFocus(modal);
    timers.set(
      modal,
      schedule(() => {
        modal.classList.add("hidden");
        modal.classList.remove("is-closing");
        timers.delete(modal);
        if (!getOpenModals().length) {
          documentRoot?.body?.classList.remove("modal-open");
        }
      }, transitionMs),
    );
  }

  function handleKeydown(event) {
    const openModals = getOpenModals();
    const modal = openModals[openModals.length - 1];
    if (!modal) return false;

    if (event.key === "Escape") {
      event.preventDefault();
      close(modal);
      return true;
    }
    if (event.key !== "Tab") return false;

    const focusable = getFocusableElements(modal);
    if (!focusable.length) {
      event.preventDefault();
      modal.focus?.();
      return true;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = documentRoot?.activeElement;
    if (event.shiftKey && (active === first || !modal.contains?.(active))) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && (active === last || !modal.contains?.(active))) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  function getOpenModals() {
    if (!documentRoot?.querySelectorAll) return [];
    return Array.from(
      documentRoot.querySelectorAll(
        ".modal-overlay:not(.hidden):not(.is-closing)",
      ),
    );
  }

  function restoreFocus(modal) {
    const target = returnFocus.get(modal);
    returnFocus.delete(modal);
    if (target?.isConnected !== false) target?.focus?.();
  }

  return { close, handleKeydown, open };
}

function getFocusableElements(modal) {
  if (!modal?.querySelectorAll) return [];
  return Array.from(modal.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hidden &&
      !element.closest?.(".hidden") &&
      element.getAttribute?.("aria-hidden") !== "true",
  );
}

export { createModalController, getFocusableElements };
