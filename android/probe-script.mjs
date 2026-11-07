import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runIOSShortcutProbe } from "../js/ios-shortcut-probe.js";

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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const output = process.argv[2];
  if (!output) throw new Error("Pass the generated Android asset directory.");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "diary-probe.js"), createAndroidProbeScript());
}

export { createAndroidProbeScript };
