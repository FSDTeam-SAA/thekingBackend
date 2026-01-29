import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { ReferralCode } from "../model/referralCode.model.js";

const normalizeCode = (code = "") => String(code).trim().toUpperCase();

export const createReferralCode = catchAsync(async (req, res) => {
  const { code, description, isActive } = req.body;

  if (!code) {
    throw new AppError(httpStatus.BAD_REQUEST, "Referral code is required");
  }

  const normalizedCode = normalizeCode(code);

  const existingCode = await ReferralCode.findOne({ code: normalizedCode });
  if (existingCode) {
    throw new AppError(httpStatus.BAD_REQUEST, "Referral code already exists");
  }

  const referralCode = await ReferralCode.create({
    code: normalizedCode,
    description,
    isActive: typeof isActive === "boolean" ? isActive : true,
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Referral code created successfully",
    data: referralCode,
  });
});

export const getReferralCodes = catchAsync(async (req, res) => {
  const { status , page, limit, sortBy, search } = req.query;

  // Base filter
  const filter = {};

  // Status filter
  if (status === "active") filter.isActive = true;
  else if (status === "inactive") filter.isActive = false;
  else if (status === "all") filter.isActive = { $exists: true };

  // Search (ONLY code & description)
  if (search) {
    const regex = new RegExp(search, "i");
    filter.$or = [{ code: regex }, { description: regex }];
  }

  // Sort logic
  let sort = {};
  if (sortBy === "oldestToNewest") {
    sort = { createdAt: 1 };
  } else {
    sort = { createdAt: -1 };
  }

  // Pagination
  const currentPage = Math.max(Number(page) || 1, 1);
  const pageLimit = Math.min(Number(limit) || 10, 100);
  const skip = (currentPage - 1) * pageLimit;

  // Count total
  const total = await ReferralCode.countDocuments(filter);

  // Fetch referral codes
  const referralCodes = await ReferralCode.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(pageLimit);

    if (referralCodes.length === 0) {
      throw new AppError(httpStatus.NOT_FOUND, "No referral codes found");
    }

  // Pagination meta
  const totalPages = Math.ceil(total / pageLimit);
  const from = total === 0 ? 0 : skip + 1;
  const to = Math.min(skip + referralCodes.length, total);

  // Send response
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral codes fetched successfully",
    data: referralCodes,
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


export const getReferralCode = catchAsync(async (req, res) => {
  const { id } = req.params;
  const referralCode = await ReferralCode.findById(id);

  if (!referralCode) {
    throw new AppError(httpStatus.NOT_FOUND, "Referral code not found");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral code fetched successfully",
    data: referralCode,
  });
});

export const updateReferralCode = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { code, description, isActive } = req.body;

  const referralCode = await ReferralCode.findById(id);
  if (!referralCode) {
    throw new AppError(httpStatus.NOT_FOUND, "Referral code not found");
  }

  if (code) {
    if (referralCode.timesUsed > 0) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Referral code cannot be changed after doctors have registered with it",
      );
    }
    const normalizedCode = normalizeCode(code);
    const conflict = await ReferralCode.findOne({
      code: normalizedCode,
      _id: { $ne: id },
    });
    if (conflict) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Referral code already exists",
      );
    }
    referralCode.code = normalizedCode;
  }

  if (typeof description !== "undefined") {
    referralCode.description = description;
  }

  if (typeof isActive !== "undefined") {
    referralCode.isActive = isActive;
  }

  await referralCode.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral code updated successfully",
    data: referralCode,
  });
});

export const deleteReferralCode = catchAsync(async (req, res) => {
  const { id } = req.params;
  const referralCode = await ReferralCode.findOne({ _id: id });
  if (!referralCode) {
    throw new AppError(httpStatus.NOT_FOUND, "Referral code not found");
  }
  if (referralCode.timesUsed > 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Referral code cannot be deleted after doctors have registered with it",
    );
  }
  await ReferralCode.deleteOne({ _id: id });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral code deleted successfully",
    data: referralCode,
  });
});
