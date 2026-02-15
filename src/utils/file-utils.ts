
export const GB = 1024 * 1024 * 1024;
export const MB = 1024 * 1024;
export const KB = 1024;

export const PROFILE_IMAGE_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const getFileExtension = (
  file: Express.Multer.File,
): string | null => {
  return (
    file.originalname.split(".").pop() ||
    null
  );
};
