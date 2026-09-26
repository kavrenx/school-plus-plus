function maintenanceMarkup() {
  return `
    <main class="status-page-shell">
      <header class="status-page-header">
        <a class="brand-mark" href="/" aria-label="School++ — на главную">SCHOOL++</a>
      </header>
      <section class="status-page-content">
        <h1>Скоро вернёмся</h1>
        <p>Сейчас мы обновляем School++, чтобы дневник работал стабильнее. Данные пользователей сохранены — нужно только немного подождать.</p>
        <div class="status-page-actions">
          <button class="primary-btn" type="button" data-status-reload>Проверить снова</button>
          <a href="mailto:support@schoolpp.com">Написать в поддержку</a>
        </div>
      </section>
    </main>`;
}

function renderMaintenancePage(root, options = {}) {
  root.title = "Технические работы · School++";
  root.body.className = "status-page";
  root.body.innerHTML = maintenanceMarkup(options);
  root.querySelector("[data-status-reload]")?.addEventListener("click", () =>
    root.defaultView?.location.reload(),
  );
}

function setMaintenanceNotice(root, enabled) {
  let notice = root.getElementById("maintenanceNotice");
  if (!notice) {
    notice = root.createElement("div");
    notice.id = "maintenanceNotice";
    notice.className = "maintenance-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.innerHTML =
      "<strong>Начались технические работы.</strong> После обновления откроется служебная страница.";
    root.body.append(notice);
  }
  notice.hidden = !enabled;
}

export { maintenanceMarkup, renderMaintenancePage, setMaintenanceNotice };
