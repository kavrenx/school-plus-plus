// A small, local set of decorative interface icons. No network requests.
const ICON_PATHS = Object.freeze({
  "log-out-outline": "M10 4H4v16h6M9 12h12m-5-5 5 5-5 5",
  "create-outline": "M12 5H4v15h15v-8M10 14l1-4L19 2l3 3-8 8-4 1Z",
  "help-outline": "M8 8a4 4 0 1 1 7 2.6C13 12 12 12.5 12 15m0 4h.01",
  "alert-outline": "M12 4v10m0 5h.01",
  "refresh-outline": "M20 4v6h-6M20 10a8 8 0 1 0-1 8",
  "chevron-back-outline": "m15 5-7 7 7 7",
  "chevron-forward-outline": "m9 5 7 7-7 7",
  "play-back-outline": "M5 5v14m14-14-9 7 9 7V5Z",
  "play-forward-outline": "M19 5v14M5 5l9 7-9 7V5Z",
  "close-outline": "m6 6 12 12M6 18 18 6",
  "checkmark-outline": "m4 12 5 5L20 6",
});

function registerIcons() {
  if (customElements.get("school-icon")) return;
  customElements.define("school-icon", class extends HTMLElement {
    connectedCallback() {
      this.setAttribute("aria-hidden", "true");
      const path = ICON_PATHS[this.getAttribute("name")];
      if (!path) return;
      this.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="${path}"/></svg>`;
    }
  });
}

export { registerIcons };
