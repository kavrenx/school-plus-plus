import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptESchoolsSnapshot,
  normalizeTime,
  toIsoDate,
} from "../js/e-schools-adapter.js";

const at = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const record = (url, body) => ({
  url,
  method: "GET",
  status: 200,
  body,
});

test("e-schools adapter builds the student diary from captured API responses", () => {
  const root =
    "/api/v1/education/diary/schools/school-1/classes/class-8b/students/external-student";
  const snapshot = {
    source: "e-schools.by",
    capturedAt: "2026-09-17T10:00:00.000Z",
    pages: {
      diary: {
        profile: { label: "Иванов Иван" },
        classTeacher: "Воронкова Ирина Викторовна",
        headings: [
          "Электронный дневник обучающегося 8 «Б» класса, Споняков Т.А.",
        ],
      },
    },
    network: {
      year: record("/api/v1/education/diary/school_year", {
        uuid: "year-1",
        label: "2026/2027",
        start_ts: at("2026-09-01"),
        end_ts: at("2027-08-31"),
      }),
      activities: record("/api/v1/education/diary/time_activities", [
        {
          uuid: "term-1",
          title: "1 четверть",
          type: "quarter",
          start_date: at("2026-09-01"),
          end_date: at("2026-10-30"),
        },
        {
          uuid: "autumn",
          title: "AUTUMN_HOLIDAYS",
          type: "holiday",
          start_date: at("2026-10-31"),
          end_date: at("2026-11-08"),
        },
      ]),
      classes: record(
        "/api/v1/education/diary/schools/school-1/students/external-student/classes",
        [{ uuid: "class-8b", school: "school-1", label: '8 "Б"' }],
      ),
      subjects: record(
        "/api/v1/education/diary/schools/school-1/students/external-student/classes/class-8b/subjects",
        [
          {
            id: "math",
            subject_title: "Математика",
            teacher: "Петрова Анна Ивановна",
            teacher_id: "teacher-1",
            level_of_study: "Углублённый",
          },
        ],
      ),
      planning: record(
        "/api/v1/education/planning/classes/class-8b/educational_subjects",
        [
          {
            uuid: "math",
            school_subject: {
              as_json: { subject: { as_json: { value: "Математика" } } },
            },
            templates: [
              {
                uuid: "math-template",
                teacher: {
                  id: "teacher-1",
                  surname: "Петрова",
                  name: "Анна",
                  patronymic: "Ивановна",
                },
                study_group: { uuid: null, name: null },
              },
            ],
          },
        ],
      ),
      bells: record("/api/v1/education/diary/schools/school-1/bells/whole", [
        {
          uuid: "shift-1",
          shift: 1,
          title: "1 смена",
          days_of_week: [
            {
              uuid: "weekdays",
              days: [1, 2, 3, 4, 5],
              time_of_bells: [
                {
                  number: 1,
                  start_time: "08:00:00",
                  end_time: "08:45:00",
                },
              ],
            },
          ],
        },
      ]),
      timetable: record(
        "/api/v1/education/diary/schools/school-1/classes/class-8b/timetables/whole",
        [
          {
            days_of_week: [
              {
                day_of_week: 4,
                timetable_slots: [
                  {
                    time_of_bells: {
                      number: 1,
                      start_time: "08:00:00",
                      end_time: "08:45:00",
                    },
                    slots: [
                      {
                        number: 1,
                        lesson_template_id: "math-template",
                        room_id: "room-1",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      ),
      rooms: record("/api/v1/institution/schools/school-1/premises", [
        { uuid: "room-1", audience_number: "74" },
      ]),
      lessons: record(`${root}/lessons?week_activity_uuid=week-1`, [
        {
          date: at("2026-09-17"),
          day_of_week: 4,
          slots: [
            {
              lesson_uuid: "lesson-1",
              lesson_template_id: "math-template",
              number: 1,
              start_time: "08:00:00",
              subject_title: "Математика",
              teacher_id: "teacher-1",
              homework: "№ 10",
              lesson_mark: { mark: "8/9" },
            },
          ],
        },
      ]),
    },
  };

  const adapted = adaptESchoolsSnapshot(snapshot);

  assert.equal(adapted.school.school.academicYear.title, "2026/2027");
  assert.equal(adapted.school.school.academicYear.terms[0].id, "term-1");
  assert.equal(adapted.school.school.academicYear.breaks[0].id, "autumn");
  assert.equal(adapted.school.users[0].firstName, "Т.А.");
  assert.equal(adapted.school.users[0].lastName, "Споняков");
  assert.equal(adapted.school.users[0].className, "8 «Б»");
  assert.equal(adapted.school.users[0].teacher, "Воронкова Ирина Викторовна");
  assert.equal(
    adapted.school.school.academicYear.breaks[0].title,
    "Осенние каникулы",
  );
  assert.equal(adapted.school.schedule.subjects[0].title, "Математика");
  assert.equal(adapted.school.schedule.bellSchedules[0].title, "1 смена");
  assert.equal(
    adapted.school.schedule.bellSchedules[0].variants[0].lessons[0].startsAt,
    "08:00",
  );
  assert.equal(adapted.school.schedule.lessonSchedule[0].lessons[0].room, "74");
  const currentWeek = adapted.diary.weeks.find(
    (week) => week.start === "2026-09-14",
  );
  assert.ok(currentWeek);
  assert.deepEqual(currentWeek.days.thursday[0], {
    id: "lesson-1",
    templateId: "math-template",
    classId: "class-8b",
    groupId: "",
    number: 1,
    subject: "Математика",
    time: "08:00–08:45",
    room: "74",
    homework: "№ 10",
    grade: "8/9",
    status: "scheduled",
  });
  assert.deepEqual(adapted.journalEntries[0].grades, ["8", "9"]);
  assert.equal(adapted.journalEntries[0].lessonId, "lesson-1");
  assert.ok(adapted.diary.weeks.length > 1);
  assert.ok(
    adapted.diary.weeks.some(
      (week) => week.start !== "2026-09-14" && week.days.thursday?.length === 1,
    ),
  );
});

test("e-schools adapter accepts seconds, milliseconds and ISO dates", () => {
  assert.equal(toIsoDate(at("2026-09-17")), "2026-09-17");
  assert.equal(toIsoDate(Date.parse("2026-09-17T00:00:00Z")), "2026-09-17");
  assert.equal(toIsoDate("2026-09-17"), "2026-09-17");
  assert.equal(toIsoDate(null), "");
  assert.equal(normalizeTime("09:00:00"), "09:00");
  assert.equal(normalizeTime("9:05"), "09:05");
});
