import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_AVATAR_FILE_SIZE,
  createCompressedAvatar,
  fitAvatarDimensions,
  getAvatarStorageKey,
  validateAvatarFile,
} from "../js/avatar-service.js";

test("accepts safe avatar formats within the size limit", () => {
  assert.equal(
    validateAvatarFile({ type: "image/jpeg", size: MAX_AVATAR_FILE_SIZE }),
    null,
  );
  assert.equal(
    validateAvatarFile({ type: "image/svg+xml", size: 100 }),
    "type",
  );
  assert.equal(
    validateAvatarFile({
      type: "image/png",
      size: MAX_AVATAR_FILE_SIZE + 1,
    }),
    "size",
  );
});

test("creates a separate avatar key for each user", () => {
  assert.equal(
    getAvatarStorageKey("avatar_", { id: "student-1" }),
    "avatar_student-1",
  );
  assert.equal(
    getAvatarStorageKey("avatar_", { login: "student@example" }),
    "avatar_student%40example",
  );
  assert.equal(getAvatarStorageKey("avatar_", null), null);
});

test("shrinks large images without enlarging small ones", () => {
  assert.deepEqual(fitAvatarDimensions(1600, 800, 512), {
    width: 512,
    height: 256,
  });
  assert.deepEqual(fitAvatarDimensions(300, 400, 512), {
    width: 300,
    height: 400,
  });
});

test("decodes, resizes and exports an avatar through canvas", async () => {
  const drawCalls = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        drawImage(...args) {
          drawCalls.push(args);
        },
      };
    },
    toDataURL(type, quality) {
      return `${type};quality=${quality}`;
    },
  };

  class FakeFileReader {
    addEventListener(type, listener) {
      this[type] = listener;
    }

    readAsDataURL() {
      this.result = "data:image/jpeg;base64,demo";
      this.load();
    }
  }

  class FakeImage {
    constructor() {
      this.naturalWidth = 1600;
      this.naturalHeight = 800;
    }

    addEventListener(type, listener) {
      this[type] = listener;
    }

    set src(value) {
      this.source = value;
      this.load();
    }
  }

  const result = await createCompressedAvatar(
    { type: "image/jpeg", size: 100 },
    {
      documentRef: { createElement: () => canvas },
      FileReaderClass: FakeFileReader,
      ImageClass: FakeImage,
    },
  );

  assert.equal(canvas.width, 512);
  assert.equal(canvas.height, 256);
  assert.deepEqual(drawCalls[0].slice(1), [0, 0, 512, 256]);
  assert.equal(result, "image/webp;quality=0.82");
});
