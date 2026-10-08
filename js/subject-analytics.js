const validGrade = (value) =>
  Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10;
const mean = (values) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

function getSubjectAnalytics(records = []) {
  const ordered = [...records].sort((a, b) =>
    `${a.lesson.date}_${a.lesson.startsAt || ""}_${a.lesson.id}`.localeCompare(
      `${b.lesson.date}_${b.lesson.startsAt || ""}_${b.lesson.id}`,
    ),
  );
  const grades = [];
  const points = [];
  const distribution = Array.from({ length: 10 }, (_, index) => ({
    grade: index + 1,
    count: 0,
  }));
  for (const { lesson, entry } of ordered) {
    const values = (entry.grades || []).filter(validGrade).map(Number);
    if (!values.length) continue;
    grades.push(...values);
    values.forEach((grade) => distribution[grade - 1].count++);
    points.push({
      date: lesson.date,
      lessonId: lesson.id,
      grades: values,
      average: mean(grades),
    });
  }
  return {
    count: grades.length,
    average: mean(grades),
    recentCount: Math.min(5, grades.length),
    recentAverage: mean(grades.slice(-5)),
    distribution,
    points,
  };
}

function calculateGradeOptions(
  grades,
  target,
  remainingLessons,
  mode = "rounded",
) {
  const numeric = grades.filter(validGrade).map(Number);
  const desired = Number(target);
  const available = Math.max(0, Math.floor(Number(remainingLessons) || 0));
  if (!Number.isInteger(desired) || desired < 1 || desired > 10)
    return { status: "invalid", options: [] };
  const threshold = mode === "exact" ? desired : Math.max(1, desired - 0.5);
  const sum = numeric.reduce((total, grade) => total + grade, 0);
  const currentAverage = mean(numeric);
  const base = {
    target: desired,
    threshold,
    mode,
    remainingLessons: available,
    currentAverage,
    options: [],
  };
  if (currentAverage !== null && currentAverage >= threshold)
    return { ...base, status: "reached" };
  const options = new Map();
  function add(values, label) {
    const projectedAverage =
      (sum + values.reduce((total, value) => total + value, 0)) /
      (numeric.length + values.length);
    if (projectedAverage + 1e-10 < threshold || values.length > available)
      return;
    const sorted = [...values].sort((a, b) => a - b);
    const key = sorted.join(",");
    if (!options.has(key))
      options.set(key, {
        grades: sorted,
        count: sorted.length,
        projectedAverage,
        label,
      });
  }
  let minimum = 0;
  for (let count = 1; count <= available; count++) {
    const required = Math.max(
      count,
      Math.ceil(threshold * (numeric.length + count) - sum - 1e-10),
    );
    if (required > count * 10) continue;
    const lower = Math.floor(required / count);
    add(
      Array.from(
        { length: count },
        (_, i) => lower + (i < required % count ? 1 : 0),
      ),
      minimum ? "Больше отметок, ниже нагрузка" : "Минимум новых отметок",
    );
    if (!minimum) minimum = count;
    if (count >= minimum + 2) break;
  }
  // Uniform options are easy to compare and don't enumerate exponentially many combinations.
  for (let grade = 10; grade >= 2; grade--) {
    for (let count = 1; count <= available; count++) {
      if (
        (sum + grade * count) / (numeric.length + count) + 1e-10 >=
        threshold
      ) {
        add(Array(count).fill(grade), `Только отметки ${grade}`);
        break;
      }
    }
  }
  const candidates = [...options.values()];
  const first = candidates.shift();
  const uniform = candidates.filter((item) => item.label.startsWith("Только"));
  const mixed = candidates.filter((item) => !item.label.startsWith("Только"));
  const selected = first
    ? [first, ...uniform.slice(0, 2), ...mixed, ...uniform.slice(2)].slice(0, 5)
    : [];
  return {
    ...base,
    status: selected.length ? "possible" : "impossible",
    options: selected,
    bestAverage: available
      ? (sum + available * 10) / (numeric.length + available)
      : currentAverage,
  };
}

function projectGrades(grades, hypothetical = []) {
  const actual = grades.filter(validGrade).map(Number);
  const added = hypothetical.filter(validGrade).map(Number);
  const projectedAverage = mean([...actual, ...added]);
  return {
    currentAverage: mean(actual),
    projectedAverage,
    rounded: projectedAverage === null ? null : Math.round(projectedAverage),
    count: added.length,
  };
}

export { calculateGradeOptions, getSubjectAnalytics, projectGrades };
