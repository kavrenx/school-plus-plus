function formatDiaryFreshness(
  importedAt,
  now = new Date(),
  timeZone = "Europe/Minsk",
) {
  const date = new Date(importedAt);
  if (!importedAt || !Number.isFinite(date.getTime())) return "";
  const dayFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const time = date.toLocaleTimeString("ru-RU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
  const sameDay = dayFormat.format(date) === dayFormat.format(now);
  const day = date.toLocaleDateString("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
  });
  return `Обновлено в ${time}${sameDay ? "" : `, ${day}`}`;
}

export { formatDiaryFreshness };
