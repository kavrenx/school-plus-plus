import assert from "node:assert/strict";
import test from "node:test";
import { parseSupportConsoleTarget } from "../js/support-console-route.js";
import { createSupportNotificationHandler } from "../supabase/functions/support-notifications/dispatch.mjs";

const secret = "a".repeat(64);
const token = "123:synthetic_test_token";
const chatId = "123456789";
const target = "00000000-0000-4000-8000-000000000101";
const batch = [
  { id: "1", kind: "conversation", target_id: target, lease: "test-lease-1" },
  { id: "2", kind: "request", target_id: target, lease: "test-lease-2" },
];
const dispatchRequest = (dispatchSecret = secret) =>
  new Request("https://schoolpp.example/functions/v1/support-notifications", {
    method: "POST",
    headers: { "X-Schoolpp-Dispatch": dispatchSecret },
  });

test("support dispatcher requires a configured secret before accessing the queue", async () => {
  const options = {
    dispatchSecret: secret,
    token,
    chatId,
    claim: () => assert.fail("Unauthorized request accessed the queue"),
  };
  const handle = createSupportNotificationHandler(options);
  assert.equal((await handle(dispatchRequest("b".repeat(64)))).status, 401);
  assert.equal((await handle(dispatchRequest(""))).status, 401);
  assert.equal(
    (await handle(new Request("https://schoolpp.example"))).status,
    405,
  );
  assert.equal(
    (
      await createSupportNotificationHandler({ ...options, chatId: "-10042" })(
        dispatchRequest(),
      )
    ).status,
    503,
  );
});

test("Telegram receives only a generic label and a link to the exact operator record", async () => {
  const delivered = [];
  const finished = [];
  const handle = createSupportNotificationHandler({
    dispatchSecret: secret,
    token,
    chatId,
    claim: async () =>
      batch.map((row) => ({
        ...row,
        body: "private message",
        requester_name: "Test Student",
      })),
    finish: async (row, result) => finished.push([row.id, result]),
    fetchImpl: async (url, options) => {
      assert.equal(url, `https://api.telegram.org/bot${token}/sendMessage`);
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      delivered.push(JSON.parse(options.body));
      return Response.json({ ok: true });
    },
  });
  assert.deepEqual(await (await handle(dispatchRequest())).json(), {
    ok: true,
    sent: 2,
    deferred: 0,
    unconfirmed: 0,
  });
  assert.deepEqual(finished, [
    ["1", { sent: true, retryAfter: 0 }],
    ["2", { sent: true, retryAfter: 0 }],
  ]);
  assert.deepEqual(
    delivered,
    batch.map(({ kind }) => ({
      chat_id: Number(chatId),
      text:
        kind === "conversation"
          ? "School++ · Новое сообщение в поддержку"
          : "School++ · Новая заявка на подключение дневника",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Открыть",
              url: `https://schoolpp.com/support.html#${kind}=${target}`,
            },
          ],
        ],
      },
    })),
  );
  for (const [i, message] of delivered.entries()) {
    const link = new URL(message.reply_markup.inline_keyboard[0][0].url);
    assert.deepEqual(parseSupportConsoleTarget(link.hash), {
      kind: batch[i].kind,
      id: target,
    });
  }
  assert.equal(
    parseSupportConsoleTarget(`#request=${target}&conversation=${target}`),
    null,
  );
  assert.equal(parseSupportConsoleTarget("#conversation=external"), null);
});

test("Telegram rate limiting defers the remaining batch and transport errors stay private", async () => {
  let calls = 0;
  const finished = [];
  const options = {
    dispatchSecret: secret,
    token,
    chatId,
    claim: async () => batch,
    finish: async (row, result) => finished.push([row.id, result]),
    fetchImpl: async () => {
      calls++;
      return Response.json(
        { ok: false, parameters: { retry_after: 90 } },
        { status: 429 },
      );
    },
  };
  const handle = createSupportNotificationHandler(options);
  const throttled = await handle(dispatchRequest());
  assert.equal(throttled.status, 502);
  assert.deepEqual(await throttled.json(), {
    ok: false,
    sent: 0,
    deferred: 2,
    unconfirmed: 0,
  });
  assert.equal(calls, 1);
  assert.deepEqual(finished, [
    ["1", { sent: false, retryAfter: 90 }],
    ["2", { sent: false, retryAfter: 90 }],
  ]);

  const failed = createSupportNotificationHandler({
    ...options,
    finish: async () => false,
    fetchImpl: async () => {
      throw new Error(`Transport failure with ${token}`);
    },
  });
  const response = await failed(dispatchRequest());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    ok: false,
    sent: 0,
    deferred: 0,
    unconfirmed: 2,
  });
});
