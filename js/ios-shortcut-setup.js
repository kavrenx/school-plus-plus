import {
  createIOSShortcutProbeScript,
  createIOSShortcutCollectionScript,
} from "./ios-shortcut-probe.js";
import {
  readIOSShortcutExport,
  storeIOSPreview,
} from "./ios-shortcut-preview.js";
import { createSafeStorage, getBrowserStorage } from "./safe-storage.js";
import { STORAGE_KEYS } from "./app-config.js";
import { bindCopyButton } from "./clipboard.js";

const storage = createSafeStorage(getBrowserStorage(window));
const dark = storage.getItem(STORAGE_KEYS.theme) === "dark";
document.body.classList.toggle("dark", dark);
document.documentElement.style.colorScheme = dark ? "dark" : "light";
document.querySelector('meta[name="theme-color"]').content = dark
  ? "#151b18"
  : "#e8f0eb";

const source = document.getElementById("iosProbeSource");
source.value = createIOSShortcutProbeScript();
bindCopyButton({
  button: document.getElementById("copyIOSProbe"),
  source,
  feedback: document.getElementById("iosCopyStatus"),
  successText: "Скрипт проверки скопирован. Вставь его в действие JavaScript.",
});
const collectionSource = document.getElementById("iosCollectionSource");
collectionSource.value = createIOSShortcutCollectionScript();
bindCopyButton({
  button: document.getElementById("copyIOSCollection"),
  source: collectionSource,
  feedback: document.getElementById("iosCollectionCopyStatus"),
  successText:
    "Скрипт полного сбора скопирован. Замени им скрипт в той же Команде.",
});

const input = document.getElementById("iosCollectionInput");
const result = document.getElementById("iosCollectionSummary");
const feedback = document.getElementById("iosCollectionStatus");
let parsed = null;
let currentText = "";
function analyze() {
  parsed = null;
  currentText = "";
  document.getElementById("openIOSPreview").hidden = true;
  document.getElementById("copyIOSSummary").hidden = true;
  result.value = "";
  try {
    parsed = readIOSShortcutExport(input.value);
    currentText = input.value;
    result.value = JSON.stringify(parsed.summary, null, 2);
    document.getElementById("copyIOSSummary").hidden = false;
    document.getElementById("openIOSPreview").hidden =
      !parsed.snapshot || !import.meta.env.DEV;
    feedback.textContent = parsed.snapshot
      ? `Получено ${parsed.summary.loadedWeeks} недель. School++ распознал ${parsed.summary.recognizedMarks} отметок. Можно открыть тестовый дневник.`
      : "Сбор не завершён. Скопируй короткий отчёт ниже и пришли в чат — полные данные не нужны.";
  } catch (error) {
    feedback.textContent = error.message;
  }
}
document
  .getElementById("iosCollectionForm")
  .addEventListener("submit", (event) => {
    event.preventDefault();
    analyze();
  });
document
  .getElementById("iosCollectionFile")
  .addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2000000) {
      feedback.textContent = "Файл больше 2 МБ.";
      return;
    }
    try {
      input.value = await file.text();
      analyze();
    } catch {
      feedback.textContent =
        "Не удалось прочитать файл. Попробуй вставить результат текстом.";
    }
  });
bindCopyButton({
  button: document.getElementById("copyIOSSummary"),
  source: result,
  feedback: document.getElementById("iosSummaryCopyStatus"),
  successText: "Короткий отчёт скопирован. Можно отправить его в чат.",
});
document.getElementById("openIOSPreview").addEventListener("click", () => {
  if (!import.meta.env.DEV || !parsed?.snapshot) return;
  try {
    storeIOSPreview(window.sessionStorage, currentText);
    window.location.href = new URL(
      "./?ios-import=preview#diary",
      window.location.href,
    ).href;
  } catch (error) {
    feedback.textContent = error.message;
  }
});
