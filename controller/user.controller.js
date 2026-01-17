// controller/user.controller.js
import httpStatus from "http-status";
import mongoose from "mongoose";
import { User } from "../model/user.model.js";
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/commonMethod.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";
import { DoctorReview } from "../model/doctorReview.model.js";
import { createNotification } from "../utils/notify.js";

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

const trimmedOrUndefined = (value) => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
};

const parseOptionalDate = (value, fieldName) => {
  const trimmed = trimmedOrUndefined(value);
  if (trimmed === undefined) return undefined;
  const dt = new Date(trimmed);
  if (Number.isNaN(dt.getTime())) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `${fieldName || "Date"} must be valid`
    );
  }
  return dt;
};

const parseBooleanInput = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return Boolean(value);
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
  const { role } = req.params;

  const allowedRoles = ["patient", "doctor", "admin"];
  if (!allowedRoles.includes(role)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid role");
  }

  let users = await User.find({ role }).select(
    "-password -refreshToken -verificationInfo -password_reset_token"
  ).lean();

  if (role !== "doctor") {
    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: `Users fetched for role: ${role}`,
      data: users,
    });
  }

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
 * ✅ UPDATED: Update current user profile with Video Call Support
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
    profileImage,
    address,
    specialty,
    specialties,
    degrees,
    fees,
    weeklySchedule,
    visitingHoursText,
    medicalLicenseNumber,
    isVideoCallAvailable, // ✅ NEW: Video call availability
  } = req.body;

  console.log('📝 ========== Update Profile Request ==========');
  console.log('   - fullName:', fullName);
  console.log('   - phone:', phone);
  console.log('   - address:', address);
  console.log('   - profileImage:', profileImage ? 'Yes (base64)' : 'No');
  console.log('   - isVideoCallAvailable:', isVideoCallAvailable); // ✅ Log it
  console.log('================================================');

  const user = await User.findById(req.user._id);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  // Basic field updates
  if (fullName !== undefined) user.fullName = String(fullName).trim();
  if (username !== undefined) user.username = String(username).trim();
  if (phone !== undefined) user.phone = String(phone).trim();
  if (bio !== undefined) user.bio = String(bio).trim();
  if (gender !== undefined) user.gender = gender;
  if (dob !== undefined) user.dob = dob;
  if (address !== undefined) {
    user.address = String(address).trim();
    console.log('✅ Address updated to:', user.address);
  }

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

  // Profile image upload (Base64 or file)
  if (profileImage && typeof profileImage === 'string' && profileImage.startsWith('data:image')) {
    try {
      console.log('📸 Processing base64 image from Flutter...');
      
      const oldPublicId = user?.avatar?.public_id;
      if (oldPublicId) {
        console.log('🗑️ Deleting old image:', oldPublicId);
        await deleteFromCloudinary(oldPublicId).catch(() => {});
      }

      const base64Data = profileImage.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');

      console.log('☁️ Uploading to Cloudinary...');

      const upload = await uploadOnCloudinary(buffer, {
        folder: "docmobi/users",
        resource_type: "image",
      });

      user.avatar = { 
        public_id: upload.public_id, 
        url: upload.secure_url 
      };

      console.log('✅ Image uploaded successfully:', upload.secure_url);
    } catch (error) {
      console.error('❌ Image upload error:', error);
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Failed to upload profile image"
      );
    }
  }

  if (req.file?.buffer) {
    console.log('📸 Processing file from multer...');
    const oldPublicId = user?.avatar?.public_id;
    if (oldPublicId) await deleteFromCloudinary(oldPublicId).catch(() => {});

    const upload = await uploadOnCloudinary(req.file.buffer, {
      folder: "docmobi/users",
      resource_type: "image",
    });

    user.avatar = { public_id: upload.public_id, url: upload.secure_url };
  }

  const isDoctor = user.role === "doctor";
  
  // Doctor-specific fields validation
  const doctorPayloadTouched =
    specialty !== undefined ||
    specialties !== undefined ||
    degrees !== undefined ||
    fees !== undefined ||
    weeklySchedule !== undefined ||
    visitingHoursText !== undefined ||
    medicalLicenseNumber !== undefined ||
    isVideoCallAvailable !== undefined; // ✅ Include video call

  if (doctorPayloadTouched && !isDoctor) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only doctors can update doctor profile fields"
    );
  }

  // ✅ Update doctor-specific fields
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

    // ✅ NEW: Handle video call availability
    if (isVideoCallAvailable !== undefined) {
      const videoCallValue = parseBooleanInput(isVideoCallAvailable);
      if (videoCallValue !== undefined) {
        user.isVideoCallAvailable = videoCallValue;
        console.log('✅ Video call availability updated to:', videoCallValue);
      }
    }
  }

  await user.save();
  console.log('💾 User saved successfully');

  const safeUser = await User.findById(user._id).select(
    "-password -refreshToken -verificationInfo -password_reset_token"
  );

  console.log('📤 Sending response with:');
  console.log('   - fullName:', safeUser.fullName);
  console.log('   - address:', safeUser.address);
  console.log('   - avatar:', safeUser.avatar?.url || 'No avatar');
  console.log('   - isVideoCallAvailable:', safeUser.isVideoCallAvailable); // ✅ Log output

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
 * Get my dependents
 */
export const getMyDependents = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id).select("dependents");
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Dependents fetched",
    data: user.dependents || [],
  });
});

/**
 * Add dependent
 */
export const addDependent = catchAsync(async (req, res) => {
  const {
    fullName,
    relationship,
    gender,
    dob,
    phone,
    notes,
  } = req.body;

  const user = await User.findById(req.user._id);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  const normalizedName = trimmedOrUndefined(fullName);
  if (!normalizedName) {
    throw new AppError(httpStatus.BAD_REQUEST, "fullName is required");
  }

  if ((user.dependents || []).length >= 20) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "You can add up to 20 dependents"
    );
  }

  const dependentPayload = {
    fullName: normalizedName,
  };

  const rel = trimmedOrUndefined(relationship);
  if (rel !== undefined) dependentPayload.relationship = rel;

  const gen = trimmedOrUndefined(gender);
  if (gen !== undefined) dependentPayload.gender = gen;

  const phoneVal = trimmedOrUndefined(phone);
  if (phoneVal !== undefined) dependentPayload.phone = phoneVal;

  const notesVal = trimmedOrUndefined(notes);
  if (notesVal !== undefined) {
    if (notesVal.length > 500) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "notes cannot exceed 500 characters"
      );
    }
    dependentPayload.notes = notesVal;
  }

  const dobVal = parseOptionalDate(dob, "dob");
  if (dobVal !== undefined) dependentPayload.dob = dobVal;

  user.dependents = user.dependents || [];
  user.dependents.push(dependentPayload);
  await user.save();

  const createdDependent = user.dependents[user.dependents.length - 1];

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Dependent added",
    data: createdDependent,
  });
});

/**
 * Update dependent
 */
export const updateDependent = catchAsync(async (req, res) => {
  const { dependentId } = req.params;
  const {
    fullName,
    relationship,
    gender,
    dob,
    phone,
    notes,
    isActive,
  } = req.body;

  const user = await User.findById(req.user._id);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  const dependent = user.dependents.id(dependentId);
  if (!dependent) {
    throw new AppError(httpStatus.NOT_FOUND, "Dependent not found");
  }

  if (fullName !== undefined) {
    const normalizedName = trimmedOrUndefined(fullName);
    if (!normalizedName) {
      throw new AppError(httpStatus.BAD_REQUEST, "fullName cannot be empty");
    }
    dependent.fullName = normalizedName;
  }

  if (relationship !== undefined) {
    const rel = trimmedOrUndefined(relationship);
    dependent.relationship = rel;
  }

  if (gender !== undefined) {
    const gen = trimmedOrUndefined(gender);
    dependent.gender = gen;
  }

  if (phone !== undefined) {
    const phoneVal = trimmedOrUndefined(phone);
    dependent.phone = phoneVal;
  }

  if (notes !== undefined) {
    const notesVal = trimmedOrUndefined(notes);
    if (notesVal && notesVal.length > 500) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "notes cannot exceed 500 characters"
      );
    }
    dependent.notes = notesVal;
  }

  if (dob !== undefined) {
    const dobVal = parseOptionalDate(dob, "dob");
    dependent.dob = dobVal;
  }

  if (isActive !== undefined) {
    const activeVal = parseBooleanInput(isActive);
    if (activeVal !== undefined) {
      dependent.isActive = activeVal;
    }
  }

  await user.save();

  const updatedDependent = user.dependents.id(dependentId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Dependent updated",
    data: updatedDependent,
  });
});

/**
 * Delete dependent
 */
export const deleteDependent = catchAsync(async (req, res) => {
  const { dependentId } = req.params;

  const user = await User.findById(req.user._id);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  const dependent = user.dependents.id(dependentId);
  if (!dependent) {
    throw new AppError(httpStatus.NOT_FOUND, "Dependent not found");
  }

  const { Appointment } = await import("../model/appointment.model.js");

  const activeAppointments = await Appointment.find({
    patient: user._id,
    "bookedFor.dependentId": dependentId,
    status: { $in: ["pending", "accepted"] },
  });

  if (activeAppointments.length > 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Cannot delete dependent. They have ${activeAppointments.length} active appointment(s). Please cancel those appointments first.`
    );
  }

  dependent.deleteOne();
  await user.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Dependent removed",
    data: null,
  });
});

/**
 * Admin: update doctor approvalStatus
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

  const { id } = req.params;
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