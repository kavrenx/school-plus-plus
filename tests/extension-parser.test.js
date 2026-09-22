import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Window } from "happy-dom";

function loadGlobal(relativePath, globals = {}) {
  const context = vm.createContext({
    TextEncoder,
    structuredClone,
    ...globals,
  });
  vm.runInContext(
    readFileSync(new URL(relativePath, import.meta.url), "utf8"),
    context,
  );
  return context;
}

test("extension parser reads visible tables without accepting markup", () => {
  const window = new Window({ url: "https://diary.e-schools.by/#/diary" });
  window.document.body.innerHTML = `
    <header><div class="user-profile">Иванов И.И.</div></header>
    <h1>Электронный дневник</h1>
    <div class="diary-banner">Электронный дневник обучающегося 8 «Б» класса, Споняков Т.А.</div>
    <p>Классный руководитель: Воронкова Ирина Викторовна</p>
    <table><caption>Понедельник</caption><tr><th>Предмет</th><th>Отметка</th></tr>
    <tr><td>&lt;Математика&gt;</td><td>9</td></tr></table>`;
  const context = loadGlobal("../extension/shared/e-schools-parser.js");
  const page = context.SchoolppEschoolParser.collectPage(
    window.document,
    window.location,
    new Date("2026-09-16T10:00:00Z"),
  );
  assert.equal(page.kind, "diary");
  assert.equal(page.profile.label, "Иванов И.И.");
  assert.deepEqual(
    { ...page.studentIdentity },
    { classTitle: "8 «Б»", name: "Споняков Т.А." },
  );
  assert.equal(page.classTeacher, "Воронкова Ирина Викторовна");
  assert.deepEqual(Array.from(page.tables[0].rows[1]), ["<Математика>", "9"]);
  assert.deepEqual(Array.from(page.tables[0].headers), ["Предмет", "Отметка"]);
  assert.equal(page.capturedAt, "2026-09-16T10:00:00.000Z");
});

test("extension parser rejects nearby diary text as a class teacher", () => {
  const window = new Window({ url: "https://diary.e-schools.by/#/diary" });
  window.document.body.innerHTML = `
    <section class="diary-panel">
      <h3>Классный руководитель</h3>
      <p>Сообщений нет</p>
      <h3>Четверг</h3>
    </section>`;
  const context = loadGlobal("../extension/shared/e-schools-parser.js");
  assert.equal(
    context.SchoolppEschoolParser.collectClassTeacher(window.document),
    "",
  );
});

test("extension snapshot merges pages and network records", () => {
  const context = loadGlobal("../extension/shared/snapshot-store.js");
  const store = context.SchoolppSnapshotStore;
  let snapshot = store.createEmptySnapshot("2026-09-16T10:00:00.000Z");
  snapshot = store.mergePage(snapshot, {
    key: "/diary",
    capturedAt: "2026-09-16T10:01:00.000Z",
    tables: [],
  });
  snapshot = store.mergeNetworkRecord(snapshot, {
    key: "GET:/api/diary",
    url: "/api/diary",
    capturedAt: "2026-09-16T10:02:00.000Z",
    body: { grade: 9 },
  });
  const stats = store.getSnapshotStats(snapshot);
  assert.equal(stats.pages, 1);
  assert.equal(stats.networkRecords, 1);
  assert.equal(stats.ready, true);
  const diagnostics = store.createDiagnostics({
    ...snapshot,
    profile: { label: "Иванов Иван" },
  });
  assert.equal(diagnostics.network[0].bodyShape.grade, "number");
  assert.equal(JSON.stringify(diagnostics).includes("Иванов Иван"), false);
});

test("extension sync discovers the student's related diary endpoints", () => {
  const context = loadGlobal("../extension/shared/sync-engine.js", { URL });
  const engine = context.SchoolppSyncEngine;
  const urls = Array.from(
    engine.discoverSyncUrls(
      {
        network: {
          lessons: {
            method: "GET",
            url: "/api/v1/education/diary/schools/school-1/classes/class-1/students/student-1/lessons?week=37",
          },
          login: {
            method: "GET",
            url: "/api/v1/auth/session",
          },
          unrelated: {
            method: "GET",
            url: "/api/v1/notifications",
          },
        },
        pages: {},
      },
      [
        "/api/v1/education/diary/schools/school-1/classes/class-1/timetables/whole",
        "/api/v1/notifications",
      ],
    ),
  );

  assert.ok(urls.includes("/api/v1/education/diary/school_year"));
  assert.ok(
    urls.includes(
      "/api/v1/education/diary/schools/school-1/classes/class-1/students/student-1/final/whole",
    ),
  );
  assert.ok(
    urls.includes(
      "/api/v1/education/diary/schools/school-1/classes/class-1/timetables/whole",
    ),
  );
  assert.ok(
    urls.some((url) =>
      url.startsWith("/api/v1/institution/schools/school-1/premises?q="),
    ),
  );
  assert.equal(
    urls.some((url) => url.includes("auth/session")),
    false,
  );
  assert.equal(
    urls.some((url) => url.includes("notifications")),
    false,
  );
  assert.equal(
    engine.getSyncLabel(
      "/api/v1/education/diary/schools/school-1/classes/class-1/students/student-1/final/whole",
    ),
    "Итоговые отметки",
  );
  assert.equal(
    engine.getSyncLabel(
      "/api/v1/institution/schools/school-1/premises?q=filters",
    ),
    "Кабинеты",
  );
  assert.deepEqual(
    Array.from(
      engine.selectSyncUrls([
        "/api/v1/education/diary/schools/s/classes/c/students/u/lessons?week=1",
        "/api/v1/education/diary/schools/s/classes/c/students/u/lessons?week=2",
        "/api/v1/education/diary/schools/s/classes/c/students/u/educational_subjects",
      ]),
    ),
    [
      "/api/v1/education/diary/schools/s/classes/c/students/u/lessons?week=1",
      "/api/v1/education/diary/schools/s/classes/c/students/u/lessons?week=2",
      "/api/v1/education/diary/schools/s/classes/c/students/u/educational_subjects",
    ],
  );

  const restored = Array.from(
    engine.discoverSyncUrls({ network: {}, pages: {} }, [
      "/api/v1/education/diary/schools/school-1/classes/class-1/students/student-1/lessons?week=2",
    ]),
  );
  assert.ok(
    restored.includes(
      "/api/v1/education/diary/schools/school-1/classes/class-1/students/student-1/educational_subjects",
    ),
  );

  assert.deepEqual(
    Array.from(
      engine.selectApiResourceUrls(
        [
          "https://diary.e-schools.by/api/v1/education/diary/schools/school-1/classes/class-1/students/student-1/lessons?week=2",
          "https://diary.e-schools.by/api/v1/education/diary/school_year",
          "https://diary.e-schools.by/api/v1/auth/session",
          "https://example.com/api/v1/education/diary/school_year",
        ],
        "https://diary.e-schools.by",
      ),
    ),
    [
      "/api/v1/education/diary/schools/school-1/classes/class-1/students/student-1/lessons?week=2",
      "/api/v1/education/diary/school_year",
    ],
  );
});

test("extension background settings default to enabled and respect the cooldown", () => {
  const context = loadGlobal("../extension/shared/extension-settings.js");
  const policy = context.SchoolppExtensionSettings;
  assert.deepEqual(
    { ...policy.normalizeSettings(undefined) },
    { backgroundSync: true },
  );
  assert.equal(
    policy.isAutomaticSyncDue(
      { backgroundSync: true },
      {
        lastSyncAt: "2026-09-20T10:00:00.000Z",
        nextSyncAt: "2026-09-20T10:15:00.000Z",
      },
      Date.parse("2026-09-20T10:14:59.000Z"),
    ),
    false,
  );
  assert.equal(
    policy.isAutomaticSyncDue(
      { backgroundSync: true },
      {
        lastSyncAt: "2026-09-20T10:00:00.000Z",
        nextSyncAt: "2026-09-20T10:15:00.000Z",
      },
      Date.parse("2026-09-20T10:15:00.000Z"),
    ),
    true,
  );
  assert.equal(
    policy.isAutomaticSyncDue({ backgroundSync: false }, {}, Date.now(), true),
    false,
  );
  assert.equal(
    policy.isAutomaticSyncDue({ backgroundSync: true }, {}, Date.now(), true),
    false,
  );
  assert.equal(policy.describeSyncIssue("Сессия закончилась").code, "auth");
  assert.equal(policy.describeSyncIssue("Сайт недоступен").code, "connection");
  assert.equal(
    policy.describeSyncIssue("", "Обновлено 8 из 9").code,
    "partial",
  );
});

test("extension manifests expose background updates and notifications", () => {
  const chromium = JSON.parse(
    readFileSync(
      new URL("../extension/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const firefox = JSON.parse(
    readFileSync(
      new URL("../extension/manifest.firefox.json", import.meta.url),
      "utf8",
    ),
  );
  for (const manifest of [chromium, firefox]) {
    assert.equal(manifest.version, "1.0.0");
    assert.ok(manifest.permissions.includes("alarms"));
    assert.ok(manifest.permissions.includes("notifications"));
    assert.ok(
      manifest.host_permissions.includes("https://diary.e-schools.by/*"),
    );
    assert.equal(manifest.icons[128], "assets/icon128.png");
  }
  assert.equal(chromium.version, firefox.version);
  assert.equal(
    firefox.browser_specific_settings.gecko.strict_min_version,
    "128.0",
  );
});
