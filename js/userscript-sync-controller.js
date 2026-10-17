import { ONBOARDING_KEY } from "./onboarding-controller.js";
import { rememberUserscriptReturn } from "./userscript-auto-sync.js";
import {
  USERSCRIPT_PENDING,
  USERSCRIPT_ATTEMPT,
  readUserscriptPending,
  readUserscriptDiary,
  newUserscriptId,
  userscriptMessage,
} from "./userscript-client.js";

function createUserscriptSyncController({
  windowRef,
  storage,
  services,
  importer,
  client,
  progress,
  wait = (ms) => new Promise((resolve) => windowRef.setTimeout(resolve, ms)),
  navigate = (url) => {
    windowRef.location.href = url;
  },
}) {
  let busy = false;
  let cached = null;
  let cacheOwner = "";
  const pending = () =>
    readUserscriptPending(
      windowRef.sessionStorage,
      Date.now(),
      USERSCRIPT_PENDING,
    );
  const guideUrl = new URL("./userscripts-setup.html", windowRef.location.href)
    .href;
  async function loadCache(expectedOwner = "") {
    const user = await services?.auth.getCachedUser();
    cached =
      user?.id && (!expectedOwner || user.id === expectedOwner)
        ? readUserscriptDiary(storage, user.id)
        : null;
    cacheOwner = cached ? user.id : "";
    return cached;
  }
  async function openDiary() {
    if (!(await loadCache(cacheOwner)))
      throw new Error(
        "Сохранённого дневника для этого сеанса нет. Выполните синхронизацию заново.",
      );
    storage.setItem(ONBOARDING_KEY, "true");
    storage.setItem(USERSCRIPT_ATTEMPT, String(Date.now()));
    rememberUserscriptReturn(windowRef.sessionStorage, cacheOwner);
    navigate(new URL("./#diary", windowRef.location.href).href);
  }
  async function clearRequest() {
    const request = pending();
    if (request) {
      try {
        await client.cancel(request.id);
      } catch {
        /* Local return remains possible. */
      }
    }
    windowRef.sessionStorage.removeItem(USERSCRIPT_PENDING);
  }
  async function back() {
    await clearRequest();
    navigate(guideUrl);
  }
  function showError(error) {
    progress.error(error.message || "Проверьте интернет и попробуйте снова.", [
      { label: "Вернуться назад", primary: true, run: () => action(back) },
      ...(cached
        ? [{ label: "Открыть без синхронизации", run: () => action(openDiary) }]
        : []),
      ...(cached?.cloudPending
        ? [
            {
              label: "Повторить сохранение",
              run: () =>
                action(async () => {
                  await progress.phase("Финальные штрихи…");
                  if (!(await importer.retryUpload()))
                    throw new Error(
                      "Сервер пока недоступен. Дневник сохранён на телефоне.",
                    );
                  await complete();
                }),
            },
          ]
        : []),
    ]);
  }
  async function action(fn) {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (error) {
      try {
        await loadCache(pending()?.userId);
      } catch {
        cached = null;
      }
      showError(error);
    } finally {
      busy = false;
    }
  }
  async function complete(started = Date.now()) {
    await wait(Math.max(0, 600 - (Date.now() - started)));
    progress.success();
    // Let the tick finish drawing, then hold it for half a second.
    await wait(850);
    await openDiary();
  }
  async function startSync() {
    await progress.phase("Проверка расширения");
    await Promise.all([client.ping(), wait(400)]);
    const userId = await importer.prepare();
    await loadCache(userId);
    await clearRequest();
    const id = newUserscriptId(windowRef);
    windowRef.sessionStorage.setItem(
      USERSCRIPT_PENDING,
      JSON.stringify({ id, userId, createdAt: Date.now() }),
    );
    storage.setItem(USERSCRIPT_ATTEMPT, String(Date.now()));
    await progress.phase("Открываем ваш дневник…");
    await wait(300);
    await client.start(id, { allowSkip: Boolean(cached) });
  }
  async function receive() {
    const started = Date.now();
    await progress.phase("Финальные штрихи…");
    const request = pending();
    if (!request?.userId)
      throw new Error(
        "Время подключения истекло. Вернитесь назад и запустите синхронизацию снова.",
      );
    await client.ping();
    const result = await client.receive(request.id);
    if (result.status === "skipped") {
      if (!(await loadCache(request.userId)))
        throw new Error(
          "Сохранённого дневника для этого сеанса нет. Запустите синхронизацию снова.",
        );
      try {
        await client.ack(request.id);
      } catch {
        /* The local copy is already validated. */
      }
      windowRef.sessionStorage.removeItem(USERSCRIPT_PENDING);
      await openDiary();
      return;
    }
    if (result.status !== "done" || !result.export) {
      const error = new Error(
        userscriptMessage(result.code || "collection_failed"),
      );
      error.code = result.code || "collection_failed";
      throw error;
    }
    const imported = await importer.commit(result.export, request.userId);
    await loadCache(imported.userId);
    try {
      await client.ack(request.id);
    } catch {
      /* A saved result is safe; GM data expire. */
    }
    windowRef.sessionStorage.removeItem(USERSCRIPT_PENDING);
    if (!imported.cloudSaved)
      throw new Error(
        "Дневник обновлён и сохранён на телефоне. Сервер пока не подтвердил сохранение: можно повторить отправку или открыть сохранённые данные.",
      );
    await complete(started);
  }
  return { start: () => action(startSync), receive: () => action(receive) };
}

export { createUserscriptSyncController };
