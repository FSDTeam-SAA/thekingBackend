import express from "express";

import authRoute from "../route/auth.route.js";
import userRoute from "../route/user.route.js";
import categoryRoute from "../route/category.routes.js";
import appointmentRoutes from "../route/appointment.route.js";

const router = express.Router();

// Mounting the routes
router.use("/auth", authRoute);
router.use("/user", userRoute);
router.use("/category", categoryRoute);
router.use("/appointment", appointmentRoutes);

export default router;
