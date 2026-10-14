import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

test("device pairing enforces confirmation, isolation, expiration, rate limits and revocation in PostgreSQL", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const owner = "00000000-0000-0000-0000-000000000101";
  const phone = "00000000-0000-0000-0000-000000000102";
  const stranger = "00000000-0000-0000-0000-000000000103";
  const guesser = "00000000-0000-0000-0000-000000000104";
  const caller = async (id) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  };
  const rpc = async (expression, values = []) =>
    (await db.query(`select ${expression} as result`, values)).rows[0].result;
  try {
    await db.exec(`create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
      create role anon; create role authenticated;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated,anon;`);
    await db.exec(
      readFileSync(
        new URL(
          "../supabase/migrations/202609150001_personal_diary.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      readFileSync(
        new URL(
          "../supabase/migrations/202610140001_linked_devices.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const id of [owner, phone, stranger, guesser])
      await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query(
      "insert into public.diary_snapshots(owner_id,source,payload) values($1,'e-schools.by',$2)",
      [owner, { source: "e-schools.by", secret: "only-approved-devices" }],
    );
    await caller(owner);
    const pairing = await rpc("public.create_diary_pairing()");
    assert.equal(pairing.ok, true);
    assert.match(pairing.code, /^\d{8}$/);
    await caller(phone);
    const claim = await rpc("public.request_diary_pairing($1,$2)", [
      pairing.code,
      "Телефон",
    ]);
    assert.equal(claim.status, "pending");
    const retry = await rpc("public.request_diary_pairing($1,$2)", [
      pairing.code,
      "Телефон",
    ]);
    assert.equal(retry.id, claim.id);
    assert.equal(retry.verificationCode, claim.verificationCode);
    assert.equal((await rpc("public.get_linked_diary_snapshot()")).ok, false);
    await caller(stranger);
    assert.equal(
      (await rpc("public.get_diary_pairing($1)", [pairing.id])).ok,
      false,
    );
    assert.equal(
      (await rpc("public.respond_diary_pairing($1,true)", [pairing.id])).ok,
      false,
    );
    assert.equal(
      (
        await rpc("public.request_diary_pairing($1,$2)", [
          pairing.code,
          "Другой телефон",
        ])
      ).ok,
      false,
    );
    await caller(owner);
    assert.equal(
      (await rpc("public.get_diary_pairing($1)", [pairing.id]))
        .verificationCode,
      claim.verificationCode,
    );
    assert.equal(
      (await rpc("public.respond_diary_pairing($1,true)", [pairing.id])).status,
      "approved",
    );
    assert.equal(
      (await rpc("public.respond_diary_pairing($1,true)", [pairing.id])).ok,
      false,
    );
    const devices = await rpc("public.list_diary_devices()");
    assert.equal(devices.devices.length, 1);
    const deviceId = devices.devices[0].id;
    const event = {
      id: "event-1",
      type: "grades",
      date: "2026-10-14",
      subject: "Физика",
      before: [],
      after: ["9"],
      syncedAt: "2026-10-14T10:00:00Z",
    };
    assert.equal(
      (await rpc("public.save_diary_change_events($1)", [[event]])).ok,
      true,
    );
    await caller(phone);
    assert.equal((await rpc("public.get_my_diary_access()")).role, "linked");
    assert.equal(
      (await rpc("public.get_linked_diary_snapshot()")).payload.secret,
      "only-approved-devices",
    );
    assert.equal((await rpc("public.get_my_diary_changes()")).length, 1);
    assert.equal(
      (await rpc("public.save_diary_change_events($1)", [[event]])).ok,
      false,
    );
    assert.equal((await rpc("public.create_diary_pairing()")).ok, false);
    await assert.rejects(
      db.query("select * from public.diary_device_links"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select public.diary_pairing_allow('claim',10000,0)"),
      /permission denied/,
    );
    await db.query(
      "update public.diary_snapshots set payload = '{}' where owner_id = $1",
      [owner],
    );
    assert.equal(
      (await rpc("public.get_linked_diary_snapshot()")).payload.secret,
      "only-approved-devices",
    );
    await caller(stranger);
    assert.equal(
      (
        await rpc("public.rename_diary_device($1,'Чужое устройство')", [
          deviceId,
        ])
      ).ok,
      false,
    );
    assert.equal(
      (await rpc("public.revoke_diary_device($1)", [deviceId])).ok,
      false,
    );
    await caller(owner);
    assert.equal(
      (await rpc("public.revoke_diary_device($1)", [deviceId])).ok,
      true,
    );
    await caller(phone);
    assert.equal(
      (await rpc("public.get_my_diary_revision()")).access.role,
      "unpaired",
    );
    assert.equal((await rpc("public.get_linked_diary_snapshot()")).ok, false);
    assert.deepEqual(await rpc("public.get_my_diary_changes()"), []);
    await caller(owner);
    const expired = await rpc("public.create_diary_pairing()");
    await db.exec("reset role");
    await db.query(
      "update public.diary_pairing_requests set expires_at = now() - interval '1 second' where id = $1",
      [expired.id],
    );
    await caller(guesser);
    assert.equal(
      (await rpc("public.request_diary_pairing($1,'Телефон')", [expired.code]))
        .error,
      "pair_code_invalid",
    );
    for (let index = 0; index < 4; index++)
      assert.equal(
        (await rpc("public.request_diary_pairing('99999999','Телефон')")).error,
        "pair_code_invalid",
      );
    assert.equal(
      (await rpc("public.request_diary_pairing('99999999','Телефон')")).error,
      "pair_rate_limited",
    );
    await caller(owner);
    const again = await rpc("public.create_diary_pairing()");
    await caller(phone);
    assert.equal(
      (await rpc("public.request_diary_pairing($1,'Телефон')", [again.code]))
        .status,
      "pending",
    );
    await caller(owner);
    assert.equal(
      (await rpc("public.respond_diary_pairing($1,true)", [again.id])).status,
      "approved",
    );
    await db.query("delete from public.diary_snapshots where owner_id = $1", [
      owner,
    ]);
    await caller(phone);
    assert.equal(
      (await rpc("public.get_my_diary_revision()")).access.role,
      "unpaired",
    );
    assert.equal((await rpc("public.get_linked_diary_snapshot()")).ok, false);
    assert.deepEqual(await rpc("public.get_my_diary_changes()"), []);
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select public.create_diary_pairing()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
