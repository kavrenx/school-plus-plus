import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  USERSCRIPT_VERSION,
  getUserscriptVersionStatus,
  isUserscriptUpdateError,
} from "../js/userscript-version.js";
import {
  createPublicUserscriptClient,
  createUserscriptClient,
} from "../js/userscript-client.js";
import { runSchoolppUserscript } from "../js/userscript-runtime.js";

test("stable versions compare numerically without forcing a downgrade", () => {
  for (const version of [USERSCRIPT_VERSION, "1.0.10", "1.1.0", "10.0.0"])
    assert.equal(getUserscriptVersionStatus(version), "current");
  for (const version of ["1.0.0", "0.99.99"])
    assert.equal(getUserscriptVersionStatus(version), "outdated");
  for (const version of [
    undefined,
    null,
    {},
    "",
    "1",
    "1.0",
    "1.0.01",
    "1.0.1-test",
    "1.0.1<script>",
    "9999999.0.0",
  ])
    assert.equal(getUserscriptVersionStatus(version), "unknown");
});

async function runtime(version, { production = true, available = true } = {}) {
  const window = new Window({ url: "https://schoolpp.com" });
  const scope = { document: window.document, location: window.location };
  scope.top = scope;
  const gm = Object.fromEntries(
    ["getValue", "setValue", "deleteValue", "getTab", "saveTab"].map((name) => [
      name,
      () => assert.fail("version check must not access data"),
    ]),
  );
  await runSchoolppUserscript(scope, available ? gm : null, null, {
    origins: [window.location.origin],
    version,
    ...(production ? { transport: "userscript" } : {}),
  });
  return {
    window,
    client: (production
      ? createPublicUserscriptClient
      : createUserscriptClient)(window, 10),
  };
}

test("public ping rejects an old script response even if the DOM marker claims a new version", async () => {
  const f = await runtime("1.0.0");
  try {
    f.window.document.documentElement.setAttribute(
      "data-schoolpp-userscript",
      JSON.stringify({ version: "99.0.0", state: "ready" }),
    );
    await assert.rejects(
      f.client.ping(),
      (error) =>
        error.code === "script_update_required" &&
        isUserscriptUpdateError(error),
    );
  } finally {
    f.window.close();
  }
});

test("current and newer script responses proceed, including a fresh document after update", async () => {
  for (const version of [USERSCRIPT_VERSION, "1.0.10", "2.0.0"]) {
    const f = await runtime(version);
    try {
      assert.equal((await f.client.ping()).version, version);
    } finally {
      f.window.close();
    }
  }
});

test("unknown version is distinct from unsupported manager and a missing bridge", async () => {
  const unknown = await runtime(undefined);
  const unsupported = await runtime("1.0.0", { available: false });
  const absent = new Window({ url: "https://schoolpp.com" });
  try {
    await assert.rejects(unknown.client.ping(), {
      code: "script_version_unknown",
    });
    await assert.rejects(
      unsupported.client.ping(),
      (error) =>
        error.code === "unsupported_manager" && !isUserscriptUpdateError(error),
    );
    await assert.rejects(
      createPublicUserscriptClient(absent, 5).ping(),
      (error) =>
        error.code === "bridge_no_response" && !isUserscriptUpdateError(error),
    );
  } finally {
    unknown.window.close();
    unsupported.window.close();
    absent.close();
  }
});

test("the independent v1 local test installer does not acquire a production version gate", async () => {
  const f = await runtime("0.1.1-test", { production: false });
  try {
    assert.equal((await f.client.ping()).compatible, true);
  } finally {
    f.window.close();
  }
});
