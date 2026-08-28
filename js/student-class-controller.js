import { escapeHtml } from "./ui-utils.js";

function createStudentClassController({ root, model, modal }) {
  const elements = {
    trigger: root.getElementById("studentClassBtn"),
    dialog: root.getElementById("classModal"),
    title: root.getElementById("classModalTitle"),
    summary: root.getElementById("classModalSummary"),
    teacher: root.getElementById("classTeacherCard"),
    studentCount: root.getElementById("classStudentCount"),
    students: root.getElementById("classStudentList"),
  };
  let currentUser = null;

  function bind() {
    elements.trigger?.addEventListener("click", open);
  }

  function setUser(user) {
    currentUser = user?.role === "student" ? user : null;
  }

  function open() {
    if (!currentUser || !elements.dialog) return;
    render(getStudentClassView(model, currentUser));
    modal.open(elements.dialog);
  }

  function render(view) {
    elements.title.textContent = `${view.classTitle} класс`;
    elements.summary.textContent = [
      getStudentCountLabel(view.students.length),
      view.classroom ? `кабинет ${view.classroom}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    elements.studentCount.textContent = getStudentCountLabel(
      view.students.length,
    );
    elements.teacher.innerHTML = renderTeacherCard(view.teacher);
    elements.students.innerHTML = view.students
      .map(renderStudentCard)
      .join("");
  }

  return { bind, open, setUser };
}

function getStudentClassView(model, user) {
  const school = model?.school || {};
  const classItem =
    school.classesById?.[user.classId] ||
    school.classes?.find((item) => item.title === user.className) ||
    null;
  const currentStudentId = user.id || user.userId || "";
  const studentIds =
    classItem?.studentIds ||
    (school.students || [])
      .filter((student) => student.classId === user.classId)
      .map((student) => student.id);
  const students = studentIds
    .map((studentId) => school.studentsById?.[studentId])
    .filter(Boolean)
    .map((student) => {
      const isCurrent = student.id === currentStudentId;
      const firstName = isCurrent ? user.firstName : student.firstName;
      const lastName = isCurrent ? user.lastName : student.lastName;
      return {
        id: student.id,
        firstName,
        lastName,
        initials: getInitials(firstName, lastName),
        isCurrent,
      };
    });
  const teacherId = classItem?.classTeacherId || user.teacherId;
  const teacherUser = school.usersById?.[teacherId] || {};
  const teacherName =
    user.teacher ||
    teacherUser.displayName ||
    [teacherUser.lastName, teacherUser.firstName, teacherUser.middleName]
      .filter(Boolean)
      .join(" ") ||
    "Не указан";

  return {
    classTitle: user.className || classItem?.title || "Ваш",
    classroom: user.classroom || classItem?.classroom || "",
    teacher: {
      name: teacherName,
      initials: getNameInitials(teacherName),
      department: teacherUser.department || "",
      email: teacherUser.email || "",
      classroom: teacherUser.classroom || classItem?.classroom || "",
    },
    students,
  };
}

function renderTeacherCard(teacher) {
  const details = [
    teacher.department,
    teacher.classroom ? `кабинет ${teacher.classroom}` : "",
  ].filter(Boolean);

  return `
    <div class="class-avatar class-teacher-avatar" aria-hidden="true">${escapeHtml(teacher.initials)}</div>
    <div class="class-person-copy">
      <p class="class-person-role">Классный руководитель</p>
      <h4>${escapeHtml(teacher.name)}</h4>
      ${details.length ? `<p>${escapeHtml(details.join(" · "))}</p>` : ""}
      ${teacher.email ? `<a href="mailto:${escapeHtml(teacher.email)}">${escapeHtml(teacher.email)}</a>` : ""}
    </div>
  `;
}

function renderStudentCard(student) {
  return `
    <article class="class-student-card${student.isCurrent ? " is-current" : ""}"${student.isCurrent ? ' aria-current="true"' : ""}>
      <div class="class-avatar" aria-hidden="true">${escapeHtml(student.initials)}</div>
      <div class="class-student-name">
        <strong>${escapeHtml(student.lastName)} ${escapeHtml(student.firstName)}</strong>
        ${student.isCurrent ? "<span>Это вы</span>" : ""}
      </div>
    </article>
  `;
}

function getInitials(firstName = "", lastName = "") {
  return `${lastName.trim().charAt(0)}${firstName.trim().charAt(0)}`.toUpperCase();
}

function getNameInitials(name = "") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

function getStudentCountLabel(count) {
  const modulo100 = count % 100;
  const modulo10 = count % 10;
  let word = "учеников";
  if (modulo100 < 11 || modulo100 > 14) {
    if (modulo10 === 1) word = "ученик";
    if (modulo10 >= 2 && modulo10 <= 4) word = "ученика";
  }
  return `${count} ${word}`;
}

export {
  createStudentClassController,
  getInitials,
  getStudentClassView,
  getStudentCountLabel,
};
