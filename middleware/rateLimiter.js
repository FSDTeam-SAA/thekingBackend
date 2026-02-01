import rateLimit from "express-rate-limit";

export const rateLimiter = (limit = 50) =>
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: Number(limit) || 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: "Too many requests. Please try again later.",
    },
  });
