import mongoose, { Schema } from "mongoose";

const reelLikeSchema = new Schema(
  {
    reel: {
      type: Schema.Types.ObjectId,
      ref: "Reel",
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// one like per (reel, user)
reelLikeSchema.index({ reel: 1, user: 1 }, { unique: true });

export const ReelLike = mongoose.model("ReelLike", reelLikeSchema);