import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptESchoolsSnapshot,
  normalizeTime,
  toIsoDate,
} from "../js/e-schools-adapter.js";
import { normalizeDiaryData } from "../js/diary-model.js";
import { createJournalStore } from "../js/journal-store.js";
import {
  calculateGradeGoal,
  getStudentSubjects,
  getSubjectResult,
} from "../js/achievement-model.js";
import {
  getCurrentResultPeriod,
  getEffectiveResultColumn,
  getResultDisplayColumns,
} from "../js/result-periods.js";
import { renderSubjectDetails } from "../js/achievement-view.js";

const at = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const record = (url, body) => ({
  url,
  method: "GET",
  status: 200,
  body,
});

function halfYearSnapshot({ schedule = true, explicitPeriod = "" } = {}) {
  const root = "/api/v1/education/diary/schools/s/classes/c/students/u";
  return {
    source: "e-schools.by",
    network: {
      year: record("/api/v1/education/diary/school_year", {
        uuid: "y",
        label: "2026/2027",
        start_ts: at("2026-09-01"),
        end_ts: at("2027-08-31"),
      }),
      activities: record(
        "/api/v1/education/diary/time_activities",
        [
          ["q1", "2026-09-01", "2026-10-30"],
          ["q2", "2026-11-09", "2026-12-24"],
          ["q3", "2027-01-11", "2027-03-19"],
          ["q4", "2027-03-29", "2027-05-31"],
        ].map(([uuid, start, end], index) => ({
          uuid,
          title: `${index + 1} четверть`,
          type: "quarter",
          start_date: at(start),
          end_date: at(end),
        })),
      ),
      subjects: record(
        "/api/v1/education/diary/schools/s/students/u/classes/c/subjects",
        [
          {
            id: "literature",
            subject_title: "Русская литература",
            ...(explicitPeriod ? { assessment_period: explicitPeriod } : {}),
          },
          { id: "math", subject_title: "Математика" },
        ],
      ),
      planning: record(
        "/api/v1/education/planning/classes/c/educational_subjects",
        [
          ["literature", "Русская литература", 1],
          ["math", "Математика", 2],
        ].map(([uuid, title, hours]) => ({
          uuid,
          school_subject: { as_json: { short_name: title } },
          templates: [{ uuid: `${uuid}-template`, study_hours: hours }],
        })),
      ),
      ...(schedule
        ? {
            timetable: record(
              "/api/v1/education/diary/schools/s/classes/c/timetables/whole",
              [
                {
                  days_of_week: [
                    [1, "literature"],
                    [2, "math"],
                    [4, "math"],
                  ].map(([day, subject]) => ({
                    day_of_week: day,
                    timetable_slots: [
                      {
                        time_of_bells: {
                          number: 1,
                          start_time: "08:00",
                          end_time: "08:45",
                        },
                        slots: [
                          {
                            number: 1,
                            lesson_template_id: `${subject}-template`,
                          },
                        ],
                      },
                    ],
                  })),
                },
              ],
            ),
          }
        : {}),
      lessons: record(
        `${root}/lessons?week_activity_uuid=w`,
        ["2026-09-07", "2026-09-14"].map((date, index) => ({
          date: at(date),
          day_of_week: 1,
          slots: [
            {
              lesson_uuid: `literature-${index}`,
              lesson_template_id: "literature-template",
              number: 1,
              start_time: "08:00",
              subject_title: "Русская литература",
              lesson_marks: [{ mark: "6" }],
            },
          ],
        })),
      ),
    },
  };
}

test("existing snapshots classify once-weekly subjects as half-year and keep frequent subjects quarterly", () => {
  for (const schedule of [true, false]) {
    const adapted = adaptESchoolsSnapshot(halfYearSnapshot({ schedule }));
    const assignments = adapted.school.teacherAssignments;
    assert.equal(
      assignments.find((item) => item.subjectId === "literature")
        .assessmentPeriod,
      "half-year",
    );
    assert.equal(
      assignments.find((item) => item.subjectId === "math").assessmentPeriod,
      "quarter",
    );
  }
  const explicitQuarter = adaptESchoolsSnapshot(
    halfYearSnapshot({ explicitPeriod: "quarter" }),
  );
  assert.equal(
    explicitQuarter.school.teacherAssignments.find(
      (item) => item.subjectId === "literature",
    ).assessmentPeriod,
    "quarter",
  );
  const explicitHalf = halfYearSnapshot();
  explicitHalf.network.subjects.body[1].assessment_period = "half_year";
  assert.equal(
    adaptESchoolsSnapshot(explicitHalf).school.teacherAssignments.find(
      (item) => item.subjectId === "math",
    ).assessmentPeriod,
    "half-year",
  );
});

test("half-year subjects include next-quarter lessons in the grade goal and both quarters in the history", () => {
  const snapshot = halfYearSnapshot();
  const makeResult = () => {
    const adapted = adaptESchoolsSnapshot(snapshot);
    const model = normalizeDiaryData(
      adapted.diary,
      [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ],
      adapted.school,
    );
    const storage = new Map();
    const store = createJournalStore({
      getItem: (key) => storage.get(key),
      setItem: (key, value) => {
        storage.set(key, value);
        return true;
      },
    });
    adapted.journalEntries.forEach((entry) => store.saveJournalEntry(entry));
    const assignment = getStudentSubjects(model, "student_demo").find(
      (item) => item.subjectId === "literature",
    );
    return {
      year: model.school.academicYear,
      result: getSubjectResult(model, store, assignment, "student_demo"),
    };
  };
  const first = makeResult();
  const autumn = getCurrentResultPeriod(
    first.result,
    first.year,
    "q1",
    "2026-10-27",
  );
  assert.equal(autumn.title, "I полугодие");
  assert.equal(autumn.remainingLessons.length, 7);
  const details = renderSubjectDetails(first.result, autumn, {
    formatIsoDateLong: (date) => date,
  });
  assert.match(details, /I полугодие/);
  assert.match(details, /До конца полугодия по расписанию: 7 уроков/);
  assert.ok(
    autumn.remainingLessons.every(
      (lesson) => lesson.date >= "2026-11-09" && lesson.date <= "2026-12-24",
    ),
  );
  assert.equal(
    calculateGradeGoal(autumn.grades, 9, autumn.remainingLessons.length).status,
    "possible",
  );
  const display = getResultDisplayColumns(first.year);
  assert.equal(getEffectiveResultColumn(first.result, display[0]), null);
  assert.equal(getEffectiveResultColumn(first.result, display[1]).type, "half");

  snapshot.network.lessons.body.push({
    date: at("2026-11-09"),
    day_of_week: 1,
    slots: [
      {
        lesson_uuid: "literature-november",
        lesson_template_id: "literature-template",
        number: 1,
        start_time: "08:00",
        subject_title: "Русская литература",
        lesson_marks: [{ mark: "9" }],
      },
    ],
  });
  const second = makeResult();
  const november = getCurrentResultPeriod(
    second.result,
    second.year,
    "q2",
    "2026-11-10",
  );
  assert.deepEqual(november.grades, [6, 6, 9]);
  assert.equal(november.average, 7);
  assert.equal(november.remainingLessons.length, 6);
  const spring = getCurrentResultPeriod(
    second.result,
    second.year,
    "q3",
    "2027-01-12",
  );
  assert.equal(spring.title, "II полугодие");
  assert.deepEqual(spring.grades, []);
  assert.ok(
    spring.remainingLessons.some((lesson) => lesson.date >= "2027-03-29"),
  );
  assert.ok(
    spring.remainingLessons.every(
      (lesson) => lesson.date >= "2027-01-12" && lesson.date <= "2027-05-31",
    ),
  );
});

test("duplicate timetable versions do not turn a once-weekly subject into a quarterly subject", () => {
  const snapshot = halfYearSnapshot();
  snapshot.network.timetable.body.push(
    structuredClone(snapshot.network.timetable.body[0]),
  );
  const adapted = adaptESchoolsSnapshot(snapshot);
  assert.equal(
    adapted.school.teacherAssignments.find(
      (item) => item.subjectId === "literature",
    ).assessmentPeriod,
    "half-year",
  );
  const unknown = halfYearSnapshot({ schedule: false });
  unknown.network.planning.body[0].templates[0].study_hours = null;
  assert.equal(
    adaptESchoolsSnapshot(unknown).school.teacherAssignments.find(
      (item) => item.subjectId === "literature",
    ).assessmentPeriod,
    "quarter",
  );
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
        lessonMaterials: [
          {
            date: "2026-09-17",
            number: 1,
            startTime: "08:00",
            subject: "Математика",
            attachments: [
              {
                url: "https://objectsstore.e-schools.by/journal/file-id?X-Amz-Expires=10",
                title: "Памятка.docx",
                source: "e-schools",
                sourceDate: "2026-09-17",
                sourceLessonNumber: 1,
                sourceStartTime: "08:00",
                sourceSubject: "Математика",
              },
            ],
          },
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
            id: "math-source",
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
            uuid: "math-planning",
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
              {
                day_of_week: 1,
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
              attachments: [
                {
                  title: "Задание.pdf",
                  url: "/media/homework/task.pdf",
                },
              ],
              lesson_marks: [{ mark: "9" }, { mark: "9" }],
            },
            {
              lesson_uuid: "lesson-1",
              lesson_template_id: "math-template",
              number: 1,
              start_time: "08:00:00",
              subject_title: "Математика",
              teacher_id: "teacher-1",
              homework: "№ 10",
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
  assert.equal(adapted.school.subjects.length, 1);
  assert.equal(adapted.school.teacherAssignments[0].subjectId, "math-source");
  assert.ok(
    adapted.school.lessonTemplates.every(
      (template) => template.subjectId === "math-source",
    ),
  );
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
    materials: [
      {
        url: "https://diary.e-schools.by/media/homework/task.pdf",
        title: "Задание.pdf",
        id: "",
      },
      {
        url: "https://objectsstore.e-schools.by/journal/file-id?X-Amz-Expires=10",
        title: "Памятка.docx",
        id: "",
        source: "e-schools",
        sourceDate: "2026-09-17",
        sourceLessonNumber: 1,
        sourceStartTime: "08:00",
        sourceSubject: "Математика",
      },
    ],
    grade: "9/9",
    status: "scheduled",
  });
  assert.deepEqual(adapted.journalEntries[0].grades, ["9", "9"]);
  assert.equal(adapted.journalEntries[0].materials[0].title, "Задание.pdf");
  assert.equal(adapted.journalEntries.length, 1);
  assert.equal(adapted.journalEntries[0].lessonId, "lesson-1");
  assert.ok(adapted.diary.weeks.length > 1);
  assert.ok(
    adapted.diary.weeks.some(
      (week) => week.start !== "2026-09-14" && week.days.thursday?.length === 1,
    ),
  );
  const firstAcademicWeek = adapted.diary.weeks.find(
    (week) => week.start === "2026-08-31",
  );
  assert.ok(firstAcademicWeek);
  assert.equal(firstAcademicWeek.days.monday.length, 0);
  const holidayWeek = adapted.diary.weeks.find(
    (week) => week.start === "2026-11-02",
  );
  assert.equal(
    holidayWeek
      ? Object.values(holidayWeek.days).some((lessons) => lessons.length > 0)
      : false,
    false,
  );
});

test("e-schools adapter accepts seconds, milliseconds and ISO dates", () => {
  assert.equal(toIsoDate(at("2026-09-17")), "2026-09-17");
  assert.equal(toIsoDate(Date.parse("2026-09-17T00:00:00Z")), "2026-09-17");
  assert.equal(
    toIsoDate(Date.parse("2026-09-17T00:00:00+03:00") / 1000),
    "2026-09-17",
  );
  assert.equal(toIsoDate("2026-09-17"), "2026-09-17");
  assert.equal(toIsoDate(null), "");
  assert.equal(normalizeTime("09:00:00"), "09:00");
  assert.equal(normalizeTime("9:05"), "09:05");
});

test("e-schools adapter keeps the endpoint used to refresh a material link", () => {
  const endpoint =
    "/api/v1/education/diary/schools/s/classes/c/students/u/lessons/lesson-1/attachments_and_links";
  const adapted = adaptESchoolsSnapshot({
    source: "e-schools.by",
    pages: {},
    network: {
      lessons: record(
        "/api/v1/education/diary/schools/s/classes/c/students/u/lessons?week_activity_uuid=w",
        [
          {
            date: at("2026-09-30"),
            day_of_week: 3,
            slots: [
              {
                lesson_uuid: "lesson-1",
                lesson_template_id: "chemistry",
                number: 2,
                subject_title: "Химия",
                homework: "§ 8",
                attachments: [
                  {
                    url: "https://diary.e-schools.by/#/diary?schoolpp-material=file-1",
                    title: "Диктант.docx",
                    id: "file-1",
                    source: "e-schools",
                    sourceLessonId: "lesson-1",
                    sourceEndpoint: endpoint,
                    sourceDate: "2026-09-30",
                    sourceLessonNumber: 2,
                    sourceStartTime: "09:00",
                    sourceSubject: "Химия",
                  },
                ],
              },
            ],
          },
        ],
      ),
    },
  });

  const material = adapted.diary.weeks[0].days.wednesday[0].materials[0];
  assert.equal(material.source, "e-schools");
  assert.equal(material.sourceLessonId, "lesson-1");
  assert.equal(material.sourceEndpoint, endpoint);
});
