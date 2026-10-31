import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createCloudDiaryRepository } from "../js/cloud-diary-repository.js";

test("versioned diary SQL preserves access rules and rejects stale writes through staged rollout", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const owner = "00000000-0000-4000-8000-000000000101";
  const phone = "00000000-0000-4000-8000-000000000102";
  const other = "00000000-0000-4000-8000-000000000103";
  const payload = (mark) => ({ source: "e-schools.by", lessons: [{ mark }] });
  const sql = (path) =>
    readFileSync(new URL(`../supabase/${path}`, import.meta.url), "utf8");
  const caller = async (id) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  };
  const rpc = async (expression, values = []) =>
    (await db.query(`select public.${expression} as result`, values)).rows[0]
      .result;
  const read = (include = true) =>
    rpc("get_my_diary_snapshot_v2($1)", [include]);
  const save = (value, revision) =>
    rpc("save_my_diary_snapshot_v2($1,$2)", [value, revision]);
  const remove = (revision) =>
    rpc("remove_my_diary_snapshot_v2($1)", [revision]);
  let initial, newest;
  try {
    await db.exec(`create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
      create role anon; create role authenticated; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated,anon;`);
    await db.exec(sql("migrations/202609150001_personal_diary.sql"));
    await db.exec(sql("migrations/202610140001_linked_devices.sql"));
    for (const id of [owner, phone, other])
      await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query(
      "insert into public.diary_snapshots(owner_id,source,payload) values($1,'e-schools.by',$2)",
      [owner, payload("8")],
    );
    await db.exec(sql("migrations/202610310001_diary_write_revisions.sql"));
    await caller(owner);

    await t.test(
      "existing rows receive revisions; legacy reads and writes survive the additive stage",
      async () => {
        initial = (await read()).snapshot;
        assert.deepEqual(initial.payload, payload("8"));
        assert.match(initial.write_revision, /^[0-9a-f-]{36}$/);
        assert.equal((await read(false)).snapshot.payload, undefined);
        assert.equal((await rpc("get_my_diary_access()")).role, "owner");
        await db.query(
          "update public.diary_snapshots set payload=$1,write_revision=$2 where owner_id=$3",
          [payload("9"), initial.write_revision, owner],
        );
        newest = (await read()).snapshot;
        assert.notEqual(newest.write_revision, initial.write_revision);
        assert.equal(
          (await save(payload("7"), initial.write_revision)).error,
          "diary_snapshot_conflict",
        );
        assert.deepEqual((await read()).snapshot.payload, payload("9"));
      },
    );

    await t.test(
      "two writers sharing one observed revision cannot both replace different data",
      async () => {
        const revision = newest.write_revision;
        const first = await save(payload("10"), revision);
        assert.equal(first.ok, true);
        assert.notEqual(first.write_revision, revision);
        assert.equal(
          (await save(payload("6"), revision)).error,
          "diary_snapshot_conflict",
        );
        newest = (await read()).snapshot;
        assert.deepEqual(newest.payload, payload("10"));
        const retry = await save(payload("10"), revision);
        assert.equal(retry.ok, true);
        assert.equal(retry.unchanged, true);
        assert.equal(retry.write_revision, newest.write_revision);
        assert.equal(retry.updated_at, newest.updated_at);
      },
    );

    await t.test(
      "invalid input, missing auth and anonymous execution cannot change the diary",
      async () => {
        for (const value of [
          null,
          [],
          {},
          { source: "other" },
          { source: "e-schools.by", text: "я".repeat(1_000_000) },
        ])
          assert.equal(
            (await save(value, newest.write_revision)).error,
            "snapshot_invalid",
          );
        await caller("");
        assert.equal((await read()).error, "sign_in_required");
        assert.equal(
          (await save(payload("1"), null)).error,
          "sign_in_required",
        );
        assert.equal((await remove(null)).error, "sign_in_required");
        await db.exec("set role anon");
        for (const expression of [
          "get_my_diary_snapshot_v2()",
          "save_my_diary_snapshot_v2('{}',null)",
          "remove_my_diary_snapshot_v2(null)",
        ])
          await assert.rejects(rpc(expression), /permission denied/);
        await caller(owner);
        assert.deepEqual((await read()).snapshot.payload, newest.payload);
      },
    );

    await t.test(
      "other accounts cannot read or overwrite an owner with their revision",
      async () => {
        await caller(other);
        assert.equal((await read()).snapshot, null);
        assert.equal(
          (await save(payload("1"), newest.write_revision)).error,
          "diary_snapshot_conflict",
        );
        assert.equal((await remove(newest.write_revision)).removed, false);
        const own = await save(payload("5"), null);
        assert.equal(own.ok, true);
        assert.equal(
          (await db.query("select owner_id from public.diary_snapshots")).rows
            .length,
          1,
        );
        await assert.rejects(
          db.query("update public.diary_snapshots set owner_id=$1", [owner]),
          /row-level security/,
        );
        await caller(owner);
        assert.deepEqual((await read()).snapshot.payload, newest.payload);
      },
    );

    await t.test(
      "independent client repositories pass their pinned revisions through the real SQL functions",
      async () => {
        const makeClient = () =>
          createCloudDiaryRepository({
            auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
            rpc(name, params) {
              const run = async () => {
                if (name === "get_my_diary_snapshot_v2")
                  return { data: await read(params.p_include_payload) };
                if (name === "save_my_diary_snapshot_v2")
                  return {
                    data: await save(
                      params.p_payload,
                      params.p_expected_revision,
                    ),
                  };
                if (name === "remove_my_diary_snapshot_v2")
                  return { data: await remove(params.p_expected_revision) };
                assert.fail("unexpected RPC");
              };
              return run();
            },
            from: () => assert.fail("v2 must not write directly"),
          });
        const first = makeClient(),
          second = makeClient();
        const firstContext = await first.getWriteContext();
        const secondContext = await second.getWriteContext();
        assert.deepEqual(firstContext, secondContext);
        await first.save(payload("9"), { writeContext: firstContext });
        await assert.rejects(
          second.save(payload("3"), { writeContext: secondContext }),
          { code: "diary_snapshot_conflict" },
        );
        assert.equal(
          (await first.save(payload("9"), { writeContext: firstContext }))
            .unchanged,
          true,
        );
        await assert.rejects(second.remove({ writeContext: secondContext }), {
          code: "diary_snapshot_conflict",
        });
        newest = (await read()).snapshot;
        assert.deepEqual(newest.payload, payload("9"));
      },
    );

    await t.test(
      "approved linked devices retain reads and cannot write or delete via the new RPCs",
      async () => {
        const pairing = await rpc("create_diary_pairing()");
        await caller(phone);
        assert.equal(
          (
            await rpc("request_diary_pairing($1,'Synthetic phone')", [
              pairing.code,
            ])
          ).status,
          "pending",
        );
        await caller(owner);
        assert.equal(
          (await rpc("respond_diary_pairing($1,true)", [pairing.id])).status,
          "approved",
        );
        await caller(phone);
        assert.equal((await rpc("get_my_diary_access()")).role, "linked");
        assert.deepEqual(
          (await rpc("get_linked_diary_snapshot()")).payload,
          newest.payload,
        );
        assert.equal(
          (await save(payload("1"), null)).error,
          "pair_owner_required",
        );
        assert.equal((await remove(null)).error, "pair_owner_required");
        await caller(owner);
      },
    );

    await t.test(
      "cutover blocks direct writes while preserving RLS reads, new RPCs and linked reads",
      async () => {
        await db.exec("reset role");
        await db.exec(sql("rollout/enable_diary_revision_writes.sql"));
        await caller(owner);
        assert.equal(
          (await db.query("select owner_id from public.diary_snapshots")).rows
            .length,
          1,
        );
        for (const query of [
          "update public.diary_snapshots set payload='{}'",
          "delete from public.diary_snapshots",
          "insert into public.diary_snapshots(owner_id,source,payload) values(auth.uid(),'e-schools.by','{}')",
        ])
          await assert.rejects(db.query(query), /permission denied/);
        const result = await save(payload("9"), newest.write_revision);
        assert.equal(result.ok, true);
        newest = (await read()).snapshot;
        await caller(phone);
        assert.deepEqual(
          (await rpc("get_linked_diary_snapshot()")).payload,
          payload("9"),
        );
        await caller(owner);
      },
    );

    await t.test(
      "deletion checks the revision, revokes linked access and cannot reuse an old revision after recreation",
      async () => {
        assert.equal(
          (await remove(initial.write_revision)).error,
          "diary_snapshot_conflict",
        );
        assert.equal((await remove(newest.write_revision)).removed, true);
        assert.equal((await remove(newest.write_revision)).removed, false);
        assert.equal((await read()).snapshot, null);
        await caller(phone);
        assert.equal((await rpc("get_my_diary_access()")).role, "unpaired");
        assert.equal((await rpc("get_linked_diary_snapshot()")).ok, false);
        await caller(owner);
        assert.equal(
          (await save(payload("7"), newest.write_revision)).error,
          "diary_snapshot_conflict",
        );
        const fresh = await save(payload("7"), null);
        assert.equal(fresh.ok, true);
        assert.notEqual(fresh.write_revision, newest.write_revision);
        assert.equal(
          (await remove(newest.write_revision)).error,
          "diary_snapshot_conflict",
        );
        assert.equal(
          (await save(payload("2"), newest.write_revision)).error,
          "diary_snapshot_conflict",
        );
      },
    );
  } finally {
    await db.close();
  }
});
