import express from "express";
import {
  createPost,
  getPosts,
  getPostById,
  updatePost,
  deletePost,
  getAllPosts,
  deletePostComment,
  getPostComments,
  addPostComment,
  getPostLikes,
  toggleLikePost,
} from "../controller/post.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";

const router = express.Router();

// Create post (with media)
router.post(
  "/",
  protect,
  upload.array("media", 10),
  createPost
);

// Get current user posts
router.get("/", protect, getPosts);

// ✅ NEW: Get ALL posts from ALL doctors (public feed)
router.get("/all-posts", protect, getAllPosts);

// Get single post
router.get("/:id", protect, getPostById);

// Update post (content + media)
router.put(
  "/:id",
  protect,
  upload.array("media", 10),
  updatePost
);

// Delete post
router.delete("/:id", protect, deletePost);

// Likes
router.post("/:id/like", protect, toggleLikePost);
router.get("/:id/likes", protect, getPostLikes);

// Comments
router.post("/:id/comments", protect, addPostComment);
router.get("/:id/comments", protect, getPostComments);
router.delete("/:id/comments/:commentId", protect, deletePostComment);

export default router;