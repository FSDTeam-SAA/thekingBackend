import express from "express";
import {
  createReel,
  getReels,
  getReelById,
  updateReel,
  deleteReel,
  getAllReels,
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
router.get("/all-reels", getAllReels);

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

export default router;
