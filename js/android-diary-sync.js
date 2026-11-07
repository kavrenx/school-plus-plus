import { validateDiaryWriteContext } from "./diary-write-context.js";
import { readIOSShortcutExport } from "./ios-shortcut-preview.js";
import { createOwnerOperation } from "./owner-operation.js";

const ATTEMPT = /^schoolpp-android-sync-v1:[a-f0-9]{32}$/;
const ERROR_CODES = new Set([
  "linked_device",
  "invalid_snapshot",
  "diary_snapshot_conflict",
  "diary_write_context_required",
  "diary_client_outdated",
  "pair_owner_required",
  "server_unavailable",
]);

function startAndroidDiarySync({ services, port, onSaved }) {
  let phase = "preparing";
  let owner;
  let writeContext;
  const cancelled = new AbortController();
  const scope = createOwnerOperation({
    signal: cancelled.signal,
    getIdentity: services
      ? async () => (await services.auth.getCachedUser())?.id
      : undefined,
    subscribe: services?.auth.onChange,
    captureIdentity: false,
    timeoutMs: 100_000,
  });
  function close(message) {
    if (phase === "closed") return;
    phase = "closed";
    scope.signal.removeEventListener("abort", aborted);
    cancelled.abort();
    scope.dispose();
    if (message) port.postMessage(message);
    port.close();
  }

  function aborted() {
    error("server_unavailable");
  }

  function error(code) {
    close(`error:${ERROR_CODES.has(code) ? code : "server_unavailable"}`);
  }

  async function prepare() {
    if (!services) return error("server_unavailable");
    const current = await scope.wait(services.auth.getUser());
    if (scope.signal.aborted) return;
    const user =
      current || (await scope.wait(services.auth.signInAnonymously())).user;
    owner = scope.bind(user?.id);
    await scope.assertCurrent();
    if (phase === "closed") return;
    const access = await scope.wait(services.devices.access());
    await scope.assertCurrent();
    if (phase === "closed") return;
    if (access?.role === "linked") return error("linked_device");
    if (!["owner", "unpaired"].includes(access?.role))
      return error("server_unavailable");
    writeContext = validateDiaryWriteContext(
      await scope.wait(
        services.diary.getWriteContext({
          expectedOwner: owner,
          signal: scope.signal,
        }),
      ),
    );
    await scope.assertCurrent();
    if (phase === "closed") return;
    if (writeContext.version !== 2)
      return error("diary_write_context_required");
    phase = "ready";
    port.postMessage("ready");
  }

  async function commit(text) {
    let snapshot;
    try {
      snapshot = readIOSShortcutExport(text, "android").snapshot;
    } catch {
      return error("invalid_snapshot");
    }
    if (!snapshot) return error("invalid_snapshot");
    await scope.assertCurrent();
    if (phase === "closed") return;
    await scope.wait(
      services.diary.save(snapshot, {
        expectedOwner: owner,
        writeContext,
        signal: scope.signal,
      }),
    );
    await scope.assertCurrent();
    if (phase === "closed") return;
    onSaved?.();
    close("saved");
  }

  port.onmessage = ({ data }) => {
    if (data === "cancel") return close();
    if (phase !== "ready") return;
    phase = "saving";
    void commit(data).catch((cause) => error(cause?.code));
  };
  if (scope.signal.aborted) aborted();
  else {
    scope.signal.addEventListener("abort", aborted, { once: true });
    void prepare().catch((cause) => error(cause?.code));
  }
  return close;
}

function bindAndroidDiarySync(windowRef, { services, onSaved }) {
  let active;
  windowRef.addEventListener("pagehide", () => active?.());
  windowRef.addEventListener("message", (event) => {
    if (
      !event.isTrusted ||
      event.source !== null ||
      windowRef.top !== windowRef ||
      typeof event.data !== "string" ||
      !ATTEMPT.test(event.data) ||
      event.ports?.length !== 1
    )
      return;
    active?.();
    active = startAndroidDiarySync({ services, port: event.ports[0], onSaved });
  });
}

export { bindAndroidDiarySync, startAndroidDiarySync };
