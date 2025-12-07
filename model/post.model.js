import mongoose, { Schema } from "mongoose";

const mediaSchema = new Schema(
  {
    public_id: { type: String, required: true },
    url: { type: String, required: true },

    // extra info (optional but useful)
    resourceType: {
      type: String,
      enum: ["image", "video", "raw", "auto"],
      default: "auto",
    },
    format: { type: String },
    originalName: { type: String },
    mimeType: { type: String },
    size: { type: Number }, // bytes
  },
  { _id: false }
);

const postSchema = new Schema(
  {
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    content: {
      type: String,
      trim: true,
      maxlength: 2000,
    },

    media: {
      type: [mediaSchema],
      default: [],
    },

    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "public",
    },

    likesCount: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Post = mongoose.model("Post", postSchema);
