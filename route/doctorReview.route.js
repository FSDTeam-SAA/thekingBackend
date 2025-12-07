import express from "express";
import {
  createDoctorReview,
  getDoctorReviews,
  getMyDoctorReviews,
  deleteDoctorReview,
} from "../controller/doctorReview.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

// create review (patient only)
router.post("/", protect, createDoctorReview);

// get all reviews for a doctor (public)
router.get("/doctor/:doctorId", getDoctorReviews);

// get my reviews
// - patient: reviews I gave
// - doctor: reviews about me
router.get("/me", protect, getMyDoctorReviews);

// delete review (patient owner or admin)
router.delete("/:id", protect, deleteDoctorReview);

export default router;
