import { Window } from "happy-dom";

function createPollingWindow() {
  const window = new Window({ url: "https://schoolpp.invalid/" });
  const timers = new Map();
  let time = 0;
  let serial = 0;
  Object.defineProperty(window.document, "hidden", {
    configurable: true,
    value: false,
  });
  window.setTimeout = (run, delay) => {
    timers.set(++serial, { run, at: time + delay });
    return serial;
  };
  window.clearTimeout = (id) => timers.delete(id);
  const flush = async () => {
    for (let i = 0; i < 8; i++) await new Promise(setImmediate);
  };
  return {
    window,
    timers,
    flush,
    visibility(hidden) {
      Object.defineProperty(window.document, "hidden", {
        configurable: true,
        value: hidden,
      });
      window.document.dispatchEvent(new window.Event("visibilitychange"));
    },
    page(type, persisted = true) {
      const event = new window.Event(type);
      Object.defineProperty(event, "persisted", { value: persisted });
      window.dispatchEvent(event);
    },
    async advance(ms) {
      const end = time + ms;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        const [id, timer] = next;
        timers.delete(id);
        time = timer.at;
        timer.run();
        await flush();
      }
      time = end;
    },
  };
}

export { createPollingWindow };
