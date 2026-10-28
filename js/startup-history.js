// Owns one startup read, not an auth cache. Stop observing the old result after
// any owner change, including A -> B -> A, and check the session again on use.
function createStartupDiaryLoad({ repository, auth, ownerId }) {
  let cancelled = !ownerId,
    disposed = false,
    finishing = false;
  const unsubscribe = auth.onChange((event, session) => {
    if (
      event === "SIGNED_OUT" ||
      (session?.user?.id && session.user.id !== ownerId)
    )
      cancelled = true;
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    unsubscribe();
  }
  async function isCurrent() {
    if (cancelled) return false;
    const user = await auth.getCachedUser();
    return !cancelled && user?.id === ownerId;
  }
  let read;
  try {
    read = repository.loadProgressively();
  } catch (error) {
    dispose();
    throw error;
  }
  read.complete.catch(() => {});
  const snapshot = read.snapshot.then(async (data) =>
    (await isCurrent()) ? data : null,
  );
  return {
    snapshot,
    cancel() {
      cancelled = true;
      dispose();
    },
    async finish({ onChanges, onState, isSameDiary = () => true }) {
      if (finishing) return;
      finishing = true;
      try {
        if (cancelled || !isSameDiary()) return;
        onState("loading");
        const data = await read.complete;
        if (!(await isCurrent()) || !isSameDiary()) return;
        if (Array.isArray(data?.changes)) onChanges(data.changes);
        onState(data && !Array.isArray(data.changes) ? "unavailable" : "ready");
      } catch {
        try {
          if ((await isCurrent()) && isSameDiary()) onState("unavailable");
        } catch {
          /* Optional history cannot block the diary. */
        }
      } finally {
        dispose();
      }
    },
  };
}

export { createStartupDiaryLoad };
