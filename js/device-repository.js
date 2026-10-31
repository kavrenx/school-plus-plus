const DEVICE_MESSAGES = {
  pair_rate_limited:
    "Слишком много попыток. Подожди пять минут и попробуй снова.",
  pair_code_invalid:
    "Код неверный, уже использован или истёк. Создай новый код на компьютере.",
  pair_owner_required: "Сначала синхронизируй дневник на этом компьютере.",
  pair_device_limit:
    "Подключено уже пять устройств. Отключи ненужное устройство.",
  pair_same_device: "Открой этот код в другом браузере или на телефоне.",
  pair_device_has_diary:
    "Этот браузер уже подключён к дневнику. Используй другой браузер или сначала отключи его.",
  pair_not_found: "Запрос больше недоступен. Создай новый код.",
  pair_access_required:
    "Доступ к дневнику отключён. Подключи устройство заново.",
  diary_unavailable:
    "Сохранённый дневник пока недоступен. Обнови данные на компьютере.",
  device_label_invalid: "Название должно содержать от 1 до 80 символов.",
  device_not_found: "Устройство уже отключено или недоступно.",
  sign_in_required: "Не удалось подтвердить сеанс. Обнови страницу.",
};

function createDeviceRepository(client, { timeoutMs = 12_000 } = {}) {
  async function call(name, params = {}) {
    let timer, auth;
    try {
      auth = await Promise.race([
        client.auth.getUser(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("auth_timeout")),
            timeoutMs,
          );
        }),
      ]);
      if (auth.error) throw auth.error;
    } catch {
      throw new Error(
        "Не удалось подтвердить сеанс. Проверь соединение и обнови страницу.",
      );
    } finally {
      clearTimeout(timer);
    }
    if (!auth.data?.user) throw new Error(DEVICE_MESSAGES.sign_in_required);
    let request = client.rpc(name, params);
    if (request.abortSignal && globalThis.AbortSignal?.timeout)
      request = request.abortSignal(AbortSignal.timeout(timeoutMs));
    const { data, error } = await request;
    if (error) {
      const unavailable = new Error(
        "Подключение устройств временно недоступно. Проверь соединение и попробуй снова.",
      );
      unavailable.code = error.code;
      throw unavailable;
    }
    if (data?.ok === false) {
      const failed = new Error(
        DEVICE_MESSAGES[data.error] ||
          "Не удалось выполнить действие. Попробуй снова.",
      );
      failed.code = data.error;
      throw failed;
    }
    return data;
  }
  return Object.freeze({
    access: () => call("get_my_diary_access"),
    createPairing: () => call("create_diary_pairing"),
    requestPairing: (code, label) =>
      call("request_diary_pairing", {
        p_code: String(code).replace(/[ -]/g, ""),
        p_label: label,
      }),
    pairing: (id) => call("get_diary_pairing", { p_id: id }),
    respond: (id, approve) =>
      call("respond_diary_pairing", { p_id: id, p_approve: approve === true }),
    cancel: (id) => call("cancel_diary_pairing", { p_id: id }),
    list: () => call("list_diary_devices"),
    rename: (id, label) =>
      call("rename_diary_device", { p_id: id, p_label: String(label).trim() }),
    revoke: (id) => call("revoke_diary_device", { p_id: id }),
    revision: () => call("get_my_diary_revision"),
    readLinked: () => call("get_linked_diary_snapshot"),
    history: () => call("get_my_diary_changes"),
    saveEvents: (events) =>
      call("save_diary_change_events", { p_events: events }),
  });
}

function describeDevice(navigatorRef = {}) {
  const agent = navigatorRef.userAgent || "";
  const system =
    /iPad/i.test(agent) ||
    (/Macintosh/.test(agent) && navigatorRef.maxTouchPoints > 1)
      ? "iPad"
      : /iPhone/.test(agent)
        ? "iPhone"
        : /Android/.test(agent)
          ? "Android"
          : /Windows/.test(agent)
            ? "Windows"
            : /Mac/.test(agent)
              ? "macOS"
              : "устройство";
  const browser = /Firefox/.test(agent)
    ? "Firefox"
    : /Edg/.test(agent)
      ? "Edge"
      : /Chrome/.test(agent)
        ? "Chrome"
        : /Safari/.test(agent)
          ? "Safari"
          : "Браузер";
  return `${browser} · ${system}`;
}

function createDiaryRevisionWatcher({
  repository,
  windowRef,
  initialAccess,
  initialRevision = "",
  initialChangesRevision = "",
  onUpdate,
  onRevoked,
  onHealthy = () => {},
  onError = () => {},
  intervalMs = 5_000,
}) {
  let running = false,
    checking = false,
    timer;
  let revision = initialRevision,
    changesRevision = initialChangesRevision ?? "";
  let access = initialAccess;
  let generation = 0;
  function schedule() {
    windowRef.clearTimeout(timer);
    if (running && !checking && !windowRef.document.hidden)
      timer = windowRef.setTimeout(check, intervalMs);
  }
  async function check() {
    if (!running || checking || windowRef.document.hidden) {
      schedule();
      return;
    }
    const currentGeneration = generation;
    windowRef.clearTimeout(timer);
    checking = true;
    try {
      const next = await repository.revision();
      if (!running || currentGeneration !== generation) return;
      // The SQL RPC returns null before the first history row exists.
      // Treat absent revisions alike without hiding a real history change.
      const nextChangesRevision = next.changesUpdatedAt ?? "";
      if (
        access?.role === "linked" &&
        (next.access?.role !== "linked" ||
          next.access?.ownerId !== access.ownerId)
      ) {
        stop();
        await onRevoked();
        return;
      }
      if (
        next.updatedAt &&
        (next.updatedAt !== revision ||
          nextChangesRevision !== changesRevision)
      ) {
        await onUpdate(next.access);
        if (!running || currentGeneration !== generation) return;
        revision = next.updatedAt;
        changesRevision = nextChangesRevision;
      }
      access = next.access;
      onHealthy();
    } catch (error) {
      if (running && currentGeneration === generation) onError(error);
    } finally {
      if (currentGeneration === generation) {
        checking = false;
        schedule();
      }
    }
  }
  function wake() {
    windowRef.clearTimeout(timer);
    if (!windowRef.document.hidden) void check();
  }
  function start() {
    if (running) return;
    running = true;
    windowRef.document.addEventListener("visibilitychange", wake);
    windowRef.addEventListener("online", wake);
    schedule();
  }
  function stop() {
    running = false;
    generation++;
    checking = false;
    windowRef.clearTimeout(timer);
    windowRef.document.removeEventListener("visibilitychange", wake);
    windowRef.removeEventListener("online", wake);
  }
  return { start, stop, check };
}

export { createDeviceRepository, describeDevice, createDiaryRevisionWatcher };
