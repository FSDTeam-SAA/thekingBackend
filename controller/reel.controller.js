import httpStatus from "http-status";
import { Reel } from "../model/reel.model.js";
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/commonMethod.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";

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

  const populated = await reel.populate("author", "fullName avatar role");

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Reel created successfully",
    data: populated,
  });
});

/**
 * Get reels (feed)
 * - doctor: can see all public reels
 * - others: only public reels (plus own private if you want)
 * query:
 *  - page, limit
 *  - authorId (optional)
 */
export const getReels = catchAsync(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  const userId = req.user._id;

  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;

  const [reels, total] = await Promise.all([
    Reel.find({ author: userId })
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate("author", "fullName avatar role")
      .lean(),
    Reel.countDocuments({ author: userId }),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reels fetched successfully",
    data: {
      items: reels,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
      },
    },
  });
});


export const getAllReels = catchAsync(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;

  const [reels, total] = await Promise.all([
    Reel.find()
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate("author", "fullName avatar role")
      .lean(),
    Reel.countDocuments(),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reels fetched successfully",
    data: {
      items: reels,
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

  const reel = await Reel.findById(id).populate(
    "author",
    "fullName avatar role"
  );

  if (!reel) {
    throw new AppError(httpStatus.NOT_FOUND, "Reel not found");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reel fetched successfully",
    data: reel,
  });
});

/**
 * Update reel (caption, visibility, and optionally replace video/thumbnail)
 * Only author or admin
 * form-data:
 *  - caption (optional)
 *  - visibility (optional)
 *  - video (optional)     -> replaces old video
 *  - thumbnail (optional) -> replaces old thumbnail
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
      "Only author or admin can update this reel"
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

  // handle video replacement
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

  // handle thumbnail replacement
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

  const populated = await reel.populate("author", "fullName avatar role");

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
      "Only author or admin can delete this reel"
    );
  }

  if (reel.video?.public_id) {
    await deleteFromCloudinary(reel.video.public_id).catch(() => {});
  }

  if (reel.thumbnail?.public_id) {
    await deleteFromCloudinary(reel.thumbnail.public_id).catch(() => {});
  }

  await reel.deleteOne();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reel deleted successfully",
    data: null,
  });
});
