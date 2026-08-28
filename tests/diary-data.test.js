import assert from "node:assert/strict";
import test from "node:test";
import { createDiaryWeeks } from "../data/diary-data.js";

test("creates a complete set of school weeks for every quarter", () => {
  const weeks = createDiaryWeeks([
    {
      id: "term-1",
      startsOn: "2025-09-01",
      endsOn: "2025-09-14",
    },
    {
      id: "term-2",
      startsOn: "2025-11-10",
      endsOn: "2025-11-16",
    },
  ]);

  assert.equal(weeks.length, 3);
  assert.equal(weeks[0].termId, "term-1");
  assert.equal(weeks[0].days.monday.length, 6);
  assert.equal(weeks[2].start, "2025-11-10");
  assert.notEqual(weeks[0].days.monday, weeks[1].days.monday);
});
