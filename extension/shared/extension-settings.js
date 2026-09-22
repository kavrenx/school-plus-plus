(function registerExtensionSettings(scope) {
  const DEFAULT_SETTINGS = Object.freeze({ backgroundSync: true });

  function normalizeSettings(value) {
    return {
      backgroundSync: value?.backgroundSync !== false,
    };
  }

  function isAutomaticSyncDue(
    settings,
    syncState,
    now = Date.now(),
    force = false,
  ) {
    if (!normalizeSettings(settings).backgroundSync) return false;
    if (!syncState?.lastSyncAt) return false;
    if (force) return true;
    const nextSyncAt = Date.parse(syncState?.nextSyncAt || "");
    return !Number.isFinite(nextSyncAt) || nextSyncAt <= now;
  }

  function describeSyncIssue(message, warning = "") {
    const text = String(message || warning || "");
    if (/сесси|войд|авторизац/iu.test(text))
      return {
        code: "auth",
        title: "Нужно войти в дневник",
        message:
          "Открой e.school.by и войди снова, чтобы обновление продолжилось.",
      };
    if (/vpn|недоступ|соединен|не ответил|открыть/iu.test(text))
      return {
        code: "connection",
        title: "Дневник недоступен",
        message: "Проверь интернет или VPN. Расширение повторит попытку позже.",
      };
    if (warning)
      return {
        code: "partial",
        title: "Обновились не все данные",
        message:
          "Часть разделов дневника временно недоступна. Проверка повторится позже.",
      };
    return {
      code: "unknown",
      title: "Не удалось обновить данные",
      message: "Открой e.school.by и проверь, что дневник работает.",
    };
  }

  scope.SchoolppExtensionSettings = Object.freeze({
    DEFAULT_SETTINGS,
    describeSyncIssue,
    isAutomaticSyncDue,
    normalizeSettings,
  });
})(globalThis);
