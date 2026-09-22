import { escapeHtml as e } from "./ui-utils.js";
import { getStudentSubjects } from "./achievement-model.js";
import { shortAcademicYear } from "./academic-navigation.js";
import { parseIsoDateParts } from "./date-tools.js";
import { shortSubjectName } from "./subject-names.js";

const TABS = [
  ["bells", "Расписание звонков"],
  ["holidays", "Расписание каникул"],
  ["lessons", "Расписание уроков"],
  ["subjects", "Список всех предметов"],
];
function holidayDuration(startsOn, endsOn) {
  const start = parseIsoDateParts(startsOn);
  const end = parseIsoDateParts(endsOn);
  if (!start || !end || startsOn > endsOn) return null;
  return (
    Math.round(
      (Date.UTC(end.year, end.month - 1, end.day) -
        Date.UTC(start.year, start.month - 1, start.day)) /
        86400000,
    ) + 1
  );
}
function orderBellSchedules(shifts = [], preferredShiftId) {
  return [...shifts].sort(
    (a, b) =>
      Number(b.id === preferredShiftId) - Number(a.id === preferredShiftId) ||
      (a.order || 0) - (b.order || 0),
  );
}
function table(headers, rows, { className = "", columns = [] } = {}) {
  return `<div class="schedule-table-scroll"><table class="schedule-table ${e(className)}">${columns.length ? `<colgroup>${columns.map((name) => `<col class="${e(name)}">`).join("")}</colgroup>` : ""}<thead><tr>${headers.map((title) => `<th scope="col">${e(title)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}" class="schedule-empty">—</td></tr>`}</tbody></table></div>`;
}
const cell = (value) =>
  `<td>${e(value === null || value === undefined || value === "" ? "—" : value)}</td>`;
function renderBells(schedule) {
  const shifts = orderBellSchedules(
    schedule.bellSchedules,
    schedule.preferredShiftId,
  );
  return shifts.length
    ? `<div class="schedule-card-grid is-bells">${shifts
        .map((shift) => {
          const variants = shift.variants || [];
          return `<article class="schedule-card"><h3>${e(shift.title || "—")}</h3>${
            variants
              .map(
                (variant) =>
                  `<section><h4>${e(variant.title || "—")}</h4>${table(
                    ["Урок", "Начало", "Конец"],
                    (variant.lessons || []).map(
                      (lesson) =>
                        `<tr>${cell(lesson.number ?? "—")}${cell(lesson.startsAt)}${cell(lesson.endsAt)}</tr>`,
                    ),
                  )}</section>`,
              )
              .join("") || table(["Урок", "Начало", "Конец"], [])
          }</article>`;
        })
        .join("")}</div>`
    : table(["Урок", "Начало", "Конец"], []);
}
function renderHolidays(schedule, year, dateTools) {
  const compactYear = shortAcademicYear(year.title).replace("/", "-");
  return `<h2>Расписание каникул ${e(compactYear)}</h2>${table(
    ["Каникулы", "С — по", "Продолжительность"],
    (schedule.holidays || []).map((holiday) => {
      const duration = holidayDuration(holiday.startsOn, holiday.endsOn);
      return `<tr><td><strong>${e(holiday.title)}</strong>${holiday.applicability ? `<p>${e(holiday.applicability)}</p>` : ""}</td><td class="schedule-holiday-dates">${duration === null ? "—" : `${e(compactDate(dateTools.formatIsoDateLong(holiday.startsOn)))} — ${e(compactDate(dateTools.formatIsoDateLong(holiday.endsOn)))}`}</td><td>${duration === null ? "—" : `${duration} ${duration % 10 === 1 && duration % 100 !== 11 ? "день" : [2, 3, 4].includes(duration % 10) && ![12, 13, 14].includes(duration % 100) ? "дня" : "дней"}`}</td></tr>`;
    }),
    {
      className: "schedule-holidays-table",
      columns: ["holiday-name-col", "holiday-date-col", "holiday-duration-col"],
    },
  )}`;
}
function renderLessons(schedule, user) {
  const days = (schedule.lessonSchedule || []).filter(
    (day) =>
      day.id !== "saturday" &&
      (!day.classId || day.classId === user.classId),
  );
  return `<div class="schedule-card-grid">${
    days.length
      ? days
          .map(
            (day) =>
              `<article class="schedule-card"><h3>${e(day.title)}</h3>${table(
                ["Время", "Предмет", "Каб."],
                (day.lessons || []).map(
                  (lesson) =>
                    `<tr><td class="schedule-time-cell">${e(lesson.time || "—")}</td><td><strong>${e(shortSubjectName(lesson.subject) || "—")}</strong>${(lesson.groups || [{ teacher: lesson.teacher, room: lesson.room }]).map((group) => `<p>${e(group.teacher || "—")}</p>`).join("")}</td><td class="schedule-room-cell">${(lesson.groups || [{ room: lesson.room }]).map((group) => `<p>${e(group.room || "")}</p>`).join("")}</td></tr>`,
                ),
                {
                  className: "schedule-lessons-table",
                  columns: ["lesson-time-col", "lesson-subject-col", "lesson-room-col"],
                },
              )}</article>`,
          )
          .join("")
      : table(["Время", "Предмет", "Каб."], [])
  }</div>`;
}
function renderSubjects(model, user) {
  const explicit = model.school.schedule.subjects;
  const subjects = Array.isArray(explicit)
    ? explicit.filter((item) => !item.classId || item.classId === user.classId)
    : getStudentSubjects(model, user.id || user.userId).map((assignment) => ({
        title: shortSubjectName(assignment.title),
        teachers: [
          {
            name:
              model.school.usersById[assignment.teacherId]?.displayName || "—",
            level: "",
          },
        ],
      }));
  return table(
    ["Предмет", "Преподаватели", "Уровень"],
    subjects.map(
      (subject) =>
        `<tr><td><strong>${e(shortSubjectName(subject.title))}</strong></td><td>${(subject.teachers || []).map((teacher) => `<p>${e(cleanGroupLabel(teacher.group))}${cleanGroupLabel(teacher.group) ? " · " : ""}${e(teacher.name || "—")}</p>`).join("") || "—"}</td><td>${(subject.teachers || []).map((teacher) => `<p>${e(teacher.level || subject.level || "—")}</p>`).join("") || e(subject.level || "—")}</td></tr>`,
    ),
    {
      className: "schedule-subjects-table",
      columns: ["subjects-name-col", "subjects-teacher-col", "subjects-level-col"],
    },
  );
}
function renderStudentSchedule(model, user, active, dateTools) {
  const schedule = model.school.schedule || {};
  const heading =
    active === "holidays"
      ? ""
      : `<h2>${e(TABS.find(([id]) => id === active)?.[1] || "Расписание")}</h2>`;
  return `<nav class="schedule-tabs" aria-label="Виды расписания">${TABS.map(([id, label]) => `<button type="button" data-schedule-tab="${id}" aria-pressed="${id === active}">${label}</button>`).join("")}</nav><section class="schedule-content">${heading}${active === "bells" ? renderBells(schedule) : active === "holidays" ? renderHolidays(schedule, model.school.academicYear, dateTools) : active === "lessons" ? renderLessons(schedule, user) : renderSubjects(model, user)}</section>`;
}

function compactDate(value) {
  return String(value).replace(/\s+\d{4}\s*$/, "");
}

function cleanGroupLabel(value) {
  return String(value || "")
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .trim();
}
export { renderStudentSchedule, holidayDuration, orderBellSchedules };
