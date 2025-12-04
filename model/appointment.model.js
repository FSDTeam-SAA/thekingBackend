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

    status: {
  type: String,
  enum: ["pending", "confirmed", "accepted", "cancelled", "completed"],
  default: "pending",
},

  },
  { timestamps: true }
);

export const Appointment = mongoose.model("Appointment", appointmentSchema);
