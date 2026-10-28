import { createDeviceController } from "../js/device-controller.js";
import { writeClipboardText } from "../js/clipboard.js";

if (!import.meta.env.DEV) throw new Error("Local development check only");

const reportNode = document.getElementById("report");
const statusNode = document.getElementById("status");
const countQrResources = () =>
  performance
    .getEntriesByType("resource")
    .filter((entry) => /\/qrcode(?:\.js|\/)/.test(entry.name)).length;
const report = {
  version: 1,
  check: "lazy-qr-local",
  outcome: "waiting",
  initialQrResources: countQrResources(),
  qrResources: 0,
  pairingRequests: 0,
  qrReadyMs: null,
  rendered: false,
  cloud: "not_run",
};
let pair = null,
  started = 0;
const write = () => {
  reportNode.textContent = JSON.stringify(report, null, 2);
};
const controller = createDeviceController({
  root: document,
  windowRef: window,
  origin: window.location.href,
  repositoryProvider: async () => ({
    list: async () => ({ access: { role: "owner" }, devices: [] }),
    createPairing: async () => {
      report.pairingRequests++;
      pair = {
        id: "synthetic",
        code: "00000000",
        status: "waiting",
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      };
      write();
      return pair;
    },
    pairing: async () => pair,
    cancel: async () => {
      pair = { ...pair, status: "cancelled" };
    },
  }),
});
controller.bind();
document.addEventListener(
  "click",
  (event) => {
    if (!event.target.closest("[data-device-create]")) return;
    started = performance.now();
    report.outcome = "loading";
    report.rendered = false;
    write();
  },
  true,
);
const observer = new MutationObserver(() => {
  if (report.outcome !== "loading") return;
  const svg = document.querySelector(".device-qr svg");
  const error = document.querySelector("[data-device-error]");
  if (svg) {
    report.outcome = "ready";
    report.rendered = true;
    report.qrReadyMs = Math.round(performance.now() - started);
    report.qrResources = countQrResources();
    statusNode.textContent = "QR показан. Закрой окно и скопируй отчёт.";
  } else if (error && !error.hidden) {
    report.outcome = "failed";
    statusNode.textContent = "QR не появился. Скопируй отчёт.";
  } else return;
  write();
});
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["hidden"],
});
document.getElementById("copyReport").addEventListener("click", async () => {
  try {
    await writeClipboardText(reportNode.textContent, window);
    statusNode.textContent = "Отчёт скопирован.";
  } catch {
    statusNode.textContent = "Выдели и скопируй отчёт вручную.";
  }
});
window.addEventListener("pagehide", () => {
  controller.stop();
  observer.disconnect();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
});
statusNode.textContent =
  "Готово. До нажатия кнопки QR-библиотека не загружается.";
write();
