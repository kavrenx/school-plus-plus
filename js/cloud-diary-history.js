import { adaptESchoolsSnapshot } from "./e-schools-adapter.js";
import { createOwnerOperation } from "./owner-operation.js";
import { isSameStudentSource } from "./student-storage.js";
import {
  createChangeSnapshot,
  compareChangeSnapshots,
} from "./diary-changes.js";

async function makeSharedEvents(previous, snapshot) {
  const before = adaptESchoolsSnapshot(previous);
  const after = adaptESchoolsSnapshot(snapshot);
  if (!isSameStudentSource(before, after)) return [];
  const old = createChangeSnapshot(before);
  const next = createChangeSnapshot(after);
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
  { storage, getIdentity, subscribeIdentity, timeoutMs = 20_000 } = {},
) {
  let previous = null;
  let previousOwner = "";
  let pendingOperation = Promise.resolve();
  function enqueue(operation, options = {}) {
    const scope = createOwnerOperation({
      getIdentity,
      subscribe: subscribeIdentity,
      expectedOwner: options.expectedOwner,
      signal: options.signal,
      timeoutMs,
    });
    const result = pendingOperation.then(async () => {
      try {
        const identity = await scope.assertCurrent();
        if (identity !== previousOwner) {
          previous = null;
          previousOwner = identity;
        }
        return await operation(scope, identity);
      } finally {
        scope.dispose();
      }
    });
    pendingOperation = result.catch(() => {});
    return result;
  }
  const key = (id) => `schoolpp_changes_outbox_v1:${id}`;
  async function metadataOperation(scope, identity, run) {
    // A history timeout must not undo an acknowledged snapshot.
    scope.clearDeadline();
    const metadata = createOwnerOperation({
      getIdentity,
      expectedOwner: identity,
      signal: scope.signal,
      timeoutMs,
    });
    try {
      return await run(metadata);
    } finally {
      metadata.dispose();
    }
  }
  async function publish(scope, identity, events = []) {
    await scope.assertCurrent();
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
    const serialized = JSON.stringify(batch);
    if (identity) storage?.setItem(key(identity), serialized);
    await scope.wait(
      devices.saveEvents(batch, {
        expectedOwner: identity,
        signal: scope.signal,
      }),
    );
    await scope.assertCurrent();
    // Another tab may have appended events while this request was in flight.
    if (identity && storage?.getItem(key(identity)) === serialized)
      storage?.removeItem(key(identity));
  }
  function load(onSnapshot) {
    return enqueue(async (scope, identity) => {
      const data = await scope.wait(
        base.load({ expectedOwner: identity, signal: scope.signal }),
      );
      await scope.assertCurrent();
      previous = data?.payload ? structuredClone(data.payload) : null;
      // Only the startup observer receives an early copy. Keep the existing
      // queue and outbox -> history order, including for subsequent saves.
      if (onSnapshot) onSnapshot(structuredClone(data));
      if (data)
        await metadataOperation(scope, identity, async (metadata) => {
          try {
            await publish(metadata, identity);
          } catch {
            await scope.assertCurrent();
            /* Retry the durable history queue on a later visit. */
          }
          try {
            await metadata.assertCurrent();
            const changes = await metadata.wait(
              devices.history({
                expectedOwner: identity,
                signal: metadata.signal,
              }),
            );
            await scope.assertCurrent();
            data.changes = changes;
          } catch {
            await scope.assertCurrent();
            /* Old servers still load personal diaries. */
          }
        });
      return data;
    });
  }
  return {
    getWriteContext: (options = {}) =>
      enqueue(async (scope, identity) => {
        if (!base.getWriteContext) return { version: 1 };
        const context = await scope.wait(
          base.getWriteContext({
            expectedOwner: identity || options.expectedOwner,
            signal: scope.signal,
          }),
        );
        await scope.assertCurrent();
        return context;
      }, options),
    load: () => load(),
    loadProgressively() {
      let resolveSnapshot, rejectSnapshot;
      const snapshot = new Promise((resolve, reject) => {
        resolveSnapshot = resolve;
        rejectSnapshot = reject;
      });
      const complete = load(resolveSnapshot);
      // A failed initial read must reject both phases. Register the handler now
      // even when startup chooses the extension and never awaits completion.
      complete.catch(rejectSnapshot);
      return { snapshot, complete };
    },
    save(snapshot, options = {}) {
      const captured = structuredClone(snapshot);
      return enqueue(async (scope, identity) => {
        const measure = options.measure || ((_stage, run) => run());
        async function check() {
          await scope.assertCurrent();
          if (options.isCurrent && !(await options.isCurrent()))
            throw new Error(
              "Сохранение отменено: получен более новый дневник.",
            );
        }
        await check();
        if (!previous) {
          try {
            const baseline = await measure("cloud_baseline", () =>
              scope.wait(
                base.load({ expectedOwner: identity, signal: scope.signal }),
              ),
            );
            await check();
            previous = baseline?.payload
              ? structuredClone(baseline.payload)
              : null;
          } catch {
            await check();
            /* Initial imports don't require a baseline. */
          }
        }
        const before = previous;
        await check();
        const result = await measure("cloud_snapshot", () =>
          scope.wait(
            base.save(captured, {
              ...options,
              expectedOwner: identity || options.expectedOwner,
              signal: scope.signal,
            }),
          ),
        );
        await scope.assertCurrent();
        previous = structuredClone(captured);
        try {
          await metadataOperation(scope, identity, async (metadata) => {
            const events = await measure("history_compare", () =>
              metadata.wait(makeSharedEvents(before, captured)),
            );
            await measure("history_publish", () =>
              publish(metadata, identity, events),
            );
          });
        } catch {
          await scope.assertCurrent();
          /* A history error must not undo a successfully saved diary. */
        }
        return result;
      }, options);
    },
    remove: (options = {}) =>
      enqueue(async (scope, identity) => {
        await scope.wait(
          base.remove({
            ...options,
            expectedOwner: identity || options.expectedOwner,
            signal: scope.signal,
          }),
        );
        await scope.assertCurrent();
        previous = null;
        if (identity) storage?.removeItem(key(identity));
      }, options),
  };
}

export { makeSharedEvents, createDiaryHistoryRepository };
