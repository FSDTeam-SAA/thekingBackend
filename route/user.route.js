import express from "express";
import {
  getProfile,
  updateProfile,
  changePassword,
  getUsersByRole,
  getUserDetails,
  updateDoctorApprovalStatus,
} from "../controller/user.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";

const router = express.Router();

router.get("/profile", protect, getProfile);
router.put("/profile", protect, upload.single("avatar"), updateProfile);
router.put("/password", protect, changePassword);

router.get("/role/:role", getUsersByRole);
router.get("/:id", protect, getUserDetails);
router.patch("/doctor/:id/approval", protect, updateDoctorApprovalStatus);

export default router;
