import assert from "node:assert/strict";
import test from "node:test";
import { createCloudAuth } from "../js/cloud-auth.js";
import {
  createCloudDiaryRepository,
  validateSnapshot,
} from "../js/cloud-diary-repository.js";
import { getSupabaseConfig } from "../js/supabase-config.js";
import { createSupabaseServices } from "../js/supabase-services.js";

test("Supabase factory can be imported in Node and does not connect without config", () => {
  assert.equal(createSupabaseServices({}), null);
});

test("cloud config rejects secret keys and incomplete settings", () => {
  assert.equal(getSupabaseConfig({}), null);
  assert.throws(() =>
    getSupabaseConfig({ VITE_SUPABASE_URL: "https://example.supabase.co" }),
  );
  assert.throws(() =>
    getSupabaseConfig({
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_unsafe",
    }),
  );
  assert.equal(
    getSupabaseConfig({
      VITE_SUPABASE_URL: "https://example.supabase.co/",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    }).url,
    "https://example.supabase.co",
  );
});

test("sign in uses Supabase and preserves password whitespace", async () => {
  let credentials;
  const auth = createCloudAuth({
    auth: {
      async signInWithPassword(value) {
        credentials = value;
        return { data: { session: { user: { id: "real-user" } } } };
      },
    },
  });
  assert.equal(
    (await auth.signIn(" user@example.com ", " secret ")).session.user.id,
    "real-user",
  );
  assert.deepEqual(credentials, {
    email: "user@example.com",
    password: " secret ",
  });
});

test("missing Supabase session is a signed-out state", async () => {
  const auth = createCloudAuth({
    auth: {
      async getUser() {
        return {
          data: { user: null },
          error: { name: "AuthSessionMissingError" },
        };
      },
    },
  });
  assert.equal(await auth.getUser(), null);
});

test("failed logout remains a failure", async () => {
  const failure = new Error("offline");
  const auth = createCloudAuth({
    auth: {
      async signOut() {
        return { error: failure };
      },
    },
  });
  await assert.rejects(auth.signOut(), failure);
});

test("signup never assigns a school role and validates redirects", async () => {
  let request;
  const auth = createCloudAuth({
    auth: {
      async signUp(value) {
        request = value;
        return { data: { session: null } };
      },
    },
  });
  await auth.signUp("user@example.com", "password", "https://schoolpp.com/");
  assert.deepEqual(request.options, {
    emailRedirectTo: "https://schoolpp.com/",
  });
  await assert.rejects(
    auth.signUp("a@b.com", "password", "javascript:alert(1)"),
  );
});

test("snapshot validation rejects oversized data and isolates mutations", () => {
  assert.throws(() => validateSnapshot([]));
  assert.throws(
    () => validateSnapshot({ text: "я".repeat(1_000_001) }),
    RangeError,
  );
  const original = { lessons: [{ grade: 9 }] };
  const copy = validateSnapshot(original);
  original.lessons[0].grade = 1;
  assert.equal(copy.lessons[0].grade, 9);
});

test("unauthenticated import never reaches the database", async () => {
  const repository = createCloudDiaryRepository({
    auth: {
      async getUser() {
        return { data: { user: null } };
      },
    },
    from() {
      assert.fail("Database must not be called");
    },
  });
  await assert.rejects(repository.save({ weeks: [] }), /Войдите/);
  await assert.rejects(repository.load(), /Войдите/);
  await assert.rejects(repository.remove(), /Войдите/);
});

test("import owner comes from authenticated user and storage errors propagate", async () => {
  let saved;
  const failure = new Error("RLS rejected write");
  const query = {
    upsert(value) {
      saved = value;
      return query;
    },
    select() {
      return query;
    },
    async single() {
      return { error: failure };
    },
  };
  const repository = createCloudDiaryRepository({
    auth: {
      async getUser() {
        return { data: { user: { id: "signed-in-user" } } };
      },
    },
    from() {
      return query;
    },
  });
  await assert.rejects(
    repository.save({ owner_id: "someone-else", weeks: [] }),
    failure,
  );
  assert.equal(saved.owner_id, "signed-in-user");
  assert.equal(saved.source, "e-schools.by");
  assert.equal(saved.updated_at, undefined);
});
