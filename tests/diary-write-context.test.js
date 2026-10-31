import assert from "node:assert/strict";
import test from "node:test";
import { createCloudDiaryRepository } from "../js/cloud-diary-repository.js";
import { createDiaryHistoryRepository } from "../js/cloud-diary-history.js";
import { validateDiaryWriteContext } from "../js/diary-write-context.js";

const revisionA = "00000000-0000-4000-8000-000000000001";
const revisionB = "00000000-0000-4000-8000-000000000002";
const payload = { source: "e-schools.by", lessons: [] };
const version = (revision) => ({ version: 2, revision });
const response = (revision, includePayload = true) => ({
  data: {
    ok: true,
    snapshot: {
      write_revision: revision,
      ...(includePayload ? { payload } : {}),
    },
  },
});

function fixture(handle) {
  const requests = [],
    direct = [];
  let owner = "synthetic-owner";
  let legacyError;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
    rpc(name, params) {
      const request = { name, params, owner };
      requests.push(request);
      const promise = Promise.resolve().then(() => handle(request));
      promise.abortSignal = (signal) => {
        request.signal = signal;
        return promise;
      };
      return promise;
    },
    from(table) {
      direct.push({ table });
      const query = {
        select: () => query,
        eq: () => query,
        abortSignal: () => query,
        upsert(value) {
          direct.at(-1).value = value;
          return query;
        },
        delete() {
          direct.at(-1).delete = true;
          return query;
        },
        single: async () => ({
          data: { schema_version: 1 },
          error: legacyError,
        }),
        maybeSingle: async () => ({ data: { payload } }),
        then: (resolve) =>
          Promise.resolve({ error: legacyError }).then(resolve),
      };
      return query;
    },
  };
  return {
    repository: createCloudDiaryRepository(client),
    requests,
    direct,
    setOwner: (value) => {
      owner = value;
    },
    setLegacyError: (value) => {
      legacyError = value;
    },
  };
}

test("a pinned pre-collection revision survives later baseline reads and is sent unchanged", async () => {
  let reads = 0;
  const f = fixture(({ name, params }) => {
    if (name === "get_my_diary_snapshot_v2")
      return response(
        ++reads === 1 ? revisionA : revisionB,
        params.p_include_payload,
      );
    assert.equal(name, "save_my_diary_snapshot_v2");
    assert.deepEqual(params, {
      p_payload: payload,
      p_expected_revision: revisionA,
    });
    return { data: { ok: false, error: "diary_snapshot_conflict" } };
  });
  const context = await f.repository.getWriteContext();
  assert.deepEqual(context, version(revisionA));
  await f.repository.load();
  await assert.rejects(f.repository.save(payload, { writeContext: context }), {
    code: "diary_snapshot_conflict",
  });
  assert.equal(f.requests[0].params.p_include_payload, false);
  assert.equal(f.requests[1].params.p_include_payload, true);
  assert.equal(f.direct.length, 0);
});

test("a lost write response retries the original revision without refreshing or using a direct upsert", async () => {
  let writes = 0;
  const f = fixture(({ name, params }) => {
    assert.equal(name, "save_my_diary_snapshot_v2");
    assert.equal(params.p_expected_revision, revisionA);
    return ++writes === 1
      ? { error: new TypeError("synthetic offline") }
      : { data: { ok: true, unchanged: true, write_revision: revisionB } };
  });
  await assert.rejects(
    f.repository.save(payload, { writeContext: version(revisionA) }),
    /synthetic offline/,
  );
  assert.equal(
    (await f.repository.save(payload, { writeContext: version(revisionA) }))
      .unchanged,
    true,
  );
  assert.equal(f.requests.length, 2);
  assert.equal(f.direct.length, 0);
});

test("only an explicitly absent new read RPC enables legacy-server compatibility", async () => {
  for (const code of ["42501", "PGRST301", "TEST_OFFLINE"]) {
    const f = fixture(() => ({ error: { code } }));
    await assert.rejects(f.repository.load(), { code });
    await assert.rejects(f.repository.save(payload), { code });
    assert.equal(f.direct.length, 0);
  }
  const f = fixture(() => ({ error: { code: "PGRST202" } }));
  assert.deepEqual((await f.repository.load()).payload, payload);
  assert.deepEqual(await f.repository.getWriteContext(), { version: 1 });
  await f.repository.save(payload, { writeContext: { version: 1 } });
  assert.deepEqual(f.direct.at(-1).value.payload, payload);
  assert.equal(f.requests.length, 1);
  f.setLegacyError({ code: "42501" });
  await assert.rejects(f.repository.save(payload), {
    code: "diary_client_outdated",
  });
});

test("a known v2 server never downgrades after RPC failure or malformed success", async () => {
  let bad = false;
  const f = fixture(() =>
    bad ? { error: { code: "PGRST202" } } : response(revisionA),
  );
  await f.repository.load();
  bad = true;
  await assert.rejects(f.repository.load(), { code: "PGRST202" });
  assert.equal(f.direct.length, 0);
  for (const data of [
    { ok: true },
    { ok: true, snapshot: {} },
    { ok: true, snapshot: { write_revision: revisionA } },
  ]) {
    const invalid = fixture(() => ({ data }));
    await assert.rejects(invalid.repository.load(), {
      code: "diary_write_context_required",
    });
    assert.equal(invalid.direct.length, 0);
  }
});

test("a cache collected without a revision cannot adopt a version from the upgraded server", async () => {
  const f = fixture(() => response(revisionA));
  await assert.rejects(
    f.repository.save(payload, { writeContext: { version: 1 } }),
    { code: "diary_write_context_required" },
  );
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].name, "get_my_diary_snapshot_v2");
  assert.equal(f.direct.length, 0);
});

test("per-account contexts stay separate and aborted auth cannot issue a request", async () => {
  const f = fixture(({ name, owner }) => {
    if (name === "get_my_diary_snapshot_v2")
      return response(owner === "synthetic-owner" ? revisionA : revisionB);
    return { data: { ok: true, write_revision: revisionB } };
  });
  await f.repository.load();
  f.setOwner("synthetic-other");
  await f.repository.save(payload);
  assert.equal(f.requests.at(-1).params.p_expected_revision, revisionB);
  f.setOwner("synthetic-owner");
  await f.repository.save(payload);
  assert.equal(f.requests.at(-1).params.p_expected_revision, revisionA);
  const count = f.requests.length;
  await assert.rejects(
    f.repository.getWriteContext({ expectedOwner: "synthetic-other" }),
    /Сеанс/,
  );
  const controller = new AbortController();
  controller.abort(new Error("synthetic cancel"));
  await assert.rejects(
    f.repository.save(payload, { signal: controller.signal }),
    /synthetic cancel/,
  );
  assert.equal(f.requests.length, count);
});

test("a guarded history deletion forwards its pinned revision and conflict cannot remove the outbox", async () => {
  const f = fixture(({ name, params }) => {
    assert.equal(name, "remove_my_diary_snapshot_v2");
    assert.equal(params.p_expected_revision, revisionA);
    return { data: { ok: false, error: "diary_snapshot_conflict" } };
  });
  const history = createDiaryHistoryRepository(
    f.repository,
    {},
    {
      getIdentity: async () => "synthetic-owner",
      storage: {
        removeItem: () => assert.fail("conflict cannot clear outbox"),
      },
    },
  );
  await assert.rejects(history.remove({ writeContext: version(revisionA) }), {
    code: "diary_snapshot_conflict",
  });
  assert.equal(f.direct.length, 0);
});

test("context validation accepts an absent row revision and rejects malformed metadata", () => {
  assert.deepEqual(validateDiaryWriteContext(version(null)), version(null));
  for (const value of [
    undefined,
    {},
    { version: 3 },
    version(""),
    version("not-a-uuid"),
    version(123),
  ])
    assert.throws(() => validateDiaryWriteContext(value), {
      code: "diary_write_context_required",
    });
});
