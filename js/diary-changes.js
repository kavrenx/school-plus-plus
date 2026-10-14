import { DAY_ORDER } from "./app-config.js";
import { normalizeDiaryData } from "./diary-model.js";
import { escapeHtml as e } from "./ui-utils.js";
import { getSubjectSearchNames } from "./subject-names.js";

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
      subjectTitle:
        model.school.subjectsById[lesson.subjectId]?.title || lesson.subject,
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
        subjectTitle: current.subjectTitle || current.subject,
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
        syncedAt: snapshot.importedAt || timestamp,
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
    importShared(events) {
      if (!Array.isArray(events)) return;
      const readIds = new Set(state.changes.filter((change) => change.read).map((change) => change.id));
      state.changes = events.slice(0,150).map((event) => ({ ...event, read: readIds.has(event.id) }));
      save();
    },
    markRead() {
      state.changes.forEach((change) => (change.read = true));
      save();
    },
  };
}

const CHANGE_KINDS = {
  grades: "Отметки",
  homework: "Домашнее задание",
  materials: "Новые материалы",
};
const displayChangeValue = (value) =>
  Array.isArray(value) ? value.join("/") : String(value || "");
const normalizeSearch = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .trim()
    .replace(/\s+/g, " ");

function getChangeSyncDay(change, timeZone = "Europe/Minsk") {
  const date = new Date(change.syncedAt || change.detectedAt || "");
  if (!Number.isFinite(date.getTime())) return change.date || "";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (name) => parts.find((item) => item.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function matchesChangeSearch(change, query) {
  const text = normalizeSearch(query);
  if (!text) return true;
  if (/^(?:10|[1-9])(?:\s*\/\s*(?:10|[1-9]))?$/.test(text)) {
    if (change.type !== "grades") return false;
    const pair = text.replace(/\s/g, "");
    const values = [change.before, change.after];
    return pair.includes("/")
      ? values.some((value) => displayChangeValue(value).replace(/\s/g, "") === pair)
      : values.some((value) =>
          (Array.isArray(value) ? value : []).some(
            (grade) => String(grade) === pair,
          ),
        );
  }
  const haystack = normalizeSearch(
    [
      ...getSubjectSearchNames(change.subject),
      change.subjectTitle,
      CHANGE_KINDS[change.type],
      change.type === "grades"
        ? "оценка оценки"
        : change.type === "materials"
          ? "файл файлы вложение"
          : "дз задание",
      displayChangeValue(change.before),
      displayChangeValue(change.after),
      change.date,
      change.number,
    ].join(" "),
  );
  return text.split(" ").every((word) => haystack.includes(word));
}

function groupDiaryChanges(changes, query = "", timeZone = "Europe/Minsk") {
  const groups = new Map();
  for (const change of [...changes].sort(
    (a, b) =>
      (Date.parse(b.syncedAt || b.detectedAt) || 0) -
      (Date.parse(a.syncedAt || a.detectedAt) || 0),
  )) {
    if (!matchesChangeSearch(change, query)) continue;
    const day = getChangeSyncDay(change, timeZone);
    if (!groups.has(day)) groups.set(day, { day, changes: [] });
    groups.get(day).changes.push(change);
  }
  return [...groups.values()].sort((a, b) => b.day.localeCompare(a.day));
}

function renderDiaryChangeGroups(
  state,
  formatDate,
  {
    query = "",
    today = "",
    timeZone = "Europe/Minsk",
    expandedDays = new Map(),
  } = {},
) {
  const groups = groupDiaryChanges(state.changes, query, timeZone);
  const searching = Boolean(query.trim());
  const count = groups.reduce(
    (total, group) => total + group.changes.length,
    0,
  );
  if (!groups.length)
    return searching
      ? '<p class="diary-change-search-count" role="status">Ничего не найдено</p><p class="achievement-note">Попробуй другой предмет, отметку или название файла.</p>'
      : '<div class="diary-changes-empty"><h3>Пока без изменений</h3><p>После следующей синхронизации здесь появятся новые отметки, задания и материалы.</p></div>';
  const card = (change) =>
    `<li${change.read ? "" : ' class="is-new"'}><button type="button" class="diary-change-card" data-change-date="${e(change.date)}"><span class="diary-change-kind">${e(CHANGE_KINDS[change.type])}${change.read ? "" : " · новое"}</span><strong class="diary-change-subject">${e(change.subject)}</strong><span class="diary-change-lesson"><time datetime="${e(change.date)}">${e(formatDate(change.date))}</time> · ${e(change.number)} урок</span>${change.type === "materials" ? `<span class="diary-change-text">${e((change.after || []).join(", ") || "Добавлены прикреплённые материалы")}</span>` : `${change.before?.length ? `<span class="diary-change-text diary-change-before">Было: ${e(displayChangeValue(change.before))}</span>` : ""}<span class="diary-change-text">${change.before?.length ? "Стало" : "Добавлено"}: <strong>${e(displayChangeValue(change.after))}</strong></span>`}</button></li>`;
  return `${searching ? `<p class="diary-change-search-count" role="status">Найдено: ${count}</p>` : ""}<div class="diary-change-days">${groups
    .map(({ day, changes }) => {
      const expanded = searching || (expandedDays.get(day) ?? day === today);
      const id = `changes-day-${day}`;
      return `<section class="diary-change-day"><h3><button type="button" class="diary-change-day-toggle" data-change-day="${e(day)}" aria-expanded="${expanded}" aria-controls="${e(id)}"><span><time datetime="${e(day)}">${e(formatDate(day))}</time><small>${day === today ? "Сегодня · " : ""}Изменений: ${changes.length}</small></span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button></h3><div id="${e(id)}" class="diary-change-day-body${expanded ? " is-expanded" : ""}" aria-hidden="${!expanded}"${expanded ? "" : " inert"}><div><ol class="diary-change-list">${changes.map(card).join("")}</ol></div></div></section>`;
    })
    .join("")}</div>`;
}

function renderDiaryChanges(state, formatDate, options = {}) {
  return `<button class="subject-detail-backdrop" type="button" data-changes-close aria-label="Закрыть изменения"></button><aside class="subject-detail-drawer diary-changes-drawer" role="dialog" aria-modal="true" aria-labelledby="diaryChangesTitle"><header class="subject-detail-header"><button class="subject-detail-close" type="button" data-changes-close aria-label="Закрыть">×</button><h2 id="diaryChangesTitle" tabindex="-1">Что изменилось</h2></header><div class="diary-changes-search"><span class="diary-search-decoration" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.7"/></svg><span>Поиск</span></span><input type="search" data-changes-search-input placeholder="Поиск" aria-label="Поиск изменений" autocomplete="off" maxlength="200"><button type="button" class="diary-changes-search-clear" data-changes-search-clear aria-label="Очистить поиск" hidden>×</button></div><div data-changes-results>${renderDiaryChangeGroups(state, formatDate, options)}</div></aside>`;
}

export {
  createChangeSnapshot,
  compareChangeSnapshots,
  createDiaryChangeTracker,
  renderDiaryChanges,
  renderDiaryChangeGroups,
  groupDiaryChanges,
  getChangeSyncDay,
  matchesChangeSearch,
};
