const PREFIX = "schoolpp_student_v1:";

function studentSourceContext(imported) {
  return {
    schoolId: imported?.school?.school?.id || "",
    studentId:
      imported?.school?.users?.find((user) => user.role === "student")
        ?.externalId || "",
    yearId: imported?.school?.school?.academicYear?.id || "",
  };
}

function isSameStudentSource(first, second) {
  return (
    JSON.stringify(studentSourceContext(first)) ===
    JSON.stringify(studentSourceContext(second))
  );
}

function studentStorageIdentity({
  viewerId,
  ownerId,
  schoolId,
  studentId,
  yearId,
}) {
  if (
    ![viewerId, ownerId, schoolId, studentId, yearId].every(
      (value) => typeof value === "string" && value.length,
    )
  )
    return null;
  return {
    profile: JSON.stringify([viewerId, ownerId, schoolId, studentId]),
    diary: JSON.stringify([viewerId, ownerId, schoolId, studentId, yearId]),
  };
}

// New cloud-student data only. Unattributed legacy records stay untouched and
// are never adopted automatically. Inner journal/history formats do not change.
function createStudentStorage(storage, context) {
  const identity = studentStorageIdentity(context);
  const memory = new Map();
  let active = true;
  function keyFor(key) {
    const scope = /^(schoolpp_empty_)?schoolPlusPlus_avatar/.test(key)
      ? identity?.profile
      : identity?.diary;
    return scope ? `${PREFIX}${encodeURIComponent(scope)}:${key}` : null;
  }
  return {
    getItem(key) {
      if (!active) return null;
      if (key === "schoolPlusPlus_theme") return storage.getItem(key);
      const scoped = keyFor(key);
      return scoped ? storage.getItem(scoped) : (memory.get(key) ?? null);
    },
    setItem(key, value) {
      if (!active) return false;
      if (key === "schoolPlusPlus_theme") return storage.setItem(key, value);
      const scoped = keyFor(key);
      if (scoped) return storage.setItem(scoped, value);
      memory.set(key, String(value));
      return false;
    },
    removeItem(key) {
      if (!active) return false;
      if (key === "schoolPlusPlus_theme") return storage.removeItem(key);
      const scoped = keyFor(key);
      if (scoped) return storage.removeItem(scoped);
      memory.delete(key);
      return false;
    },
    isPersistent: () => active && Boolean(identity) && storage.isPersistent(),
    invalidate() {
      active = false;
      memory.clear();
    },
  };
}

export {
  createStudentStorage,
  studentStorageIdentity,
  studentSourceContext,
  isSameStudentSource,
};
