import mongoose from "mongoose";

const appSettingSchema = new mongoose.Schema(
  {
    referralSystemEnabled: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

const AppSetting = mongoose.model("AppSetting", appSettingSchema);
export default AppSetting;
