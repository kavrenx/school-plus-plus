import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeHtml,
  formatInviteCode,
  getEyeIcon,
  getUploadIcon,
  setFieldInvalid,
} from "../js/ui-utils.js";

test("formats invite codes into four-character groups", () => {
  assert.equal(formatInviteCode("demo student 2026"), "DEMO-STUD-ENT2-026");
  assert.equal(formatInviteCode("ab-cd-12"), "ABCD-12");
});

test("escapes text before inserting it into HTML", () => {
  assert.equal(
    escapeHtml(`<script title="x">Tom & Jerry's</script>`),
    "&lt;script title=&quot;x&quot;&gt;Tom &amp; Jerry&#039;s&lt;/script&gt;",
  );
});

test("returns accessible decorative icon markup", () => {
  assert.match(getEyeIcon(false), /aria-hidden="true"/);
  assert.match(getEyeIcon(true), /M3 3l18 18/);
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
