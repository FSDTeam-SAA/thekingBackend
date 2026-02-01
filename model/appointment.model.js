// model/appointment.model.js
import mongoose, { Schema } from "mongoose";

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/; // "10:30"

const fileSchema = new Schema(
  {
    public_id: { type: String },
    url: { type: String },
  },
  { _id: false }
);

const appointmentSchema = new Schema(
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

    // ✅ UPDATED: bookedFor field with relationship
    bookedFor: {
      type: {
        type: String,
        enum: ["self", "dependent"],
        required: true,
        default: "self",
      },
      dependentId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
      },
      dependentName: {
        type: String,
        trim: true,
        default: null
      },
      relationship: { // ✅ NEW FIELD - This is the category
        type: String,
        enum: ['Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Spouse', 'Other', 'Child'],
        default: null
      },
      nameSnapshot: {
        type: String,
        trim: true,
        default: ""
      },
    },

    // "physical" (pay at clinic) or "video" (online payment)
    appointmentType: {
      type: String,
      enum: ["physical", "video"],
      required: true,
    },

    appointmentDate: {
      type: Date,
      required: true,
    },

    // ✅ single time value (HH:MM)
    time: {
      type: String,
      required: true,
      match: timeRegex,
    },

    symptoms: {
      type: String,
      maxlength: 2000,
    },

    medicalDocuments: {
      type: [fileSchema],
      default: [],
    },

    paymentScreenshot: fileSchema,

    paymentVerified: {
      type: Boolean,
      default: false,
    },

    // ✅ Status: "pending" -> "accepted" -> "completed" or "cancelled"
    status: {
      type: String,
      enum: ["pending", "accepted", "cancelled", "completed"],
      default: "pending",
    },

    // ✅ Optional: Paid amount tracking
    paidAmount: {
      type: Number,
      default: 0,
    },
    // ✅ NEW: Admin commission tracking
    adminEarning: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// ✅ Index for faster queries
appointmentSchema.index({ doctor: 1, appointmentDate: 1, time: 1 });
appointmentSchema.index({ patient: 1, status: 1 });
appointmentSchema.index({ status: 1, appointmentDate: 1 });

export const Appointment = mongoose.model("Appointment", appointmentSchema);