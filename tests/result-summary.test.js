import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  getDisplayAverageSummary,
  getResultDisplayColumns,
} from "../js/result-periods.js";
import { renderAchievementTable } from "../js/achievement-view.js";

const year = {
  id: "year",
  title: "2026/2027",
  terms: [1, 2, 3, 4].map((n) => ({ id: `q${n}` })),
};
const columns = getResultDisplayColumns(year);
function subject({
  grades = [],
  final = "",
  halfFinal = "",
  annual = "",
  half = false,
  passFail = false,
} = {}) {
  return {
    assignment: {
      id: "synthetic-subject",
      title: "Тестовый предмет",
      assessmentPeriod: half ? "half-year" : "quarter",
      gradingScale: passFail ? "pass-fail" : "numeric",
    },
    annual,
    halfYearFinals: { year_half_1: halfFinal },
    periods: year.terms.map((term, index) => ({
      term,
      final: index === 0 ? final : "",
      records: [{ entry: { grades: index === 0 ? grades : [] } }],
    })),
  };
}

test("period summary rounds each subject first and gives subjects equal weight", () => {
  const results = [
    subject({ grades: ["8", "9"] }),
    subject({ grades: ["7", "7", "7", "7", "9"] }),
  ];
  const original = structuredClone(results);
  // 8.5 -> 9, 7.4 -> 7, then (9 + 7) / 2. Not a pooled lesson average.
  assert.deepEqual(getDisplayAverageSummary(results, columns[0]), {
    average: 8,
    isForecast: true,
  });
  assert.deepEqual(results, original);
});

test("an official final overrides current grades while mixed summaries stay preliminary", () => {
  assert.deepEqual(
    getDisplayAverageSummary(
      [
        subject({ grades: ["10"], final: "6" }),
        subject({ grades: ["8", "9"] }),
      ],
      columns[0],
    ),
    { average: 7.5, isForecast: true },
  );
  assert.deepEqual(
    getDisplayAverageSummary(
      [
        subject({ grades: ["10"], final: "6" }),
        subject({ grades: ["8", "9"], final: "9" }),
      ],
      columns[0],
    ),
    { average: 7.5, isForecast: false },
  );
});

test("empty, pass/fail and nonnumeric official results do not contribute a zero or forecast", () => {
  const results = [
    subject(),
    subject({ grades: ["зачёт"], final: "зачёт", passFail: true }),
    subject({ grades: ["10"], passFail: true }),
    subject({ grades: ["10"], final: "н/а" }),
  ];
  assert.deepEqual(getDisplayAverageSummary(results, columns[0]), {
    average: null,
    isForecast: false,
  });
  assert.deepEqual(
    getDisplayAverageSummary([...results, subject({ final: "9" })], columns[0]),
    { average: 9, isForecast: false },
  );
});

test("repeated numeric grades are retained when calculating a subject forecast", () => {
  assert.deepEqual(
    getDisplayAverageSummary(
      [subject({ grades: ["9", "9", "5", "зачёт"] })],
      columns[0],
    ),
    { average: 8, isForecast: true },
  );
});

test("art follows the existing pass/fail rule even without scale metadata", () => {
  const art = subject({ grades: ["10"] });
  art.assignment.title = "Искусство";
  delete art.assignment.gradingScale;
  assert.deepEqual(getDisplayAverageSummary([art], columns[0]), {
    average: null,
    isForecast: false,
  });
});

test("half-year subjects contribute only to their matching display column", () => {
  const half = subject({ grades: ["10"], half: true });
  half.periods[1].records[0].entry.grades = ["6", "6"];
  assert.deepEqual(getDisplayAverageSummary([half], columns[0]), {
    average: null,
    isForecast: false,
  });
  assert.deepEqual(getDisplayAverageSummary([half], columns[1]), {
    average: 7,
    isForecast: true,
  });
  half.halfYearFinals.year_half_1 = "9";
  assert.deepEqual(getDisplayAverageSummary([half], columns[1]), {
    average: 9,
    isForecast: false,
  });
});

test("annual column keeps official annual results and does not invent a forecast", () => {
  assert.deepEqual(
    getDisplayAverageSummary([subject({ grades: ["10"] })], columns.at(-1)),
    { average: null, isForecast: false },
  );
  assert.deepEqual(
    getDisplayAverageSummary(
      [subject({ annual: "8" }), subject({ grades: ["10"] })],
      columns.at(-1),
    ),
    { average: 8, isForecast: false },
  );
});

test("summary uses existing forecast styling, accessible labels and final styling", () => {
  const window = new Window();
  try {
    window.document.body.innerHTML = renderAchievementTable(
      [subject({ grades: ["8", "9"], annual: "8" })],
      year,
    );
    let cells = window.document
      .querySelector(".result-summary")
      .querySelectorAll("td");
    assert.equal(cells[0].textContent, "9,0");
    assert.match(
      cells[0].querySelector(".result-forecast").getAttribute("aria-label"),
      /Предварительный/,
    );
    assert.equal(cells[2].textContent, "—");
    assert.equal(cells[2].querySelector(".result-forecast"), null);
    assert.equal(cells[4].querySelector("strong").textContent, "8,0");
    window.document.body.innerHTML = renderAchievementTable(
      [subject({ grades: ["10"], final: "7" })],
      year,
    );
    cells = window.document
      .querySelector(".result-summary")
      .querySelectorAll("td");
    assert.equal(cells[0].querySelector(".result-forecast"), null);
    assert.equal(cells[0].querySelector("strong").textContent, "7,0");
  } finally {
    window.close();
  }
});
