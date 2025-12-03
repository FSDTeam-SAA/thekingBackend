import { Router } from "express";
import {
  createCategory,
  getSingleCategory,
  updateCategory,
  deleteCategory,
  getAllCategoriesAdmin,
  getAllCategoriesPublic,
} from "../controller/category.controller.js";
import upload from "../middleware/multer.middleware.js";
import { protect, isAdmin } from "../middleware/auth.middleware.js";

const router = Router();

// Public
router.get("/", getAllCategoriesPublic);
router.get("/:id", getSingleCategory);

// Admin only
router.get("/admin/all", protect, isAdmin, getAllCategoriesAdmin);

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

router.delete("/:id", protect, isAdmin, deleteCategory);

export default router;
