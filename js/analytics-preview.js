import { normalizeDiaryData } from "./diary-model.js";
import { DAY_ORDER } from "./app-config.js";

function createAnalyticsPreviewData(rawDiary, rawSchool) {
  const diary = structuredClone(rawDiary);
  const school = structuredClone(rawSchool);
  const student = school.users.find((user) => user.role === "student");
  Object.assign(student, {
    firstName: "Анна",
    lastName: "Иванова",
    displayName: "Иванова Анна",
    className: "11 «А»",
  });
  const classItem = school.classes.find((item) => item.id === student.classId);
  if (classItem) classItem.title = "11 «А»";
  school.subjects.push({
    id: "russian_literature",
    title: "Русская литература",
    aliases: ["Рус. лит."],
    assessmentPeriod: "half-year",
  });
  for (const item of school.teacherAssignments) {
    if (
      ["russian_literature", "belarusian_literature"].includes(item.subjectId)
    )
      item.assessmentPeriod = "half-year";
  }
  const model = normalizeDiaryData(diary, DAY_ORDER, school);
  const counts = new Map();
  const journalEntries = model.lessons
    .filter(
      (lesson) => lesson.date >= "2026-09-01" && lesson.date <= "2026-10-05",
    )
    .map((lesson) => {
      const index = counts.get(lesson.subjectId) || 0;
      counts.set(lesson.subjectId, index + 1);
      const graded = index % 3 === 0;
      return {
        lessonId: lesson.id,
        studentId: student.id,
        grades: graded
          ? lesson.subject === "Искусство"
            ? ["зачёт"]
            : index === 3
              ? ["8", "9"]
              : [String([7, 8, 6, 9, 10][Math.floor(index / 3) % 5])]
          : [],
        homework: lesson.homework || "",
      };
    });
  return {
    diary,
    school,
    journalEntries,
    importedAt: "2026-10-05T12:00:00Z",
    hasSyncedData: true,
  };
}

function createPreviewChangeBaseline(data) {
  const baseline = structuredClone(data);
  baseline.importedAt = "2026-10-04T12:00:00Z";
  const marked = [...baseline.journalEntries]
    .reverse()
    .find((entry) => entry.grades.length && entry.grades[0] !== "зачёт");
  if (marked) marked.grades = ["6"];
  const homework = baseline.diary.weeks.find(
    (week) => week.start <= "2026-10-05" && "2026-10-05" <= week.end,
  )?.days.monday?.[0];
  if (homework) homework.homework = "Прочитать параграф";
  const entry =
    homework &&
    baseline.journalEntries.find(
      (item) =>
        item.lessonId ===
        `${baseline.diary.weeks.find((week) => week.start <= "2026-10-05" && "2026-10-05" <= week.end).id}_monday_${homework.number}`,
    );
  if (entry) entry.homework = "Прочитать параграф";
  return baseline;
}

export { createAnalyticsPreviewData, createPreviewChangeBaseline };
