import express from "express";
import {
  createAppointment,
  getAvailableAppointments,
  getEarningsOverview,
  getMyAppointments,
  updateAppointment,
  updateAppointmentStatus,
  deleteAppointment,
  confirmAppointment,
} from "../controller/appointment.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";

const router = express.Router();

// POST /appointment/:doctorId
// form-data: appointmentType, date, startTime, endTime, symptoms,
// files: medicalDocuments[], paymentScreenshot
router.post(
  "/",
  protect,
  upload.fields([
    { name: "medicalDocuments", maxCount: 5 },
    { name: "paymentScreenshot", maxCount: 1 },
  ]),
  createAppointment
);

// POST /:appointmentId/confirm - Doctor confirms appointment
router.patch("/:appointmentId/confirm", protect, confirmAppointment);
router.post("/available", getAvailableAppointments);
// get all appointments (doctor/patient/admin)

/**
 * Get all appointments of current user (patient/doctor/admin)
 * GET /appointment
 *  - patient: only own appointments
 *  - doctor: only own appointments
 *  - admin: all, with optional filters
 *    - ?doctorId=...
 *    - ?patientId=...
 *    - ?status=pending|approved|rejected|cancelled|completed
 */
router.get("/", protect, getMyAppointments);

/**
 * Update appointment status (doctor/admin)
 * PATCH /appointment/:id/status
 * body: { status: "pending" | "confirmed" | "completed" | "cancelled" }
 */
router.patch("/:id/status", protect, updateAppointmentStatus);

/**
 * Update appointment details
 * PATCH /appointment/:id
 */
router.patch(
  "/:id",
  protect,
  upload.fields([
    { name: "medicalDocuments", maxCount: 5 },
    { name: "paymentScreenshot", maxCount: 1 },
  ]),
  updateAppointment
);

/**
 * Delete appointment
 * DELETE /appointment/:id
 */
router.delete("/:id", protect, deleteAppointment);

router.get("/earnings/overview", protect, getEarningsOverview);
 
export default router;
