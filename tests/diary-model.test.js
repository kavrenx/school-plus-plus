import assert from "node:assert/strict";
import test from "node:test";
import { getLessonDate, normalizeDiaryData } from "../js/diary-model.js";

test("creates lesson dates across month and year boundaries", () => {
  assert.equal(
    getLessonDate("2026-12-28", "friday", [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
    ]),
    "2027-01-01",
  );
});

test("normalizes lessons and resolves subject aliases", () => {
  const model = normalizeDiaryData(
    {
      schemaVersion: 2,
      weeks: [
        {
          id: "week-demo",
          start: "2026-09-07",
          end: "2026-09-13",
          classId: "class-7b",
          subjectGroups: { english: "english-1" },
          days: {
            monday: [
              {
                number: 1,
                subject: "Англ. яз.",
                time: "09:00–09:45",
                room: "12",
                homework: "Unit 1",
                grade: "",
              },
            ],
          },
        },
      ],
    },
    ["monday"],
    {
      subjects: [
        { id: "english", title: "Английский язык", aliases: ["Англ. яз."] },
      ],
    },
  );

  assert.equal(model.lessons.length, 1);
  assert.equal(model.lessons[0].subjectId, "english");
  assert.equal(model.lessons[0].startsAt, "09:00");
  assert.equal(model.lessons[0].endsAt, "09:45");
  assert.equal(model.lessons[0].id, "week-demo_monday_1");
  assert.equal(model.lessons[0].date, "2026-09-07");
  assert.equal(model.lessons[0].status, "scheduled");
  assert.equal(model.lessonTemplates.length, 1);
  assert.equal(model.lessonTemplates[0].id, model.lessons[0].templateId);
  assert.equal(model.lessons[0].classId, "class-7b");
  assert.equal(model.lessons[0].groupId, "english-1");
});

test("reuses a schedule template for dated lessons in different weeks", () => {
  const createWeek = (start, end) => ({
    start,
    end,
    classId: "class-7b",
    days: {
      monday: [
        {
          number: 1,
          subject: "Математика",
          time: "09:00–09:45",
          room: "20",
        },
      ],
    },
  });
  const model = normalizeDiaryData(
    {
      meta: { schoolId: "school-1" },
      weeks: [
        createWeek("2026-09-07", "2026-09-13"),
        createWeek("2026-09-14", "2026-09-20"),
      ],
    },
    ["monday"],
    {
      school: {
        id: "school-1",
        name: "Школа",
        timezone: "Europe/Minsk",
        locale: "ru-BY",
        academicYear: {
          id: "year-2026-2027",
          title: "2026/2027",
          startsOn: "2026-09-01",
          endsOn: "2027-08-31",
          breaks: [],
        },
      },
      users: [
        {
          id: "student-1",
          role: "student",
          login: "student",
          firstName: "Имя",
          lastName: "Фамилия",
        },
      ],
      classes: [{ id: "class-7b", title: "7Б", studentIds: [] }],
      subjects: [{ id: "matematika", title: "Математика" }],
    },
  );

  assert.equal(model.schoolId, "school-1");
  assert.equal(model.school.academicYear.id, "year-2026-2027");
  assert.equal(model.school.academicYear.schoolId, "school-1");
  assert.equal(model.normalizedVersion, 4);
  assert.equal(model.meta.schoolYearId, "year-2026-2027");
  assert.equal(model.school.users[0].schoolId, "school-1");
  assert.equal(model.school.classes[0].schoolId, "school-1");
  assert.equal(model.lessonTemplates.length, 1);
  assert.equal(model.lessons.length, 2);
  assert.equal(model.lessons[0].templateId, model.lessons[1].templateId);
  assert.equal(model.lessons[0].schoolYearId, "year-2026-2027");
  assert.equal(model.lessonTemplates[0].schoolYearId, "year-2026-2027");
  assert.notEqual(model.lessons[0].id, model.lessons[1].id);
  assert.deepEqual(
    model.lessons.map((lesson) => lesson.date),
    ["2026-09-07", "2026-09-14"],
  );
});

test("returns lessons only for the assigned class and group", () => {
  const model = normalizeDiaryData(
    {
      weeks: [
        {
          start: "2026-09-07",
          end: "2026-09-13",
          days: {
            monday: [
              {
                subject: "Английский язык",
                time: "09:00–09:45",
                classId: "class-7b",
                groupId: "english-1",
              },
              {
                subject: "Английский язык",
                time: "10:00–10:45",
                classId: "class-7b",
                groupId: "english-2",
              },
            ],
          },
        },
      ],
    },
    ["monday"],
    {
      subjects: [{ id: "english", title: "Английский язык" }],
    },
  );

  const lessons = model.getLessonsForAssignment({
    subjectId: "english",
    classId: "class-7b",
    groupId: "english-1",
  });

  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].groupId, "english-1");
});

test("returns only students assigned to a subject group", () => {
  const model = normalizeDiaryData({ weeks: [] }, ["monday"], {
    classes: [
      { id: "class-7b", title: "7Б", studentIds: ["student-1", "student-2"] },
    ],
    students: [
      {
        id: "student-1",
        firstName: "А",
        lastName: "Первый",
        groupIds: ["english-1"],
      },
      {
        id: "student-2",
        firstName: "Б",
        lastName: "Второй",
        groupIds: ["english-2"],
      },
    ],
    subjects: [{ id: "english", title: "Английский язык" }],
    groups: [
      {
        id: "english-1",
        classId: "class-7b",
        subjectId: "english",
        title: "1 группа",
      },
    ],
    teacherAssignments: [
      {
        id: "assignment-1",
        teacherId: "teacher-1",
        classId: "class-7b",
        subjectId: "english",
        groupId: "english-1",
      },
    ],
  });

  const [assignment] = model.getTeacherAssignments("teacher-1");
  const students = model.getStudentsForAssignment(assignment);

  assert.equal(assignment.groupTitle, "1 группа");
  assert.equal(students.length, 1);
  assert.equal(students[0].id, "student-1");
});

test("distinguishes lessons, empty days, weekends, holidays and missing data", () => {
  const model = normalizeDiaryData(
    {
      weeks: [
        {
          start: "2026-09-07",
          end: "2026-09-13",
          days: {
            monday: [{ subject: "Математика", time: "09:00–09:45" }],
            tuesday: [],
            thursday: [],
            saturday: [],
            sunday: [],
          },
          dayInfo: {
            thursday: {
              type: "holiday",
              title: "День школы",
              description: "Сегодня отдыхаем.",
            },
          },
        },
      ],
    },
    ["monday", "tuesday", "wednesday", "thursday", "saturday", "sunday"],
  );

  const states = model.weeks[0].dayStates;
  assert.equal(states.monday.type, "lessons");
  assert.equal(states.tuesday.type, "empty");
  assert.equal(states.wednesday.type, "missing");
  assert.deepEqual(states.thursday, {
    type: "holiday",
    title: "День школы",
    description: "Сегодня отдыхаем.",
  });
  assert.equal(states.saturday.type, "weekend");
  assert.equal(states.sunday.type, "weekend");
});

test("normalizes academic terms and finds the term for a lesson date", () => {
  const model = normalizeDiaryData({ weeks: [] }, ["monday"], {
    school: {
      academicYear: {
        id: "year-1",
        title: "2026/2027",
        startsOn: "2026-09-01",
        endsOn: "2027-08-31",
        terms: [
          {
            id: "term-1",
            title: "1 четверть",
            startsOn: "2026-09-01",
            endsOn: "2026-10-30",
          },
        ],
      },
    },
  });

  assert.equal(model.school.academicYear.terms.length, 1);
  assert.equal(model.school.academicYear.terms[0].academicYearId, "year-1");
  assert.equal(model.getTermForDate("2026-09-12")?.id, "term-1");
  assert.equal(model.getTermForDate("2026-11-01"), null);
});

test("projects assigned lesson templates across a selected term", () => {
  const model = normalizeDiaryData({ weeks: [] }, ["monday"], {
    school: {
      academicYear: {
        id: "year-1",
        title: "2026/2027",
        startsOn: "2026-09-01",
        endsOn: "2027-08-31",
        terms: [
          {
            id: "term-1",
            title: "1 четверть",
            startsOn: "2026-09-01",
            endsOn: "2026-09-14",
          },
        ],
      },
    },
    subjects: [{ id: "math", title: "Математика" }],
    lessonTemplates: [
      {
        id: "math-monday",
        classId: "class-7b",
        subjectId: "math",
        teacherId: "teacher-1",
        weekday: "monday",
        number: 1,
        startsAt: "09:00",
        endsAt: "09:45",
        room: "20",
      },
      {
        id: "math-wednesday",
        classId: "class-7b",
        subjectId: "math",
        teacherId: "teacher-1",
        weekday: "wednesday",
        number: 2,
        startsAt: "10:00",
        endsAt: "10:45",
        room: "20",
      },
    ],
  });

  const lessons = model.getLessonsForAssignmentTerm(
    { classId: "class-7b", subjectId: "math" },
    "term-1",
  );

  assert.deepEqual(
    lessons.map((item) => item.date),
    ["2026-09-02", "2026-09-07", "2026-09-09", "2026-09-14"],
  );
  assert.equal(lessons[0].subject, "Математика");
  assert.equal(lessons[0].termId, "term-1");
});
