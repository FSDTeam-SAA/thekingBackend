// controller/notification.controller.js
import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { Notification } from "../model/notification.model.js";

/**
 * GET /notification
 * Query:
 *  - isRead=true|false (optional)
 *  - page=1
 *  - limit=20
 */
export const getMyNotifications = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { isRead, page = 1, limit = 20 } = req.query;

  const filter = { userId };
  if (isRead === "true") filter.isRead = true;
  if (isRead === "false") filter.isRead = false;

  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 20;

  const [items, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
    Notification.countDocuments(filter),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notifications fetched successfully",
    data: {
      items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
      },
    },
  });
});

/**
 * PATCH /notification/:id/read
 * mark single notification as read
 */
export const markNotificationRead = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { id } = req.params;

  const notif = await Notification.findOneAndUpdate(
    { _id: id, userId }, // ensure this notification belongs to this user
    { isRead: true },
    { new: true }
  );

  if (!notif) {
    throw new AppError(httpStatus.NOT_FOUND, "Notification not found");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification marked as read",
    data: notif,
  });
});

/**
 * PATCH /notification/read-all
 * mark all as read
 */
export const markAllNotificationsRead = catchAsync(async (req, res) => {
  const userId = req.user._id;

  await Notification.updateMany(
    { userId, isRead: false },
    { $set: { isRead: true } }
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "All notifications marked as read",
    data: null,
  });
});

/**
 * GET /notification/unread-count
 */
export const getUnreadCount = catchAsync(async (req, res) => {
  const userId = req.user._id;

  const count = await Notification.countDocuments({ userId, isRead: false });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Unread count fetched",
    data: { count },
  });
});

/**
 * DELETE /notification/:id
 * delete single notification
 */
export const deleteNotification = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { id } = req.params;

  const notif = await Notification.findOneAndDelete({ _id: id, userId });

  if (!notif) {
    throw new AppError(httpStatus.NOT_FOUND, "Notification not found");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification deleted successfully",
    data: null,
  });
});
