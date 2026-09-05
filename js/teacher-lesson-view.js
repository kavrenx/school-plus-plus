import { escapeHtml } from "./ui-utils.js";
import { getJournalCellPresentation } from "./teacher-journal-model.js";

// Keep an explicit choice; otherwise open today, the last past lesson, or the first upcoming one.
function selectLesson(lessons, selectedId, today) {
  return lessons.find((lesson) => lesson.id === selectedId)
    || lessons.find((lesson) => lesson.date === today)
    || lessons.filter((lesson) => lesson.date < today).at(-1)
    || lessons[0]
    || null;
}

function renderLessonView({ lesson, lessons, students, store, dateTools, today }) {
  if (!lesson) return '<p class="teacher-empty">В этой четверти занятий нет.</p>';
  const index = lessons.findIndex((item) => item.id === lesson.id);
  const savedWork = store.getLessonWork(lesson.id);
  const homework = savedWork?.noHomework
    ? "Домашнего задания нет"
    : savedWork?.homework || lesson.homework || "Задание пока не добавлено";
  const entries = new Map(store.getLessonEntries(lesson.id).map((entry) => [entry.studentId, entry]));
  const label = (item) => `${dateTools.formatIsoDateLong(item.date)} · ${item.startsAt}–${item.endsAt}`;
  return `
    <section class="lesson-workspace" aria-label="Урок">
      <div class="lesson-date-nav">
        <button type="button" data-lesson-step="-1" aria-label="Предыдущий урок" ${index === 0 ? "disabled" : ""}>←</button>
        <label><span class="panel-label">Дата урока${lesson.date === today ? " · сегодня" : ""}</span>
          <select data-lesson-select aria-label="Дата урока">
            ${lessons.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === lesson.id ? "selected" : ""}>${escapeHtml(label(item))}</option>`).join("")}
          </select>
        </label>
        <button type="button" data-lesson-step="1" aria-label="Следующий урок" ${index === lessons.length - 1 ? "disabled" : ""}>→</button>
      </div>
      <div class="lesson-columns">
        <section class="lesson-roster" aria-labelledby="lessonRosterTitle">
          <header class="lesson-section-heading"><h2 id="lessonRosterTitle">Ученики <span>${students.length}</span></h2><p>Нажмите на ученика, чтобы внести запись.</p></header>
          <ol class="lesson-students">
            ${students.map((student, row) => {
              const entry = entries.get(student.id);
              const value = getJournalCellPresentation(entry);
              const name = `${student.lastName} ${student.firstName}`;
              const status = value.kind === "absent" ? "Отсутствует" : value.kind === "empty" ? "Нет записи" : entry?.comment || "";
              return `<li><button type="button" class="lesson-student is-${value.kind}" data-open-entry="${escapeHtml(lesson.id)}" data-student-id="${escapeHtml(student.id)}" aria-label="Запись: ${escapeHtml(name)}, ${escapeHtml(label(lesson))}">
                <span class="lesson-student-number" aria-hidden="true">${row + 1}</span>
                <span class="lesson-student-name"><strong>${escapeHtml(name)}</strong>${status ? `<small>${escapeHtml(status)}</small>` : ""}</span>
                <span class="lesson-student-grade">${escapeHtml(value.label || "—")}</span>
                <span class="lesson-student-arrow" aria-hidden="true">›</span>
              </button></li>`;
            }).join("")}
          </ol>
          ${students.length ? "" : '<p class="teacher-empty">В этой группе пока нет учеников.</p>'}
        </section>
        <aside class="lesson-homework" aria-labelledby="lessonHomeworkTitle">
          <div class="lesson-section-heading"><h2 id="lessonHomeworkTitle">Домашнее задание</h2><p>Общее для этого урока</p></div>
          <p class="lesson-homework-text">${escapeHtml(homework)}</p>
          ${savedWork?.materials?.length ? `<p class="lesson-material-count">Материалы: ${savedWork.materials.length}</p>` : ""}
          <button type="button" class="lesson-homework-edit" data-open-homework="${escapeHtml(lesson.id)}">Изменить задание</button>
        </aside>
      </div>
    </section>`;
}

export { selectLesson, renderLessonView };
