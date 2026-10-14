import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  createDeviceController,
  renderDeviceJoin,
  pairingUrl,
} from "../js/device-controller.js";
import {
  createDeviceRepository,
  createDiaryRevisionWatcher,
} from "../js/device-repository.js";
import { createLinkedDiaryCache } from "../js/linked-diary-cache.js";

function environment() {
  const window = new Window({ url: "http://192.168.0.138:5174/" });
  window.setTimeout = () => 1;
  window.clearTimeout = () => {};
  Object.defineProperty(window.document, "hidden", {
    configurable: true,
    value: false,
  });
  return window;
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("pairing links preserve local address, replace old routes and reject unsafe origins", () => {
  assert.equal(
    pairingUrl("http://192.168.0.138:5174/?preview=diary#results", "12345678"),
    "http://192.168.0.138:5174/#connect/mobile?pair=12345678",
  );
  assert.throws(() => pairingUrl("javascript:alert(1)", "12345678"));
  assert.throws(() => pairingUrl("https://secret@example.com/", "12345678"));
  assert.ok(!renderDeviceJoin('"<script>').includes("<script>"));
});

test("phone requires computer approval, prevents duplicate claims and recovers a rejected request", async () => {
  const window = environment();
  window.document.body.innerHTML = renderDeviceJoin("1234 5678");
  let claims = 0,
    paired = 0,
    status = "pending";
  const repository = {
    requestPairing: async (code) => {
      claims++;
      assert.equal(code, "12345678");
      return { id: "request", status, verificationCode: "A1B2" };
    },
    pairing: async () => ({ id: "request", status, verificationCode: "A1B2" }),
  };
  const controller = createDeviceController({
    root: window.document,
    windowRef: window,
    repositoryProvider: async () => repository,
    onPaired: async () => {
      paired++;
    },
  });
  controller.bind();
  const submit = () =>
    window.document
      .querySelector("form[data-device-join]")
      .dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
  try {
    submit();
    submit();
    await flush();
    assert.equal(claims, 1);
    assert.equal(paired, 0);
    assert.equal(
      window.document.querySelector("[data-device-join]").hidden,
      true,
    );
    assert.equal(
      window.document.querySelector(".device-verification").textContent,
      "A1B2",
    );
    status = "rejected";
    await controller.check();
    assert.equal(
      window.document.querySelector("[data-device-join]").hidden,
      false,
    );
    assert.equal(window.sessionStorage.length, 0);
    assert.match(
      window.document.querySelector("[data-device-join-status]").textContent,
      /отклонил/,
    );
    status = "pending";
    submit();
    await flush();
    status = "approved";
    await controller.check();
    await controller.check();
    assert.equal(paired, 1);
    assert.equal(window.sessionStorage.length, 0);
  } finally {
    controller.stop();
    await window.happyDOM.close();
  }
});

test("phone restores the confirmation challenge after refreshing its tab", async () => {
  const window = environment();
  window.document.body.innerHTML = renderDeviceJoin();
  window.sessionStorage.setItem("schoolpp_device_pending_v1", "pending-id");
  const controller = createDeviceController({
    root: window.document,
    windowRef: window,
    repositoryProvider: async () => ({
      pairing: async (id) => {
        assert.equal(id, "pending-id");
        return { status: "pending", verificationCode: "55CC" };
      },
    }),
  });
  try {
    await controller.resumeClient();
    assert.equal(
      window.document.querySelector("[data-device-join]").hidden,
      true,
    );
    assert.equal(
      window.document.querySelector(".device-verification").textContent,
      "55CC",
    );
  } finally {
    controller.stop();
    await window.happyDOM.close();
  }
});

test("computer displays a QR and matching challenge, then explicitly approves the phone", async () => {
  const window = environment();
  window.document.body.innerHTML =
    '<button id="studentDevicesButton">Мои устройства</button>';
  let status = "waiting",
    approval = null,
    count = 0;
  const repository = {
    list: async () => ({
      access: { role: "owner" },
      devices: count ? [{ id: "phone", label: "Телефон" }] : [],
    }),
    createPairing: async () => ({
      id: "request",
      code: "12345678",
      status,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    }),
    pairing: async () => ({
      id: "request",
      status,
      label: "Телефон",
      verificationCode: "F00D",
    }),
    respond: async (id, approve) => {
      approval = { id, approve };
      count++;
    },
  };
  const controller = createDeviceController({
    root: window.document,
    windowRef: window,
    repositoryProvider: async () => repository,
  });
  controller.bind();
  try {
    await controller.open();
    window.document.querySelector("[data-device-create]").click();
    for (
      let index = 0;
      index < 10 && !window.document.querySelector(".device-qr svg");
      index++
    )
      await flush();
    assert.ok(window.document.querySelector(".device-qr svg"));
    assert.equal(
      window.document.querySelector(".device-pair-code a").href,
      "http://192.168.0.138:5174/#connect/mobile?pair=12345678",
    );
    status = "pending";
    await controller.check();
    assert.equal(approval, null);
    assert.equal(
      window.document.querySelector(".device-verification").textContent,
      "F00D",
    );
    window.document.querySelector("[data-device-approve]").click();
    await flush();
    assert.deepEqual(approval, { id: "request", approve: true });
    assert.match(
      window.document.querySelector(".device-list").textContent,
      /Отключить/,
    );
  } finally {
    controller.stop();
    await window.happyDOM.close();
  }
});

test("pairing countdown ticks each second even while a status request is stalled", async () => {
  const window = environment();
  const timers = new Map();
  let time = 0,
    nextTimer = 0,
    resolveStatus;
  window.setTimeout = (callback, delay) => {
    timers.set(++nextTimer, { callback, delay });
    return nextTimer;
  };
  window.clearTimeout = (id) => timers.delete(id);
  window.document.body.innerHTML =
    '<button id="studentDevicesButton">Мои устройства</button>';
  const controller = createDeviceController({
    root: window.document,
    windowRef: window,
    now: () => time,
    repositoryProvider: async () => ({
      list: async () => ({ access: { role: "owner" }, devices: [] }),
      createPairing: async () => ({
        id: "code",
        code: "12345678",
        status: "waiting",
        expiresAt: new Date(10000).toISOString(),
      }),
      pairing: () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    }),
  });
  controller.bind();
  let poll;
  try {
    await controller.open();
    window.document.querySelector("[data-device-create]").click();
    for (
      let i = 0;
      i < 20 && !window.document.querySelector("[data-device-expiry]");
      i++
    )
      await flush();
    const countdown = window.document.querySelector("[data-device-expiry]");
    assert.match(countdown.textContent, /0:10/);
    poll = controller.check();
    await flush();
    assert.equal(typeof resolveStatus, "function");
    for (const remaining of [9, 8, 7]) {
      time += 1000;
      const [id, timer] = [...timers].find(([, value]) => value.delay === 1000);
      timers.delete(id);
      timer.callback();
      assert.ok(countdown.textContent.endsWith(`0:0${remaining}`));
    }
    // Returning to the tab catches up to actual expiry, rather than replaying ticks.
    time = 9500;
    window.document.dispatchEvent(new window.Event("visibilitychange"));
    assert.match(countdown.textContent, /0:01/);
    controller.stop();
    assert.equal(timers.size, 0);
  } finally {
    controller.stop();
    resolveStatus?.({ id: "code", status: "waiting" });
    await poll;
    await window.happyDOM.close();
  }
});

test("revision polling avoids unchanged downloads, retries failed updates and detects revocation", async () => {
  const window = environment();
  const access = { role: "linked", ownerId: "owner" };
  let next = { access, updatedAt: "first", changesUpdatedAt: "history" };
  let updates = 0,
    errors = 0,
    revoked = 0,
    fail = false;
  const watcher = createDiaryRevisionWatcher({
    repository: { revision: async () => next },
    windowRef: window,
    initialAccess: access,
    initialRevision: "first",
    initialChangesRevision: "history",
    onUpdate: async () => {
      updates++;
      if (fail) throw new Error("offline");
    },
    onError: () => errors++,
    onRevoked: () => revoked++,
  });
  try {
    watcher.start();
    await watcher.check();
    assert.equal(updates, 0);
    next.updatedAt = "second";
    fail = true;
    await watcher.check();
    assert.equal(errors, 1);
    fail = false;
    await watcher.check();
    await watcher.check();
    assert.equal(updates, 2);
    next.changesUpdatedAt = "new-history";
    await watcher.check();
    assert.equal(updates, 3);
    next = { access: { role: "unpaired" } };
    await watcher.check();
    await watcher.check();
    assert.equal(revoked, 1);
  } finally {
    watcher.stop();
    await window.happyDOM.close();
  }
});

test("a stopped watcher ignores a response still arriving from the network", async () => {
  const window = environment();
  let resolve,
    updates = 0;
  const watcher = createDiaryRevisionWatcher({
    repository: {
      revision: () =>
        new Promise((done) => {
          resolve = done;
        }),
    },
    windowRef: window,
    initialAccess: { role: "linked", ownerId: "owner" },
    onUpdate: () => updates++,
    onRevoked: () => assert.fail("stopped watcher"),
  });
  try {
    watcher.start();
    const pending = watcher.check();
    watcher.stop();
    resolve({ access: { role: "unpaired" }, updatedAt: "new" });
    await pending;
    assert.equal(updates, 0);
  } finally {
    await window.happyDOM.close();
  }
});

test("offline cache belongs to one browser identity and revocation removes it", async () => {
  const window = environment();
  const cache = createLinkedDiaryCache(window.localStorage);
  try {
    cache.save(
      "phone",
      { role: "linked", ownerId: "owner" },
      { payload: { source: "e-schools.by" } },
    );
    assert.ok(cache.read("phone"));
    assert.equal(cache.read("stranger"), null);
    cache.clear();
    assert.equal(cache.read("phone"), null);
    window.localStorage.setItem("schoolpp_linked_diary_cache_v1", "broken");
    assert.equal(cache.read("phone"), null);
  } finally {
    await window.happyDOM.close();
  }
});

test("device repository preserves server error codes and normalizes manual codes", async () => {
  let args;
  const repository = createDeviceRepository({
    auth: { getUser: async () => ({ data: { user: { id: "phone" } } }) },
    rpc: async (name, params) => {
      args = { name, params };
      return { data: { ok: false, error: "pair_rate_limited" } };
    },
  });
  await assert.rejects(
    repository.requestPairing("1234-5678", "Телефон"),
    (error) =>
      error.code === "pair_rate_limited" && /пять минут/.test(error.message),
  );
  assert.deepEqual(args.params, { p_code: "12345678", p_label: "Телефон" });
});

test("a stalled authentication request times out before any device mutation", async () => {
  const repository = createDeviceRepository(
    {
      auth: { getUser: () => new Promise(() => {}) },
      rpc: () => assert.fail("no mutation before authentication"),
    },
    { timeoutMs: 5 },
  );
  await assert.rejects(repository.createPairing(), /Проверь соединение/);
});
