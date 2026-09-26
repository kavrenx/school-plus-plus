import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./supabase-config.js";
import { createCloudAuth } from "./cloud-auth.js";
import { createCloudDiaryRepository } from "./cloud-diary-repository.js";
import { createSupportRepository } from "./support-repository.js";
import { createAdminRepository } from "./admin-repository.js";
import { createSiteStatusRepository } from "./site-status.js";

function createSupabaseServices(env = import.meta.env, options = {}) {
  const config = getSupabaseConfig(env);
  if (!config) return null;
  const client = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: options.storageKey || "schoolpp_supabase_session",
    },
  });
  return Object.freeze({
    auth: createCloudAuth(client),
    diary: createCloudDiaryRepository(client),
    support: createSupportRepository(client),
    admin: createAdminRepository(client),
    status: createSiteStatusRepository(client),
  });
}

export { createSupabaseServices };
