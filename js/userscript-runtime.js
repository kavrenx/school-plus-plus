// Self-contained: the dev installer serializes this function into .user.js.
// Only educational responses cross origins via GM storage; never session data.
async function runSchoolppUserscript(scope, gm, collect, config) {
  const production = config.transport === "userscript";
  const WEB = production
      ? "schoolpp-userscript-web-v2"
      : "schoolpp-userscript-web-v1",
    SCRIPT = production ? "schoolpp-userscript-v2" : "schoolpp-userscript-v1";
  const TAB = production ? "schoolppSync" : "schoolppTest",
    PREFIX = production ? "schoolpp_job:" : "schoolpp_test_job:",
    TTL = 180000;
  const origins = config.origins,
    origin = scope.location.origin;
  if (
    scope.top !== scope ||
    (!origins.includes(origin) && origin !== "https://diary.e-schools.by")
  )
    return;
  const runtimeKey = production
    ? "__schoolppUserscript"
    : "__schoolppUserscriptTest";
  if (scope[runtimeKey]) return;
  scope[runtimeKey] = true;
  const doc = scope.document;
  const mark = (state) =>
    doc.documentElement.setAttribute(
      "data-schoolpp-userscript",
      JSON.stringify({ version: config.version, state, transport: "dom-v2" }),
    );
  mark("starting");
  const available = [
    "getValue",
    "setValue",
    "deleteValue",
    "getTab",
    "saveTab",
  ].every((name) => typeof gm?.[name] === "function");
  const validId = (id) => typeof id === "string" && /^[a-f0-9]{32}$/.test(id);
  const key = (id) => PREFIX + id;
  const fresh = (job) =>
    job &&
    validId(job.id) &&
    origins.includes(job.origin) &&
    Number.isFinite(job.createdAt) &&
    Date.now() - job.createdAt >= 0 &&
    Date.now() - job.createdAt < TTL;
  const tab = async () => (await gm.getTab()) || {};
  if (available && typeof gm.listValues === "function") {
    void (async () => {
      for (const name of (await gm.listValues())
        .filter(
          (name) =>
            name.startsWith(PREFIX) && validId(name.slice(PREFIX.length)),
        )
        .slice(0, 100)) {
        if (!fresh(await gm.getValue(name))) await gm.deleteValue(name);
      }
    })().catch(() => {});
  }
  async function clear(id) {
    await gm.deleteValue(key(id));
    const state = await tab();
    if (state[TAB]?.id === id) {
      delete state[TAB];
      await gm.saveTab(state);
    }
  }
  async function current(id) {
    const state = await tab();
    if (state[TAB]?.id !== id) return null;
    const job = await gm.getValue(key(id));
    if (!fresh(job)) {
      await clear(id);
      return null;
    }
    return job;
  }
  function reply(id, payload) {
    // DOM and string details are shared by Safari's page and content worlds.
    // Window identity / MessageEvent.source are not reliable across that boundary.
    const event = doc.createEvent("CustomEvent");
    event.initCustomEvent(
      "schoolpp-userscript-response-v2",
      false,
      false,
      JSON.stringify({
        source: SCRIPT,
        origin,
        id,
        version: config.version,
        ...payload,
      }),
    );
    doc.dispatchEvent(event);
  }
  if (origins.includes(origin)) {
    let starting = false;
    doc.addEventListener("schoolpp-userscript-request-v2", (event) => {
      if (
        event.target !== doc ||
        typeof event.detail !== "string" ||
        event.detail.length > 1024
      )
        return;
      let message;
      try {
        message = JSON.parse(event.detail);
      } catch {
        return;
      }
      if (
        message?.origin !== origin ||
        message?.source !== WEB ||
        !validId(message.id)
      )
        return;
      void (async () => {
        if (message.type === "ping") {
          reply(message.id, { type: "ready", compatible: available });
          return;
        }
        if (!available) {
          reply(message.id, { type: "error", code: "unsupported_manager" });
          return;
        }
        if (message.type === "start") {
          if (starting) {
            reply(message.id, { type: "error", code: "busy" });
            return;
          }
          starting = true;
          try {
            const state = await tab();
            const previous = validId(state[TAB]?.id)
              ? await current(state[TAB].id)
              : null;
            if (
              previous &&
              !["done", "error", "skipped"].includes(previous.status)
            ) {
              reply(message.id, { type: "error", code: "busy" });
              return;
            }
            if (previous) await clear(previous.id);
            const job = {
              id: message.id,
              origin,
              createdAt: Date.now(),
              status: "pending",
              allowSkip: production && message.allowSkip === true,
            };
            await gm.setValue(key(job.id), job);
            await gm.saveTab({ ...(await tab()), [TAB]: { id: job.id } });
            reply(job.id, { type: "started" });
            scope.location.assign("https://diary.e-schools.by/");
          } finally {
            starting = false;
          }
          return;
        }
        const job = await current(message.id);
        if (!job || job.origin !== origin) {
          reply(message.id, { type: "error", code: "job_unavailable" });
          return;
        }
        if (message.type === "receive")
          reply(job.id, {
            type: "result",
            status: job.status,
            ...(job.export ? { export: job.export } : {}),
            ...(job.code ? { code: job.code } : {}),
          });
        if (message.type === "ack" || message.type === "cancel") {
          await clear(job.id);
          reply(job.id, { type: "cleared" });
        }
      })().catch(() =>
        reply(message.id, { type: "error", code: "storage_unavailable" }),
      );
    });
    mark(available ? "ready" : "unsupported_manager");
    return;
  }
  mark(available ? "ready" : "unsupported_manager");
  if (!available) return;
  let running = false,
    alive = true,
    controller;
  scope.addEventListener("pagehide", () => {
    alive = false;
    controller?.abort();
  });
  scope.addEventListener("pageshow", () => {
    alive = true;
    if (running) scope.setTimeout(() => void diary(), 600);
    else void diary();
  });
  function seed() {
    const entries = scope.performance?.getEntriesByType("resource") || [];
    return entries
      .slice()
      .reverse()
      .find((entry) => {
        try {
          const url = new URL(entry.name, origin);
          return (
            url.origin === origin &&
            /^\/api\/v1\/education\/diary\/schools\/[\w-]+\/classes\/[\w-]+\/students\/[\w-]+\/lessons$/.test(
              url.pathname,
            ) &&
            /^[\w-]+$/.test(url.searchParams.get("week_activity_uuid") || "")
          );
        } catch {
          return false;
        }
      });
  }
  function overlay() {
    const host = scope.document.createElement("div");
    host.style.cssText =
      "position:fixed;top:12px;left:12px;right:12px;z-index:2147483647";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML =
      '<style>*{box-sizing:border-box}section{max-width:520px;margin:auto;padding:16px;background:#fffdf8;color:#202721;border:2px solid #357667;border-radius:8px;font:16px/1.5 system-ui;box-shadow:0 6px 24px #0002}h2{font-size:17px;margin:0 0 6px}p{margin:0 0 12px}button{font:inherit;min-height:44px;padding:8px 12px;border:1px solid #357667;background:#357667;color:white;border-radius:4px;cursor:pointer;margin:4px 8px 4px 0}button[data-return],button[data-skip]{background:transparent;color:#255c50}[hidden]{display:none}</style><section aria-label="School++"><h2>School++ · Синхронизация</h2><p role="status" aria-live="polite"></p><button type="button" data-retry hidden>Повторить</button><button type="button" data-skip hidden>Открыть без синхронизации</button><button type="button" data-return>Вернуться в School++</button></section>';
    shadow.querySelector("h2").textContent = production
      ? "School++ · Синхронизация дневника"
      : "School++ · Тестовое обновление";
    scope.document.body.append(host);
    return {
      host,
      status: shadow.querySelector("p"),
      retry: shadow.querySelector("[data-retry]"),
      back: shadow.querySelector("[data-return]"),
      skip: shadow.querySelector("[data-skip]"),
    };
  }
  async function diary() {
    if (running || !alive) return;
    running = true;
    let ui;
    try {
      const state = await tab(),
        id = state[TAB]?.id;
      if (!validId(id)) return;
      let job = await current(id);
      if (!job || ["done", "error", "skipped"].includes(job.status)) return;
      const runId = scope.crypto.randomUUID();
      job = { ...job, runId, status: "collecting" };
      await gm.setValue(key(id), job);
      ui = overlay();
      controller = new scope.AbortController();
      const backUrl = `${job.origin}/${production ? "userscripts-sync" : "userscripts-setup"}.html?returned=1`;
      let returning = false;
      async function finish(exported, code = "", skipped = false) {
        if (!alive || returning) return;
        returning = true;
        controller.abort();
        const latest = await current(id);
        if (!latest) {
          if (alive) scope.location.replace(backUrl);
          return;
        }
        if (latest.runId !== runId) return;
        await gm.setValue(key(id), {
          ...latest,
          status:
            skipped && latest.allowSkip ? "skipped" : code ? "error" : "done",
          code,
          ...(exported ? { export: exported } : {}),
        });
        if (alive) scope.location.replace(backUrl);
      }
      ui.skip.hidden = !job.allowSkip;
      ui.skip.addEventListener("click", () => {
        if (job.allowSkip)
          void finish(null, "", true).catch(() => {
            if (alive) scope.location.replace(backUrl);
          });
      });
      ui.back.addEventListener("click", () => {
        void finish(null, "cancelled").catch(() => {
          if (alive) scope.location.replace(backUrl);
        });
      });
      let requestedRetry = false;
      ui.retry.addEventListener("click", () => {
        requestedRetry = true;
      });
      const wait = (ms) =>
        new Promise((resolve) => scope.setTimeout(resolve, ms));
      let failedSeed = null;
      const readyDeadline = Date.now() + 20000;
      while (alive && !returning && fresh(job)) {
        const resource = seed();
        const stamp = resource
          ? `${resource.name}:${resource.startTime || 0}`
          : "";
        if (!resource || (failedSeed === stamp && !requestedRetry)) {
          ui.status.textContent = failedSeed
            ? "Вход в госдневник закончился. Войди и открой дневник, затем нажми «Повторить»."
            : "Ждём загрузки дневника. Если нужен вход — войди. Затем открой дневник или переключи неделю.";
          ui.retry.hidden = !failedSeed && Date.now() < readyDeadline;
          await wait(500);
          continue;
        }
        requestedRetry = false;
        ui.retry.hidden = true;
        ui.status.textContent = "Собираем данные дневника…";
        const exported = await new Promise((resolve) =>
          collect(scope, resolve, {
            collect: true,
            transport: production ? "userscript" : "userscript-test",
            timeoutMs: 45000,
            requestTimeoutMs: 5000,
            signal: controller.signal,
            onProgress: ({ loadedWeeks, expectedWeeks }) => {
              if (alive && !returning)
                ui.status.textContent = `Получено недель: ${loadedWeeks} из ${expectedWeeks}`;
            },
          }),
        );
        if (!alive || returning) return;
        let report;
        try {
          report = JSON.parse(exported).report;
        } catch {
          await finish(null, "invalid_result");
          return;
        }
        if (report?.result === "sign_in_or_session_unavailable") {
          const latestSeed = seed();
          failedSeed = latestSeed
            ? `${latestSeed.name}:${latestSeed.startTime || 0}`
            : stamp;
          continue;
        }
        if (report?.result === "collection_ready") {
          await finish(exported);
          return;
        }
        await finish(exported, "collection_failed");
        return;
      }
      if (alive && !returning) await finish(null, "job_expired");
    } catch {
      if (ui && alive)
        ui.status.textContent =
          "Не удалось передать результат. Вернись в School++ и повтори обновление.";
    } finally {
      running = false;
    }
  }
  await diary();
}

export { runSchoolppUserscript };
