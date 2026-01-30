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
  registerFCMToken,
} from "../controller/user.controller.js";
import { protect, isAdmin } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";

const router = express.Router();

router.get("/profile", protect, getProfile);
router.put("/profile", protect, upload.single("avatar"), updateProfile);
router.put("/password", protect, changePassword);
router.get("/me/dependents", protect, getMyDependents);
router.post("/me/dependents", protect, addDependent);
router.patch("/me/dependents/:dependentId", protect, updateDependent);
router.delete("/me/dependents/:dependentId", protect, deleteDependent);
//update user (patient only)
router.patch("/update-realtime-location", protect, updateLocation);
router.post("/find-doctors", searchDoctors);
router.get("/role/doctor/nearby", getNearbyDoctors); // ✅ Must be before /role/:role

router.get("/role/:role", getUsersByRole);
router.get("/dashboard/overview", protect, isAdmin, getDashboardOverview);
router.get("/:id", protect, getUserDetails);
router.delete("/:id", protect, isAdmin, deleteUser);
router.patch("/doctor/:id/approval", protect, updateDoctorApprovalStatus);

//update user (patient only)
router.patch("/update-realtime-location", protect, updateLocation);
router.post("/find-doctors", searchDoctors);
router.post("/fcm-token", protect, registerFCMToken);


export default router;
