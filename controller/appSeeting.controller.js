import AppError from "../errors/AppError.js";
import AppSetting from "../model/appSeeting.model.js";
import sendResponse from "../utils/sendResponse.js";

//toggle referral system
export const toggleReferralSystem = async (req, res) => {
  let settings = await AppSetting.findOne().select("referralSystemEnabled _id");

  // create default document if missing
  if (!settings) {
    settings = await AppSetting.create({
      referralSystemEnabled: true,
    });
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "App setting created successfully",
      data: settings,
    });
    return;
  }

  settings.referralSystemEnabled = !settings.referralSystemEnabled;
  await settings.save();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Referral setting updated successfully",
    data: settings,
  });
};

//get status
export const getAppSetting = async (req, res) => {
  const settings = await AppSetting.findOne().select("referralSystemEnabled _id");
  if (!settings) {
    throw new AppError(httpStatus.BAD_REQUEST, "App setting not found");
  }

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "App setting for reference status fetched successfully",
    data: settings,
  });
};
