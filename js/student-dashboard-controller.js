import { DAY_ORDER, TEXT } from "./app-config.js";
import { capitalize, createDateTools } from "./date-tools.js";
import {
  getLessonWord,
  renderDiaryEmptyState,
  renderDiaryTable,
} from "./diary-view.js";
import { getEyeIcon } from "./ui-utils.js";
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
  let selectedDayKey = findInitialDayKey(
    diary.weeks[selectedWeekIndex],
    initialDate,
    getDayKeyByIsoDate(initialDate),
  );
  let isLoginVisible = false;
  let currentUser = null;

  function bind() {
    elements.themeToggle.addEventListener("click", onThemeToggle);
    elements.logoutButton.addEventListener("click", onLogout);
    elements.previousWeekButton.addEventListener("click", () => moveWeek(-1));
    elements.nextWeekButton.addEventListener("click", () => moveWeek(1));
    elements.termSelect?.addEventListener("change", selectTerm);
    elements.dayTabs.addEventListener("click", (event) => {
      const button = event.target.closest(".day-tab");
      if (!button) return;
      selectDay(button.dataset.day, true);
    });
    elements.dayTabs.addEventListener("keydown", handleDayTabKeydown);
    mobileLayout?.addEventListener?.("change", syncAccountDisclosure);
    compactProfileLayout?.addEventListener?.("change", syncProfileDisclosure);
    elements.toggleLoginButton.addEventListener(
      "click",
      toggleLoginVisibility,
    );
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
  }

  function updateUser(user) {
    currentUser = user;
    renderStudent(user);
    renderHero(user);
  }

  function destroy() {
    currentUser = null;
  }

  function renderStudent(user) {
    const fullName = `${user.lastName} ${user.firstName}`.toUpperCase();
    const teacherText = user.classroom
      ? `${user.teacher}, ${translate("room")} ${user.classroom}`
      : user.teacher;

    elements.studentFullName.textContent = fullName;
    elements.studentClassButton.textContent = `${user.className} ${translate("class").toLowerCase()}`;
    elements.teacherName.textContent = teacherText || "—";
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
    const position = termWeekIndexes.indexOf(selectedWeekIndex);
    elements.previousWeekButton.disabled = position <= 0;
    elements.nextWeekButton.disabled =
      position < 0 || position >= termWeekIndexes.length - 1;
    renderDayTabs(week);

    const lessons = getStudentLessons(week.days[selectedDayKey] || []);
    const dayState = resolveDayState(week, selectedDayKey, lessons);
    elements.journalMain?.classList.toggle("is-empty-day", !lessons.length);
    const dayDate = getIsoDateForDay(week.start, selectedDayKey);
    elements.diaryTitle.textContent = `${capitalize(formatIsoWeekday(dayDate))}, ${Number(dayDate.slice(-2))}`;
    const dayPresentation = getDayPresentation(
      dayState,
      lessons,
      translate,
    );
    elements.selectedDayNote.textContent = dayPresentation.note;
    elements.diaryTableWrap.classList.toggle(
      "is-quiet-empty",
      dayState.type === "weekend",
    );
    elements.journalMain?.classList.toggle(
      "is-quiet-empty",
      dayState.type === "weekend",
    );

    if (!lessons.length) {
      elements.diaryTableWrap.innerHTML =
        dayState.type === "weekend"
          ? ""
          : renderDiaryEmptyState(dayPresentation);
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
      return `
        <button class="day-tab ${isSelected ? "active" : ""} ${isToday ? "real-today" : ""}" id="dayTab-${dayKey}" type="button" role="tab" data-day="${dayKey}" aria-selected="${isSelected}" aria-controls="diaryPanel" tabindex="${isSelected ? "0" : "-1"}"${isToday ? ' aria-current="date"' : ""}>
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
    const buttons = [...elements.dayTabs.querySelectorAll(".day-tab")];
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
    selectedWeekIndex = index;
    const today = getSchoolDateIso(now());
    selectedDayKey = findInitialDayKey(
      diary.weeks[index],
      today,
      getDayKeyByIsoDate(today),
    );
    renderDiary();
  }

  function moveWeek(direction) {
    const position = termWeekIndexes.indexOf(selectedWeekIndex);
    const nextIndex = termWeekIndexes[position + direction];
    if (nextIndex === undefined) return;
    selectWeek(nextIndex);
  }

  function renderTermSelect() {
    if (elements.yearLabel) {
      elements.yearLabel.textContent = diary.school.academicYear.title;
    }
    if (!elements.termSelect) return;
    elements.termSelect.innerHTML = terms
      .map(
        (term) =>
          `<option value="${term.id}" ${term.id === selectedTermId ? "selected" : ""}>${term.title}</option>`,
      )
      .join("");
    elements.termSelect.disabled = terms.length < 2;
  }

  function selectTerm(event) {
    const term = terms.find((item) => item.id === event.target.value);
    if (!term) return;

    selectedTermId = term.id;
    termWeekIndexes = getWeekIndexesForTerm(diary.weeks, term);
    const targetWeekIndex = findInitialWeekIndexForTerm(
      diary.weeks,
      termWeekIndexes,
      getSchoolDateIso(now()),
    );
    if (targetWeekIndex < 0) {
      selectedWeekIndex = -1;
      renderDiary();
      return;
    }

    selectedWeekIndex = targetWeekIndex;
    selectedDayKey = findInitialDayKey(
      diary.weeks[targetWeekIndex],
      getSchoolDateIso(now()),
      getDayKeyByIsoDate(getSchoolDateIso(now())),
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
        attendance:
          attendance === ATTENDANCE_STATUS.unmarked ? "" : attendance,
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
