export const SCHOOL_DATA = {
  school: {
    id: "school_demo",
    name: "Демо-школа",
    timezone: "Europe/Minsk",
    locale: "ru-BY",
    academicYear: {
      id: "academic_year_2025_2026",
      title: "2025/2026",
      startsOn: "2025-09-01",
      endsOn: "2026-08-31",
      terms: [
        {
          id: "term_2025_1",
          title: "1 четверть",
          order: 1,
          startsOn: "2025-09-01",
          endsOn: "2025-10-31"
        },
        {
          id: "term_2025_2",
          title: "2 четверть",
          order: 2,
          startsOn: "2025-11-10",
          endsOn: "2025-12-24"
        },
        {
          id: "term_2026_3",
          title: "3 четверть",
          order: 3,
          startsOn: "2026-01-12",
          endsOn: "2026-03-20"
        },
        {
          id: "term_2026_4",
          title: "4 четверть",
          order: 4,
          startsOn: "2026-03-30",
          endsOn: "2026-05-31"
        }
      ],
      breaks: [
        {
          id: "summer_2026",
          type: "summer",
          title: "Летние каникулы",
          startsOn: "2026-06-01",
          endsOn: "2026-08-31"
        }
      ]
    }
  },
  users: [
    {
      id: "student_demo",
      role: "student",
      login: "student",
      password: "demo-student",
      inviteCode: "DEMO-STUDENT-2026",
      firstName: "Даниил",
      lastName: "Романов",
      classId: "class_7b",
      className: '7 "Б"',
      teacherId: "teacher_demo",
      teacher: "Орлова Марина Сергеевна",
      classroom: "28",
      email: "",
      phone: ""
    },
    {
      id: "teacher_demo",
      role: "teacher",
      login: "teacher",
      password: "demo-teacher",
      firstName: "Марина",
      lastName: "Орлова",
      middleName: "Сергеевна",
      displayName: "Орлова Марина Сергеевна",
      department: "Математика и информатика",
      classTeacherOf: ["class_7b"],
      email: "m.orlova@school.example",
      classroom: "28"
    },
    {
      id: "admin_school",
      role: "admin",
      login: "admin",
      password: "demo-admin",
      firstName: "Администратор",
      lastName: "Школы",
      displayName: "Администратор школы"
    }
  ],
  classes: [
    {
      id: "class_7b",
      title: '7 "Б"',
      classroom: "28",
      classTeacherId: "teacher_demo",
      studentIds: [
        "student_demo",
        "student_alina_moroz",
        "student_egor_ivanov",
        "student_darya_koval",
        "student_nikita_petrov",
        "student_sofia_lebedeva",
        "student_maksim_orlov",
        "student_anna_sokolova",
        "student_artem_volkov",
        "student_maria_kuznetsova"
      ]
    },
    {
      id: "class_8a",
      title: '8 "А"',
      classroom: "31",
      classTeacherId: "teacher_8a",
      studentIds: [
        "student_8a_alexeeva",
        "student_8a_bondar",
        "student_8a_voronov",
        "student_8a_gromova",
        "student_8a_danilov",
        "student_8a_ershova",
        "student_8a_zhuk",
        "student_8a_zueva"
      ]
    },
    {
      id: "class_11a",
      title: '11 "А"',
      classroom: "47",
      classTeacherId: "teacher_11a",
      studentIds: [
        "student_11a_antonova",
        "student_11a_belov",
        "student_11a_vasileva",
        "student_11a_golubev",
        "student_11a_dmitrieva",
        "student_11a_egorov",
        "student_11a_ivanova",
        "student_11a_korolev"
      ]
    }
  ],
  students: [
    { id: "student_demo", firstName: "Даниил", lastName: "Романов", classId: "class_7b", groupIds: ["class_7b_english_1", "class_7b_informatics_1", "class_7b_labor_1"] },
    { id: "student_alina_moroz", firstName: "Алина", lastName: "Мороз", classId: "class_7b", groupIds: ["class_7b_english_1", "class_7b_informatics_1", "class_7b_labor_2"] },
    { id: "student_egor_ivanov", firstName: "Егор", lastName: "Иванов", classId: "class_7b", groupIds: ["class_7b_english_2", "class_7b_informatics_2", "class_7b_labor_1"] },
    { id: "student_darya_koval", firstName: "Дарья", lastName: "Коваль", classId: "class_7b", groupIds: ["class_7b_english_1", "class_7b_informatics_1", "class_7b_labor_2"] },
    { id: "student_nikita_petrov", firstName: "Никита", lastName: "Петров", classId: "class_7b", groupIds: ["class_7b_english_2", "class_7b_informatics_2", "class_7b_labor_1"] },
    { id: "student_sofia_lebedeva", firstName: "София", lastName: "Лебедева", classId: "class_7b", groupIds: ["class_7b_english_1", "class_7b_informatics_2", "class_7b_labor_2"] },
    { id: "student_maksim_orlov", firstName: "Максим", lastName: "Орлов", classId: "class_7b", groupIds: ["class_7b_english_2", "class_7b_informatics_1", "class_7b_labor_1"] },
    { id: "student_anna_sokolova", firstName: "Анна", lastName: "Соколова", classId: "class_7b", groupIds: ["class_7b_english_1", "class_7b_informatics_1", "class_7b_labor_2"] },
    { id: "student_artem_volkov", firstName: "Артём", lastName: "Волков", classId: "class_7b", groupIds: ["class_7b_english_2", "class_7b_informatics_2", "class_7b_labor_1"] },
    { id: "student_maria_kuznetsova", firstName: "Мария", lastName: "Кузнецова", classId: "class_7b", groupIds: ["class_7b_english_1", "class_7b_informatics_2", "class_7b_labor_2"] },
    { id: "student_8a_alexeeva", firstName: "Виктория", lastName: "Алексеева", classId: "class_8a", groupIds: ["class_8a_informatics_1"] },
    { id: "student_8a_bondar", firstName: "Илья", lastName: "Бондарь", classId: "class_8a", groupIds: ["class_8a_informatics_2"] },
    { id: "student_8a_voronov", firstName: "Кирилл", lastName: "Воронов", classId: "class_8a", groupIds: ["class_8a_informatics_1"] },
    { id: "student_8a_gromova", firstName: "Полина", lastName: "Громова", classId: "class_8a", groupIds: ["class_8a_informatics_2"] },
    { id: "student_8a_danilov", firstName: "Матвей", lastName: "Данилов", classId: "class_8a", groupIds: ["class_8a_informatics_1"] },
    { id: "student_8a_ershova", firstName: "Екатерина", lastName: "Ершова", classId: "class_8a", groupIds: ["class_8a_informatics_2"] },
    { id: "student_8a_zhuk", firstName: "Александр", lastName: "Жук", classId: "class_8a", groupIds: ["class_8a_informatics_1"] },
    { id: "student_8a_zueva", firstName: "Милана", lastName: "Зуева", classId: "class_8a", groupIds: ["class_8a_informatics_2"] },
    { id: "student_11a_antonova", firstName: "Анастасия", lastName: "Антонова", classId: "class_11a", groupIds: ["class_11a_informatics_1"] },
    { id: "student_11a_belov", firstName: "Максим", lastName: "Белов", classId: "class_11a", groupIds: ["class_11a_informatics_2"] },
    { id: "student_11a_vasileva", firstName: "Дарья", lastName: "Васильева", classId: "class_11a", groupIds: ["class_11a_informatics_1"] },
    { id: "student_11a_golubev", firstName: "Артём", lastName: "Голубев", classId: "class_11a", groupIds: ["class_11a_informatics_2"] },
    { id: "student_11a_dmitrieva", firstName: "София", lastName: "Дмитриева", classId: "class_11a", groupIds: ["class_11a_informatics_1"] },
    { id: "student_11a_egorov", firstName: "Михаил", lastName: "Егоров", classId: "class_11a", groupIds: ["class_11a_informatics_2"] },
    { id: "student_11a_ivanova", firstName: "Елизавета", lastName: "Иванова", classId: "class_11a", groupIds: ["class_11a_informatics_1"] },
    { id: "student_11a_korolev", firstName: "Денис", lastName: "Королёв", classId: "class_11a", groupIds: ["class_11a_informatics_2"] }
  ],
  subjects: [
    { id: "biology", title: "Биология", aliases: ["Биология"] },
    { id: "english", title: "Английский язык", aliases: ["Англ. яз."] },
    { id: "informatics", title: "Информатика", aliases: ["Информ."] },
    { id: "labor", title: "Трудовое обучение", aliases: ["Труд. обуч."] },
    { id: "mathematics", title: "Математика", aliases: ["Матем.", "Математика"] }
  ],
  groups: [
    { id: "class_7b_english_1", classId: "class_7b", subjectId: "english", title: "1 группа" },
    { id: "class_7b_english_2", classId: "class_7b", subjectId: "english", title: "2 группа" },
    { id: "class_7b_informatics_1", classId: "class_7b", subjectId: "informatics", title: "1 группа" },
    { id: "class_7b_informatics_2", classId: "class_7b", subjectId: "informatics", title: "2 группа" },
    { id: "class_7b_labor_1", classId: "class_7b", subjectId: "labor", title: "1 группа" },
    { id: "class_7b_labor_2", classId: "class_7b", subjectId: "labor", title: "2 группа" },
    { id: "class_8a_informatics_1", classId: "class_8a", subjectId: "informatics", title: "1 группа" },
    { id: "class_8a_informatics_2", classId: "class_8a", subjectId: "informatics", title: "2 группа" },
    { id: "class_11a_informatics_1", classId: "class_11a", subjectId: "informatics", title: "1 группа" },
    { id: "class_11a_informatics_2", classId: "class_11a", subjectId: "informatics", title: "2 группа" }
  ],
  lessonTemplates: [
    {
      id: "template_8a_math_monday",
      schoolYearId: "academic_year_2025_2026",
      classId: "class_8a",
      subjectId: "mathematics",
      teacherId: "teacher_demo",
      weekday: "monday",
      number: 2,
      startsAt: "09:00",
      endsAt: "09:45",
      room: "31"
    },
    {
      id: "template_8a_math_wednesday",
      schoolYearId: "academic_year_2025_2026",
      classId: "class_8a",
      subjectId: "mathematics",
      teacherId: "teacher_demo",
      weekday: "wednesday",
      number: 3,
      startsAt: "10:00",
      endsAt: "10:45",
      room: "31"
    },
    {
      id: "template_8a_math_friday",
      schoolYearId: "academic_year_2025_2026",
      classId: "class_8a",
      subjectId: "mathematics",
      teacherId: "teacher_demo",
      weekday: "friday",
      number: 1,
      startsAt: "08:00",
      endsAt: "08:45",
      room: "31"
    },
    {
      id: "template_8a_informatics_2_tuesday",
      schoolYearId: "academic_year_2025_2026",
      classId: "class_8a",
      groupId: "class_8a_informatics_2",
      subjectId: "informatics",
      teacherId: "teacher_demo",
      weekday: "tuesday",
      number: 4,
      startsAt: "11:00",
      endsAt: "11:45",
      room: "44"
    },
    {
      id: "template_11a_math_monday",
      schoolYearId: "academic_year_2025_2026",
      classId: "class_11a",
      subjectId: "mathematics",
      teacherId: "teacher_demo",
      weekday: "monday",
      number: 1,
      startsAt: "08:00",
      endsAt: "08:45",
      room: "47"
    },
    {
      id: "template_11a_math_tuesday",
      schoolYearId: "academic_year_2025_2026",
      classId: "class_11a",
      subjectId: "mathematics",
      teacherId: "teacher_demo",
      weekday: "tuesday",
      number: 2,
      startsAt: "09:00",
      endsAt: "09:45",
      room: "47"
    },
    {
      id: "template_11a_math_thursday",
      schoolYearId: "academic_year_2025_2026",
      classId: "class_11a",
      subjectId: "mathematics",
      teacherId: "teacher_demo",
      weekday: "thursday",
      number: 3,
      startsAt: "10:00",
      endsAt: "10:45",
      room: "47"
    },
    {
      id: "template_11a_math_friday",
      schoolYearId: "academic_year_2025_2026",
      classId: "class_11a",
      subjectId: "mathematics",
      teacherId: "teacher_demo",
      weekday: "friday",
      number: 4,
      startsAt: "11:00",
      endsAt: "11:45",
      room: "47"
    },
    {
      id: "template_11a_informatics_1_wednesday",
      schoolYearId: "academic_year_2025_2026",
      classId: "class_11a",
      groupId: "class_11a_informatics_1",
      subjectId: "informatics",
      teacherId: "teacher_demo",
      weekday: "wednesday",
      number: 5,
      startsAt: "12:00",
      endsAt: "12:45",
      room: "44"
    }
  ],
  teacherAssignments: [
    { id: "assignment_mathematics_7b", teacherId: "teacher_demo", classId: "class_7b", subjectId: "mathematics" },
    { id: "assignment_informatics_7b_1", teacherId: "teacher_demo", classId: "class_7b", subjectId: "informatics", groupId: "class_7b_informatics_1" },
    { id: "assignment_mathematics_8a", teacherId: "teacher_demo", classId: "class_8a", subjectId: "mathematics" },
    { id: "assignment_informatics_8a_2", teacherId: "teacher_demo", classId: "class_8a", subjectId: "informatics", groupId: "class_8a_informatics_2" },
    { id: "assignment_mathematics_11a", teacherId: "teacher_demo", classId: "class_11a", subjectId: "mathematics" },
    { id: "assignment_informatics_11a_1", teacherId: "teacher_demo", classId: "class_11a", subjectId: "informatics", groupId: "class_11a_informatics_1" }
  ]
};
