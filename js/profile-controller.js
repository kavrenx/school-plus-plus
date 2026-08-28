import { getUploadIcon, setFieldInvalid } from "./ui-utils.js";
import {
  createCompressedAvatar,
  validateAvatarFile,
} from "./avatar-service.js";

function createProfileController({
  root,
  avatarRepository,
  userStore,
  accounts,
  translate,
  modal,
  feedback,
  notify = () => {},
  onUserChange,
}) {
  const elements = {
    editButton: root.getElementById("editProfileBtn"),
    modal: root.getElementById("profileModal"),
    form: root.getElementById("profileForm"),
    firstName: root.getElementById("profileFirstNameInput"),
    lastName: root.getElementById("profileLastNameInput"),
    className: root.getElementById("profileClassNameInput"),
    classroom: root.getElementById("profileClassroomInput"),
    teacher: root.getElementById("profileTeacherInput"),
    email: root.getElementById("profileEmailInput"),
    phone: root.getElementById("profilePhoneInput"),
    error: root.getElementById("profileError"),
    resetButton: root.getElementById("resetProfileBtn"),
    avatarInput: root.getElementById("avatarInput"),
    removeAvatarButton: root.getElementById("removeAvatarBtn"),
    avatarMessage: root.getElementById("avatarMessage"),
    studentPhotoLabel: root.getElementById("studentPhotoLabel"),
    studentPhoto: root.getElementById("studentPhoto"),
    photoPlaceholder: root.getElementById("photoPlaceholder"),
    removeAvatarModal: root.getElementById("removeAvatarModal"),
    cancelRemoveAvatarButton: root.getElementById("cancelRemoveAvatarBtn"),
    confirmRemoveAvatarButton: root.getElementById("confirmRemoveAvatarBtn"),
  };
  let currentUser = null;

  function bind() {
    elements.editButton?.addEventListener("click", openProfile);
    elements.form?.addEventListener("submit", handleSubmit);
    elements.form?.addEventListener("input", clearProfileError);
    elements.resetButton?.addEventListener("click", reset);
    elements.avatarInput?.addEventListener("change", handleAvatarUpload);
    elements.removeAvatarButton?.addEventListener("click", () =>
      modal.open(elements.removeAvatarModal),
    );
    elements.cancelRemoveAvatarButton?.addEventListener("click", () =>
      modal.close(elements.removeAvatarModal),
    );
    elements.confirmRemoveAvatarButton?.addEventListener("click", removeAvatar);
  }

  function setUser(user) {
    currentUser = user;
    feedback.hide(elements.avatarMessage);
    renderAvatar();
  }

  function openProfile() {
    if (!currentUser) return;
    clearProfileError();
    elements.firstName.value = currentUser.firstName || "";
    elements.lastName.value = currentUser.lastName || "";
    elements.className.value = currentUser.className || "";
    elements.classroom.value = currentUser.classroom || "";
    elements.teacher.value = currentUser.teacher || "";
    elements.email.value = currentUser.email || "";
    elements.phone.value = currentUser.phone || "";
    modal.open(elements.modal);
    elements.firstName.focus();
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!currentUser) return;

    const nextProfile = {
      firstName: elements.firstName.value.trim(),
      lastName: elements.lastName.value.trim(),
      className: elements.className.value.trim(),
      classroom: elements.classroom.value.trim(),
      teacher: elements.teacher.value.trim(),
      email: elements.email.value.trim(),
      phone: elements.phone.value.trim(),
    };
    const validationError = validateProfile(nextProfile);

    if (validationError === "name") {
      setFieldInvalid(elements.firstName, !nextProfile.firstName);
      setFieldInvalid(elements.lastName, !nextProfile.lastName);
      feedback.show(elements.error, translate("profileNameError"));
      return;
    }
    if (validationError === "email") {
      setFieldInvalid(elements.email, true);
      feedback.show(elements.error, translate("profileEmailError"));
      return;
    }

    userStore.saveProfile(currentUser.login, nextProfile);
    currentUser = { ...currentUser, ...nextProfile };
    userStore.saveUser(currentUser);
    onUserChange(currentUser);
    clearProfileError();
    modal.close(elements.modal);
    notify(translate("profileSaved"), { type: "success" });
  }

  function reset() {
    if (!currentUser) return;
    const baseUser =
      accounts.find((account) => account.login === currentUser.login) ||
      currentUser;
    userStore.clearProfile(currentUser.login);
    currentUser = { ...baseUser };
    userStore.saveUser(currentUser);
    onUserChange(currentUser);
    openProfile();
  }

  async function handleAvatarUpload() {
    const file = elements.avatarInput.files[0];
    if (!file || !currentUser) return;
    const validationError = validateAvatarFile(file);
    if (validationError) {
      feedback.show(
        elements.avatarMessage,
        translate(
          validationError === "size" ? "avatarSizeError" : "avatarTypeError",
        ),
      );
      elements.avatarInput.value = "";
      return;
    }

    feedback.hide(elements.avatarMessage);
    setAvatarBusy(true);
    try {
      const avatar = await createCompressedAvatar(file);
      if (avatarRepository.save(currentUser, avatar) === false) {
        throw new Error("Avatar was not saved persistently");
      }
      renderAvatar();
      notify(translate("avatarSaved"), { type: "success" });
    } catch {
      feedback.show(elements.avatarMessage, translate("avatarStorageError"));
    } finally {
      elements.avatarInput.value = "";
      setAvatarBusy(false);
    }
  }

  function removeAvatar() {
    let removed = false;
    try {
      if (avatarRepository.remove(currentUser) === false) {
        throw new Error("Avatar was not removed persistently");
      }
      feedback.hide(elements.avatarMessage);
      removed = true;
    } catch {
      feedback.show(elements.avatarMessage, translate("avatarStorageError"));
    }
    elements.avatarInput.value = "";
    modal.close(elements.removeAvatarModal);
    renderAvatar();
    if (removed) notify(translate("avatarRemoved"), { type: "success" });
  }

  function setAvatarBusy(isBusy) {
    elements.studentPhotoLabel?.classList.toggle("is-loading", isBusy);
    elements.studentPhotoLabel?.setAttribute("aria-busy", String(isBusy));
    if (elements.avatarInput) elements.avatarInput.disabled = isBusy;
  }

  function renderAvatar() {
    const avatar = avatarRepository.get(currentUser);
    if (avatar) {
      elements.studentPhoto.src = avatar;
      elements.studentPhoto.classList.remove("hidden");
      elements.photoPlaceholder.classList.add("hidden");
      elements.removeAvatarButton.classList.remove("hidden");
      return;
    }

    elements.studentPhoto.removeAttribute("src");
    elements.studentPhoto.classList.add("hidden");
    elements.photoPlaceholder.classList.remove("hidden");
    elements.removeAvatarButton.classList.add("hidden");
    elements.photoPlaceholder.innerHTML = getUploadIcon(translate);
  }

  function clearProfileError() {
    [elements.firstName, elements.lastName, elements.email].forEach((field) =>
      setFieldInvalid(field, false),
    );
    feedback.hide(elements.error);
  }

  return { bind, renderAvatar, setUser };
}

function validateProfile(profile) {
  if (!profile.firstName || !profile.lastName) return "name";
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email))
    return "email";
  return null;
}

export { createProfileController, validateProfile };
