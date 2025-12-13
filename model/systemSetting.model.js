import mongoose, { Schema } from "mongoose";

const systemSettingSchema = new Schema(
  {
    key: { type: String, default: "global", unique: true },
    requireDoctorReferralCode: { type: Boolean, default: false },
  },
  { timestamps: true }
);

systemSettingSchema.statics.getSettings = async function () {
  let settings = await this.findOne({ key: "global" });
  if (!settings) {
    settings = await this.create({ key: "global" });
  }
  return settings;
};

systemSettingSchema.statics.updateReferralRequirement = async function (shouldRequire) {
  const settings = await this.findOneAndUpdate(
    { key: "global" },
    { $set: { requireDoctorReferralCode: shouldRequire } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return settings;
};

export const SystemSetting = mongoose.model("SystemSetting", systemSettingSchema);
