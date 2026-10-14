import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./supabase-config.js";
import { createCloudAuth } from "./cloud-auth.js";
import { createCloudDiaryRepository } from "./cloud-diary-repository.js";
import { createSupportRepository } from "./support-repository.js";
import { createAdminRepository } from "./admin-repository.js";
import { createSiteStatusRepository } from "./site-status.js";
import { createDeviceRepository } from "./device-repository.js";
import { createDiaryHistoryRepository } from "./cloud-diary-history.js";
import { createSafeStorage, getBrowserStorage } from "./safe-storage.js";

function createSupabaseServices(env = {
  VITE_SUPABASE_URL: import.meta.env?.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY,
}, options = {}) {
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
  const devices = createDeviceRepository(client);
  return Object.freeze({
    auth: createCloudAuth(client),
    diary: createDiaryHistoryRepository(createCloudDiaryRepository(client), devices, {
      storage: createSafeStorage(getBrowserStorage(globalThis.window)),
      getIdentity: async () => (await client.auth.getSession()).data?.session?.user?.id || "",
    }),
    devices,
    support: createSupportRepository(client),
    admin: createAdminRepository(client),
    status: createSiteStatusRepository(client),
  });
}

export { createSupabaseServices };
