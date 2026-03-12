// route/report.route.js
import express from "express";
import {
  createReport,
  getReports,
  resolveReport,
} from "../controller/report.controller.js";
import { protect, isAdmin } from "../middleware/auth.middleware.js";

const router = express.Router();

// User: submit a report
router.post("/", protect, createReport);

// Admin: list reports
router.get("/", protect, isAdmin, getReports);

// Admin: resolve a report (delete content or eject user)
router.post("/:reportId/resolve", protect, isAdmin, resolveReport);

export default router;
