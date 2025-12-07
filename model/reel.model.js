import mongoose, { Schema } from "mongoose";

const videoSchema = new Schema(
  {
    public_id: { type: String, required: true },
    url: { type: String, required: true },

    resourceType: { type: String, default: "video" }, // cloudinary resource_type
    format: { type: String },
    duration: { type: Number }, // seconds (if Cloudinary returns it)
    originalName: { type: String },
    mimeType: { type: String },
    size: { type: Number }, // bytes
  },
  { _id: false }
);

const imageSchema = new Schema(
  {
    public_id: { type: String, required: true },
    url: { type: String, required: true },
    resourceType: { type: String, default: "image" },
    format: { type: String },
    originalName: { type: String },
    mimeType: { type: String },
    size: { type: Number },
  },
  { _id: false }
);

const reelSchema = new Schema(
  {
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    caption: {
      type: String,
      trim: true,
      maxlength: 2000,
    },

    video: {
      type: videoSchema,
      required: true,
    },

    thumbnail: {
      type: imageSchema,
    },

    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "public",
    },

    likesCount: { type: Number, default: 0 },
    viewsCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Reel = mongoose.model("Reel", reelSchema);
