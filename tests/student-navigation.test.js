import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { SCHOOL_DATA } from "../data/school-data.js";
import { SCHOOL_DIARY } from "../data/diary-data.js";
import { DAY_ORDER, TEXT } from "../js/app-config.js";
import { createLocalPreviewData } from "../js/local-preview-data.js";
import { normalizeDiaryData } from "../js/diary-model.js";
import { createJournalStore } from "../js/journal-store.js";
import { createStudentDashboardController } from "../js/student-dashboard-controller.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function fixture(withLessons = false) {
  const window = new Window({
    url: "http://localhost:5173",
    settings: {
      enableJavaScriptEvaluation: false,
      disableCSSFileLoading: true,
      disableJavaScriptFileLoading: true,
    },
  });
  window.document.write(html);
  const data = createLocalPreviewData(SCHOOL_DIARY, SCHOOL_DATA);
  data.school.lessonTemplates.push({
    id: "student-math-wednesday",
    classId: "class_7b",
    subjectId: "mathematics",
    teacherId: "teacher_demo",
    weekday: "wednesday",
    number: 2,
    startsAt: "09:00",
    endsAt: "09:45",
  });
  if (withLessons) {
    const week = data.diary.weeks.find(
      (item) => item.start <= "2026-09-16" && "2026-09-16" <= item.end,
    );
    week.days.wednesday = [
      {
        id: "absent-lesson",
        number: 1,
        subject: "Матем.",
        time: "08:00–08:45",
        room: "",
      },
    ];
    data.school.messages = [
      { date: "2026-09-16", classId: "class_7b", text: "<Сообщение>" },
    ];
  }
  const model = normalizeDiaryData(data.diary, DAY_ORDER, data.school);
  const values = new Map();
  const store = createJournalStore({
    getItem: (key) => values.get(key),
    setItem: (key, value) => {
      values.set(key, value);
      return true;
    },
  });
  if (withLessons)
    store.saveJournalEntry({
      lessonId: "absent-lesson",
      studentId: "student_demo",
      attendance: "absent",
    });
  const controller = createStudentDashboardController({
    root: window.document,
    diary: model,
    translate: (key) => TEXT[key] || key,
    onLogout() {},
    onThemeToggle() {},
    journalStore: store,
    now: () => new Date("2026-09-16T09:00:00Z"),
  });
  controller.bind();
  controller.show(data.school.users.find((user) => user.role === "student"));
  const $ = (id) => window.document.getElementById(id);
  return { window, $, controller };
}

test("student can switch between diary, four schedule views and results", async () => {
  const f = fixture();
  try {
    assert.equal(f.$("studentYearLabel").textContent, "26/27");
    assert.equal(f.$("studentCurrentWeek").hidden, true);
    f.$("studentScheduleButton").click();
    assert.equal(f.$("studentSchedule").hidden, false);
    assert.equal(f.$("diaryPanel").hidden, true);
    for (const tab of ["holidays", "lessons", "subjects", "bells"]) {
      f.$("studentSchedule")
        .querySelector(`[data-schedule-tab="${tab}"]`)
        .click();
      assert.equal(
        f
          .$("studentSchedule")
          .querySelector(`[data-schedule-tab="${tab}"]`)
          .getAttribute("aria-pressed"),
        "true",
      );
    }
    f.$("studentAchievementsButton").click();
    assert.equal(f.$("studentAchievements").hidden, false);
    assert.equal(f.$("studentSchedule").hidden, true);
    assert.ok(f.$("studentAchievements").textContent.includes("Поведение"));
    assert.equal(
      f.$("studentAchievements").querySelectorAll("thead th").length,
      6,
    );
    const subjectButton = f
      .$("studentAchievements")
      .querySelector("[data-achievement-subject]");
    assert.ok(subjectButton);
    subjectButton.click();
    assert.ok(
      f.$("studentAchievements").querySelector(".subject-detail-drawer"),
    );
    assert.ok(
      f
        .$("studentAchievements")
        .querySelector("[data-subject-detail-heading]")
        .textContent.includes("• I четверть"),
    );
    const goalInput = f
      .$("studentAchievements")
      .querySelector("[data-grade-goal]");
    goalInput.value = "9";
    goalInput.form.dispatchEvent(
      new f.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    assert.ok(
      f
        .$("studentAchievements")
        .querySelector("[data-grade-goal-result]")
        .textContent.includes("Достаточно получить"),
    );
    f.$("studentAchievements").querySelector("[data-achievement-back]").click();
    assert.equal(
      f.$("studentAchievements").querySelector(".subject-detail-drawer"),
      null,
    );
    assert.equal(
      f
        .$("studentDiaryButton")
        .parentElement.style.getPropertyValue("--active-section"),
      "2",
    );
    f.$("studentDiaryButton").click();
    assert.equal(f.$("diaryPanel").hidden, false);
    assert.equal(f.$("diaryTableWrap").innerHTML, "");
    assert.equal(f.$("selectedDayNote").textContent, "В этот день уроков нет.");
  } finally {
    await f.window.happyDOM.close();
  }
});

test("calendar permits holidays and summer, and current week link returns to today", async () => {
  const f = fixture();
  try {
    f.$("nextWeekBtn").click();
    assert.equal(f.$("studentCurrentWeek").hidden, false);
    f.$("studentCurrentWeek").click();
    assert.equal(f.$("studentDatePicker").value, "2026-09-16");
    assert.equal(f.$("studentCurrentWeek").hidden, true);
    for (const date of ["2026-11-04", "2027-06-01", "2027-08-31"]) {
      f.$("studentDatePicker").value = date;
      f.$("studentDatePicker").dispatchEvent(new f.window.Event("change"));
      assert.equal(f.$("studentDatePicker").value, date);
    }
    assert.equal(f.$("studentDatePicker").min, "2026-09-01");
    assert.equal(f.$("studentDatePicker").max, "2027-08-31");
    assert.equal(f.$("nextWeekBtn").disabled, true);
    assert.equal(
      f.$("dayTabs").querySelector('[data-day="wednesday"]').disabled,
      true,
    );
  } finally {
    await f.window.happyDOM.close();
  }
});

test("day footer counts actual absences and escapes teacher messages", async () => {
  const f = fixture(true);
  try {
    assert.equal(f.$("studentAbsenceCount").textContent, "1");
    assert.equal(f.$("studentClassMessages").textContent, "<Сообщение>");
    assert.equal(f.$("studentClassMessages").querySelector("Сообщение"), null);
    f.$("dayTabs").querySelector('[data-day="thursday"]').click();
    assert.equal(f.$("studentAbsenceCount").textContent, "0");
    assert.equal(f.$("studentClassMessages").textContent, "—");
    f.$("dayTabs").querySelector('[data-day="saturday"]').click();
    assert.equal(f.$("studentAbsenceCount").parentElement.hidden, true);
    assert.equal(
      f.$("studentDayFooter").classList.contains("is-messages-only"),
      true,
    );
    f.$("dayTabs").querySelector('[data-day="sunday"]').click();
    assert.equal(f.$("studentAbsenceCount").parentElement.hidden, true);
  } finally {
    await f.window.happyDOM.close();
  }
});
