import assert from "node:assert/strict";
import test from "node:test";

import {
  createStorageObjectName,
  truncateFileName,
} from "../js/support-repository.js";

test("support storage uses a short safe key while preserving the extension", () => {
  const name = createStorageObjectName(
    "Очень длинное название файла с пробелами и русскими буквами.PNG",
  );

  assert.match(name, /^[0-9a-f-]+\.png$/);
  assert.doesNotMatch(name, /[а-я\s]/i);
});

test("support keeps the end of a long display filename", () => {
  const name = `${"важное-задание-".repeat(20)}.txt`;
  const shortened = truncateFileName(name, 40);

  assert.equal(shortened.length, 40);
  assert.match(shortened, /…\.txt$/);
});
