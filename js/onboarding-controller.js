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
  presenceCheck = requestExtensionPresence,
  snapshotRequest = requestExtensionSnapshot,
  subscribe = subscribeToExtensionSnapshots,
}) {
  const screen = root.getElementById("onboardingScreen");
  const content = root.getElementById("onboardingContent");
  const storage = windowRef.localStorage;
  const session = windowRef.sessionStorage;
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
    showDeviceConfirmation(detectDevice(windowRef.navigator));
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
      <div class="onboarding-actions"><button class="onboarding-secondary" type="button" data-device-change>Выбрать другое устройство</button></div>`;
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

  content.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.matches("[data-device-change]")) showDeviceChoice();
    if (target.dataset.deviceConfirm === "desktop") void showDesktopFlow();
    if (target.dataset.deviceConfirm === "mobile") showMobileNotice();
    if (target.matches("[data-extension-installed]")) void checkInstalled();
    if (target.matches("[data-onboarding-complete]")) complete();
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
    : '<svg viewBox="0 0 180 120"><rect x="60" y="8" width="60" height="104" rx="10"></rect><path d="M82 18h16M85 101h10"></path><path class="accent" d="M73 42h34M73 56h24M73 70h29"></path></svg>';
}

export {
  ONBOARDING_KEY,
  createOnboardingController,
  detectBrowser,
  detectDevice,
  getRecommendedStore,
};
