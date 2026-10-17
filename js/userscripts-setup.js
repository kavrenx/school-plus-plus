import { STORAGE_KEYS } from "./app-config.js";
import { createSafeStorage, getBrowserStorage } from "./safe-storage.js";
import { createUserscriptConnectionIndicator } from "./userscript-connection-indicator.js";
import { renderUserscriptsGuide } from "./userscripts-guide.js";
import { createPublicUserscriptClient } from "./userscript-client.js";
import { transitionToUserscriptSync } from "./userscript-progress.js";
import { applyBrowserTheme } from "./theme-controller.js";

const storage = createSafeStorage(getBrowserStorage(window));
document.getElementById("userscriptsGuide").innerHTML =
  renderUserscriptsGuide();
const dark = storage.getItem(STORAGE_KEYS.theme) === "dark";
applyBrowserTheme(document, dark ? "dark" : "light");
const status = document.getElementById("userscriptStatus");
const check = document.getElementById("checkUserscript");
const client = createPublicUserscriptClient(window);
let requestedCheck = false;
const indicator = createUserscriptConnectionIndicator({
  windowRef: window,
  client,
  element: document.getElementById("userscriptConnection"),
  onError(error) {
    if (requestedCheck) {
      status.dataset.state = "error";
      status.textContent = error.message;
    }
  },
  onReady() {
    delete status.dataset.state;
    status.textContent = "Userscripts готов. Можно синхронизировать дневник.";
  },
});
check.addEventListener("click", async () => {
  if (check.disabled) return;
  requestedCheck = true;
  check.disabled = true;
  try {
    await indicator.check();
  } finally {
    check.disabled = false;
  }
});
document.getElementById("startUserscript").addEventListener("click", () => {
  void transitionToUserscriptSync(
    window,
    new URL("./userscripts-sync.html", window.location.href).href,
  );
});
