import { addIsoDays, parseIsoDateParts } from "./date-tools.js";
import {
  normalizeSubjectName,
  shortSubjectName,
} from "./subject-names.js";

const DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

function adaptESchoolsSnapshot(snapshot) {
  if (!snapshot || snapshot.source !== "e-schools.by") return null;
  const records = Object.values(snapshot.network || {}).filter(
    (record) => record?.status >= 200 && record.status < 300,
  );
  if (!records.length) return null;

  const ids = findSourceIds(records);
  const yearSource = findBody(records, /\/diary\/school_year(?:\?|$)/);
  const activities = asArray(
    findBody(records, /\/diary\/time_activities(?:\?|$)/),
  );
  const classItems = getClassItems(records);
  const classItem =
    classItems.find((item) => !ids.classId || item.uuid === ids.classId) ||
    classItems[0] ||
    {};
  const schoolId = ids.schoolId || classItem.school || "school";
  const classId = ids.classId || classItem.uuid || "class";
  // The local preview keeps one stable app identity. The external student UUID
  // stays alongside it and is never used as a login credential.
  const studentId = "student_demo";
  const academicYear = createAcademicYear(yearSource, activities, schoolId);
  const sourceSubjects = asArray(
    findBody(
      records,
      /\/students\/[^/]+\/classes\/[^/]+\/subjects(?:\?|$)/,
    ),
  );
  const studentSubjects = asArray(
    findBody(records, /\/students\/[^/]+\/educational_subjects(?:\?|$)/),
  );
  const planningSubjects = asArray(
    findBody(records, /\/planning\/classes\/[^/]+\/educational_subjects/),
  );
  const premises = asArray(
    findBody(records, /\/institution\/schools\/[^/]+\/premises/),
  );
  const subjectModel = createSubjects({
    sourceSubjects,
    studentSubjects,
    planningSubjects,
    schoolId,
    classId,
  });
  const roomById = new Map(
    premises.map((room) => [
      room.uuid,
      clean(room.audience_number || room.audience_name),
    ]),
  );
  const bells = createBellSchedule(
    asArray(findBody(records, /\/bells\/whole(?:\?|$)/)),
  );
  const bellTimeByStart = createBellTimeIndex(bells);
  const timetableSource = asArray(
    findBody(records, /\/classes\/[^/]+\/timetables\/whole(?:\?|$)/),
  );
  const roomIndex = createTemplateRoomIndex(
    timetableSource,
    roomById,
    subjectModel.templateById,
  );
  const timetable = createTimetable({
    source: timetableSource,
    classId,
    roomById,
    templateById: subjectModel.templateById,
    roomIndex,
  });
  const lessonDays = records
    .filter((record) => /\/students\/[^/]+\/lessons(?:\?|$)/.test(record.url))
    .flatMap((record) => asArray(record.body));
  const diary = supplementDiaryFromTimetable(
    createDiary({
      lessonDays,
      academicYear,
      schoolId,
      classId,
      templateById: subjectModel.templateById,
      roomByTemplateId: roomIndex.byTemplateId,
      roomBySubject: roomIndex.bySubject,
      bellTimeByStart,
      studentId,
    }),
    timetable,
    academicYear,
    classId,
  );
  const identity = getStudentIdentity(snapshot.pages);
  const profile = identity.name;
  const name = splitPersonName(profile);
  const classTitle = formatClassTitle(identity.classTitle, classItem);
  const classTeacher = findClassTeacher(records, snapshot.pages, classItem);

  const school = {
    school: {
      id: schoolId,
      name: "School++",
      timezone: "Europe/Minsk",
      locale: "ru-BY",
      academicYear,
    },
    users: [
      {
        id: studentId,
        externalId: ids.studentId,
        role: "student",
        login: "student",
        password: "student",
        firstName: name.firstName || "Ученик",
        lastName: name.lastName,
        middleName: name.middleName,
        displayName: profile,
        classId,
        className: classTitle || "—",
        teacher: classTeacher || "не указан",
        classroom: "",
        email: "",
        phone: "",
      },
      ...subjectModel.teachers,
    ],
    classes: [
      {
        id: classId,
        title: classTitle || "—",
        classroom: "",
        classTeacherId: "",
        studentIds: [studentId],
      },
    ],
    students: [
      {
        id: studentId,
        externalId: ids.studentId,
        firstName: name.firstName || "Ученик",
        lastName: name.lastName,
        classId,
        groupIds: subjectModel.groupIds,
      },
    ],
    subjects: subjectModel.subjects,
    groups: subjectModel.groups,
    lessonTemplates: mergeLessonTemplates(
      subjectModel.lessonTemplates,
      diary.lessonTemplates,
    ),
    teacherAssignments: subjectModel.assignments,
    schedule: {
      bellSchedules: bells,
      preferredShiftId: inferPreferredShiftId(lessonDays, bells),
      holidays: academicYear.breaks,
      lessonSchedule: timetable,
      subjects: subjectModel.scheduleSubjects,
    },
    messages: [],
  };

  return {
    diary: {
      schemaVersion: 2,
      meta: {
        schoolId,
        schoolYear: academicYear.title,
        locale: "ru-BY",
        timezone: "Europe/Minsk",
        classId,
      },
      weeks: diary.weeks,
    },
    school,
    importedAt: snapshot.capturedAt || "",
    coverage: {
      lessonWeeks: diary.weeks.length,
      subjects: subjectModel.subjects.length,
      hasAcademicYear: Boolean(academicYear.startsOn && academicYear.endsOn),
      hasSchedule: timetable.length > 0,
      hasBells: bells.length > 0,
    },
    journalEntries: diary.journalEntries,
  };
}

function findBody(records, pattern) {
  return records.find(
    (record) => record.method === "GET" && pattern.test(record.url || ""),
  )?.body;
}

function getClassItems(records) {
  const direct = asArray(
    findBody(records, /\/students\/[^/]+\/classes(?:\?|$)/),
  );
  if (direct.length) return direct;
  const posted = records.find(
    (record) =>
      record.method === "POST" &&
      /\/students\/[^/]+\/classes(?:\?|$)/.test(record.url || ""),
  )?.body;
  return asArray(posted?.classes);
}

function findSourceIds(records) {
  for (const { url = "" } of records) {
    const match = url.match(
      /\/schools\/([^/]+)\/(?:classes\/([^/]+)\/students\/([^/]+)|students\/([^/]+)\/classes(?:\/([^/?]+))?)/,
    );
    if (!match) continue;
    return {
      schoolId: match[1] || "",
      classId: match[2] || match[5] || "",
      studentId: match[3] || match[4] || "",
    };
  }
  return { schoolId: "", classId: "", studentId: "" };
}

function createAcademicYear(source = {}, activities = [], schoolId) {
  const yearStart = toIsoDate(source.start_ts) || `${source.start_year || ""}-09-01`;
  const yearEnd = toIsoDate(source.end_ts) || `${source.end_year || ""}-08-31`;
  const startsOn = parseIsoDateParts(yearStart) ? yearStart : "";
  const endsOn = parseIsoDateParts(yearEnd) ? yearEnd : "";
  const title = clean(
    source.label ||
      (source.start_year && source.end_year
        ? `${source.start_year}/${source.end_year}`
        : ""),
  );
  const datedActivities = activities
    .map((item) => ({
      ...item,
      startsOn: toIsoDate(item.start_date),
      endsOn: toIsoDate(item.end_date),
    }))
    .filter(
      (item) =>
        parseIsoDateParts(item.startsOn) &&
        parseIsoDateParts(item.endsOn) &&
        item.startsOn <= item.endsOn,
    );
  const isHoliday = (item) =>
    /каникул|holiday|vacation/i.test(
      `${item.title || ""} ${item.description || ""} ${item.type || ""}`,
    );
  const terms = datedActivities
    .filter(
      (item) =>
        !isHoliday(item) &&
        /четверт|quarter|term/i.test(
          `${item.title || ""} ${item.description || ""} ${item.type || ""}`,
        ),
    )
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
    .slice(0, 4)
    .map((item, index) => ({
      id: item.uuid || `term-${index + 1}`,
      schoolId,
      title: clean(item.title) || `${index + 1} четверть`,
      order: index + 1,
      startsOn: item.startsOn,
      endsOn: item.endsOn,
    }));
  const breaks = datedActivities
    .filter(isHoliday)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
    .map((item, index) => ({
      id: item.uuid || `break-${index + 1}`,
      type: /летн|summer/i.test(item.title || "") ? "summer" : "holiday",
      title: getHolidayTitle(item.title),
      startsOn: item.startsOn,
      endsOn: item.endsOn,
      applicability: clean(item.description),
    }));
  return {
    id: source.uuid || `academic-year-${title || "current"}`,
    title,
    startsOn,
    endsOn,
    terms,
    breaks,
    halfYears: [],
  };
}

function createSubjects({
  sourceSubjects,
  studentSubjects,
  planningSubjects,
  schoolId,
  classId,
}) {
  const subjectById = new Map();
  const templateById = new Map();
  const teacherByName = new Map();
  const groups = [];
  const groupIds = [];
  const assignments = [];
  const scheduleSubjects = [];

  const addSubject = (id, title, aliases = []) => {
    const subjectId = clean(id) || stableId(title);
    if (!subjectId || !clean(title)) return "";
    const previous = subjectById.get(subjectId);
    subjectById.set(subjectId, {
      id: subjectId,
      schoolId,
      title: clean(title),
      shortTitle: shortSubjectName(title),
      aliases: unique([
        ...(previous?.aliases || []),
        ...aliases,
        clean(title),
        shortSubjectName(title),
      ]),
    });
    return subjectId;
  };
  const addTeacher = (name, id = "") => {
    const displayName = clean(name);
    if (!displayName) return "";
    const teacherId = clean(id) || `teacher-${stableId(displayName)}`;
    if (!teacherByName.has(displayName)) {
      teacherByName.set(displayName, {
        id: teacherId,
        role: "teacher",
        displayName,
        firstName: displayName,
        lastName: "",
        login: "",
      });
    }
    return teacherId;
  };

  sourceSubjects.forEach((item, index) => {
    const subjectId = addSubject(
      item.id || item.uuid,
      item.subject_title || item.name,
    );
    if (!subjectId) return;
    const teacherId = addTeacher(item.teacher, item.teacher_id);
    const groupId = clean(item.group_id);
    if (groupId && !groupIds.includes(groupId)) {
      groupIds.push(groupId);
      groups.push({
        id: groupId,
        classId,
        subjectId,
        title: cleanGroupName(item.group_name) || "Группа",
      });
    }
    assignments.push({
      id: `assignment-${subjectId}-${groupId || index}`,
      classId,
      subjectId,
      groupId,
      teacherId,
      assessmentPeriod: "quarter",
      gradingScale:
        shortSubjectName(item.subject_title || item.name) === "Искусство"
          ? "pass-fail"
          : "numeric",
    });
    scheduleSubjects.push({
      id: subjectId,
      classId,
      title: shortSubjectName(item.subject_title || item.name),
      level: clean(item.level_of_study),
      teachers: [
        {
          name: clean(item.teacher),
          group: cleanGroupName(item.group_name),
          level: clean(item.level_of_study),
        },
      ],
    });
  });

  studentSubjects.forEach((item) => addSubject(item.uuid, item.name));

  planningSubjects.forEach((item) => {
    const title =
      item.school_subject?.as_json?.subject?.as_json?.value ||
      item.school_subject?.as_json?.short_name ||
      item.school_subject?.as_json?.summary;
    const subjectId = addSubject(item.uuid, title);
    asArray(item.templates).forEach((template) => {
      const teacherName = clean(
        [
          template.teacher?.surname,
          template.teacher?.name,
          template.teacher?.patronymic,
        ]
          .filter(Boolean)
          .join(" "),
      );
      const teacherId = addTeacher(teacherName, template.teacher?.id);
      const groupId = clean(template.study_group?.uuid);
      if (groupId && !groupIds.includes(groupId)) {
        groupIds.push(groupId);
        groups.push({
          id: groupId,
          classId,
          subjectId,
          title: cleanGroupName(template.study_group?.name) || "Группа",
        });
      }
      templateById.set(template.uuid, {
        id: template.uuid,
        subjectId,
        subject: shortSubjectName(title),
        fullSubject: clean(title),
        teacherId,
        teacher: teacherName,
        groupId,
      });
    });
  });

  const lessonTemplates = [...templateById.values()].map((template) => ({
    ...template,
    classId,
    schoolYearId: "",
    weekday: "",
    number: 0,
    startsAt: "",
    endsAt: "",
    room: "",
  }));
  return {
    subjects: [...subjectById.values()],
    teachers: [...teacherByName.values()],
    groups,
    groupIds,
    assignments: dedupeBy(assignments, (item) => item.id),
    scheduleSubjects: mergeScheduleSubjects(scheduleSubjects),
    templateById,
    lessonTemplates,
  };
}

function createBellSchedule(source) {
  return source.map((schedule, index) => ({
    id: String(schedule.uuid || schedule.shift || index + 1),
    order: Number(schedule.shift) || index + 1,
    title: clean(schedule.title) || `${schedule.shift || index + 1} смена`,
    variants: asArray(schedule.days_of_week).map((variant, variantIndex) => ({
      id: variant.uuid || `${schedule.uuid || index}-${variantIndex}`,
      title: formatDayList(variant.days),
      days: asArray(variant.days),
      lessons: normalizeBellNumbers(
        asArray(variant.time_of_bells),
        Number(schedule.shift),
      ).map((lesson) => ({
        number: lesson.number,
        startsAt: normalizeTime(lesson.start_time),
        endsAt: normalizeTime(lesson.end_time),
      })),
    })),
  }));
}

function createBellTimeIndex(schedules) {
  const result = new Map();
  schedules.forEach((schedule) =>
    schedule.variants.forEach((variant) =>
      variant.lessons.forEach((lesson) => {
        if (lesson.startsAt)
          result.set(lesson.startsAt, {
            startsAt: lesson.startsAt,
            endsAt: lesson.endsAt,
          });
      }),
    ),
  );
  return result;
}

function createTimetable({
  source,
  classId,
  roomById,
  templateById,
  roomIndex,
}) {
  const result = new Map();
  source.forEach((period) => {
    asArray(period.days_of_week).forEach((day) => {
      const dayKey = DAY_KEYS[Number(day.day_of_week) - 1];
      if (!dayKey) return;
      const lessons = asArray(day.timetable_slots).flatMap((slot) => {
        const time = slot.time_of_bells || {};
        return asArray(slot.slots).map((item) => {
          const template = templateById.get(item.lesson_template_id) || {};
          const subject = shortSubjectName(
            template.subject || clean(item.summary),
          );
          return {
            templateId: item.lesson_template_id,
            number: item.number ?? time.number,
            time: joinTime(time.start_time, time.end_time),
            subject,
            teacher: template.teacher || "",
            groupId: template.groupId || "",
            room:
              roomById.get(item.room_id) ||
              roomIndex.byTemplateId.get(item.lesson_template_id) ||
              roomIndex.bySubject.get(normalizeSubject(subject)) ||
              "",
          };
        });
      });
      if (!result.has(dayKey)) result.set(dayKey, []);
      result.get(dayKey).push(...lessons);
    });
  });
  return DAY_KEYS.filter((dayKey) => result.has(dayKey)).map(
    (dayKey, index) => ({
      id: dayKey,
      classId,
      title: dayName(dayKey),
      order: index + 1,
      lessons: mergeTimetableLessons(result.get(dayKey)),
    }),
  );
}

function createTemplateRoomIndex(source, roomById, templateById) {
  const byTemplateId = new Map();
  const roomsBySubject = new Map();
  source.forEach((period) =>
    asArray(period.days_of_week).forEach((day) =>
      asArray(day.timetable_slots).forEach((slot) =>
        asArray(slot.slots).forEach((item) => {
          const room = roomById.get(item.room_id);
          if (!room) return;
          if (item.lesson_template_id)
            byTemplateId.set(item.lesson_template_id, room);
          const subject = normalizeSubject(
            templateById.get(item.lesson_template_id)?.subject || item.summary,
          );
          if (!subject) return;
          if (!roomsBySubject.has(subject)) roomsBySubject.set(subject, new Set());
          roomsBySubject.get(subject).add(room);
        }),
      ),
    ),
  );
  const bySubject = new Map();
  roomsBySubject.forEach((rooms, subject) => {
    if (rooms.size === 1) bySubject.set(subject, [...rooms][0]);
  });
  return { byTemplateId, bySubject };
}

function createDiary({
  lessonDays,
  academicYear,
  schoolId,
  classId,
  templateById,
  roomByTemplateId,
  roomBySubject,
  bellTimeByStart,
  studentId,
}) {
  const weeks = new Map();
  const lessonTemplates = new Map();
  const journalEntries = [];
  lessonDays.forEach((day) => {
    const date = toIsoDate(day.date);
    const dayKey = dayKeyFromDate(date, day.day_of_week);
    if (!date || !dayKey) return;
    const weekStart = mondayFor(date);
    if (!weeks.has(weekStart)) {
      weeks.set(weekStart, {
        id: `week-${weekStart}`,
        termId: findTermId(academicYear.terms, date),
        start: weekStart,
        end: addIsoDays(weekStart, 6),
        days: Object.fromEntries(DAY_KEYS.map((key) => [key, []])),
        dayInfo: {},
      });
    }
    asArray(day.slots).forEach((slot, index) => {
      const template = templateById.get(slot.lesson_template_id) || {};
      const startTime = normalizeTime(slot.start_time);
      const times = bellTimeByStart.get(startTime) || {
        startsAt: startTime,
        endsAt: "",
      };
      const subject = shortSubjectName(
        slot.subject_title || template.subject,
      );
      const grade = clean(
        slot.lesson_mark?.mark ?? slot.lesson_mark?.value ?? "",
      );
      const templateId =
        clean(slot.lesson_template_id) ||
        `template-${stableId(subject)}-${dayKey}-${slot.number || index + 1}`;
      const lesson = {
        id: clean(slot.lesson_uuid) || `${date}-${templateId}`,
        templateId,
        classId,
        groupId: template.groupId || "",
        number: slot.number ?? index + 1,
        subject,
        time: joinTime(times.startsAt, times.endsAt),
        room:
          roomByTemplateId.get(templateId) ||
          roomBySubject.get(normalizeSubject(subject)) ||
          "",
        homework: clean(slot.homework),
        grade,
        status: "scheduled",
      };
      weeks.get(weekStart).days[dayKey].push(lesson);
      journalEntries.push(
        createJournalEntry({
          lesson,
          mark: slot.lesson_mark,
          studentId,
          capturedAt: date,
        }),
      );
      lessonTemplates.set(templateId, {
        id: templateId,
        schoolId,
        schoolYearId: academicYear.id,
        classId,
        groupId: template.groupId || "",
        subjectId: template.subjectId || stableId(subject),
        teacherId: template.teacherId || clean(slot.teacher_id),
        weekday: dayKey,
        number: lesson.number,
        startsAt: times.startsAt,
        endsAt: times.endsAt,
        room: lesson.room,
      });
    });
  });
  const result = [...weeks.values()].sort((a, b) =>
    a.start.localeCompare(b.start),
  );
  result.forEach((week) =>
    DAY_KEYS.forEach((key) =>
      week.days[key].sort((a, b) => (a.number || 0) - (b.number || 0)),
    ),
  );
  return {
    weeks: result,
    lessonTemplates: [...lessonTemplates.values()],
    journalEntries,
  };
}

function createJournalEntry({ lesson, mark, studentId, capturedAt }) {
  const value = clean(mark?.mark ?? mark?.value ?? "");
  const normalized = value.toLocaleLowerCase("ru");
  const isPassFail = /^(?:зач[её]т|незач[её]т)$/.test(normalized);
  const absent = /^(?:н|нб|отс|отсутствовал(?:а)?)\.?$/i.test(normalized);
  return {
    lessonId: lesson.id,
    studentId,
    grades: isPassFail ? [value] : parseGradeValues(value),
    attendance: absent ? "absent" : "",
    homework: "",
    comment: clean(mark?.comment),
    materials: [],
    authorId: clean(mark?.author),
    updatedAt: capturedAt ? `${capturedAt}T00:00:00.000Z` : undefined,
  };
}

function mergeLessonTemplates(base, actual) {
  const result = new Map();
  [...base, ...actual].forEach((item) => {
    if (!item?.id) return;
    result.set(item.id, { ...(result.get(item.id) || {}), ...item });
  });
  return [...result.values()].filter(
    (item) => item.subjectId && item.classId && item.weekday,
  );
}

function mergeScheduleSubjects(items) {
  const result = new Map();
  items.forEach((item) => {
    const current = result.get(item.id);
    if (!current) result.set(item.id, item);
    else current.teachers.push(...item.teachers);
  });
  return [...result.values()].map((item) => ({
    ...item,
    teachers: dedupeBy(
      item.teachers,
      (teacher) => `${teacher.name}-${teacher.group}-${teacher.level}`,
    ),
  }));
}

function inferPreferredShiftId(lessonDays, schedules) {
  const starts = lessonDays.flatMap((day) =>
    asArray(day.slots).map((slot) => normalizeTime(slot.start_time)),
  );
  let best = null;
  schedules.forEach((schedule) => {
    const scheduleStarts = new Set(
      schedule.variants.flatMap((variant) =>
        variant.lessons.map((lesson) => lesson.startsAt),
      ),
    );
    const score = starts.filter((value) => scheduleStarts.has(value)).length;
    if (!best || score > best.score) best = { id: schedule.id, score };
  });
  return best?.id || schedules[0]?.id || "";
}

function getStudentIdentity(pages = {}) {
  const values = Object.values(pages || {});
  const explicit = values.map((page) => page?.studentIdentity).find(Boolean);
  if (explicit?.name || explicit?.classTitle)
    return {
      classTitle: clean(explicit.classTitle),
      name: clean(explicit.name),
    };
  for (const page of values) {
    for (const heading of page?.headings || []) {
      const match = clean(heading).match(
        /электронный дневник обучающегося\s+(.+?)\s+класса,\s*(.+)$/i,
      );
      if (match)
        return {
          classTitle: clean(match[1]),
          name: clean(match[2]).replace(/[,;:]+$/, ""),
        };
    }
  }
  return {
    classTitle: "",
    name: clean(values.map((page) => page?.profile?.label).find(Boolean)),
  };
}

function formatClassTitle(explicitTitle, classItem = {}) {
  const explicit = clean(explicitTitle);
  if (explicit) return explicit;
  const label = clean(classItem.label);
  if (/\d/.test(label)) return label;
  const number = clean(classItem.class_number || classItem.level);
  const letter = label.replace(/[«»"']/g, "");
  if (number && letter) return `${number} «${letter}»`;
  return number || label;
}

function findClassTeacher(records, pages = {}, classItem = {}) {
  const fromPage = Object.values(pages || {})
    .map((page) => clean(page?.classTeacher))
    .find(Boolean);
  if (fromPage) return fromPage;
  const fromClass = personNameFromValue(
    classItem.class_teacher ||
      classItem.classTeacher ||
      classItem.head_teacher ||
      classItem.teacher,
  );
  if (fromClass) return fromClass;
  const directKeys = [
    "class_teacher",
    "classTeacher",
    "head_teacher",
    "headTeacher",
    "homeroom_teacher",
    "form_master",
    "curator",
  ];
  for (const record of records) {
    const found = findNamedValue(record?.body, directKeys);
    const name = personNameFromValue(found);
    if (name) return name;
  }
  return "";
}

function findNamedValue(value, keys, depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) return null;
  for (const [key, item] of Object.entries(value)) {
    if (keys.includes(key) && item) return item;
  }
  for (const item of Object.values(value)) {
    const found = findNamedValue(item, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function personNameFromValue(value) {
  if (typeof value === "string") return clean(value);
  if (!value || typeof value !== "object") return "";
  return clean(
    value.display_name ||
      value.full_name ||
      value.name_full ||
      [value.surname, value.name, value.patronymic].filter(Boolean).join(" "),
  );
}

function parseGradeValues(value) {
  return String(value || "")
    .split(/\s*\/\s*/)
    .map((item) => item.trim())
    .filter((item) => /^(?:10|[1-9])$/.test(item))
    .slice(0, 2);
}

function supplementDiaryFromTimetable(diary, timetable, academicYear, classId) {
  const weeks = new Map(diary.weeks.map((week) => [week.start, week]));
  const scheduleByDay = new Map(timetable.map((day) => [day.id, day.lessons]));
  for (const term of academicYear.terms || []) {
    for (
      let date = term.startsOn;
      date && date <= term.endsOn;
      date = addIsoDays(date, 1)
    ) {
      const dayKey = dayKeyFromDate(date);
      const scheduled = scheduleByDay.get(dayKey) || [];
      if (!scheduled.length) continue;
      const weekStart = mondayFor(date);
      if (!weeks.has(weekStart)) {
        weeks.set(weekStart, {
          id: `week-${weekStart}`,
          termId: term.id,
          start: weekStart,
          end: addIsoDays(weekStart, 6),
          days: Object.fromEntries(DAY_KEYS.map((key) => [key, []])),
          dayInfo: {},
        });
      }
      const week = weeks.get(weekStart);
      if (!Array.isArray(week.days[dayKey])) week.days[dayKey] = [];
      for (const lesson of scheduled) {
        const exists = week.days[dayKey].some(
          (item) =>
            item.number === lesson.number &&
            normalizeSubjectName(item.subject) ===
              normalizeSubjectName(lesson.subject),
        );
        if (exists) continue;
        week.days[dayKey].push({
          id: `scheduled-${date}-${lesson.number}-${lesson.templateId || stableId(lesson.subject)}`,
          templateId: lesson.templateId || "",
          classId,
          groupId: "",
          number: lesson.number,
          subject: lesson.subject,
          time: lesson.time,
          room: lesson.room || "",
          homework: "",
          grade: "",
          status: "scheduled",
        });
      }
    }
  }
  diary.weeks = [...weeks.values()].sort((a, b) =>
    a.start.localeCompare(b.start),
  );
  diary.weeks.forEach((week) =>
    DAY_KEYS.forEach((key) =>
      (week.days[key] || []).sort(
        (first, second) => (first.number ?? 0) - (second.number ?? 0),
      ),
    ),
  );
  return diary;
}

function splitPersonName(value) {
  const parts = clean(value)
    .replace(/кабинет обучающегося/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "", middleName: "" };
  if (parts.length === 1)
    return { firstName: parts[0], lastName: "", middleName: "" };
  return {
    lastName: parts[0],
    firstName: parts[1],
    middleName: parts.slice(2).join(" "),
  };
}

function getHolidayTitle(value) {
  const title = clean(value);
  const normalized = title.toLocaleUpperCase("ru");
  return (
    {
      AUTUMN_HOLIDAYS: "Осенние каникулы",
      WINTER_HOLIDAYS: "Зимние каникулы",
      ADDITIONAL_HOLIDAYS: "Дополнительные каникулы",
      SPRING_HOLIDAYS: "Весенние каникулы",
      SUMMER_HOLIDAYS: "Летние каникулы",
    }[normalized] ||
    title ||
    "Каникулы"
  );
}

function cleanGroupName(value) {
  return clean(value)
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBellNumbers(lessons, shift) {
  return lessons.map((lesson, index) => {
    if (lesson.number !== null && lesson.number !== undefined)
      return lesson;
    const nextNumber = Number(lessons[index + 1]?.number);
    const inferred = Number.isFinite(nextNumber)
      ? nextNumber - 1
      : shift === 2 && index === 0
        ? 0
        : index + 1;
    return { ...lesson, number: inferred };
  });
}

function mergeTimetableLessons(lessons) {
  const merged = new Map();
  [...lessons]
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
    .forEach((lesson) => {
      const key = `${lesson.number ?? ""}-${lesson.time}-${normalizeSubjectName(lesson.subject)}`;
      const group = {
        teacher: lesson.teacher,
        room: lesson.room,
        groupId: lesson.groupId,
      };
      const current = merged.get(key);
      if (!current) {
        merged.set(key, {
          ...lesson,
          groups: [group],
        });
        return;
      }
      current.groups.push(group);
      current.groups = dedupeBy(
        current.groups,
        (item) => `${item.teacher}-${item.room}-${item.groupId}`,
      );
      if (!current.room && lesson.room) current.room = lesson.room;
    });
  return [...merged.values()];
}

function toIsoDate(value) {
  if (typeof value === "string" && parseIsoDateParts(value.slice(0, 10)))
    return value.slice(0, 10);
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function mondayFor(date) {
  const parts = parseIsoDateParts(date);
  if (!parts) return "";
  const weekday = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay();
  return addIsoDays(date, -((weekday + 6) % 7));
}

function dayKeyFromDate(date, sourceDay) {
  const number = Number(sourceDay);
  if (number >= 1 && number <= 7) return DAY_KEYS[number - 1];
  const parts = parseIsoDateParts(date);
  if (!parts) return "";
  const weekday = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay();
  return DAY_KEYS[(weekday + 6) % 7];
}

function findTermId(terms, date) {
  return terms.find((term) => term.startsOn <= date && date <= term.endsOn)?.id || "";
}

function formatDayList(days) {
  const labels = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  return asArray(days)
    .map((day) => labels[Number(day) - 1])
    .filter(Boolean)
    .join(", ");
}

function dayName(dayKey) {
  return {
    monday: "Понедельник",
    tuesday: "Вторник",
    wednesday: "Среда",
    thursday: "Четверг",
    friday: "Пятница",
    saturday: "Суббота",
    sunday: "Воскресенье",
  }[dayKey];
}

function joinTime(start, end) {
  const startsAt = normalizeTime(start);
  const endsAt = normalizeTime(end);
  if (!startsAt) return "";
  return endsAt ? `${startsAt}–${endsAt}` : startsAt;
}

function normalizeTime(value) {
  const source = clean(value);
  const match = source.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!match) return source;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function normalizeSubject(value) {
  return clean(value).toLocaleLowerCase("ru").replace(/ё/g, "е");
}

function stableId(value) {
  return clean(value)
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function clean(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function dedupeBy(items, getKey) {
  return [...new Map(items.map((item) => [getKey(item), item])).values()];
}

export { adaptESchoolsSnapshot, normalizeTime, toIsoDate };
