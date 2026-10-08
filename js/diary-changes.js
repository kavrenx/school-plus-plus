import { DAY_ORDER } from "./app-config.js";
import { normalizeDiaryData } from "./diary-model.js";
import { escapeHtml as e } from "./ui-utils.js";

const STORAGE_KEY = "schoolpp_diary_changes_v1";

function materialKey(material) {
  const url = typeof material === "string" ? material : material.url || "";
  let stableUrl = url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "objectsstore.e-schools.by")
      stableUrl = `${parsed.origin}${parsed.pathname}`;
  } catch {
    /* A source descriptor can be a relative URL. */
  }
  return `${stableUrl}|${typeof material === "object" ? material.title || "" : ""}`;
}

function createChangeSnapshot(imported) {
  if (!imported?.diary || !imported?.school) return null;
  const model = normalizeDiaryData(imported.diary, DAY_ORDER, imported.school);
  const student = model.school.users.find((user) => user.role === "student");
  if (!student) return null;
  const entries = new Map(
    (imported.journalEntries || [])
      .filter((entry) => entry.studentId === student.id)
      .map((entry) => [entry.lessonId, entry]),
  );
  const rows = {};
  for (const lesson of model.lessons) {
    const entry = entries.get(lesson.id);
    // Date, lesson number and subject survive changes in source-generated lesson IDs.
    const key = `${lesson.date}:${lesson.number}:${lesson.subjectId}:${lesson.groupId || ""}`;
    const materials = [
      ...new Map(
        [...(lesson.materials || []), ...(entry?.materials || [])]
          .filter(Boolean)
          .map((material) => [materialKey(material), material]),
      ).values(),
    ];
    rows[key] = {
      date: lesson.date,
      subject: lesson.subject,
      number: lesson.number,
      grades:
        entry?.grades || (lesson.grade ? String(lesson.grade).split("/") : []),
      homework: String(entry?.homework || lesson.homework || "").trim(),
      materials: [...new Set(materials.map(materialKey))].sort(),
      materialNames: Object.fromEntries(
        materials.map((item) => [
          materialKey(item),
          typeof item === "string" ? "Материал" : item.title || "Материал",
        ]),
      ),
    };
  }
  return {
    scope: `${model.school.id}:${model.school.academicYear.id}:${student.id}`,
    importedAt: imported.importedAt || "",
    rows,
  };
}

function compareChangeSnapshots(previous, next) {
  const merged = { ...previous };
  const changes = [];
  for (const [key, current] of Object.entries(next)) {
    const before = previous[key];
    for (const field of ["grades", "homework", "materials"]) {
      const value = current[field];
      // Missing or empty fields may be caused by a partial sync. Never infer deletion from them.
      if (!value?.length) continue;
      const old = before?.[field] || (field === "homework" ? "" : []);
      if (JSON.stringify(old) === JSON.stringify(value)) continue;
      if (field === "materials" && !value.some((item) => !old.includes(item)))
        continue;
      changes.push({
        lessonKey: key,
        date: current.date,
        subject: current.subject,
        number: current.number,
        type: field,
        before: field === "materials" ? [] : old,
        after:
          field === "materials"
            ? value
                .filter((item) => !old.includes(item))
                .map((item) => current.materialNames?.[item] || "Материал")
            : value,
      });
    }
    merged[key] = {
      ...before,
      ...current,
      grades: current.grades.length ? current.grades : before?.grades || [],
      homework: current.homework || before?.homework || "",
      materials: [
        ...new Set([...(before?.materials || []), ...current.materials]),
      ].sort(),
    };
  }
  return { rows: merged, changes };
}

function createDiaryChangeTracker(
  storage,
  clock = () => new Date().toISOString(),
) {
  let state = {
    scope: "",
    rows: {},
    changes: [],
    importedAt: "",
    checkedAt: "",
  };
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) || "null");
    if (saved?.rows && Array.isArray(saved.changes)) state = saved;
  } catch {
    /* Start a fresh baseline when saved data is unavailable. */
  }
  function save() {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* In-memory comparison still works. */
    }
  }
  return {
    record(imported) {
      const snapshot = createChangeSnapshot(imported);
      if (!snapshot) return;
      if (state.scope !== snapshot.scope) {
        state = { ...snapshot, changes: [], checkedAt: clock() };
        save();
        return;
      }
      if (
        snapshot.importedAt &&
        state.importedAt &&
        snapshot.importedAt < state.importedAt
      )
        return;
      const compared = compareChangeSnapshots(state.rows, snapshot.rows);
      const timestamp = clock();
      const events = compared.changes.map((change, index) => ({
        ...change,
        id: `${timestamp}:${index}`,
        detectedAt: timestamp,
        read: false,
      }));
      state = {
        ...state,
        rows: compared.rows,
        importedAt: snapshot.importedAt || state.importedAt,
        checkedAt: timestamp,
        changes: [...events.reverse(), ...state.changes].slice(0, 150),
      };
      save();
    },
    getState: () => structuredClone(state),
    markRead() {
      state.changes.forEach((change) => (change.read = true));
      save();
    },
  };
}

function renderDiaryChanges(state, formatDate) {
  const kinds = {
    grades: "Отметки",
    homework: "Домашнее задание",
    materials: "Новые материалы",
  };
  const display = (value) => (Array.isArray(value) ? value.join("/") : value);
  return `<button class="subject-detail-backdrop" type="button" data-changes-close aria-label="Закрыть изменения"></button><aside class="subject-detail-drawer diary-changes-drawer" role="dialog" aria-modal="true" aria-labelledby="diaryChangesTitle"><button class="subject-detail-close" type="button" data-changes-close aria-label="Закрыть">×</button><h2 id="diaryChangesTitle" tabindex="-1">Что изменилось</h2><p class="achievement-note">Сравниваем с предыдущей загрузкой на этом устройстве. Дата ниже — день урока, а не время выставления отметки.</p>${state.changes.length ? `<ol class="diary-change-list">${state.changes.map((change) => `<li${change.read ? "" : ' class="is-new"'}><span class="diary-change-kind">${e(kinds[change.type])}${change.read ? "" : " · новое"}</span><h3>${e(change.subject)}</h3><button type="button" class="diary-change-date" data-change-date="${e(change.date)}">${e(formatDate(change.date))} · ${change.number} урок</button>${change.type === "materials" ? `<p>${e(change.after.join(", ") || "Добавлены прикреплённые материалы")}</p>` : `${change.before?.length ? `<p class="diary-change-before">Было: ${e(display(change.before))}</p>` : ""}<p>${change.before?.length ? "Стало" : "Добавлено"}: <strong>${e(display(change.after))}</strong></p>`}</li>`).join("")}</ol>` : '<div class="diary-changes-empty"><h3>Пока без изменений</h3><p>Исходные данные сохранены. После следующей синхронизации здесь появятся новые отметки, задания и материалы.</p></div>'}</aside>`;
}

export {
  createChangeSnapshot,
  compareChangeSnapshots,
  createDiaryChangeTracker,
  renderDiaryChanges,
};
