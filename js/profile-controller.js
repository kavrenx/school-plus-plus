import { getUploadIcon } from "./ui-utils.js";
import {
  createCompressedAvatar,
  validateAvatarFile,
} from "./avatar-service.js";

function createProfileController({
  root,
  avatarRepository,
  translate,
  modal,
  feedback,
  notify = () => {},
}) {
  const elements = {
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

  return { bind, renderAvatar, setUser };
}
export { createProfileController };
