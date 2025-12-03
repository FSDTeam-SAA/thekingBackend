import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    speciality_name: { type: String, required: true, trim: true },

    // Cloudinary fields for category_image
    category_image_url: { type: String, default: null },
    category_image_public_id: { type: String, default: null },

    status: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Category = mongoose.model("Category", categorySchema);
export default Category;
