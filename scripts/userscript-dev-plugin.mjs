import { runSchoolppUserscript } from "../js/userscript-runtime.js";
import { runIOSShortcutProbe } from "../js/ios-shortcut-probe.js";
import { runUserscriptLaunchProbe } from "../js/userscript-launch-probe.js";
import { USERSCRIPT_VERSION } from "../js/userscript-version.js";

const VERSION = "0.1.1-test";
const PUBLIC_VERSION = USERSCRIPT_VERSION;
const PUBLIC_ORIGINS = ["https://schoolpp.com", "https://www.schoolpp.com"];
function userscriptOrigins(port, configuredOrigin = "") {
  const origins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
  if (configuredOrigin) {
    const url = new URL(configuredOrigin);
    const octets = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname)
      ? url.hostname.split(".").map(Number)
      : [];
    const privateAddress =
      octets.length === 4 &&
      octets.every((part) => part <= 255) &&
      (octets[0] === 10 ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
    if (
      url.protocol !== "http:" ||
      !privateAddress ||
      Number(url.port) !== Number(port) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Userscripts test origin must be a private HTTP origin on the dev server port.",
      );
    origins.push(url.origin);
  }
  return origins;
}

function buildUserscript(origins, publicRelease = false) {
  const version = publicRelease ? PUBLIC_VERSION : VERSION;
  const config = {
    origins,
    version,
    transport: publicRelease ? "userscript" : "userscript-test",
  };
  const matches = [
    ...new Set(
      origins.map((origin) => {
        const url = new URL(origin);
        return `${url.protocol}//${url.hostname}/*`;
      }),
    ),
  ];
  return [
    "// ==UserScript==",
    publicRelease
      ? "// @name School++ — синхронизация дневника"
      : "// @name School++ — тест на iPhone",
    publicRelease ? "// @namespace schoolpp" : "// @namespace schoolpp-test",
    `// @version ${version}`,
    publicRelease
      ? "// @description Обновление School++ из e-schools.by в Safari."
      : "// @description Тестовый сбор госдневника и возврат в локальный School++.",
    ...(publicRelease
      ? [
          "// @updateURL https://schoolpp.com/schoolpp.user.js",
          "// @downloadURL https://schoolpp.com/schoolpp.user.js",
        ]
      : []),
    "// @match https://diary.e-schools.by/*",
    ...matches.map((match) => `// @match ${match}`),
    "// @run-at document-idle",
    "// @inject-into content",
    "// @noframes",
    ...[
      "getValue",
      "setValue",
      "deleteValue",
      "getTab",
      "saveTab",
      "listValues",
    ].map((name) => `// @grant GM.${name}`),
    "// ==/UserScript==",
    "",
    `void (${runSchoolppUserscript.toString()})(window, typeof GM === 'undefined' ? null : GM, ${runIOSShortcutProbe.toString()}, ${JSON.stringify(config)}).catch(() => { document.documentElement.setAttribute('data-schoolpp-userscript', JSON.stringify({ version: ${JSON.stringify(version)}, state: 'startup_failed', transport: 'dom-v2' })); });`,
  ].join("\n");
}
const buildTestUserscript = (origins) => buildUserscript(origins);
const buildPublicUserscript = (origins = PUBLIC_ORIGINS) =>
  buildUserscript(origins, true);

function buildLaunchCheckUserscript(origins) {
  const matches = [
    ...new Set(
      origins.map((origin) => {
        const url = new URL(origin);
        return `${url.protocol}//${url.hostname}/*`;
      }),
    ),
  ];
  return [
    "// ==UserScript==",
    "// @name School++ — проверка запуска",
    "// @namespace schoolpp-test-launch",
    "// @version 1.0.0",
    "// @description Проверяет только запуск Userscripts, без чтения дневника.",
    ...matches.map((match) => `// @match ${match}`),
    "// @run-at document-end",
    "// @inject-into content",
    "// @noframes",
    "// @grant none",
    "// ==/UserScript==",
    `(${runUserscriptLaunchProbe.toString()})(window, ${JSON.stringify(origins)});`,
  ].join("\n");
}

function userscriptDevPlugin() {
  let config;
  return {
    name: "schoolpp-userscript-test",
    apply: "serve",
    configResolved(resolved) {
      config = resolved;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url, "http://localhost");
        const path = url.pathname;
        // The existing local test installer returns here. Keep its v1 protocol
        // out of the production sync page; this middleware runs only in dev.
        if (
          (!request.method || request.method === "GET") &&
          path === "/userscripts-setup.html" &&
          url.searchParams.get("returned") === "1"
        ) {
          response.statusCode = 302;
          response.setHeader(
            "Location",
            "/dev/userscript-sync.html?returned=1&syncTiming=1",
          );
          response.setHeader("Cache-Control", "no-store");
          response.end();
          return;
        }
        if (
          ![
            "/schoolpp-test.user.js",
            "/schoolpp-launch-check.user.js",
            "/schoolpp.user.js",
          ].includes(path)
        ) {
          next();
          return;
        }
        try {
          const origins = userscriptOrigins(
            config.server.port || 5173,
            config.env.VITE_PAIRING_ORIGIN || "",
          );
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(
            path === "/schoolpp.user.js"
              ? buildPublicUserscript()
              : path === "/schoolpp-launch-check.user.js"
                ? buildLaunchCheckUserscript(origins)
                : buildTestUserscript(origins),
          );
        } catch {
          response.statusCode = 503;
          response.end("Test installer origin is not configured.");
        }
      });
    },
  };
}
function userscriptPlugin() {
  const dev = userscriptDevPlugin();
  return {
    ...dev,
    name: "schoolpp-userscript",
    apply: undefined,
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "schoolpp.user.js",
        source: buildPublicUserscript(),
      });
    },
  };
}

export {
  buildTestUserscript,
  buildLaunchCheckUserscript,
  userscriptOrigins,
  userscriptDevPlugin,
  userscriptPlugin,
  buildPublicUserscript,
};
