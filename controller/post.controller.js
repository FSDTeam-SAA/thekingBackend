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
import mongoose from "mongoose";
import { createNotification } from "../utils/notify.js";
import { io } from "../server.js";

/**
 * Create a post
 */
export const createPost = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { content, visibility } = req.body;

  const files = req.files || [];

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

  const post = await Post.create({
    author: userId,
    content: content ? String(content).trim() : "",
    visibility: visibility === "private" ? "private" : "public",
    media,
  });

  const populated = await post.populate(
    "author",
    "fullName avatar role specialty",
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Post created successfully",
    data: populated,
  });
});

/**
 * ✅ FIXED: Get ALL posts (public feed for doctors)
 * - Doctors can see all doctor posts
 * - Includes isLiked field for current user
 */
export const getAllPosts = catchAsync(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 20;
  const userId = req.user._id;

  // ✅ Only show posts from doctors + public visibility
  const [posts, total] = await Promise.all([
    Post.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "author",
          foreignField: "_id",
          as: "authorData",
        },
      },
      {
        $unwind: "$authorData",
      },
      {
        $match: {
          "authorData.role": "doctor",
          visibility: "public",
        },
      },
      {
        $lookup: {
          from: "postlikes",
          let: { postId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$post", "$$postId"] },
                    { $eq: ["$user", userId] },
                  ],
                },
              },
            },
          ],
          as: "userLike",
        },
      },
      {
        $addFields: {
          isLiked: { $gt: [{ $size: "$userLike" }, 0] },
        },
      },
      {
        $project: {
          _id: 1,
          content: 1,
          media: 1,
          visibility: 1,
          likesCount: 1,
          commentsCount: 1,
          sharesCount: { $ifNull: ["$sharesCount", 0] },
          isLiked: 1,
          createdAt: 1,
          updatedAt: 1,
          author: {
            _id: "$authorData._id",
            fullName: "$authorData.fullName",
            avatar: "$authorData.avatar",
            role: "$authorData.role",
            specialty: "$authorData.specialty",
          },
        },
      },
      { $sort: { createdAt: -1 } },
      { $skip: (pageNum - 1) * limitNum },
      { $limit: limitNum },
    ]),
    Post.countDocuments({
      visibility: "public",
    }),
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
  const userId = req.user._id;

  const posts = await Post.aggregate([
    { $match: { _id: mongoose.Types.ObjectId(id) } },
    {
      $lookup: {
        from: "users",
        localField: "author",
        foreignField: "_id",
        as: "authorData",
      },
    },
    { $unwind: "$authorData" },
    {
      $lookup: {
        from: "postlikes",
        let: { postId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$post", "$$postId"] },
                  { $eq: ["$user", userId] },
                ],
              },
            },
          },
        ],
        as: "userLike",
      },
    },
    {
      $addFields: {
        isLiked: { $gt: [{ $size: "$userLike" }, 0] },
      },
    },
    {
      $project: {
        _id: 1,
        content: 1,
        media: 1,
        visibility: 1,
        likesCount: 1,
        commentsCount: 1,
        sharesCount: { $ifNull: ["$sharesCount", 0] },
        isLiked: 1,
        createdAt: 1,
        updatedAt: 1,
        author: {
          _id: "$authorData._id",
          fullName: "$authorData.fullName",
          avatar: "$authorData.avatar",
          role: "$authorData.role",
          specialty: "$authorData.specialty",
        },
      },
    },
  ]);

  if (!posts || posts.length === 0) {
    throw new AppError(httpStatus.NOT_FOUND, "Post not found");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Post fetched successfully",
    data: posts[0],
  });
});

/**
 * Get posts of current user
 */
export const getPosts = catchAsync(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const userId = req.user._id;
  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;

  const [posts, total] = await Promise.all([
    Post.aggregate([
      { $match: { author: userId } },
      {
        $lookup: {
          from: "users",
          localField: "author",
          foreignField: "_id",
          as: "authorData",
        },
      },
      { $unwind: "$authorData" },
      {
        $lookup: {
          from: "postlikes",
          let: { postId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$post", "$$postId"] },
                    { $eq: ["$user", userId] },
                  ],
                },
              },
            },
          ],
          as: "userLike",
        },
      },
      {
        $addFields: {
          isLiked: { $gt: [{ $size: "$userLike" }, 0] },
        },
      },
      {
        $project: {
          _id: 1,
          content: 1,
          media: 1,
          visibility: 1,
          likesCount: 1,
          commentsCount: 1,
          sharesCount: { $ifNull: ["$sharesCount", 0] },
          isLiked: 1,
          createdAt: 1,
          updatedAt: 1,
          author: {
            _id: "$authorData._id",
            fullName: "$authorData.fullName",
            avatar: "$authorData.avatar",
            role: "$authorData.role",
            specialty: "$authorData.specialty",
          },
        },
      },
      { $sort: { createdAt: -1 } },
      { $skip: (pageNum - 1) * limitNum },
      { $limit: limitNum },
    ]),
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

/**
 * Update post
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
      "Only author or admin can update this post",
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

  const populated = await post.populate(
    "author",
    "fullName avatar role specialty",
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Post updated successfully",
    data: populated,
  });
});

/**
 * Delete post
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
      "Only author or admin can delete this post",
    );
  }

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
 */

export const toggleLikePost = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { id: postId } = req.params;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Fetch post and populate author
    const post = await Post.findById(postId)
      .populate("author")
      .session(session);
    if (!post) {
      throw new AppError(httpStatus.NOT_FOUND, "Post not found");
    }

    const existing = await PostLike.findOne({
      post: postId,
      user: userId,
    }).session(session);

    let liked;
    if (existing) {
      //  Dislike
      await existing.deleteOne({ session });
      post.likesCount = Math.max(0, (post.likesCount || 0) - 1);
      liked = false;
    } else {
      // Like
      await PostLike.create([{ post: postId, user: userId }], { session });
      post.likesCount = (post.likesCount || 0) + 1;
      liked = true;

      // Send notification only if liker is not the author
      if (!post.author._id.equals(userId)) {
        
        const notificationPayload = {
          userId: post.author._id,
          fromUserId: userId,
          type: "post_liked",
          title: "Your post got a like!",
          content: `${req.user.fullName} liked your post.`,
          meta: {
            postId: post._id,
            likerId: userId,
            likerName: req.user.fullName,
          },
        };

        // Save notification in DB
        await createNotification({ ...notificationPayload, session });

        // Emit via socket if online
        io.to(post.author._id.toString()).emit(
          "like_post_notification",
          notificationPayload,
        );
      }
    }

    await post.save({ session });

    await session.commitTransaction();
    session.endSession();

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: liked ? "Post liked" : "Post unliked",
      data: {
        liked,
        likesCount: post.likesCount,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
});

/**
 * Get likes of a post
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
 */
export const addPostComment = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const { id: postId } = req.params;
  const { content } = req.body;

  if (!content || !String(content).trim()) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "content is required for comment",
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

  post.commentsCount = (post.commentsCount || 0) + 1;
  await post.save();

  const populated = await comment.populate("author", "fullName avatar role");

  // Send notification to post author if commenter is not the author
  if (!post.author._id.equals(userId)) {
    const notificationPayload = {
      userId: post.author._id,
      fromUserId: userId,
      type: "post_commented",
      title: "Your post got a comment!",
      content: `${req.user.fullName} commented on your post.`,
      meta: {
        postId: post._id,
        commenterId: userId,
        commenterName: req.user.fullName,
      },
    };
    // Save notification in DB
    await createNotification({ ...notificationPayload });
    // Emit via socket if online
    io.to(post.author._id.toString()).emit("post_comment_notification", {
      ...notificationPayload,
    });
  }

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Comment added successfully",
    data: populated,
  });
});

/**
 * Get comments of a post
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
      "Only comment author or admin can delete this comment",
    );
  }

  await comment.deleteOne();

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
