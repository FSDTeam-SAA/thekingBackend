// mainroute/index.js
import express from "express";

import authRoute from "../route/auth.route.js";
import userRoute from "../route/user.route.js";
import categoryRoute from "../route/category.routes.js";
import appointmentRoutes from "../route/appointment.route.js";
import postRoute from "../route/post.route.js";
import reelRoute from "../route/reel.route.js";
import doctorReviewRoute from "../route/doctorReview.route.js";
import notificationRoute from "../route/notification.route.js";
import chatRoute from "../route/chat.route.js";
import referralCodeRoute from "../route/referralCode.route.js";
import appSettingRoute from "../route/appSeeting.route.js";
import callRoute from "../route/call.route.js";
import reportRoute from "../route/report.route.js"; // ✅ UGC Safety

const router = express.Router();

// Authentication routes
router.use("/auth", authRoute);

// User management routes
router.use("/user", userRoute);

// Category routes
router.use("/category", categoryRoute);

// Appointment routes
router.use("/appointment", appointmentRoutes);

// Posts routes
router.use("/posts", postRoute);

// Reels routes
router.use("/reels", reelRoute);

// Doctor review routes
router.use("/doctor-review", doctorReviewRoute);

// Notification routes
router.use("/notification", notificationRoute);

// Chat routes
router.use("/chat", chatRoute);

// Call routes
router.use("/call", callRoute);

// Referral code routes
router.use("/referral", referralCodeRoute);

// System settings routes
router.use("/app-setting", appSettingRoute);

// ✅ Report / UGC Safety routes
router.use("/report", reportRoute);

// ═══════════════════════════════════════════════════════════
// 📋 Route Summary (for debugging):
// ═══════════════════════════════════════════════════════════
// /api/v1/auth              - Authentication
// /api/v1/user              - User management
// /api/v1/user/block/:id    - Block / Unblock users
// /api/v1/user/blocked      - Get blocked user list
// /api/v1/category          - Categories
// /api/v1/appointment       - Appointments
// /api/v1/posts             - Posts
// /api/v1/reels             - Reels
// /api/v1/doctor-review     - Doctor reviews
// /api/v1/notification      - Notifications
// /api/v1/chat              - Chat messages
// /api/v1/referral          - Referral codes
// /api/v1/report            - UGC content reports
// /api/v1/app-setting       - System settings
// ═══════════════════════════════════════════════════════════

export default router;