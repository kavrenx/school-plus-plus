const SYNC_TIMINGS_KEY = "schoolpp_sync_timings_v1";
const MAX_AGE = 15 * 60 * 1000;
const MAX_ENTRIES = 60;
const STAGES = new Set([
  "bridge_ping",
  "bridge_receive",
  "bridge_start",
  "bridge_ack",
  "bridge_cancel",
  "auth_user",
  "device_access",
  "cache_read",
  "export_parse",
  "local_save",
  "cloud_save",
  "cloud_baseline",
  "cloud_snapshot",
  "cloud_write_auth",
  "cloud_upsert",
  "history_compare",
  "history_publish",
  "collection",
  "start_total",
  "return_total",
]);
const OUTCOMES = new Set(["running", "complete", "failed", "skipped"]);

function cleanEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter(
      (entry) =>
        STAGES.has(entry?.stage) &&
        Number.isFinite(entry.ms) &&
        entry.ms >= 0 &&
        entry.ms <= MAX_AGE &&
        ["ok", "error"].includes(entry.status),
    )
    .slice(-MAX_ENTRIES)
    .map(({ stage, ms, status }) => ({ stage, ms, status }));
}

function createSyncTimings(windowRef) {
  let session, saved;
  const now = () => windowRef.performance?.now?.() ?? Date.now();
  try {
    session = windowRef.sessionStorage;
    const value = JSON.parse(session.getItem(SYNC_TIMINGS_KEY) || "null");
    const age = Date.now() - value?.startedAt;
    if (
      value?.version === 1 &&
      Number.isFinite(age) &&
      age >= 0 &&
      age < MAX_AGE
    ) {
      saved = {
        version: 1,
        startedAt: value.startedAt,
        outcome: OUTCOMES.has(value.outcome) ? value.outcome : "running",
        timings: cleanEntries(value.timings),
      };
    }
  } catch {
    /* Diagnostics never block synchronization. */
  }
  const query = new URL(windowRef.location.href).searchParams.get("syncTiming");
  if (query === "0") {
    saved = undefined;
    try {
      session?.removeItem(SYNC_TIMINGS_KEY);
    } catch {
      /* Optional local report. */
    }
  }
  const enabled = query === "1" || (query !== "0" && Boolean(saved));
  let report = saved || {
    version: 1,
    startedAt: Date.now(),
    outcome: "running",
    timings: [],
  };
  function persist() {
    try {
      session?.setItem(SYNC_TIMINGS_KEY, JSON.stringify(report));
    } catch {
      /* Optional local report. */
    }
  }
  function record(stage, ms, status = "ok") {
    if (
      !enabled ||
      !STAGES.has(stage) ||
      !Number.isFinite(ms) ||
      ms < 0 ||
      ms > MAX_AGE
    )
      return;
    report.timings.push({
      stage,
      ms: Math.round(ms * 10) / 10,
      status: status === "error" ? "error" : "ok",
    });
    report.timings = report.timings.slice(-MAX_ENTRIES);
    persist();
  }
  function measure(stage, run) {
    if (!enabled) return run();
    const start = now();
    try {
      const result = run();
      if (result?.then)
        return Promise.resolve(result).then(
          (value) => {
            record(stage, now() - start);
            return value;
          },
          (error) => {
            record(stage, now() - start, "error");
            throw error;
          },
        );
      record(stage, now() - start);
      return result;
    } catch (error) {
      record(stage, now() - start, "error");
      throw error;
    }
  }
  return {
    enabled,
    record,
    measure,
    begin() {
      if (!enabled) return;
      report = {
        version: 1,
        startedAt: Date.now(),
        outcome: "running",
        timings: [],
      };
      persist();
    },
    finish(outcome) {
      if (!enabled || !OUTCOMES.has(outcome)) return;
      report.outcome = outcome;
      persist();
    },
    text() {
      // Never serialize arbitrary storage fields, errors, IDs or diary data.
      return JSON.stringify(
        {
          version: 1,
          outcome: report.outcome,
          timings: cleanEntries(report.timings),
        },
        null,
        2,
      );
    },
  };
}

export { createSyncTimings, SYNC_TIMINGS_KEY };
