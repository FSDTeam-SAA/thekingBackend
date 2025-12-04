import httpStatus from "http-status";
import { User } from "../model/user.model.js";
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/commonMethod.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";

/**
 * Helpers
 */
const normalizeDay = (day) => {
  if (!day) return null;
  const d = String(day).toLowerCase().trim();
  const allowed = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  return allowed.includes(d) ? d : null;
};

const isValidTime = (t) =>
  /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(t || "").trim());

const asNumber = (v) => {
  if (v === "" || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// ✅ safe parse for form-data JSON
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

  const order = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
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
 * Controllers
 */
export const getProfile = catchAsync(async (req, res) => {
  const user = await User.findById(req.user._id).select(
    "-password -refreshToken -verificationInfo -password_reset_token"
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile fetched",
    data: user,
  });
});

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
      throw new AppError(httpStatus.BAD_REQUEST, "experienceYears must be a positive number");
    }
    user.experienceYears = exp;
  }

  if (location !== undefined) {
    const loc = parseIfString(location);
    const lat = loc?.lat;
    const lng = loc?.lng;

    if (lat === undefined || lng === undefined) {
      throw new AppError(httpStatus.BAD_REQUEST, "location must include lat and lng");
    }

    user.location = { lat: String(lat).trim(), lng: String(lng).trim() };
  }

  if (country !== undefined) user.country = String(country).trim();
  if (language !== undefined) user.language = String(language).trim();

  // ✅ Doctor check (ONLY 'doctor')
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
    throw new AppError(httpStatus.FORBIDDEN, "Only doctors can update doctor profile fields");
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
