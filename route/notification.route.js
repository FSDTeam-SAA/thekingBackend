// route/notification.route.js
import express from "express";
import {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount,
} from "../controller/notification.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

// GET /notification?isRead=true|false&page=1&limit=20
router.get("/", protect, getMyNotifications);

// GET /notification/unread-count
router.get("/unread-count", protect, getUnreadCount);

// PATCH /notification/:id/read
router.patch("/:id/read", protect, markNotificationRead);

// PATCH /notification/read-all
router.patch("/read-all", protect, markAllNotificationsRead);

export default router;
