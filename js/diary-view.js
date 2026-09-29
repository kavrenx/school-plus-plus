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
  const { details, materials } = renderJournalDetails(
    lesson.journalEntry,
    lesson.lessonWork,
    lesson.materials,
  );
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
      <td data-label="${translate("homeworkHeader")}" class="diary-homework-cell">
        <div class="homework-cell">
          <div class="homework-copy">${homework}${details}</div>
          ${renderMaterialControl(materials, lesson.id)}
        </div>
      </td>
      <td data-label="${translate("gradeHeader")}">${grade}</td>
      <td data-label="${translate("attendanceHeader")}">${attendance}</td>
    </tr>
  `;
}

function renderJournalDetails(entry, lessonWork, lessonMaterials = []) {

  const comment = entry?.comment
    ? `
      <div class="lesson-note">
        <strong>Комментарий:</strong>
        <span>${escapeHtml(entry.comment)}</span>
      </div>
    `
    : "";
  const materials = normalizeMaterials(
    Array.isArray(lessonWork?.materials) && lessonWork.materials.length
      ? lessonWork.materials
      : Array.isArray(entry?.materials) && entry.materials.length
        ? entry.materials
        : lessonMaterials,
  );
  return {
    details: comment
      ? `<div class="lesson-extras">${comment}</div>`
      : "",
    materials,
  };
}

function renderMaterialControl(materials, lessonId) {
  if (!materials.length) return '<span class="lesson-material-space" aria-hidden="true"></span>';
  const links = materials
    .map(
      (material, index) =>
        material.source === "e-schools"
          ? `
        <button type="button" data-es-material="${escapeHtml(encodeURIComponent(JSON.stringify(material)))}">
          <span>${escapeHtml(material.title || `Материал ${index + 1}`)}</span>
          <school-icon name="download-outline"></school-icon>
        </button>`
          : `
        <a href="${escapeHtml(material.url)}" target="_blank" rel="noopener noreferrer" download>
          <span>${escapeHtml(material.title || `Материал ${index + 1}`)}</span>
          <school-icon name="download-outline"></school-icon>
        </a>`,
    )
    .join("");
  return `
    <span class="lesson-material-control">
      <button type="button" data-material-toggle="${escapeHtml(lessonId)}" aria-label="Открыть прикреплённые материалы" aria-expanded="false">
        <school-icon name="attach-outline"></school-icon>
      </button>
      <span class="lesson-material-popover" hidden>
        <strong>Прикреплённые материалы</strong>
        <span>${links}</span>
      </span>
    </span>`;
}

function normalizeMaterials(values) {
  if (!Array.isArray(values)) return [];
  const result = [];
  values.forEach((value, index) => {
    const rawUrl = typeof value === "object" ? value?.url : value;
    const url = getSafeMaterialUrl(rawUrl);
    if (!url) return;
    result.push({
      url,
      title:
        (typeof value === "object" && String(value?.title || "").trim()) ||
        inferMaterialTitle(url) ||
        `Материал ${index + 1}`,
      ...(typeof value === "object" && value?.source === "e-schools"
        ? {
            source: "e-schools",
            sourceLessonId: String(value.sourceLessonId || ""),
            sourceEndpoint: String(value.sourceEndpoint || ""),
            sourceDate: String(value.sourceDate || ""),
            sourceLessonNumber: value.sourceLessonNumber,
            sourceStartTime: String(value.sourceStartTime || ""),
            sourceSubject: String(value.sourceSubject || ""),
          }
        : {}),
    });
  });
  return result;
}

function inferMaterialTitle(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) || "");
  } catch {
    return "";
  }
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
  normalizeMaterials,
  getLessonWord,
  renderDiaryEmptyState,
  renderDiaryTable,
};
