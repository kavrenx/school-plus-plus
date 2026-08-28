const ALLOWED_AVATAR_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_AVATAR_FILE_SIZE = 5 * 1024 * 1024;
const MAX_AVATAR_DIMENSION = 512;

function validateAvatarFile(file) {
  if (!file || !ALLOWED_AVATAR_TYPES.has(file.type)) return "type";
  if (file.size > MAX_AVATAR_FILE_SIZE) return "size";
  return null;
}

function getAvatarStorageKey(prefix, user) {
  const identity = user?.id || user?.userId || user?.login;
  return identity ? `${prefix}${encodeURIComponent(identity)}` : null;
}

function fitAvatarDimensions(width, height, maxDimension) {
  if (!width || !height) return { width: 0, height: 0 };
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function createCompressedAvatar(
  file,
  {
    maxDimension = MAX_AVATAR_DIMENSION,
    quality = 0.82,
    documentRef = globalThis.document,
    FileReaderClass = globalThis.FileReader,
    ImageClass = globalThis.Image,
  } = {},
) {
  const source = await readFileAsDataUrl(file, FileReaderClass);
  const image = await loadImage(source, ImageClass);
  const size = fitAvatarDimensions(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    maxDimension,
  );
  if (!size.width || !size.height) throw new Error("Invalid avatar image");

  const canvas = documentRef.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.drawImage(image, 0, 0, size.width, size.height);
  return canvas.toDataURL("image/webp", quality);
}

function readFileAsDataUrl(file, FileReaderClass) {
  return new Promise((resolve, reject) => {
    const reader = new FileReaderClass();
    reader.addEventListener("load", () => resolve(reader.result), {
      once: true,
    });
    reader.addEventListener("error", () => reject(reader.error), {
      once: true,
    });
    reader.readAsDataURL(file);
  });
}

function loadImage(source, ImageClass) {
  return new Promise((resolve, reject) => {
    const image = new ImageClass();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener(
      "error",
      () => reject(new Error("Unable to decode avatar image")),
      { once: true },
    );
    image.src = source;
  });
}

export {
  MAX_AVATAR_DIMENSION,
  MAX_AVATAR_FILE_SIZE,
  createCompressedAvatar,
  fitAvatarDimensions,
  getAvatarStorageKey,
  validateAvatarFile,
};
