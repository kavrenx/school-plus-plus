import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {
  createIOSShortcutProbeScript,
  createIOSShortcutCollectionScript,
  runIOSShortcutProbe,
} from "../js/ios-shortcut-probe.js";
import {
  readIOSShortcutExport,
  storeIOSPreview,
  readIOSPreview,
  IOS_PREVIEW_KEY,
} from "../js/ios-shortcut-preview.js";

const origin = "https://diary.e-schools.by";
const lessonsPath =
  "/api/v1/education/diary/schools/school/classes/class/students/student/lessons?week_activity_uuid=week";
const secret = "PRIVATE_SESSION_OR_PERSONAL_INFORMATION";

function fixture(handler = () => []) {
  const calls = [];
  const reports = [];
  const timers = new Map();
  let timerId = 0;
  const scope = {
    location: { origin },
    AbortController,
    performance: { getEntriesByType: () => [{ name: origin + lessonsPath }] },
    setTimeout: (callback, duration) => {
      const id = ++timerId;
      timers.set(id, { callback, duration });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    fetch: async (url, options) => {
      calls.push({ url, options });
      const body = await handler(url, options);
      return body?.ok !== undefined
        ? body
        : { ok: true, status: 200, json: async () => body };
    },
  };
  const completion = (text) => reports.push(JSON.parse(text));
  return { scope, calls, reports, timers, completion };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

const at = (date) => Date.parse(`${date}T00:00:00Z`) / 1000;
function collectionFixture({ failedWeek = "", count = 36 } = {}) {
  const weeks = Array.from({ length: count }, (_, index) => ({
    uuid: index ? `w${index}` : "week",
    start_ts: at("2026-09-07") + index * 7 * 86400,
  }));
  const token = "eyJprivate.session.signature";
  const f = fixture((value) => {
    const url = new URL(value);
    const weekId = url.searchParams.get("week_activity_uuid");
    if (url.pathname.endsWith("/lessons")) {
      if (weekId === failedWeek) return { ok: false, status: 503 };
      const week = weeks.find((week) => week.uuid === weekId);
      return [
        {
          date: week.start_ts,
          day_of_week: 1,
          slots: [
            {
              lesson_uuid: `lesson-${weekId}`,
              lesson_template_id: "template",
              number: 1,
              subject_title: "Математика",
              start_time: "08:00",
              homework: secret,
              lesson_mark: { mark: "9/9" },
            },
            {
              lesson_uuid: `lesson2-${weekId}`,
              lesson_template_id: "template2",
              number: 2,
              subject_title: "Физика",
              start_time: "09:00",
              lesson_marks: [{ mark: "8" }],
            },
          ],
        },
      ];
    }
    if (url.pathname.endsWith("week_activities")) return weeks;
    if (url.pathname.endsWith("school_year"))
      return {
        uuid: "year",
        label: "2026/2027",
        start_ts: at("2026-09-01"),
        end_ts: at("2027-08-31"),
        access_token: token,
        password: "DO_NOT_EXPORT",
        nested: { cookie: "DO_NOT_EXPORT", value: token },
      };
    if (url.pathname.endsWith("/time_activities"))
      return [
        {
          uuid: "q1",
          title: "I четверть",
          type: "quarter",
          start_date: at("2026-09-01"),
          end_date: at("2027-05-31"),
        },
      ];
    if (url.pathname.endsWith("/classes"))
      return [{ uuid: "class", label: "Б", class_number: 8 }];
    if (url.pathname.endsWith("/subjects"))
      return [
        { id: "math", subject_title: "Математика" },
        { id: "physics", subject_title: "Физика" },
      ];
    return [];
  });
  f.scope.document = {
    querySelectorAll: () => [
      {
        textContent:
          "Электронный дневник обучающегося 8 «Б» класса, Примеров Ученик Текущие урокиИтоговые отметки",
      },
    ],
  };
  return f;
}

test("complete collection reads 36 weeks and produces a compatible private snapshot", async () => {
  const f = collectionFixture();
  vm.runInNewContext(createIOSShortcutCollectionScript(), {
    window: f.scope,
    completion: f.completion,
    URL,
    TextEncoder,
  });
  await settle();
  assert.equal(f.reports.length, 1);
  const exported = f.reports[0];
  assert.equal(exported.report.result, "collection_ready");
  assert.equal(exported.report.checks.collection.loadedWeeks, 36);
  assert.equal(exported.report.checks.collection.lessons, 72);
  assert.equal(exported.report.checks.collection.marks, 108);
  assert.equal(
    f.calls.filter(({ url }) => new URL(url).pathname.endsWith("/lessons"))
      .length,
    36,
  );
  assert.equal(
    exported.snapshot.pages.shortcut.studentIdentity.name,
    "Примеров Ученик",
  );
  assert.equal(JSON.stringify(exported.report).includes(secret), false);
  assert.doesNotMatch(
    JSON.stringify(exported),
    /eyJprivate|DO_NOT_EXPORT|access_token|password|cookie/,
  );
  const parsed = readIOSShortcutExport(JSON.stringify(exported));
  assert.equal(parsed.summary.recognizedMarks, 108);
  assert.equal(parsed.summary.visibleWeeks, 36);
  assert.equal(parsed.data.school.users[0].displayName, "Примеров Ученик");
  assert.doesNotMatch(
    JSON.stringify(parsed.summary),
    /Примеров|PRIVATE_SESSION|school\/classes/,
  );
  assert.ok(
    f.calls.every(
      ({ url, options }) =>
        new URL(url).origin === origin && options.method === "GET",
    ),
  );
  assert.equal(f.timers.size, 0);
});

test("a failed week prevents exporting a partial snapshot", async () => {
  const f = collectionFixture({ failedWeek: "w2" });
  runIOSShortcutProbe(f.scope, f.completion, { collect: true });
  await settle();
  const exported = f.reports[0];
  assert.equal(exported.report.result, "incomplete_collection");
  assert.equal(exported.report.checks.collection.failedWeeks, 1);
  assert.equal(exported.snapshot, undefined);
  assert.equal(readIOSShortcutExport(JSON.stringify(exported)).snapshot, null);
});

test("collector finds the student's name outside heading tags without capturing adjacent UI text", async () => {
  const f = collectionFixture({ count: 2 });
  f.scope.document = {
    querySelectorAll: () => [],
    body: {
      innerText:
        "Меню. Электронный дневник обучающегося 8 «Б» класса, Примеров Тимур Андреевич Текущие урокиИтоговые отметки Расписание",
    },
  };
  runIOSShortcutProbe(f.scope, f.completion, {
    collect: true,
    transport: "userscript-test",
  });
  await settle();
  const identity = f.reports[0].snapshot.pages.shortcut.studentIdentity;
  assert.equal(identity.name, "Примеров Тимур Андреевич");
  assert.equal(identity.classTitle, "8 «Б»");
  assert.equal(f.reports[0].snapshot.import.transport, "userscript-test");
  assert.equal(JSON.stringify(f.reports[0].report).includes("Примеров"), false);
});

test("a label-only heading and earlier navigation do not hide the name in adjacent text", async () => {
  for (const name of [
    "Примеров Тимур",
    "Примеров Т.А.",
    "Примеров Тимур Андреевич",
  ]) {
    const f = collectionFixture({ count: 2 });
    f.scope.document = {
      querySelectorAll: () => [
        { textContent: "Электронный дневник обучающегося 8 «Б» класса," },
      ],
      body: {
        innerText: `Текущие уроки Итоговые отметки Меню Электронный дневник обучающегося 8 «Б» класса, ${name} Текущие урокиИтоговые отметки`,
      },
    };
    runIOSShortcutProbe(f.scope, f.completion, {
      collect: true,
      transport: "userscript",
    });
    await settle();
    const parsed = readIOSShortcutExport(JSON.stringify(f.reports[0]));
    assert.equal(parsed.data.school.users[0].displayName, name);
    assert.equal(parsed.data.school.users[0].className, "8 «Б»");
  }
});

test("external cancellation aborts the collector and completes only once", async () => {
  let resolveRequest;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
  );
  const controller = new AbortController();
  runIOSShortcutProbe(f.scope, f.completion, {
    collect: true,
    signal: controller.signal,
  });
  controller.abort();
  assert.equal(f.reports[0].report.result, "cancelled");
  assert.equal(f.calls[0].options.signal.aborted, true);
  assert.equal(f.timers.size, 0);
  resolveRequest([]);
  await settle();
  assert.equal(f.reports.length, 1);
  assert.equal(f.reports[0].snapshot, undefined);
});

test("the collector bounds network concurrency and validates the week list", async () => {
  const f = collectionFixture();
  const fetch = f.scope.fetch;
  let active = 0;
  let max = 0;
  f.scope.fetch = async (...args) => {
    active++;
    max = Math.max(max, active);
    await settle();
    try {
      return await fetch(...args);
    } finally {
      active--;
    }
  };
  runIOSShortcutProbe(f.scope, f.completion, { collect: true });
  for (let i = 0; i < 30 && !f.reports.length; i++) await settle();
  assert.equal(f.reports[0].report.result, "collection_ready");
  assert.ok(max <= 4);
  const invalid = collectionFixture({ count: 61 });
  runIOSShortcutProbe(invalid.scope, invalid.completion, { collect: true });
  await settle();
  assert.equal(invalid.reports[0].report.result, "invalid_week_list");
  assert.equal(invalid.reports[0].snapshot, undefined);
});

test("the preview rejects forged completeness and expires without modifying other data", async () => {
  const f = collectionFixture({ count: 2 });
  runIOSShortcutProbe(f.scope, f.completion, { collect: true });
  await settle();
  const text = JSON.stringify(f.reports[0]);
  const values = new Map([["existing-cloud-connection", "preserve"]]);
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  storeIOSPreview(storage, text, 1000);
  assert.ok(readIOSPreview(storage, 1001)?.data);
  assert.equal(readIOSPreview(storage, 1000 + 31 * 60000), null);
  assert.equal(values.get("existing-cloud-connection"), "preserve");
  assert.ok(values.has(IOS_PREVIEW_KEY));
  const broken = JSON.parse(text);
  delete broken.snapshot.network[
    Object.keys(broken.snapshot.network).find((key) =>
      key.includes("week_activity_uuid=w1"),
    )
  ];
  assert.throws(
    () => readIOSShortcutExport(JSON.stringify(broken)),
    /неполный/,
  );
  assert.throws(() => readIOSShortcutExport("{}"), /не результат/);
  assert.throws(() => readIOSShortcutExport("["), /целиком/);
  assert.throws(() => readIOSShortcutExport("я".repeat(1000001)), /2 МБ/);
});

test("probe counts singular marks, slash pairs and alternate mark containers", async () => {
  const f = fixture((url) =>
    url.includes("/lessons?")
      ? [
          {
            slots: [
              {
                lesson_mark: { mark: "9/9" },
                lesson_marks: [{ mark: "9" }, { mark: "9" }],
              },
              { mark: { value: "8" } },
              { grades: [{ score: "зачёт" }] },
              { lesson_mark: { mark: "Н" } },
            ],
          },
        ]
      : [],
  );
  runIOSShortcutProbe(f.scope, f.completion);
  await settle();
  assert.equal(f.reports[0].checks.lessons.marks, 4);
});

test("serialized Safari script runs independently and returns only counts", async () => {
  const f = fixture((url) =>
    url.includes("/lessons?")
      ? [
          {
            name: secret,
            slots: [
              {
                homework: secret,
                lesson_marks: [{ mark: "9", comment: secret }, { mark: "9" }],
              },
              { homework: "", lesson_marks: [] },
            ],
          },
        ]
      : url.endsWith("week_activities")
        ? [{ id: secret }, {}]
        : { student: secret },
  );
  vm.runInNewContext(createIOSShortcutProbeScript(), {
    window: f.scope,
    completion: f.completion,
    URL,
  });
  await settle();
  assert.equal(f.reports.length, 1);
  const report = f.reports[0];
  assert.equal(report.result, "read_test_passed");
  assert.deepEqual(report.checks.lessons, {
    status: 200,
    days: 1,
    lessons: 2,
    marks: 2,
    homework: 1,
  });
  assert.equal(report.checks.weeks.availableWeeks, 2);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(f.timers.size, 0);
  for (const { url, options } of f.calls) {
    assert.equal(new URL(url).origin, origin);
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "include");
    assert.equal(options.redirect, "error");
    assert.equal(options.body, undefined);
  }
});

test("other pages are rejected before storage or network access", () => {
  const f = fixture(() => assert.fail("unexpected fetch"));
  f.scope.location.origin = "https://example.com";
  Object.defineProperty(f.scope, "localStorage", {
    get: () => assert.fail("unexpected storage read"),
  });
  runIOSShortcutProbe(f.scope, f.completion);
  assert.equal(f.reports[0].result, "open_diary_in_safari");
  assert.equal(f.calls.length, 0);
});

test("existing session can authorize own-origin requests without appearing in the report", async () => {
  const token = "eyJtest.access.signature";
  const f = fixture((_url, options) =>
    options.headers.Authorization === token ? [] : { ok: false, status: 401 },
  );
  f.scope.localStorage = {
    length: 1,
    key: () => "auth",
    getItem: () =>
      JSON.stringify({
        access_token: token,
        password: secret,
        refresh_token: secret,
      }),
  };
  runIOSShortcutProbe(f.scope, f.completion);
  await settle();
  assert.equal(f.reports[0].result, "read_test_passed");
  assert.equal(f.reports[0].sessionCandidateFound, true);
  assert.equal(f.reports[0].checks.access.attempts, 2);
  assert.equal(f.calls[0].options.headers.Authorization, undefined);
  assert.equal(f.calls[1].options.headers.Authorization, token);
  assert.doesNotMatch(
    JSON.stringify(f.reports),
    /eyJtest|PRIVATE_SESSION|access_token|signature/,
  );
});

test("unavailable storage and an expired session produce a useful anonymous result", async () => {
  const f = fixture(() => ({ ok: false, status: 403 }));
  Object.defineProperty(f.scope, "localStorage", {
    get: () => {
      throw new Error(secret);
    },
  });
  runIOSShortcutProbe(f.scope, f.completion);
  await settle();
  assert.equal(f.reports[0].result, "sign_in_or_session_unavailable");
  assert.equal(f.reports[0].storageReadable, false);
  assert.equal(f.reports[0].checks.access.status, 403);
  assert.equal(JSON.stringify(f.reports).includes(secret), false);
});

test("no observed lesson request asks for switching the week and ignores unrelated URLs", async () => {
  const f = fixture(() => []);
  f.scope.performance.getEntriesByType = () => [
    { name: "https://example.com" + lessonsPath },
    { name: origin + lessonsPath + "/unexpected" },
    {
      name:
        origin +
        lessonsPath.replace(
          "week_activity_uuid=week",
          "week_activity_uuid=..%2Fbad",
        ),
    },
  ];
  runIOSShortcutProbe(f.scope, f.completion);
  await settle();
  assert.equal(f.reports[0].result, "switch_week_then_retry");
  assert.ok(f.calls.every(({ url }) => !url.includes("/lessons?")));
});

test("deadline aborts the request and ignores late completion", async () => {
  let resolveRequest;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
  );
  runIOSShortcutProbe(f.scope, f.completion);
  [...f.timers.values()].find(({ duration }) => duration === 4200).callback();
  assert.equal(f.reports[0].result, "time_limit");
  assert.equal(f.calls[0].options.signal.aborted, true);
  assert.equal(f.timers.size, 0);
  resolveRequest([]);
  await settle();
  assert.equal(f.reports.length, 1);
  assert.equal(f.calls.length, 1);
});

test("a timed out individual request stops with a coarse error", async () => {
  const f = fixture(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error(secret)), {
          once: true,
        });
      }),
  );
  runIOSShortcutProbe(f.scope, f.completion);
  [...f.timers.values()].find(({ duration }) => duration === 1100).callback();
  await settle();
  assert.equal(f.reports[0].result, "request_timeout");
  assert.equal(f.timers.size, 0);
  assert.equal(JSON.stringify(f.reports).includes(secret), false);
});
