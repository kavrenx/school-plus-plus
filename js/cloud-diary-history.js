import { adaptESchoolsSnapshot } from "./e-schools-adapter.js";
import {
  createChangeSnapshot,
  compareChangeSnapshots,
} from "./diary-changes.js";

async function makeSharedEvents(previous, snapshot) {
  const old = createChangeSnapshot(adaptESchoolsSnapshot(previous));
  const next = createChangeSnapshot(adaptESchoolsSnapshot(snapshot));
  if (!old || !next || old.scope !== next.scope) return [];
  const syncedAt = snapshot.capturedAt || new Date().toISOString();
  const differences = compareChangeSnapshots(old.rows, next.rows).changes;
  return Promise.all(
    differences.slice(-150).map(async (change) => {
      // This ID only deduplicates owned events; it is never a credential. Works on local HTTP too.
      const text = JSON.stringify([next.scope, syncedAt, change]);
      const id = [2166136261, 2246822519, 3266489917, 668265263]
        .map((seed) => {
          let hash = seed;
          for (const char of text)
            hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
          return (hash >>> 0).toString(16).padStart(8, "0");
        })
        .join("");
      return { ...change, id, syncedAt, detectedAt: syncedAt };
    }),
  );
}

function createDiaryHistoryRepository(
  base,
  devices,
  { storage, getIdentity = async () => "" } = {},
) {
  let previous = null;
  let pendingOperation = Promise.resolve();
  function enqueue(operation) {
    const result = pendingOperation.then(operation);
    pendingOperation = result.catch(() => {});
    return result;
  }
  const key = (id) => `schoolpp_changes_outbox_v1:${id}`;
  async function publish(events = []) {
    const identity = await getIdentity();
    let pending = [];
    try {
      pending = JSON.parse(storage?.getItem(key(identity)) || "[]");
    } catch {
      /* Fresh queue after damaged storage. */
    }
    if (!Array.isArray(pending)) pending = [];
    const batch = [
      ...new Map(
        [...events, ...pending].map((event) => [event.id, event]),
      ).values(),
    ].slice(0, 150);
    while (
      batch.length &&
      new TextEncoder().encode(JSON.stringify(batch)).length > 390000
    )
      batch.pop();
    if (!batch.length) return;
    // Persist before sending so the next visit can retry a failed history upload.
    if (identity) storage?.setItem(key(identity), JSON.stringify(batch));
    await devices.saveEvents(batch);
    if (identity) storage?.removeItem(key(identity));
  }
  return {
    load: () =>
      enqueue(async () => {
        const data = await base.load();
        previous = data?.payload ? structuredClone(data.payload) : null;
        try {
          if (data) await publish();
        } catch {
          /* Retry the durable history queue on a later visit. */
        }
        try {
          if (data) data.changes = await devices.history();
        } catch {
          /* Old servers still load personal diaries. */
        }
        return data;
      }),
    save: (snapshot, options = {}) =>
      enqueue(async () => {
        if (!previous) {
          try {
            previous = (await base.load())?.payload || null;
          } catch {
            /* Initial imports don't require a baseline. */
          }
        }
        const before = previous;
        if (options.signal?.aborted) throw new Error("Сохранение отменено.");
        const result = await base.save(snapshot, options);
        previous = structuredClone(snapshot);
        try {
          const events = await makeSharedEvents(before, snapshot);
          await publish(events);
        } catch {
          /* A history error must not undo a successfully saved diary. */
        }
        return result;
      }),
    remove: () =>
      enqueue(async () => {
        await base.remove();
        previous = null;
        const identity = await getIdentity();
        if (identity) storage?.removeItem(key(identity));
      }),
  };
}

export { makeSharedEvents, createDiaryHistoryRepository };
