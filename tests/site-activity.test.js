import assert from "node:assert/strict";
import test from "node:test";

import { createActivityReporter, describeClient } from "../js/site-activity.js";

test("activity context keeps only broad device and browser categories", () => {
  assert.deepEqual(describeClient({ userAgent: "Mozilla/5.0 Firefox/142.0" }), {
    browser: "firefox",
    device: "desktop",
  });
  assert.deepEqual(
    describeClient({ userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/142" }),
    { browser: "chrome", device: "mobile" },
  );
});

test("activity reporter authenticates before sending an event", async () => {
  const order = [];
  const reporter = createActivityReporter({
    services: {
      admin: {
        async recordActivity(event, context) {
          order.push({ event, context });
        },
      },
    },
    async ensureUser() {
      order.push("auth");
    },
    navigatorRef: { userAgent: "Mozilla/5.0 Chrome/142" },
  });

  assert.equal(await reporter("page_view"), true);
  assert.deepEqual(order, [
    "auth",
    {
      event: "page_view",
      context: { browser: "chrome", device: "desktop" },
    },
  ]);
});
