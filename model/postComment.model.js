import mongoose, { Schema } from "mongoose";

const postCommentSchema = new Schema(
  {
    post: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      required: true,
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: {
      type: String,
      trim: true,
      maxlength: 1000,
      required: true,
    },
  },
  { timestamps: true }
);

export const PostComment = mongoose.model("PostComment", postCommentSchema);
