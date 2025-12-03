import httpStatus from "http-status";
import { User } from "../model/user.model.js";
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/commonMethod.js";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";

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
  const { name } = req.body;

  const user = await User.findById(req.user._id);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  if (name) user.name = name.trim();

  if (req.file?.buffer) {
    // ✅ delete previous avatar if exists
    const oldPublicId = user?.avatar?.public_id;
    if (oldPublicId) {
      await deleteFromCloudinary(oldPublicId).catch(() => {});
    }

    // ✅ upload new avatar
    const upload = await uploadOnCloudinary(req.file.buffer, {
      folder: "docmobi/users",        // optional
      resource_type: "image",         // optional
    });

    user.avatar = { public_id: upload.public_id, url: upload.secure_url };
  }

  await user.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Profile updated successfully",
    data: user,
  });
});


export const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  if (newPassword !== confirmPassword)
    throw new AppError(httpStatus.BAD_REQUEST, "Passwords don't match");

  const user = await User.findById(req.user._id).select("+password");

  if (!(await User.isPasswordMatched(currentPassword, user.password))) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Current password wrong");
  }
  user.password = newPassword;

  await user.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password changed",
  });
});
