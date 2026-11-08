import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("support queues only incoming events and leases delivery to the service role", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const owner = "00000000-0000-4000-8000-000000000101";
  const agent = "00000000-0000-4000-8000-000000000102";
  const conversation = "00000000-0000-4000-8000-000000000201";
  const request = "00000000-0000-4000-8000-000000000202";
  const migration = (name) =>
    readFileSync(
      new URL(`../supabase/migrations/${name}.sql`, import.meta.url),
      "utf8",
    );
  const claim = async () =>
    (await db.query("select * from public.claim_support_notifications()")).rows;
  const finish = async (row, sent, delay = 0) =>
    (
      await db.query(
        "select public.finish_support_notification($1, $2, $3, $4) as ok",
        [row.id, row.lease, sent, delay],
      )
    ).rows[0].ok;
  const signIn = async (id) => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      id,
    ]);
    await db.exec("set role authenticated");
  };
  const send = (sender, body) =>
    db.query(
      "insert into public.support_messages(conversation_id, sender_id, body) values ($1, $2, $3)",
      [conversation, sender, body],
    );

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    create publication supabase_realtime;
  `);
  await db.exec(migration("202609200001_support_chat"));
  await db.exec(migration("202609250001_diary_requests"));
  await db.query("insert into auth.users(id) values ($1), ($2)", [
    owner,
    agent,
  ]);
  await db.query("insert into public.support_agents(user_id) values ($1)", [
    agent,
  ]);
  await signIn(owner);
  await db.query(
    "insert into public.support_conversations(id, owner_id) values ($1, $2)",
    [conversation, owner],
  );
  await send(owner, "Synthetic historical message");
  await db.exec("reset role");
  await db.exec(migration("202611080001_support_notifications"));

  await signIn(owner);
  await send(owner, "Synthetic incoming message");
  await db.query(
    `insert into public.diary_requests(id, owner_id, requester_name, diary_url, contact)
    values ($1, $2, 'Test Student', 'https://diary.example', 'test@example.invalid')`,
    [request, owner],
  );
  await assert.rejects(
    () => send(agent, "Forged sender"),
    /row-level security/,
  );
  await assert.rejects(claim, /permission denied/);
  await assert.rejects(
    () => finish({ id: 1, lease: conversation }, true),
    /permission denied/,
  );
  await assert.rejects(
    () => db.query("select * from schoolpp_support.notifications"),
    /permission denied/,
  );
  await db.exec("reset role");
  await signIn(agent);
  await send(agent, "Synthetic operator reply");
  await db.query(
    "update public.diary_requests set status = 'in_review' where id = $1",
    [request],
  );

  await db.exec("reset role; set role service_role");
  const batch = await claim();
  assert.deepEqual(
    batch.map(({ kind, target_id }) => [kind, target_id]).sort(),
    [
      ["conversation", conversation],
      ["request", request],
    ],
  );
  assert.deepEqual(Object.keys(batch[0]).sort(), [
    "id",
    "kind",
    "lease",
    "target_id",
  ]);
  assert.deepEqual(await claim(), []);
  const messageJob = batch.find(({ kind }) => kind === "conversation");
  const requestJob = batch.find(({ kind }) => kind === "request");
  assert.equal(
    await finish({ ...messageJob, lease: requestJob.lease }, true),
    false,
  );
  assert.equal(await finish(messageJob, true), true);
  assert.equal(await finish(requestJob, false, 120), true);
  assert.deepEqual(await claim(), []);

  await db.exec("reset role");
  const {
    rows: [deferred],
  } = await db.query(`select lease, attempts,
    available_at > now() + interval '110 seconds' as delayed
    from schoolpp_support.notifications`);
  assert.deepEqual(deferred, { lease: null, attempts: 1, delayed: true });
  await db.exec(
    "update schoolpp_support.notifications set available_at = now(); set role service_role",
  );
  const [secondAttempt] = await claim();
  await db.exec(
    "reset role; update schoolpp_support.notifications set available_at = now(); set role service_role",
  );
  const [reclaimed] = await claim();
  assert.equal(reclaimed.id, requestJob.id);
  assert.notEqual(reclaimed.lease, secondAttempt.lease);
  assert.equal(await finish(secondAttempt, true), false);
  assert.equal(await finish(reclaimed, true), true);
  assert.deepEqual(await claim(), []);
});
