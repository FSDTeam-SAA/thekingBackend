import multer from "multer";
import path from "path";

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
  fileTooBig: (req, file) => {
    throw new Error("File size too large (5MB max)");
  },
  fileFilter: (req, file, cb) => {
    // Accept both mimetype AND file extension and images
    const allowedMimeTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      // "video/mp4",
      // "video/quicktime",
      // "video/x-msvideo",
      // "video/mpeg",
      // "video/webm",
      "application/octet-stream",
    ];

    const allowedExtensions = [
      // ".mp4",
      // ".mov",
      // ".avi",
      // ".mpeg",
      // ".webm",
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
      cb(
        new Error("Only images are allowed (extensions: .jpg, .jpeg, .png)"),
        false,
      );
    }
  },
});

export const multerErrorHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "File size too large. Maximum allowed size is 20MB.",
      });
    }

    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "File upload error",
    });
  }

  next();
};

export default upload;
