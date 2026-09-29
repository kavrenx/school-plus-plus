import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const bucketName = "support-attachments";

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405 });

  const apiKey = request.headers.get("apikey")?.trim() || "";
  if (!apiKey.startsWith("sb_secret_"))
    return new Response("Unauthorized", { status: 401 });

  const client = createClient(supabaseUrl, apiKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client
    .from("support_attachments")
    .select("id, storage_path")
    .is("deleted_at", null)
    .lte("expires_at", new Date().toISOString())
    .limit(500);
  if (error)
    return Response.json({ ok: false, error: error.message }, { status: 500 });

  const attachments = data || [];
  if (!attachments.length) return Response.json({ ok: true, removed: 0 });

  const paths = attachments.map((item) => item.storage_path);
  const removal = await client.storage.from(bucketName).remove(paths);
  if (removal.error)
    return Response.json(
      { ok: false, error: removal.error.message },
      { status: 500 },
    );

  const ids = attachments.map((item) => item.id);
  const update = await client
    .from("support_attachments")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", ids);
  if (update.error)
    return Response.json(
      { ok: false, error: update.error.message },
      { status: 500 },
    );

  return Response.json({ ok: true, removed: ids.length });
});
