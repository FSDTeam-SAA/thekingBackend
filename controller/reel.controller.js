import httpStatus from "http-status";
import { Reel } from "../model/reel.model.js";
import { ReelComment } from "../model/reelComment.model.js";
import {
  uploadOnCloudinary,
  deleteFromCloudinary,
} from "../utils/commonMethod.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import { io } from "../server.js";
import { createBulkNotification, createNotification } from "../utils/notify.js";
import mongoose from "mongoose";

/**
 * Create a reel
 * form-data:
 *  - caption (text, optional)
 *  - visibility (public|private, optional)
 *  - video (File, required)  -> mp4 / mov / etc.
 *  - thumbnail (File, optional) -> jpg / png
 */
export const createReel = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { caption, visibility } = req.body;

  const videoFile = req.files?.video?.[0];
  const thumbnailFile = req.files?.thumbnail?.[0];

  if (!videoFile) {
    throw new AppError(httpStatus.BAD_REQUEST, "Video file is required");
  }

  // upload video
  const videoUpload = await uploadOnCloudinary(videoFile.buffer, {
    folder: "docmobi/reels",
    resource_type: "video",
  });

  const video = {
    public_id: videoUpload.public_id,
    url: videoUpload.secure_url,
    resourceType: videoUpload.resource_type || "video",
    format: videoUpload.format,
    duration: videoUpload.duration,
    originalName: videoFile.originalname,
    mimeType: videoFile.mimetype,
    size: videoFile.size,
  };

  let thumbnail = undefined;
  if (thumbnailFile) {
    const thumbUpload = await uploadOnCloudinary(thumbnailFile.buffer, {
      folder: "docmobi/reels/thumbnails",
      resource_type: "image",
    });

    thumbnail = {
      public_id: thumbUpload.public_id,
      url: thumbUpload.secure_url,
      resourceType: thumbUpload.resource_type || "image",
      format: thumbUpload.format,
      originalName: thumbnailFile.originalname,
      mimeType: thumbnailFile.mimetype,
      size: thumbnailFile.size,
    };
  }

  const reel = await Reel.create({
    author: userId,
    caption: caption ? String(caption).trim() : "",
    visibility: visibility === "private" ? "private" : "public",
    video,
    thumbnail,
  });

  const populated = await reel.populate(
    "author",
    "fullName avatar role specialty",
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Reel created successfully",
    data: populated,
  });
});

/**
 * Get reels (feed) - currently only user's own reels
 * query: page, limit, authorId (optional)
 */
export const getReels = catchAsync(async (req, res) => {
  const { page = 1, limit = 10, authorId } = req.query;

  const userId = req.user._id;
  const targetUserId = authorId || userId;

  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;

  const query = { author: targetUserId };

  const [reels, total] = await Promise.all([
    Reel.find(query)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate("author", "fullName avatar role specialty")
      .lean(),
    Reel.countDocuments(query),
  ]);

  // ✅ Add user-specific data (isLiked, commentsCount)
  const reelsWithUserData = await Promise.all(
    reels.map(async (reel) => {
      const [isLiked, commentsCount] = await Promise.all([
        reel.likes?.includes(userId.toString()),
        ReelComment.countDocuments({ reel: reel._id }),
      ]);

      return {
        ...reel,
        isLiked: !!isLiked,
        likesCount: reel.likes?.length || 0,
        commentsCount,
        sharesCount: reel.sharesCount || 0,
      };
    }),
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reels fetched successfully",
    data: {
      items: reelsWithUserData,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
      },
    },
  });
});

/**
 * Get all public reels (main feed)
 */
/**
 * Get reels (main feed) with role-based visibility access
 * - patient  -> public only
 * - doctor   -> public + private
 */
export const getAllReels = catchAsync(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;

  const userId = req.user?._id;
  const role = req.user?.role;

  // Role-based visibility filter
  const visibilityFilter =
    role === "doctor"
      ? { visibility: { $in: ["public", "private"] } }
      : { visibility: "public" }; // patient (default)

  const [reels, total] = await Promise.all([
    Reel.find(visibilityFilter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate("author", "fullName avatar role specialty")
      .lean(),
    Reel.countDocuments(visibilityFilter),
  ]);

  const reelsWithUserData = await Promise.all(
    reels.map(async (reel) => {
      const [commentsCount] = await Promise.all([
        ReelComment.countDocuments({ reel: reel._id }),
      ]);

      const isLiked = (reel.likes || []).some(
        (id) => id.toString() === userId.toString(),
      );

      return {
        ...reel,
        isLiked,
        likesCount: reel.likes?.length || 0,
        commentsCount,
        sharesCount: reel.sharesCount || 0,
      };
    }),
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reels fetched successfully",
    data: {
      items: reelsWithUserData,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
      },
    },
  });
});

/**
 * Get single reel by id
 */
export const getReelById = catchAsync(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  const reel = await Reel.findById(id)
    .populate("author", "fullName avatar role specialty")
    .lean();

  if (!reel) {
    throw new AppError(httpStatus.NOT_FOUND, "Reel not found");
  }

  // প্রাইভেট রিল শুধু ওনার/অ্যাডমিন দেখতে পারবে
  if (reel.visibility === "private") {
    const isOwner = String(reel.author._id) === String(userId);
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
      throw new AppError(httpStatus.FORBIDDEN, "This reel is private");
    }
  }

  // ✅ Add user-specific data
  const [isLiked, commentsCount] = await Promise.all([
    reel.likes?.includes(userId.toString()),
    ReelComment.countDocuments({ reel: reel._id }),
  ]);

  const reelWithUserData = {
    ...reel,
    isLiked: !!isLiked,
    likesCount: reel.likes?.length || 0,
    commentsCount,
    sharesCount: reel.sharesCount || 0,
  };

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reel fetched successfully",
    data: reelWithUserData,
  });
});

/**
 * Toggle like on a reel
 */
export const toggleLikeReel = catchAsync(async (req, res) => {
  const { id } = req.params; // reel id
  const userId = req.user._id;

  const reel = await Reel.findById(id);
  if (!reel) {
    throw new AppError(httpStatus.NOT_FOUND, "Reel not found");
  }

  const alreadyLiked = reel.likes?.includes(userId.toString());

  if (alreadyLiked) {
    // Unlike
    reel.likes = reel.likes.filter((likeUserId) => !likeUserId.equals(userId));
  } else {
    // Like
    if (!reel.likes) reel.likes = [];
    reel.likes.push(userId);
  }

  await reel.save({ validateBeforeSave: false });

  const populated = await reel.populate(
    "author",
    "fullName avatar role specialty",
  );

  // 🔔 Send notification only if liker is not the author
  if (!reel.author._id.equals(userId)) {
    const notificationPayload = {
      userId: reel.author._id,
      fromUserId: userId,
      type: "reel_liked",
      title: "Your reel got a like!",
      content: `${req.user.fullName} liked your reel`,
      meta: {
        reelId: reel._id,
        reelCaption: reel.caption,
      },
    };
    // save in DB with transaction
    await createNotification({ ...notificationPayload });
    // emit socket after DB commit (optional)
    io.to(reel.author._id.toString()).emit("reel_like_notification", {
      ...notificationPayload,
    });
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: alreadyLiked ? "Reel unliked" : "Reel liked",
    data: {
      reel: populated,
      likesCount: reel.likes?.length || 0,
      isLiked: !alreadyLiked,
    },
  });
});

/**
 * Get comments for a reel
 */
export const getReelComments = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { page = 1, limit = 50 } = req.query;

  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 50;

  const reel = await Reel.findById(id);
  if (!reel) {
    throw new AppError(httpStatus.NOT_FOUND, "Reel not found");
  }

  const [comments, total] = await Promise.all([
    ReelComment.find({ reel: id })
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate("author", "fullName avatar role specialty")
      .lean(),
    ReelComment.countDocuments({ reel: id }),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reel comments fetched successfully",
    data: {
      items: comments,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
      },
    },
  });
});

/**
 * Add comment to a reel
 */

export const addReelComment = catchAsync(async (req, res) => {
  const { id: reelId } = req.params;
  const { content } = req.body;
  const userId = req.user._id;

  if (!content || content.trim().length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "Comment content is required");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const reel = await Reel.findById(reelId).session(session);
    if (!reel) {
      throw new AppError(httpStatus.NOT_FOUND, "Reel not found");
    }

    // 1️⃣ Create comment
    const comment = await ReelComment.create(
      [
        {
          reel: reelId,
          author: userId,
          content: content.trim(),
        },
      ],
      { session },
    );

    if (!comment || comment.length === 0) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to comment on reel",
      );
    }

    const populatedComment = await comment[0].populate(
      "author",
      "fullName avatar role specialty",
    );

    // 2️⃣ Send notification if commenter is not reel author
    if (!reel.author.equals(userId)) {
      const notificationPayload = {
        userId: reel.author,
        fromUserId: userId,
        type: "reel_commented",
        title: "New comment on your reel",
        content: `${populatedComment.author.fullName} commented on your reel`,
        reel: reelId,
        meta: {
          reelId: reel._id,
          reelCaption: reel.caption,
        },
      };

      // save in DB with transaction
      await createNotification({ ...notificationPayload, session });

      // emit socket after DB commit (optional)
      setTimeout(() => {
        io.to(reel.author.toString()).emit(
          "reel_comment_notification",
          notificationPayload,
        );
      }, 0); // can adjust delay if needed
    }

    // 3️⃣ Commit transaction
    await session.commitTransaction();
    session.endSession();

    sendResponse(res, {
      statusCode: httpStatus.CREATED,
      success: true,
      message: "Comment added successfully",
      data: populatedComment,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
});

/**
 * Share reel (increment share count)
 */
export const shareReel = catchAsync(async (req, res) => {
  const { id } = req.params;

  const reel = await Reel.findById(id);
  if (!reel) {
    throw new AppError(httpStatus.NOT_FOUND, "Reel not found");
  }

  // Increment sharesCount
  if (!reel.sharesCount) reel.sharesCount = 0;
  reel.sharesCount += 1;

  await reel.save({ validateBeforeSave: false });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reel shared successfully",
    data: {
      sharesCount: reel.sharesCount,
    },
  });
});

/**
 * Update reel (caption, visibility, and optionally replace video/thumbnail)
 * Only author or admin
 */
export const updateReel = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { caption, visibility } = req.body;

  const reel = await Reel.findById(id);
  if (!reel) throw new AppError(httpStatus.NOT_FOUND, "Reel not found");

  const isOwner = String(reel.author) === String(req.user._id);
  const isAdmin = req.user.role === "admin";

  if (!isOwner && !isAdmin) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only author or admin can update this reel",
    );
  }

  if (caption !== undefined) {
    reel.caption = String(caption).trim();
  }

  if (visibility !== undefined) {
    reel.visibility = visibility === "private" ? "private" : "public";
  }

  const videoFile = req.files?.video?.[0];
  const thumbnailFile = req.files?.thumbnail?.[0];

  if (videoFile) {
    if (reel.video?.public_id) {
      await deleteFromCloudinary(reel.video.public_id).catch(() => {});
    }

    const videoUpload = await uploadOnCloudinary(videoFile.buffer, {
      folder: "docmobi/reels",
      resource_type: "video",
    });

    reel.video = {
      public_id: videoUpload.public_id,
      url: videoUpload.secure_url,
      resourceType: videoUpload.resource_type || "video",
      format: videoUpload.format,
      duration: videoUpload.duration,
      originalName: videoFile.originalname,
      mimeType: videoFile.mimetype,
      size: videoFile.size,
    };
  }

  if (thumbnailFile) {
    if (reel.thumbnail?.public_id) {
      await deleteFromCloudinary(reel.thumbnail.public_id).catch(() => {});
    }

    const thumbUpload = await uploadOnCloudinary(thumbnailFile.buffer, {
      folder: "docmobi/reels/thumbnails",
      resource_type: "image",
    });

    reel.thumbnail = {
      public_id: thumbUpload.public_id,
      url: thumbUpload.secure_url,
      resourceType: thumbUpload.resource_type || "image",
      format: thumbUpload.format,
      originalName: thumbnailFile.originalname,
      mimeType: thumbnailFile.mimetype,
      size: thumbnailFile.size,
    };
  }

  await reel.save();

  const populated = await reel.populate(
    "author",
    "fullName avatar role specialty",
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reel updated successfully",
    data: populated,
  });
});

/**
 * Delete reel
 * Only author or admin
 */
export const deleteReel = catchAsync(async (req, res) => {
  const { id } = req.params;

  const reel = await Reel.findById(id);
  if (!reel) throw new AppError(httpStatus.NOT_FOUND, "Reel not found");

  const isOwner = String(reel.author) === String(req.user._id);
  const isAdmin = req.user.role === "admin";

  if (!isOwner && !isAdmin) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only author or admin can delete this reel",
    );
  }

  if (reel.video?.public_id) {
    await deleteFromCloudinary(reel.video.public_id).catch(() => {});
  }

  if (reel.thumbnail?.public_id) {
    await deleteFromCloudinary(reel.thumbnail.public_id).catch(() => {});
  }

  // ✅ Delete all comments associated with this reel
  await ReelComment.deleteMany({ reel: id });

  await reel.deleteOne();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reel deleted successfully",
    data: null,
  });
});
