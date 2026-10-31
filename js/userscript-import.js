import { createUserscriptDiaryStorage } from "./userscript-client.js";
import { createOwnerOperation } from "./owner-operation.js";
import { requiresFreshDiarySync } from "./diary-write-context.js";

// Separate importer instances in the same document share the same diary service.
const latestImports = new WeakMap();

function createUserscriptImporter({
  services,
  storage,
  timeoutMs = 20000,
  measure = (_stage, run) => run(),
  diaryStorage = createUserscriptDiaryStorage(storage, { measure }),
}) {
  const identity = services?.auth.getCachedUser
    ? async () => (await services.auth.getCachedUser())?.id || ""
    : undefined;
  const subscribe = services?.auth.onChange;
  async function bounded(operation, parentSignal) {
    const controller = new AbortController();
    let timer;
    const abort = () => controller.abort(parentSignal.reason);
    if (parentSignal?.aborted) abort();
    else parentSignal?.addEventListener("abort", abort, { once: true });
    const scope = createOwnerOperation({ signal: controller.signal });
    try {
      await scope.assertCurrent();
      timer = setTimeout(
        () =>
          controller.abort(
            new Error(
              "Сервер не ответил вовремя. Проверь соединение и попробуй снова.",
            ),
          ),
        timeoutMs,
      );
      return await scope.wait(operation(scope.signal));
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abort);
      scope.dispose();
    }
  }
  async function prepare(expectedOwner = "") {
    if (!services)
      throw new Error("Подключение сервера не настроено. Попробуй позже.");
    const scope = createOwnerOperation({
      getIdentity: identity,
      subscribe,
      expectedOwner,
      captureIdentity: false,
    });
    try {
      const user = await measure("auth_user", () =>
        bounded(async (signal) => {
          const current = await services.auth.getUser();
          if (signal.aborted) throw signal.reason;
          if (!current && expectedOwner)
            throw new Error(
              "Сеанс School++ изменился. Запусти обновление заново.",
            );
          const user =
            current || (await services.auth.signInAnonymously()).user;
          scope.bind(user?.id);
          return user;
        }, scope.signal),
      );
      await scope.assertCurrent();
      const access = await measure("device_access", () =>
        bounded(() => services.devices.access(), scope.signal),
      );
      await scope.assertCurrent();
      if (access.role === "linked") {
        const error = new Error(
          "Этот браузер подключён по коду. Сначала отключи его в «Моих устройствах» на основном устройстве, чтобы подключить дневник напрямую через Safari.",
        );
        error.code = "linked_device";
        throw error;
      }
      return user.id;
    } catch (error) {
      if (
        error instanceof TypeError ||
        error?.name === "AuthRetryableFetchError"
      )
        throw new Error(
          "Не удалось подтвердить подключение School++. Проверь интернет и попробуй снова.",
          { cause: error },
        );
      throw error;
    } finally {
      scope.dispose();
    }
  }
  async function upload(userId, text, parsed, writeContext) {
    const scope = createOwnerOperation({
      getIdentity: identity,
      subscribe,
      expectedOwner: userId,
    });
    try {
      const isCurrent = async () => {
        await scope.assertCurrent();
        return diaryStorage.read(userId)?.text === text;
      };
      if (!(await isCurrent())) return false;
      await measure("cloud_save", () =>
        bounded(
          (signal) =>
            services.diary.save(parsed.snapshot, {
              signal,
              expectedOwner: userId,
              measure,
              isCurrent,
              // An old cached export must not silently adopt today's revision.
              writeContext: writeContext ?? { version: 1 },
            }),
          scope.signal,
        ),
      );
      await scope.assertCurrent();
      // A new attempt must not be replaced by completion of an older upload.
      const current = measure("cache_read", () => diaryStorage.read(userId));
      if (current?.text === text)
        measure("local_save", () =>
          diaryStorage.save(userId, text, {
            cloudPending: false,
            now: current.savedAt,
            writeContext: current.writeContext,
          }),
        );
      return true;
    } catch (error) {
      if (requiresFreshDiarySync(error)) throw error;
      return false;
    } finally {
      scope.dispose();
    }
  }
  return {
    prepare,
    async getWriteContext(userId) {
      const scope = createOwnerOperation({
        getIdentity: identity,
        subscribe,
        expectedOwner: userId,
      });
      try {
        await scope.assertCurrent();
        return await bounded(
          (signal) =>
            services.diary.getWriteContext
              ? services.diary.getWriteContext({
                  expectedOwner: userId,
                  signal,
                })
              : Promise.resolve({ version: 1 }),
          scope.signal,
        );
      } finally {
        scope.dispose();
      }
    },
    async commit(text, expectedOwner, { writeContext } = {}) {
      const parsed = diaryStorage.parse(text);
      if (parsed.snapshot?.import?.transport !== "userscript")
        throw new Error(
          "Получен неполный дневник. Предыдущие данные сохранены.",
        );
      const attempt = {};
      if (services?.diary) latestImports.set(services.diary, attempt);
      const userId = await prepare(expectedOwner);
      if (services?.diary && latestImports.get(services.diary) !== attempt)
        throw new Error(
          "Получена новая попытка синхронизации. Предыдущая отменена.",
        );
      measure("local_save", () =>
        diaryStorage.save(userId, text, { writeContext }),
      );
      const cloudSaved = await upload(userId, text, parsed, writeContext);
      return { ...parsed, userId, cloudSaved };
    },
    async retryUpload(expectedOwner = "") {
      const userId = await prepare(expectedOwner);
      const cached = measure("cache_read", () => diaryStorage.read(userId));
      if (!cached) return false;
      return upload(userId, cached.text, cached, cached.writeContext);
    },
  };
}

export { createUserscriptImporter };
