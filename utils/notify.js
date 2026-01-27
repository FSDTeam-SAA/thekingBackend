// utils/notify.js
import { Notification } from "../model/notification.model.js";
import { User } from "../model/user.model.js";

/**
 * Create notification and store in database
 * Simple version without FCM/Cloud Messaging
 */

//type enums: doctor_signup, doctor_approved, appointment_created, appointment_status_change

export const createNotification = async ({
  userId,
  fromUserId,
  type,
  title,
  content,
  appointmentId,
  meta,
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
      "appointment_status_change",
      "post_liked",
      "post_commented",
      "reel_liked",
      "reel_commented",
    ];
    if (!validTypes.includes(type)) {
      console.log(`Invalid notification type: ${type}`);
      return { success: false, message: "Invalid notification type" };
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

    console.log(`Notification created: ${type} for user ${userId}`);

    return {
      success: true,
      notificationId: notification._id,
      message: "Notification created successfully",
    };
  } catch (error) {
    console.error("❌ Error creating notification:", error);
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
