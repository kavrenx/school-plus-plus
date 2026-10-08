import { escapeHtml as e } from "./ui-utils.js";
import { formatGradeAverage as average } from "./teacher-journal-model.js";
import {
  getResultDisplayColumns,
  getEffectiveResultColumn,
  getDisplayFinalAverage,
  getResultCell,
} from "./result-periods.js";
import { shortSubjectName } from "./subject-names.js";
import { getSubjectAnalytics } from "./subject-analytics.js";

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
    <div class="achievement-scroll" tabindex="0" role="region" aria-label="Отметки за четверти, полугодия и год. Таблицу можно прокручивать горизонтально.">
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

function renderSubjectDetails(result, period, dateTools, state = {}) {
  if (!period) return "";
  const gradeTiles = period.records
    .map(({ lesson, entry }) => {
      const grades = (entry.grades || []).filter(
        (grade) => getGradeTone(grade) !== "neutral" || String(grade).trim(),
      );
      if (!grades.length) return "";
      const display = grades.join("/");
      return `<li class="subject-grade-tile grade-tone-${getGradeTone(display)}"><button type="button" data-subject-date="${e(lesson.date)}" aria-label="${e(display)}, ${e(dateTools.formatIsoDateLong(lesson.date))}. Открыть день"><time datetime="${e(lesson.date)}">${e(formatShortDate(lesson.date))}</time><strong>${e(display)}</strong></button></li>`;
    })
    .filter(Boolean)
    .join("");
  const lessonsLeft = (period.remainingLessons || []).length;
  const passFail =
    result.assignment.gradingScale === "pass-fail" ||
    shortSubjectName(result.assignment.title) === "Искусство";
  const analytics = getSubjectAnalytics(period.records);
  const activeTab = state.tab || "calculation";
  const periodChoices = state.periodChoices || [];
  const gradeHistory = `<section class="subject-grade-history" aria-labelledby="subjectGradesTitle">
    <div class="subject-grade-heading"><h3 id="subjectGradesTitle">Все отметки</h3>${passFail ? "" : '<ul aria-label="Цветовые диапазоны"><li class="grade-tone-low">1–3</li><li class="grade-tone-middle">4–6</li><li class="grade-tone-high">7–10</li></ul>'}</div>
    ${gradeTiles ? `<ol class="subject-grade-grid">${gradeTiles}</ol>` : '<p class="achievement-empty">Отметок за этот период пока нет.</p>'}</section>`;
  return `<button class="subject-detail-backdrop${state.animate === false ? " is-static" : ""}" type="button" data-achievement-back aria-label="Закрыть отметки по предмету"></button>
    <aside class="subject-detail-drawer${state.animate === false ? " is-static" : ""}" role="dialog" aria-modal="true" aria-labelledby="subjectDetailTitle">
      <button class="subject-detail-close" type="button" data-achievement-back aria-label="Закрыть">×</button>
      <h2 id="subjectDetailTitle" tabindex="-1" data-subject-detail-heading>${e(shortSubjectName(result.assignment.title))} <span>•</span> ${e(period.title)}</h2>
      ${periodChoices.length ? `<label class="subject-period-picker">Период<select data-subject-period>${periodChoices.map((choice) => `<option value="${e(choice.id)}"${choice.id === state.termId ? " selected" : ""}>${e(choice.title)}</option>`).join("")}</select></label>` : ""}
      ${state.periodStatus ? `<p class="achievement-note">${e(state.periodStatus)}</p>` : ""}
      ${
        passFail
          ? ""
          : `<div class="subject-detail-tabs" role="tablist" aria-label="О предмете"><button type="button" id="subjectCalculationTab" role="tab" data-subject-tab="calculation" aria-selected="${activeTab === "calculation"}" aria-controls="subjectCalculationPanel" tabindex="${activeTab === "calculation" ? 0 : -1}">Расчёт</button><button type="button" id="subjectStatisticsTab" role="tab" data-subject-tab="statistics" aria-selected="${activeTab === "statistics"}" aria-controls="subjectStatisticsPanel" tabindex="${activeTab === "statistics" ? 0 : -1}">Статистика</button></div>
      <section id="subjectStatisticsPanel" role="tabpanel" aria-labelledby="subjectStatisticsTab"${activeTab === "statistics" ? "" : " hidden"}>
        <dl class="subject-summary"><div><dt>Отметок</dt><dd>${analytics.count}</dd></div><div><dt>Средний балл</dt><dd>${formatAnalyticsAverage(analytics.average)}</dd></div></dl>
        ${state.coverageNotice ? `<p class="achievement-note">${e(state.coverageNotice)}</p>` : ""}
        ${renderAverageChart(analytics, dateTools)}
        ${analytics.count ? `<section class="subject-distribution"><h3>Какие отметки получены</h3><div class="subject-distribution-bars">${analytics.distribution.map((item) => `<div aria-label="Отметка ${item.grade}, количество ${item.count}"><span>${item.count || ""}</span><i style="--bar-height:${(item.count / Math.max(...analytics.distribution.map((value) => value.count), 1)) * 100}%"></i><strong>${item.grade}</strong></div>`).join("")}</div></section>` : ""}
      </section>
      <section id="subjectCalculationPanel" role="tabpanel" aria-labelledby="subjectCalculationTab"${activeTab === "calculation" ? "" : " hidden"}>
      <section class="subject-average-card" aria-label="Средний балл"><span>Средний балл</span><strong>${formatAnalyticsAverage(analytics.average)}</strong></section>
      ${gradeHistory}
      <section class="grade-goal-card" aria-labelledby="gradeGoalTitle">
        <h3 id="gradeGoalTitle">Цель</h3>
        <p>До конца ${period.column?.type === "half" ? "полугодия" : "четверти"}: ${lessonsLeft} ${getLessonWord(lessonsLeft)}.</p>
        <form data-grade-goal-form>
          <label>Желаемый балл<input data-grade-goal type="number" min="1" max="10" step="1" inputmode="numeric" value="${e(state.target ?? 9)}" required></label>
          <button type="submit">Рассчитать</button>
        </form>
        <div class="grade-goal-result" data-grade-goal-result aria-live="polite">${state.goalHtml || ""}</div>
        <small>Один урок не гарантирует одну отметку. Для вариантов предполагаем не больше одной новой отметки за урок. Итоговую отметку выставляет учитель.</small>
      </section>
      <section class="grade-goal-card grade-sandbox"><h3>Попробовать свои отметки</h3><p>Посмотри, как они изменят средний. Данные дневника останутся прежними.</p><div class="grade-sandbox-controls"><label>Отметка<select data-trial-grade>${Array.from({ length: 10 }, (_, index) => `<option value="${index + 1}"${index === 8 ? " selected" : ""}>${index + 1}</option>`).join("")}</select></label><button type="button" data-trial-add>Добавить</button></div><div data-trial-grades>${state.trialHtml || ""}</div><div data-trial-result aria-live="polite">${state.projectionHtml || ""}</div><button type="button" data-trial-clear>Сбросить примерку</button></section>
      </section>`
      }
      ${passFail ? gradeHistory : ""}
    </aside>`;
}

function renderAverageChart(analytics, dateTools) {
  if (!analytics.points.length)
    return '<p class="achievement-empty">График появится после первых отметок.</p>';
  const width = 440;
  const left = 30;
  const right = 425;
  const minDate = Date.parse(analytics.points[0].date);
  const dateRange = Date.parse(analytics.points.at(-1).date) - minDate;
  const x = (point) =>
    dateRange
      ? left + ((Date.parse(point.date) - minDate) / dateRange) * (right - left)
      : (left + right) / 2;
  const y = (value) => 160 - ((value - 1) / 9) * 140;
  return `<section class="subject-chart"><h3>Как менялся средний</h3><p class="achievement-note">По датам уроков. Наведи на точку или выбери её клавишей Tab.</p><svg viewBox="0 0 ${width} 195" role="img" aria-label="График среднего балла от ${average(analytics.points[0].average)} до ${average(analytics.average)}"><g class="subject-chart-grid">${[1, 4, 7, 10].map((value) => `<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}"/><text x="3" y="${y(value) + 4}">${value}</text>`).join("")}</g><polyline class="subject-chart-line" points="${analytics.points.map((point) => `${x(point)},${y(point.average)}`).join(" ")}"/>${analytics.points.map((point) => `<circle class="subject-chart-point" tabindex="0" cx="${x(point)}" cy="${y(point.average)}" r="5" data-chart-date="${e(dateTools.formatIsoDateLong(point.date))}" data-chart-grades="${point.grades.join("/")}" data-chart-average="${formatAnalyticsAverage(point.average)}" aria-label="${e(dateTools.formatIsoDateLong(point.date))}: ${point.grades.join("/")}, средний ${formatAnalyticsAverage(point.average)}"/>`).join("")}<text x="${left}" y="185">${e(formatShortDate(analytics.points[0].date))}</text><text x="${right}" y="185" text-anchor="end">${e(formatShortDate(analytics.points.at(-1).date))}</text></svg><div class="subject-chart-tooltip" role="tooltip" hidden><strong data-tooltip-date></strong><span data-tooltip-grades></span><span data-tooltip-average></span></div></section>`;
}

function renderGradeOptions(plan) {
  if (plan.status === "reached")
    return `<p class="goal-message is-success">Цель по среднему уже достигнута: ${formatAnalyticsAverage(plan.currentAverage)}.</p>`;
  if (plan.status === "impossible" && plan.remainingLessons)
    return `<p class="goal-message is-warning">Даже отметки 10 на каждом оставшемся уроке дадут средний ${formatAnalyticsAverage(plan.bestAverage)}. Для этой цели нужно не ниже ${formatAnalyticsAverage(plan.threshold)}.</p>`;
  if (plan.status !== "possible") return renderGradeGoalResult(plan);
  const card = (option, index) =>
    `<li><div class="grade-option-content"><span class="grade-option-label">${e(option.label)}</span><strong>${formatGradeCombination(option.grades)}</strong><span class="grade-option-summary">${option.count} ${getGradeWord(option.count)} · средний ${formatAnalyticsAverage(option.projectedAverage)}</span></div><button type="button" data-trial-option="${index}">Примерить</button></li>`;
  return `<ol class="grade-options">${card(plan.options[0], 0)}</ol>${
    plan.options.length > 1
      ? `<button class="grade-options-toggle" type="button" data-goal-more aria-expanded="false" aria-controls="gradeOptionsMore"><span>Показать больше</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button><div id="gradeOptionsMore" class="grade-options-more" aria-hidden="true" inert><div><ol class="grade-options">${plan.options
          .slice(1)
          .map((option, index) => card(option, index + 1))
          .join("")}</ol></div></div>`
      : ""
  }`;
}

function formatAnalyticsAverage(value) {
  return Number.isFinite(value)
    ? value.toLocaleString("ru-RU", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 3,
      })
    : "—";
}

function formatGradeCombination(grades) {
  const counts = new Map();
  grades.forEach((grade) => counts.set(grade, (counts.get(grade) || 0) + 1));
  return [...counts]
    .map(([grade, count]) => `${grade}${count > 1 ? ` × ${count}` : ""}`)
    .join(" + ");
}

function getGradeWord(count) {
  if (count % 100 >= 11 && count % 100 <= 14) return "отметок";
  return count % 10 === 1
    ? "отметка"
    : count % 10 >= 2 && count % 10 <= 4
      ? "отметки"
      : "отметок";
}

function renderTrialGrades(grades) {
  return grades.length
    ? `<div class="trial-grade-list">${grades.map((grade, index) => `<button type="button" data-trial-remove="${index}" aria-label="Убрать предполагаемую отметку ${grade}">${grade}<span aria-hidden="true"> ×</span></button>`).join("")}</div>`
    : '<p class="achievement-note">Добавь отметки вручную или примерь готовый вариант выше.</p>';
}

function renderProjection(projection, available) {
  return `<p class="trial-projection">Средний: <strong>${formatAnalyticsAverage(projection.projectedAverage)}</strong> · округлённый: <strong>${projection.rounded ?? "—"}</strong></p>${projection.count > available ? '<p class="achievement-note">В примерке больше отметок, чем оставшихся уроков. Это только сценарий.</p>' : ""}`;
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
  const parts = String(value)
    .split("/")
    .map(Number)
    .filter((grade) => Number.isInteger(grade) && grade >= 1 && grade <= 10);
  if (!parts.length) return "neutral";
  const grade = parts.reduce((sum, item) => sum + item, 0) / parts.length;
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
  renderGradeOptions,
  renderTrialGrades,
  renderProjection,
};
