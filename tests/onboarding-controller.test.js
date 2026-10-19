import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { EXTENSION_STORE_URLS } from "../js/release-config.js";

import {
  ONBOARDING_KEY,
  createOnboardingController,
  detectBrowser,
  detectDevice,
  isAppleMobile,
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
  assert.equal(isAppleMobile({ userAgent: "iPhone" }), true);
  assert.equal(
    isAppleMobile({ userAgent: "Macintosh", maxTouchPoints: 5 }),
    true,
  );
  assert.equal(
    isAppleMobile({ userAgent: "Macintosh", maxTouchPoints: 0 }),
    false,
  );
  assert.equal(isAppleMobile({ userAgent: "Android Mobile" }), false);
  assert.equal(
    detectDevice({ userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile" }),
    "mobile",
  );
  assert.equal(detectDevice({ userAgent: "Mozilla/5.0 Windows" }), "desktop");
  assert.equal(
    detectBrowser({ userAgent: "Mozilla/5.0 Edg/140.0 Chrome/140.0" }),
    "edge",
  );
  assert.equal(getRecommendedStore("edge"), "chromium");
  assert.equal(getRecommendedStore("brave"), "chromium");
});

test("local Apple preview offers the test guide and a direct code alternative", async () => {
  const window = createWindow();
  Object.defineProperty(window.navigator, "userAgent", { value: "iPhone" });
  const steps = [];
  const controller = createOnboardingController({
    root: window.document,
    windowRef: window,
    storeUrls: {},
    shortcutSetupUrl: "/ios-setup.html",
    onStepChange: (step) => steps.push(step),
  });
  try {
    void controller.start();
    await new Promise((resolve) => setImmediate(resolve));
    window.document.querySelector("[data-diary-confirm]").click();
    assert.equal(
      window.document
        .querySelector("[data-shortcut-setup]")
        .getAttribute("href"),
      "/ios-setup.html",
    );
    assert.equal(window.document.querySelector("[data-device-join]"), null);
    window.document.querySelector("[data-mobile-code]").click();
    assert.ok(window.document.querySelector("[data-device-join]"));
    assert.equal(steps.at(-1), "mobile-code");
    window.document.querySelector("[data-device-change]").click();
    assert.equal(
      window.document.querySelector("[data-device-confirm=mobile]"),
      null,
    );
    assert.match(
      window.document.querySelector("h1").textContent,
      /Выберите способ подключения/,
    );
    controller.navigateToStep("mobile-code");
    assert.ok(window.document.querySelector("[data-device-join]"));
  } finally {
    window.close();
  }
});

test("Apple entry asks about the diary while QR pairing still opens the code form", async () => {
  for (const preview of [false, true]) {
    const window = createWindow();
    Object.defineProperty(window.navigator, "userAgent", { value: "iPad" });
    const controller = createOnboardingController({
      root: window.document,
      windowRef: window,
      storeUrls: {},
      shortcutSetupUrl: preview ? "/ios-setup.html" : "",
      pairingCode: preview ? "12345678" : "",
    });
    try {
      void controller.start();
      await new Promise((resolve) => setImmediate(resolve));
      if (!preview) {
        assert.ok(window.document.querySelector("[data-diary-confirm]"));
        assert.equal(window.document.querySelector("[data-device-join]"), null);
        window.document.querySelector("[data-diary-confirm]").click();
      }
      assert.ok(window.document.querySelector("[data-device-join]"));
      assert.equal(
        window.document.querySelector("[data-shortcut-setup]"),
        null,
      );
    } finally {
      window.close();
    }
  }
});

test("Userscripts entry asks about the diary before showing setup and alternative methods", async () => {
  const window = createWindow();
  Object.defineProperty(window.navigator, "userAgent", { value: "iPhone" });
  const controller = createOnboardingController({
    root: window.document,
    windowRef: window,
    storeUrls: {},
    userscriptSetupUrl: "/userscripts-setup.html",
  });
  try {
    void controller.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(window.document.querySelector("[data-diary-confirm]"));
    assert.equal(
      window.document.querySelector("[data-userscript-setup]"),
      null,
    );
    window.document.querySelector("[data-diary-unsupported]").click();
    assert.ok(window.document.querySelector("[data-open-diary-request]"));
    window.document.querySelector("[data-diary-back]").click();
    window.document.querySelector("[data-diary-confirm]").click();
    assert.equal(
      window.document.querySelector("[data-userscript-setup]").href,
      "https://schoolpp.com/userscripts-sync.html",
    );
    const installer = window.document.getElementById("installUserscript");
    assert.equal(installer.target, "_blank");
    assert.equal(new URL(installer.href).pathname, "/schoolpp.user.js");
    assert.equal(
      window.document.querySelectorAll(".userscripts-guide-image").length,
      10,
    );
    assert.equal(window.document.querySelector("[data-shortcut-setup]"), null);
    assert.doesNotMatch(
      window.document.getElementById("onboardingContent").textContent,
      /тест|локальн/i,
    );
    window.document.querySelector("[data-device-change]").click();
    assert.ok(window.document.querySelector(".connection-method-grid"));
    assert.equal(
      window.document.querySelectorAll(".connection-method-grid button").length,
      3,
    );
    assert.match(
      window.document.getElementById("onboardingContent").textContent,
      /Userscripts \(рекомендуем\)/,
    );
    assert.equal(
      window.document.querySelector("[data-device-confirm=mobile]"),
      null,
    );
    window.document.querySelector("[data-mobile-code]").click();
    assert.ok(window.document.querySelector("[data-device-join]"));
  } finally {
    window.close();
  }
});

test("onboarding exposes stable steps for browser history", async () => {
  const window = createWindow();
  const steps = [];
  const controller = createOnboardingController({
    root: window.document,
    windowRef: window,
    storeUrls: {},
    onStepChange: (step) => steps.push(step),
  });
  void controller.start();
  await new Promise((resolve) => setImmediate(resolve));

  controller.navigateToStep("device-choice");
  controller.navigateToStep("mobile");
  controller.navigateToStep("diary");

  assert.deepEqual(steps, ["diary", "methods", "mobile", "diary"]);
  window.close();
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

test("an explicit methods route restores method cards for an already connected browser", async () => {
  const window = createWindow();
  window.localStorage.setItem(ONBOARDING_KEY, "true");
  const controller = createOnboardingController({
    root: window.document,
    windowRef: window,
    storeUrls: {},
    initialStep: "methods",
    userscriptSetupUrl: "/userscripts-setup.html",
  });
  try {
    void controller.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(window.document.querySelector(".connection-method-grid"));
    assert.equal(
      window.document
        .getElementById("onboardingScreen")
        .classList.contains("hidden"),
      false,
    );
    window.document.querySelector("[data-mobile-code]").click();
    assert.ok(window.document.querySelector("[data-device-join]"));
  } finally {
    window.close();
  }
});

test("QR links on an Apple device keep code entry even when the public Safari method is available", async () => {
  const window = createWindow();
  Object.defineProperty(window.navigator, "userAgent", { value: "iPhone" });
  const controller = createOnboardingController({
    root: window.document,
    windowRef: window,
    storeUrls: {},
    pairingCode: "12345678",
    userscriptSetupUrl: "/userscripts-setup.html",
  });
  try {
    void controller.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      window.document.querySelector("[data-device-join] input").value,
      "12345678",
    );
    assert.equal(
      window.document.querySelector("[data-userscript-setup]"),
      null,
    );
    window.document.querySelector("[data-device-change]").click();
    assert.ok(window.document.querySelector("[data-userscript-choice]"));
  } finally {
    window.close();
  }
});

test("a phone opens code entry directly with the requested connection heading", async () => {
  const window = createWindow();
  const controller = createOnboardingController({
    root: window.document,
    windowRef: window,
    storeUrls: {},
    initialStep: "mobile",
    pairingCode: "12345678",
    presenceCheck: () => assert.fail("phone should not look for an extension"),
  });
  try {
    void controller.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      window.document.querySelector("h1").textContent,
      "Подключение по коду",
    );
    assert.equal(
      window.document.querySelector('[name="code"]').value,
      "12345678",
    );
    assert.equal(window.document.querySelector("[data-diary-confirm]"), null);
  } finally {
    window.close();
  }
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
  assert.equal(
    window.document.querySelector('[data-device-confirm="desktop"]'),
    null,
  );
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

test("extension install screen links to the published Chrome and Firefox stores", async () => {
  const window = createWindow();
  const controller = createOnboardingController({
    root: window.document,
    windowRef: window,
    storeUrls: EXTENSION_STORE_URLS,
    presenceCheck: async () => false,
    subscribe: () => () => {},
  });
  void controller.start();
  await new Promise((resolve) => setImmediate(resolve));
  window.document.querySelector("[data-diary-confirm]").click();
  await new Promise((resolve) => setImmediate(resolve));

  const chrome = window.document.querySelector('a[href*="chromewebstore"]');
  assert.ok(chrome);
  assert.match(chrome.querySelector("img").src, /browser-chrome\.webp$/);
  const firefox = window.document.querySelector(
    'a[href*="addons.mozilla.org"]',
  );
  assert.ok(firefox);
  assert.match(decodeURI(firefox.href), /school-синхронизация-дневника/);
  assert.equal(firefox.target, "_blank");
  assert.equal(
    window.document.querySelector(".extension-store-card.is-unavailable"),
    null,
  );
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
    feedbackDelay: async () => {},
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
    /Отправлено/,
  );
  window.close();
});
