import {
  TEST_PENDING,
  newUserscriptId,
  readUserscriptPending,
  saveUserscriptCache,
  userscriptMessage,
} from "../js/userscript-client.js";
import { createSyncTimings } from "../js/sync-timings.js";

// Local v1 test protocol only. No Supabase services, production keys or
// conversion of a test export into a production snapshot.
function createLocalUserscriptRoundtrip({
  windowRef,
  storage,
  client,
  timings = createSyncTimings(windowRef),
}) {
  let busy = false;
  const pending = () => readUserscriptPending(windowRef.sessionStorage);
  async function run(operation) {
    if (busy) throw new Error("Локальная проверка уже запущена.");
    busy = true;
    try {
      return await operation();
    } catch (error) {
      timings.finish("failed");
      throw error;
    } finally {
      busy = false;
    }
  }
  return {
    start: () =>
      run(async () => {
        timings.begin();
        const started = Date.now();
        await timings.measure("bridge_ping", () => client.ping());
        const previous = pending();
        if (previous)
          await timings.measure("bridge_cancel", () =>
            client.cancel(previous.id),
          );
        const id = newUserscriptId(windowRef);
        windowRef.sessionStorage.setItem(
          TEST_PENDING,
          JSON.stringify({ id, createdAt: Date.now() }),
        );
        if (pending()?.id !== id)
          throw new Error(
            "Safari не сохранил попытку. Разреши хранение данных сайта.",
          );
        await timings.measure("bridge_start", () => client.start(id));
        timings.record("start_total", Date.now() - started);
      }),
    receive: () =>
      run(async () => {
        const started = Date.now();
        const request = pending();
        if (!request)
          throw new Error(
            "Попытка истекла. Запусти локальную проверку заново в этой вкладке.",
          );
        await timings.measure("bridge_ping", () => client.ping());
        const result = await timings.measure("bridge_receive", () =>
          client.receive(request.id),
        );
        if (result.status !== "done" || typeof result.export !== "string")
          throw new Error(
            userscriptMessage(result.code || "collection_failed"),
          );
        // This shared helper validates completeness and userscript-test before
        // writing only TEST_CACHE; failed validation preserves the old copy.
        const parsed = timings.measure("local_save", () =>
          saveUserscriptCache(storage, result.export),
        );
        if (parsed.summary?.elapsedMs)
          timings.record("collection", parsed.summary.elapsedMs);
        await timings.measure("bridge_ack", () => client.ack(request.id));
        windowRef.sessionStorage.removeItem(TEST_PENDING);
        timings.record("return_total", Date.now() - started);
        timings.finish("complete");
      }),
    report() {
      return JSON.stringify(
        {
          ...JSON.parse(timings.text()),
          check: "local-roundtrip",
          cloud: "not_run",
        },
        null,
        2,
      );
    },
  };
}

export { createLocalUserscriptRoundtrip };
