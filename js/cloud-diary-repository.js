import {
  validateDiaryWriteContext,
  diaryWriteError,
} from "./diary-write-context.js";

const SOURCE = "e-schools.by";
const MAX_SNAPSHOT_BYTES = 2_000_000;

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("Импортированные данные должны быть объектом.");
  }
  const serialized = JSON.stringify(snapshot);
  if (new TextEncoder().encode(serialized).length > MAX_SNAPSHOT_BYTES) {
    throw new RangeError(
      "Импорт превышает 2 МБ. Разделите его на меньшие части.",
    );
  }
  // Copy JSON data so subsequent caller mutations cannot change the request.
  return JSON.parse(serialized);
}

function createCloudDiaryRepository(client) {
  let protocol = typeof client.rpc === "function" ? "unknown" : "legacy";
  const contexts = new Map();
  const unsupported = Symbol("legacy server");
  function checkSignal(signal) {
    if (signal?.aborted)
      throw signal.reason || new Error("Сохранение отменено.");
  }
  async function getOwnerId({ signal, expectedOwner } = {}) {
    checkSignal(signal);
    const { data, error } = await client.auth.getUser();
    checkSignal(signal);
    if (error) throw error;
    if (!data.user)
      throw new Error("Войдите в School++, чтобы получить свои данные.");
    if (expectedOwner && data.user.id !== expectedOwner)
      throw new Error("Сеанс School++ изменился. Запусти обновление заново.");
    return data.user.id;
  }

  async function rpc(name, params, signal) {
    checkSignal(signal);
    let request = client.rpc(name, params);
    if (signal && request.abortSignal) request = request.abortSignal(signal);
    const result = await request;
    checkSignal(signal);
    return result;
  }
  async function readVersioned(ownerId, signal, includePayload) {
    if (protocol === "legacy") return unsupported;
    const { data, error } = await rpc(
      "get_my_diary_snapshot_v2",
      { p_include_payload: includePayload },
      signal,
    );
    if (error) {
      // Only an explicitly missing new RPC permits the old-server path.
      if (protocol === "unknown" && error.code === "PGRST202") {
        protocol = "legacy";
        contexts.set(ownerId, { version: 1 });
        return unsupported;
      }
      throw error;
    }
    if (!data?.ok) throw diaryWriteError(data?.error);
    const snapshot = data.snapshot;
    const context = validateDiaryWriteContext({
      version: 2,
      revision: snapshot === null ? null : snapshot?.write_revision,
    });
    if (includePayload && snapshot && !snapshot.payload)
      throw diaryWriteError("diary_write_context_required");
    protocol = "v2";
    contexts.set(ownerId, context);
    return snapshot;
  }
  async function writeContext(ownerId, signal, provided) {
    if (provided !== undefined) {
      const context = validateDiaryWriteContext(provided);
      if (context.version === 2) return context;
      if (protocol === "unknown") await readVersioned(ownerId, signal, false);
      if (protocol === "v2")
        throw diaryWriteError("diary_write_context_required");
      return context;
    }
    if (!contexts.has(ownerId)) {
      const result = await readVersioned(ownerId, signal, false);
      if (result === unsupported) contexts.set(ownerId, { version: 1 });
    }
    return contexts.get(ownerId);
  }
  function legacyError(error, ownerId) {
    if (error?.code === "42501") {
      protocol = "unknown";
      contexts.delete(ownerId);
      throw diaryWriteError("diary_client_outdated");
    }
    if (error) throw error;
  }

  return Object.freeze({
    async load(options = {}) {
      const ownerId = await getOwnerId(options);
      const versioned = await readVersioned(ownerId, options.signal, true);
      if (versioned !== unsupported) return versioned;
      let request = client
        .from("diary_snapshots")
        .select("payload, schema_version, updated_at")
        .eq("owner_id", ownerId)
        .eq("source", SOURCE);
      if (options.signal && request.abortSignal)
        request = request.abortSignal(options.signal);
      const { data, error } = await request.maybeSingle();
      checkSignal(options.signal);
      if (error) throw error;
      return data;
    },
    async getWriteContext(options = {}) {
      const ownerId = await getOwnerId(options);
      const snapshot = await readVersioned(ownerId, options.signal, false);
      return snapshot === unsupported
        ? { version: 1 }
        : structuredClone(contexts.get(ownerId));
    },
    async save(
      snapshot,
      {
        signal,
        expectedOwner,
        writeContext: provided,
        measure = (_stage, run) => run(),
      } = {},
    ) {
      const payload = validateSnapshot(snapshot);
      const ownerId = await measure("cloud_write_auth", () =>
        getOwnerId({ signal, expectedOwner }),
      );
      const context = await writeContext(ownerId, signal, provided);
      if (context.version === 2) {
        return measure("cloud_upsert", async () => {
          const { data, error } = await rpc(
            "save_my_diary_snapshot_v2",
            { p_payload: payload, p_expected_revision: context.revision },
            signal,
          );
          if (error) throw error;
          if (!data?.ok) throw diaryWriteError(data?.error);
          contexts.set(
            ownerId,
            validateDiaryWriteContext({
              version: 2,
              revision: data.write_revision,
            }),
          );
          protocol = "v2";
          return data;
        });
      }
      let request = client
        .from("diary_snapshots")
        .upsert(
          { owner_id: ownerId, source: SOURCE, schema_version: 1, payload },
          {
            onConflict: "owner_id,source",
          },
        )
        .select("schema_version, updated_at");
      if (signal && request.abortSignal) request = request.abortSignal(signal);
      return measure("cloud_upsert", async () => {
        const { data, error } = await request.single();
        checkSignal(signal);
        legacyError(error, ownerId);
        return data;
      });
    },
    async remove(options = {}) {
      const ownerId = await getOwnerId(options);
      const context = await writeContext(
        ownerId,
        options.signal,
        options.writeContext,
      );
      if (context.version === 2) {
        const { data, error } = await rpc(
          "remove_my_diary_snapshot_v2",
          { p_expected_revision: context.revision },
          options.signal,
        );
        if (error) throw error;
        if (!data?.ok) throw diaryWriteError(data?.error);
        contexts.set(ownerId, { version: 2, revision: null });
        return;
      }
      let request = client
        .from("diary_snapshots")
        .delete()
        .eq("owner_id", ownerId)
        .eq("source", SOURCE);
      if (options.signal && request.abortSignal)
        request = request.abortSignal(options.signal);
      const { error } = await request;
      checkSignal(options.signal);
      legacyError(error, ownerId);
    },
  });
}

export { createCloudDiaryRepository, validateSnapshot };
