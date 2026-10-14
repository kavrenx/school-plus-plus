function createThemeController({
  root,
  icon,
  label,
  storage,
  storageKey,
  translate,
}) {
  function apply(theme) {
    const normalized = theme === "dark" ? "dark" : "light";
    root.classList.toggle("dark", normalized === "dark");
    const document = root.ownerDocument;
    if (document) {
      document.documentElement.style.colorScheme = normalized;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", normalized === "dark" ? "#151b18" : "#e8f0eb");
    }
    syncThemeControl({ icon, label, isDark: normalized === "dark", translate });
    return normalized;
  }

  function load() {
    return apply(storage.getItem(storageKey));
  }

  function toggle() {
    const theme = root.classList.contains("dark") ? "light" : "dark";
    storage.setItem(storageKey, theme);
    return apply(theme);
  }

  function syncControl(container) {
    if (!container) return;
    syncThemeControl({
      icon: container.querySelector(".theme-icon"),
      label: container.querySelector(".theme-text"),
      isDark: root.classList.contains("dark"),
      translate,
    });
  }

  return { apply, load, syncControl, toggle };
}

function syncThemeControl({ icon, label, isDark, translate }) {
  if (icon) icon.innerHTML = `<school-icon name="${isDark ? "sun-outline" : "contrast-outline"}" aria-hidden="true"></school-icon>`;
  if (label) label.textContent = isDark ? translate("light") : translate("dark");
}

export { createThemeController, syncThemeControl };
