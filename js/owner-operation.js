const sessionChanged = () =>
  new Error("Сеанс School++ изменился. Запусти обновление заново.");

// A local cancellation guard, never a replacement for getUser/RLS checks.
// Capture at enqueue time so queued work cannot silently move to another user.
function createOwnerOperation({
  getIdentity,
  subscribe,
  expectedOwner = "",
  signal,
  captureIdentity = true,
  timeoutMs = 0,
} = {}) {
  const controller = new AbortController();
  let owner = expectedOwner;
  let observed = "";
  let disposed = false;
  const cancel = (reason = sessionChanged()) => controller.abort(reason);
  const timer =
    timeoutMs > 0
      ? setTimeout(
          () =>
            cancel(
              new Error(
                "Сервер не ответил вовремя. Проверь соединение и попробуй снова.",
              ),
            ),
          timeoutMs,
        )
      : null;
  const check = () => {
    if (controller.signal.aborted)
      throw controller.signal.reason || sessionChanged();
  };
  function bind(identity) {
    check();
    if (
      !identity ||
      (owner && owner !== identity) ||
      (observed && observed !== identity)
    ) {
      cancel();
      check();
    }
    owner = identity;
    return owner;
  }
  const onAbort = () => cancel(signal.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const unsubscribe = subscribe?.((event, session) => {
    const identity = session?.user?.id;
    if (
      event === "SIGNED_OUT" ||
      (identity &&
        ((owner && owner !== identity) || (observed && observed !== identity)))
    )
      cancel();
    if (identity) observed = identity;
  });
  const ready =
    captureIdentity && getIdentity
      ? Promise.resolve().then(getIdentity).then(bind)
      : Promise.resolve(owner);
  ready.catch(() => {});

  function wait(promise) {
    return new Promise((resolve, reject) => {
      const aborted = () => {
        controller.signal.removeEventListener("abort", aborted);
        reject(controller.signal.reason || sessionChanged());
      };
      if (controller.signal.aborted) {
        // Drain a request that may already have started before cancellation.
        Promise.resolve(promise).catch(() => {});
        aborted();
        return;
      }
      controller.signal.addEventListener("abort", aborted, { once: true });
      Promise.resolve(promise)
        .then(resolve, reject)
        .finally(() => {
          controller.signal.removeEventListener("abort", aborted);
        });
    });
  }

  return {
    signal: controller.signal,
    clearDeadline() {
      if (timer !== null) clearTimeout(timer);
    },
    bind,
    wait,
    async assertCurrent() {
      await wait(ready);
      check();
      if (getIdentity) bind(await wait(getIdentity()));
      check();
      return owner;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      unsubscribe?.();
    },
  };
}

export { createOwnerOperation };
