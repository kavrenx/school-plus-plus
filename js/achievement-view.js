import { escapeHtml as e } from "./ui-utils.js";
import { formatGradeAverage as average } from "./teacher-journal-model.js";
import {
  getResultDisplayColumns,
  getEffectiveResultColumn,
  getDisplayFinalAverage,
  getResultCell,
} from "./result-periods.js";
import { shortSubjectName } from "./subject-names.js";

function renderAchievementTable(results, year, behavior = {}) {
  const columns = getResultDisplayColumns(year);
  const mark = (result, column) => {
    const value = getResultCell(result, column);
    return value.final !== ""
      ? `<strong>${e(value.final)}</strong>`
      : column.type === "year" || result.assignment.gradingScale === "pass-fail"
        ? "—"
      : `<span class="result-forecast" aria-label="Средний балл текущих отметок">${average(value.average)}</span>`;
  };
  const periodName = (column) =>
    column.type === "quarter"
      ? `${column.label} четверть`
      : column.type === "half"
        ? `${column.label} полугодие`
        : "Год";
  const cell = (label, value) =>
    `<td><div class="result-period-value" aria-label="${e(label)}">${value}</div></td>`;
  return `<h2 tabindex="-1" data-achievement-heading>Успеваемость ${e(year.title)}</h2>
    <p class="result-legend"><span class="result-legend-forecast">10,0</span> — прогнозируемая отметка; <strong>10</strong> — выставленная учителем.</p>
    <div class="achievement-scroll" tabindex="0" role="region" aria-label="Отметки за четверти и год. Таблицу можно прокручивать горизонтально.">
    <table class="achievement-table result-table"><colgroup><col class="result-subject-col">${columns.map(() => '<col class="result-mark-col">').join("")}</colgroup><thead><tr><th scope="col">Предмет</th>${columns.map((column) => `<th scope="col" aria-label="${e(periodName(column))}${column.half ? ` и ${e(periodName(column.half))}` : ""}">${e(column.label)}${column.half ? `<small>${column.half.label} п/г</small>` : ""}</th>`).join("")}</tr></thead>
    <tbody>${results
      .map(
        (result) =>
          `<tr><th scope="row"><button type="button" data-achievement-subject="${e(result.assignment.id)}" aria-label="Открыть отметки по предмету ${e(result.assignment.title)}">${e(result.assignment.title)}</button></th>${columns
            .map((column) => {
              const period = getEffectiveResultColumn(result, column);
              return cell(
                period ? periodName(period) : periodName(column),
                period ? mark(result, period) : "—",
              );
            })
            .join("")}</tr>`,
      )
      .join("")}
    <tr class="result-summary"><th scope="row">Средний балл</th>${columns.map((column) => cell(periodName(column), average(getDisplayFinalAverage(results, column)))).join("")}</tr>
    <tr class="result-summary"><th scope="row">Поведение</th>${columns
      .map((column) => {
        const value =
          behavior[column.id] ||
          (column.half ? behavior[column.half.id] : "") ||
          "—";
        return cell(periodName(column), e(value));
      })
      .join("")}</tr></tbody></table></div>`;
}

function renderSubjectDetails(result, period, dateTools) {
  if (!period) return "";
  const gradeTiles = period.records
    .flatMap(({ lesson, entry }) => {
      const grades = (entry.grades || []).filter(
        (grade) => getGradeTone(grade) !== "neutral" || String(grade).trim(),
      );
      return grades.map(
        (grade) =>
          `<li class="subject-grade-tile grade-tone-${getGradeTone(grade)}"><time datetime="${e(lesson.date)}" aria-label="${e(dateTools.formatIsoDateLong(lesson.date))}">${e(formatShortDate(lesson.date))}</time><strong>${e(grade)}</strong></li>`,
      );
    })
    .join("");
  const lessonsLeft = period.remainingLessons.length;
  const passFail =
    result.assignment.gradingScale === "pass-fail" ||
    shortSubjectName(result.assignment.title) === "Искусство";
  return `<button class="subject-detail-backdrop" type="button" data-achievement-back aria-label="Закрыть отметки по предмету"></button>
    <aside class="subject-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="subjectDetailTitle">
      <button class="subject-detail-close" type="button" data-achievement-back aria-label="Закрыть">×</button>
      <h2 id="subjectDetailTitle" tabindex="-1" data-subject-detail-heading>${e(shortSubjectName(result.assignment.title))} <span>•</span> ${e(period.title)}</h2>
      <section class="subject-average-card" aria-label="${passFail ? "Форма оценки" : "Средний балл"}"><span>${passFail ? "Форма оценки" : "Средний балл"}</span><strong>${passFail ? "Зачётная система" : average(period.average)}</strong></section>
      ${passFail ? "" : `<section class="grade-goal-card" aria-labelledby="gradeGoalTitle">
        <h3 id="gradeGoalTitle">Цель по предмету</h3>
        <p>До конца периода по расписанию: ${lessonsLeft} ${getLessonWord(lessonsLeft)}.</p>
        <form data-grade-goal-form>
          <label>Какую отметку хочешь получить?<input data-grade-goal type="number" min="1" max="10" step="1" inputmode="numeric" placeholder="9" required></label>
          <button type="submit">Рассчитать</button>
        </form>
        <div class="grade-goal-result" data-grade-goal-result aria-live="polite"></div>
        <small>Расчёт ориентируется на средний балл и предполагает не больше одной новой отметки за оставшийся урок.</small>
      </section>`}
      <section class="subject-grade-history" aria-labelledby="subjectGradesTitle">
        <div class="subject-grade-heading"><h3 id="subjectGradesTitle">Все отметки</h3><ul aria-label="Цветовые диапазоны"><li class="grade-tone-low">1–3</li><li class="grade-tone-middle">4–6</li><li class="grade-tone-high">7–10</li></ul></div>
        ${gradeTiles ? `<ol class="subject-grade-grid">${gradeTiles}</ol>` : '<p class="achievement-empty">Отметок за этот период пока нет.</p>'}
      </section>
    </aside>`;
}

function formatShortDate(value) {
  const [year, month, day] = String(value || "").split("-");
  return year && month && day ? `${day}.${month}` : "—";
}

function renderGradeGoalResult(plan) {
  if (plan.status === "invalid")
    return '<p class="goal-message is-warning">Введи целую отметку от 1 до 10.</p>';
  if (plan.status === "reached")
    return `<p class="goal-message is-success">Цель уже достигнута: средний балл ${average(plan.currentAverage)}.</p>`;
  if (plan.status === "possible")
    return `<p class="goal-message is-success">Достаточно получить: <strong>${plan.suggestedGrades.join(", ")}</strong>. Тогда средний будет ${average(plan.projectedAverage)}.</p>`;
  if (!plan.remainingLessons)
    return '<p class="goal-message is-warning">По расписанию в этом периоде уроков больше нет.</p>';
  return `<p class="goal-message is-warning">Даже отметки 10 на каждом из ${plan.remainingLessons} оставшихся уроков дадут средний балл ${average(plan.bestAverage)}. По среднему эта цель пока недостижима.</p>`;
}

function getGradeTone(value) {
  const grade = Number(value);
  if (!Number.isInteger(grade) || grade < 1 || grade > 10) return "neutral";
  if (grade <= 3) return "low";
  if (grade <= 6) return "middle";
  return "high";
}

function getLessonWord(value) {
  const tens = value % 100;
  const ones = value % 10;
  if (tens >= 11 && tens <= 14) return "уроков";
  if (ones === 1) return "урок";
  if (ones >= 2 && ones <= 4) return "урока";
  return "уроков";
}

export {
  getGradeTone,
  renderAchievementTable,
  renderGradeGoalResult,
  renderSubjectDetails,
};
