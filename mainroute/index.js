import express from "express";

import authRoute from "../route/auth.route.js";
import userRoute from "../route/user.route.js";
import categoryRoute from "../route/category.routes.js";
import appointmentRoutes from "../route/appointment.route.js";
import postRoute from "../route/post.route.js";
import reelRoute from "../route/reel.route.js";
import doctorReviewRoute from "../route/doctorReview.route.js";

const router = express.Router();

// Mounting the routes
router.use("/auth", authRoute);
router.use("/user", userRoute);
router.use("/category", categoryRoute);
router.use("/appointment", appointmentRoutes);
router.use("/posts", postRoute);
router.use("/reels", reelRoute);
router.use("/doctor-reviews", doctorReviewRoute);

export default router;
