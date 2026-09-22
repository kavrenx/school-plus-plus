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
  async function getOwnerId() {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!data.user)
      throw new Error("Войдите в School++, чтобы получить свои данные.");
    return data.user.id;
  }

  return Object.freeze({
    async load() {
      const ownerId = await getOwnerId();
      const { data, error } = await client
        .from("diary_snapshots")
        .select("payload, schema_version, updated_at")
        .eq("owner_id", ownerId)
        .eq("source", SOURCE)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async save(snapshot) {
      const payload = validateSnapshot(snapshot);
      const ownerId = await getOwnerId();
      const { data, error } = await client
        .from("diary_snapshots")
        .upsert(
          { owner_id: ownerId, source: SOURCE, schema_version: 1, payload },
          {
            onConflict: "owner_id,source",
          },
        )
        .select("schema_version, updated_at")
        .single();
      if (error) throw error;
      return data;
    },
    async remove() {
      const ownerId = await getOwnerId();
      const { error } = await client
        .from("diary_snapshots")
        .delete()
        .eq("owner_id", ownerId)
        .eq("source", SOURCE);
      if (error) throw error;
    },
  });
}

export { createCloudDiaryRepository, validateSnapshot };
