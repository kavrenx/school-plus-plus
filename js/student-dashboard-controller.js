import { DAY_ORDER, TEXT } from "./app-config.js";
import { capitalize, createDateTools } from "./date-tools.js";
import { getLessonWord, renderDiaryTable } from "./diary-view.js";
import { getEyeIcon, escapeHtml } from "./ui-utils.js";
import {
  calculateGradeGoal,
  getStudentSubjects,
  getSubjectResult,
} from "./achievement-model.js";
import {
  renderAchievementTable,
  renderGradeGoalResult,
  renderSubjectDetails,
} from "./achievement-view.js";
import { getCurrentResultPeriod, getResultColumns } from "./result-periods.js";
import {
  completeAcademicWeeks,
  findWeekForDate,
  shortAcademicYear,
  termLabel,
} from "./academic-navigation.js";
import { renderStudentSchedule } from "./student-schedule.js";
import {
  ATTENDANCE_STATUS,
  resolveLessonProgress,
  resolveStudentAttendance,
} from "./teacher-journal-model.js";

function createStudentDashboardController({
  root,
  diary,
  translate,
  onLogout,
  onThemeToggle,
  journalStore,
  now = () => new Date(),
}) {
  diary.weeks = completeAcademicWeeks(diary.weeks, diary.school.academicYear);
  const year = diary.school.academicYear;
  const elements = {
    themeToggle: root.getElementById("themeToggle"),
    logoutButton: root.getElementById("logoutBtn"),
    heroEyebrow: root.getElementById("heroEyebrow"),
    heroTitle: root.getElementById("heroTitle"),
    heroDescription: root.getElementById("heroDescription"),
    studentFullName: root.getElementById("studentFullName"),
    studentClassButton: root.getElementById("studentClassBtn"),
    teacherName: root.getElementById("teacherName"),
    accountLogin: root.getElementById("accountLogin"),
    accountEmail: root.getElementById("accountEmail"),
    accountPhone: root.getElementById("accountPhone"),
    accountDisclosure: root.getElementById("accountDisclosure"),
    profileDisclosure: root.getElementById("studentProfileDisclosure"),
    yearLabel: root.getElementById("studentYearLabel"),
    toggleLoginButton: root.getElementById("toggleLoginBtn"),
    weekRangeTitle: root.getElementById("weekRangeTitle"),
    termSelect: root.getElementById("studentTermSelect"),
    previousWeekButton: root.getElementById("prevWeekBtn"),
    nextWeekButton: root.getElementById("nextWeekBtn"),
    dayTabs: root.getElementById("dayTabs"),
    diaryPanel: root.getElementById("diaryPanel"),
    diaryTitle: root.getElementById("diaryTitle"),
    diaryTableWrap: root.getElementById("diaryTableWrap"),
    journalMain: root.querySelector(".journal-main"),
    selectedDayNote: root.getElementById("selectedDayNote"),
  };
  const mobileLayout = root.defaultView?.matchMedia?.(
    "(max-width: 560px), (max-height: 560px) and (orientation: landscape) and (max-width: 950px)",
  );
  const compactProfileLayout = root.defaultView?.matchMedia?.(
    "(max-width: 760px), (max-height: 560px) and (orientation: landscape) and (max-width: 950px)",
  );
  const {
    formatIsoDateLong,
    formatIsoWeekday,
    formatWeekRange,
    getDayKeyByIsoDate,
    getIsoDateForDay,
    getSchoolDateIso,
    isIsoDateInRange,
  } = createDateTools({
    dayOrder: DAY_ORDER,
    months: TEXT.months,
    weekdays: TEXT.weekdays,
    weekdaysShort: TEXT.weekdaysShort,
    locale: diary.school?.locale,
    timeZone: diary.school?.timezone,
  });
  const initialDate = getSchoolDateIso(now());
  const terms = diary.school?.academicYear?.terms || [];
  let selectedTermId = findInitialTermId(terms, initialDate);
  let termWeekIndexes = getWeekIndexesForTerm(
    diary.weeks,
    terms.find((term) => term.id === selectedTermId),
  );
  let selectedWeekIndex = findInitialWeekIndexForTerm(
    diary.weeks,
    termWeekIndexes,
    initialDate,
  );
  if (selectedWeekIndex < 0) {
    selectedWeekIndex = findInitialWeekIndex(diary.weeks, initialDate);
  }
  const actualWeek = findWeekForDate(diary.weeks, initialDate, year);
  const actualTerm = terms.find(
    (term) => term.startsOn <= initialDate && initialDate <= term.endsOn,
  );
  if (actualWeek >= 0) {
    selectedWeekIndex = actualWeek;
    if (actualTerm) {
      selectedTermId = actualTerm.id;
      termWeekIndexes = getWeekIndexesForTerm(diary.weeks, actualTerm);
    } else termWeekIndexes = [actualWeek];
  }
  let selectedDayKey = findInitialDayKey(
    diary.weeks[selectedWeekIndex],
    initialDate,
    getDayKeyByIsoDate(initialDate),
  );
  let isLoginVisible = false;
  let currentUser = null;
  let selectedSection = "diary";
  let scheduleTab = "bells";
  let selectedSubjectId = "";
  let selectedSubjectPeriod = null;
  let subjectDetailOrigin = "results";
  const achievementPanel = root.getElementById("studentAchievements");
  const diaryButton = root.getElementById("studentDiaryButton");
  const achievementButton = root.getElementById("studentAchievementsButton");
  const schedulePanel = root.getElementById("studentSchedule");
  const scheduleButton = root.getElementById("studentScheduleButton");
  const currentWeekButton = root.getElementById("studentCurrentWeek");
  const datePicker = root.getElementById("studentDatePicker");
  if (datePicker) {
    datePicker.min = year.startsOn;
    datePicker.max = year.endsOn;
  }

  function showSection(section = "diary") {
    const previousSection = selectedSection;
    if (section !== "results" && selectedSubjectId)
      closeSubjectDetails(false, false);
    selectedSection = section;
    const achievements = section === "results";
    const schedule = section === "schedule";
    if (!achievementPanel) return;
    achievementPanel.hidden = !achievements;
    if (schedulePanel) schedulePanel.hidden = !schedule;
    elements.diaryPanel.hidden = section !== "diary";
    root.querySelector(".week-switcher").hidden = section !== "diary";
    diaryButton.setAttribute("aria-pressed", String(section === "diary"));
    achievementButton.setAttribute("aria-pressed", String(achievements));
    scheduleButton?.setAttribute("aria-pressed", String(schedule));
    diaryButton?.parentElement.style.setProperty(
      "--active-section",
      String(["diary", "schedule", "results"].indexOf(section)),
    );
    if (section !== "diary") {
      elements.journalMain?.classList.remove("is-empty-day", "is-quiet-empty");
      if (achievements) renderAchievements();
      else renderSchedule();
    } else renderDiary();
    if (previousSection !== section) animateSection(section);
  }

  let sectionAnimations = [];
  function animateSection(section) {
    sectionAnimations.forEach((animation) => animation.cancel());
    sectionAnimations = [];
    if (
      root.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const panels =
      section === "diary"
        ? [root.querySelector(".week-switcher"), elements.diaryPanel]
        : [section === "schedule" ? schedulePanel : achievementPanel];
    panels.forEach((panel) => {
      const animation = panel?.animate?.(
        [
          { opacity: 0, transform: "translateY(8px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 230, easing: "cubic-bezier(.2,.7,.2,1)" },
      );
      if (animation) {
        animation.finished?.catch(() => {});
        sectionAnimations.push(animation);
      }
    });
  }

  function renderAchievements(focus = false) {
    const studentId = currentUser?.id || currentUser?.userId;
    const results = getStudentSubjects(diary, studentId).map((assignment) =>
      getSubjectResult(diary, journalStore, assignment, studentId),
    );
    const behavior = Object.fromEntries(
      getResultColumns(year).map((column) => [
        column.id,
        journalStore.getTermGrade(column.id, "behavior", studentId)?.value ||
          "",
      ]),
    );
    achievementPanel.innerHTML = renderAchievementTable(
      results,
      year,
      behavior,
    );
    const selectedResult = results.find(
      (result) => result.assignment.id === selectedSubjectId,
    );
    selectedSubjectPeriod = selectedResult
      ? getCurrentResultPeriod(
          selectedResult,
          year,
          findInitialTermId(terms, getSchoolDateIso(now())),
          getSchoolDateIso(now()),
        )
      : null;
    if (selectedResult && selectedSubjectPeriod) {
      achievementPanel.insertAdjacentHTML(
        "beforeend",
        renderSubjectDetails(selectedResult, selectedSubjectPeriod, {
          formatIsoDateLong,
        }),
      );
      root.body?.classList.add("subject-detail-open");
    } else {
      selectedSubjectId = "";
      root.body?.classList.remove("subject-detail-open");
    }
    if (focus) {
      const target = selectedSubjectId
        ? achievementPanel.querySelector("[data-subject-detail-heading]")
        : achievementPanel.querySelector("[data-achievement-heading]");
      target?.focus();
    }
  }

  function closeSubjectDetails(restoreFocus = true, returnToOrigin = true) {
    const subjectId = selectedSubjectId;
    const origin = subjectDetailOrigin;
    selectedSubjectId = "";
    selectedSubjectPeriod = null;
    subjectDetailOrigin = "results";
    root.body?.classList.remove("subject-detail-open");
    if (selectedSection !== "results") return;
    renderAchievements();
    if (returnToOrigin && origin === "diary") {
      showSection("diary");
      return;
    }
    if (restoreFocus)
      achievementPanel
        .querySelector(`[data-achievement-subject="${subjectId}"]`)
        ?.focus();
  }

  function handleAchievementClick(event) {
    const subject = event.target.closest("[data-achievement-subject]");
    if (subject) {
      subjectDetailOrigin = "results";
      selectedSubjectId = subject.dataset.achievementSubject;
      renderAchievements(true);
      return;
    }
    if (event.target.closest("[data-achievement-back]")) closeSubjectDetails();
  }

  function handleAchievementSubmit(event) {
    const form = event.target.closest("[data-grade-goal-form]");
    if (!form || !selectedSubjectPeriod) return;
    event.preventDefault();
    const input = form.querySelector("[data-grade-goal]");
    const output = form.parentElement.querySelector("[data-grade-goal-result]");
    output.innerHTML = renderGradeGoalResult(
      calculateGradeGoal(
        selectedSubjectPeriod.grades,
        input.value,
        selectedSubjectPeriod.remainingLessons.length,
      ),
    );
  }

  function handleAchievementKeydown(event) {
    if (event.key === "Escape" && selectedSubjectId) closeSubjectDetails();
  }

  function renderSchedule() {
    if (schedulePanel && currentUser)
      schedulePanel.innerHTML = renderStudentSchedule(
        diary,
        currentUser,
        scheduleTab,
        { formatIsoDateLong },
      );
  }

  function goToDate(date) {
    const index = findWeekForDate(diary.weeks, date, year);
    if (index < 0) return;
    const selectedTerm = terms.find(
      (term) => term.startsOn <= date && date <= term.endsOn,
    );
    if (selectedTerm) {
      selectedTermId = selectedTerm.id;
      termWeekIndexes = getWeekIndexesForTerm(diary.weeks, selectedTerm);
    } else {
      termWeekIndexes = [index];
    }
    selectedWeekIndex = index;
    selectedDayKey = getDayKeyByIsoDate(date);
    renderTermSelect();
    showSection("diary");
  }

  function bind() {
    diaryButton?.addEventListener("click", () => showSection("diary"));
    achievementButton?.addEventListener("click", () => showSection("results"));
    scheduleButton?.addEventListener("click", () => showSection("schedule"));
    datePicker?.addEventListener("change", () => goToDate(datePicker.value));
    datePicker?.addEventListener("click", () => {
      try {
        datePicker.showPicker?.();
      } catch {
        /* Native date input remains available. */
      }
    });
    currentWeekButton?.addEventListener("click", () =>
      goToDate(getSchoolDateIso(now())),
    );
    schedulePanel?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-schedule-tab]");
      if (!button) return;
      scheduleTab = button.dataset.scheduleTab;
      renderSchedule();
      schedulePanel
        .querySelector(`[data-schedule-tab="${scheduleTab}"]`)
        ?.focus();
    });
    achievementPanel?.addEventListener("click", handleAchievementClick);
    achievementPanel?.addEventListener("submit", handleAchievementSubmit);
    root.addEventListener("keydown", handleAchievementKeydown);
    elements.themeToggle.addEventListener("click", onThemeToggle);
    elements.logoutButton.addEventListener("click", onLogout);
    elements.previousWeekButton.addEventListener("click", () => moveWeek(-1));
    elements.nextWeekButton.addEventListener("click", () => moveWeek(1));
    elements.termSelect?.addEventListener("change", selectTerm);
    elements.diaryTableWrap.addEventListener("click", (event) => {
      const button = event.target.closest("[data-diary-subject]");
      if (!button || !currentUser) return;
      const studentId = currentUser.id || currentUser.userId;
      const assignment = getStudentSubjects(diary, studentId).find(
        (item) =>
          item.subjectId === button.dataset.diarySubject &&
          (!button.dataset.diaryGroup ||
            !item.groupId ||
            item.groupId === button.dataset.diaryGroup),
      );
      if (!assignment) return;
      subjectDetailOrigin = "diary";
      selectedSubjectId = assignment.id;
      showSection("results");
      root.defaultView?.requestAnimationFrame?.(() =>
        achievementPanel
          .querySelector("[data-subject-detail-heading]")
          ?.focus(),
      );
    });
    elements.dayTabs.addEventListener("click", (event) => {
      const button = event.target.closest(".day-tab");
      if (!button) return;
      selectDay(button.dataset.day, true);
    });
    elements.dayTabs.addEventListener("keydown", handleDayTabKeydown);
    mobileLayout?.addEventListener?.("change", syncAccountDisclosure);
    compactProfileLayout?.addEventListener?.("change", syncProfileDisclosure);
    elements.toggleLoginButton.addEventListener("click", toggleLoginVisibility);
  }

  function show(user) {
    currentUser = user;
    isLoginVisible = false;
    syncAccountDisclosure();
    syncProfileDisclosure();
    renderStudent(user);
    renderHero(user);
    renderTermSelect();
    renderDiary();
    showSection("diary");
  }

  function updateUser(user) {
    currentUser = user;
    renderStudent(user);
    renderHero(user);
  }

  function destroy() {
    sectionAnimations.forEach((animation) => animation.cancel());
    sectionAnimations = [];
    selectedSubjectId = "";
    selectedSubjectPeriod = null;
    root.body?.classList.remove("subject-detail-open");
    root.removeEventListener("keydown", handleAchievementKeydown);
    currentUser = null;
  }

  function renderStudent(user) {
    const fullName = `${user.lastName} ${user.firstName}`.trim();
    const teacherText = user.classroom
      ? `${user.teacher}, ${translate("room")} ${user.classroom}`
      : user.teacher;

    elements.studentFullName.textContent = fullName;
    elements.studentClassButton.textContent = `${user.className} ${translate("class").toLowerCase()}`;
    elements.teacherName.textContent = teacherText || "не указан";
    elements.accountEmail.textContent = user.email || translate("notSet");
    elements.accountPhone.textContent = user.phone || translate("notSet");
    renderAccountLogin(user);
  }

  function syncAccountDisclosure(event = mobileLayout) {
    if (!elements.accountDisclosure) return;
    elements.accountDisclosure.open = shouldExpandAccountDetails(
      Boolean(event?.matches),
    );
  }

  function syncProfileDisclosure(event = compactProfileLayout) {
    if (elements.profileDisclosure) {
      elements.profileDisclosure.open = !event?.matches;
    }
  }

  function toggleLoginVisibility() {
    isLoginVisible = !isLoginVisible;
    if (currentUser) renderAccountLogin(currentUser);
  }

  function renderAccountLogin(user) {
    elements.accountLogin.textContent = isLoginVisible
      ? user.login
      : "••••••••";
    elements.toggleLoginButton.innerHTML = getEyeIcon(isLoginVisible);
    elements.toggleLoginButton.setAttribute(
      "aria-label",
      isLoginVisible ? translate("hideLogin") : translate("showLogin"),
    );
  }

  function renderHero(user) {
    const today = getSchoolDateIso(now());
    const dateText = formatIsoDateLong(today);
    const dayText = formatIsoWeekday(today).toLowerCase();
    const todayLessons = getLessonsForDate(today);
    const isSummerBreak = (diary.school?.academicYear?.breaks || []).some(
      (item) =>
        item.type === "summer" &&
        isIsoDateInRange(today, item.startsOn, item.endsOn),
    );

    elements.heroEyebrow.textContent = `${translate("todayPrefix")}, ${user.firstName}!`;
    elements.heroTitle.textContent = `${dateText}, ${dayText}`;
    elements.heroDescription.textContent = translate(
      getHeroDescriptionKey(today, isSummerBreak, todayLessons.length > 0),
    );
  }

  function renderDiary() {
    if (selectedSection !== "diary") return;
    const week = diary.weeks[selectedWeekIndex];
    if (!week) {
      elements.journalMain?.classList.add("is-empty-day");
      elements.journalMain?.classList.remove("is-quiet-empty");
      elements.diaryTableWrap.classList.remove("is-quiet-empty");
      elements.weekRangeTitle.textContent = translate("noData");
      elements.dayTabs.innerHTML = "";
      elements.diaryTitle.textContent = translate("diary");
      elements.selectedDayNote.textContent = translate("scheduleMissing");
      elements.diaryTableWrap.innerHTML = `<div class="empty-state">${translate("noWeeks")}</div>`;
      return;
    }

    elements.weekRangeTitle.textContent = formatWeekRange(week);
    if (currentWeekButton) {
      const today = getSchoolDateIso(now());
      const currentIndex = findWeekForDate(diary.weeks, today, year);
      currentWeekButton.hidden =
        currentIndex < 0 || currentIndex === selectedWeekIndex;
    }
    const position = termWeekIndexes.indexOf(selectedWeekIndex);
    elements.previousWeekButton.disabled = position <= 0;
    elements.nextWeekButton.disabled =
      position < 0 || position >= termWeekIndexes.length - 1;
    renderDayTabs(week);

    const lessons = getStudentLessons(week.days[selectedDayKey] || []);
    const dayState = resolveDayState(week, selectedDayKey, lessons);
    elements.journalMain?.classList.toggle("is-empty-day", !lessons.length);
    const dayDate = getIsoDateForDay(week.start, selectedDayKey);
    if (datePicker) datePicker.value = dayDate;
    const absenceCount = root.getElementById("studentAbsenceCount");
    const absenceSummary = absenceCount?.parentElement;
    const dayFooter = root.getElementById("studentDayFooter");
    const hideAbsences = lessons.length === 0;
    if (absenceSummary) absenceSummary.hidden = hideAbsences;
    dayFooter?.classList.toggle("is-messages-only", hideAbsences);
    if (absenceCount)
      absenceCount.textContent = String(
        lessons.filter((lesson) => lesson.attendance === "absent").length,
      );
    const messages = root.getElementById("studentClassMessages");
    if (messages) {
      const items = (diary.school.messages || []).filter(
        (item) =>
          item.date === dayDate &&
          (!item.classId || item.classId === currentUser?.classId),
      );
      messages.innerHTML = items.length
        ? items.map((item) => `<p>${escapeHtml(item.text)}</p>`).join("")
        : "—";
    }
    elements.diaryTitle.textContent = `${capitalize(formatIsoWeekday(dayDate))}, ${Number(dayDate.slice(-2))}`;
    const dayPresentation = getDayPresentation(dayState, lessons, translate);
    elements.selectedDayNote.textContent = dayPresentation.note;
    elements.diaryTableWrap.classList.toggle("is-quiet-empty", !lessons.length);
    elements.journalMain?.classList.toggle("is-quiet-empty", !lessons.length);

    if (!lessons.length) {
      elements.diaryTableWrap.innerHTML = "";
      return;
    }

    elements.diaryTableWrap.innerHTML = renderDiaryTable(lessons, translate);
  }

  function renderDayTabs(week) {
    const todayIso = getSchoolDateIso(now());
    elements.dayTabs.innerHTML = DAY_ORDER.map((dayKey) => {
      const date = getIsoDateForDay(week.start, dayKey);
      const isSelected = dayKey === selectedDayKey;
      const isToday = date === todayIso;
      const outOfYear = date < year.startsOn || date > year.endsOn;
      return `
        <button class="day-tab ${isSelected ? "active" : ""} ${isToday ? "real-today" : ""}" id="dayTab-${dayKey}" type="button" role="tab" data-day="${dayKey}" aria-selected="${isSelected}" aria-controls="diaryPanel" tabindex="${isSelected ? "0" : "-1"}"${isToday ? ' aria-current="date"' : ""}${outOfYear ? " disabled" : ""}>
          <span>${formatIsoWeekday(date, "short")}</span>
          <small>${Number(date.slice(-2))}</small>
        </button>
      `;
    }).join("");
    elements.diaryPanel.setAttribute(
      "aria-labelledby",
      `dayTab-${selectedDayKey}`,
    );
    root.defaultView?.requestAnimationFrame?.(() => {
      const active = elements.dayTabs.querySelector('[aria-selected="true"]');
      if (!active) return;
      const bounds = elements.dayTabs.getBoundingClientRect();
      const tabBounds = active.getBoundingClientRect();
      if (tabBounds.right > bounds.right) {
        elements.dayTabs.scrollLeft += tabBounds.right - bounds.right;
      } else if (tabBounds.left < bounds.left) {
        elements.dayTabs.scrollLeft -= bounds.left - tabBounds.left;
      }
    });
  }

  function selectDay(dayKey, shouldFocus = false) {
    selectedDayKey = dayKey;
    renderDiary();
    if (shouldFocus) {
      elements.dayTabs.querySelector(`[data-day="${dayKey}"]`)?.focus();
    }
  }

  function handleDayTabKeydown(event) {
    const button = event.target.closest(".day-tab");
    if (!button) return;
    const buttons = [
      ...elements.dayTabs.querySelectorAll(".day-tab:not(:disabled)"),
    ];
    const currentIndex = buttons.indexOf(button);
    const nextIndex = getDayTabTargetIndex(
      currentIndex,
      event.key,
      buttons.length,
    );
    if (nextIndex === null) return;

    event.preventDefault();
    selectDay(buttons[nextIndex].dataset.day, true);
  }

  function selectWeek(index) {
    if (!termWeekIndexes.includes(index)) return;
    const today = getSchoolDateIso(now());
    const week = diary.weeks[index];
    goToDate(
      week.start <= today && today <= week.end
        ? today
        : week.start < year.startsOn
          ? year.startsOn
          : week.start,
    );
  }

  function moveWeek(direction) {
    const position = termWeekIndexes.indexOf(selectedWeekIndex);
    const nextIndex = termWeekIndexes[position + direction];
    if (nextIndex === undefined) return;
    selectWeek(nextIndex);
  }

  function renderTermSelect() {
    if (elements.yearLabel) {
      elements.yearLabel.textContent = shortAcademicYear(year.title);
    }
    if (!elements.termSelect) return;
    elements.termSelect.innerHTML = terms
      .map(
        (term, index) =>
          `<option value="${term.id}" ${term.id === selectedTermId ? "selected" : ""}>${termLabel(term, index)}</option>`,
      )
      .join("");
    elements.termSelect.disabled = terms.length < 2;
  }

  function selectTerm(event) {
    const term = terms.find((item) => item.id === event.target.value);
    if (!term) return;

    selectedTermId = term.id;
    termWeekIndexes = getWeekIndexesForTerm(diary.weeks, term);
    const today = getSchoolDateIso(now());
    const targetDate =
      term.startsOn <= today && today <= term.endsOn ? today : term.startsOn;
    const targetWeekIndex = findWeekForDate(diary.weeks, targetDate, year);
    if (targetWeekIndex < 0) {
      selectedWeekIndex = -1;
      renderDiary();
      return;
    }

    selectedWeekIndex = targetWeekIndex;
    selectedDayKey = findInitialDayKey(
      diary.weeks[targetWeekIndex],
      targetDate,
      getDayKeyByIsoDate(targetDate),
    );
    renderDiary();
  }

  function getLessonsForDate(iso) {
    const week = diary.weeks.find(
      (item) => item.start <= iso && iso <= item.end,
    );
    return week
      ? getStudentLessons(week.days[getDayKeyByIsoDate(iso)] || [])
      : [];
  }

  function getStudentLessons(lessons) {
    const studentId = currentUser?.id || currentUser?.userId;
    if (!studentId) return lessons;
    return lessons.map((lesson) => {
      const merged = journalStore.mergeLessonForStudent(lesson, studentId);
      const lessonWork = journalStore.getLessonWork(lesson.id);
      const lessonProgress = resolveLessonProgress({
        lesson,
        entries: journalStore.getLessonEntries(lesson.id),
        lessonWork,
        instant: now(),
        timeZone: diary.school?.timezone,
      });
      const attendance = resolveStudentAttendance(
        merged.journalEntry,
        lessonProgress,
      );
      return {
        ...merged,
        attendance: attendance === ATTENDANCE_STATUS.unmarked ? "" : attendance,
      };
    });
  }

  return { bind, destroy, show, updateUser };
}

function findInitialWeekIndex(weeks, todayIso) {
  const index = weeks.findIndex(
    (week) => week.start <= todayIso && todayIso <= week.end,
  );
  return index >= 0 ? index : 0;
}

function findInitialTermId(terms, todayIso) {
  const current = terms.find(
    (term) => term.startsOn <= todayIso && todayIso <= term.endsOn,
  );
  if (current) return current.id;

  const latestPastTerm = [...terms]
    .filter((term) => term.endsOn < todayIso)
    .sort((first, second) => first.endsOn.localeCompare(second.endsOn))
    .at(-1);
  return latestPastTerm?.id || terms[0]?.id || "";
}

function getWeekIndexesForTerm(weeks, term) {
  if (!term) return weeks.map((_, index) => index);
  return weeks.reduce((indexes, week, index) => {
    const belongsToTerm =
      week.termId === term.id ||
      (!week.termId && week.start <= term.endsOn && term.startsOn <= week.end);
    if (belongsToTerm) indexes.push(index);
    return indexes;
  }, []);
}

function findInitialWeekIndexForTerm(weeks, indexes, todayIso) {
  if (!indexes.length) return -1;
  const current = indexes.find(
    (index) => weeks[index].start <= todayIso && todayIso <= weeks[index].end,
  );
  if (current !== undefined) return current;

  const past = indexes.filter((index) => weeks[index].end < todayIso);
  return past.at(-1) ?? indexes[0];
}

function findInitialDayKey(week, todayIso, todayDayKey) {
  if (!week) return "monday";
  return week.start <= todayIso && todayIso <= week.end
    ? todayDayKey
    : "monday";
}

function resolveDayState(week, dayKey, lessons = []) {
  const configuredState = week?.dayStates?.[dayKey];
  if (configuredState?.type === "holiday") return configuredState;
  if (lessons.length) return { type: "lessons" };
  if (configuredState) return configuredState;
  if (dayKey === "saturday" || dayKey === "sunday") {
    return { type: "weekend" };
  }
  return { type: "missing" };
}

function getDayPresentation(state, lessons, translate) {
  if (!lessons.length) return { note: "В этот день уроков нет." };
  if (state.type === "lessons") {
    return {
      note: `${lessons.length} ${getLessonWord(lessons.length)} ${translate("lessonsScheduled")}`,
    };
  }
  if (state.type === "holiday") {
    return {
      label: "Праздник",
      title: state.title || "Уроков нет",
      description: state.description || translate("holiday"),
      note: translate("holiday"),
    };
  }
  if (state.type === "weekend") {
    return {
      note: "В этот день уроков нет.",
    };
  }
  if (state.type === "empty") {
    return {
      label: "Свободный день",
      title: "Уроков нет",
      description: "Если расписание изменится, занятия появятся здесь.",
      note: translate("weekdayEmpty"),
    };
  }
  return {
    label: "Нет данных",
    title: "Расписание не добавлено",
    description: "Проверьте этот день позже.",
    note: translate("missingDay"),
  };
}

function getDayTabTargetIndex(currentIndex, key, total) {
  if (total < 1 || currentIndex < 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return total - 1;
  if (key === "ArrowRight") return (currentIndex + 1) % total;
  if (key === "ArrowLeft") return (currentIndex - 1 + total) % total;
  return null;
}

function shouldExpandAccountDetails(isCompactLayout) {
  return !isCompactLayout;
}

function getHeroDescriptionKey(todayIso, isSummerBreak, hasLessons) {
  if (todayIso?.slice(5) === "09-01") return "firstSeptember";
  if (isSummerBreak) return "summerBreak";
  return hasLessons ? "schoolDay" : "dayOff";
}

export {
  createStudentDashboardController,
  findInitialDayKey,
  findInitialTermId,
  findInitialWeekIndex,
  findInitialWeekIndexForTerm,
  getWeekIndexesForTerm,
  getDayPresentation,
  getDayTabTargetIndex,
  getHeroDescriptionKey,
  resolveDayState,
  shouldExpandAccountDetails,
};
