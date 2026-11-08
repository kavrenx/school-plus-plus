import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { createSupportNotificationHandler } from "./dispatch.mjs";

const url = Deno.env.get("SUPABASE_URL") || "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const key = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const client =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

Deno.serve(
  createSupportNotificationHandler({
    dispatchSecret: Deno.env.get("SUPPORT_NOTIFICATION_DISPATCH_SECRET"),
    token: Deno.env.get("SUPPORT_TELEGRAM_BOT_TOKEN"),
    chatId: Deno.env.get("SUPPORT_TELEGRAM_CHAT_ID"),
    async claim() {
      if (!client) throw new Error("missing_database");
      const { data, error } = await client
        .rpc("claim_support_notifications")
        .abortSignal(AbortSignal.timeout(4000));
      if (error || !Array.isArray(data)) throw new Error("claim_failed");
      return data;
    },
    async finish(
      row: { id: string; lease: string },
      result: { sent: boolean; retryAfter: number },
    ) {
      if (!client) throw new Error("missing_database");
      const { data, error } = await client
        .rpc("finish_support_notification", {
          p_id: row.id,
          p_lease: row.lease,
          p_sent: result.sent,
          p_retry_after: result.retryAfter,
        })
        .abortSignal(AbortSignal.timeout(4000));
      if (error) throw new Error("finish_failed");
      return data === true;
    },
  }),
);
