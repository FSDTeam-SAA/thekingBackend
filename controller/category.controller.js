// controller/category.controller.js
import AppError from "../errors/AppError.js";
import Category from "../model/category.model.js";
import catchAsync from "../utils/catchAsync.js";
import { deleteFromCloudinary, uploadOnCloudinary } from "../utils/commonMethod.js";
import sendResponse from "../utils/sendResponse.js";

// POST
export const createCategory = catchAsync(async (req, res) => {
  const speciality_name = (req.body.speciality_name || "").trim();
  if (!speciality_name) throw new AppError(400, "speciality_name is required");

  let category_image_url = null;
  let category_image_public_id = null;

  if (req.file?.buffer) {
    const uploaded = await uploadOnCloudinary(req.file.buffer, {
      folder: "docmobi/categories",
      resource_type: "image",
    });

    category_image_url = uploaded.secure_url;
    category_image_public_id = uploaded.public_id;
  }

  const created = await Category.create({
    speciality_name,
    category_image_url,
    category_image_public_id,
  });

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Created",
    data: created,
  });
});

// GET ALL
export const getAllCategories = catchAsync(async (req, res) => {
  const data = await Category.find().sort({ createdAt: -1 });
  sendResponse(res, { statusCode: 200, success: true, message: "Category fetched successfully", data });
});

// GET SINGLE
export const getSingleCategory = catchAsync(async (req, res) => {
  const data = await Category.findById(req.params.id);
  if (!data) throw new AppError(404, "Invalid Category id");
  sendResponse(res, { statusCode: 200, success: true, message: "Category fetched successfully", data });
});

// PATCH
export const updateCategory = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw new AppError(404, "Invalid Category id");

  if (req.body.speciality_name !== undefined) {
    category.speciality_name = String(req.body.speciality_name).trim();
  }

  if (req.body.status !== undefined) {
    category.status = req.body.status === "true" || req.body.status === true;
  }

  if (req.file?.buffer) {
    if (category.category_image_public_id) {
      await deleteFromCloudinary(category.category_image_public_id).catch(() => {});
    }

    const uploaded = await uploadOnCloudinary(req.file.buffer, {
      folder: "docmobi/categories",
      resource_type: "image",
    });

    category.category_image_url = uploaded.secure_url;
    category.category_image_public_id = uploaded.public_id;
  }

  await category.save();
  sendResponse(res, { statusCode: 200, success: true, message: "Updated", data: category });
});

// DELETE
export const deleteCategory = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw new AppError(404, "Invalid Category id");

  if (category.category_image_public_id) {
    await deleteFromCloudinary(category.category_image_public_id).catch(() => {});
  }

  await category.deleteOne();
  sendResponse(res, { statusCode: 200, success: true, message: "Deleted Successfully" });
});
