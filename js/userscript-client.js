import { readIOSShortcutExport } from "./ios-shortcut-preview.js";
import { getUserscriptVersionStatus } from "./userscript-version.js";

const TEST_CACHE = "schoolpp_userscript_test_v1";
const TEST_PENDING = "schoolpp_userscript_pending_v1";
const TEST_ATTEMPT = "schoolpp_userscript_attempt_v1";
const USERSCRIPT_CACHE = "schoolpp_userscript_diary_v1";
const USERSCRIPT_PENDING = "schoolpp_userscript_pending_v2";
const USERSCRIPT_ATTEMPT = "schoolpp_userscript_attempt_v2";
const TEST_MAX_AGE = 7 * 86400000;
const MESSAGES = {
  script_update_required:
    "Обновите скрипт School++ в Userscripts, затем повторите синхронизацию.",
  script_version_unknown:
    "Не удалось подтвердить версию скрипта School++. Обновите его по инструкции.",
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
      let timer, observer;
      let settled = false;
      function finish(value, error) {
        if (settled) return;
        settled = true;
        windowRef.clearTimeout(timer);
        observer?.disconnect();
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
      function send() {
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
      }
      if (type === "ping" && typeof windowRef.MutationObserver === "function") {
        let resent = false;
        observer = new windowRef.MutationObserver(() => {
          // A late document-idle injection already marks readiness. Treat that
          // only as a hint to resend ping; the matching bridge response is required.
          if (
            !settled &&
            !resent &&
            ["ready", "unsupported_manager"].includes(diagnostic().state)
          ) {
            resent = true;
            send();
          }
        });
        observer.observe(doc.documentElement, {
          attributes: true,
          attributeFilter: ["data-schoolpp-userscript"],
        });
      }
      send();
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
          if (publicRelease) {
            const status = getUserscriptVersionStatus(result.version);
            if (status !== "current") {
              const code = status === "outdated"
                ? "script_update_required"
                : "script_version_unknown";
              const error = new Error(userscriptMessage(code));
              error.code = code;
              error.diagnostic = diagnostic();
              throw error;
            }
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
  return readDiary(storage, userId, now, readIOSShortcutExport);
}
function readDiary(storage, userId, now, parse) {
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
    const parsed = parse(saved.text);
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
  return saveDiary(
    storage,
    userId,
    text,
    { cloudPending, now },
    readIOSShortcutExport,
  );
}
function saveDiary(storage, userId, text, { cloudPending, now }, parse) {
  if (!userId) throw new Error("Не удалось подтвердить сеанс School++.");
  const parsed = parse(text);
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

// One sync document repeatedly checks the same export. Cache only its parsing;
// every read still checks the actual stored envelope and current owner/time.
// Copies prevent callers from changing the privately validated result.
function createUserscriptDiaryStorage(
  storage,
  { measure = (_stage, run) => run() } = {},
) {
  let lastText, lastParsed;
  function parse(text) {
    if (text !== lastText || !lastParsed) {
      const parsed = measure("export_parse", () => readIOSShortcutExport(text));
      lastText = text;
      lastParsed = parsed;
    }
    return lastParsed;
  }
  function clear() {
    lastText = lastParsed = undefined;
  }
  return {
    parse: (text) => structuredClone(parse(text)),
    read(userId, now = Date.now()) {
      const result = readDiary(storage, userId, now, parse);
      if (!result) clear();
      return result ? structuredClone(result) : null;
    },
    save(userId, text, { cloudPending = true, now = Date.now() } = {}) {
      return structuredClone(
        saveDiary(storage, userId, text, { cloudPending, now }, parse),
      );
    },
  };
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
  createUserscriptDiaryStorage,
  USERSCRIPT_CACHE,
  USERSCRIPT_PENDING,
  USERSCRIPT_ATTEMPT,
};
