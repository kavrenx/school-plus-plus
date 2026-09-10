import { escapeHtml as e } from "./ui-utils.js";
import { formatGradeAverage as average } from "./teacher-journal-model.js";

function renderAchievementTable(results, year) {
  return `<h2 tabindex="-1" data-achievement-heading>Успеваемость</h2>
    <p class="achievement-note">${e(year.title)} · Итог выставляет учитель. Под ним — средний балл текущих отметок.</p>
    <div class="achievement-scroll" tabindex="0" role="region" aria-label="Отметки за четверти и год. Таблицу можно прокручивать горизонтально.">
    <table class="achievement-table"><thead><tr><th scope="col">Предмет</th>${year.terms.map((term) => `<th scope="col">${e(term.title)}</th>`).join("")}<th scope="col">Среднее<br>четвертных</th><th scope="col">Год</th></tr></thead>
    <tbody>${results.map((result) => `<tr><th scope="row"><button type="button" data-achievement-subject="${e(result.assignment.id)}">${e(result.assignment.title)}</button></th>${result.periods.map((period) => `<td><strong>${e(period.final || "—")}</strong><small>Ср. ${average(period.average)}</small></td>`).join("")}<td>${average(result.quarterAverage)}</td><td><strong>${e(result.annual || "—")}</strong></td></tr>`).join("")}</tbody></table></div>
    <p class="achievement-note">Нажми на предмет, чтобы посмотреть все отметки. «—» означает, что отметок пока нет. Среднее четвертных считается по уже выставленным числовым итогам.</p>`;
}

function renderSubjectDetails(result, termId, dateTools, canOpenLesson) {
  const period = result.periods.find((item) => item.term.id === termId) || result.periods[0];
  if (!period) return "<p>Учебные периоды ещё не добавлены.</p>";
  return `<button type="button" data-achievement-back>← Все предметы</button>
    <h2 tabindex="-1" data-achievement-heading>${e(result.assignment.title)}</h2>
    <label class="achievement-period">Учебный период<select data-achievement-term>${result.periods.map(({ term }) => `<option value="${e(term.id)}" ${period.term.id === term.id ? "selected" : ""}>${e(term.title)}</option>`).join("")}</select></label>
    <dl class="achievement-stats"><div><dt>Средний балл</dt><dd>${average(period.average)}</dd></div><div><dt>Числовых отметок</dt><dd>${period.count}</dd></div><div><dt>Пропусков</dt><dd>${period.absent}</dd></div><div><dt>За четверть</dt><dd>${e(period.final || "—")}</dd></div></dl>
    <p class="achievement-note">Каждая числовая отметка учитывается отдельно. Пропуски и зачёты в среднее не входят.</p>
    <ul class="achievement-records">${period.records.map(({ lesson, entry }) => `<li><div>${canOpenLesson(lesson) ? `<button type="button" data-achievement-lesson="${e(lesson.id)}">${e(dateTools.formatIsoDateLong(lesson.date))} · ${e(lesson.startsAt)}</button>` : `<span>${e(dateTools.formatIsoDateLong(lesson.date))} · ${e(lesson.startsAt)}</span>`}<p>${e(entry.comment || "")}</p></div><strong>${e(entry.attendance === "absent" ? "Н" : entry.grades?.join(" / ") || "Замечание")}</strong></li>`).join("")}</ul>
    ${period.records.length ? "" : '<p class="achievement-empty">За эту четверть записей пока нет.</p>'}`;
}

export { renderAchievementTable, renderSubjectDetails };
