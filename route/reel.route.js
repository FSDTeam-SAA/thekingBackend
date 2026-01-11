import express from "express";
import {
  createReel,
  getReels,
  getReelById,
  updateReel,
  deleteReel,
  getAllReels,
  toggleLikeReel,
  getReelComments,
  addReelComment,
  shareReel,
} from "../controller/reel.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";

const router = express.Router();

// Create reel
router.post(
  "/",
  protect,
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]),
  createReel
);

// Get reels (feed)
router.get("/", protect, getReels);

// all reels – only doctor can access
router.get("/all-reels", protect, getAllReels);

// Get single reel
router.get("/:id", protect, getReelById);

// Update reel
router.put(
  "/:id",
  protect,
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]),
  updateReel
);

// Delete reel
router.delete("/:id", protect, deleteReel);

// ✅ Toggle like
router.post("/:id/like", protect, toggleLikeReel);

// ✅ Get reel comments
router.get("/:id/comments", protect, getReelComments);

// ✅ Add reel comment
router.post("/:id/comments", protect, addReelComment);

// ✅ Share reel
router.post("/:id/share", protect, shareReel);

export default router;