import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {
  createAndroidProbeScript,
  createAndroidReadinessScript,
} from "../android/probe-script.mjs";

const key = `__schoolppAndroidProbe_${"a".repeat(32)}`;
const origin = "https://diary.e-schools.by";
const lessonPath =
  "/api/v1/education/diary/schools/demo-school/classes/demo-class/students/demo-student/lessons";
const weeks = [
  { uuid: "week-1", start_ts: Date.parse("2026-09-07") / 1000 },
  { uuid: "week-2", start_ts: Date.parse("2026-09-14") / 1000 },
];

function fixture({ failedWeek, waitForRequest } = {}) {
  const calls = [];
  const scope = {
    location: { origin, href: `${origin}/#/diary` },
    AbortController,
    setTimeout,
    clearTimeout,
    performance: {
      getEntriesByType: () => [
        { name: `${origin}${lessonPath}?week_activity_uuid=week-1` },
      ],
    },
    document: { querySelectorAll: () => [] },
    async fetch(value, options) {
      calls.push({ value, options });
      const url = new URL(value);
      await waitForRequest;
      let body = [];
      if (url.pathname.endsWith("/lessons")) {
        const weekId = url.searchParams.get("week_activity_uuid");
        if (failedWeek === weekId) return { ok: false, status: 503 };
        body = [
          {
            date: weeks.find(({ uuid }) => uuid === weekId).start_ts,
            day_of_week: 1,
            slots: [
              {
                lesson_uuid: `lesson-${weekId}`,
                number: 1,
                subject_title: "Математика",
                lesson_mark: { mark: "9/9" },
                homework: "synthetic private value",
              },
            ],
          },
        ];
      }
      if (url.pathname.endsWith("/week_activities")) body = weeks;
      if (url.pathname.endsWith("/school_year"))
        body = {
          uuid: "demo-year",
          label: "2026/2027",
          start_ts: Date.parse("2026-09-01") / 1000,
          end_ts: Date.parse("2027-08-31") / 1000,
        };
      return { ok: true, status: 200, json: async () => body };
    },
  };
  scope.top = scope;
  return { scope, calls };
}

function run(scope, runKey = key) {
  return vm.runInNewContext(
    `${createAndroidProbeScript()}(${JSON.stringify(runKey)})`,
    { window: scope, URL, TextEncoder },
  );
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("Android waits for a same-origin successful week after sign-in", () => {
  const { scope, calls } = fixture();
  const entries = [
    {
      name:
        "https://elsewhere.invalid" + lessonPath + "?week_activity_uuid=week-1",
    },
    { name: origin + lessonPath },
    {
      name: origin + lessonPath + "?week_activity_uuid=week-1",
      responseStatus: 401,
    },
  ];
  scope.performance.getEntriesByType = () => entries;
  const ready = () =>
    vm.runInNewContext(createAndroidReadinessScript(), { window: scope, URL });
  assert.equal(ready(), false);
  entries.push({
    name: origin + lessonPath + "?week_activity_uuid=week-1",
    responseStatus: 200,
  });
  assert.equal(ready(), true);
  scope.top = {};
  assert.equal(ready(), false);
  scope.top = scope;
  scope.location.origin = "https://oauth.rios.unibel.by";
  assert.equal(ready(), false);
  assert.deepEqual(calls, []);
});

test("the Android asset reports counts and retains a complete export separately", async () => {
  const { scope, calls } = fixture();
  assert.equal(run(scope), true);
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(scope[key].result)), {
    state: "done",
    weeks: 2,
    lessons: 2,
    marks: 4,
  });
  assert.ok(calls.length > 2);
  assert.ok(calls.every(({ value }) => new URL(value).origin === origin));
  const exported = JSON.parse(scope[key].exportText);
  assert.equal(exported.type, "schoolpp-ios-export-v1");
  assert.deepEqual(exported.snapshot.import, {
    transport: "android",
    complete: true,
    expectedWeeks: 2,
  });
});

test("the Android probe refuses foreign pages, subframes and malformed run IDs", () => {
  for (const condition of ["origin", "login", "subframe", "key"]) {
    const { scope, calls } = fixture();
    if (condition === "origin") scope.location.origin = `${origin}.invalid`;
    if (condition === "login")
      scope.location.origin = "https://oauth.rios.unibel.by";
    if (condition === "subframe") scope.top = {};
    assert.equal(run(scope, condition === "key" ? "untrusted" : key), false);
    assert.equal(calls.length, 0);
    assert.equal(scope[key], undefined);
  }
});

test("a failed week never appears as a successful Android collection", async () => {
  const { scope } = fixture({ failedWeek: "week-2" });
  assert.equal(run(scope), true);
  await settle();
  assert.equal(scope[key].result.state, "error");
  assert.equal(scope[key].result.reason, "incomplete_collection");
  assert.equal(scope[key].exportText, undefined);
});

test("a cancelled probe cannot return a late result into a new run", async () => {
  let release;
  const waitForRequest = new Promise((resolve) => (release = resolve));
  const { scope } = fixture({ waitForRequest });
  assert.equal(run(scope), true);
  assert.equal(run(scope), false);
  const previous = scope[key];
  previous.cancel();
  delete scope[key];
  assert.equal(run(scope), true);
  release();
  await settle();
  assert.equal(previous.result.state, "running");
  assert.equal(previous.exportText, undefined);
  assert.equal(scope[key].result.state, "done");
});
