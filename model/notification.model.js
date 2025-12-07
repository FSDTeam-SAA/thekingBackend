// model/notification.model.js
import mongoose, { Schema } from "mongoose";

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true }, // receiver
    fromUserId: { type: Schema.Types.ObjectId, ref: "User" },            // sender (optional)

    type: {
      type: String,
      enum: [
        "doctor_signup",
        "doctor_approved",
        "appointment_created",
        "appointment_status_change",
      ],
      required: true,
    },

    title: { type: String, required: true },
    content: { type: String, required: true },

    appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment" },

    meta: { type: Schema.Types.Mixed },

    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Notification = mongoose.model("Notification", notificationSchema);
