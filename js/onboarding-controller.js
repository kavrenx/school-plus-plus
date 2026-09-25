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
  if (browser === "edge") return "edge";
  return "chromium";
}

function createOnboardingController({
  root,
  windowRef,
  storeUrls,
  requestSubmitter = async () => {
    throw new Error("DIARY_REQUEST_UNAVAILABLE");
  },
  presenceCheck = requestExtensionPresence,
  snapshotRequest = requestExtensionSnapshot,
  subscribe = subscribeToExtensionSnapshots,
}) {
  const screen = root.getElementById("onboardingScreen");
  const content = root.getElementById("onboardingContent");
  const storage = windowRef.localStorage;
  const session = windowRef.sessionStorage;
  const requestUi = createDiaryRequestPanel(root, screen);
  let finish;
  let unsubscribe = () => {};
  let completePromise;

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
        showGuide();
        return;
      }
    }
    showDiaryConfirmation();
  }

  function showDiaryConfirmation() {
    content.innerHTML = `
      <p class="onboarding-eyebrow">Подключение дневника</p>
      <h1>Ваш дневник — e-schools.by?</h1>
      <p>Сейчас School++ переносит данные из электронного дневника e-schools.by.</p>
      <div class="onboarding-actions">
        <button class="primary-btn" type="button" data-diary-confirm>Да</button>
        <button class="onboarding-secondary" type="button" data-diary-unsupported>Нет, другой дневник</button>
        <button class="onboarding-about" type="button" data-presentation-trigger>Что такое School++?</button>
      </div>`;
  }

  function showUnsupportedDiary() {
    content.innerHTML = `
      <p class="onboarding-eyebrow">Другой дневник</p>
      <h1>Пока мы работаем с e-schools.by</h1>
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
    const stores = [recommended, ...["chromium", "edge", "firefox"].filter((item) => item !== recommended)];
    content.innerHTML = `
      <p class="onboarding-eyebrow">Подключение дневника</p>
      <h1>Установите расширение School++</h1>
      <p>Оно перенесёт расписание и отметки из e.school.by. Логин и пароль расширение не сохраняет.</p>
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
        <li><strong>Откройте e.school.by</strong><span>Войдите в государственный дневник обычным способом.</span></li>
        <li><strong>Нажмите значок School++</strong><span>Выберите «Синхронизировать» и дождитесь готовности.</span></li>
        <li><strong>Вернитесь сюда</strong><span>Дневник обновится автоматически.</span></li>
      </ol>
      <div class="sync-help"><strong>Если не получается</strong><span>Обновите страницу дневника. При включённом VPN добавьте diary.e-schools.by в исключения или временно отключите VPN.</span></div>
      <a class="primary-btn onboarding-open-diary" href="https://diary.e-schools.by/" target="_blank" rel="noreferrer">Открыть e.school.by</a>
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
    requestUi.showStatus("Отправляем заявку…");
    const formData = new windowRef.FormData(requestUi.form);
    try {
      await requestSubmitter({
        name: formData.get("name"),
        diaryUrl: formData.get("diaryUrl"),
        contact: formData.get("contact"),
      });
      requestUi.form.reset();
      requestUi.showSuccess();
    } catch {
      requestUi.showStatus(
        "Не удалось отправить заявку. Проверьте соединение и попробуйте ещё раз.",
        true,
      );
    } finally {
      requestUi.setSubmitting(false);
    }
  });

  return { complete, isComplete, start };
}

function storeCard(store, url, recommended) {
  const labels = {
    chromium: ["Chrome Web Store", "Chrome, Brave и Opera", "C"],
    edge: ["Microsoft Edge Add-ons", "Microsoft Edge", "E"],
    firefox: ["Firefox Add-ons", "Mozilla Firefox", "F"],
  };
  const [title, description, icon] = labels[store];
  const body = `<span class="browser-icon is-${store}" aria-hidden="true">${icon}</span><span><strong>${title}</strong><small>${url ? description : "Ссылка будет добавлена после публикации"}</small></span>${recommended ? '<em>Ваш браузер</em>' : ""}`;
  return url
    ? `<a class="extension-store-card${recommended ? " is-recommended" : ""}" href="${url}" target="_blank" rel="noreferrer">${body}</a>`
    : `<div class="extension-store-card is-unavailable${recommended ? " is-recommended" : ""}" aria-disabled="true">${body}</div>`;
}

function deviceIllustration(device) {
  return device === "desktop"
    ? '<svg viewBox="0 0 180 120"><rect x="24" y="14" width="132" height="78" rx="7"></rect><path d="M72 106h36M82 92v14m16-14v14"></path><path class="accent" d="M53 40h74M53 55h48M53 70h60"></path></svg>'
    : '<svg viewBox="0 0 180 120"><rect x="35" y="17" width="92" height="82" rx="9"></rect><path d="M73 25h16M76 89h10"></path><rect class="device-phone" x="92" y="8" width="54" height="104" rx="10"></rect><path d="M110 18h18M112 101h14"></path><path class="accent" d="M103 43h32M103 57h23M103 71h28"></path></svg>';
}

function createDiaryRequestPanel(root, screen) {
  const wrapper = root.createElement("div");
  wrapper.innerHTML = `
    <button class="diary-request-backdrop" type="button" data-close-diary-request aria-label="Закрыть заявку" hidden></button>
    <aside class="diary-request-panel" role="dialog" aria-modal="true" aria-labelledby="diaryRequestTitle" hidden>
      <header>
        <div>
          <p class="onboarding-eyebrow">Новый дневник</p>
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
      <section class="diary-request-success" hidden>
        <span aria-hidden="true">✓</span>
        <h3>Заявка отправлена</h3>
        <p>Спасибо! Она появилась у команды поддержки.</p>
        <button class="primary-btn" type="button" data-close-diary-request>Готово</button>
      </section>
    </aside>`;
  const backdrop = wrapper.firstElementChild;
  const panel = wrapper.lastElementChild;
  screen.append(backdrop, panel);
  const form = panel.querySelector("form");
  const success = panel.querySelector(".diary-request-success");
  const status = panel.querySelector(".diary-request-status");
  const submit = form.querySelector('[type="submit"]');
  let submitting = false;

  return {
    form,
    get submitting() {
      return submitting;
    },
    open() {
      form.hidden = false;
      success.hidden = true;
      status.hidden = true;
      backdrop.hidden = false;
      panel.hidden = false;
      form.querySelector("input")?.focus();
    },
    close() {
      backdrop.hidden = true;
      panel.hidden = true;
    },
    setSubmitting(value) {
      submitting = value;
      submit.disabled = value;
    },
    showStatus(message, error = false) {
      status.textContent = message;
      status.hidden = false;
      status.classList.toggle("is-error", error);
    },
    showSuccess() {
      form.hidden = true;
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
