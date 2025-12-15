import mongoose, { Schema } from "mongoose";

const referralCodeSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    timesUsed: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

const normalizeCode = (codeValue) => {
  const normalized = String(codeValue || "").trim().toUpperCase();
  return normalized;
};

referralCodeSchema.statics.findActiveCode = function (codeValue) {
  const normalized = normalizeCode(codeValue);
  if (!normalized) return null;
  return this.findOne({
    code: normalized,
    isActive: true,
  });
};

referralCodeSchema.statics.claimActiveCode = function (codeValue) {
  const normalized = normalizeCode(codeValue);
  if (!normalized) return null;
  return this.findOne({
    code: normalized,
    isActive: true,
  });
};

export const ReferralCode = mongoose.model("ReferralCode", referralCodeSchema);
