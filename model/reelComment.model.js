import mongoose, { Schema } from "mongoose";

const reelCommentSchema = new Schema(
  {
    reel: {
      type: Schema.Types.ObjectId,
      ref: "Reel",
      required: true,
      index: true, // ✅ Index for faster queries
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    content: {
      type: String,
      trim: true,
      maxlength: 1000,
      required: true,
    },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ✅ Compound index for efficient queries
reelCommentSchema.index({ reel: 1, createdAt: -1 });

export const ReelComment = mongoose.model("ReelComment", reelCommentSchema);