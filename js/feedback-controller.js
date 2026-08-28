const NOTIFICATION_TYPES = new Set(["info", "success", "error"]);

function createNotificationController({
  element,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timerId = null;

  function hide() {
    if (timerId !== null) {
      clearTimer(timerId);
      timerId = null;
    }

    element.textContent = "";
    element.className = "app-notification";
  }

  function show(message, { type = "info", duration = 3600 } = {}) {
    if (!message) {
      hide();
      return;
    }

    if (timerId !== null) clearTimer(timerId);
    const notificationType = NOTIFICATION_TYPES.has(type) ? type : "info";

    element.textContent = String(message);
    element.className = `app-notification is-visible ${notificationType}`;
    timerId = duration > 0 ? setTimer(hide, duration) : null;
  }

  return { hide, show };
}

function createConnectionController({ element, windowRef, onRestored = () => {} }) {
  let hasRendered = false;
  let wasOffline = false;

  function render(isOnline = windowRef.navigator?.onLine !== false) {
    element.classList.toggle("hidden", isOnline);
    element.setAttribute("aria-hidden", String(isOnline));

    if (hasRendered && wasOffline && isOnline) onRestored();

    wasOffline = !isOnline;
    hasRendered = true;
  }

  function bind() {
    windowRef.addEventListener("online", () => render(true));
    windowRef.addEventListener("offline", () => render(false));
    render();
  }

  return { bind, render };
}

export { createConnectionController, createNotificationController };
