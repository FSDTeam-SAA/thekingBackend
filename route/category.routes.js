import { Router } from "express";
import {
  createCategory,
  getAllCategories,
  getSingleCategory,
  updateCategory,
  deleteCategory,
} from "../controller/category.controller.js";
import upload from "../middleware/multer.middleware.js";
import { protect, isAdmin } from "../middleware/auth.middleware.js"; // adjust path

const router = Router();

// Public
router.get("/", getAllCategories);
router.get("/:id", getSingleCategory);

// Admin only
router.post(
  "/",
  protect,
  isAdmin,
  upload.single("category_image"),
  createCategory
);

router.patch(
  "/:id",
  protect,
  isAdmin,
  upload.single("category_image"),
  updateCategory
);

router.delete(
  "/:id",
  protect,
  isAdmin,
  deleteCategory
);

export default router;
