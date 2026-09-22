function createLocalPreviewData(rawDiary, rawSchool) {
  const school = structuredClone(rawSchool);
  school.school.name = "—";
  school.users = school.users.map((user) => ({
    ...user,
    firstName: "—",
    lastName: "",
    middleName: "",
    displayName: "—",
    className: "—",
    teacher: "—",
    classroom: "",
    department: "",
    email: "",
    phone: "",
    password: user.login,
    inviteCode: user.role === "student" ? "LOCAL-STUDENT-2026" : "",
  }));
  const studentId = school.users.find((user) => user.role === "student")?.id;
  school.students = school.students
    .filter((student) => student.id === studentId)
    .map((student) => ({ ...student, firstName: "—", lastName: "" }));
  school.classes = school.classes.map((item) => ({
    ...item,
    title: "—",
    classroom: "",
    studentIds: item.studentIds.filter((id) => id === studentId),
  }));
  school.groups = school.groups.map((item) => ({
    ...item,
    title: "—",
    studentIds: (item.studentIds || []).filter((id) => id === studentId),
  }));
  school.lessonTemplates = school.lessonTemplates.map((item) => ({
    ...item,
    startsAt: "",
    endsAt: "",
    room: "",
  }));
  school.schedule = {};
  school.messages = [];
  const diary = {
    meta: structuredClone(rawDiary.meta || {}),
    weeks: rawDiary.weeks.map((week) => ({
      ...week,
      days: Object.fromEntries(
        Object.keys(week.days || {}).map((day) => [day, []]),
      ),
    })),
  };
  return { diary, school };
}

function createPreviewStorage(storage) {
  const keyFor = (key) =>
    key === "schoolPlusPlus_theme" ? key : `schoolpp_empty_${key}`;
  return {
    getItem: (key) => storage.getItem(keyFor(key)),
    setItem: (key, value) => storage.setItem(keyFor(key), value),
    removeItem: (key) => storage.removeItem(keyFor(key)),
    isPersistent: () => storage.isPersistent(),
  };
}

export { createLocalPreviewData, createPreviewStorage };
