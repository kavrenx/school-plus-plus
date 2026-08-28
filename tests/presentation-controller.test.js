import assert from "node:assert/strict";
import test from "node:test";

import {
  getTargetScene,
  readWheelIntent,
} from "../js/presentation-controller.js";

test("presentation navigation stays within its first and last scenes", () => {
  assert.equal(getTargetScene(0, -1, 5), 0);
  assert.equal(getTargetScene(0, 1, 5), 1);
  assert.equal(getTargetScene(3, 1, 5), 4);
  assert.equal(getTargetScene(4, 1, 5), 4);
});

test("wheel input accumulates until one deliberate scene change", () => {
  let intent = readWheelIntent(0, 24, 90);
  assert.deepEqual(intent, { accumulator: 24, direction: 0 });

  intent = readWheelIntent(intent.accumulator, 42, 90);
  assert.deepEqual(intent, { accumulator: 66, direction: 0 });

  intent = readWheelIntent(intent.accumulator, 31, 90);
  assert.deepEqual(intent, { accumulator: 0, direction: 1 });
});

test("changing wheel direction discards the previous partial gesture", () => {
  assert.deepEqual(readWheelIntent(70, -35, 90), {
    accumulator: -35,
    direction: 0,
  });
  assert.deepEqual(readWheelIntent(-70, -30, 90), {
    accumulator: 0,
    direction: -1,
  });
});
