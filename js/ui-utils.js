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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getUploadIcon(translate) {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${translate("uploadPhoto")}</span>`;
}

export {
  escapeHtml,
  getUploadIcon,
  hideMessage,
  setFieldInvalid,
  showMessage,
};
