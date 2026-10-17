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
    if (document) applyBrowserTheme(document, normalized);
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
  if (icon)
    icon.innerHTML = `<school-icon name="${isDark ? "sun-outline" : "contrast-outline"}" aria-hidden="true"></school-icon>`;
  if (label)
    label.textContent = isDark ? translate("light") : translate("dark");
}

function applyBrowserTheme(document, theme) {
  const dark = theme === "dark";
  const color = dark ? "#151b18" : "#e8f0eb";
  const html = document.documentElement;
  html.classList.toggle("dark", dark);
  document.body.classList.toggle("dark", dark);
  html.style.colorScheme = dark ? "dark" : "light";
  html.style.backgroundColor = color;
  document.body.style.backgroundColor = color;
  const previous = document.querySelector('meta[name="theme-color"]');
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = color;
  if (previous) previous.replaceWith(meta);
  else document.head.append(meta);
  // Safari can sample the fixed viewport edge instead of theme-color.
  if (!document.getElementById("browserThemeEdge")) {
    const edge = document.createElement("div");
    edge.id = "browserThemeEdge";
    edge.setAttribute("aria-hidden", "true");
    document.body.prepend(edge);
  }
}

export { createThemeController, syncThemeControl, applyBrowserTheme };
