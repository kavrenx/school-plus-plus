import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  notifyExtensionImported,
  requestExtensionPresence,
  requestExtensionSnapshot,
  subscribeToExtensionSnapshots,
} from "../js/extension-import.js";

test("web bridge detects an installed extension", async () => {
  const window = new Window({ url: "https://schoolpp.com/" });
  window.addEventListener("message", (event) => {
    if (event.data?.type !== "SCHOOLPP_EXTENSION_PING") return;
    window.postMessage(
      {
        source: "schoolpp-extension",
        type: "SCHOOLPP_EXTENSION_PONG",
        requestId: event.data.requestId,
      },
      window.location.origin,
    );
  });
  assert.equal(await requestExtensionPresence(window, 100), true);
  window.close();
});

test("web bridge accepts the matching extension response", async () => {
  const window = new Window({ url: "https://schoolpp.com/" });
  window.addEventListener("message", (event) => {
    if (event.data?.type !== "SCHOOLPP_EXTENSION_REQUEST") return;
    window.postMessage(
      {
        source: "schoolpp-extension",
        type: "SCHOOLPP_EXTENSION_RESPONSE",
        requestId: event.data.requestId,
        snapshot: { source: "e-schools.by", pages: {} },
      },
      window.location.origin,
    );
  });
  const snapshot = await requestExtensionSnapshot(window, 100);
  assert.equal(snapshot.source, "e-schools.by");
  await window.happyDOM.close();
});

test("web bridge sends an acknowledgement after import", async () => {
  const window = new Window({ url: "https://schoolpp.com/" });
  const received = new Promise((resolve) => {
    window.addEventListener("message", (event) => {
      if (event.data?.type === "SCHOOLPP_EXTENSION_IMPORTED")
        resolve(event.data);
    });
  });
  notifyExtensionImported(window);
  assert.equal((await received).source, "schoolpp-web");
  await window.happyDOM.close();
});

test("web bridge delivers snapshots pushed by the extension", async () => {
  const window = new Window({ url: "https://schoolpp.com/" });
  const received = [];
  const unsubscribe = subscribeToExtensionSnapshots(window, (snapshot) =>
    received.push(snapshot),
  );

  window.dispatchEvent(
    new window.MessageEvent("message", {
      source: window,
      origin: window.location.origin,
      data: {
        source: "schoolpp-extension",
        type: "SCHOOLPP_EXTENSION_UPDATED",
        snapshot: { source: "e-schools.by", capturedAt: "now" },
      },
    }),
  );

  assert.deepEqual(received, [{ source: "e-schools.by", capturedAt: "now" }]);
  unsubscribe();
  window.close();
});
