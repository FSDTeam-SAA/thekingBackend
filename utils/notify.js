// utils/notify.js
import { Notification } from "../model/notification.model.js";
import { User } from "../model/user.model.js";

/**
 * Create notification, store in database, and send FCM Push
 */
import admin from "firebase-admin";

// Initialize Firebase Admin
// Ideally, use environment variable for credentials path or content
try {
  // Check if already initialized to avoid hot-reload errors
  if (!admin.apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      let serviceAccount;
      // Check if it's a file path or JSON string
      if (process.env.FIREBASE_SERVICE_ACCOUNT.trim().startsWith("{")) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      } else {
        // Assume file path - but for simplicity in this robust setup, we might need a workaround if fs isn't desired
        // For now, let's assume it's a JSON string or we skip if not provided
        // const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.warn("⚠️ Firebase: File path validation requires 'fs'. Ensure env var is JSON string for best results.");
      }

      if (serviceAccount) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        console.log("✅ Firebase Admin Initialized");
      }
    } else {
      console.log("⚠️ FIREBASE_SERVICE_ACCOUNT not found. Push notifications will be mocked.");
    }
  }
} catch (error) {
  console.error("❌ Firebase Init Error:", error.message);
}

import { sendFCMNotificationToUsers } from "./fcm.js";

//type enums: doctor_signup, doctor_approved, appointment_booked, appointment_confirmed, appointment_cancelled, appointment_completed, appointment_status_change


export const createNotification = async ({
  userId,
  fromUserId,
  type,
  title,
  content,
  appointmentId,
  meta = {},
}) => {
  try {
    if (!userId || !type || !title || !content) {
      console.log("⚠️ Missing required fields for notification");
      return { success: false, message: "Missing required fields" };
    }
    //check type is valid
    const validTypes = [
      "doctor_signup",
      "doctor_approved",
      "appointment_booked",
      "appointment_confirmed",
      "appointment_cancelled",
      "appointment_completed",
      "appointment_status_change",
      "post_liked",
      "post_commented",
      "reel_liked",
      "reel_commented",
      "new_message",
      "incoming_call",
    ];
    if (!validTypes.includes(type)) {
      console.warn(`⚠️ Invalid notification type: ${type}`);
    }

    // Create database notification
    const notification = await Notification.create({
      userId,
      fromUserId,
      type,
      title,
      content,
      appointmentId,
      meta,
    });

    // ✅ SEND PUSH NOTIFICATION (Non-blocking)
    setImmediate(async () => {
      try {
        const payload = {
          title: title,
          body: content,
          sound: "default",
          badge: "1",
        };

        const data = {
          type: type,
          appointmentId: appointmentId ? String(appointmentId) : "",
          clickAction: "FLUTTER_NOTIFICATION_CLICK", // Standard key used in FCM
          click_action: "FLUTTER_NOTIFICATION_CLICK", // Compatibility key
          ...(meta || {}),
        };

        await sendFCMNotificationToUsers(
          [userId.toString()],
          payload,
          data,
          User
        );
      } catch (fcmError) {
        console.error("❌ FCM Background Error:", fcmError.message);
      }
    });

    return {
      success: true,
      notificationId: notification._id,
      message: "Notification created successfully",
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to create notification",
      error: error.message,
    };
  }
};

/**
 * Get click action for notification navigation
 */
const getClickAction = (type, appointmentId) => {
  switch (type) {
    case "appointment_confirmed":
    case "appointment_cancelled":
    case "appointment_reminder":
      return appointmentId
        ? `/appointment-details/${appointmentId}`
        : "/appointments";

    case "new_message":
      return "/messages";

    case "incoming_call":
      return "/calls";

    default:
      return "/notifications";
  }
};

/**
 * Create notification for multiple users (bulk notification)
 */
export const createBulkNotification = async ({
  userIds,
  fromUserId,
  type,
  title,
  content,
  appointmentId,
  meta,
}) => {
  try {
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return { success: false, message: "User IDs array is required" };
    }

    // Create notifications for all users
    const notifications = userIds.map((userId) => ({
      userId,
      fromUserId,
      type,
      title,
      content,
      appointmentId,
      meta,
    }));

    const createdNotifications = await Notification.insertMany(notifications);
    console.log(
      `✅ Bulk notifications created: ${type} for ${userIds.length} users`,
    );

    return {
      success: true,
      notificationIds: createdNotifications.map((n) => n._id),
      count: createdNotifications.length,
      message: "Bulk notifications created successfully",
    };
  } catch (error) {
    console.error("❌ Error creating bulk notifications:", error);
    return {
      success: false,
      message: "Failed to create bulk notifications",
      error: error.message,
    };
  }
};

/**
 * Legacy function for backward compatibility
 * @deprecated Use createNotification instead
 */
export const createSimpleNotification = async (
  userId,
  type,
  title,
  content,
) => {
  return await createNotification({
    userId,
    type,
    title,
    content,
  });
};
