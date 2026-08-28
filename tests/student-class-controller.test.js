import assert from "node:assert/strict";
import test from "node:test";
import {
  getInitials,
  getStudentClassView,
  getStudentCountLabel,
} from "../js/student-class-controller.js";

const model = {
  school: {
    classes: [],
    classesById: {
      class_7b: {
        id: "class_7b",
        title: '7 "Б"',
        classroom: "28",
        classTeacherId: "teacher_demo",
        studentIds: ["student_demo", "student_alina"],
      },
    },
    studentsById: {
      student_demo: {
        id: "student_demo",
        firstName: "Даниил",
        lastName: "Романов",
      },
      student_alina: {
        id: "student_alina",
        firstName: "Алина",
        lastName: "Мороз",
      },
    },
    usersById: {
      teacher_demo: {
        id: "teacher_demo",
        displayName: "Орлова Марина Сергеевна",
        department: "Математика и информатика",
        email: "m.orlova@school.example",
        classroom: "28",
      },
    },
  },
};

test("builds a class view and highlights the signed-in student", () => {
  const view = getStudentClassView(model, {
    id: "student_demo",
    role: "student",
    classId: "class_7b",
    className: '7 "Б"',
    firstName: "Даня",
    lastName: "Романов",
    teacher: "Орлова Марина Сергеевна",
    classroom: "28",
  });

  assert.equal(view.classTitle, '7 "Б"');
  assert.equal(view.teacher.department, "Математика и информатика");
  assert.equal(view.students.length, 2);
  assert.deepEqual(view.students[0], {
    id: "student_demo",
    firstName: "Даня",
    lastName: "Романов",
    initials: "РД",
    isCurrent: true,
  });
  assert.equal(view.students[1].isCurrent, false);
});

test("formats compact initials and Russian student counts", () => {
  assert.equal(getInitials("Алина", "Мороз"), "МА");
  assert.equal(getStudentCountLabel(1), "1 ученик");
  assert.equal(getStudentCountLabel(2), "2 ученика");
  assert.equal(getStudentCountLabel(11), "11 учеников");
  assert.equal(getStudentCountLabel(24), "24 ученика");
});
