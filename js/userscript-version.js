// The published script and the minimum supported version are separate: a new
// optional release need not force a reinstall for every existing user.
const USERSCRIPT_VERSION = "1.0.1";
const MIN_USERSCRIPT_VERSION = "1.0.1";

function getUserscriptVersionStatus(version) {
  const parse = (value) =>
    typeof value === "string" &&
    /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value)
      ? value.split(".").map(Number)
      : null;
  const installed = parse(version);
  if (!installed) return "unknown";
  const minimum = parse(MIN_USERSCRIPT_VERSION);
  for (let index = 0; index < minimum.length; index++) {
    if (installed[index] < minimum[index]) return "outdated";
    if (installed[index] > minimum[index]) return "current";
  }
  return "current";
}

function isUserscriptUpdateError(error) {
  return ["script_update_required", "script_version_unknown"].includes(
    error?.code,
  );
}

export {
  USERSCRIPT_VERSION,
  MIN_USERSCRIPT_VERSION,
  getUserscriptVersionStatus,
  isUserscriptUpdateError,
};
