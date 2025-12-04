import AppError from "../errors/AppError.js";
import { createToken, verifyToken } from "../utils/authToken.js";
import catchAsync from "../utils/catchAsync.js";
import { generateOTP } from "../utils/commonMethod.js";
import httpStatus from "http-status";
import sendResponse from "../utils/sendResponse.js";
import { sendEmail } from "../utils/sendEmail.js";
import { User } from "../model/user.model.js";

const normalizeRole = (role) => {
  const r = String(role || "patient").toLowerCase().trim();
  if (!["patient", "doctor", "admin"].includes(r)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid role");
  }
  return r;
};

export const register = catchAsync(async (req, res) => {
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
  } = req.body;

  if (!email || !password || !fullName) {
    throw new AppError(httpStatus.BAD_REQUEST, "Please fill in all fields");
  }

  if (password !== confirmPassword) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Password and confirm password do not match"
    );
  }

  const roleNormalized = normalizeRole(role);

  if (roleNormalized === "doctor" && !medicalLicenseNumber) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Medical license number is required for doctors"
    );
  }

  // duplicates check
  const existingUser = await User.findOne({
    $or: [
      { email },
      ...(phone ? [{ phone }] : []),
      ...(medicalLicenseNumber ? [{ medicalLicenseNumber }] : []),
    ],
  });

  if (existingUser) {
    let message = "User already exists";
    if (existingUser.email === email) message = "Email already exists";
    else if (phone && existingUser.phone === phone) message = "Phone already exists";
    else if (medicalLicenseNumber && existingUser.medicalLicenseNumber === medicalLicenseNumber)
      message = "Medical license number already exists";
    throw new AppError(httpStatus.BAD_REQUEST, message);
  }

  const exp = Number(experienceYears);
  const expSafe = Number.isFinite(exp) && exp >= 0 ? exp : 0;

  const approvalStatus = roleNormalized === "doctor" ? "pending" : "approved";

  await User.create({
    phone,
    fullName,
    email,
    password,
    experienceYears: expSafe,
    role: roleNormalized,
    specialty,
    medicalLicenseNumber: roleNormalized === "doctor" ? medicalLicenseNumber : undefined,
    approvalStatus,
    verificationInfo: { token: "" },
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Registered successfully",
    data: null,
  });
});

export const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.isUserExistsByEmail(email);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  if (user?.password && !(await User.isPasswordMatched(password, user.password))) {
    throw new AppError(httpStatus.FORBIDDEN, "Password is not correct");
  }

  // doctor approval check
  if (user.role === "doctor" && user.approvalStatus !== "approved") {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Doctor account pending admin approval"
    );
  }

  const jwtPayload = { _id: user._id, email: user.email, role: user.role };

  const accessToken = createToken(
    jwtPayload,
    process.env.JWT_ACCESS_SECRET,
    process.env.JWT_ACCESS_EXPIRES_IN
  );

  const refreshToken = createToken(
    jwtPayload,
    process.env.JWT_REFRESH_SECRET,
    process.env.JWT_REFRESH_EXPIRES_IN
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
      approvalStatus: user.approvalStatus,
      user,
    },
  });
});

export const forgetPassword = catchAsync(async (req, res) => {
  const { email } = req.body;

  const user = await User.isUserExistsByEmail(email);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  const otp = generateOTP();
  const otpToken = createToken({ otp }, process.env.OTP_SECRET, process.env.OTP_EXPIRE);

  user.password_reset_token = otpToken;
  await user.save();

  await sendEmail(user.email, "Reset Password", `Your OTP is ${otp}`);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "OTP sent to your email successfully",
    data: null,
  });
});

export const resetPassword = catchAsync(async (req, res) => {
  const { email, otp, password } = req.body;

  const user = await User.isUserExistsByEmail(email);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  if (!user.password_reset_token) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Password reset token is invalid or expired"
    );
  }

  let decoded;
  try {
    decoded = verifyToken(user.password_reset_token, process.env.OTP_SECRET);
  } catch {
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
      "Old password and new password are required"
    );
  }
  if (oldPassword === newPassword) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Old password and new password cannot be same"
    );
  }

  const user = await User.findById(req.user?._id).select("+password");
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  const matched = await User.isPasswordMatched(oldPassword, user.password);
  if (!matched) throw new AppError(httpStatus.UNAUTHORIZED, "Current password wrong");

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
    process.env.JWT_ACCESS_EXPIRES_IN
  );

  const refreshToken1 = createToken(
    jwtPayload,
    process.env.JWT_REFRESH_SECRET,
    process.env.JWT_REFRESH_EXPIRES_IN
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
  await User.findByIdAndUpdate(req.user?._id, { refreshToken: "" }, { new: true });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Logged out successfully",
    data: "",
  });
});
