// A small, local set of decorative interface icons. No network requests.
const ICON_PATHS = Object.freeze({
  "calendar-outline": "M5 4h14v17H5V4Zm3-2v4m8-4v4M5 9h14m-11 4h2m4 0h2m-8 4h2m4 0h2",
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
  "headset-outline": "M4 13v-2a8 8 0 0 1 16 0v2M4 13h3v6H5a1 1 0 0 1-1-1v-5Zm16 0h-3v6h2a1 1 0 0 0 1-1v-5Zm-3 6c0 2-2 3-5 3",
  "send-outline": "m3 11 18-8-8 18-2-7-8-3Zm8 3 10-11",
  "menu-outline": "M4 7h16M4 12h16M4 17h16",
  "more-outline": "M6 12h.01M12 12h.01M18 12h.01",
  "documents-outline": "M7 3h10l3 3v15H7V3Zm10 0v4h3M4 7v14h12M10 11h7m-7 4h7",
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
