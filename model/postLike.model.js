import mongoose, { Schema } from "mongoose";

const postLikeSchema = new Schema(
  {
    post: {
      type: Schema.Types.ObjectId,
      ref: "Post",
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

// one like per (post, user)
postLikeSchema.index({ post: 1, user: 1 }, { unique: true });

export const PostLike = mongoose.model("PostLike", postLikeSchema);
