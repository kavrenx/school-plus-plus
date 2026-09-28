import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Window } from "happy-dom";

function loadWeekNavigation(window) {
  const context = vm.createContext({
    document: window.document,
    getComputedStyle: (element) => window.getComputedStyle(element),
  });
  vm.runInContext(
    readFileSync(
      new URL("../extension/shared/week-navigation.js", import.meta.url),
      "utf8",
    ),
    context,
  );
  return context.SchoolppWeekNavigation;
}

test("week navigation ignores the sidebar arrow and uses diary controls", async () => {
  const window = new Window();
  try {
    window.document.body.innerHTML = `
      <button id="sidebar"><i>arrow-left</i></button>
      <section class="diary-navigation">
        <div class="week-buttons">
          <button id="calendar"><i>calendar</i></button>
          <button id="previous"><i>chevron-left</i></button>
          <button id="next"><i>chevron-right</i></button>
        </div>
        <strong>14 – 18 сентября 2026</strong>
      </section>`;
    const navigation = loadWeekNavigation(window);

    assert.equal(
      navigation.findWeekButton(window.document, "previous").id,
      "previous",
    );
    assert.equal(navigation.findWeekButton(window.document, "next").id, "next");
  } finally {
    await window.happyDOM.close();
  }
});

test("week navigation falls back only to explicitly labelled controls", async () => {
  const window = new Window();
  try {
    window.document.body.innerHTML = `
      <button id="sidebar"><i>arrow-left</i></button>
      <button id="previous" aria-label="Предыдущая неделя"></button>
      <button id="next" aria-label="Следующая неделя"></button>`;
    const navigation = loadWeekNavigation(window);

    assert.equal(
      navigation.findWeekButton(window.document, "previous").id,
      "previous",
    );
    assert.equal(navigation.findWeekButton(window.document, "next").id, "next");
  } finally {
    await window.happyDOM.close();
  }
});

test("week navigation ranks separate controls beside the date above a sidebar arrow", async () => {
  const window = new Window();
  try {
    window.document.body.innerHTML = `
      <button id="sidebar"><i>arrow-left</i></button>
      <main>
        <div><strong id="range">14 – 18 сентября 2026</strong></div>
        <div class="toolbar">
          <button id="calendar"><i>calendar</i></button>
          <div role="button" id="previous"><svg><title>navigate_before</title></svg></div>
          <div role="button" id="next"><svg><title>navigate_next</title></svg></div>
        </div>
      </main>`;
    const rects = {
      sidebar: { left: 10, top: 90, width: 30, height: 30 },
      range: { left: 500, top: 300, width: 260, height: 30 },
      calendar: { left: 800, top: 295, width: 40, height: 40 },
      previous: { left: 850, top: 295, width: 40, height: 40 },
      next: { left: 900, top: 295, width: 40, height: 40 },
    };
    Object.entries(rects).forEach(([id, rect]) => {
      window.document.getElementById(id).getBoundingClientRect = () => rect;
    });
    const navigation = loadWeekNavigation(window);

    assert.equal(
      navigation.findWeekButton(window.document, "previous").id,
      "previous",
    );
    assert.equal(navigation.findWeekButton(window.document, "next").id, "next");
    assert.equal(
      navigation
        .findWeekButtons(window.document, "previous")
        .includes(window.document.getElementById("sidebar")),
      false,
    );
  } finally {
    await window.happyDOM.close();
  }
});

test("week navigation never falls back to a distant sidebar toggle", async () => {
  const window = new Window();
  try {
    window.document.body.innerHTML = `
      <button id="sidebar"><i>keyboard_arrow_left</i></button>
      <main>
        <strong id="range">21 – 26 сентября 2026</strong>
        <button id="calendar"><i>calendar</i></button>
        <button id="previous"><svg><path></path></svg></button>
        <button id="next"><svg><path></path></svg></button>
      </main>`;
    const rects = {
      sidebar: { left: 10, top: 30, width: 32, height: 32 },
      range: { left: 500, top: 300, width: 260, height: 30 },
      calendar: { left: 800, top: 295, width: 40, height: 40 },
      previous: { left: 850, top: 295, width: 40, height: 40 },
      next: { left: 900, top: 295, width: 40, height: 40 },
    };
    Object.entries(rects).forEach(([id, rect]) => {
      window.document.getElementById(id).getBoundingClientRect = () => rect;
    });
    const navigation = loadWeekNavigation(window);

    assert.deepEqual(
      Array.from(
        navigation.findWeekButtons(window.document, "previous"),
        (element) => element.id,
      ),
      ["previous"],
    );
    assert.deepEqual(
      Array.from(
        navigation.findWeekButtons(window.document, "next"),
        (element) => element.id,
      ),
      ["next"],
    );
  } finally {
    await window.happyDOM.close();
  }
});
