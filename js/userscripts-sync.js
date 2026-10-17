import { STORAGE_KEYS } from "./app-config.js";
import { createSafeStorage, getBrowserStorage } from "./safe-storage.js";
import { createSupabaseServices } from "./supabase-services.js";
import { createUserscriptImporter } from "./userscript-import.js";
import { createPublicUserscriptClient } from "./userscript-client.js";
import { createUserscriptProgress } from "./userscript-progress.js";
import { createUserscriptSyncController } from "./userscript-sync-controller.js";
import { applyBrowserTheme } from "./theme-controller.js";

const storage = createSafeStorage(getBrowserStorage(window));
const dark = storage.getItem(STORAGE_KEYS.theme) === "dark";
applyBrowserTheme(document, dark ? "dark" : "light");
const services = createSupabaseServices();
const progress = createUserscriptProgress({
  windowRef: window,
  element: document.getElementById("userscriptProgress"),
});
const sync = createUserscriptSyncController({
  windowRef: window,
  storage,
  services,
  progress,
  client: createPublicUserscriptClient(window),
  importer: createUserscriptImporter({ services, storage }),
});
if (new URLSearchParams(window.location.search).has("returned"))
  void sync.receive();
else void sync.start();
