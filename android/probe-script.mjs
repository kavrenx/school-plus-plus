import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runIOSShortcutProbe } from "../js/ios-shortcut-probe.js";

function hasAndroidDiaryWeek(scope) {
  if (
    scope.location.origin !== "https://diary.e-schools.by" ||
    scope.top !== scope
  )
    return false;
  const resources = scope.performance?.getEntriesByType("resource") || [];
  return resources.slice(-1000).some((entry) => {
    try {
      const url = new URL(entry.name, scope.location.origin);
      return (
        url.origin === scope.location.origin &&
        (!entry.responseStatus || entry.responseStatus === 200) &&
        /^\/api\/v1\/education\/diary\/schools\/[\w-]{1,80}\/classes\/[\w-]{1,80}\/students\/[\w-]{1,80}\/lessons$/.test(
          url.pathname,
        ) &&
        /^[\w-]{1,80}$/.test(url.searchParams.get("week_activity_uuid") || "")
      );
    } catch {
      return false;
    }
  });
}

// Serialized into an Android asset and evaluated only on the diary origin.
function startAndroidDiaryProbe(scope, collect, key) {
  if (
    scope.location.origin !== "https://diary.e-schools.by" ||
    scope.top !== scope ||
    !/^__schoolppAndroidProbe_[a-f0-9]{32}$/.test(key) ||
    Object.hasOwn(scope, key)
  )
    return false;

  const controller = new scope.AbortController();
  const run = {
    page: scope.location.href,
    result: { state: "running" },
    cancel: () => controller.abort(),
  };
  scope[key] = run;
  const count = (value) =>
    Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const safeReasons = new Set([
    "sign_in_or_session_unavailable",
    "switch_week_then_retry",
    "incomplete_collection",
    "payload_too_large",
    "time_limit",
    "request_timeout",
  ]);
  const isCurrent = () =>
    scope[key] === run &&
    scope.location.href === run.page &&
    !controller.signal.aborted;

  try {
    collect(
      scope,
      (text) => {
        if (!isCurrent()) return;
        try {
          const { type, report, snapshot } = JSON.parse(text);
          const collection = report?.checks?.collection;
          const weeks = count(collection?.loadedWeeks);
          if (
            report?.result === "collection_ready" &&
            snapshot?.source === "e-schools.by" &&
            snapshot.import?.complete === true &&
            weeks > 0 &&
            weeks === collection.expectedWeeks &&
            collection.failedWeeks === 0
          ) {
            snapshot.import.transport = "android";
            run.exportText = JSON.stringify({ type, report, snapshot });
            run.result = {
              state: "done",
              weeks,
              lessons: count(collection.lessons),
              marks: count(collection.marks),
            };
          } else {
            run.result = {
              state: "error",
              reason: safeReasons.has(report?.result)
                ? report.result
                : "collection_failed",
            };
          }
        } catch {
          run.result = { state: "error", reason: "collection_failed" };
        }
      },
      {
        collect: true,
        timeoutMs: 45_000,
        signal: controller.signal,
        onProgress(collection) {
          if (!isCurrent()) return;
          run.result = {
            state: "running",
            loadedWeeks: count(collection.loadedWeeks),
            expectedWeeks: count(collection.expectedWeeks),
          };
        },
      },
    );
  } catch {
    run.result = { state: "error", reason: "collection_failed" };
  }
  return true;
}

function createAndroidProbeScript() {
  return `(function (key) { return (${startAndroidDiaryProbe.toString()})(window, (${runIOSShortcutProbe.toString()}), key); })`;
}

function createAndroidReadinessScript() {
  return `(${hasAndroidDiaryWeek.toString()})(window)`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const output = process.argv[2];
  if (!output) throw new Error("Pass the generated Android asset directory.");
  await mkdir(output, { recursive: true });
  await Promise.all([
    writeFile(join(output, "diary-probe.js"), createAndroidProbeScript()),
    writeFile(join(output, "diary-ready.js"), createAndroidReadinessScript()),
  ]);
}

export { createAndroidProbeScript, createAndroidReadinessScript };
