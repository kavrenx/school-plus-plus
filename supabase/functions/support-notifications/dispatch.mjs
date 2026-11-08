import { timingSafeEqual } from "node:crypto";

const SECRET = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT = {
  conversation: "School++ · Новое сообщение в поддержку",
  request: "School++ · Новая заявка на подключение дневника",
};

function makeTelegramNotification(row, chatId) {
  if (!UUID.test(row.target_id) || !Object.hasOwn(TEXT, row.kind))
    throw new Error("invalid_notification");
  const link = new URL("https://schoolpp.com/support.html");
  link.hash = new URLSearchParams([[row.kind, row.target_id]]).toString();
  return {
    chat_id: Number(chatId),
    text: TEXT[row.kind],
    reply_markup: {
      inline_keyboard: [[{ text: "Открыть", url: link.href }]],
    },
  };
}

async function sendTelegram(row, { token, chatId, fetchImpl }) {
  try {
    const response = await fetchImpl(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTelegramNotification(row, chatId)),
        signal: AbortSignal.timeout(5500),
        redirect: "error",
      },
    );
    const result = await response.json().catch(() => null);
    const retryAfter = result?.parameters?.retry_after;
    return {
      sent: response.ok && result?.ok === true,
      retryAfter:
        response.status === 429
          ? Number.isSafeInteger(retryAfter) && retryAfter > 0
            ? Math.min(86400, retryAfter)
            : 60
          : 0,
    };
  } catch {
    // A thrown fetch error can include the Bot API URL with the token.
    return { sent: false, retryAfter: 0 };
  }
}

function createSupportNotificationHandler({
  dispatchSecret,
  token,
  chatId,
  claim,
  finish,
  fetchImpl = fetch,
}) {
  const encoder = new TextEncoder();
  const configured =
    SECRET.test(dispatchSecret || "") &&
    /^\d+:[A-Za-z0-9_-]+$/.test(token || "") &&
    /^[1-9]\d*$/.test(chatId || "") &&
    Number.isSafeInteger(Number(chatId));
  return async function handle(request) {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    if (!configured) return new Response(null, { status: 503 });
    const supplied = request.headers.get("X-Schoolpp-Dispatch") || "";
    if (
      !SECRET.test(supplied) ||
      !timingSafeEqual(encoder.encode(supplied), encoder.encode(dispatchSecret))
    )
      return new Response(null, { status: 401 });

    let batch;
    try {
      batch = await claim();
    } catch {
      return Response.json(
        { ok: false, error: "claim_failed" },
        { status: 502 },
      );
    }
    let sent = 0;
    let deferred = 0;
    let unconfirmed = 0;
    let pauseSeconds = 0;
    for (const row of batch) {
      const result = pauseSeconds
        ? { sent: false, retryAfter: pauseSeconds }
        : await sendTelegram(row, { token, chatId, fetchImpl });
      pauseSeconds = Math.max(pauseSeconds, result.retryAfter);
      try {
        if (await finish(row, result)) {
          if (result.sent) sent++;
          else deferred++;
        } else unconfirmed++;
      } catch {
        unconfirmed++;
      }
    }
    const ok = deferred === 0 && unconfirmed === 0;
    return Response.json(
      { ok, sent, deferred, unconfirmed },
      { status: ok ? 200 : 502 },
    );
  };
}

export { createSupportNotificationHandler };
