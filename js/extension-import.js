const WEB_SOURCE = "schoolpp-web";
const EXTENSION_SOURCE = "schoolpp-extension";

function requestExtensionSnapshot(windowRef, timeout = 1600) {
  const requestId = createRequestId(windowRef);
  return new Promise((resolve) => {
    let timer;
    const finish = (snapshot) => {
      windowRef.removeEventListener("message", onMessage);
      windowRef.clearTimeout(timer);
      resolve(snapshot);
    };
    const onMessage = (event) => {
      if (
        event.source !== windowRef ||
        event.origin !== windowRef.location.origin ||
        event.data?.source !== EXTENSION_SOURCE ||
        event.data?.type !== "SCHOOLPP_EXTENSION_RESPONSE" ||
        event.data?.requestId !== requestId
      )
        return;
      finish(event.data.snapshot || null);
    };
    windowRef.addEventListener("message", onMessage);
    timer = windowRef.setTimeout(() => finish(null), timeout);
    windowRef.postMessage(
      { source: WEB_SOURCE, type: "SCHOOLPP_EXTENSION_REQUEST", requestId },
      windowRef.location.origin,
    );
  });
}

function requestExtensionPresence(windowRef, timeout = 700) {
  const requestId = createRequestId(windowRef);
  return new Promise((resolve) => {
    let timer;
    const finish = (installed) => {
      windowRef.removeEventListener("message", onMessage);
      windowRef.clearTimeout(timer);
      resolve(installed);
    };
    const onMessage = (event) => {
      if (
        event.source !== windowRef ||
        event.origin !== windowRef.location.origin ||
        event.data?.source !== EXTENSION_SOURCE ||
        event.data?.type !== "SCHOOLPP_EXTENSION_PONG" ||
        event.data?.requestId !== requestId
      )
        return;
      finish(true);
    };
    windowRef.addEventListener("message", onMessage);
    timer = windowRef.setTimeout(() => finish(false), timeout);
    windowRef.postMessage(
      { source: WEB_SOURCE, type: "SCHOOLPP_EXTENSION_PING", requestId },
      windowRef.location.origin,
    );
  });
}

function notifyExtensionImported(windowRef) {
  windowRef.postMessage(
    { source: WEB_SOURCE, type: "SCHOOLPP_EXTENSION_IMPORTED" },
    windowRef.location.origin,
  );
}

function subscribeToExtensionSnapshots(windowRef, listener) {
  const onMessage = (event) => {
    if (
      event.source !== windowRef ||
      event.origin !== windowRef.location.origin ||
      event.data?.source !== EXTENSION_SOURCE ||
      event.data?.type !== "SCHOOLPP_EXTENSION_UPDATED" ||
      !event.data.snapshot
    )
      return;
    listener(event.data.snapshot);
  };
  windowRef.addEventListener("message", onMessage);
  return () => windowRef.removeEventListener("message", onMessage);
}

function createRequestId(windowRef) {
  if (typeof windowRef.crypto?.randomUUID === "function")
    return windowRef.crypto.randomUUID();
  return `schoolpp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export {
  notifyExtensionImported,
  requestExtensionPresence,
  requestExtensionSnapshot,
  subscribeToExtensionSnapshots,
};
