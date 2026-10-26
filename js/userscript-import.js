import { createUserscriptDiaryStorage } from "./userscript-client.js";

function createUserscriptImporter({
  services,
  storage,
  timeoutMs = 20000,
  measure = (_stage, run) => run(),
  diaryStorage = createUserscriptDiaryStorage(storage, { measure }),
}) {
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
      user = await measure("auth_user", () =>
        bounded(
          async () =>
            (await services.auth.getUser()) ||
            (await services.auth.signInAnonymously()).user,
        ),
      );
      access = await measure("device_access", () =>
        bounded(() => services.devices.access()),
      );
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
      await measure("cloud_save", () =>
        bounded((signal) =>
          services.diary.save(parsed.snapshot, {
            signal,
            expectedOwner: userId,
            measure,
          }),
        ),
      );
      // A new attempt must not be replaced by completion of an older upload.
      const current = measure("cache_read", () => diaryStorage.read(userId));
      if (current?.text === text)
        measure("local_save", () =>
          diaryStorage.save(userId, text, {
            cloudPending: false,
            now: current.savedAt,
          }),
        );
      return true;
    } catch {
      return false;
    }
  }
  return {
    prepare,
    async commit(text, expectedOwner) {
      const parsed = diaryStorage.parse(text);
      if (parsed.snapshot?.import?.transport !== "userscript")
        throw new Error(
          "Получен неполный дневник. Предыдущие данные сохранены.",
        );
      const userId = await prepare(expectedOwner);
      measure("local_save", () => diaryStorage.save(userId, text));
      const cloudSaved = await upload(userId, text, parsed);
      return { ...parsed, userId, cloudSaved };
    },
    async retryUpload() {
      const userId = await prepare();
      const cached = measure("cache_read", () => diaryStorage.read(userId));
      if (!cached) return false;
      return upload(userId, cached.text, cached);
    },
  };
}

export { createUserscriptImporter };
