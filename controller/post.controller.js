import httpStatus from "http-status";
import { Post } from "../model/post.model.js";
import { PostLike } from "../model/postLike.model.js";
import { PostComment } from "../model/postComment.model.js";
import {
  uploadOnCloudinary,
  deleteFromCloudinary,
} from "../utils/commonMethod.js";
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
 * Get posts of current doctor (profile)
 * router.get("/", protect, getPosts)
 * - only role "doctor" allowed
 * query: page, limit
 */
export const getPosts = catchAsync(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  const userId = req.user._id;
  const role = req.user.role;

  // only doctor can see his own posts here
  if (role !== "doctor") {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only doctors can view their own posts"
    );
  }

  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;

  const [posts, total] = await Promise.all([
    Post.find({ author: userId })
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate("author", "fullName avatar role")
      .lean(),
    Post.countDocuments({ author: userId }),
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

/// get all posts with pagination (e.g. public feed / admin)
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
      "Only author or admin can update this post"
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

/**
 * Toggle like / unlike a post
 * POST /posts/:id/like
 */
export const toggleLikePost = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { id: postId } = req.params;

  const post = await Post.findById(postId);
  if (!post) {
    throw new AppError(httpStatus.NOT_FOUND, "Post not found");
  }

  const existing = await PostLike.findOne({ post: postId, user: userId });

  let liked;
  if (existing) {
    // unlike
    await existing.deleteOne();
    post.likesCount = Math.max(0, (post.likesCount || 0) - 1);
    liked = false;
  } else {
    // like
    await PostLike.create({ post: postId, user: userId });
    post.likesCount = (post.likesCount || 0) + 1;
    liked = true;
  }

  await post.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: liked ? "Post liked" : "Post unliked",
    data: {
      liked,
      likesCount: post.likesCount,
    },
  });
});

/**
 * Get likes of a post
 * GET /posts/:id/likes?page=&limit=
 */
export const getPostLikes = catchAsync(async (req, res) => {
  const { id: postId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 20;

  const [likes, total] = await Promise.all([
    PostLike.find({ post: postId })
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate("user", "fullName avatar role")
      .lean(),
    PostLike.countDocuments({ post: postId }),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Post likes fetched successfully",
    data: {
      items: likes,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
      },
    },
  });
});

/**
 * Add comment to a post
 * POST /posts/:id/comments
 * body: { content }
 */
export const addPostComment = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { id: postId } = req.params;
  const { content } = req.body;

  if (!content || !String(content).trim()) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "content is required for comment"
    );
  }

  const post = await Post.findById(postId);
  if (!post) {
    throw new AppError(httpStatus.NOT_FOUND, "Post not found");
  }

  const comment = await PostComment.create({
    post: postId,
    author: userId,
    content: String(content).trim(),
  });

  // increment comments count
  post.commentsCount = (post.commentsCount || 0) + 1;
  await post.save();

  const populated = await comment.populate("author", "fullName avatar role");

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Comment added successfully",
    data: populated,
  });
});

/**
 * Get comments of a post
 * GET /posts/:id/comments?page=&limit=
 */
export const getPostComments = catchAsync(async (req, res) => {
  const { id: postId } = req.params;
  const { page = 1, limit = 10 } = req.query;

  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;

  const [comments, total] = await Promise.all([
    PostComment.find({ post: postId })
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate("author", "fullName avatar role")
      .lean(),
    PostComment.countDocuments({ post: postId }),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Comments fetched successfully",
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
 * Delete a comment
 * DELETE /posts/:id/comments/:commentId
 * Only comment author or admin
 */
export const deletePostComment = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const role = req.user.role;
  const { id: postId, commentId } = req.params;

  const comment = await PostComment.findById(commentId);
  if (!comment || String(comment.post) !== String(postId)) {
    throw new AppError(httpStatus.NOT_FOUND, "Comment not found");
  }

  const isOwner = String(comment.author) === String(userId);
  const isAdmin = role === "admin";
  if (!isOwner && !isAdmin) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only comment author or admin can delete this comment"
    );
  }

  await comment.deleteOne();

  // decrease commentsCount on post
  await Post.findByIdAndUpdate(postId, {
    $inc: { commentsCount: -1 },
  }).catch(() => {});

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Comment deleted successfully",
    data: null,
  });
});
