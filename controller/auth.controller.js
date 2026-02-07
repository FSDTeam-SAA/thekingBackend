import AppError from "../errors/AppError.js";
import { createToken, verifyToken } from "../utils/authToken.js";
import catchAsync from "../utils/catchAsync.js";
import { generateOTP } from "../utils/commonMethod.js";
import httpStatus from "http-status";
import sendResponse from "../utils/sendResponse.js";
import { sendEmail, otpEmailTemplate } from "../utils/sendEmail.js";
import { User } from "../model/user.model.js";
import { ReferralCode } from "../model/referralCode.model.js";
import mongoose from "mongoose";
import { createNotification } from "../utils/notify.js";
import { io } from "../server.js";
import AppSetting from "../model/appSeeting.model.js";

const normalizeRole = (role) => {
  const r = String(role || "patient")
    .toLowerCase()
    .trim();
  if (!["patient", "doctor", "admin"].includes(r)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid role");
  }
  return r;
};

// ✅ NEW: Verify OTP Only (without resetting password)
export const verifyOTP = catchAsync(async (req, res) => {
  const { email, otp } = req.body;

  const user = await User.isUserExistsByEmail(email);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  if (!user.password_reset_token) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "No OTP request found. Please request a new OTP.",
    );
  }

  let decoded;
  try {
    decoded = verifyToken(user.password_reset_token, process.env.OTP_SECRET);
  } catch (error) {
    throw new AppError(httpStatus.BAD_REQUEST, "OTP expired or invalid");
  }

  if (decoded.otp !== otp) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid OTP");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "OTP verified successfully",
    data: null,
  });
});

export const register = catchAsync(async (req, res) => {
  console.log('🔵 [REGISTER] Starting registration process');
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    console.log('🔵 [REGISTER] Transaction started');

    const {
      phone,
      fullName,
      email,
      password,
      confirmPassword,
      experienceYears,
      role,
      specialty,
      medicalLicenseNumber,
      refferalCode,
    } = req.body;

    console.log('🔵 [REGISTER] Request body:', { fullName, email, role, specialty });

    // basic validation
    if (!email || !password || !fullName) {
      throw new AppError(httpStatus.BAD_REQUEST, "Please fill in all fields");
    }

    if (password !== confirmPassword) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Password and confirm password do not match",
      );
    }

    const roleNormalized = normalizeRole(role);

    if (roleNormalized === "admin") {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Admin registration is not allowed",
      );
    }

    if (roleNormalized === "doctor" && !medicalLicenseNumber) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Medical license number is required for doctors",
      );
    }

    //fetch referral enable status
    console.log('🔵 [REGISTER] Fetching app settings...');
    const settings = await AppSetting.findOne().select(
      "referralSystemEnabled _id",
    );
    console.log('🔵 [REGISTER] Settings fetched:', settings);

    if (!settings) {
      console.log('❌ [REGISTER] No settings found in database');
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "App setting not found for referral enable status",
      );
    }
    console.log('🔵 [REGISTER] Referral system enabled:', settings.referralSystemEnabled);

    if (roleNormalized === "patient" && refferalCode) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Referral code is not required for patients",
      );
    }

    let referral = null;

    if (settings.referralSystemEnabled) {
      if (roleNormalized === "doctor" && !refferalCode) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          "Referral code is required for doctors",
        );
      }

      if (roleNormalized === "doctor" && refferalCode) {
        // referral code validation (inside transaction)
        const referralData = await ReferralCode.findOne(
          { code: refferalCode, isActive: true },
          null,
          {
            session,
          },
        );
        if (!referralData) {
          throw new AppError(httpStatus.BAD_REQUEST, "Invalid referral code");
        }
        console.log("referralData", referralData);

        referral = referralData;
      }
    }

    // duplicate check (inside transaction)
    const existingUser = await User.findOne(
      {
        $or: [
          { email },
          ...(phone ? [{ phone }] : []),
          ...(medicalLicenseNumber ? [{ medicalLicenseNumber }] : []),
        ],
      },
      null,
      { session },
    );

    if (existingUser) {
      let message = "User already exists";
      if (existingUser.email === email) message = "Email already exists";
      else if (phone && existingUser.phone === phone)
        message = "Phone already exists";
      else if (
        medicalLicenseNumber &&
        existingUser.medicalLicenseNumber === medicalLicenseNumber
      )
        message = "Medical license number already exists";

      throw new AppError(httpStatus.BAD_REQUEST, message);
    }

    const exp = Number(experienceYears);
    const expSafe = Number.isFinite(exp) && exp >= 0 ? exp : 0;

    console.log("Starting user creation...",referral,"asdihksaddasdfiusdkjhlksdh",referral._id);

    // create user
    console.log('🔵 [REGISTER] Creating user with role:', roleNormalized);
    const [newUser] = await User.create(
      [
        {
          phone,
          fullName,
          email,
          password,
          experienceYears: expSafe,
          role: roleNormalized,
          specialty: roleNormalized === "doctor" ? specialty : undefined,
          medicalLicenseNumber:
            roleNormalized === "doctor" ? medicalLicenseNumber : undefined,
          verificationInfo: { token: "" },
          referralCode:
            referral && roleNormalized === "patient" ? undefined : referral._id,
          approvalStatus: roleNormalized === "doctor" ? "pending" : "approved",
        },
      ],
      { session },
    );
    console.log('🔵 [REGISTER] User created:', newUser ? { id: newUser._id, email: newUser.email } : 'NULL');
    if (!newUser) {
      console.log('❌ [REGISTER] User creation returned null');
      throw new AppError(httpStatus.BAD_REQUEST, "User registration failed");
    }

    //!! TODO: only for testing use this to remove user,

    //!start remove user
    // const deleteNewUser = await User.findByIdAndDelete(newUser._id, {
    //   session,
    // });
    // if (!deleteNewUser) {
    //   throw new AppError(httpStatus.BAD_REQUEST, "User registration failed");
    // }
    //!end remove user

    if (referral && roleNormalized === "doctor") {
      // update referral code usage (inside transaction)
      const updatedReferral = await ReferralCode.findByIdAndUpdate(
        referral._id,
        {
          $inc: { timesUsed: 1 },
        },
        { new: true, session },
      );
    }

    // commit transaction
    console.log('🔵 [REGISTER] Committing transaction...');
    await session.commitTransaction();
    session.endSession();
    console.log('🔵 [REGISTER] Transaction committed successfully');

    // FIXED: Only send notification if the new user is a DOCTOR
    console.log('🔵 [REGISTER] Checking if notifications needed for role:', roleNormalized);
    if (roleNormalized === 'doctor') {
      console.log('🔵 [REGISTER] Sending notifications to patients about new doctor');
      //TODO: sent notification to all patients about new doctor registration
      const patients = await User.find({ role: "patient" });
      await Promise.all(
        patients.map(async (patient) => {
          createNotification({
            userId: patient._id,
            fromUserId: patient._id,
            type: "doctor_signup",
            title: "New Doctor Registered",
            content: `A new doctor, Dr. ${newUser.fullName}, specialized in ${newUser.specialty} has joined our platform.`,
            meta: { doctorId: newUser._id, doctorName: newUser.fullName },
          });

          //sent notifaication by socket too (if online)
          io.to(patient._id.toString()).emit("notification:newDoctor", {
            type: "doctor_signup",
            title: "New Doctor Registered",
            content: `A new doctor, Dr. ${newUser.fullName}, specialized in ${newUser.specialty} has joined our platform.`,
            meta: {
              doctorId: newUser._id,
              doctorName: newUser.fullName,
              specialty: newUser.specialty,
            },
          });
        }),
      );
    } else {
      console.log('🔵 [REGISTER] Skipping notifications (user is not a doctor)');
    }

    console.log('✅ [REGISTER] Registration completed successfully');
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Registered successfully",
      data: null,
    });
  } catch (error) {
    // rollback on error
    console.log('❌ [REGISTER] Error occurred:', error.message);
    console.log('❌ [REGISTER] Error stack:', error.stack);
    // await session.abortTransaction();
    session.endSession();
    throw error;
  }
  console.log('🔵 [REGISTER] Function completed');
});

export const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.isUserExistsByEmail(email);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  if (
    user?.password &&
    !(await User.isPasswordMatched(password, user.password))
  ) {
    throw new AppError(httpStatus.FORBIDDEN, "Password is not correct");
  }

  // ✅ Enforce Doctor Approval Logic
  if (user.role === "doctor" && user.approvalStatus !== "approved") {
    throw new AppError(
      httpStatus.FORBIDDEN,
      `Your account is currently ${user.approvalStatus}. Please wait for admin approval.`,
    );
  }

  const jwtPayload = { _id: user._id, email: user.email, role: user.role };

  const accessToken = createToken(
    jwtPayload,
    process.env.JWT_ACCESS_SECRET,
    process.env.JWT_ACCESS_EXPIRES_IN,
  );

  const refreshToken = createToken(
    jwtPayload,
    process.env.JWT_REFRESH_SECRET,
    process.env.JWT_REFRESH_EXPIRES_IN,
  );

  user.refreshToken = refreshToken;
  await user.save();

  res.cookie("refreshToken", refreshToken, {
    secure: true,
    httpOnly: true,
    sameSite: "none",
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User Logged in successfully",
    data: {
      accessToken,
      refreshToken,
      role: user.role,
      _id: user._id,
      user,
    },
  });
});

// ✅ FIXED: Forgot Password with OTP Email Template
export const forgetPassword = catchAsync(async (req, res) => {
  const { email } = req.body;

  const user = await User.isUserExistsByEmail(email);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const otp = generateOTP();

  const otpToken = createToken(
    { otp },
    process.env.OTP_SECRET,
    process.env.OTP_EXPIRE,
  );

  user.password_reset_token = otpToken;
  await user.save();

  // ✅ Use the OTP email template
  try {
    const emailHtml = otpEmailTemplate(otp, user.fullName);
    await sendEmail(user.email, "Password Reset OTP - DocMobi", emailHtml);
  } catch (emailError) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Failed to send email. Please try again.",
    );
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "OTP sent to your email successfully",
    data: { email: user.email },
  });
});

// ✅ FIXED: Reset Password with Better Logging
export const resetPassword = catchAsync(async (req, res) => {
  const { email, otp, password } = req.body;

  const user = await User.isUserExistsByEmail(email);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  if (!user.password_reset_token) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Password reset token is invalid or expired",
    );
  }

  let decoded;
  try {
    decoded = verifyToken(user.password_reset_token, process.env.OTP_SECRET);
  } catch (error) {
    throw new AppError(httpStatus.BAD_REQUEST, "OTP expired or invalid");
  }

  if (decoded.otp !== otp) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid OTP");
  }

  user.password = password;
  user.password_reset_token = undefined;
  await user.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password reset successfully",
    data: null,
  });
});

export const changePassword = catchAsync(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Old password and new password are required",
    );
  }
  if (oldPassword === newPassword) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Old password and new password cannot be same",
    );
  }

  const user = await User.findById(req.user?._id).select("+password");
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  const matched = await User.isPasswordMatched(oldPassword, user.password);
  if (!matched)
    throw new AppError(httpStatus.UNAUTHORIZED, "Current password wrong");

  user.password = newPassword;
  await user.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password changed",
    data: "",
  });
});

export const refreshToken = catchAsync(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) throw new AppError(400, "Refresh token is required");

  const decoded = verifyToken(refreshToken, process.env.JWT_REFRESH_SECRET);
  const user = await User.findById(decoded._id);

  if (!user || user.refreshToken !== refreshToken) {
    throw new AppError(401, "Invalid refresh token");
  }

  const jwtPayload = { _id: user._id, email: user.email, role: user.role };

  const accessToken = createToken(
    jwtPayload,
    process.env.JWT_ACCESS_SECRET,
    process.env.JWT_ACCESS_EXPIRES_IN,
  );

  const refreshToken1 = createToken(
    jwtPayload,
    process.env.JWT_REFRESH_SECRET,
    process.env.JWT_REFRESH_EXPIRES_IN,
  );

  user.refreshToken = refreshToken1;
  await user.save();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Token refreshed successfully",
    data: { accessToken, refreshToken: refreshToken1 },
  });
});

export const logout = catchAsync(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user?._id,
    { refreshToken: "" },
    { new: true },
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Logged out successfully",
    data: "",
  });
});
