const STORAGE_KEYS = {
  theme: "schoolPlusPlus_theme",
  avatarPrefix: "schoolPlusPlus_avatar_",
  legacyAvatar: "schoolPlusPlus_avatar"
};

const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_NAMES = {
  monday: "Понедельник",
  tuesday: "Вторник",
  wednesday: "Среда",
  thursday: "Четверг",
  friday: "Пятница",
  saturday: "Суббота",
  sunday: "Воскресенье"
};
const DAY_SHORT = {
  monday: "Пн",
  tuesday: "Вт",
  wednesday: "Ср",
  thursday: "Чт",
  friday: "Пт",
  saturday: "Сб",
  sunday: "Вс"
};

const TEXT = {
  dark: "Тёмная",
  light: "Светлая",
  logout: "Выйти",
  class: "Класс",
  online: "онлайн",
  teacher: "Классный руководитель:",
  notSet: "не указан",
  edit: "Изменить",
  uploadPhoto: "Загрузить фото",
  lessonsScheduled: "в расписании",
  weekdayEmpty: "Уроков нет — можно выдохнуть.",
  holiday: "Праздничный день. Уроков нет.",
  missingDay: "Расписание на этот день ещё не добавлено.",
  todayPrefix: "Привет",
  summerBreak: "Каникулы! Отдыхай и набирайся сил.",
  firstSeptember: "С новым учебным годом!",
  schoolDay: "Ниже — расписание, домашние задания и отметки.",
  dayOff: "Уроков нет. Можно спокойно отдохнуть и подготовиться к новой неделе.",
  noData: "Данных пока нет",
  noWeeks: "Недели с расписанием пока не добавлены.",
  scheduleMissing: "Расписание ещё не добавлено",
  diary: "Дневник",
  lessonHeader: "Урок",
  homeworkHeader: "Домашнее задание",
  gradeHeader: "Отметка",
  attendanceHeader: "Посещение",
  room: "каб.",
  noHomework: "нет дз",
  avatarTypeError: "Выберите изображение JPEG, PNG или WebP.",
  avatarSizeError: "Файл слишком большой. Максимальный размер — 5 МБ.",
  avatarStorageError: "Не удалось обработать или сохранить изображение.",
  avatarSaved: "Фото профиля обновлено.",
  avatarRemoved: "Фото профиля удалено.",
  connectionOffline:
    "Нет соединения. Дневник доступен, но внешние материалы могут не открыться.",
  connectionRestored: "Соединение восстановлено.",
  months: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
  weekdays: ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"],
  weekdaysShort: ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
};

export { STORAGE_KEYS, DAY_ORDER, DAY_NAMES, DAY_SHORT, TEXT };
