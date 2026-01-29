// controller/category.controller.js
import AppError from "../errors/AppError.js";
import Category from "../model/category.model.js";
import catchAsync from "../utils/catchAsync.js";
import {
  deleteFromCloudinary,
  uploadOnCloudinary,
} from "../utils/commonMethod.js";
import sendResponse from "../utils/sendResponse.js";

// POST
export const createCategory = catchAsync(async (req, res) => {
  const speciality_name = (req.body.speciality_name || "").trim();
  if (!speciality_name) throw new AppError(400, "speciality_name is required");

  // accept status from body; default true
  let status = true;
  if (req.body.status !== undefined) {
    status = req.body.status === "true" || req.body.status === true;
  }

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
    status, // ✅ now can be true/false
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
export const getAllCategoriesAdmin = catchAsync(async (req, res) => {
  const { page, limit, search, status, sortBy } = req.query;

  // Base filter
  const filter = {};

  // Status filter
  if (status === "active") filter.status = true;
  else if (status === "inactive") filter.status = false;

  // Sort logic
  let sort = {};
  if (sortBy === "oldestToNewest") {
    sort = { createdAt: 1 };
  } else {
    sort = { createdAt: -1 };
  }

  // Search by speciality_name
  if (search) {
    const regex = new RegExp(search, "i");
    filter.speciality_name = regex;
  }

  // Pagination
  const currentPage = Math.max(Number(page) || 1, 1);
  const pageLimit = Math.min(Number(limit) || 10, 100);
  const skip = (currentPage - 1) * pageLimit;

  // Count total
  const total = await Category.countDocuments(filter);

  // Fetch categories (FIXED SORT)
  const categories = await Category.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(pageLimit);

  if (!categories) throw new AppError(404, "Category not found");

  // Pagination meta
  const totalPages = Math.ceil(total / pageLimit);
  const from = total === 0 ? 0 : skip + 1;
  const to = Math.min(skip + categories.length, total);

  // Response
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Category fetched successfully",
    data: categories,
    pagination: {
      page: currentPage,
      limit: pageLimit,
      total,
      totalPages,
      from,
      to,
      hasNext: currentPage < totalPages,
      hasPrev: currentPage > 1,
    },
  });
});

export const getAllCategoriesPublic = catchAsync(async (req, res) => {
  const data = await Category.find({ status: true }).sort({ createdAt: -1 });
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Category fetched successfully",
    data,
  });
});

// GET SINGLE
export const getSingleCategory = catchAsync(async (req, res) => {
  const data = await Category.findById(req.params.id);
  if (!data) throw new AppError(404, "Invalid Category id");
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Category fetched successfully",
    data,
  });
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
      await deleteFromCloudinary(category.category_image_public_id).catch(
        () => {},
      );
    }

    const uploaded = await uploadOnCloudinary(req.file.buffer, {
      folder: "docmobi/categories",
      resource_type: "image",
    });

    category.category_image_url = uploaded.secure_url;
    category.category_image_public_id = uploaded.public_id;
  }

  await category.save();
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Updated",
    data: category,
  });
});

// DELETE
export const deleteCategory = catchAsync(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw new AppError(404, "Invalid Category id");

  if (category.category_image_public_id) {
    await deleteFromCloudinary(category.category_image_public_id).catch(
      () => {},
    );
  }

  await category.deleteOne();
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Deleted Successfully",
  });
});
