import multer from "multer";
import path from "path";

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB for videos
  },
  fileFilter: (req, file, cb) => {
    // Accept both mimetype AND file extension and images
    const allowedMimeTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "video/mp4",
      "video/quicktime",
      "video/x-msvideo",
      "video/mpeg",
      "video/webm",
      "application/octet-stream",
    ];

    const allowedExtensions = [
      ".mp4",
      ".mov",
      ".avi",
      ".mpeg",
      ".webm",
      ".jpg",
      ".jpeg",
      ".png",
    ];
    const ext = path.extname(file.originalname).toLowerCase();

    // Check both mimetype and extension
    const isValidMimeType = allowedMimeTypes.includes(file.mimetype);
    const isValidExtension = allowedExtensions.includes(ext);

    if (isValidMimeType || isValidExtension) {
      cb(null, true);
    } else {
      cb(new Error("Only images and video files allowed"), false);
    }
  },
});

export default upload;
