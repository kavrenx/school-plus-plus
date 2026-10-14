import assert from "node:assert/strict";
import test from "node:test";
import { formatDiaryFreshness } from "../js/diary-freshness.js";

test("freshness shows only time today and adds a short date for older data", () => {
  const now = new Date("2026-10-14T20:00:00Z");
  assert.equal(
    formatDiaryFreshness("2026-10-14T19:53:00Z", now),
    "Обновлено в 22:53",
  );
  assert.equal(
    formatDiaryFreshness("2026-10-13T19:53:00Z", now),
    "Обновлено в 22:53, 13.10",
  );
  assert.equal(
    formatDiaryFreshness(
      "2026-10-13T21:01:00Z",
      new Date("2026-10-13T22:00:00Z"),
    ),
    "Обновлено в 00:01",
  );
  assert.equal(formatDiaryFreshness(null, now), "");
  assert.equal(formatDiaryFreshness("invalid", now), "");
});
