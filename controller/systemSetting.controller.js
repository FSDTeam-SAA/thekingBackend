import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { SystemSetting } from "../model/systemSetting.model.js";

export const getReferralRequirementSetting = catchAsync(async (req, res) => {
  const settings = await SystemSetting.getSettings();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral setting fetched successfully",
    data: { requireDoctorReferralCode: settings.requireDoctorReferralCode },
  });
});

export const updateReferralRequirementSetting = catchAsync(async (req, res) => {
  const { requireDoctorReferralCode } = req.body;

  if (typeof requireDoctorReferralCode !== "boolean") {
    throw new AppError(httpStatus.BAD_REQUEST, "requireDoctorReferralCode must be boolean");
  }

  const settings = await SystemSetting.updateReferralRequirement(requireDoctorReferralCode);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral setting updated successfully",
    data: { requireDoctorReferralCode: settings.requireDoctorReferralCode },
  });
});
