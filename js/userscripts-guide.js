const USERSCRIPTS_ICON = new URL(
  "../assets/userscripts-icon.webp",
  import.meta.url,
).href;
const screenshots = [
  [
    new URL("../assets/userscripts-guide/step-01.jpg", import.meta.url).href,
    1206,
    1206,
    "Userscripts в App Store",
  ],
  [
    new URL("../assets/userscripts-guide/step-02.jpg", import.meta.url).href,
    1206,
    446,
    "Кнопка меню Safari слева от адреса",
  ],
  [
    new URL("../assets/userscripts-guide/step-03.jpg", import.meta.url).href,
    1206,
    903,
    "Userscripts в меню Safari",
  ],
  [
    new URL("../assets/userscripts-guide/step-04.jpg", import.meta.url).href,
    964,
    1198,
    "Кнопка «Разрешать всегда…»",
  ],
  [
    new URL("../assets/userscripts-guide/step-05.jpg", import.meta.url).href,
    965,
    1189,
    "Кнопка «Разрешать всегда на каждом сайте»",
  ],
  [
    new URL("../assets/userscripts-guide/step-06.jpg", import.meta.url).href,
    1108,
    1280,
    "Меню Userscripts с галочкой справа вверху",
  ],
  [
    new URL("../assets/userscripts-guide/step-07.jpg", import.meta.url).href,
    1206,
    652,
    "Меню Safari на странице с кодом School++",
  ],
  [
    new URL("../assets/userscripts-guide/step-08.jpg", import.meta.url).href,
    1206,
    878,
    "Userscripts с синей иконкой в меню Safari",
  ],
  [
    new URL("../assets/userscripts-guide/step-09.jpg", import.meta.url).href,
    1083,
    1280,
    "Предложение установить скрипт: Tap to install",
  ],
  [
    new URL("../assets/userscripts-guide/step-10.jpg", import.meta.url).href,
    1206,
    1159,
    "Кнопка Install внизу окна установки",
  ],
];

function screenshot(index, reinstall = false) {
  const [src, width, height, alt] = reinstall
    ? [
        new URL("../assets/userscripts-guide/addit-step.jpg", import.meta.url).href,
        1097,
        1280,
        "Предложение обновить установленный скрипт: Tap to re-install",
      ]
    : screenshots[index];
  return `<img class="userscripts-guide-image" src="${src}" width="${width}" height="${height}" alt="${alt}" loading="lazy" decoding="async">`;
}

function renderUserscriptsGuide({ syncUrl = "" } = {}) {
  return `<div class="userscripts-guide">
    <p class="userscripts-guide-intro">Коротко о том, как настроить синхронизацию дневника в Safari.</p>
    <ol class="userscripts-guide-steps" role="list">
      <li>
        <p>Скачайте <strong>Userscripts</strong> и один раз откройте приложение.</p>
        <a class="extension-store-card userscripts-store-card" href="https://apps.apple.com/by/app/userscripts/id1463298887" target="_blank" rel="noreferrer">
          <img src="${USERSCRIPTS_ICON}" width="56" height="56" alt="">
          <span><strong>Userscripts</strong><small>Бесплатно в App Store</small></span>
          <span class="userscripts-store-arrow" aria-hidden="true">↗</span>
        </a>
        ${screenshot(0)}
      </li>
      <li><p>Вернитесь в Safari. Нажмите на <strong>три полоски</strong> слева от адреса.</p>${screenshot(1)}</li>
      <li><p>В меню нажмите <strong>Userscripts</strong>.</p>${screenshot(2)}</li>
      <li><p>Нажмите <strong>«Разрешать всегда…»</strong>.</p>${screenshot(3)}</li>
      <li><p>Затем — <strong>«Разрешать всегда на каждом сайте»</strong>.</p>${screenshot(4)}</li>
      <li><p>Откроется меню Userscripts. Закройте его <strong>галочкой справа вверху</strong>.</p>${screenshot(5)}</li>
      <li>
        <p>Откройте код расширения для Userscripts кнопкой ниже.</p>
        <p class="userscripts-install-notice"><strong>Перед тем как переходить, прочтите пункты 7–10.</strong></p>
        <a id="installUserscript" class="primary-btn userscripts-install" href="./schoolpp.user.js" target="_blank" rel="noopener">Открыть код расширения</a>
        <p>Через пару секунд внизу слева появится значок с полосками и пазликом. Нажмите на него.</p>
        ${screenshot(6)}
      </li>
      <li><p>Нажмите <strong>Userscripts с синей иконкой</strong>.</p>${screenshot(7)}</li>
      <li><p>В окне Userscripts нажмите <strong>«Tap to install»</strong>.</p>${screenshot(8)}</li>
      <li><p>Пролистните вниз и нажмите <strong>Install</strong>. После установки закройте вкладку с кодом и вернитесь сюда.</p>${screenshot(9)}</li>
    </ol>
    <section class="userscripts-ready" aria-labelledby="userscriptsReadyTitle">
      <h2 id="userscriptsReadyTitle">Готово! Теперь можно синхронизировать ваш дневник со School++.</h2>
      ${
        syncUrl
          ? `<a class="primary-btn" data-userscript-setup href="${syncUrl}">Синхронизировать и войти</a>`
          : '<button class="primary-btn" id="startUserscript" type="button">Синхронизировать и войти</button>'
      }
      <p class="userscripts-once">Настройка нужна только один раз. Дальше School++ будет обновлять данные автоматически при входе. Если госдневник попросит войти — войдите в него.</p>
    </section>
  </div>`;
}

function renderUserscriptsUpdateGuide() {
  return `<div class="userscripts-guide">
    <p class="userscripts-guide-intro">Похоже, у вас старая версия скрипта для нашего дневника. Покажем, как её обновить.</p>
    <p class="userscripts-install-notice"><strong>Прочтите пункты 1–4, затем откройте код кнопкой ниже.</strong></p>
    <ol class="userscripts-guide-steps" role="list">
      <li><p>На странице с кодом через пару секунд появится значок с полосками и пазликом. Нажмите на него.</p>${screenshot(6)}</li>
      <li><p>Нажмите <strong>Userscripts с синей иконкой</strong>.</p>${screenshot(7)}</li>
      <li><p>В окне Userscripts нажмите <strong>«Tap to re-install»</strong>.</p>${screenshot(8, true)}</li>
      <li><p>Пролистните вниз и нажмите <strong>Install</strong>.</p>${screenshot(9)}</li>
      <li><p>После установки закройте вкладку с кодом и вернитесь сюда.</p></li>
    </ol>
    <a id="installUserscript" class="primary-btn userscripts-install" href="./schoolpp.user.js" target="_blank" rel="noopener">Открыть код для обновления</a>
    <section class="userscripts-ready" aria-labelledby="userscriptsReadyTitle">
      <h2 id="userscriptsReadyTitle">Готово! Теперь можно снова синхронизировать дневник со School++.</h2>
      <button class="primary-btn" id="startUserscript" type="button">Синхронизировать дневник</button>
    </section>
  </div>`;
}

export { renderUserscriptsGuide, renderUserscriptsUpdateGuide, USERSCRIPTS_ICON };
