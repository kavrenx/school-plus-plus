import { DAY_ORDER, TEXT } from "./app-config.js";
import { createDateTools } from "./date-tools.js";
import { getSafeMaterialUrl } from "./diary-view.js";
import { setFieldInvalid } from "./ui-utils.js";
import { getSubjectResult } from "./achievement-model.js";
import {
  calculateGradeStats,
  formatGradeAverage,
  getJournalCellPresentation,
  groupAssignmentsByClass,
} from "./teacher-journal-model.js";

function mount(root, options) {
  const state = {
    root,
    user: options.user,
    model: options.model,
    store: options.store,
    now: options.now || (() => new Date()),
    dateTools: createDateTools({
      dayOrder: DAY_ORDER,
      months: TEXT.months,
      weekdays: TEXT.weekdays,
      weekdaysShort: TEXT.weekdaysShort,
      locale: options.model.school?.locale,
      timeZone: options.model.school?.timezone,
    }),
    onLogout: options.onLogout,
    onThemeToggle: options.onThemeToggle,
    syncTheme: options.syncTheme,
    notify: options.notify,
    view: "overview",
    selectedAssignmentId: "",
    selectedTermId: "",
    registerScrollLeft: 0,
    editorTrigger: null,
    restoreEditorFocus: false,
    backdropPointerDown: false,
  };

  render(state);
  const cleanup = bindRootEvents(state);

  return {
    destroy() {
      cleanup();
      root.innerHTML = "";
    },
  };
}

function render(state) {
  const assignments = state.model.getTeacherAssignments(state.user.id);
  const selectedAssignment = assignments.find(
    (item) => item.id === state.selectedAssignmentId,
  );

  state.root.innerHTML = `
    ${renderTopbar(state.view === "journal")}
    ${
      state.view === "journal" && selectedAssignment
        ? renderJournalScreen(state, selectedAssignment)
        : renderOverview(state, assignments)
    }
  `;

  state.syncTheme?.();
  const viewport = state.root.querySelector("[data-register-viewport]");
  if (viewport && state.registerScrollLeft) {
    viewport.scrollLeft = state.registerScrollLeft;
  }
}

function renderTopbar(showBackButton) {
  return `
    <header class="topbar teacher-topbar">
      <span class="brand-mark">SCHOOL++</span>

      <div class="topbar-actions teacher-topbar-actions">
        ${
          showBackButton
            ? `<button class="teacher-back-btn" type="button" data-teacher-home>
                <school-icon name="chevron-back-outline" aria-hidden="true"></school-icon>
                <span class="teacher-back-label">К классам</span>
              </button>`
            : ""
        }
        <button class="theme-toggle" type="button" data-teacher-theme>
          <span class="theme-icon"></span>
          <span class="theme-text">Тема</span>
        </button>
        <button class="logout-btn" type="button" data-teacher-logout>
          <school-icon name="log-out-outline" aria-hidden="true"></school-icon>
          <span class="logout-text">Выйти</span>
        </button>
      </div>
    </header>
  `;
}

function renderOverview(state, assignments) {
  const today = state.dateTools.getSchoolDateIso(state.now());
  const dateLabel = state.dateTools.formatIsoDateLong(today);
  const weekdayLabel = state.dateTools.formatIsoWeekday(today);
  const groupedAssignments = groupAssignmentsByClass(assignments);
  const currentTerm = state.model.getTermForDate(today);
  const todayLessons = assignments.flatMap((assignment) =>
    (currentTerm ? state.model
      .getLessonsForAssignmentTerm(assignment, currentTerm.id) : [])
      .filter((lesson) => lesson.date === today),
  );

  return `
    <main class="teacher-layout teacher-overview" id="teacherMainContent">
      <section class="teacher-overview-hero" aria-labelledby="teacherGreeting">
        <p class="card-label" id="teacherGreeting">Здравствуйте, ${escapeHtml(getTeacherAddressName(state.user))}!</p>
        <h1>${escapeHtml(dateLabel)}, ${escapeHtml(weekdayLabel)}</h1>
        <p>${escapeHtml(getTeacherDaySummary(todayLessons.length))}</p>
      </section>

      <section class="teacher-overview-grid">
        <section class="teacher-class-browser" aria-labelledby="teacherClassesTitle">
          <div class="teacher-section-heading">
            <div>
              <p class="panel-label">Учебная работа</p>
              <h2 id="teacherClassesTitle">Мои классы</h2>
            </div>
            <p>${formatAssignmentSummary(groupedAssignments.length, assignments.length)}</p>
          </div>

          <div class="teacher-class-list">
            ${
              groupedAssignments.length
                ? groupedAssignments
                    .map((group, index) =>
                      renderClassGroup(group, index === 0),
                    )
                    .join("")
                : `<p class="teacher-empty teacher-empty-compact">Назначений пока нет.</p>`
            }
          </div>
        </section>

        ${renderTeacherProfile(state, assignments)}
      </section>
    </main>
  `;
}

function renderClassGroup(group, isOpen) {
  const subjectCount = new Set(
    group.assignments.map((assignment) => assignment.subjectId),
  ).size;

  return `
    <details class="teacher-class-card" ${isOpen ? "open" : ""}>
      <summary>
        <span class="teacher-class-title">
          <strong>${escapeHtml(group.classTitle)}</strong>
          <small>${formatStudentCount(group.studentCount)}</small>
        </span>
        <span class="teacher-class-summary">
          ${formatSubjectCount(subjectCount)}
          <i aria-hidden="true"></i>
        </span>
      </summary>

      <div class="teacher-subject-list">
        ${group.assignments.map(renderSubjectButton).join("")}
      </div>
    </details>
  `;
}

function renderSubjectButton(assignment) {
  const audience = assignment.groupTitle || "Весь класс";
  return `
    <button class="teacher-subject-button" type="button" data-open-assignment="${escapeHtml(assignment.id)}">
      <span>
        <strong>${escapeHtml(assignment.subjectTitle)}</strong>
        <small>${escapeHtml(audience)} · ${formatStudentCount(assignment.studentCount)}</small>
      </span>
      <span class="teacher-subject-arrow" aria-hidden="true"><school-icon name="chevron-forward-outline"></school-icon></span>
    </button>
  `;
}

function renderTeacherProfile(state, assignments) {
  const classTeacherTitles = (state.user.classTeacherOf || [])
    .map((classId) => state.model.school.classesById[classId]?.title)
    .filter(Boolean);
  const subjectTitles = Array.from(
    new Set(assignments.map((assignment) => assignment.subjectTitle)),
  );

  return `
    <aside class="teacher-profile-card" aria-label="Профиль учителя">
      <div class="teacher-profile-mark" aria-hidden="true">
        ${escapeHtml(getInitials(state.user))}
      </div>
      <div class="teacher-profile-heading">
        <p class="panel-label">Учитель</p>
        <h2>${escapeHtml(getTeacherName(state.user))}</h2>
        <span class="teacher-online-status">онлайн</span>
      </div>

      <dl class="teacher-profile-details">
        <div>
          <dt>Направление</dt>
          <dd>${escapeHtml(state.user.department || "не указано")}</dd>
        </div>
        <div>
          <dt>Предметы</dt>
          <dd>${escapeHtml(subjectTitles.join(", ") || "не указаны")}</dd>
        </div>
        <div>
          <dt>Классное руководство</dt>
          <dd>${escapeHtml(classTeacherTitles.join(", ") || "нет")}</dd>
        </div>
        <div>
          <dt>Кабинет</dt>
          <dd>${escapeHtml(state.user.classroom || "не указан")}</dd>
        </div>
      </dl>
    </aside>
  `;
}

function renderJournalScreen(state, assignment) {
  const terms = state.model.school.academicYear.terms || [];
  const today = state.dateTools.getSchoolDateIso(state.now());
  const isAnnual = state.selectedTermId === state.model.school.academicYear.id;
  const selectedTerm = isAnnual ? state.model.school.academicYear : getSelectedTerm(terms, state.selectedTermId, today);
  state.selectedTermId = selectedTerm?.id || "";
  const lessons = selectedTerm
    ? state.model.getLessonsForAssignmentTerm(assignment, selectedTerm.id)
    : [];
  const students = state.model.getStudentsForAssignment(assignment);
  const audience = assignment.groupTitle || "весь класс";

  return `
    <main class="teacher-layout teacher-journal-view" id="teacherMainContent">
      <section class="teacher-journal-route">
        <div>
          <p class="panel-label">${escapeHtml(assignment.classTitle)} · ${escapeHtml(audience)}</p>
          <h1>${escapeHtml(assignment.subjectTitle)}</h1>
          <p>${isAnnual ? `${students.length} учеников · Итоги года` : formatRegisterSummary(students.length, lessons.length)}</p>
        </div>

        <div class="teacher-journal-tools">
          <label class="teacher-term-select">
            <span>Учебный период · ${escapeHtml(state.model.school.academicYear.title)}</span>
            <span class="teacher-select-control">
              <select data-term-select>
                ${terms.map((term) => `<option value="${escapeHtml(term.id)}" ${term.id === selectedTerm?.id ? "selected" : ""}>${escapeHtml(term.title)}</option>`).join("")}
                <option value="${escapeHtml(state.model.school.academicYear.id)}" ${isAnnual ? "selected" : ""}>Итоги года</option>
              </select>
              <span class="teacher-select-arrow" aria-hidden="true"></span>
            </span>
          </label>
          <div class="teacher-scroll-controls" aria-label="Прокрутка журнала" ${isAnnual ? "hidden" : ""}>
            <button type="button" data-register-scroll="start" aria-label="Перейти к началу четверти"><school-icon name="play-back-outline" aria-hidden="true"></school-icon></button>
            <button type="button" data-register-scroll="previous" aria-label="Показать предыдущие даты"><school-icon name="chevron-back-outline" aria-hidden="true"></school-icon></button>
            <button type="button" data-register-scroll="next" aria-label="Показать следующие даты"><school-icon name="chevron-forward-outline" aria-hidden="true"></school-icon></button>
            <button type="button" data-register-scroll="end" aria-label="Перейти к концу четверти"><school-icon name="play-forward-outline" aria-hidden="true"></school-icon></button>
          </div>
        </div>
      </section>

      <section class="teacher-journal-panel">
        <label class="teacher-student-search">Найти ученика<input type="search" data-student-search placeholder="Имя или фамилия" autocomplete="off"></label>
        <p data-student-search-empty hidden role="status">Ученик не найден.</p>
        ${
          isAnnual ? renderAnnualRegister(state, assignment, students) : selectedTerm && lessons.length
            ? renderQuarterRegister(
                state,
                assignment,
                students,
                lessons,
                selectedTerm,
              )
            : `<div class="teacher-empty"><p>В выбранной четверти занятий по этому предмету нет.</p></div>`
        }
      </section>
    </main>
  `;
}

function bindRootEvents(state) {
  const handleClick = (event) => {
    if (event.target.closest("[data-discard-editor]")) { closeJournalEditor(state, true, true); return; }
    if (event.target.closest("[data-keep-editor]")) {
      state.root.querySelector("[data-editor-message]").replaceChildren();
      state.root.querySelector("[data-journal-editor] button")?.focus();
      return;
    }
    const closeEditorButton = event.target.closest("[data-close-journal-editor]");
    if (closeEditorButton) {
      closeJournalEditor(state);
      return;
    }

    const entryButton = event.target.closest("[data-open-entry]");
    if (entryButton) {
      openEntryEditor(
        state,
        entryButton.dataset.openEntry,
        entryButton.dataset.studentId,
        event.detail === 0,
      );
      return;
    }

    const homeworkButton = event.target.closest("[data-open-homework]");
    if (homeworkButton) {
      openHomeworkEditor(
        state,
        homeworkButton.dataset.openHomework,
        event.detail === 0,
      );
      return;
    }

    const termGradeButton = event.target.closest("[data-open-term-grade]");
    if (termGradeButton) {
      openTermGradeEditor(state, {
        studentId: termGradeButton.dataset.openTermGrade,
        termId: termGradeButton.dataset.termId,
        assignmentId: termGradeButton.dataset.assignmentId,
      }, event.detail === 0);
      return;
    }

    const gradeChoice = event.target.closest("[data-editor-grade]");
    if (gradeChoice) {
      toggleEditorGrade(gradeChoice);
      return;
    }

    const clearGradeChoice = event.target.closest("[data-clear-editor-grade]");
    if (clearGradeChoice) {
      clearEditorGrades(clearGradeChoice);
      return;
    }

    const absenceChoice = event.target.closest("[data-editor-absence]");
    if (absenceChoice) {
      toggleEditorAbsence(absenceChoice);
      return;
    }

    const quickComment = event.target.closest("[data-quick-comment]");
    if (quickComment) {
      applyQuickComment(state, quickComment.dataset.quickComment);
      return;
    }

    const homeworkSymbol = event.target.closest("[data-homework-symbol]");
    if (homeworkSymbol) {
      insertHomeworkSymbol(state, homeworkSymbol.dataset.homeworkSymbol);
      return;
    }

    const assignmentButton = event.target.closest("[data-open-assignment]");
    if (assignmentButton) {
      state.selectedAssignmentId = assignmentButton.dataset.openAssignment;
      state.selectedTermId = "";
      state.view = "journal";
      render(state);
      state.root.ownerDocument.defaultView?.scrollTo?.({
        top: 0,
        left: 0,
        behavior: "auto",
      });
      return;
    }

    const scrollButton = event.target.closest("[data-register-scroll]");
    if (scrollButton) {
      const viewport = state.root.querySelector("[data-register-viewport]");
      scrollRegister(viewport, scrollButton.dataset.registerScroll);
      return;
    }

    if (event.target.closest("[data-teacher-home]")) {
      state.view = "overview";
      render(state);
      return;
    }

    if (event.target.closest("[data-teacher-logout]")) {
      state.onLogout?.();
      return;
    }

    if (event.target.closest("[data-teacher-theme]")) {
      state.onThemeToggle?.();
      state.syncTheme?.();
    }
  };

  const handleChange = (event) => {
    if (event.target.matches("[data-term-select]")) {
      state.selectedTermId = event.target.value;
      state.registerScrollLeft = 0;
      render(state);
      state.root.querySelector("[data-term-select]")?.focus();
    }
    if (event.target.matches('[data-homework-editor-form] [name="noHomework"]')) {
      const textarea = event.target.form.elements.homework;
      textarea.disabled = event.target.checked;
      if (!event.target.checked) textarea.focus();
    }
  };

  const handleSubmit = (event) => {
    if (event.target.matches("[data-entry-editor-form]")) {
      event.preventDefault();
      saveEntryEditor(state, event.target);
    }
    if (event.target.matches("[data-homework-editor-form]")) {
      event.preventDefault();
      saveHomeworkEditor(state, event.target);
    }
    if (event.target.matches("[data-term-grade-editor-form]")) {
      event.preventDefault();
      saveTermGradeEditor(state, event.target);
    }
  };

  const handleKeydown = (event) => {
    const editor = state.root.querySelector("[data-journal-editor]");
    if (!editor) {
      const cell = event.target.closest("[data-open-entry]");
      if (!cell || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      const cells = [...state.root.querySelectorAll("[data-open-entry]")].filter((button) => !button.closest("[hidden]"));
      const candidates = cells.filter((button) => event.key === "ArrowLeft" || event.key === "ArrowRight" ? button.dataset.studentId === cell.dataset.studentId : button.dataset.openEntry === cell.dataset.openEntry);
      const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      event.preventDefault();
      candidates[candidates.indexOf(cell) + direction]?.focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeJournalEditor(state, true);
    }
    if (event.key === "Tab") {
      const controls = [...editor.querySelectorAll(
        'button:not(:disabled), textarea:not(:disabled), input:not([type="hidden"]):not(:disabled)',
      )];
      const first = controls[0];
      const last = controls.at(-1);
      const active = state.root.ownerDocument.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };

  const handlePointerDown = (event) => {
    state.backdropPointerDown = event.target.matches?.(
      "[data-journal-editor-backdrop]",
    );
  };

  const handlePointerUp = (event) => {
    const shouldClose =
      state.backdropPointerDown &&
      event.target.matches?.("[data-journal-editor-backdrop]");
    state.backdropPointerDown = false;
    if (shouldClose) closeJournalEditor(state);
  };

  const handleWheel = (event) => {
    const viewport = event.target.closest?.("[data-register-viewport]");
    if (!viewport || !event.shiftKey) return;

    const distance = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      ? event.deltaY
      : event.deltaX;
    if (!distance) return;

    event.preventDefault();
    viewport.scrollLeft += distance;
  };

  const handlePointerOver = (event) => {
    const rowCell = event.target.closest?.("[data-student-row]");
    const previousRowCell = event.relatedTarget?.closest?.("[data-student-row]");
    if (
      !rowCell ||
      previousRowCell?.dataset.studentRow === rowCell.dataset.studentRow
    ) {
      return;
    }
    setStudentRowHighlight(state, rowCell.dataset.studentRow, true);
  };

  const handlePointerOut = (event) => {
    const rowCell = event.target.closest?.("[data-student-row]");
    const nextRowCell = event.relatedTarget?.closest?.("[data-student-row]");
    if (!rowCell || nextRowCell?.dataset.studentRow === rowCell.dataset.studentRow) {
      return;
    }
    setStudentRowHighlight(state, rowCell.dataset.studentRow, false);
  };

  const handleFocusIn = (event) => {
    const rowCell = event.target.closest?.("[data-student-row]");
    if (rowCell) setStudentRowHighlight(state, rowCell.dataset.studentRow, true);
  };

  const handleFocusOut = (event) => {
    const rowCell = event.target.closest?.("[data-student-row]");
    const nextRowCell = event.relatedTarget?.closest?.("[data-student-row]");
    if (!rowCell || nextRowCell?.dataset.studentRow === rowCell.dataset.studentRow) {
      return;
    }
    setStudentRowHighlight(state, rowCell.dataset.studentRow, false);
  };

  const handleInput = (event) => {
    if (!event.target.matches("[data-student-search]")) return;
    const query = event.target.value.trim().toLocaleLowerCase("ru");
    const context = getJournalContext(state);
    const matches = new Set(context.students.filter((student) => `${student.lastName} ${student.firstName}`.toLocaleLowerCase("ru").includes(query)).map((student) => student.id));
    state.root.querySelectorAll("[data-student-row]").forEach((row) => { row.hidden = !matches.has(row.dataset.studentRow); });
    state.root.querySelector("[data-student-search-empty]").hidden = matches.size > 0;
  };
  state.root.addEventListener("input", handleInput);
  state.root.addEventListener("click", handleClick);
  state.root.addEventListener("change", handleChange);
  state.root.addEventListener("submit", handleSubmit);
  state.root.addEventListener("keydown", handleKeydown);
  state.root.addEventListener("pointerdown", handlePointerDown);
  state.root.addEventListener("pointerup", handlePointerUp);
  state.root.addEventListener("pointerover", handlePointerOver);
  state.root.addEventListener("pointerout", handlePointerOut);
  state.root.addEventListener("focusin", handleFocusIn);
  state.root.addEventListener("focusout", handleFocusOut);
  state.root.addEventListener("wheel", handleWheel, { passive: false });

  return () => {
    state.root.removeEventListener("input", handleInput);
    state.root.removeEventListener("click", handleClick);
    state.root.removeEventListener("change", handleChange);
    state.root.removeEventListener("submit", handleSubmit);
    state.root.removeEventListener("keydown", handleKeydown);
    state.root.removeEventListener("pointerdown", handlePointerDown);
    state.root.removeEventListener("pointerup", handlePointerUp);
    state.root.removeEventListener("pointerover", handlePointerOver);
    state.root.removeEventListener("pointerout", handlePointerOut);
    state.root.removeEventListener("focusin", handleFocusIn);
    state.root.removeEventListener("focusout", handleFocusOut);
    state.root.removeEventListener("wheel", handleWheel);
  };
}

function setStudentRowHighlight(state, studentId, highlighted) {
  if (!studentId) return;
  state.root
    .querySelectorAll("[data-student-row]")
    .forEach((cell) => {
      if (cell.dataset.studentRow === studentId) {
        cell.classList.toggle("is-row-highlighted", highlighted);
      }
    });
}

function clearStudentRowHighlights(state) {
  state.root
    .querySelectorAll("[data-student-row].is-row-highlighted")
    .forEach((cell) => cell.classList.remove("is-row-highlighted"));
}

const EDITOR_GRADE_VALUES = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "зачёт",
  "незачёт",
];

const QUICK_COMMENTS = [
  ["Неуд. поведение", "Поведение неудовлетворительное."],
  ["Не готов", "Не готов к уроку."],
  ["Нет формы", "Нет спортивной формы."],
];

function getJournalContext(state) {
  const assignment = state.model
    .getTeacherAssignments(state.user.id)
    .find((item) => item.id === state.selectedAssignmentId);
  if (!assignment) return null;
  const term = getSelectedTerm(
    state.model.school.academicYear.terms || [],
    state.selectedTermId,
    state.dateTools.getSchoolDateIso(state.now()),
  );
  const lessons = term
    ? state.model.getLessonsForAssignmentTerm(assignment, term.id)
    : [];
  const students = state.model.getStudentsForAssignment(assignment);
  return { assignment, term, lessons, students };
}

function openEntryEditor(state, lessonId, studentId, restoreFocus = false) {
  const context = getJournalContext(state);
  const lesson = context?.lessons.find((item) => item.id === lessonId);
  const student = context?.students.find((item) => item.id === studentId);
  if (!lesson || !student) return;

  const entry = state.store.getJournalEntry(lessonId, studentId) || {
    grades: [],
    attendance: "",
    comment: "",
  };
  const selectedGrades = new Set(entry.grades || []);
  state.editorTrigger = state.root.ownerDocument.activeElement;
  state.restoreEditorFocus = restoreFocus;
  mountJournalEditor(
    state,
    `
      <form class="teacher-editor" data-journal-editor data-entry-editor-form>
        ${renderEditorHeader("Запись в журнале", `${student.lastName} ${student.firstName} · ${formatShortDate(lesson.date)}`)}
        <input type="hidden" name="lessonId" value="${escapeHtml(lessonId)}">
        <input type="hidden" name="studentId" value="${escapeHtml(studentId)}">

        <fieldset class="teacher-editor-section">
          <legend>Отметка</legend>
          ${renderGradePicker(selectedGrades)}
        </fieldset>

        <fieldset class="teacher-editor-section">
          <legend>Посещение</legend>
          <button type="button" class="teacher-absence-choice ${entry.attendance === "absent" ? "is-selected" : ""}" data-editor-absence aria-pressed="${entry.attendance === "absent"}">Н</button>
        </fieldset>

        <label class="teacher-editor-field">
          <span>Замечание</span>
          <textarea name="comment" rows="3" placeholder="Замечание…">${escapeHtml(entry.comment || "")}</textarea>
        </label>
        <div class="teacher-quick-comments" aria-label="Быстрые замечания">
          ${QUICK_COMMENTS.map(([label, value]) => `<button type="button" data-quick-comment="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join("")}
        </div>
        ${renderEditorFooter()}
      </form>
    `,
  );
}

function openHomeworkEditor(state, lessonId, restoreFocus = false) {
  const context = getJournalContext(state);
  const lesson = context?.lessons.find((item) => item.id === lessonId);
  if (!lesson) return;
  const savedWork = state.store.getLessonWork(lessonId);
  const lessonWork = savedWork || {
    homework: lesson.homework || "",
    noHomework: false,
    materials: [],
  };
  state.editorTrigger = state.root.ownerDocument.activeElement;
  state.restoreEditorFocus = restoreFocus;
  mountJournalEditor(
    state,
    `
      <form class="teacher-editor teacher-homework-editor" data-journal-editor data-homework-editor-form>
        ${renderEditorHeader("Домашнее задание", `${lesson.subject} · ${formatShortDate(lesson.date)}`)}
        <input type="hidden" name="lessonId" value="${escapeHtml(lessonId)}">
        <label class="teacher-editor-field">
          <span>Задание</span>
          <textarea name="homework" rows="4" placeholder="Например: § 12, № 4–6" ${lessonWork.noHomework ? "disabled" : ""}>${escapeHtml(lessonWork.homework || "")}</textarea>
        </label>
        <div class="teacher-symbols" aria-label="Специальные символы">
          <button type="button" data-homework-symbol="§">§</button>
          <button type="button" data-homework-symbol="№">№</button>
        </div>
        <label class="teacher-no-homework">
          <input type="checkbox" name="noHomework" ${lessonWork.noHomework ? "checked" : ""}>
          <span>Домашнего задания нет</span>
        </label>
        <label class="teacher-editor-field">
          <span>Ссылки на материалы</span>
          <textarea name="materials" rows="3" aria-describedby="journalEditorMessage" placeholder="По одной ссылке в строке">${escapeHtml((lessonWork.materials || []).join("\n"))}</textarea>
        </label>
        ${renderEditorFooter()}
      </form>
    `,
  );
}

function openTermGradeEditor(
  state,
  { studentId, termId, assignmentId },
  restoreFocus = false,
) {
  const context = getJournalContext(state);
  const student = context?.students.find((item) => item.id === studentId);
  if (!student) return;
  const entry = state.store.getTermGrade(termId, assignmentId, studentId);
  state.editorTrigger = state.root.ownerDocument.activeElement;
  state.restoreEditorFocus = restoreFocus;
  mountJournalEditor(
    state,
    `
      <form class="teacher-editor teacher-term-editor" data-journal-editor data-term-grade-editor-form>
        ${renderEditorHeader(termId === state.model.school.academicYear.id ? "Отметка за год" : "Отметка за четверть", `${student.lastName} ${student.firstName} · ${state.model.school.academicYear.terms.find((term) => term.id === termId)?.title || state.model.school.academicYear.title}`)}
        <p class="achievement-note">${termId === state.model.school.academicYear.id ? "Среднее четвертных" : "Средний балл"}: ${formatGradeAverage(termId === state.model.school.academicYear.id ? getSubjectResult(state.model, state.store, context.assignment, studentId).quarterAverage : getSubjectResult(state.model, state.store, context.assignment, studentId).periods.find((period) => period.term.id === termId)?.average)}. Итоговую отметку выбирает учитель.</p>
        <input type="hidden" name="studentId" value="${escapeHtml(studentId)}">
        <input type="hidden" name="termId" value="${escapeHtml(termId)}">
        <input type="hidden" name="assignmentId" value="${escapeHtml(assignmentId)}">
        <fieldset class="teacher-editor-section">
          <legend>Итог</legend>
          ${renderGradePicker(new Set(entry?.value ? [entry.value] : []), { single: true })}
        </fieldset>
        ${renderEditorFooter()}
      </form>
    `,
  );
}

function renderGradePicker(selectedGrades, { single = false } = {}) {
  return `
    <div class="teacher-grade-picker ${single ? "is-single" : ""}">
      ${EDITOR_GRADE_VALUES.map((value) => {
        const isSelected = selectedGrades.has(value);
        const widthClass = /^(?:10|[1-9])$/.test(value) ? "" : "is-wide";
        return `<button type="button" class="teacher-grade-choice ${widthClass} ${isSelected ? "is-selected" : ""}" data-editor-grade="${escapeHtml(value)}" aria-pressed="${isSelected}">${escapeHtml(toShortTermGrade(value))}</button>`;
      }).join("")}
      <button class="teacher-clear-grade" type="button" data-clear-editor-grade aria-label="Убрать выбранные отметки"><school-icon name="close-outline" aria-hidden="true"></school-icon></button>
    </div>
  `;
}

function renderEditorHeader(title, subtitle) {
  return `
    <header class="teacher-editor-header">
      <div>
        <p class="panel-label">Редактирование</p>
        <h2 id="journalEditorTitle">${escapeHtml(title)}</h2>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      <button type="button" class="teacher-editor-close" data-close-journal-editor aria-label="Отменить изменения"><school-icon name="close-outline" aria-hidden="true"></school-icon></button>
    </header>
  `;
}

function renderEditorFooter() {
  return `
    <p class="teacher-editor-message" id="journalEditorMessage" data-editor-message aria-live="polite"></p>
    <footer class="teacher-editor-actions">
      <button type="submit" class="is-primary"><school-icon name="checkmark-outline" aria-hidden="true"></school-icon><span>Сохранить</span></button>
    </footer>
  `;
}

function mountJournalEditor(state, html) {
  clearStudentRowHighlights(state);
  state.root.querySelector("[data-journal-editor-backdrop]")?.remove();
  state.root.ownerDocument.body.classList.remove("journal-editor-open");
  state.root.insertAdjacentHTML(
    "beforeend",
    `<div class="teacher-editor-backdrop" data-journal-editor-backdrop role="dialog" aria-modal="true" aria-labelledby="journalEditorTitle">${html}</div>`,
  );
  state.root
    .querySelector(
      "[data-journal-editor] textarea:not(:disabled), [data-journal-editor] button",
    )
    ?.focus?.();
  state.root.ownerDocument.body.classList.add("journal-editor-open");
  state.editorSnapshot = getEditorSnapshot(state);
}

function getEditorSnapshot(state) {
  const editor = state.root.querySelector("[data-journal-editor]");
  if (!editor) return "";
  return JSON.stringify({
    fields: [...editor.querySelectorAll("input, textarea")].map((field) => [field.name, field.value, field.checked]),
    grades: [...editor.querySelectorAll("[data-editor-grade].is-selected")].map((button) => button.dataset.editorGrade),
    absent: Boolean(editor.querySelector('[data-editor-absence].is-selected')),
  });
}

function closeJournalEditor(state, restoreFocus = state.restoreEditorFocus, discard = false) {
  if (!discard && state.editorSnapshot !== getEditorSnapshot(state)) {
    const message = state.root.querySelector("[data-editor-message]");
    message.innerHTML = 'Есть несохранённые изменения. <button type="button" data-keep-editor>Продолжить</button> <button type="button" data-discard-editor>Не сохранять</button>';
    message.querySelector("button")?.focus();
    return;
  }
  state.root.querySelector("[data-journal-editor-backdrop]")?.remove();
  state.root.ownerDocument.body.classList.remove("journal-editor-open");
  clearStudentRowHighlights(state);
  if (restoreFocus) state.editorTrigger?.focus?.();
  state.editorTrigger = null;
  state.restoreEditorFocus = false;
  state.backdropPointerDown = false;
}

function toggleEditorGrade(button) {
  const form = button.closest("form");
  const selected = form.querySelectorAll("[data-editor-grade].is-selected");
  const isSingle = form.matches("[data-term-grade-editor-form]");
  const message = form.querySelector("[data-editor-message]");

  if (button.classList.contains("is-selected")) {
    button.classList.remove("is-selected");
    button.setAttribute("aria-pressed", "false");
    return;
  }

  if (isSingle) {
    selected.forEach((item) => {
      item.classList.remove("is-selected");
      item.setAttribute("aria-pressed", "false");
    });
  } else if (selected.length >= 2) {
    if (message) message.textContent = "На один урок можно поставить не больше двух отметок.";
    return;
  }

  form.querySelector("[data-editor-absence]")?.classList.remove("is-selected");
  button.classList.add("is-selected");
  button.setAttribute("aria-pressed", "true");
  if (message) message.textContent = "";
}

function clearEditorGrades(button) {
  button
    .closest("form")
    ?.querySelectorAll("[data-editor-grade].is-selected")
    .forEach((item) => {
      item.classList.remove("is-selected");
      item.setAttribute("aria-pressed", "false");
    });
}

function toggleEditorAbsence(button) {
  const form = button.closest("form");
  const willSelect = !button.classList.contains("is-selected");
  button.classList.toggle("is-selected", willSelect);
  button.setAttribute("aria-pressed", String(willSelect));
  if (willSelect) clearEditorGrades(button);
  const message = form.querySelector("[data-editor-message]");
  if (message) message.textContent = "";
}

function applyQuickComment(state, value) {
  const textarea = state.root.querySelector('[data-journal-editor] textarea[name="comment"]');
  if (!textarea) return;
  textarea.value = textarea.value.trim()
    ? `${textarea.value.trim()} ${value}`
    : value;
  textarea.focus();
}

function insertHomeworkSymbol(state, symbol) {
  const textarea = state.root.querySelector('[data-journal-editor] textarea[name="homework"]');
  if (!textarea || textarea.disabled) return;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  textarea.setRangeText(symbol, start, end, "end");
  textarea.focus();
}

function saveEntryEditor(state, form) {
  const lessonId = form.elements.lessonId.value;
  const studentId = form.elements.studentId.value;
  const previous = state.store.getJournalEntry(lessonId, studentId) || {};
  const grades = [...form.querySelectorAll("[data-editor-grade].is-selected")].map(
    (button) => button.dataset.editorGrade,
  );
  const attendance = form.querySelector("[data-editor-absence].is-selected")
    ? "absent"
    : "";
  const result = state.store.saveJournalEntry({
    ...previous,
    lessonId,
    studentId,
    grades,
    attendance,
    comment: form.elements.comment.value,
    authorId: state.user.id,
  });
  finishEditorSave(state, form, result.persisted);
}

function saveHomeworkEditor(state, form) {
  const lessonId = form.elements.lessonId.value;
  const { materials, invalidCount } = parseMaterialInput(form.elements.materials.value);
  setFieldInvalid(form.elements.materials, invalidCount > 0);
  if (invalidCount) {
    const message = form.querySelector("[data-editor-message]");
    message.textContent = "Проверьте ссылки: принимаются только адреса http и https.";
    form.elements.materials.focus();
    return;
  }
  const result = state.store.saveLessonWork({
    lessonId,
    homework: form.elements.noHomework.checked ? "" : form.elements.homework.value,
    noHomework: form.elements.noHomework.checked,
    materials,
    authorId: state.user.id,
  });
  finishEditorSave(state, form, result.persisted);
}

function saveTermGradeEditor(state, form) {
  const selected = form.querySelector("[data-editor-grade].is-selected");
  const result = state.store.saveTermGrade({
    termId: form.elements.termId.value,
    assignmentId: form.elements.assignmentId.value,
    studentId: form.elements.studentId.value,
    value: selected?.dataset.editorGrade || "",
    authorId: state.user.id,
  });
  finishEditorSave(state, form, result.persisted);
}

function finishEditorSave(state, form, persisted) {
  if (!persisted) {
    form.querySelector("[data-editor-message]").textContent =
      "Изменение осталось только до обновления страницы: браузер не дал сохранить его.";
    return;
  }
  state.registerScrollLeft =
    state.root.querySelector("[data-register-viewport]")?.scrollLeft || 0;
  const trigger = { ...state.editorTrigger?.dataset };
  closeJournalEditor(state, false, true);
  render(state);
  const buttons = state.root.querySelectorAll("[data-open-entry], [data-open-homework], [data-open-term-grade]");
  if (Object.keys(trigger).length) [...buttons].find((button) => Object.entries(trigger).every(
    ([key, value]) => button.dataset[key] === value,
  ))?.focus({ preventScroll: true });
  state.notify?.("Сохранено", { type: "success" });
}

function renderAnnualRegister(state, assignment, students) {
  const year = state.model.school.academicYear;
  const resultButton = (student, periodId, value, label) => `<button type="button" data-open-term-grade="${escapeHtml(student.id)}" data-term-id="${escapeHtml(periodId)}" data-assignment-id="${escapeHtml(assignment.id)}" aria-label="${escapeHtml(`${label}: ${student.lastName} ${student.firstName}`)}">${escapeHtml(value || "—")}</button>`;
  return `<h2>Итоги года</h2><p class="achievement-note">Под итогом четверти — средний балл текущих отметок. Нажмите на итог, чтобы изменить его.</p>
    <div class="achievement-scroll" tabindex="0" role="region" aria-label="Итоги года"><table class="achievement-table"><thead><tr><th scope="col">Ученик</th>${year.terms.map((term) => `<th scope="col">${escapeHtml(term.title)}</th>`).join("")}<th scope="col">Среднее четвертных</th><th scope="col">Год</th></tr></thead><tbody>${students.map((student) => {
      const result = getSubjectResult(state.model, state.store, assignment, student.id);
      return `<tr data-student-row="${escapeHtml(student.id)}"><th scope="row">${escapeHtml(`${student.lastName} ${student.firstName}`)}</th>${result.periods.map((period) => `<td>${resultButton(student, period.term.id, period.final, period.term.title)}<small>Ср. ${formatGradeAverage(period.average)}</small></td>`).join("")}<td>${formatGradeAverage(result.quarterAverage)}</td><td>${resultButton(student, year.id, result.annual, "Годовая отметка")}</td></tr>`;
    }).join("")}</tbody></table></div>`;
}

function renderQuarterRegister(state, assignment, students, lessons, term) {
  const entriesByLesson = new Map(
    lessons.map((lesson) => [
      lesson.id,
      new Map(
        state.store
          .getLessonEntries(lesson.id)
          .map((entry) => [entry.studentId, entry]),
      ),
    ]),
  );
  const lessonWorkByLesson = new Map(
    lessons.map((lesson) => [lesson.id, state.store.getLessonWork(lesson.id)]),
  );
  const termGradesByStudent = new Map(
    state.store
      .getTermGrades(term.id, assignment.id)
      .map((entry) => [entry.studentId, entry]),
  );

  return `
    <div class="teacher-register-caption">
      <div>
        <p class="panel-label">Журнал</p>
        <h2>${escapeHtml(term.title)}</h2>
      </div>
      <p>
        <span class="teacher-scroll-hint-desktop">Зажмите Shift и прокручивайте колесо, чтобы двигаться по датам.</span>
        <span class="teacher-scroll-hint-touch">Проведите по датам в сторону, чтобы продолжить.</span>
      </p>
    </div>

    <div class="teacher-register-viewport" data-register-viewport tabindex="0" aria-label="Журнал ${escapeHtml(term.title)}. Используйте горизонтальную прокрутку для просмотра дат.">
      <div class="teacher-register-grid" role="grid" aria-label="Оценки учеников" style="--teacher-lesson-count: ${lessons.length}">
        ${renderRegisterHeader(lessons, lessonWorkByLesson, "top")}
        ${students.map((student, index) => renderRegisterStudentRow(student, index, lessons, entriesByLesson, termGradesByStudent.get(student.id), term.id, assignment.id)).join("")}
        ${renderRegisterHeader(lessons, lessonWorkByLesson, "bottom")}
      </div>
    </div>
  `;
}

function renderRegisterHeader(lessons, lessonWorkByLesson, position) {
  const isTop = position === "top";

  return `
    <div class="teacher-register-cell teacher-register-corner is-number is-left-sticky ${isTop ? "is-top-sticky" : ""}" role="columnheader">№</div>
    <div class="teacher-register-cell teacher-register-corner is-student is-left-sticky ${isTop ? "is-top-sticky" : ""}" role="columnheader">${isTop ? "Список учащихся" : "Ученик"}</div>
    <div class="teacher-register-cell teacher-register-corner is-count is-left-sticky ${isTop ? "is-top-sticky" : ""}" role="columnheader" title="Количество числовых оценок">Кол.</div>
    <div class="teacher-register-cell teacher-register-corner is-average is-left-sticky ${isTop ? "is-top-sticky" : ""}" role="columnheader" title="Средний балл">Ср.</div>
    ${lessons.map((lesson, index) => renderLessonHeader(lesson, lessonWorkByLesson.get(lesson.id), index, lessons, isTop)).join("")}
    <div class="teacher-register-cell teacher-register-corner is-final-average ${isTop ? "is-top-sticky" : ""}" role="columnheader">Ср.</div>
    <div class="teacher-register-cell teacher-register-corner is-term-grade ${isTop ? "is-top-sticky" : ""}" role="columnheader">За четверть</div>
  `;
}

function renderLessonHeader(lesson, lessonWork, index, lessons, isTop) {
  const monthClass = isMonthBoundary(lessons, index) ? "is-month-boundary" : "";
  const hasHomework = Boolean(
    lessonWork?.noHomework ||
      lessonWork?.homework ||
      lessonWork?.materials?.length,
  );
  return `
    <div class="teacher-register-cell teacher-register-date ${monthClass} ${isTop ? "is-top-sticky" : ""}" role="columnheader" title="${escapeHtml(formatLessonDateTitle(lesson))}">
      <strong>${escapeHtml(formatShortDate(lesson.date))}</strong>
      <button class="teacher-homework-slot ${hasHomework ? "has-homework" : ""}" type="button" data-open-homework="${escapeHtml(lesson.id)}" aria-label="${hasHomework ? "Изменить" : "Добавить"} домашнее задание на ${escapeHtml(formatShortDate(lesson.date))}">${hasHomework ? "✓" : "+"}</button>
    </div>
  `;
}

function renderRegisterStudentRow(
  student,
  index,
  lessons,
  entriesByLesson,
  termGrade,
  termId,
  assignmentId,
) {
  const entries = lessons.map(
    (lesson) => entriesByLesson.get(lesson.id)?.get(student.id) || null,
  );
  const stats = calculateGradeStats(entries);
  const averageLabel = formatGradeAverage(stats.average);
  const rowClass = index % 2 === 1 ? "is-alternate-row" : "";
  const rowAttribute = `data-student-row="${escapeHtml(student.id)}"`;

  return `
    <div class="teacher-register-cell teacher-register-number is-number is-left-sticky ${rowClass}" ${rowAttribute} role="rowheader">${index + 1}</div>
    <div class="teacher-register-cell teacher-register-student is-student is-left-sticky ${rowClass}" ${rowAttribute} role="rowheader" title="${escapeHtml(`${student.lastName} ${student.firstName}`)}"><strong>${escapeHtml(`${student.lastName} ${student.firstName}`)}</strong></div>
    <div class="teacher-register-cell teacher-register-summary is-count is-left-sticky ${rowClass}" ${rowAttribute} role="gridcell">${stats.count || "—"}</div>
    <div class="teacher-register-cell teacher-register-summary is-average is-left-sticky ${rowClass}" ${rowAttribute} role="gridcell">${averageLabel}</div>
    ${lessons.map((lesson, lessonIndex) => renderStudentLessonCell(entries[lessonIndex], student, lesson, lessonIndex, lessons, rowClass, rowAttribute)).join("")}
    <div class="teacher-register-cell teacher-register-summary is-final-average ${rowClass}" ${rowAttribute} role="gridcell">${averageLabel}</div>
    <div class="teacher-register-cell teacher-register-term-result is-term-grade ${rowClass}" ${rowAttribute} role="gridcell"><button type="button" data-open-term-grade="${escapeHtml(student.id)}" data-term-id="${escapeHtml(termId)}" data-assignment-id="${escapeHtml(assignmentId)}" aria-label="Четвертная отметка: ${escapeHtml(`${student.lastName} ${student.firstName}`)}">${escapeHtml(toShortTermGrade(termGrade?.value) || "—")}</button></div>
  `;
}

function scrollRegister(viewport, action) {
  if (!viewport) return;

  if (action === "start" || action === "end") {
    viewport.scrollTo({
      left: action === "start" ? 0 : viewport.scrollWidth,
      behavior: "smooth",
    });
    return;
  }

  const dateCells = [
    ...viewport.querySelectorAll(".teacher-register-date.is-top-sticky"),
  ];
  if (!dateCells.length) return;

  const viewportRect = viewport.getBoundingClientRect();
  const stickyRight = [
    ...viewport.querySelectorAll(
      ".teacher-register-cell.is-top-sticky.is-left-sticky",
    ),
  ]
    .map((cell) => cell.getBoundingClientRect())
    .filter((rect) => rect.width > 1)
    .reduce((right, rect) => Math.max(right, rect.right), viewportRect.left);
  const visibleLeft = Math.max(
    viewportRect.left,
    stickyRight,
  );
  const visibleDates = dateCells
    .map((cell, index) => ({ cell, index, rect: cell.getBoundingClientRect() }))
    .filter(
      ({ rect }) =>
        rect.left >= visibleLeft - 1 && rect.right <= viewportRect.right + 1,
    );

  if (!visibleDates.length) return;
  const targetIndex = getRegisterPageTargetIndex(
    action,
    visibleDates.map(({ index }) => index),
    dateCells.length,
  );
  if (targetIndex < 0) return;
  const targetCell = dateCells[targetIndex];
  const targetLeft = targetIndex
    ? viewport.scrollLeft +
      targetCell.getBoundingClientRect().left -
      visibleLeft
    : 0;

  viewport.scrollTo({ left: targetLeft, behavior: "smooth" });
}

function getRegisterPageTargetIndex(action, visibleIndexes, totalCount) {
  if (!visibleIndexes.length || totalCount < 1) return -1;
  const firstVisible = visibleIndexes[0];
  const lastVisible = visibleIndexes.at(-1);
  const visibleSpan = Math.max(1, lastVisible - firstVisible);
  if (action === "next") return Math.min(totalCount - 1, lastVisible);
  if (action === "previous") return Math.max(0, firstVisible - visibleSpan);
  return -1;
}

function renderStudentLessonCell(
  entry,
  student,
  lesson,
  index,
  lessons,
  rowClass,
  rowAttribute,
) {
  const presentation = getJournalCellPresentation(entry);
  const monthClass = isMonthBoundary(lessons, index) ? "is-month-boundary" : "";
  const commentClass = presentation.hasComment ? "has-comment" : "";
  return `
    <div class="teacher-register-cell teacher-register-entry is-${presentation.kind} ${commentClass} ${monthClass} ${rowClass}" ${rowAttribute} role="gridcell">
      <button type="button" data-open-entry="${escapeHtml(lesson.id)}" data-student-id="${escapeHtml(student.id)}" aria-label="Запись: ${escapeHtml(`${student.lastName} ${student.firstName}`)}, ${escapeHtml(formatShortDate(lesson.date))}">${escapeHtml(presentation.label)}</button>
    </div>
  `;
}

function toShortTermGrade(value) {
  if (value === "зачёт") return "зач.";
  if (value === "незачёт") return "незач.";
  return value || "";
}

function parseMaterialInput(value = "") {
  const items = String(value)
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const materials = items.map(getSafeMaterialUrl).filter(Boolean);
  return { materials, invalidCount: items.length - materials.length };
}

function getSelectedTerm(terms, selectedTermId, today) {
  const selected = terms.find((term) => term.id === selectedTermId);
  if (selected) return selected;

  const current = terms.find(
    (term) => term.startsOn <= today && today <= term.endsOn,
  );
  if (current) return current;

  return [...terms]
    .sort((first, second) => first.endsOn.localeCompare(second.endsOn))
    .at(-1);
}

function formatRegisterSummary(studentCount, lessonCount) {
  return `${formatStudentCount(studentCount)} · ${lessonCount} ${getClassSessionForm(lessonCount)}`;
}

function getClassSessionForm(count) {
  if (count % 10 === 1 && count % 100 !== 11) return "занятие";
  if (
    [2, 3, 4].includes(count % 10) &&
    ![12, 13, 14].includes(count % 100)
  ) {
    return "занятия";
  }
  return "занятий";
}

function formatShortDate(value) {
  const [, month = "", day = ""] = String(value || "").split("-");
  return day && month ? `${day}.${month}` : "—";
}

function formatLessonDateTitle(lesson) {
  return `${formatShortDate(lesson.date)} · ${lesson.time || `${lesson.startsAt}–${lesson.endsAt}`}`;
}

function isMonthBoundary(lessons, index) {
  if (index === 0) return false;
  return lessons[index - 1]?.date?.slice(0, 7) !== lessons[index]?.date?.slice(0, 7);
}

function getTeacherDaySummary(lessonCount) {
  if (!lessonCount) {
    return "На сегодня занятий нет. Ниже — ваши классы и предметы.";
  }
  return `Сегодня ${lessonCount} ${getLessonForm(lessonCount)}. Ниже — ваши классы и предметы.`;
}

function formatAssignmentSummary(classCount, assignmentCount) {
  return `${classCount} ${getClassForm(classCount)} · ${assignmentCount} ${getJournalForm(assignmentCount)}`;
}

function formatSubjectCount(count) {
  if (count % 10 === 1 && count % 100 !== 11) return `${count} предмет`;
  if (
    [2, 3, 4].includes(count % 10) &&
    ![12, 13, 14].includes(count % 100)
  ) {
    return `${count} предмета`;
  }
  return `${count} предметов`;
}

function formatStudentCount(count) {
  const number = Number(count) || 0;
  if (number % 10 === 1 && number % 100 !== 11) return `${number} ученик`;
  if (
    [2, 3, 4].includes(number % 10) &&
    ![12, 13, 14].includes(number % 100)
  ) {
    return `${number} ученика`;
  }
  return `${number} учеников`;
}

function getLessonForm(count) {
  if (count % 10 === 1 && count % 100 !== 11) return "урок";
  if (
    [2, 3, 4].includes(count % 10) &&
    ![12, 13, 14].includes(count % 100)
  ) {
    return "урока";
  }
  return "уроков";
}

function getClassForm(count) {
  if (count % 10 === 1 && count % 100 !== 11) return "класс";
  if (
    [2, 3, 4].includes(count % 10) &&
    ![12, 13, 14].includes(count % 100)
  ) {
    return "класса";
  }
  return "классов";
}

function getJournalForm(count) {
  if (count % 10 === 1 && count % 100 !== 11) return "журнал";
  if (
    [2, 3, 4].includes(count % 10) &&
    ![12, 13, 14].includes(count % 100)
  ) {
    return "журнала";
  }
  return "журналов";
}

function getTeacherAddressName(user) {
  return [user.firstName, user.middleName].filter(Boolean).join(" ") || "учитель";
}

function getTeacherName(user) {
  return (
    user.displayName ||
    [user.lastName, user.firstName, user.middleName].filter(Boolean).join(" ")
  );
}

function getInitials(user) {
  return [user.firstName, user.middleName]
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export {
  formatAssignmentSummary,
  formatRegisterSummary,
  formatStudentCount,
  getSelectedTerm,
  getRegisterPageTargetIndex,
  getTeacherDaySummary,
  mount,
  parseMaterialInput,
};
