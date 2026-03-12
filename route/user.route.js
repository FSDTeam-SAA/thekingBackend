import express from "express";
import {
  getProfile,
  updateProfile,
  changePassword,
  getUsersByRole,
  getUserDetails,
  getDashboardOverview,
  updateDoctorApprovalStatus,
  getMyDependents,
  addDependent,
  updateDependent,
  deleteDependent,
  deleteUser,
  updateLocation,
  searchDoctors,
  getNearbyDoctors,
  deleteMyAccount,
  blockUser,
  unblockUser,
  getBlockedUsers,
} from "../controller/user.controller.js";
import { registerFCMToken, removeFCMToken } from "../controller/fcm.controller.js";
import { protect, isAdmin } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";

const router = express.Router();

router.get("/profile", protect, getProfile);
router.put("/profile", protect, upload.single("avatar"), updateProfile);
router.patch("/profile", protect, upload.single("avatar"), updateProfile);
router.put("/password", protect, changePassword);
router.delete("/delete-account", protect, deleteMyAccount);

router.get("/me/dependents", protect, getMyDependents);
router.post("/me/dependents", protect, addDependent);
router.patch("/me/dependents/:dependentId", protect, updateDependent);
router.delete("/me/dependents/:dependentId", protect, deleteDependent);

// Block / Unblock routes
router.get("/blocked", protect, getBlockedUsers);
router.post("/block/:targetUserId", protect, blockUser);
router.delete("/block/:targetUserId", protect, unblockUser);

router.get("/role/doctor/nearby", getNearbyDoctors);
router.get("/role/:role", getUsersByRole);
router.get("/dashboard/overview", protect, isAdmin, getDashboardOverview);
router.get("/:id", protect, getUserDetails);
router.delete("/:id", protect, isAdmin, deleteUser);
router.patch("/doctor/:id/approval", protect, updateDoctorApprovalStatus);

router.patch("/update-realtime-location", protect, updateLocation);
router.post("/find-doctors", searchDoctors);
router.post("/fcm-token", protect, registerFCMToken);
router.delete("/fcm-token", protect, removeFCMToken);

export default router;
