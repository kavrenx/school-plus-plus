import {
  requestExtensionPresence,
  requestExtensionSnapshot,
  subscribeToExtensionSnapshots,
} from "./extension-import.js";

const ONBOARDING_KEY = "schoolpp_onboarding_complete_v1";
const CHECK_PENDING_KEY = "schoolpp_extension_check_pending";

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
}) {
  const screen = root.getElementById("onboardingScreen");
  const content = root.getElementById("onboardingContent");
  const storage = windowRef.localStorage;
  const session = windowRef.sessionStorage;
  const requestUi = createDiaryRequestPanel(root);
  let finish;
  let unsubscribe = () => {};
  let completePromise;

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
    if (isComplete()) {
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
    content.innerHTML = `
      <p class="onboarding-eyebrow">Другой дневник</p>
      <h1>Пока мы работаем с <span class="service-domain">e&#8209;schools.by</span></h1>
      <p>Хотите поддержку другого дневника? Оставьте заявку — она поможет понять, что подключать следующим.</p>
      <div class="onboarding-actions onboarding-actions-single">
        <button class="primary-btn" type="button" data-open-diary-request>Оставить заявку</button>
        <button class="onboarding-secondary" type="button" data-diary-back>Вернуться</button>
      </div>`;
  }

  function showDeviceConfirmation(device) {
    const desktop = device === "desktop";
    content.innerHTML = `
      <div class="onboarding-visual" aria-hidden="true">${deviceIllustration(device)}</div>
      <p class="onboarding-eyebrow">Первый запуск</p>
      <h1>Ваше устройство — ${desktop ? "компьютер" : "телефон или планшет"}?</h1>
      <p>Подберём способ подключения School++.</p>
      <div class="onboarding-actions">
        <button class="primary-btn" type="button" data-device-confirm="${device}">Да</button>
        <button class="onboarding-secondary" type="button" data-device-change>Нет, выбрать другое</button>
        <button class="onboarding-about" type="button" data-presentation-trigger>Что такое School++?</button>
      </div>`;
  }

  function showDeviceChoice() {
    content.innerHTML = `
      <p class="onboarding-eyebrow">Выберите устройство</p>
      <h1>Где вы открываете School++?</h1>
      <div class="device-choice-grid">
        <button type="button" data-device-confirm="desktop">${deviceIllustration("desktop")}<strong>Компьютер</strong><span>Windows, macOS или Linux</span></button>
        <button type="button" data-device-confirm="mobile">${deviceIllustration("mobile")}<strong>Телефон или планшет</strong><span>Android или iOS</span></button>
      </div>`;
  }

  async function showDesktopFlow() {
    content.innerHTML = `<div class="onboarding-loading" role="status"><i></i><strong>Проверяем расширение…</strong></div>`;
    if (await presenceCheck(windowRef)) {
      void reportEvent("extension_detected");
      showGuide();
      return;
    }
    showExtensionStores();
  }

  function showMobileNotice() {
    content.innerHTML = `
      <div class="onboarding-visual" aria-hidden="true">${deviceIllustration("mobile")}</div>
      <p class="onboarding-eyebrow">Мобильная версия</p>
      <h1>Сейчас School++ подключается на компьютере</h1>
      <p>Поддержку телефона и планшета добавим отдельно. Для подключения данных пока понадобится компьютер.</p>
      <div class="onboarding-actions onboarding-actions-single"><button class="onboarding-secondary" type="button" data-device-change>Выбрать другое устройство</button></div>`;
  }

  function showExtensionStores(message = "") {
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
    content.innerHTML = `
      <div class="onboarding-success" aria-hidden="true">✓</div>
      <p class="onboarding-eyebrow">Всё готово</p>
      <h1>Данные синхронизированы</h1>
      <p>School++ запомнит это устройство и откроет дневник сразу при следующем входе.</p>
      <button class="primary-btn" type="button" data-onboarding-complete>Открыть дневник</button>`;
  }

  screen.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-diary-confirm]"))
      showDeviceConfirmation(detectDevice(windowRef.navigator));
    if (target.matches("[data-diary-unsupported]")) showUnsupportedDiary();
    if (target.matches("[data-diary-back]")) showDiaryConfirmation();
    if (target.matches("[data-open-diary-request]")) requestUi.open();
    if (target.matches("[data-close-diary-request]")) requestUi.close();
    if (target.matches("[data-device-change]")) showDeviceChoice();
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

  return { complete, isComplete, start };
}

function storeCard(store, url, recommended) {
  const labels = {
    chromium: ["Chrome Web Store", "Chrome, Brave, Opera и другие"],
    firefox: ["Firefox Add-ons", "Mozilla Firefox"],
  };
  const [title, description] = labels[store];
  const body = `<span class="browser-icon is-${store}" aria-hidden="true">${browserIcon(store)}</span><span><strong>${title}</strong><small>${url ? description : "Ссылка будет добавлена после публикации"}</small></span>`;
  return url
    ? `<a class="extension-store-card${recommended ? " is-recommended" : ""}" href="${url}" target="_blank" rel="noreferrer">${body}</a>`
    : `<div class="extension-store-card is-unavailable${recommended ? " is-recommended" : ""}" aria-disabled="true">${body}</div>`;
}

function browserIcon(store) {
  if (store === "firefox") {
    return `<svg viewBox="0 0 48 48" focusable="false"><defs><linearGradient id="firefox-tail" x1="9" y1="7" x2="39" y2="40" gradientUnits="userSpaceOnUse"><stop stop-color="#ffea00"/><stop offset=".42" stop-color="#ff7a00"/><stop offset="1" stop-color="#8b2ee8"/></linearGradient></defs><circle cx="24" cy="25" r="16" fill="#3154c9"/><path fill="url(#firefox-tail)" d="M42 15c-2-5-7-9-13-10 3 2 5 5 5 8-4-3-9-4-14-2-5 2-8 7-8 12 0 8 6 14 14 14 6 0 11-4 13-9-1 10-9 17-19 17C10 45 3 37 3 27c0-7 4-13 9-17-1 3 0 6 2 8 2-8 10-14 19-12 4 1 7 4 9 9Z"/><path fill="#fff" opacity=".92" d="M18 25c0-4 3-7 7-7 3 0 5 1 7 3-1-5-5-8-10-8-6 0-11 5-11 11 0 7 6 13 13 13 5 0 9-3 11-7-2 2-5 3-8 3-5 0-9-3-9-8Z"/></svg>`;
  }
  return `<svg viewBox="0 0 48 48" focusable="false"><path fill="#db4437" d="M24 4a20 20 0 0 1 17.3 10H24a10 10 0 0 0-8.7 5L9.5 9A19.9 19.9 0 0 1 24 4Z"/><path fill="#f4b400" d="M9.5 9 19 25.5A10 10 0 0 0 24 34l-5.8 10A20 20 0 0 1 9.5 9Z"/><path fill="#0f9d58" d="M18.2 44 24 34a10 10 0 0 0 8.7-5l8.6-15A20 20 0 0 1 18.2 44Z"/><circle cx="24" cy="24" r="9" fill="#fff"/><circle cx="24" cy="24" r="7" fill="#4285f4"/></svg>`;
}

function deviceIllustration(device) {
  return device === "desktop"
    ? '<svg viewBox="0 0 180 120"><rect x="24" y="14" width="132" height="78" rx="7"></rect><path d="M72 106h36M82 92v14m16-14v14"></path><path class="accent" d="M53 40h74M53 55h48M53 70h60"></path></svg>'
    : '<svg viewBox="0 0 180 120"><rect x="35" y="17" width="92" height="82" rx="9"></rect><path d="M73 25h16M76 89h10"></path><rect class="device-phone" x="92" y="8" width="54" height="104" rx="10"></rect><path d="M110 18h18M112 101h14"></path><path class="accent" d="M103 43h32M103 57h23M103 71h28"></path></svg>';
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
  getRecommendedStore,
};
