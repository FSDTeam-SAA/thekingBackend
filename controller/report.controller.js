// controller/report.controller.js
import httpStatus from "http-status";
import mongoose from "mongoose";
import { Report } from "../model/report.model.js";
import { User } from "../model/user.model.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import {
  deleteFromCloudinary,
} from "../utils/commonMethod.js";

/**
 * Submit a report on a piece of content or a user
 * POST /api/v1/report
 */
export const createReport = catchAsync(async (req, res) => {
  const reporterId = req.user._id;
  const { reportedUserId, itemType, itemId, reason } = req.body;

  if (!reportedUserId || !itemType || !itemId || !reason) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "reportedUserId, itemType, itemId, and reason are required",
    );
  }

  const allowedTypes = ["Post", "Reel", "Comment", "User"];
  if (!allowedTypes.includes(itemType)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid itemType");
  }

  if (String(reporterId) === String(reportedUserId)) {
    throw new AppError(httpStatus.BAD_REQUEST, "You cannot report yourself");
  }

  // Prevent duplicate pending reports from the same user on the same item
  const existing = await Report.findOne({
    reporter: reporterId,
    itemId,
    status: "pending",
  });
  if (existing) {
    throw new AppError(httpStatus.CONFLICT, "You have already reported this item");
  }

  const report = await Report.create({
    reporter: reporterId,
    reportedUser: reportedUserId,
    itemType,
    itemId,
    reason: String(reason).trim().slice(0, 500),
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Report submitted. Our team will review it within 24 hours.",
    data: { _id: report._id },
  });
});

/**
 * Admin: Get all pending reports (paginated)
 * GET /api/v1/report?status=pending&page=1&limit=20
 */
export const getReports = catchAsync(async (req, res) => {
  if (req.user?.role !== "admin") {
    throw new AppError(httpStatus.FORBIDDEN, "Only admin can view reports");
  }

  const status = req.query.status || "pending";
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const [reports, total] = await Promise.all([
    Report.find({ status })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("reporter", "fullName email avatar")
      .populate("reportedUser", "fullName email avatar")
      .lean(),
    Report.countDocuments({ status }),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reports fetched",
    data: { reports, total, page, limit },
  });
});

/**
 * Admin: Resolve a report — delete content & eject the offending user
 * POST /api/v1/report/:reportId/resolve
 * body: { action: "delete_content" | "eject_user" | "dismiss" }
 */
export const resolveReport = catchAsync(async (req, res) => {
  if (req.user?.role !== "admin") {
    throw new AppError(httpStatus.FORBIDDEN, "Only admin can resolve reports");
  }

  const { reportId } = req.params;
  const { action } = req.body;

  if (!["delete_content", "eject_user", "dismiss"].includes(action)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "action must be delete_content, eject_user, or dismiss",
    );
  }

  const report = await Report.findById(reportId);
  if (!report) {
    throw new AppError(httpStatus.NOT_FOUND, "Report not found");
  }

  if (report.status !== "pending") {
    throw new AppError(httpStatus.BAD_REQUEST, "This report is already resolved");
  }

  if (action === "dismiss") {
    report.status = "dismissed";
    await report.save();
    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Report dismissed",
      data: null,
    });
  }

  // Dynamically import all relevant models
  const { Post } = await import("../model/post.model.js");
  const { PostComment } = await import("../model/postComment.model.js");
  const { PostLike } = await import("../model/postLike.model.js");
  const { Reel } = await import("../model/reel.model.js");
  const { ReelComment } = await import("../model/reelComment.model.js");
  const { ReelLike } = await import("../model/reelLike.model.js");
  const { Chat } = await import("../model/chat.model.js");
  const { Message } = await import("../model/message.model.js");
  const { Notification } = await import("../model/notification.model.js");
  const { Appointment } = await import("../model/appointment.model.js");
  const { DoctorReview } = await import("../model/doctorReview.model.js");
  const { paymentInfo } = await import("../model/payment.model.js");
  const { ReferralCode } = await import("../model/referralCode.model.js");

  if (action === "delete_content") {
    // Only delete the specific item
    const { itemType, itemId } = report;

    if (itemType === "Post") {
      await PostComment.deleteMany({ post: itemId });
      await PostLike.deleteMany({ post: itemId });
      await Post.findByIdAndDelete(itemId);
    } else if (itemType === "Reel") {
      await ReelComment.deleteMany({ reel: itemId });
      await ReelLike.deleteMany({ reel: itemId });
      await Reel.findByIdAndDelete(itemId);
    } else if (itemType === "Comment") {
      // Find comment first to decrement count if it's a PostComment
      const pc = await PostComment.findById(itemId);
      if (pc) {
        await Post.findByIdAndUpdate(pc.post, { $inc: { commentsCount: -1 } }).catch(() => {});
        await PostComment.findByIdAndDelete(itemId);
      }
      
      const rc = await ReelComment.findById(itemId);
      if (rc) {
        await ReelComment.findByIdAndDelete(itemId);
      }
    }
    // itemType === "User" → use eject_user action instead

    report.status = "resolved";
    await report.save();

    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Content deleted and report resolved",
      data: null,
    });
  }

  // action === "eject_user": Hard-delete the reported user and all their data
  const offendingUserId = report.reportedUser;
  const offendingUser = await User.findById(offendingUserId);

  if (offendingUser) {
    // Delete Cloudinary assets
    if (offendingUser.avatar?.public_id) {
      await deleteFromCloudinary(offendingUser.avatar.public_id).catch(() => { });
    }
    for (const photo of offendingUser.profilePhotos || []) {
      if (photo.public_id) {
        await deleteFromCloudinary(photo.public_id).catch(() => { });
      }
    }

    const uid = new mongoose.Types.ObjectId(String(offendingUser._id));

    // Remove all their Posts + associated content
    const userPosts = await Post.find({ author: uid });
    const postIds = userPosts.map((p) => p._id);
    if (postIds.length > 0) {
      await PostComment.deleteMany({ post: { $in: postIds } });
      await PostLike.deleteMany({ post: { $in: postIds } });
      await Post.deleteMany({ _id: { $in: postIds } });
    }

    // Remove all their Reels + associated content
    const userReels = await Reel.find({ author: uid });
    const reelIds = userReels.map((r) => r._id);
    if (reelIds.length > 0) {
      await ReelComment.deleteMany({ reel: { $in: reelIds } });
      await ReelLike.deleteMany({ reel: { $in: reelIds } });
      await Reel.deleteMany({ _id: { $in: reelIds } });
    }

    // Remove their interactions on others' content
    const userPostLikes = await PostLike.find({ user: uid });
    for (const pl of userPostLikes) {
      if (pl.post) {
        await Post.findByIdAndUpdate(pl.post, { $inc: { likesCount: -1 } }).catch(() => { });
      }
    }
    await PostLike.deleteMany({ user: uid });

    const userPostComments = await PostComment.find({ author: uid });
    for (const pc of userPostComments) {
      if (pc.post) {
        await Post.findByIdAndUpdate(pc.post, { $inc: { commentsCount: -1 } }).catch(() => { });
      }
    }
    await PostComment.deleteMany({ author: uid });

    await ReelComment.deleteMany({ author: uid });
    await ReelLike.deleteMany({ user: uid }); // legacy
    await Reel.updateMany({ likes: uid }, { $pull: { likes: uid } });
    await Reel.updateMany({ likes: String(uid) }, { $pull: { likes: String(uid) } });

    await Message.deleteMany({ sender: uid });
    await Message.updateMany({ seenBy: uid }, { $pull: { seenBy: uid } });

    await Chat.deleteMany({ participants: uid });
    await Notification.deleteMany({ $or: [{ userId: uid }, { fromUserId: uid }] });
    await Appointment.deleteMany({ $or: [{ patient: uid }, { doctor: uid }] });
    await DoctorReview.deleteMany({ $or: [{ patient: uid }, { doctor: uid }] });
    await paymentInfo.deleteMany({ userId: uid });
    await ReferralCode.deleteMany({ generatedBy: uid });

    // Hard-delete the user
    await User.findByIdAndDelete(uid);
  }

  // Mark all pending reports against this user as resolved too
  await Report.updateMany(
    { reportedUser: offendingUserId, status: "pending" },
    { status: "resolved" },
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Offending user ejected and all their data removed",
    data: null,
  });
});
