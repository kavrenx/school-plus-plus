import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { SCHOOL_DATA } from "../data/school-data.js";
import { SCHOOL_DIARY } from "../data/diary-data.js";
import { DAY_ORDER, TEXT } from "../js/app-config.js";
import {
  createAnalyticsPreviewData,
  createPreviewChangeBaseline,
} from "../js/analytics-preview.js";
import { normalizeDiaryData } from "../js/diary-model.js";
import { createJournalStore } from "../js/journal-store.js";
import { createStudentDashboardController } from "../js/student-dashboard-controller.js";
import { createDiaryChangeTracker } from "../js/diary-changes.js";

function fixture() {
  const window = new Window({
    url: "http://localhost:5174",
    settings: {
      enableJavaScriptEvaluation: false,
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
    },
  });
  window.document.write(
    readFileSync(new URL("../index.html", import.meta.url), "utf8"),
  );
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  const data = createAnalyticsPreviewData(SCHOOL_DIARY, SCHOOL_DATA);
  const model = normalizeDiaryData(data.diary, DAY_ORDER, data.school);
  const journal = createJournalStore(storage);
  data.journalEntries.forEach((entry) => journal.saveJournalEntry(entry));
  const changes = createDiaryChangeTracker(storage);
  changes.record(createPreviewChangeBaseline(data));
  changes.record(data);
  const controller = createStudentDashboardController({
    root: window.document,
    diary: model,
    journalStore: journal,
    changeTracker: changes,
    translate: (key) => TEXT[key] || key,
    onLogout() {},
    onThemeToggle() {},
    now: () => new Date("2026-10-05T09:00:00Z"),
  });
  controller.bind();
  controller.show(data.school.users.find((user) => user.role === "student"));
  return {
    window,
    controller,
    journal,
    changes,
    values,
    $: (selector) => window.document.querySelector(selector),
  };
}

test("subject card supports tabs, reversible trial, period selection and diary navigation", async () => {
  const f = fixture();
  try {
    f.$("#studentAchievementsButton").click();
    f.$('[data-achievement-subject="assignment_mathematics_7b"]').click();
    assert.equal(f.$("#subjectStatisticsPanel").hidden, true);
    assert.equal(f.$("#subjectCalculationPanel").hidden, false);
    assert.equal(f.$("[data-subject-tab]").dataset.subjectTab, "calculation");
    assert.equal(f.$("[data-goal-mode]"), null);
    const sections = [...f.$("#subjectCalculationPanel").children];
    assert.ok(sections[0].classList.contains("subject-average-card"));
    assert.ok(sections[1].classList.contains("subject-grade-history"));
    assert.equal(sections[2].querySelector("h3").textContent, "Цель");
    assert.doesNotMatch(
      f.$("[data-grade-goal-result]").textContent,
      /должен быть|Достаточно получить/,
    );
    assert.ok(f.$(".subject-chart svg"));
    f.$('[data-subject-tab="calculation"]').click();
    assert.equal(f.$("#subjectStatisticsPanel").hidden, true);
    assert.equal(f.$("#subjectCalculationPanel").hidden, false);
    const input = f.$("[data-grade-goal]");
    input.value = "9";
    input.dispatchEvent(new f.window.Event("input", { bubbles: true }));
    assert.ok(f.$("[data-trial-option]"));
    const journalBefore = f.values.get("schoolPlusPlus_journalEntries");
    const more = f.$("[data-goal-more]");
    assert.equal(more.getAttribute("aria-expanded"), "false");
    assert.equal(f.$("#gradeOptionsMore").hasAttribute("inert"), true);
    more.click();
    assert.equal(more.getAttribute("aria-expanded"), "true");
    assert.equal(f.$("#gradeOptionsMore").hasAttribute("inert"), false);
    more.click();
    assert.equal(f.$("#gradeOptionsMore").getAttribute("aria-hidden"), "true");
    let scrollRequest;
    f.$(".subject-detail-drawer").scrollTo = (options) =>
      (scrollRequest = options);
    f.$("[data-trial-option]").click();
    assert.equal(scrollRequest.behavior, "smooth");
    assert.equal(
      f.$(".grade-sandbox").classList.contains("is-trial-highlight"),
      true,
    );
    assert.ok(f.$("[data-trial-remove]"));
    f.$("[data-trial-clear]").click();
    assert.equal(f.$("[data-trial-remove]"), null);
    f.$("[data-trial-grade]").value = "9";
    f.$("[data-trial-add]").click();
    assert.equal(f.$("[data-trial-remove]").textContent.trim(), "9 ×");
    assert.equal(f.values.get("schoolPlusPlus_journalEntries"), journalBefore);
    const period = f.$("[data-subject-period]");
    period.value = "term_2026_2";
    period.dispatchEvent(new f.window.Event("change", { bubbles: true }));
    assert.match(
      f.$("[data-subject-detail-heading]").textContent,
      /II четверть/,
    );
    assert.equal(f.$("[data-trial-remove]"), null);
    f.$("[data-subject-period]").value = "term_2026_1";
    f.$("[data-subject-period]").dispatchEvent(
      new f.window.Event("change", { bubbles: true }),
    );
    assert.ok(f.$("[data-trial-remove]"));
    f.$('[data-subject-tab="statistics"]').click();
    assert.deepEqual(
      [...f.$(".subject-summary").querySelectorAll("dt")].map(
        (item) => item.textContent,
      ),
      ["Отметок", "Средний балл"],
    );
    const point = f.$(".subject-chart-point");
    assert.equal(point.querySelector("title"), null);
    point.dispatchEvent(new f.window.Event("pointerover", { bubbles: true }));
    assert.equal(f.$(".subject-chart-tooltip").hidden, false);
    assert.equal(
      f.$("[data-tooltip-grades]").textContent,
      `Отметки: ${point.dataset.chartGrades}`,
    );
    point.dispatchEvent(new f.window.Event("pointerout", { bubbles: true }));
    assert.equal(f.$(".subject-chart-tooltip").hidden, true);
    f.$('[data-subject-tab="calculation"]').click();
    const date = f.$("[data-subject-date]").dataset.subjectDate;
    f.$("[data-subject-date]").click();
    assert.equal(f.$(".subject-detail-drawer"), null);
    assert.equal(f.$("#studentDatePicker").value, date);
    assert.equal(f.$("#diaryPanel").hidden, false);
  } finally {
    await f.window.happyDOM.close();
  }
});

test("half-year subject offers two periods and pass-fail subjects have no numeric tools", async () => {
  const f = fixture();
  try {
    f.$("#studentAchievementsButton").click();
    [...f.window.document.querySelectorAll("[data-achievement-subject]")]
      .find((button) => button.textContent === "Русская литература")
      .click();
    assert.equal(f.$("[data-subject-period]").options.length, 2);
    assert.match(
      f.$("[data-subject-detail-heading]").textContent,
      /I полугодие/,
    );
    f.$("[data-achievement-back]").click();
    [...f.window.document.querySelectorAll("[data-achievement-subject]")]
      .find((button) => button.textContent === "Искусство")
      .click();
    assert.equal(f.$("[data-grade-goal]"), null);
    assert.equal(f.$(".subject-chart"), null);
    assert.ok(f.$(".subject-grade-grid"));
  } finally {
    await f.window.happyDOM.close();
  }
});

test("updates have unread badge, mark read on opening and link to lesson day", async () => {
  const f = fixture();
  try {
    assert.equal(f.$("#studentChangesCount").hidden, false);
    assert.ok(f.$("#studentChangesButton").closest(".student-period-bar"));
    f.$("#studentChangesButton").click();
    assert.equal(f.$("#studentChangesPanel").hidden, false);
    assert.equal(f.$("#studentChangesCount").hidden, true);
    assert.ok(f.changes.getState().changes.every((change) => change.read));
    const link = f.$("[data-change-date]");
    const date = link.dataset.changeDate;
    link.click();
    assert.equal(f.$("#studentChangesPanel").hidden, true);
    assert.equal(f.$("#studentDatePicker").value, date);
    assert.equal(f.$("#diaryPanel").hidden, false);
  } finally {
    await f.window.happyDOM.close();
  }
});
