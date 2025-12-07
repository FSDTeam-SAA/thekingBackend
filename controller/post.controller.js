import httpStatus from "http-status";
import { Post } from "../model/post.model.js";
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/commonMethod.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";

/**
 * Create a post
 * form-data:
 *  - content (text)
 *  - visibility (optional: public|private)
 *  - media[] (files: image / video / pdf / etc.)
 */
export const createPost = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { content, visibility } = req.body;

  const files = req.files || []; // using upload.array("media")

  const media = [];
  for (const file of files) {
    const upload = await uploadOnCloudinary(file.buffer, {
      folder: "docmobi/posts",
      resource_type: "auto", // supports image, video, pdf, etc.
    });

    media.push({
      public_id: upload.public_id,
      url: upload.secure_url,
      resourceType: upload.resource_type || "auto",
      format: upload.format,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    });
  }

  const post = await Post.create({
    author: userId,
    content: content ? String(content).trim() : "",
    visibility: visibility === "private" ? "private" : "public",
    media,
  });

  const populated = await post.populate("author", "fullName avatar role");

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Post created successfully",
    data: populated,
  });
});

/**
 * Get posts (feed / profile)
 * query:
 *  - authorId (optional)
 *  - page, limit (optional – default 1,10)
 */
export const getPosts = catchAsync(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  const userId = req.user._id;

    if(!userId.role == "doctor") {
      throw new AppError(httpStatus.FORBIDDEN, "Not allowed to view this user");
    }

  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;

    const posts = await Post.find({ author: userId })
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate("author", "fullName avatar role")
      .lean();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Posts fetched successfully",
    data: {
      items: posts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: posts.length,
      },
    },
  });
});


/// get all posts with pagination
export const getAllPosts = catchAsync(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;

  const [posts, total] = await Promise.all([
    Post.find()
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate("author", "fullName avatar role")
      .lean(),
    Post.countDocuments(),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Posts fetched successfully",
    data: {
      items: posts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
      },
    },
  });
});


/**
 * Get single post
 */
export const getPostById = catchAsync(async (req, res) => {
  const { id } = req.params;

  const post = await Post.findById(id).populate(
    "author",
    "fullName avatar role"
  );

  if (!post) {
    throw new AppError(httpStatus.NOT_FOUND, "Post not found");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Post fetched successfully",
    data: post,
  });
});

/**
 * Update post (content + optionally replace media)
 * Only author or admin
 * form-data:
 *  - content (optional)
 *  - visibility (optional)
 *  - media[] (optional new files – if provided, old media are deleted)
 */
export const updatePost = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { content, visibility } = req.body;

  const post = await Post.findById(id);
  if (!post) throw new AppError(httpStatus.NOT_FOUND, "Post not found");

  const isOwner = String(post.author) === String(req.user._id);
  const isAdmin = req.user.role === "admin";
  if (!isOwner && !isAdmin) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only author can update this post"
    );
  }

  if (content !== undefined) {
    post.content = String(content).trim();
  }

  if (visibility !== undefined) {
    post.visibility = visibility === "private" ? "private" : "public";
  }

  const files = req.files || [];
  if (files.length > 0) {
    // delete old media from cloudinary
    for (const m of post.media) {
      if (m.public_id) {
        await deleteFromCloudinary(m.public_id).catch(() => {});
      }
    }

    const media = [];
    for (const file of files) {
      const upload = await uploadOnCloudinary(file.buffer, {
        folder: "docmobi/posts",
        resource_type: "auto",
      });

      media.push({
        public_id: upload.public_id,
        url: upload.secure_url,
        resourceType: upload.resource_type || "auto",
        format: upload.format,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      });
    }

    post.media = media;
  }

  await post.save();

  const populated = await post.populate("author", "fullName avatar role");

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Post updated successfully",
    data: populated,
  });
});

/**
 * Delete post
 * Only author or admin
 */
export const deletePost = catchAsync(async (req, res) => {
  const { id } = req.params;

  const post = await Post.findById(id);
  if (!post) throw new AppError(httpStatus.NOT_FOUND, "Post not found");

  const isOwner = String(post.author) === String(req.user._id);
  const isAdmin = req.user.role === "admin";
  if (!isOwner && !isAdmin) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only author or admin can delete this post"
    );
  }

  // delete media files
  for (const m of post.media) {
    if (m.public_id) {
      await deleteFromCloudinary(m.public_id).catch(() => {});
    }
  }

  await post.deleteOne();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Post deleted successfully",
    data: null,
  });
});
