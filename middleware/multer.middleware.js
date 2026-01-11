import multer from "multer";
import path from "path";

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB for videos
  },
  fileFilter: (req, file, cb) => {
    console.log('📥 File received:', {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });

    // ✅ FIXED: Accept both mimetype AND file extension
    const allowedMimeTypes = [
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/mpeg',
      'video/webm',
      'application/octet-stream', // ✅ iOS sends this for videos
    ];

    const allowedExtensions = ['.mp4', '.mov', '.avi', '.mpeg', '.webm'];
    const ext = path.extname(file.originalname).toLowerCase();

    // ✅ Check EITHER mimetype OR file extension
    const isValidMimeType = allowedMimeTypes.includes(file.mimetype);
    const isValidExtension = allowedExtensions.includes(ext);

    if (isValidMimeType || isValidExtension) {
      console.log('✅ File accepted:', file.originalname);
      cb(null, true);
    } else {
      console.log('❌ File rejected:', {
        mimetype: file.mimetype,
        extension: ext,
      });
      cb(new Error('Only video files allowed'), false);
    }
  },
});

export default upload;