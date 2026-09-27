import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml, getUploadIcon, setFieldInvalid } from "../js/ui-utils.js";

test("escapes text before inserting it into HTML", () => {
  assert.equal(
    escapeHtml(`<script title="x">Tom & Jerry's</script>`),
    "&lt;script title=&quot;x&quot;&gt;Tom &amp; Jerry&#039;s&lt;/script&gt;",
  );
});

test("returns accessible decorative icon markup", () => {
  assert.match(
    getUploadIcon((key) => (key === "uploadPhoto" ? "Загрузить фото" : key)),
    /Загрузить фото/,
  );
});

test("marks and clears invalid form fields accessibly", () => {
  const attributes = new Map();
  const field = {
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
  };

  setFieldInvalid(field, true);
  assert.equal(attributes.get("aria-invalid"), "true");

  setFieldInvalid(field, false);
  assert.equal(attributes.has("aria-invalid"), false);
});
