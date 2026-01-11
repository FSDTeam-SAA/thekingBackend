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

// ✅ FIRST: Define the schema
const reelSchema = new Schema(
  {
    author: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
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
      index: true,
    },

    likes: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    sharesCount: { 
      type: Number, 
      default: 0 
    },
    
    viewsCount: { 
      type: Number, 
      default: 0 
    },
  },
  { 
    timestamps: true,
  }
);

// ✅ THEN: Add virtual fields AFTER schema is defined
reelSchema.virtual('commentsCount', {
  ref: 'ReelComment',
  localField: '_id',
  foreignField: 'reel',
  count: true,
});

// ✅ Add virtual for likes count
reelSchema.virtual('likesCount').get(function() {
  return this.likes?.length || 0;
});

// ✅ Enable virtuals in JSON
reelSchema.set('toJSON', { virtuals: true });
reelSchema.set('toObject', { virtuals: true });

// ✅ Add indexes for better performance
reelSchema.index({ createdAt: -1 });
reelSchema.index({ author: 1, createdAt: -1 });

// ✅ FINALLY: Export the model
export const Reel = mongoose.model("Reel", reelSchema);