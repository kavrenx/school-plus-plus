import { addIsoDays, parseIsoDateParts } from "./date-tools.js";
import { shortSubjectName } from "./subject-names.js";

function normalizeDiaryData(rawDiary, dayOrder, schoolData = {}) {
    const source = rawDiary && Array.isArray(rawDiary.weeks) ? rawDiary : { weeks: [] };
    const subjects = new Map();
    const lessons = [];
    const lessonTemplates = new Map();
    const school = normalizeSchoolData(schoolData, source.meta);
    const subjectAliasMap = createSubjectAliasMap(school.subjects);

    const weeks = source.weeks.map((week, weekIndex) => {
      const weekId = week.id || `week-${week.start || weekIndex + 1}`;
      const days = {};
      const dayStates = {};

      dayOrder.forEach((dayKey) => {
        const hasDayData = Object.prototype.hasOwnProperty.call(
          week.days || {},
          dayKey,
        );
        const dayLessons = Array.isArray(week.days?.[dayKey]) ? week.days[dayKey] : [];

        days[dayKey] = dayLessons.map((lesson, lessonIndex) => {
          const subjectId = subjectAliasMap.get(normalizeSubjectTitle(lesson.subject)) || createSubjectId(lesson.subject);
          const time = parseLessonTime(lesson.time);
          const number = lesson.number ?? lessonIndex + 1;
          const classId =
            lesson.classId || week.classId || source.meta?.classId || "";
          const groupId =
            lesson.groupId ||
            week.subjectGroups?.[subjectId] ||
            source.meta?.subjectGroups?.[subjectId] ||
            "";
          const templateId =
            lesson.templateId ||
            createLessonTemplateId({
              schoolId: school.id,
              classId,
              groupId,
              subjectId,
              dayKey,
              number,
              startsAt: time.startsAt,
            });
          const assignment = findTeacherAssignment(school, {
            classId,
            groupId,
            subjectId,
          });

          if (!subjects.has(subjectId)) {
            const schoolSubject = school.subjectsById[subjectId];
            subjects.set(subjectId, {
              id: subjectId,
              schoolId: school.id,
              title: schoolSubject?.title || lesson.subject,
              shortTitle: lesson.subject
            });
          }

          if (!lessonTemplates.has(templateId)) {
            lessonTemplates.set(templateId, {
              id: templateId,
              schoolId: school.id,
              schoolYearId: school.academicYear.id,
              classId,
              groupId,
              subjectId,
              teacherId: assignment?.teacherId || "",
              weekday: dayKey,
              number,
              startsAt: time.startsAt,
              endsAt: time.endsAt,
              room: lesson.room || ""
            });
          }

          const normalizedLesson = {
            id: lesson.id || `${weekId}_${dayKey}_${number}`,
            schoolId: school.id,
            schoolYearId: school.academicYear.id,
            templateId,
            weekId,
            dayKey,
            date: getLessonDate(week.start, dayKey, dayOrder),
            status: lesson.status || "scheduled",
            number,
            subjectId,
            classId,
            groupId,
            subject: shortSubjectName(
              school.subjectsById[subjectId]?.title || lesson.subject,
            ),
            time: lesson.time,
            startsAt: time.startsAt,
            endsAt: time.endsAt,
            room: lesson.room,
            homework: lesson.homework,
            grade: lesson.grade || ""
          };

          lessons.push(normalizedLesson);
          return normalizedLesson;
        });
        dayStates[dayKey] = normalizeDayState({
          dayKey,
          hasDayData,
          lessonCount: days[dayKey].length,
          source: week.dayInfo?.[dayKey],
        });
      });

      return {
        id: weekId,
        schoolYearId: school.academicYear.id,
        termId: week.termId || getTermForDate({ school }, week.start)?.id || "",
        start: week.start,
        end: week.end,
        days,
        dayStates,
      };
    });

    school.lessonTemplates.forEach((template) => {
      if (!template?.id || lessonTemplates.has(template.id)) return;
      lessonTemplates.set(template.id, {
        ...template,
        schoolId: template.schoolId || school.id,
        schoolYearId: template.schoolYearId || school.academicYear.id,
        groupId: template.groupId || "",
      });
    });

    const model = {
      schemaVersion: source.schemaVersion || 1,
      normalizedVersion: 4,
      schoolId: school.id,
      meta: {
        ...(source.meta || {}),
        schoolId: school.id,
        schoolYearId: school.academicYear.id,
        timezone: school.timezone,
        locale: school.locale
      },
      weeks,
      subjects: Array.from(subjects.values()),
      lessonTemplates: Array.from(lessonTemplates.values()),
      lessonTemplatesById: indexById(Array.from(lessonTemplates.values())),
      lessons,
      school
    };

    model.getTeacherAssignments = (teacherId) => getTeacherAssignments(model, teacherId);
    model.getLessonsForAssignment = (assignment) => getLessonsForAssignment(model, assignment);
    model.getLessonsForAssignmentTerm = (assignment, termId) =>
      getLessonsForAssignmentTerm(model, assignment, termId);
    model.getStudentsForAssignment = (assignment) => getStudentsForAssignment(model, assignment);
    model.getTermForDate = (date) => getTermForDate(model, date);

    return model;
  }

  function normalizeSchoolData(schoolData = {}, diaryMeta = {}) {
    const school = {
      id: schoolData.school?.id || diaryMeta?.schoolId || "school_demo",
      name: schoolData.school?.name || "Школа",
      timezone:
        schoolData.school?.timezone || diaryMeta?.timezone || "Europe/Minsk",
      locale: schoolData.school?.locale || diaryMeta?.locale || "ru-BY"
    };
    school.academicYear = normalizeAcademicYear(
      schoolData.school?.academicYear,
      diaryMeta?.schoolYear,
      school.id,
    );
    const withSchoolId = (items) =>
      (Array.isArray(items) ? items : []).map((item) => ({
        ...item,
        schoolId: item.schoolId || school.id
      }));
    const users = withSchoolId(schoolData.users);
    const classes = withSchoolId(schoolData.classes);
    const students = withSchoolId(schoolData.students);
    const subjects = withSchoolId(schoolData.subjects);
    const groups = withSchoolId(schoolData.groups);
    const lessonTemplates = withSchoolId(schoolData.lessonTemplates);
    const teacherAssignments = withSchoolId(schoolData.teacherAssignments);

    return {
      ...school,
      users,
      classes,
      students,
      subjects,
      groups,
      lessonTemplates,
      teacherAssignments,
      usersById: indexById(users),
      classesById: indexById(classes),
      studentsById: indexById(students),
      subjectsById: indexById(subjects),
      groupsById: indexById(groups),
      schedule: schoolData.schedule || {},
      messages: Array.isArray(schoolData.messages) ? schoolData.messages : []
    };
  }

  function getTeacherAssignments(model, teacherId) {
    return model.school.teacherAssignments
      .filter((assignment) => assignment.teacherId === teacherId)
      .map((assignment) => decorateAssignment(model, assignment));
  }

  function getLessonsForAssignment(model, assignment) {
    return model.lessons.filter(
      (lesson) => {
        const template =
          model.lessonTemplatesById[lesson.templateId] || lesson;
        return (
          template.subjectId === assignment.subjectId &&
          template.classId === assignment.classId &&
          (!assignment.groupId || template.groupId === assignment.groupId)
        );
      },
    );
  }

  function getLessonsForAssignmentTerm(model, assignment, termId) {
    const term = model.school.academicYear.terms.find(
      (item) => item.id === termId,
    );
    if (!term) return [];

    const templates = model.lessonTemplates.filter((template) =>
      templateMatchesAssignment(template, assignment),
    );
    const actualLessons = new Map(
      model.lessons
        .filter((lesson) => term.startsOn <= lesson.date && lesson.date <= term.endsOn)
        .map((lesson) => [`${lesson.templateId}_${lesson.date}`, lesson]),
    );
    const lessons = [];

    for (
      let date = term.startsOn;
      date && date <= term.endsOn;
      date = addIsoDays(date, 1)
    ) {
      if (isSchoolBreakDate(model.school.academicYear.breaks, date)) continue;
      const dayKey = getDayKeyByIsoDate(date);

      templates
        .filter((template) => template.weekday === dayKey)
        .forEach((template) => {
          const actual = actualLessons.get(`${template.id}_${date}`);
          lessons.push(
            actual || createProjectedLesson(model, template, date, term.id),
          );
        });
    }

    return lessons.sort((first, second) =>
      `${first.date}_${first.startsAt}`.localeCompare(
        `${second.date}_${second.startsAt}`,
      ),
    );
  }

  function getStudentsForAssignment(model, assignment) {
    const classItem = model.school.classesById[assignment.classId];
    if (!classItem) return [];

    return classItem.studentIds
      .map((studentId) => model.school.studentsById[studentId])
      .filter(Boolean)
      .filter((student) => !assignment.groupId || student.groupIds?.includes(assignment.groupId));
  }

  function decorateAssignment(model, assignment) {
    const classItem = model.school.classesById[assignment.classId];
    const subject = model.school.subjectsById[assignment.subjectId];
    const group = assignment.groupId ? model.school.groupsById[assignment.groupId] : null;

    return {
      ...assignment,
      classTitle: classItem?.title || assignment.classId,
      subjectTitle: subject?.title || assignment.subjectId,
      groupTitle: group?.title || "",
      studentCount: getStudentsForAssignment(model, assignment).length
    };
  }

  function templateMatchesAssignment(template, assignment) {
    return (
      template.subjectId === assignment.subjectId &&
      template.classId === assignment.classId &&
      (!assignment.groupId || template.groupId === assignment.groupId)
    );
  }

  function createProjectedLesson(model, template, date, termId) {
    const subject = model.school.subjectsById[template.subjectId];
    return {
      id: `lesson_${template.id}_${date}`,
      schoolId: model.school.id,
      schoolYearId: model.school.academicYear.id,
      termId,
      templateId: template.id,
      dayKey: template.weekday,
      date,
      status: "scheduled",
      number: template.number,
      subjectId: template.subjectId,
      classId: template.classId,
      groupId: template.groupId || "",
      teacherId: template.teacherId || "",
      subject: subject?.title || template.subjectId,
      startsAt: template.startsAt,
      endsAt: template.endsAt,
      time: `${template.startsAt}–${template.endsAt}`,
      room: template.room || "",
      homework: "",
      grade: "",
    };
  }

  function isSchoolBreakDate(breaks, date) {
    return breaks.some(
      (item) => item.startsOn <= date && date <= item.endsOn,
    );
  }

  function getDayKeyByIsoDate(value) {
    const parts = parseIsoDateParts(value);
    if (!parts) return "";
    return [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ][new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()];
  }

  function getTermForDate(model, date) {
    return (
      model.school.academicYear.terms.find(
        (term) => term.startsOn <= date && date <= term.endsOn,
      ) || null
    );
  }

  function indexById(items) {
    return items.reduce((index, item) => {
      index[item.id] = item;
      return index;
    }, {});
  }

  function createSubjectAliasMap(subjects) {
    const map = new Map();
    subjects.forEach((subject) => {
      map.set(normalizeSubjectTitle(subject.title), subject.id);
      (subject.aliases || []).forEach((alias) => {
        map.set(normalizeSubjectTitle(alias), subject.id);
      });
    });
    return map;
  }

  function createSubjectId(subject = "") {
    const normalized = normalizeSubjectTitle(subject)
      .replace(/[^a-zа-я0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "");

    return normalized || "subject";
  }

  function normalizeSubjectTitle(subject = "") {
    return subject.toString().trim().toLowerCase().replace(/ё/g, "е");
  }

  function parseLessonTime(time = "") {
    const [startsAt = "", endsAt = ""] = time.split(/[–-]/).map((part) => part.trim());
    return { startsAt, endsAt };
  }

  function findTeacherAssignment(school, lesson) {
    return school.teacherAssignments.find(
      (assignment) =>
        assignment.subjectId === lesson.subjectId &&
        assignment.classId === lesson.classId &&
        (!assignment.groupId || assignment.groupId === lesson.groupId),
    );
  }

  function createLessonTemplateId({
    schoolId,
    classId,
    groupId,
    subjectId,
    dayKey,
    number,
    startsAt,
  }) {
    return [
      "template",
      schoolId,
      classId,
      groupId || subjectId,
      dayKey,
      number || startsAt,
    ]
      .map(toStableIdPart)
      .filter(Boolean)
      .join("_");
  }

  function getLessonDate(weekStart, dayKey, dayOrder) {
    const dayOffset = dayOrder.indexOf(dayKey);
    return dayOffset < 0 ? "" : addIsoDays(weekStart, dayOffset);
  }

  function normalizeAcademicYear(source = {}, legacyTitle = "", schoolId = "") {
    const title = source.title || legacyTitle || "";
    const id = source.id || toStableIdPart(`academic-year-${title}`);
    const breaks = (Array.isArray(source.breaks) ? source.breaks : []).filter(
      (item) =>
        item?.id &&
        parseIsoDateParts(item.startsOn) &&
        parseIsoDateParts(item.endsOn) &&
        item.startsOn <= item.endsOn,
    ).map((item) => ({
      ...item,
      schoolId,
      academicYearId: id
    }));
    const terms = (Array.isArray(source.terms) ? source.terms : [])
      .filter(
        (item) =>
          item?.id &&
          parseIsoDateParts(item.startsOn) &&
          parseIsoDateParts(item.endsOn) &&
          item.startsOn <= item.endsOn,
      )
      .map((item, index) => ({
        ...item,
        schoolId,
        academicYearId: id,
        order: Number.isInteger(item.order) ? item.order : index + 1,
      }));

    return {
      id,
      schoolId,
      title,
      startsOn: parseIsoDateParts(source.startsOn) ? source.startsOn : "",
      endsOn: parseIsoDateParts(source.endsOn) ? source.endsOn : "",
      breaks,
      terms,
      halfYears: Array.isArray(source.halfYears) ? source.halfYears : []
    };
  }

  function toStableIdPart(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^a-zа-я0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "");
  }

  function normalizeDayState({ dayKey, hasDayData, lessonCount, source }) {
    if (source?.type === "holiday") {
      return {
        type: "holiday",
        title: source.title || "",
        description: source.description || "",
      };
    }
    if (!hasDayData) return { type: "missing" };
    if (lessonCount) return { type: "lessons" };
    if (dayKey === "saturday" || dayKey === "sunday") {
      return { type: "weekend" };
    }
    return { type: "empty" };
  }

export {
  createLessonTemplateId,
  getLessonDate,
  normalizeDayState,
  normalizeDiaryData
};
