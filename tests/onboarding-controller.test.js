import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import {
  ONBOARDING_KEY,
  createOnboardingController,
  detectBrowser,
  detectDevice,
  getRecommendedStore,
} from "../js/onboarding-controller.js";

function createWindow() {
  const window = new Window({ url: "https://schoolpp.com/" });
  window.document.body.innerHTML = `
    <section id="onboardingScreen" class="onboarding-screen">
      <main id="onboardingContent"></main>
    </section>`;
  return window;
}

test("onboarding detects the device and recommends its browser store", () => {
  assert.equal(
    detectDevice({ userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile" }),
    "mobile",
  );
  assert.equal(detectDevice({ userAgent: "Mozilla/5.0 Windows" }), "desktop");
  assert.equal(
    detectBrowser({ userAgent: "Mozilla/5.0 Edg/140.0 Chrome/140.0" }),
    "edge",
  );
  assert.equal(getRecommendedStore("edge"), "edge");
  assert.equal(getRecommendedStore("brave"), "chromium");
});

test("returning users skip onboarding", async () => {
  const window = createWindow();
  window.localStorage.setItem(ONBOARDING_KEY, "true");
  const controller = createOnboardingController({
    root: window.document,
    windowRef: window,
    storeUrls: {},
  });

  await controller.start();

  assert.equal(
    window.document
      .getElementById("onboardingScreen")
      .classList.contains("hidden"),
    true,
  );
  window.close();
});

test("an installed extension with data completes the first-run flow", async () => {
  const window = createWindow();
  const controller = createOnboardingController({
    root: window.document,
    windowRef: window,
    storeUrls: {},
    presenceCheck: async () => true,
    snapshotRequest: async () => ({ source: "e-schools.by" }),
    subscribe: () => () => {},
  });
  const completion = controller.start();
  await new Promise((resolve) => setImmediate(resolve));

  window.document.querySelector("[data-diary-confirm]").click();
  window.document.querySelector('[data-device-confirm="desktop"]').click();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(
    window.document.getElementById("onboardingContent").textContent,
    /Данные синхронизированы/,
  );

  window.document.querySelector("[data-onboarding-complete]").click();
  await completion;
  assert.equal(window.localStorage.getItem(ONBOARDING_KEY), "true");
  window.close();
});

test("unsupported diary flow sends a structured request", async () => {
  const window = createWindow();
  let submitted = null;
  const controller = createOnboardingController({
    root: window.document,
    windowRef: window,
    storeUrls: {},
    requestSubmitter: async (request) => {
      submitted = request;
    },
  });
  void controller.start();
  await new Promise((resolve) => setImmediate(resolve));

  window.document.querySelector("[data-diary-unsupported]").click();
  window.document.querySelector("[data-open-diary-request]").click();
  const form = window.document.querySelector(".diary-request-form");
  form.elements.name.value = "Алексей";
  form.elements.diaryUrl.value = "https://diary.example.by";
  form.elements.contact.value = "@alexey";
  form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(submitted, {
    name: "Алексей",
    diaryUrl: "https://diary.example.by",
    contact: "@alexey",
  });
  assert.match(
    window.document.querySelector(".diary-request-success").textContent,
    /Заявка отправлена/,
  );
  window.close();
});
