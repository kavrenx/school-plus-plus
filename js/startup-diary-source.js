import { requestExtensionSnapshot } from "./extension-import.js";
import { isAppleMobile } from "./onboarding-controller.js";

// Apple mobile clients use the Userscripts DOM bridge, read earlier at startup.
// Waiting for the separate desktop postMessage protocol cannot supply their
// cloud fallback. This changes source selection only, never access checks.
function requestStartupExtensionSnapshot(windowRef) {
  if (isAppleMobile(windowRef.navigator)) return Promise.resolve(null);
  return requestExtensionSnapshot(windowRef, 2_500);
}

export { requestStartupExtensionSnapshot };
