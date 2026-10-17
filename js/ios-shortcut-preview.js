import { adaptESchoolsSnapshot } from "./e-schools-adapter.js";
import { validateSnapshot } from "./cloud-diary-repository.js";

const IOS_PREVIEW_KEY = "schoolpp_ios_preview_v1";
const MAX_BYTES = 2_000_000;
const MAX_AGE = 30 * 60 * 1000;
const RESULTS = new Set([
  "collection_ready",
  "incomplete_collection",
  "time_limit",
  "request_timeout",
  "network_error",
  "not_json",
  "http_error",
  "sign_in_or_session_unavailable",
  "switch_week_then_retry",
  "invalid_week_list",
  "payload_too_large",
  "test_failed",
  "partial",
  "open_diary_in_safari",
  "web_requests_unavailable",
  "cancelled",
]);
const positive = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 10000000 ? value : 0;

function readIOSShortcutExport(text) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > MAX_BYTES
  )
    throw new Error("Результат слишком большой: допустимо до 2 МБ.");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Вставь целиком результат второго теста из Команды.");
  }
  if (
    value?.type !== "schoolpp-ios-export-v1" ||
    value.report?.type !== "schoolpp-ios-collection-v1" ||
    !RESULTS.has(value.report.result)
  )
    throw new Error(
      "Это не результат полного сбора. Скопируй скрипт второго этапа.",
    );
  const report = value.report;
  // Only numeric counters and coarse states go into the shareable diagnostic.
  const summary = {
    type: "schoolpp-ios-preview-v1",
    result: report.result,
    elapsedMs: positive(report.elapsedMs),
    availableWeeks: positive(report.checks?.weeks?.availableWeeks),
    expectedWeeks: positive(report.checks?.collection?.expectedWeeks),
    loadedWeeks: positive(report.checks?.collection?.loadedWeeks),
    failedWeeks: positive(report.checks?.collection?.failedWeeks),
    lessons: positive(report.checks?.collection?.lessons),
    marks: positive(report.checks?.collection?.marks),
    homework: positive(report.checks?.collection?.homework),
    metadata: Object.fromEntries(
      [
        "activities",
        "bells",
        "timetable",
        "classes",
        "teachers",
        "subjects",
        "planning",
        "final",
      ].map((key) => [key, positive(report.checks?.metadata?.[key]?.status)]),
    ),
  };
  if (report.result !== "collection_ready")
    return { summary, snapshot: null, data: null };
  const snapshot = validateSnapshot(value.snapshot);
  const records = Object.values(snapshot.network || {});
  const lessons = records.filter((record) =>
    /^\/api\/v1\/education\/diary\/schools\/[\w-]+\/classes\/[\w-]+\/students\/[\w-]+\/lessons\?week_activity_uuid=[\w-]+$/.test(
      record?.url || "",
    ),
  );
  const scopes = new Set(lessons.map((record) => record.url.split("?")[0]));
  const uniqueWeeks = new Set(lessons.map((record) => record.url));
  if (
    snapshot.source !== "e-schools.by" ||
    snapshot.schemaVersion !== 1 ||
    !["ios-shortcut", "userscript-test", "userscript"].includes(snapshot.import?.transport) ||
    snapshot.import.complete !== true ||
    !summary.expectedWeeks ||
    summary.expectedWeeks > 60 ||
    summary.loadedWeeks !== summary.expectedWeeks ||
    summary.failedWeeks ||
    snapshot.import.expectedWeeks !== summary.expectedWeeks ||
    uniqueWeeks.size !== summary.expectedWeeks ||
    scopes.size !== 1 ||
    records.some(
      (record) =>
        record.method !== "GET" ||
        record.status !== 200 ||
        !record.url?.startsWith("/api/v1/education/") ||
        record.headers ||
        record.requestHeaders,
    ) ||
    lessons.some((record) => !Array.isArray(record.body))
  )
    throw new Error(
      "Сбор неполный или данные имеют неожиданный формат. Сохранённый дневник не изменён.",
    );
  const data = adaptESchoolsSnapshot(snapshot);
  if (!data?.diary?.weeks?.length)
    throw new Error(
      "School++ пока не смог разобрать эти недели. Сохранённый дневник не изменён.",
    );
  summary.visibleWeeks = data.diary.weeks.length;
  summary.recognizedMarks = data.journalEntries.reduce(
    (count, entry) => count + (entry.grades?.length || 0),
    0,
  );
  summary.hasSchedule = data.coverage.hasSchedule;
  summary.hasBells = data.coverage.hasBells;
  summary.bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
  return { summary, snapshot, data };
}

function storeIOSPreview(storage, text, now = Date.now()) {
  const parsed = readIOSShortcutExport(text);
  if (!parsed.snapshot)
    throw new Error("Полный сбор ещё не завершён. Посмотри короткий отчёт.");
  storage.setItem(IOS_PREVIEW_KEY, JSON.stringify({ savedAt: now, text }));
  if (!storage.getItem(IOS_PREVIEW_KEY))
    throw new Error("Браузер не разрешил временно сохранить результат.");
}

function readIOSPreview(storage, now = Date.now()) {
  try {
    const pending = JSON.parse(storage.getItem(IOS_PREVIEW_KEY) || "null");
    if (
      !pending ||
      !Number.isFinite(pending.savedAt) ||
      now - pending.savedAt > MAX_AGE ||
      pending.savedAt > now
    ) {
      storage.removeItem?.(IOS_PREVIEW_KEY);
      return null;
    }
    return readIOSShortcutExport(pending.text);
  } catch {
    return null;
  }
}

export {
  IOS_PREVIEW_KEY,
  readIOSShortcutExport,
  storeIOSPreview,
  readIOSPreview,
};
