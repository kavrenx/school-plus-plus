// Deliberately small and synchronous: runs without the collector, bridge or GM API.
// This source is serialized by the dev installer and must have no module dependencies.
function runUserscriptLaunchProbe(scope, origins) {
  var doc = scope.document;
  var report = {
    version: "1.0.0-launch",
    state: "executed",
    originAllowed: origins.indexOf(scope.location.origin) !== -1,
    topWindowMatches: scope.top === scope,
    documentState: doc.readyState,
  };
  doc.documentElement.setAttribute(
    "data-schoolpp-userscript-launch",
    JSON.stringify(report),
  );
  if (
    !report.originAllowed ||
    doc.location.pathname !== "/userscripts-setup.html"
  )
    return;
  if (doc.getElementById("schoolpp-launch-check")) return;
  var panel = doc.createElement("p");
  panel.id = "schoolpp-launch-check";
  panel.setAttribute("role", "status");
  panel.setAttribute(
    "style",
    "padding:16px;margin:16px 0;border:2px solid #34776a;background:#e8f0eb;color:#183e35;font:600 16px/1.5 system-ui;overflow-wrap:anywhere",
  );
  panel.textContent =
    "Проверка запуска: Userscripts выполнил скрипт (1.0.0-launch). Теперь нажми «Проверить установку» и скопируй короткий отчёт.";
  var anchor = doc.getElementById("userscriptStatus");
  if (anchor && anchor.parentNode)
    anchor.parentNode.insertBefore(panel, anchor);
  else (doc.body || doc.documentElement).appendChild(panel);
}

export { runUserscriptLaunchProbe };
