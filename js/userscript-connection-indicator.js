function createUserscriptConnectionIndicator({
  windowRef,
  client,
  element,
  onError = () => {},
  onReady = () => {},
}) {
  const title = element.querySelector("[data-connection-title]");
  const detail = element.querySelector("[data-connection-detail]");
  let checking,
    stopped = false;
  function render(state, heading, description) {
    if (stopped) return;
    element.dataset.state = state;
    title.textContent = heading;
    detail.textContent = description;
  }
  function check() {
    if (stopped) return Promise.resolve({});
    if (checking) return checking;
    render(
      "checking",
      "Проверяем запуск Userscripts…",
      "Проверка займёт несколько секунд и не запускает синхронизацию.",
    );
    checking = (async () => {
      try {
        const result = await client.ping();
        render(
          "success",
          "✓ Скрипт School++ отвечает",
          `Версия ${result.version}. Связь установлена, можно подключать дневник.`,
        );
        if (!stopped) onReady(result);
        return { result };
      } catch (error) {
        const connection = error.diagnostic;
        const probe = connection?.launchCheck;
        const description =
          probe?.state === "executed"
            ? probe.originAllowed
              ? "Короткая проверка запустилась, но основной скрипт не подтвердил готовность."
              : "Короткая проверка запустилась, но текущий адрес не входит в адреса установленного скрипта."
            : connection?.injected
              ? "Отметка запуска есть, но скрипт не подтвердил готовность."
              : "Страница не получила ни ответа основного скрипта, ни отметки короткой проверки. Причина пока не определена.";
        render(
          "error",
          "✕ Не удалось подтвердить запуск School++",
          `${description} Проверьте установку и разрешения Safari по инструкции выше.`,
        );
        if (!stopped) onError(error);
        return { error };
      } finally {
        checking = null;
      }
    })();
    return checking;
  }
  // A delayed Safari injection can recover the red state without a reload.
  const observer = new windowRef.MutationObserver(() => void check());
  observer.observe(windowRef.document.documentElement, {
    attributes: true,
    attributeFilter: [
      "data-schoolpp-userscript",
      "data-schoolpp-userscript-launch",
    ],
  });
  void check();
  return {
    check,
    stop() {
      stopped = true;
      observer.disconnect();
    },
  };
}

export { createUserscriptConnectionIndicator };
