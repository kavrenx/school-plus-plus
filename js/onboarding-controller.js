import {
  requestExtensionPresence,
  requestExtensionSnapshot,
  subscribeToExtensionSnapshots,
} from "./extension-import.js";
import { renderDeviceJoin } from "./device-controller.js";
import { renderUserscriptsGuide, USERSCRIPTS_ICON } from "./userscripts-guide.js";
import { transitionToUserscriptSync } from "./userscript-progress.js";

const ONBOARDING_KEY = "schoolpp_onboarding_complete_v1";
const CHECK_PENDING_KEY = "schoolpp_extension_check_pending";
const BROWSER_ICONS = Object.freeze({
  chromium: new URL("../assets/browser-chrome.webp", import.meta.url).href,
  firefox: new URL("../assets/browser-firefox.svg", import.meta.url).href,
});

function detectDevice(navigatorRef = {}) {
  const agent = String(navigatorRef.userAgent || "");
  const mobile =
    navigatorRef.userAgentData?.mobile === true ||
    /Android|iPhone|iPod|Mobile/i.test(agent);
  const tablet =
    /iPad|Tablet/i.test(agent) ||
    (/Macintosh/i.test(agent) && Number(navigatorRef.maxTouchPoints) > 1);
  return mobile || tablet ? "mobile" : "desktop";
}

function detectBrowser(navigatorRef = {}) {
  const agent = String(navigatorRef.userAgent || "");
  if (/Firefox\//i.test(agent)) return "firefox";
  if (/Edg\//i.test(agent)) return "edge";
  if (/OPR\//i.test(agent)) return "opera";
  if (/Brave/i.test(agent)) return "brave";
  if (/Chrome\//i.test(agent)) return "chrome";
  return "chromium";
}

function isAppleMobile(navigatorRef = {}) {
  return /iPhone|iPad|iPod/i.test(navigatorRef.userAgent || "") ||
    (/Macintosh/i.test(navigatorRef.userAgent || "") && Number(navigatorRef.maxTouchPoints) > 1);
}

function getRecommendedStore(browser) {
  if (browser === "firefox") return "firefox";
  return "chromium";
}

function createOnboardingController({
  root,
  windowRef,
  storeUrls,
  requestSubmitter = async () => {
    throw new Error("DIARY_REQUEST_UNAVAILABLE");
  },
  feedbackDelay = (duration) =>
    new Promise((resolve) => windowRef.setTimeout(resolve, duration)),
  eventReporter = async () => {},
  presenceCheck = requestExtensionPresence,
  snapshotRequest = requestExtensionSnapshot,
  subscribe = subscribeToExtensionSnapshots,
  onStepChange = () => {},
  initialStep = "",
  pairingCode = "",
  shortcutSetupUrl = "",
  userscriptSetupUrl = "",
  onMobileOpen = () => {},
}) {
  const screen = root.getElementById("onboardingScreen");
  const content = root.getElementById("onboardingContent");
  const storage = windowRef.localStorage;
  const session = windowRef.sessionStorage;
  const requestUi = createDiaryRequestPanel(root);
  let finish;
  let unsubscribe = () => {};
  let completePromise;

  function announceStep(step) {
    onStepChange(step);
  }

  function reportEvent(name) {
    return Promise.resolve(eventReporter(name)).catch(() => {});
  }

  function isComplete() {
    try {
      return storage.getItem(ONBOARDING_KEY) === "true";
    } catch {
      return false;
    }
  }

  function rememberComplete() {
    try {
      storage.setItem(ONBOARDING_KEY, "true");
      session.removeItem(CHECK_PENDING_KEY);
    } catch {
      /* The flow still completes for this visit. */
    }
  }

  function complete() {
    rememberComplete();
    void reportEvent("onboarding_completed");
    unsubscribe();
    screen.classList.add("hidden");
    screen.setAttribute("aria-hidden", "true");
    finish?.();
  }

  function start() {
    if (isComplete() && !["methods", "device-choice"].includes(initialStep)) {
      screen.classList.add("hidden");
      screen.setAttribute("aria-hidden", "true");
      return Promise.resolve();
    }
    screen.classList.remove("hidden");
    screen.setAttribute("aria-hidden", "false");
    completePromise = new Promise((resolve) => {
      finish = resolve;
    });
    unsubscribe = subscribe(windowRef, () => showSynchronized());
    void showInitialStep();
    return completePromise;
  }

  async function showInitialStep() {
    if (["methods", "device-choice"].includes(initialStep)) { showDeviceChoice(); return; }
    if (pairingCode || initialStep === "mobile-code") { showMobileNotice(); return; }
    if (initialStep === "mobile" || detectDevice(windowRef.navigator) === "mobile") { showDiaryConfirmation(); return; }
    if (session.getItem(CHECK_PENDING_KEY) === "true") {
      session.removeItem(CHECK_PENDING_KEY);
      if (await presenceCheck(windowRef)) {
        void reportEvent("extension_detected");
        showGuide();
        return;
      }
    }
    showDiaryConfirmation();
  }

  function showDiaryConfirmation() {
    announceStep("diary");
    content.innerHTML = `
      <p class="onboarding-eyebrow">Подключение дневника</p>
      <h1>Ваш дневник — <span class="service-domain">e&#8209;schools.by</span>?</h1>
      <p>Сейчас School++ переносит данные из электронного дневника <span class="service-domain">e&#8209;schools.by</span>.</p>
      <div class="onboarding-actions">
        <button class="primary-btn" type="button" data-diary-confirm>Да</button>
        <button class="onboarding-secondary" type="button" data-diary-unsupported>Нет, другой дневник</button>
        <button class="onboarding-about" type="button" data-presentation-trigger>Что такое School++?</button>
      </div>`;
  }

  function showUnsupportedDiary() {
    announceStep("unsupported");
    content.innerHTML = `
      <p class="onboarding-eyebrow">Другой дневник</p>
      <h1>Пока мы работаем с <span class="service-domain">e&#8209;schools.by</span></h1>
      <p>Хотите поддержку другого дневника? Оставьте заявку — она поможет понять, что подключать следующим.</p>
      <div class="onboarding-actions onboarding-actions-single">
        <button class="primary-btn" type="button" data-open-diary-request>Оставить заявку</button>
        <button class="onboarding-secondary" type="button" data-diary-back>Вернуться</button>
      </div>`;
  }

  function showDeviceChoice() {
    announceStep("methods");
    content.innerHTML = `
      <h1>Выберите способ подключения</h1>
      <div class="device-choice-grid connection-method-grid">
        ${userscriptSetupUrl ? `<button type="button" data-userscript-choice><img class="connection-method-icon" src="${USERSCRIPTS_ICON}" width="64" height="64" alt=""><strong>Userscripts (рекомендуем)</strong></button>` : ""}
        <button type="button" data-mobile-code><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="15" rx="2"/><path d="M8 22h8m-4-4v4"/></svg><strong>Через компьютер</strong><span>По QR или коду с компьютера</span></button>
        <button type="button" data-device-confirm="desktop"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5h5a1 1 0 0 1 1 1v3h-1a2.5 2.5 0 1 0 0 5h1v7a1 1 0 0 1-1 1h-6v-1a2.5 2.5 0 1 0-5 0v1H3a1 1 0 0 1-1-1v-7h1a2.5 2.5 0 1 0 0-5H2V6a1 1 0 0 1 1-1h6V4a3 3 0 0 1 6 0Z"/></svg><strong>Расширение</strong><span>Chrome, Firefox и др. (рекомендуем для ПК)</span></button>
      </div>`;
  }

  function canTestShortcut() {
    return Boolean(shortcutSetupUrl || userscriptSetupUrl) && isAppleMobile(windowRef.navigator);
  }

  function showMobileEntry() {
    if (!canTestShortcut() || pairingCode) { showMobileNotice(); return; }
    announceStep("mobile");
    if (userscriptSetupUrl) {
      content.innerHTML = `<h1>Подключение через Userscripts</h1><button class="onboarding-about userscripts-other-method" type="button" data-device-change>Другой способ подключения</button>${renderUserscriptsGuide({ syncUrl: userscriptSetupUrl })}`;
      const syncLink = content.querySelector("[data-userscript-setup]");
      syncLink.href = new URL("userscripts-sync.html", new URL(userscriptSetupUrl, windowRef.location.href)).href;
      return;
    }
    content.innerHTML = `
      <p class="onboarding-eyebrow">Команды для Safari · проверка</p>
      <h1>Подключение телефона/планшета</h1>
      <p>Готовим подключение прямо с iPhone и iPad. Сначала проверим доступ к госдневнику через Safari.</p>
      <ol class="ios-shortcut-guide"><li>Создай тестовую Команду по инструкции.</li><li>Открой госдневник в Safari и запусти её через «Поделиться».</li><li>Пришли результат проверки — после этого подключим полный импорт.</li></ol>
      <p class="ios-shortcut-status">Это тест: данные пока не переносятся в School++. Для готового дневника используй подключение по коду.</p>
      <div class="onboarding-actions onboarding-actions-single"><a class="primary-btn" data-shortcut-setup>Настроить тестовую Команду</a><button class="onboarding-secondary" type="button" data-mobile-code>Другой способ подключения</button></div>`;
    content.querySelector("[data-shortcut-setup]").href = shortcutSetupUrl;
  }

  async function showDesktopFlow() {
    announceStep("extension");
    content.innerHTML = `<div class="onboarding-loading" role="status"><i></i><strong>Проверяем расширение…</strong></div>`;
    if (await presenceCheck(windowRef)) {
      void reportEvent("extension_detected");
      showGuide();
      return;
    }
    showExtensionStores();
  }

  function showMobileNotice() {
    announceStep(canTestShortcut() ? "mobile-code" : "mobile");
    content.innerHTML = renderDeviceJoin(pairingCode);
    onMobileOpen();
  }

  function showExtensionStores(message = "") {
    announceStep("extension");
    const browser = detectBrowser(windowRef.navigator);
    const recommended = getRecommendedStore(browser);
    const stores = [
      recommended,
      ...["chromium", "firefox"].filter((item) => item !== recommended),
    ];
    content.innerHTML = `
      <p class="onboarding-eyebrow">Подключение дневника</p>
      <h1>Установите расширение School++</h1>
      <p>Оно перенесёт расписание и отметки из <span class="service-domain">e&#8209;schools.by</span>. Логин и пароль расширение не сохраняет.</p>
      <div class="extension-store-list">${stores
        .map((store, index) => `${index === 1 ? '<div class="store-divider"><span>или</span></div>' : ""}${storeCard(store, storeUrls[store], index === 0)}`)
        .join("")}</div>
      <p class="onboarding-inline-status${message ? " is-visible" : ""}" role="status">${message}</p>
      <button class="onboarding-sticky-action primary-btn" type="button" data-extension-installed>Расширение установлено</button>`;
  }

  async function checkInstalled() {
    const button = content.querySelector("[data-extension-installed]");
    if (button) {
      button.disabled = true;
      button.textContent = "Проверяем…";
    }
    if (await presenceCheck(windowRef)) {
      void reportEvent("extension_detected");
      showGuide();
      return;
    }
    try {
      session.setItem(CHECK_PENDING_KEY, "true");
    } catch {
      /* Reload still gives the extension a chance to attach. */
    }
    windowRef.location.reload();
  }

  async function showGuide() {
    announceStep("guide");
    const snapshot = await snapshotRequest(windowRef, 900);
    if (snapshot) {
      showSynchronized();
      return;
    }
    content.innerHTML = `
      <p class="onboarding-eyebrow">Первая синхронизация</p>
      <h1>Остался один шаг</h1>
      <ol class="sync-guide">
        <li><strong>Откройте <span class="service-domain">e&#8209;schools.by</span></strong><span>Войдите в государственный дневник обычным способом.</span></li>
        <li><strong>Нажмите значок School++</strong><span>Выберите «Синхронизировать» и дождитесь готовности.</span></li>
        <li><strong>Вернитесь сюда</strong><span>Дневник обновится автоматически.</span></li>
      </ol>
      <div class="sync-help"><strong>Если не получается</strong><span>Обновите страницу дневника. При включённом VPN добавьте <span class="service-domain">diary.e&#8209;schools.by</span> в исключения или временно отключите VPN.</span></div>
      <a class="primary-btn onboarding-open-diary" href="https://diary.e-schools.by/" target="_blank" rel="noreferrer">Открыть <span class="service-domain">e&#8209;schools.by</span></a>
      <p class="onboarding-waiting" role="status"><i></i>Ждём первую синхронизацию</p>`;
  }

  function showSynchronized() {
    announceStep("done");
    content.innerHTML = `
      <div class="onboarding-success" aria-hidden="true">✓</div>
      <p class="onboarding-eyebrow">Всё готово</p>
      <h1>Данные синхронизированы</h1>
      <p>School++ запомнит это устройство и откроет дневник сразу при следующем входе.</p>
      <button class="primary-btn" type="button" data-onboarding-complete>Открыть дневник</button>`;
  }

  screen.addEventListener("click", (event) => {
    const syncLink = event.target.closest("[data-userscript-setup]");
    if (syncLink && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      void transitionToUserscriptSync(windowRef, syncLink.href);
      return;
    }
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-diary-confirm]")) {
      if (detectDevice(windowRef.navigator) === "mobile") showMobileEntry();
      else void showDesktopFlow();
    }
    if (target.matches("[data-diary-unsupported]")) showUnsupportedDiary();
    if (target.matches("[data-diary-back]")) showDiaryConfirmation();
    if (target.matches("[data-open-diary-request]")) requestUi.open();
    if (target.matches("[data-close-diary-request]")) requestUi.close();
    if (target.matches("[data-device-change]")) showDeviceChoice();
    if (target.matches("[data-userscript-choice]")) windowRef.location.href = userscriptSetupUrl;
    if (target.matches("[data-mobile-code]")) showMobileNotice();
    if (target.matches("[data-shortcut-preview]")) showMobileEntry();
    if (target.dataset.deviceConfirm === "desktop") void showDesktopFlow();
    if (target.dataset.deviceConfirm === "mobile") showMobileNotice();
    if (target.matches("[data-extension-installed]")) void checkInstalled();
    if (target.matches("[data-onboarding-complete]")) complete();
  });

  requestUi.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (requestUi.submitting) return;
    requestUi.setSubmitting(true);
    requestUi.showLoading();
    const formData = new windowRef.FormData(requestUi.form);
    try {
      await Promise.all([
        requestSubmitter({
          name: formData.get("name"),
          diaryUrl: formData.get("diaryUrl"),
          contact: formData.get("contact"),
        }),
        feedbackDelay(1800),
      ]);
      requestUi.form.reset();
      void reportEvent("diary_request_sent");
      requestUi.showSuccess();
    } catch {
      requestUi.showError(
        "Не удалось отправить заявку. Проверьте соединение и попробуйте ещё раз.",
      );
    } finally {
      requestUi.setSubmitting(false);
    }
  });

  function navigateToStep(step) {
    if (step === "unsupported") showUnsupportedDiary();
    else if (["methods", "device-choice"].includes(step)) showDeviceChoice();
    else if (step === "device-mobile") showMobileNotice();
    else if (step === "device-desktop") void showDesktopFlow();
    else if (step === "mobile") showMobileEntry();
    else if (step === "mobile-code") showMobileNotice();
    else if (step === "extension") void showDesktopFlow();
    else if (step === "guide") void showGuide();
    else if (step === "done") showSynchronized();
    else showDiaryConfirmation();
  }

  return { complete, isComplete, navigateToStep, start };
}

function storeCard(store, url, recommended) {
  const labels = {
    chromium: ["Chrome Web Store", "Chrome, Brave, Opera и другие"],
    firefox: ["Firefox Add-ons", "Mozilla Firefox"],
  };
  const [title, description] = labels[store];
  const unavailableText =
    store === "firefox"
      ? "Появится в ближайшее время"
      : "Ссылка будет добавлена после публикации";
  const body = `<span class="browser-icon is-${store}" aria-hidden="true"><img src="${BROWSER_ICONS[store]}" alt=""></span><span><strong>${title}</strong><small>${url ? description : unavailableText}</small></span>`;
  return url
    ? `<a class="extension-store-card${recommended ? " is-recommended" : ""}" href="${url}" target="_blank" rel="noreferrer">${body}</a>`
    : `<div class="extension-store-card is-unavailable${recommended ? " is-recommended" : ""}" aria-disabled="true">${body}</div>`;
}

function createDiaryRequestPanel(root) {
  const wrapper = root.createElement("div");
  wrapper.innerHTML = `
    <button class="diary-request-backdrop" type="button" data-close-diary-request aria-label="Закрыть заявку" hidden></button>
    <aside class="diary-request-panel" role="dialog" aria-modal="true" aria-labelledby="diaryRequestTitle" hidden>
      <header>
        <div>
          <h2 id="diaryRequestTitle">Оставить заявку</h2>
        </div>
        <button class="support-icon-button" type="button" data-close-diary-request aria-label="Закрыть"><school-icon name="close-outline"></school-icon></button>
      </header>
      <form class="diary-request-form">
        <p>Расскажите, какой дневник нужно добавить. Мы свяжемся с вами, если понадобятся подробности.</p>
        <label><span>Как вас называть</span><input name="name" maxlength="80" autocomplete="name" placeholder="Имя или имя и фамилия" required></label>
        <label><span>Адрес дневника</span><input name="diaryUrl" type="url" maxlength="300" inputmode="url" autocomplete="url" placeholder="https://…" required></label>
        <label><span>Как с вами связаться</span><input name="contact" maxlength="200" autocomplete="email" placeholder="Telegram, почта или телефон" required></label>
        <p class="diary-request-status" role="status" hidden></p>
        <button class="primary-btn" type="submit">Отправить заявку</button>
      </form>
      <section class="diary-request-success" role="status" hidden>
        <i class="diary-request-spinner" aria-hidden="true"></i>
        <span class="diary-request-check" aria-hidden="true">✓</span>
        <h3>Отправляем…</h3>
        <p>Это займёт пару секунд.</p>
        <button class="primary-btn" type="button" data-close-diary-request hidden>Готово</button>
      </section>
    </aside>`;
  const backdrop = wrapper.firstElementChild;
  const panel = wrapper.lastElementChild;
  root.body.append(backdrop, panel);
  const form = panel.querySelector("form");
  const success = panel.querySelector(".diary-request-success");
  const status = panel.querySelector(".diary-request-status");
  const submit = form.querySelector('[type="submit"]');
  let submitting = false;

  backdrop.addEventListener("click", () => {
    if (!submitting) close();
  });
  panel.querySelectorAll("[data-close-diary-request]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!submitting) close();
    });
  });

  function close() {
    backdrop.hidden = true;
    panel.hidden = true;
  }

  return {
    form,
    get submitting() {
      return submitting;
    },
    open() {
      panel.classList.remove("is-submitting", "is-complete");
      panel.querySelector("header").hidden = false;
      form.hidden = false;
      success.hidden = true;
      status.hidden = true;
      backdrop.hidden = false;
      panel.hidden = false;
      form.querySelector("input")?.focus();
    },
    close,
    setSubmitting(value) {
      submitting = value;
      submit.disabled = value;
    },
    showError(message) {
      panel.classList.remove("is-submitting", "is-complete");
      panel.querySelector("header").hidden = false;
      success.hidden = true;
      form.hidden = false;
      status.textContent = message;
      status.hidden = false;
      status.classList.add("is-error");
    },
    showLoading() {
      panel.classList.add("is-submitting");
      panel.classList.remove("is-complete");
      panel.querySelector("header").hidden = true;
      form.hidden = true;
      success.hidden = false;
      success.querySelector("h3").textContent = "Отправляем…";
      success.querySelector("p").textContent = "Это займёт пару секунд.";
      success.querySelector("button").hidden = true;
    },
    showSuccess() {
      panel.classList.remove("is-submitting");
      panel.classList.add("is-complete");
      success.querySelector("h3").textContent = "Отправлено";
      success.querySelector("p").textContent =
        "Заявка появилась у команды поддержки.";
      success.querySelector("button").hidden = false;
      success.hidden = false;
    },
  };
}

export {
  ONBOARDING_KEY,
  createOnboardingController,
  detectBrowser,
  detectDevice,
  isAppleMobile,
  getRecommendedStore,
};
