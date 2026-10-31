import { escapeHtml as e } from "./ui-utils.js";
import { describeDevice } from "./device-repository.js";
import { createModalController } from "./modal-controller.js";

const PENDING_KEY = "schoolpp_device_pending_v1";

function renderDeviceJoin(code = "") {
  return `<h1>Подключение по коду</h1><p>На компьютере открой «Мои устройства», создай код и введи его здесь.</p><form class="device-join-form" data-device-join><label>Код подключения<input name="code" value="${e(code)}" inputmode="numeric" autocomplete="off" maxlength="11" placeholder="1234 5678" required></label><button class="primary-btn" type="submit">Подключиться</button></form><div class="device-join-status" data-device-join-status role="status"></div><button type="button" class="onboarding-secondary" data-device-change>Другой способ подключения</button>`;
}

function pairingUrl(origin, code) {
  const url = new URL(origin);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Не удалось создать ссылку подключения.");
  url.search = "";
  url.hash = `connect/mobile?pair=${encodeURIComponent(code)}`;
  return url.href;
}

function createDeviceController({
  root,
  windowRef,
  repositoryProvider,
  prepareOwner = async () => {},
  onPaired = async () => {},
  onDisconnected = async () => {},
  origin = windowRef.location.origin,
  now = () => Date.now(),
  loadQrCode = async () => (await import("qrcode")).default,
}) {
  const wrapper = root.createElement("div");
  wrapper.className = "modal-overlay hidden device-modal";
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.innerHTML =
    '<section class="modal-card device-modal-card" role="dialog" aria-modal="true" aria-labelledby="devicesTitle"><header><h2 id="devicesTitle">Мои устройства</h2><button type="button" data-device-close aria-label="Закрыть">×</button></header><div data-device-content></div><p class="device-panel-error" data-device-error role="status" hidden></p></section>';
  root.body.append(wrapper);
  const modal = createModalController({ documentRoot: root });
  const content = wrapper.querySelector("[data-device-content]");
  const error = wrapper.querySelector("[data-device-error]");
  let repository,
    ownerPair = null,
    clientPair = null,
    running = false,
    watching = false,
    busy = false,
    joining = false,
    finishing = false,
    timer,
    expiryTimer;
  let pendingShown = "";
  const isOpen = () =>
    !wrapper.classList.contains("hidden") &&
    !wrapper.classList.contains("is-closing");
  async function getRepository() {
    repository ||= await repositoryProvider();
    return repository;
  }
  function fail(cause) {
    error.textContent = cause.message || "Не удалось выполнить действие.";
    error.hidden = false;
  }
  function joinMessage(text) {
    const node = root.querySelector("[data-device-join-status]");
    if (node) node.textContent = text;
  }
  function showPair(pair) {
    ownerPair = pair;
    if (pair.status === "pending") {
      content.innerHTML = `<div class="device-confirm"><p>${e(pair.label || "Другое устройство")} хочет подключиться к твоему дневнику.</p><p>Проверь, что на телефоне тот же код:</p><strong class="device-verification">${e(pair.verificationCode)}</strong><div class="device-confirm-actions"><button class="primary-btn" type="button" data-device-approve>Разрешить</button><button class="onboarding-secondary" type="button" data-device-reject>Отклонить</button></div></div>`;
      if (!isOpen()) modal.open(wrapper);
    }
  }
  function showList(data) {
    if (data.access?.role === "linked") {
      content.innerHTML =
        "<p>Этот браузер подключён к твоему дневнику. Управление подключениями доступно на компьютере.</p>";
      return;
    }
    content.innerHTML = `<p>Подключённый телефон сможет читать дневник. Новые данные получает расширение на компьютере.</p><button class="primary-btn" type="button" data-device-create>Подключить устройство</button><h3>Подключённые устройства</h3>${data.devices?.length ? `<ul class="device-list">${data.devices.map((device) => `<li><form data-device-rename="${e(device.id)}"><label>Название<input name="label" maxlength="80" value="${e(device.label)}" required></label><button type="submit">Сохранить</button></form><small>Подключено: ${e(formatTime(device.createdAt))}<br>Последний доступ: ${e(formatTime(device.lastSeenAt))}</small><button class="device-revoke" type="button" data-device-revoke="${e(device.id)}">Отключить</button></li>`).join("")}</ul>` : '<p class="achievement-note">Других устройств пока нет.</p>'}`;
  }
  async function open() {
    modal.open(wrapper);
    error.hidden = true;
    content.innerHTML = '<p role="status">Загружаем устройства…</p>';
    try {
      await prepareOwner();
      const data = await (await getRepository()).list();
      if (data.pending) showPair(data.pending);
      else showList(data);
      start();
    } catch (cause) {
      fail(cause);
      content.innerHTML =
        '<button class="onboarding-secondary" type="button" data-device-refresh>Попробовать снова</button>';
    }
  }
  async function createPair() {
    const button = content.querySelector("[data-device-create]");
    const label = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = "Готовим QR-код…";
    }
    try {
      let QRCode;
      try {
        QRCode = await loadQrCode();
      } catch {
        throw new Error(
          "Не удалось загрузить QR-код. Проверь интернет и попробуй снова.",
        );
      }
      // Closing or reopening the panel during the download cancels this action
      // before any pairing request is created on the server.
      if (!isOpen() || !button?.isConnected) return;
      const pair = await (await getRepository()).createPairing();
      ownerPair = pair;
      const url = pairingUrl(origin, pair.code);
      const qr = await QRCode.toString(url, {
        type: "svg",
        width: 240,
        margin: 4,
        errorCorrectionLevel: "M",
        color: { dark: "#202721", light: "#fffdf8" },
      });
      content.innerHTML = `<div class="device-pair-code"><p>Отсканируй QR камерой телефона или введи код на сайте.</p><div class="device-qr">${qr}</div><strong>${e(pair.code.slice(0, 4))} ${e(pair.code.slice(4))}</strong><p class="device-expiry" data-device-expiry></p><a href="${e(url)}" target="_blank" rel="noreferrer">Открыть ссылку подключения</a><button class="onboarding-secondary" type="button" data-device-cancel>Отменить подключение</button></div>`;
      updateExpiry();
      start();
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = label;
      }
    }
  }
  function updateExpiry() {
    const node = content.querySelector("[data-device-expiry]");
    if (!node || !ownerPair?.expiresAt) return false;
    const seconds = Math.max(
      0,
      Math.ceil((Date.parse(ownerPair.expiresAt) - now()) / 1000),
    );
    node.textContent = seconds
      ? `Код действует ещё ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
      : "Код истёк. Создай новый.";
    return seconds > 0;
  }
  function tickExpiry() {
    windowRef.clearTimeout(expiryTimer);
    expiryTimer = null;
    if (!running || windowRef.document.hidden || !isOpen()) return;
    if (updateExpiry()) expiryTimer = windowRef.setTimeout(tickExpiry, 1000);
  }
  function clearClientPair() {
    clientPair = null;
    try {
      windowRef.sessionStorage.removeItem(PENDING_KEY);
    } catch {
      /* The server still expires pending requests. */
    }
  }
  function showClientPair(pair) {
    joining = true;
    const form = root.querySelector("[data-device-join]");
    if (form) form.hidden = true;
    const node = root.querySelector("[data-device-join-status]");
    if (
      node &&
      node.querySelector(".device-verification")?.textContent !==
        pair.verificationCode
    )
      node.innerHTML = `<p>Подтверди подключение на компьютере. Сверь код:</p><strong class="device-verification">${e(pair.verificationCode)}</strong><p>Ждём подтверждение…</p>`;
  }
  async function watch() {
    windowRef.clearTimeout(timer);
    if (!running || watching || busy || windowRef.document.hidden) {
      schedule();
      return;
    }
    watching = true;
    try {
      const repo = await getRepository();
      if (clientPair) {
        const pair = await repo.pairing(clientPair.id);
        if (!running || busy) return;
        if (pair.status === "pending") showClientPair(pair);
        if (pair.status === "approved" && !finishing) {
          finishing = true;
          try {
            await onPaired();
            clearClientPair();
            stop();
          } catch (cause) {
            finishing = false;
            joinMessage(
              cause.message ||
                "Не удалось загрузить дневник. Проверь соединение.",
            );
          }
        } else if (
          ["expired", "rejected", "cancelled", "revoked"].includes(pair.status)
        ) {
          clearClientPair();
          joining = false;
          const form = root.querySelector("[data-device-join]");
          if (form) form.hidden = false;
          joinMessage(
            pair.status === "rejected"
              ? "Компьютер отклонил запрос. Проверь код и попробуй снова."
              : "Запрос больше не действует. Создай новый код на компьютере.",
          );
        }
      } else if (ownerPair) {
        const pair = await repo.pairing(ownerPair.id);
        if (!running || busy) return;
        if (pair.status === "pending" && ownerPair.status !== "pending") {
          pendingShown = pair.id;
          showPair(pair);
        }
        if (
          ["approved", "rejected", "cancelled", "expired"].includes(pair.status)
        ) {
          ownerPair = null;
          if (isOpen()) {
            showList(await repo.list());
            if (pair.status === "expired")
              fail(new Error("Код истёк. Создай новый код подключения."));
          }
        }
      } else {
        const data = await repo.list();
        if (running && data.pending && pendingShown !== data.pending.id) {
          pendingShown = data.pending.id;
          showPair(data.pending);
        }
      }
    } catch (cause) {
      if (running && clientPair && cause.code === "pair_not_found") {
        clearClientPair();
        joining = false;
        const form = root.querySelector("[data-device-join]");
        if (form) form.hidden = false;
        joinMessage(
          "Запрос больше не действует. Создай новый код на компьютере.",
        );
      } else if (running && clientPair)
        joinMessage(
          `Ждём соединение. ${cause.message || "Попробуй снова позже."}`,
        );
      else if (running && isOpen()) fail(cause);
    } finally {
      watching = false;
      schedule();
    }
  }
  function schedule() {
    windowRef.clearTimeout(timer);
    if (running && !watching && !windowRef.document.hidden)
      timer = windowRef.setTimeout(
        watch,
        clientPair || ownerPair ? 2000 : 10000,
      );
  }
  function start() {
    if (!running) {
      running = true;
      schedule();
    }
    tickExpiry();
  }
  function stop() {
    running = false;
    windowRef.clearTimeout(timer);
    windowRef.clearTimeout(expiryTimer);
  }
  async function resumeClient() {
    try {
      const id = windowRef.sessionStorage.getItem(PENDING_KEY);
      if (id) {
        clientPair = { id };
        start();
        await watch();
      }
    } catch {
      /* A fresh code is still available. */
    }
  }
  function bind() {
    root
      .getElementById("studentDevicesButton")
      ?.addEventListener("click", open);
    root.addEventListener("submit", async (event) => {
      const join = event.target.closest("[data-device-join]");
      const rename = event.target.closest("[data-device-rename]");
      if (!join && !rename) return;
      event.preventDefault();
      if (join) {
        if (joining) return;
        const code = new windowRef.FormData(join)
          .get("code")
          .replace(/[ -]/g, "");
        if (!/^\d{8}$/.test(code)) {
          joinMessage("Введи восьмизначный код с компьютера.");
          return;
        }
        joining = true;
        const button = join.querySelector("button");
        button.disabled = true;
        joinMessage("Отправляем запрос…");
        try {
          const pair = await (
            await getRepository()
          ).requestPairing(code, describeDevice(windowRef.navigator));
          clientPair = pair;
          try {
            windowRef.sessionStorage.setItem(PENDING_KEY, pair.id);
          } catch {
            /* This tab can complete without storage. */
          }
          showClientPair(pair);
          start();
        } catch (cause) {
          joining = false;
          joinMessage(cause.message);
        } finally {
          if (button.isConnected) button.disabled = false;
        }
        return;
      }
      if (busy) return;
      busy = true;
      try {
        await (
          await getRepository()
        ).rename(
          rename.dataset.deviceRename,
          new windowRef.FormData(rename).get("label"),
        );
        error.hidden = true;
      } catch (cause) {
        fail(cause);
      } finally {
        busy = false;
      }
    });
    wrapper.addEventListener("click", async (event) => {
      if (
        event.target === wrapper ||
        event.target.closest("[data-device-close]")
      ) {
        modal.close(wrapper);
        windowRef.clearTimeout(expiryTimer);
        return;
      }
      if (busy || !event.target.closest("button")) return;
      busy = true;
      error.hidden = true;
      try {
        if (event.target.closest("[data-device-create]")) await createPair();
        else if (event.target.closest("[data-device-refresh]")) await open();
        else if (event.target.closest("[data-device-cancel]")) {
          if (ownerPair) await (await getRepository()).cancel(ownerPair.id);
          ownerPair = null;
          showList(await repository.list());
        } else if (
          event.target.closest("[data-device-approve], [data-device-reject]")
        ) {
          await (
            await getRepository()
          ).respond(
            ownerPair.id,
            Boolean(event.target.closest("[data-device-approve]")),
          );
          ownerPair = null;
          showList(await repository.list());
        } else {
          const revoke = event.target.closest("[data-device-revoke]");
          if (revoke) {
            const current = await (await getRepository()).access();
            await repository.revoke(revoke.dataset.deviceRevoke);
            if (current.role === "linked") {
              stop();
              modal.close(wrapper);
              await onDisconnected();
            } else showList(await repository.list());
          }
        }
      } catch (cause) {
        fail(cause);
      } finally {
        busy = false;
      }
    });
    root.addEventListener("click", (event) => {
      if (event.target.closest("[data-device-change]") && clientPair) {
        const id = clientPair.id;
        clearClientPair();
        joining = false;
        stop();
        void getRepository()
          .then((repo) => repo.cancel(id))
          .catch(() => {});
      }
    });
    root.addEventListener("keydown", (event) => {
      if (isOpen()) modal.handleKeydown(event);
    });
    let resumeOnShow = false;
    windowRef.addEventListener("pagehide", () => {
      resumeOnShow = running;
      stop();
    });
    windowRef.addEventListener("pageshow", (event) => {
      if (event.persisted && resumeOnShow) {
        start();
        void watch();
      }
    });
    windowRef.document.addEventListener("visibilitychange", () => {
      tickExpiry();
      windowRef.clearTimeout(timer);
      if (!windowRef.document.hidden && running) void watch();
    });
  }
  return { bind, start, stop, open, resumeClient, check: watch };
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("ru-RU", {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}

export { createDeviceController, renderDeviceJoin, pairingUrl };
