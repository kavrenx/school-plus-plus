function renderDiaryTable(lessons, translate) {
  return `
    <table class="diary-table">
      <colgroup>
        <col class="diary-lesson-col">
        <col class="diary-homework-col">
        <col class="diary-grade-col">
        <col class="diary-attendance-col">
      </colgroup>
      <thead>
        <tr>
          <th>${translate("lessonHeader")}</th>
          <th>${translate("homeworkHeader")}</th>
          <th>${translate("gradeHeader")}</th>
          <th>${translate("attendanceHeader")}</th>
        </tr>
      </thead>
      <tbody>
        ${lessons.map((lesson) => renderLessonRow(lesson, translate)).join("")}
      </tbody>
    </table>
  `;
}

function renderDiaryEmptyState({ label, title, description }) {
  return `
    <div class="empty-state">
      <p class="empty-state-label">${escapeHtml(label)}</p>
      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(description)}</p>
    </div>
  `;
}

function renderLessonRow(lesson, translate) {
  const homework = lesson.homework
    ? localizeHomework(lesson.homework, translate)
    : "—";
  const grade = lesson.grade
    ? `<span class="grade">${escapeHtml(lesson.grade)}</span>`
    : "—";
  const attendance =
    lesson.attendance === "absent"
      ? '<span class="attendance-mark is-absent">Отсутствие</span>'
      : lesson.attendance === "present"
        ? '<span class="attendance-mark is-present">Присутствовал</span>'
      : '<span class="attendance-mark is-unmarked">Не отмечено</span>';
  const details = renderJournalDetails(lesson.journalEntry, lesson.lessonWork);
  const lessonMeta = [
    lesson.time,
    lesson.room ? `${translate("room")} ${lesson.room}` : "",
  ]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");

  return `
    <tr>
      <td data-label="${translate("lessonHeader")}">
        <div class="lesson-cell">
          <strong>${lesson.number}. <button class="lesson-subject-link" type="button" data-diary-subject="${escapeHtml(lesson.subjectId || "")}" data-diary-group="${escapeHtml(lesson.groupId || "")}">${escapeHtml(lesson.subject)}</button></strong>
          ${lessonMeta ? `<span>${lessonMeta}</span>` : ""}
        </div>
      </td>
      <td data-label="${translate("homeworkHeader")}">
        ${homework}
        ${details}
      </td>
      <td data-label="${translate("gradeHeader")}">${grade}</td>
      <td data-label="${translate("attendanceHeader")}">${attendance}</td>
    </tr>
  `;
}

function renderJournalDetails(entry, lessonWork) {
  if (!entry && !lessonWork) return "";

  const comment = entry?.comment
    ? `
      <div class="lesson-note">
        <strong>Комментарий:</strong>
        <span>${escapeHtml(entry.comment)}</span>
      </div>
    `
    : "";
  const materialLinks = Array.isArray(lessonWork?.materials)
    ? lessonWork.materials.map(renderMaterialLink).filter(Boolean).join("")
    : Array.isArray(entry?.materials)
      ? entry.materials.map(renderMaterialLink).filter(Boolean).join("")
    : "";
  const materials = materialLinks
    ? `
      <div class="lesson-materials">
        <strong>Материалы:</strong>
        <span>${materialLinks}</span>
      </div>
    `
    : "";

  return comment || materials
    ? `<div class="lesson-extras">${comment}${materials}</div>`
    : "";
}

function renderMaterialLink(value, index) {
  const url = getSafeMaterialUrl(value);
  if (!url) return "";
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Материал ${index + 1}</a>`;
}

function getSafeMaterialUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function countHomework(lessons) {
  return lessons.filter((lesson) => {
    const homework = (lesson.homework || "").trim().toLowerCase();
    return (
      homework &&
      homework !== "нет дз" &&
      homework !== "no homework" &&
      homework !== "—"
    );
  }).length;
}

function getLessonWord(count) {
  if (count % 10 === 1 && count % 100 !== 11) return "урок";
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100))
    return "урока";
  return "уроков";
}

function localizeHomework(value, translate) {
  const text = String(value);
  if (text.trim().toLowerCase() === "нет дз") return translate("noHomework");
  return escapeHtml(text);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export {
  countHomework,
  getSafeMaterialUrl,
  getLessonWord,
  renderDiaryEmptyState,
  renderDiaryTable,
};
