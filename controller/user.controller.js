// controller/user.controller.js
import httpStatus from "http-status";
import mongoose from "mongoose";
import { User } from "../model/user.model.js";
import {
  uploadOnCloudinary,
  deleteFromCloudinary,
} from "../utils/commonMethod.js";
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
  return input
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 20);
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
      `${fieldName || "Date"} must be valid`,
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

const percentageChange = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  const change = ((current - previous) / previous) * 100;
  return Number(change.toFixed(1));
};

/**
 * Get current logged-in user profile
 */
export const getProfile = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id).select(
    "-password -refreshToken -verificationInfo -password_reset_token",
  );

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  // ✅ Convert location to proper format
  const userData = user.toObject();
  if (userData.location) {
    userData.latitude = userData.location.lat
      ? parseFloat(userData.location.lat)
      : null;
    userData.longitude = userData.location.lng
      ? parseFloat(userData.location.lng)
      : null;
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile fetched",
    data: userData,
  });
});

//search doctor by name, specialty, location
export const searchDoctors = catchAsync(async (req, res) => {
  const search = req.query?.search?.toString().trim();
  const pipeline = [
    { $match: { role: "doctor" } },

    ...(search
      ? [
        {
          $match: {
            $or: [
              { fullName: { $regex: search, $options: "i" } },
              { specialty: { $regex: search, $options: "i" } },
              { address: { $regex: search, $options: "i" } },
            ],
          },
        },
      ]
      : []),

    {
      $project: {
        password: 0,
        refreshToken: 0,
        verificationInfo: 0,
        password_reset_token: 0,
      },
    },
  ];

  const doctors = await User.aggregate(pipeline);

  if (doctors.length === 0) {
    throw new AppError(httpStatus.NOT_FOUND, "No doctors found");
  }

  res.status(200).json({
    success: true,
    results: doctors.length,
    data: doctors,
  });
});

/**
 * Get nearby doctors using Haversine formula
 * Filters within ~50km radius
 */
export const getNearbyDoctors = catchAsync(async (req, res) => {
  let { lat, lng, radiusKm } = req.query;

  // Fallback to infinite radius if no location provided (legacy support)
  if (!lat || !lng) {
    return getUsersByRole(req, res);
  }

  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  const maxDistance = parseFloat(radiusKm) || 50; // Default 50km

  // Earth radius in km
  const R = 6371;

  const doctors = await User.aggregate([
    { $match: { role: "doctor" } },
    // Convert string location to doubles
    {
      $addFields: {
        docLat: { $toDouble: "$location.lat" },
        docLng: { $toDouble: "$location.lng" },
      },
    },
    // Filter valid coordinates
    {
      $match: {
        docLat: { $type: "number" },
        docLng: { $type: "number" },
      },
    },
    // Calculate distance (Haversine Formula via Aggregation)
    {
      $addFields: {
        dLat: { $degreesToRadians: { $subtract: ["$docLat", userLat] } },
        dLng: { $degreesToRadians: { $subtract: ["$docLng", userLng] } },
        lat1: { $degreesToRadians: "$docLat" },
        lat2: { $degreesToRadians: userLat },
      },
    },
    {
      $addFields: {
        a: {
          $add: [
            {
              $pow: [{ $sin: { $divide: ["$dLat", 2] } }, 2],
            },
            {
              $multiply: [
                { $cos: "$lat1" },
                { $cos: "$lat2" },
                { $pow: [{ $sin: { $divide: ["$dLng", 2] } }, 2] },
              ],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        c: {
          $multiply: [
            2,
            { $atan2: [{ $sqrt: "$a" }, { $sqrt: { $subtract: [1, "$a"] } }] },
          ],
        },
      },
    },
    {
      $addFields: {
        distanceKm: { $multiply: [R, "$c"] },
      },
    },
    // Filter by max distance
    {
      $match: {
        distanceKm: { $lte: maxDistance },
      },
    },
    // Lookup ratings
    {
      $lookup: {
        from: "doctorreviews",
        let: { docId: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$doctor", "$$docId"] } } },
          {
            $group: {
              _id: null,
              avgRating: { $avg: "$rating" },
              totalReviews: { $sum: 1 },
            },
          },
        ],
        as: "reviews",
      },
    },
    {
      $addFields: {
        ratingSummary: {
          $cond: {
            if: { $gt: [{ $size: "$reviews" }, 0] },
            then: { $arrayElemAt: ["$reviews", 0] },
            else: { avgRating: 0, totalReviews: 0 },
          },
        },
      },
    },
    // Project only necessary fields
    {
      $project: {
        fullName: 1,
        specialty: 1,
        avatar: 1,
        location: 1,
        degrees: 1,
        isVideoCallAvailable: 1,
        weeklySchedule: 1,
        address: 1,
        ratingSummary: 1, // Keep calculated rating
        distanceKm: 1, // Keep calculated distance
      },
    },
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Found ${doctors.length} doctors near you`,
    data: doctors,
  });
});

/**
 * Get users by role (patient | doctor | admin)
 * For doctors we also add ratingSummary (avgRating + totalReviews)
 */
export const getUsersByRole = catchAsync(async (req, res) => {
  const { role } = req.params;
  const { page, limit, sortBy, status, search } = req.query;

  // Validate role
  const allowedRoles = ["patient", "doctor", "admin"];
  if (!allowedRoles.includes(role)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid role");
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

  // Base filter
  const matchFilter = { role };

  // Status filter
  if (status && status !== "all") {
    matchFilter.accountStatus = status;
  }

  // Search filter
  if (search) {
    const regex = new RegExp(search, "i");
    matchFilter.$or = [
      { fullName: regex },
      { specialty: regex },
      { email: regex },
      { address: regex },
    ];
  }

  // Count total
  const total = await User.countDocuments(matchFilter);

  // Fetch users
  let users = await User.find(matchFilter)
    .select("-password -refreshToken -verificationInfo -password_reset_token")
    .sort(sort)
    .populate("referralCode", "code description") // Populate referralCode
    .skip(skip)
    .limit(pageLimit)
    .lean();

  // Non-doctor response
  if (role !== "doctor") {
    const totalPages = Math.ceil(total / pageLimit);
    const from = total === 0 ? 0 : skip + 1;
    const to = Math.min(skip + users.length, total);

    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: `Users fetched for role: ${role}`,
      data: users,
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
  }

  // Doctor rating aggregation
  const doctorIds = users.map((u) => u._id);
  const statMap = new Map();

  if (doctorIds.length) {
    const stats = await DoctorReview.aggregate([
      {
        $match: {
          doctor: {
            $in: doctorIds.map((id) => new mongoose.Types.ObjectId(id)),
          },
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

    stats.forEach((s) => {
      statMap.set(String(s._id), {
        avgRating: Number(s.avgRating?.toFixed(1)) || 0,
        totalReviews: s.totalReviews || 0,
      });
    });
  }

  // Attach rating summary
  users = users.map((u) => ({
    ...u,
    ratingSummary: statMap.get(String(u._id)) || {
      avgRating: 0,
      totalReviews: 0,
    },
  }));

  // Pagination meta
  const totalPages = Math.ceil(total / pageLimit);
  const from = total === 0 ? 0 : skip + 1;
  const to = Math.min(skip + users.length, total);

  // Final response
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Users fetched for role: ${role}`,
    data: users,
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

/**
 * Admin dashboard overview: totals + weekly join trend for patients/doctors
 */
export const getDashboardOverview = catchAsync(async (req, res) => {
  if (req.user?.role !== "admin") {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only admin can view dashboard insights",
    );
  }

  const now = new Date();

  // Use UTC boundaries to avoid timezone drift between Mongo and server
  const currentWeekEnd = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
  const currentWeekStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() - 6);

  const previousWeekStart = new Date(currentWeekStart);
  previousWeekStart.setUTCDate(previousWeekStart.getUTCDate() - 7);

  const previousWeekEnd = new Date(currentWeekStart);
  previousWeekEnd.setUTCDate(previousWeekEnd.getUTCDate() - 1);
  previousWeekEnd.setUTCHours(23, 59, 59, 999);

  const [overview] = await User.aggregate([
    {
      $match: { role: { $in: ["patient", "doctor"] } },
    },
    {
      $facet: {
        totals: [{ $group: { _id: "$role", count: { $sum: 1 } } }],
        currentWeek: [
          {
            $match: {
              createdAt: { $gte: currentWeekStart, $lte: currentWeekEnd },
            },
          },
          {
            $group: {
              _id: {
                role: "$role",
                date: {
                  $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
                },
              },
              count: { $sum: 1 },
            },
          },
        ],
        currentWeekTotals: [
          {
            $match: {
              createdAt: { $gte: currentWeekStart, $lte: currentWeekEnd },
            },
          },
          { $group: { _id: "$role", count: { $sum: 1 } } },
        ],
        previousWeekTotals: [
          {
            $match: {
              createdAt: { $gte: previousWeekStart, $lte: previousWeekEnd },
            },
          },
          { $group: { _id: "$role", count: { $sum: 1 } } },
        ],
      },
    },
  ]);

  const totalsMap = Object.fromEntries(
    (overview?.totals || []).map((item) => [item._id, item.count]),
  );

  const weekTotalsMap = Object.fromEntries(
    (overview?.currentWeekTotals || []).map((item) => [item._id, item.count]),
  );

  const prevWeekTotalsMap = Object.fromEntries(
    (overview?.previousWeekTotals || []).map((item) => [item._id, item.count]),
  );

  const currentWeekByDate = {};
  (overview?.currentWeek || []).forEach(({ _id, count }) => {
    const dateKey = _id?.date;
    const role = _id?.role;
    if (!dateKey || !role) return;
    if (!currentWeekByDate[dateKey]) currentWeekByDate[dateKey] = {};
    currentWeekByDate[dateKey][role] = count;
  });

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weeklySeries = [];
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(currentWeekStart);
    day.setUTCDate(day.getUTCDate() + i);
    const key = day.toISOString().slice(0, 10);
    weeklySeries.push({
      date: key,
      label: dayLabels[day.getUTCDay()],
      patients: currentWeekByDate[key]?.patient || 0,
      doctors: currentWeekByDate[key]?.doctor || 0,
    });
  }

  const patientChange = percentageChange(
    weekTotalsMap.patient || 0,
    prevWeekTotalsMap.patient || 0,
  );
  const doctorChange = percentageChange(
    weekTotalsMap.doctor || 0,
    prevWeekTotalsMap.doctor || 0,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Dashboard overview fetched",
    data: {
      totals: {
        patients: {
          count: totalsMap.patient || 0,
          weeklyNew: weekTotalsMap.patient || 0,
          weekOverWeekChangePct: patientChange,
        },
        doctors: {
          count: totalsMap.doctor || 0,
          weeklyNew: weekTotalsMap.doctor || 0,
          weekOverWeekChangePct: doctorChange,
        },
      },
      weeklySignups: {
        range: {
          start: currentWeekStart.toISOString(),
          end: currentWeekEnd.toISOString(),
          previousStart: previousWeekStart.toISOString(),
          previousEnd: previousWeekEnd.toISOString(),
        },
        days: weeklySeries,
      },
    },
  });
});

/**
 * Get single user (doctor / patient / admin) by id
 * For doctor we also include ratingSummary + recentReviews
 */
export const getUserDetails = catchAsync(async (req, res) => {
  const { id } = req.params;

  let user = await User.findById(id)
    .select("-password -refreshToken -verificationInfo -password_reset_token")
    .lean();

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  // ✅ ADD THIS: Convert location to proper format
  if (user.location) {
    user.latitude = user.location.lat ? parseFloat(user.location.lat) : null;
    user.longitude = user.location.lng ? parseFloat(user.location.lng) : null;
  }

  let ratingSummary = { avgRating: 0, totalReviews: 0 };
  let recentReviews = [];

  if (user.role === "doctor") {
    const stats = await DoctorReview.aggregate([
      { $match: { doctor: new mongoose.Types.ObjectId(id) } },
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
    data: { ...user, ratingSummary, recentReviews },
  });
});

/**
 * ✅ UPDATED: Update current user profile with Base64 Image Support
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
    isVideoCallAvailable, // ✅ NEW: Support for main key
    isVideoAvailable, // ✅ NEW: Support for redundant key 1
    isAvailable, // ✅ NEW: Support for redundant key 2
  } = req.body;

  const user = await User.findById(req.user._id);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  if (fullName !== undefined) user.fullName = String(fullName).trim();
  if (username !== undefined) user.username = String(username).trim();
  if (phone !== undefined) {
    const p = String(phone).trim();
    user.phone = p === "" ? undefined : p;
  }
  if (bio !== undefined) user.bio = String(bio).trim();
  if (gender !== undefined) user.gender = gender;
  if (dob !== undefined) user.dob = dob;
  if (address !== undefined) {
    user.address = String(address).trim();
  }

  if (experienceYears !== undefined) {
    const exp = asNumber(experienceYears);
    if (exp === undefined || exp < 0) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "experienceYears must be a positive number",
      );
    }
    user.experienceYears = exp;
  }

  if (location !== undefined) {
    const loc = parseIfString(location); // Convert string to object if needed
    const lat = loc?.lat;
    const lng = loc?.lng;

    if (lat === undefined || lng === undefined) {
      // Optional: ignore if partial? But error is safer.
      // However, if frontend sends partial, we might want to skip.
      // Keeping existing validation as robust.
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "location must include lat and lng",
      );
    }

    user.location = { lat: String(lat).trim(), lng: String(lng).trim() };
  }

  if (country !== undefined) user.country = String(country).trim();
  if (language !== undefined) user.language = String(language).trim();

  if (
    profileImage &&
    typeof profileImage === "string" &&
    profileImage.startsWith("data:image")
  ) {
    try {
      const oldPublicId = user?.avatar?.public_id;
      if (oldPublicId) {
        await deleteFromCloudinary(oldPublicId).catch(() => { });
      }

      const base64Data = profileImage.split(",")[1];
      const buffer = Buffer.from(base64Data, "base64");

      const upload = await uploadOnCloudinary(buffer, {
        folder: "docmobi/users",
        resource_type: "image",
        type: "upload",
        access_mode: "public",
      });

      user.avatar = {
        public_id: upload.public_id,
        url: upload.secure_url,
      };
    } catch (error) {
      console.error("Cloudinary Upload Error:", error);
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Failed to upload profile image",
      );
    }
  }

  if (req.file?.buffer) {
    const oldPublicId = user?.avatar?.public_id;
    if (oldPublicId) await deleteFromCloudinary(oldPublicId).catch(() => { });

    const upload = await uploadOnCloudinary(req.file.buffer, {
      folder: "docmobi/users",
      resource_type: "image",
      type: "upload",
      access_mode: "public",
    });

    user.avatar = { public_id: upload.public_id, url: upload.secure_url };
  }

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
      "Only doctors can update doctor profile fields",
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
      const license = String(medicalLicenseNumber).trim();
      user.medicalLicenseNumber = license === "" ? undefined : license;
    }

    // ✅ NEW: Handle Video Call Availability persistence
    // We check all potential keys for maximum compatibility with Flutter frontend
    const availabilityInput =
      isVideoCallAvailable !== undefined
        ? isVideoCallAvailable
        : isVideoAvailable !== undefined
          ? isVideoAvailable
          : isAvailable;

    if (availabilityInput !== undefined) {
      const boolVal = parseBooleanInput(availabilityInput);
      if (boolVal !== undefined) {
        user.isVideoCallAvailable = boolVal;
      }
    }
  }

  await user.save();

  const safeUser = await User.findById(user._id).select(
    "-password -refreshToken -verificationInfo -password_reset_token",
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
  const { fullName, relationship, gender, dob, phone, notes } = req.body;

  const user = await User.findById(req.user._id);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  const normalizedName = trimmedOrUndefined(fullName);
  if (!normalizedName) {
    throw new AppError(httpStatus.BAD_REQUEST, "fullName is required");
  }

  if ((user.dependents || []).length >= 20) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "You can add up to 20 dependents",
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
        "notes cannot exceed 500 characters",
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
  const { fullName, relationship, gender, dob, phone, notes, isActive } =
    req.body;

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
        "notes cannot exceed 500 characters",
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
      `Cannot delete dependent. They have ${activeAppointments.length} active appointment(s). Please cancel those appointments first.`,
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
      "Only admin can update approval status",
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

/**
 * Admin: delete a user (hard delete)
 */
export const deleteUser = catchAsync(async (req, res) => {
  if (req.user?.role !== "admin") {
    throw new AppError(httpStatus.FORBIDDEN, "Only admin can delete users");
  }

  const { id } = req.params;
  const user = await User.findById(id);

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  // best-effort cleanup of avatar
  if (user.avatar?.public_id) {
    await deleteFromCloudinary(user.avatar.public_id).catch(() => { });
  }

  await User.findByIdAndDelete(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User deleted",
    data: { _id: id },
  });
});

//update location for client
export const updateLocation = catchAsync(async (req, res) => {
  const { lat, lng } = req.body;
  if (req.user.role === "doctor")
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only client can update live location",
    );
  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      location: { lat: String(lat).trim(), lng: String(lng).trim() },
    },
    {
      new: true,
    },
  ).select("location fullName email _id");
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Location updated",
    data: user,
  });
});

/**
 * Note: registerFCMToken is now handled in fcm.controller.js
 */
