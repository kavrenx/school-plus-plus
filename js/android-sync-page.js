import { bindAndroidDiarySync } from "./android-diary-sync.js";
import { ONBOARDING_KEY } from "./onboarding-controller.js";
import { createSafeStorage, getBrowserStorage } from "./safe-storage.js";
import { createSupabaseServices } from "./supabase-services.js";

const storage = createSafeStorage(getBrowserStorage(window));
bindAndroidDiarySync(window, {
  services:
    import.meta.env.VITE_APP_MODE === "cloud" ? createSupabaseServices() : null,
  onSaved: () => storage.setItem(ONBOARDING_KEY, "true"),
});
