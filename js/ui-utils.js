function showMessage(element, text, type = "error") {
  element.textContent = text;
  element.className = `form-message ${type}`;
  element.classList.remove("hidden");
}

function hideMessage(element) {
  element.textContent = "";
  element.classList.add("hidden");
}

function setFieldInvalid(element, isInvalid) {
  if (isInvalid) {
    element.setAttribute("aria-invalid", "true");
    return;
  }

  element.removeAttribute("aria-invalid");
}

function formatInviteCode(value) {
  const clean = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
  return clean.replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getEyeIcon(isVisible) {
  if (isVisible) {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.2 5.4A9.8 9.8 0 0 1 12 5c5.5 0 9 5.2 9 7a7.8 7.8 0 0 1-2.1 3M6.5 6.8C4.3 8.3 3 10.7 3 12c0 1.8 3.5 7 9 7 1.4 0 2.6-.3 3.7-.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>`;
}

function getUploadIcon(translate) {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${translate("uploadPhoto")}</span>`;
}

export {
  escapeHtml,
  formatInviteCode,
  getEyeIcon,
  getUploadIcon,
  hideMessage,
  setFieldInvalid,
  showMessage,
};
