// controller/user.controller.js
import httpStatus from "http-status";
import mongoose from "mongoose";
import { User } from "../model/user.model.js";
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/commonMethod.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import { DoctorReview } from "../model/doctorReview.model.js";   // make sure this model exists
import { createNotification } from "../utils/notify.js";         // make sure this helper exists

/**
 * Helpers
 */
const normalizeDay = (day) => {
  if (!day) return null;
  const d = String(day).toLowerCase().trim();
  const allowed = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
  return allowed.includes(d) ? d : null;
};

const isValidTime = (t) =>
  /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(t || "").trim());

const asNumber = (v) => {
  if (v === "" || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// safe parse for form-data JSON strings
const parseIfString = (v) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

const sanitizeWeeklySchedule = (input) => {
  if (!Array.isArray(input)) return undefined;

  const schedule = input
    .map((item) => {
      const day = normalizeDay(item?.day);
      if (!day) return null;

      const isActive = Boolean(item?.isActive);

      const slots = Array.isArray(item?.slots)
        ? item.slots
            .map((s) => {
              const start = String(s?.start || "").trim();
              const end = String(s?.end || "").trim();
              if (!isValidTime(start) || !isValidTime(end)) return null;
              if (start >= end) return null;
              return { start, end };
            })
            .filter(Boolean)
        : [];

      return { day, isActive, slots };
    })
    .filter(Boolean);

  const map = new Map();
  for (const d of schedule) map.set(d.day, d);

  const order = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
  return order.filter((d) => map.has(d)).map((d) => map.get(d));
};

const sanitizeDegrees = (input) => {
  if (!Array.isArray(input)) return undefined;

  return input
    .map((d) => {
      const title = String(d?.title || "").trim();
      const institute = String(d?.institute || "").trim();
      const year = asNumber(d?.year);

      if (!title) return null;

      const out = { title };
      if (institute) out.institute = institute;
      if (year !== undefined) out.year = year;
      return out;
    })
    .filter(Boolean);
};

const sanitizeSpecialties = (input) => {
  if (!Array.isArray(input)) return undefined;
  return input.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 20);
};

/**
 * Get current logged-in user profile
 */
export const getProfile = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id).select(
    "-password -refreshToken -verificationInfo -password_reset_token"
  );

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile fetched",
    data: user,
  });
});

/**
 * Get users by role (patient | doctor | admin)
 * For doctors we also add ratingSummary (avgRating + totalReviews)
 */
export const getUsersByRole = catchAsync(async (req, res) => {
  const { role } = req.params; // "patient" | "doctor" | "admin"

  const allowedRoles = ["patient", "doctor", "admin"];
  if (!allowedRoles.includes(role)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid role");
  }

  let users = await User.find({ role }).select(
    "-password -refreshToken -verificationInfo -password_reset_token"
  ).lean();

  // If not doctor, just return
  if (role !== "doctor") {
    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: `Users fetched for role: ${role}`,
      data: users,
    });
  }

  // For doctors, compute ratingSummary from DoctorReview
  const doctorIds = users.map((u) => u._id);
  if (doctorIds.length) {
    const stats = await DoctorReview.aggregate([
      {
        $match: {
          doctor: { $in: doctorIds.map((id) => new mongoose.Types.ObjectId(id)) },
        },
      },
      {
        $group: {
          _id: "$doctor",
          avgRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 },
        },
      },
    ]);

    const statMap = new Map();
    stats.forEach((s) => {
      statMap.set(String(s._id), {
        avgRating: Number(s.avgRating?.toFixed(1)) || 0,
        totalReviews: s.totalReviews || 0,
      });
    });

    users = users.map((u) => {
      const s = statMap.get(String(u._id)) || { avgRating: 0, totalReviews: 0 };
      return {
        ...u,
        ratingSummary: s,
      };
    });
  } else {
    users = users.map((u) => ({
      ...u,
      ratingSummary: { avgRating: 0, totalReviews: 0 },
    }));
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Users fetched for role: ${role}`,
    data: users,
  });
});

/**
 * Get single user (doctor / patient / admin) by id
 * For doctor we also include ratingSummary + recentReviews
 */
export const getUserDetails = catchAsync(async (req, res) => {
  const { id } = req.params;

  let user = await User.findById(id).select(
    "-password -refreshToken -verificationInfo -password_reset_token"
  ).lean();

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  let ratingSummary = { avgRating: 0, totalReviews: 0 };
  let recentReviews = [];

  if (user.role === "doctor") {
    // rating summary
    const stats = await DoctorReview.aggregate([
      {
        $match: { doctor: new mongoose.Types.ObjectId(id) },
      },
      {
        $group: {
          _id: "$doctor",
          avgRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 },
        },
      },
    ]);

    if (stats.length) {
      ratingSummary = {
        avgRating: Number(stats[0].avgRating?.toFixed(1)) || 0,
        totalReviews: stats[0].totalReviews || 0,
      };
    }

    // latest 5 reviews
    recentReviews = await DoctorReview.find({ doctor: id })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("patient", "fullName avatar")
      .lean();
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User details fetched",
    data: {
      ...user,
      ratingSummary,
      recentReviews,
    },
  });
});

/**
 * Update current user profile
 */
export const updateProfile = catchAsync(async (req, res) => {
  const {
    fullName,
    username,
    phone,
    bio,
    gender,
    dob,
    location,
    country,
    language,
    experienceYears,

    // doctor profile fields
    specialty,
    specialties,
    degrees,
    fees,
    weeklySchedule,
    visitingHoursText,
    medicalLicenseNumber,
  } = req.body;

  const user = await User.findById(req.user._id);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  if (fullName !== undefined) user.fullName = String(fullName).trim();
  if (username !== undefined) user.username = String(username).trim();
  if (phone !== undefined) user.phone = String(phone).trim();

  if (bio !== undefined) user.bio = String(bio).trim();
  if (gender !== undefined) user.gender = gender;
  if (dob !== undefined) user.dob = dob;

  if (experienceYears !== undefined) {
    const exp = asNumber(experienceYears);
    if (exp === undefined || exp < 0) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "experienceYears must be a positive number"
      );
    }
    user.experienceYears = exp;
  }

  if (location !== undefined) {
    const loc = parseIfString(location);
    const lat = loc?.lat;
    const lng = loc?.lng;

    if (lat === undefined || lng === undefined) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "location must include lat and lng"
      );
    }

    user.location = { lat: String(lat).trim(), lng: String(lng).trim() };
  }

  if (country !== undefined) user.country = String(country).trim();
  if (language !== undefined) user.language = String(language).trim();

  // only doctors can update doctor fields
  const isDoctor = user.role === "doctor";

  const doctorPayloadTouched =
    specialty !== undefined ||
    specialties !== undefined ||
    degrees !== undefined ||
    fees !== undefined ||
    weeklySchedule !== undefined ||
    visitingHoursText !== undefined ||
    medicalLicenseNumber !== undefined;

  if (doctorPayloadTouched && !isDoctor) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only doctors can update doctor profile fields"
    );
  }

  if (isDoctor) {
    if (specialty !== undefined) user.specialty = String(specialty).trim();

    const sp = sanitizeSpecialties(parseIfString(specialties));
    if (sp !== undefined) user.specialties = sp;

    const deg = sanitizeDegrees(parseIfString(degrees));
    if (deg !== undefined) user.degrees = deg;

    if (fees !== undefined) {
      const feesObj = parseIfString(fees);
      const amount = asNumber(feesObj?.amount);
      const currency = String(feesObj?.currency || "").trim();

      if (amount === undefined || amount < 0) {
        throw new AppError(httpStatus.BAD_REQUEST, "Invalid fees.amount");
      }

      user.fees = { amount, currency: currency || "USD" };
    }

    const ws = sanitizeWeeklySchedule(parseIfString(weeklySchedule));
    if (ws !== undefined) user.weeklySchedule = ws;

    if (visitingHoursText !== undefined) {
      user.visitingHoursText = String(visitingHoursText).trim();
    }

    if (medicalLicenseNumber !== undefined) {
      user.medicalLicenseNumber = String(medicalLicenseNumber).trim();
    }
  }

  // avatar upload
  if (req.file?.buffer) {
    const oldPublicId = user?.avatar?.public_id;
    if (oldPublicId) await deleteFromCloudinary(oldPublicId).catch(() => {});

    const upload = await uploadOnCloudinary(req.file.buffer, {
      folder: "docmobi/users",
      resource_type: "image",
    });

    user.avatar = { public_id: upload.public_id, url: upload.secure_url };
  }

  await user.save();

  const safeUser = await User.findById(user._id).select(
    "-password -refreshToken -verificationInfo -password_reset_token"
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile updated successfully",
    data: safeUser,
  });
});

/**
 * Change password
 */
export const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (!newPassword || !confirmPassword || !currentPassword) {
    throw new AppError(httpStatus.BAD_REQUEST, "All fields are required");
  }

  if (newPassword !== confirmPassword) {
    throw new AppError(httpStatus.BAD_REQUEST, "Passwords don't match");
  }

  const user = await User.findById(req.user._id).select("+password");
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  const matched = await User.isPasswordMatched(currentPassword, user.password);
  if (!matched) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Current password wrong");
  }

  user.password = newPassword;
  await user.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password changed",
    data: null,
  });
});

/**
 * Admin: update doctor approvalStatus (pending | approved | rejected)
 * And notify the doctor.
 * Route example: PATCH /user/doctor/:id/approval
 */
export const updateDoctorApprovalStatus = catchAsync(async (req, res) => {
  const adminId = req.user._id;
  const role = req.user.role;

  if (role !== "admin") {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only admin can update approval status"
    );
  }

  const { id } = req.params; // doctor id
  const { approvalStatus } = req.body;

  if (!["pending", "approved", "rejected"].includes(approvalStatus)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid approval status");
  }

  const doctor = await User.findById(id);
  if (!doctor || doctor.role !== "doctor") {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  doctor.approvalStatus = approvalStatus;
  await doctor.save();

  let message = `Your account status has been updated to ${approvalStatus}.`;

  if (approvalStatus === "approved") {
    message = "Congratulations! Your doctor account has been approved.";
  } else if (approvalStatus === "rejected") {
    message = "Your doctor account has been rejected. Please contact support.";
  }

  await createNotification({
    userId: doctor._id,
    fromUserId: adminId,
    type: "doctor_approved",
    title: "Account status updated",
    content: message,
    meta: { approvalStatus },
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor approval status updated",
    data: {
      _id: doctor._id,
      fullName: doctor.fullName,
      approvalStatus: doctor.approvalStatus,
    },
  });
});
