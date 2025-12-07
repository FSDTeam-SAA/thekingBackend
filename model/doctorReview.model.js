// model/doctorReview.model.js
import mongoose, { Schema } from "mongoose";

const doctorReviewSchema = new Schema(
  {
    doctor: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    patient: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    appointment: {
      type: Schema.Types.ObjectId,
      ref: "Appointment", // optional – only if you have Appointment model
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    comment: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

export const DoctorReview = mongoose.model(
  "DoctorReview",
  doctorReviewSchema
);
