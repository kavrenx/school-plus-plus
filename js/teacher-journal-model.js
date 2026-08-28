const LESSON_PROGRESS = Object.freeze({
  scheduled: "scheduled",
  inProgress: "in-progress",
  completed: "completed",
  cancelled: "cancelled",
});

const ATTENDANCE_STATUS = Object.freeze({
  unmarked: "unmarked",
  present: "present",
  absent: "absent",
});

function resolveLessonProgress({
  lesson,
  entries = [],
  lessonWork = null,
  instant = new Date(),
  timeZone = "UTC",
} = {}) {
  if (lesson?.status === "cancelled") return LESSON_PROGRESS.cancelled;

  const hasActivity = hasLessonActivity(entries, lessonWork);
  if (!hasActivity) return LESSON_PROGRESS.scheduled;

  return hasLessonEnded(lesson, instant, timeZone)
    ? LESSON_PROGRESS.completed
    : LESSON_PROGRESS.inProgress;
}

function resolveStudentAttendance(entry, lessonProgress) {
  if (entry?.attendance === "absent") return ATTENDANCE_STATUS.absent;
  if (hasStudentPresenceEvidence(entry)) return ATTENDANCE_STATUS.present;
  if (lessonProgress === LESSON_PROGRESS.completed) {
    return ATTENDANCE_STATUS.present;
  }
  return ATTENDANCE_STATUS.unmarked;
}

function hasLessonActivity(entries = [], lessonWork = null) {
  return (
    entries.some(hasMeaningfulStudentEntry) ||
    hasMeaningfulLessonWork(lessonWork)
  );
}

function hasMeaningfulStudentEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  return Boolean(
    entry.attendance === "absent" ||
      normalizeValues(entry.grades).length ||
      String(entry.comment || "").trim(),
  );
}

function hasStudentPresenceEvidence(entry) {
  if (!entry || typeof entry !== "object") return false;
  return Boolean(
    normalizeValues(entry.grades).length || String(entry.comment || "").trim(),
  );
}

function hasMeaningfulLessonWork(lessonWork) {
  if (!lessonWork || typeof lessonWork !== "object") return false;
  return Boolean(
    lessonWork.noHomework ||
      String(lessonWork.homework || "").trim() ||
      normalizeValues(lessonWork.materials).length,
  );
}

function hasLessonEnded(lesson, instant = new Date(), timeZone = "UTC") {
  if (!lesson?.date || !isTimeValue(lesson.endsAt)) return false;
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) return false;

  const currentSchoolTime = getSchoolDateTimeKey(instant, timeZone);
  return Boolean(
    currentSchoolTime &&
      currentSchoolTime >= `${lesson.date}T${lesson.endsAt}`,
  );
}

function getSchoolDateTimeKey(instant, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
  } catch {
    return "";
  }
}

function isTimeValue(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function normalizeValues(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value).trim()).filter(Boolean)
    : [];
}

function groupAssignmentsByClass(assignments = []) {
  const groups = new Map();

  assignments.forEach((assignment) => {
    if (!assignment?.classId) return;
    if (!groups.has(assignment.classId)) {
      groups.set(assignment.classId, {
        classId: assignment.classId,
        classTitle: assignment.classTitle || assignment.classId,
        studentCount: assignment.studentCount || 0,
        assignments: [],
      });
    }
    groups.get(assignment.classId).assignments.push(assignment);
  });

  return Array.from(groups.values()).sort((first, second) =>
    first.classTitle.localeCompare(second.classTitle, "ru", {
      numeric: true,
    }),
  );
}

function calculateGradeStats(entries = []) {
  const grades = entries
    .flatMap((entry) => normalizeValues(entry?.grades))
    .filter(isNumericGrade)
    .map(Number);
  const average = grades.length
    ? grades.reduce((total, value) => total + value, 0) / grades.length
    : null;

  return {
    count: grades.length,
    average,
  };
}

function getJournalCellPresentation(entry) {
  if (!entry) return { label: "", kind: "empty", hasComment: false };
  const hasComment = Boolean(String(entry.comment || "").trim());

  if (entry.attendance === "absent") {
    return { label: "Н", kind: "absent", hasComment };
  }

  const grades = normalizeValues(entry.grades).map(toShortGradeLabel);
  if (grades.length) {
    return {
      label: grades.join(" / "),
      kind: "grade",
      hasComment,
    };
  }

  return {
    label: hasComment ? "!" : "",
    kind: hasComment ? "comment" : "empty",
    hasComment,
  };
}

function formatGradeAverage(value) {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(1).replace(".", ",");
}

function isNumericGrade(value) {
  return /^(?:10|[1-9])$/.test(String(value));
}

function toShortGradeLabel(value) {
  if (value === "зачёт") return "зач.";
  if (value === "незачёт") return "незач.";
  return value;
}

export {
  ATTENDANCE_STATUS,
  LESSON_PROGRESS,
  calculateGradeStats,
  formatGradeAverage,
  getJournalCellPresentation,
  groupAssignmentsByClass,
  hasLessonActivity,
  hasLessonEnded,
  resolveLessonProgress,
  resolveStudentAttendance,
};
