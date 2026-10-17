import { readIOSShortcutExport } from "./ios-shortcut-preview.js";
import {
  readUserscriptDiary,
  saveUserscriptDiary,
} from "./userscript-client.js";

function createUserscriptImporter({ services, storage, timeoutMs = 20000 }) {
  async function bounded(operation) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new Error(
                "Сервер не ответил вовремя. Проверь соединение и попробуй снова.",
              ),
            );
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function prepare(expectedOwner = "") {
    if (!services)
      throw new Error("Подключение сервера не настроено. Попробуй позже.");
    let user, access;
    try {
      user = await bounded(
        async () =>
          (await services.auth.getUser()) ||
          (await services.auth.signInAnonymously()).user,
      );
      access = await bounded(() => services.devices.access());
    } catch {
      throw new Error(
        "Не удалось подтвердить подключение School++. Проверь интернет и попробуй снова.",
      );
    }
    if (!user?.id || (expectedOwner && expectedOwner !== user.id))
      throw new Error("Сеанс School++ изменился. Запусти обновление заново.");
    if (access.role === "linked") {
      const error = new Error(
        "Этот браузер подключён по коду. Сначала отключи его в «Моих устройствах» на основном устройстве, чтобы подключить дневник напрямую через Safari.",
      );
      error.code = "linked_device";
      throw error;
    }
    return user.id;
  }
  async function upload(userId, text, parsed) {
    try {
      await bounded((signal) =>
        services.diary.save(parsed.snapshot, { signal, expectedOwner: userId }),
      );
      // A new attempt must not be replaced by completion of an older upload.
      const current = readUserscriptDiary(storage, userId);
      if (current?.text === text)
        saveUserscriptDiary(storage, userId, text, {
          cloudPending: false,
          now: current.savedAt,
        });
      return true;
    } catch {
      return false;
    }
  }
  return {
    prepare,
    async commit(text, expectedOwner) {
      const parsed = readIOSShortcutExport(text);
      if (parsed.snapshot?.import?.transport !== "userscript")
        throw new Error(
          "Получен неполный дневник. Предыдущие данные сохранены.",
        );
      const userId = await prepare(expectedOwner);
      saveUserscriptDiary(storage, userId, text);
      const cloudSaved = await upload(userId, text, parsed);
      return { ...parsed, userId, cloudSaved };
    },
    async retryUpload() {
      const userId = await prepare();
      const cached = readUserscriptDiary(storage, userId);
      if (!cached) return false;
      return upload(userId, cached.text, cached);
    },
  };
}

export { createUserscriptImporter };
