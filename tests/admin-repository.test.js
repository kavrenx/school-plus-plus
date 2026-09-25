import assert from "node:assert/strict";
import test from "node:test";

import { createAdminRepository } from "../js/admin-repository.js";

test("admin repository records only declared client context and loads dashboard", async () => {
  const calls = [];
  const client = {
    auth: {
      async getUser() {
        return { data: { user: { id: "admin-1" } }, error: null };
      },
    },
    async rpc(name, parameters) {
      calls.push({ name, parameters });
      if (name === "is_schoolpp_admin") return { data: true, error: null };
      if (name === "get_admin_dashboard")
        return { data: { summary: { viewsToday: 4 } }, error: null };
      return { data: null, error: null };
    },
  };
  const repository = createAdminRepository(client);

  assert.equal(await repository.isAdmin(), true);
  await repository.recordActivity("page_view", {
    device: "desktop",
    browser: "firefox",
  });
  const dashboard = await repository.getDashboard(200);

  assert.equal(dashboard.summary.viewsToday, 4);
  assert.deepEqual(calls[1], {
    name: "record_site_activity",
    parameters: {
      p_event: "page_view",
      p_device: "desktop",
      p_browser: "firefox",
    },
  });
  assert.equal(calls[2].parameters.p_days, 31);
});

test("admin repository never calls privileged RPC without a session", async () => {
  let calls = 0;
  const repository = createAdminRepository({
    auth: {
      async getUser() {
        return { data: { user: null }, error: null };
      },
    },
    async rpc() {
      calls += 1;
    },
  });

  assert.equal(await repository.isAdmin(), false);
  await assert.rejects(() => repository.getDashboard(), /ADMIN_AUTH_REQUIRED/);
  assert.equal(calls, 0);
});
