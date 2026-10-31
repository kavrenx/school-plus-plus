const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateDiaryWriteContext(context) {
  if (context?.version === 1) return { version: 1 };
  if (
    context?.version === 2 &&
    (context.revision === null ||
      (typeof context.revision === "string" && UUID.test(context.revision)))
  )
    return { version: 2, revision: context.revision };
  const error = new Error(
    "Не удалось подтвердить версию дневника. Запустите синхронизацию заново.",
  );
  error.code = "diary_write_context_required";
  throw error;
}

function diaryWriteError(code) {
  const messages = {
    diary_snapshot_conflict:
      "Дневник уже обновился на другом устройстве. Сохранённая копия остаётся здесь. Запустите новую синхронизацию.",
    diary_write_context_required:
      "Для сохранения нужна новая синхронизация. Дневник на этом устройстве сохранён.",
    diary_client_outdated:
      "Сервер обновился. Обновите страницу и запустите синхронизацию заново.",
    pair_owner_required:
      "Этот браузер подключён по коду и не может записывать дневник владельца.",
    sign_in_required:
      "Не удалось подтвердить сеанс School++. Обновите страницу.",
    snapshot_invalid:
      "Дневник не прошёл проверку. Предыдущая облачная копия сохранена.",
  };
  const error = new Error(
    messages[code] || "Не удалось сохранить дневник. Попробуйте ещё раз.",
  );
  error.code = code;
  return error;
}

function requiresFreshDiarySync(error) {
  return [
    "diary_snapshot_conflict",
    "diary_write_context_required",
    "diary_client_outdated",
  ].includes(error?.code);
}

export { validateDiaryWriteContext, diaryWriteError, requiresFreshDiarySync };
