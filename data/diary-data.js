import { SCHOOL_DATA } from "./school-data.js";
import { addIsoDays, parseIsoDateParts } from "../js/date-tools.js";

const SUBJECT_HOMEWORK = {
  "Англ. яз.": "упр. 6, слова к уроку",
  Биология: "§ 28, вопросы 1–3",
  "Бел. лит.": "прочитать произведение",
  "Бел. яз.": "упр. 214",
  География: "§ 41, отметить объекты на карте",
  "Ист. Бел.": "§ 24, даты в тетрадь",
  "Всемир. ист.": "§ 26, вопросы после параграфа",
  Искусство: "эскиз плаката",
  "Информ.": "повторить конспект",
  "Матем.": "№ 312, 314 и 318",
  "Рус. лит.": "прочитать следующую главу",
  "Рус. яз.": "упр. 407",
  Физика: "§ 52, задача 4",
  Химия: "§ 35, упр. 2–4",
};

const WEEK_SCHEDULE = {
  monday: [
    createLesson(1, "Биология", "14:00–14:45", "65"),
    createLesson(2, "Искусство", "15:00–15:45", "59"),
    createLesson(3, "Физика", "16:00–16:45", "79"),
    createLesson(4, "Всемир. ист.", "16:55–17:40", "43"),
    createLesson(5, "Матем.", "17:50–18:35", "73"),
    createLesson(6, "Англ. яз.", "18:45–19:30", "85"),
  ],
  tuesday: [
    createLesson(1, "География", "14:00–14:45", "86"),
    createLesson(2, "Химия", "15:00–15:45", "38"),
    createLesson(3, "Англ. яз.", "16:00–16:45", "85"),
    createLesson(4, "Матем.", "16:55–17:40", "73"),
    createLesson(5, "Бел. яз.", "17:50–18:35", "42"),
    createLesson(6, "Физ. к. и зд.", "18:45–19:30", "—"),
  ],
  wednesday: [
    createLesson(0, "Бел. яз.", "13:05–13:50", "67"),
    createLesson(1, "Бел. лит.", "14:00–14:45", "67"),
    createLesson(2, "Англ. яз.", "15:00–15:45", "85"),
    createLesson(3, "Информ.", "16:00–16:45", "44"),
    createLesson(4, "Матем.", "16:55–17:40", "73"),
    createLesson(5, "Труд. обуч.", "17:50–18:35", "15"),
    createLesson(6, "Ист. Бел.", "18:45–19:30", "43"),
  ],
  thursday: [
    createLesson(1, "Физика", "14:00–14:45", "79"),
    createLesson(2, "Англ. яз.", "15:00–15:45", "85"),
    createLesson(3, "Биология", "16:00–16:45", "36"),
    createLesson(4, "Физ. к. и зд.", "16:55–17:40", "—"),
    createLesson(5, "Матем.", "17:50–18:35", "73"),
    createLesson(6, "Рус. яз.", "18:45–19:30", "70"),
  ],
  friday: [
    createLesson(0, "Кл. час", "13:05–13:50", "28"),
    createLesson(1, "Физ. к. и зд.", "14:00–14:45", "—"),
    createLesson(2, "Рус. яз.", "15:00–15:45", "36"),
    createLesson(3, "Рус. лит.", "16:00–16:45", "70"),
    createLesson(4, "Англ. яз.", "16:55–17:40", "85"),
    createLesson(5, "Бел. лит.", "17:50–18:35", "42"),
    createLesson(6, "Матем.", "18:45–19:30", "73"),
  ],
  saturday: [],
  sunday: [],
};

const DAY_KEYS = Object.keys(WEEK_SCHEDULE);

export const SCHOOL_DIARY = {
  schemaVersion: 2,
  meta: {
    schoolId: "school_demo",
    schoolYear: SCHOOL_DATA.school.academicYear.title,
    locale: "ru-BY",
    timezone: "Europe/Minsk",
    classId: "class_7b",
    subjectGroups: {
      english: "class_7b_english_1",
      informatics: "class_7b_informatics_1",
      labor: "class_7b_labor_1",
    },
  },
  weeks: createDiaryWeeks(SCHOOL_DATA.school.academicYear.terms),
};

function createLesson(number, subject, time, room) {
  return {
    number,
    subject,
    time,
    room,
    homework: SUBJECT_HOMEWORK[subject] || "нет дз",
    grade: "",
  };
}

function createDiaryWeeks(terms = []) {
  return terms.flatMap((term) => {
    const parts = parseIsoDateParts(term.startsOn);
    if (!parts || !parseIsoDateParts(term.endsOn) || term.startsOn > term.endsOn) {
      return [];
    }
    const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
    const firstMonday = addIsoDays(term.startsOn, -((weekday + 6) % 7));
    const weeks = [];
    for (
      let weekStart = firstMonday;
      weekStart <= term.endsOn;
      weekStart = addIsoDays(weekStart, 7)
    ) {
      const { days, dayInfo } = createWeekSchedule(weekStart, term);
      weeks.push({
        id: `week_${weekStart}`,
        termId: term.id,
        start: weekStart,
        end: addIsoDays(weekStart, 6),
        days,
        dayInfo,
      });
    }
    return weeks;
  });
}

function createWeekSchedule(weekStart, term) {
  const days = {};
  const dayInfo = {};

  DAY_KEYS.forEach((dayKey, dayIndex) => {
    const date = addIsoDays(weekStart, dayIndex);
    const isWeekday = dayIndex < 5;
    const isInsideTerm = term.startsOn <= date && date <= term.endsOn;
    days[dayKey] = isInsideTerm
      ? WEEK_SCHEDULE[dayKey].map((lesson) => ({ ...lesson }))
      : [];
    if (isWeekday && !isInsideTerm) {
      dayInfo[dayKey] = {
        type: "holiday",
        title: "Каникулы",
        description: "Занятий по расписанию нет.",
      };
    }
  });

  return { days, dayInfo };
}

export { createDiaryWeeks };
