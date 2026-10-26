// Educational data generated solely for tests and local CPU measurements.
function createSyntheticUserscriptExport({
  weeks = 1,
  lessonsPerDay = 1,
  mark = "9/9",
} = {}) {
  const record = (url, body) => ({ url, body, method: "GET", status: 200 });
  const network = {
    year: record("/api/v1/education/diary/school_year", {
      uuid: "synthetic-year",
      label: "2026/2027",
      start_ts: Date.parse("2026-09-01") / 1000,
      end_ts: Date.parse("2027-08-31") / 1000,
    }),
  };
  for (let week = 0; week < weeks; week++) {
    network[`week-${week}`] = record(
      `/api/v1/education/diary/schools/synthetic-school/classes/synthetic-class/students/synthetic-student/lessons?week_activity_uuid=synthetic-week-${week}`,
      Array.from({ length: 5 }, (_, day) => ({
        date: Date.parse("2026-09-07") / 1000 + (week * 7 + day) * 86400,
        day_of_week: day + 1,
        slots: Array.from({ length: lessonsPerDay }, (_, slot) => ({
          lesson_uuid: `synthetic-${week}-${day}-${slot}`,
          number: slot + 1,
          subject_title: slot % 2 ? "Физика" : "Математика",
          homework: "Синтетическое задание для проверки импорта",
          lesson_mark: { mark },
        })),
      })),
    );
  }
  return JSON.stringify({
    type: "schoolpp-ios-export-v1",
    report: {
      type: "schoolpp-ios-collection-v1",
      result: "collection_ready",
      elapsedMs: 12000,
      checks: {
        collection: {
          expectedWeeks: weeks,
          loadedWeeks: weeks,
          failedWeeks: 0,
        },
      },
    },
    snapshot: {
      source: "e-schools.by",
      schemaVersion: 1,
      capturedAt: "2026-10-26T00:00:00Z",
      import: { transport: "userscript", complete: true, expectedWeeks: weeks },
      pages: {
        synthetic: {
          studentIdentity: { name: "Тестовый Ученик", classTitle: "8 Б" },
        },
      },
      network,
    },
  });
}

export { createSyntheticUserscriptExport };
