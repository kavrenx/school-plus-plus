import { readIOSShortcutExport } from "./ios-shortcut-preview.js";

const TEST_CACHE = "schoolpp_userscript_test_v1";
const TEST_PENDING = "schoolpp_userscript_pending_v1";
const TEST_ATTEMPT = "schoolpp_userscript_attempt_v1";
const USERSCRIPT_CACHE = "schoolpp_userscript_diary_v1";
const USERSCRIPT_PENDING = "schoolpp_userscript_pending_v2";
const USERSCRIPT_ATTEMPT = "schoolpp_userscript_attempt_v2";
const TEST_MAX_AGE = 7 * 86400000;
const MESSAGES = {
  bridge_no_response:
    "School++ не получил ответ от Userscripts. Проверь установку скрипта, разрешение для этого сайта и перезагрузи страницу.",
  startup_failed:
    "Скрипт начал запуск, но не смог завершить его. Обнови скрипт и перезагрузи страницу; если ошибка повторится, пришли короткий отчёт.",
  unsupported_manager:
    "В этой версии Userscripts недоступны нужные функции. Обнови приложение.",
  storage_unavailable:
    "Userscripts не смог сохранить результат. Проверь доступ расширения и повтори попытку.",
  busy: "Обновление уже запущено. Вернись к нему или отмени текущую попытку.",
  job_unavailable:
    "Попытка больше недоступна. Запусти обновление заново в этой же вкладке.",
  job_expired:
    "Время ожидания закончилось. Открой дневник, проверь соединение и повтори обновление.",
  cancelled: "Обновление отменено. Предыдущие данные сохранены.",
  invalid_result:
    "Скрипт вернул неожиданный результат. Предыдущие данные сохранены.",
  collection_failed:
    "Не удалось собрать все данные. Предыдущий дневник сохранён. Проверь соединение и попробуй снова.",
};
function userscriptMessage(code) {
  return (
    MESSAGES[code] || "Обновление не завершено. Предыдущие данные сохранены."
  );
}
function newUserscriptId(windowRef) {
  return Array.from(
    windowRef.crypto.getRandomValues(new Uint8Array(16)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
function createUserscriptClient(
  windowRef,
  timeoutMs = 2000,
  { publicRelease = false } = {},
) {
  const webSource = publicRelease
    ? "schoolpp-userscript-web-v2"
    : "schoolpp-userscript-web-v1";
  const scriptSource = publicRelease
    ? "schoolpp-userscript-v2"
    : "schoolpp-userscript-v1";
  const doc = windowRef.document;
  function diagnostic() {
    let launchCheck;
    try {
      const probe = JSON.parse(
        doc.documentElement.getAttribute("data-schoolpp-userscript-launch") ||
          "null",
      );
      if (probe?.version === "1.0.0-launch" && probe.state === "executed") {
        launchCheck = {
          version: probe.version,
          state: probe.state,
          originAllowed: probe.originAllowed === true,
          topWindowMatches: probe.topWindowMatches === true,
          ...(["loading", "interactive", "complete"].includes(
            probe.documentState,
          )
            ? { documentState: probe.documentState }
            : {}),
        };
      }
    } catch {
      /* A malformed probe marker is not evidence of a successful launch. */
    }
    try {
      const marker = JSON.parse(
        doc.documentElement.getAttribute("data-schoolpp-userscript") || "null",
      );
      return {
        transport: "dom-v2",
        injected: Boolean(marker),
        ...(launchCheck ? { launchCheck } : {}),
        ...(typeof marker?.version === "string" &&
        /^[\w.-]{1,40}$/.test(marker.version)
          ? { version: marker.version }
          : {}),
        ...([
          "starting",
          "ready",
          "unsupported_manager",
          "startup_failed",
        ].includes(marker?.state)
          ? { state: marker.state }
          : {}),
      };
    } catch {
      return {
        transport: "dom-v2",
        injected: false,
        ...(launchCheck ? { launchCheck } : {}),
      };
    }
  }
  function request(type, id = newUserscriptId(windowRef), options = {}) {
    const expected = {
      ping: "ready",
      start: "started",
      receive: "result",
      ack: "cleared",
      cancel: "cleared",
    }[type];
    return new Promise((resolve, reject) => {
      let timer;
      function finish(value, error) {
        windowRef.clearTimeout(timer);
        doc.removeEventListener("schoolpp-userscript-response-v2", onMessage);
        if (error) {
          const cause = new Error(userscriptMessage(error));
          cause.code = error;
          cause.diagnostic = diagnostic();
          reject(cause);
        } else resolve(value);
      }
      function onMessage(event) {
        if (
          event.target !== doc ||
          typeof event.detail !== "string" ||
          event.detail.length > 3000000
        )
          return;
        let message;
        try {
          message = JSON.parse(event.detail);
        } catch {
          return;
        }
        if (
          message?.origin !== windowRef.location.origin ||
          message?.source !== scriptSource ||
          message.id !== id
        )
          return;
        if (message.type === "error") finish(null, message.code);
        else if (message.type === expected) finish(message);
      }
      doc.addEventListener("schoolpp-userscript-response-v2", onMessage);
      timer = windowRef.setTimeout(
        () =>
          finish(
            null,
            diagnostic().state === "startup_failed"
              ? "startup_failed"
              : "bridge_no_response",
          ),
        timeoutMs,
      );
      const event = doc.createEvent("CustomEvent");
      event.initCustomEvent(
        "schoolpp-userscript-request-v2",
        false,
        false,
        JSON.stringify({
          source: webSource,
          origin: windowRef.location.origin,
          type,
          id,
          ...(type === "start" && options.allowSkip === true
            ? { allowSkip: true }
            : {}),
        }),
      );
      doc.dispatchEvent(event);
    });
  }
  return {
    async ping() {
      let last;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await request("ping");
          if (!result.compatible) {
            const error = new Error(userscriptMessage("unsupported_manager"));
            error.code = "unsupported_manager";
            error.diagnostic = diagnostic();
            throw error;
          }
          return result;
        } catch (error) {
          last = error;
          if (error.code !== "bridge_no_response") break;
        }
      }
      throw last;
    },
    start: (id, options) => request("start", id, options),
    receive: (id) => request("receive", id),
    ack: (id) => request("ack", id),
    cancel: (id) => request("cancel", id),
  };
}

function readUserscriptDiary(storage, userId, now = Date.now()) {
  if (!userId) return null;
  try {
    const saved = JSON.parse(storage.getItem(USERSCRIPT_CACHE) || "null");
    if (
      !saved ||
      saved.userId !== userId ||
      !Number.isFinite(saved.savedAt) ||
      saved.savedAt > now
    )
      return null;
    const parsed = readIOSShortcutExport(saved.text);
    if (parsed.snapshot?.import?.transport !== "userscript") return null;
    return {
      ...parsed,
      text: saved.text,
      savedAt: saved.savedAt,
      cloudPending: saved.cloudPending === true,
    };
  } catch {
    return null;
  }
}
function saveUserscriptDiary(
  storage,
  userId,
  text,
  { cloudPending = true, now = Date.now() } = {},
) {
  if (!userId) throw new Error("Не удалось подтвердить сеанс School++.");
  const parsed = readIOSShortcutExport(text);
  if (parsed.snapshot?.import?.transport !== "userscript")
    throw new Error(
      "Дневник собран не полностью. Предыдущие данные сохранены.",
    );
  const serialized = JSON.stringify({
    userId,
    text,
    savedAt: now,
    cloudPending,
  });
  if (
    storage.setItem(USERSCRIPT_CACHE, serialized) === false ||
    storage.getItem(USERSCRIPT_CACHE) !== serialized
  )
    throw new Error(
      "Safari не разрешил сохранить дневник. Освободи место и повтори попытку.",
    );
  return parsed;
}
const createPublicUserscriptClient = (windowRef, timeoutMs) =>
  createUserscriptClient(windowRef, timeoutMs, { publicRelease: true });

function readUserscriptCache(storage, now = Date.now()) {
  try {
    const saved = JSON.parse(storage.getItem(TEST_CACHE) || "null");
    if (
      !saved ||
      !Number.isFinite(saved.savedAt) ||
      saved.savedAt > now ||
      now - saved.savedAt > TEST_MAX_AGE
    )
      return null;
    const parsed = readIOSShortcutExport(saved.text);
    if (parsed.snapshot?.import?.transport !== "userscript-test") return null;
    return { ...parsed, text: saved.text, savedAt: saved.savedAt };
  } catch {
    return null;
  }
}
function saveUserscriptCache(storage, text, now = Date.now()) {
  const parsed = readIOSShortcutExport(text);
  if (parsed.snapshot?.import?.transport !== "userscript-test")
    throw new Error("Результат не является полным сбором Userscripts.");
  const saved = JSON.stringify({ savedAt: now, text });
  const stored = storage.setItem(TEST_CACHE, saved);
  if (stored === false || storage.getItem(TEST_CACHE) !== saved)
    throw new Error(
      "Не удалось сохранить тестовый дневник на телефоне. Предыдущие данные не изменены.",
    );
  return parsed;
}
function readUserscriptPending(storage, now = Date.now(), key = TEST_PENDING) {
  try {
    const value = JSON.parse(storage.getItem(key) || "null");
    return value &&
      /^[a-f0-9]{32}$/.test(value.id) &&
      Number.isFinite(value.createdAt) &&
      value.createdAt <= now &&
      now - value.createdAt < 180000
      ? value
      : null;
  } catch {
    return null;
  }
}
function shouldRefreshUserscript(
  cache,
  storage,
  now = Date.now(),
  key = TEST_ATTEMPT,
) {
  let lastAttempt = 0;
  try {
    lastAttempt = Number(storage.getItem(key)) || 0;
  } catch {
    /* Manual update remains available. */
  }
  return (
    Boolean(cache) &&
    now - cache.savedAt >= 10 * 60000 &&
    now - lastAttempt >= 2 * 60000
  );
}
export {
  TEST_CACHE,
  TEST_PENDING,
  TEST_ATTEMPT,
  createUserscriptClient,
  newUserscriptId,
  userscriptMessage,
  readUserscriptCache,
  saveUserscriptCache,
  readUserscriptPending,
  shouldRefreshUserscript,
  createPublicUserscriptClient,
  readUserscriptDiary,
  saveUserscriptDiary,
  USERSCRIPT_CACHE,
  USERSCRIPT_PENDING,
  USERSCRIPT_ATTEMPT,
};
