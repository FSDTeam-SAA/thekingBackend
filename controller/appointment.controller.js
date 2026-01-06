// controller/appointment.controller.js
import httpStatus from "http-status";
import mongoose from "mongoose";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { uploadOnCloudinary } from "../utils/commonMethod.js";
import { User } from "../model/user.model.js";
import { Appointment } from "../model/appointment.model.js";
import { createNotification } from "../utils/notify.js";   // 🔔 <– add this

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:MM

const normalizeAppointmentType = (t) => {
  const v = String(t || "").toLowerCase().trim();
  if (["physical", "physical_visit", "clinic"].includes(v)) return "physical";
  if (["video", "video_call", "online"].includes(v)) return "video";
  return null;
};

const parseDate = (d) => {
  if (!d) return null;
  const dt = new Date(d); // expect "yyyy-mm-dd"
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const parseJSONMaybe = (value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const createAppointment = catchAsync(async (req, res) => {
  const {
    doctorId,
    appointmentType, // "physical" | "video"
    date,            // "2025-12-04"
    time,            // "10:30"
    symptoms,
    bookedFor,
  } = req.body;

  const patientId = req.user?._id;

  // 1) validate doctor & patient
  const doctor = await User.findById(doctorId);
  if (!doctor || doctor.role !== "doctor") {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  const patient = await User.findById(patientId);
  if (!patient) {
    throw new AppError(httpStatus.NOT_FOUND, "Patient not found");
  }

  const bookedForInput = parseJSONMaybe(bookedFor) || {};
  const typeRaw = String(bookedForInput?.type || "").trim().toLowerCase();
  let bookingScope = "self";
  if (!typeRaw) {
    bookingScope = "self";
  } else if (["self", "me", "myself"].includes(typeRaw)) {
    bookingScope = "self";
  } else if (["dependent", "dependant", "child"].includes(typeRaw)) {
    bookingScope = "dependent";
  } else {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "bookedFor.type must be 'self' or 'dependent'"
    );
  }

  const patientNameSnapshot = String(patient.fullName || "").trim();
  let bookedForPayload =
    bookingScope === "self"
      ? { type: "self", nameSnapshot: patientNameSnapshot }
      : null;

  if (bookingScope === "dependent") {
    const dependentId =
      bookedForInput?.dependentId ||
      bookedForInput?._id ||
      bookedForInput?.id;

    if (!dependentId || !mongoose.Types.ObjectId.isValid(dependentId)) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "A valid dependentId is required when booking for a dependent"
      );
    }

    const dependent =
      (patient.dependents || []).find(
        (dep) => String(dep._id) === String(dependentId)
      ) || null;

    if (!dependent) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Dependent not found for the current user"
      );
    }

    if (dependent.isActive === false) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Dependent is inactive and cannot be used for booking"
      );
    }

    bookedForPayload = {
      type: "dependent",
      dependentId: dependent._id,
      nameSnapshot: String(dependent.fullName || "").trim(),
    };
  }

  // 2) validate type
  const type = normalizeAppointmentType(appointmentType);
  if (!type) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "appointmentType must be physical or video"
    );
  }

  // 3) validate date
  const appointmentDate = parseDate(date);
  if (!appointmentDate) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid date format");
  }

  // 4) validate time
  if (!timeRegex.test(time || "")) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "time must be HH:MM in 24-hour format (e.g. 10:30)"
    );
  }

  // 5) upload files
  const medicalDocsFiles = req.files?.medicalDocuments || [];
  const paymentFiles = req.files?.paymentScreenshot || [];

  const medicalDocuments = [];
  for (const file of medicalDocsFiles) {
    const up = await uploadOnCloudinary(file.buffer, {
      folder: "docmobi/appointments/medicalDocs",
      resource_type: "image",
    });
    medicalDocuments.push({ public_id: up.public_id, url: up.secure_url });
  }

  let paymentScreenshot = undefined;
  if (paymentFiles[0]) {
    const up = await uploadOnCloudinary(paymentFiles[0].buffer, {
      folder: "docmobi/appointments/payment",
      resource_type: "image",
    });
    paymentScreenshot = { public_id: up.public_id, url: up.secure_url };
  }

  if (type === "video" && !paymentScreenshot) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Payment screenshot is required for video appointments"
    );
  }

  // 6) conflict check: same doctor, date & time
  const conflict = await Appointment.findOne({
    doctor: doctorId,
    appointmentDate,
    time,
    status: { $in: ["pending", "approved"] }, // NOTE: adjust if you don't use "approved"
  });

  if (conflict) {
    throw new AppError(
      httpStatus.CONFLICT,
      "This time slot is already booked for this doctor"
    );
  }

  // 7) create appointment
  const appointment = await Appointment.create({
    doctor: doctorId,
    patient: patientId,
    bookedFor: bookedForPayload,
    appointmentType: type,
    appointmentDate,
    time,
    symptoms,
    medicalDocuments,
    paymentScreenshot,
  });

  // 🔔 3) NOTIFICATION – patient booked appointment → notify doctor
  await createNotification({
    userId: doctor._id,             // doctor receives
    fromUserId: patient._id,        // patient triggered
    type: "appointment_created",
    title: "New appointment request",
    content: `${patient.fullName} requested an appointment on ${date} at ${time}.`,
    appointmentId: appointment._id,
    meta: {
      appointmentType: type,
      date,
      time,
      patientId,
      patientName: patient.fullName,
      bookedFor: bookedForPayload,
    },
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Appointment request submitted",
    data: appointment,
  });
});

/// get available time appointments
export const getAvailableAppointments = catchAsync(async (req, res) => {
  const { doctorId, date } = req.body;

  if (!doctorId || !date) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "doctorId and date are required"
    );
  }

  // 1) validate doctor
  const doctor = await User.findById(doctorId).select("role weeklySchedule");
  if (!doctor || doctor.role !== "doctor") {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  // 2) parse date & convert to day name ("monday".."sunday")
  const dateObj = new Date(date); // expect "YYYY-MM-DD"
  if (Number.isNaN(dateObj.getTime())) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid date format");
  }

  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const dayName = dayNames[dateObj.getDay()]; // 0-6 -> sunday-saturday

  // 3) get this day's schedule from doctor's weeklySchedule
  const weeklySchedule = doctor.weeklySchedule || [];
  const daySchedule = weeklySchedule.find(
    (d) => d.day === dayName && d.isActive
  );

  if (!daySchedule || !daySchedule.slots?.length) {
    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "No schedule for this day",
      data: {
        date,
        day: dayName,
        slots: [],
      },
    });
  }

  // 4) find all booked appointments for this doctor on that date
  const startOfDay = new Date(dateObj);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const existingAppointments = await Appointment.find({
    doctor: doctorId,
    appointmentDate: { $gte: startOfDay, $lt: endOfDay },
    status: { $in: ["pending", "approved"] }, // adjust if needed
  }).select("time");

  const bookedTimesSet = new Set(existingAppointments.map((a) => a.time));

  const allSlots = (daySchedule.slots || []).map((slot) => ({
    start: slot.start,
    end: slot.end,
    isBooked: bookedTimesSet.has(slot.start),
  }));

  const availableSlots = allSlots.filter((s) => !s.isBooked);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Available appointment slots fetched",
    data: {
      date,
      day: dayName,
      slots: availableSlots,
    },
  });
});

// GET all appointments for current user (patient/doctor/admin)
export const getMyAppointments = catchAsync(async (req, res) => {
  const userId = req.user._id;
  const role = req.user.role; // "patient" | "doctor" | "admin"

  const filter = {};
  const { status, doctorId, patientId } = req.query;

  if (role === "patient") {
    filter.patient = userId;
  } else if (role === "doctor") {
    filter.doctor = userId;
  } else if (role === "admin") {
    if (doctorId) filter.doctor = doctorId;
    if (patientId) filter.patient = patientId;
  } else {
    throw new AppError(httpStatus.FORBIDDEN, "Invalid role");
  }

  if (status) {
    filter.status = status;
  }

  const appointments = await Appointment.find(filter)
    .sort({ appointmentDate: 1, time: 1 })
    .populate("doctor", "fullName role specialty avatar fees")
    .populate("patient", "fullName role avatar");

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointments fetched successfully",
    data: appointments,
  });
});

export const updateAppointmentStatus = catchAsync(async (req, res) => {
  const { id } = req.params;                 // appointment id
  const { status, patient, price } = req.body;
  const userId = req.user._id;
  const role = req.user.role;                // "patient" | "doctor" | "admin"

  // ✅ now we use "accepted" instead of "confirmed"
  const allowedStatuses = ["pending", "accepted", "completed", "cancelled"];

  if (!status || !allowedStatuses.includes(status)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Status must be one of: pending, accepted, completed, cancelled"
    );
  }

  // 1) find appointment
  const appointment = await Appointment.findById(id)
    .populate("doctor", "fullName fees role")
    .populate("patient", "fullName role");

  if (!appointment) {
    throw new AppError(httpStatus.NOT_FOUND, "Appointment not found");
  }

  // 2) only this doctor OR admin can update
  const isDoctorOwner =
    role === "doctor" &&
    String(appointment.doctor?._id) === String(userId);

  const isAdmin = role === "admin";

  if (!isDoctorOwner && !isAdmin) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only the doctor or admin can update appointment status"
    );
  }

  // 3) status transitions
  const current = appointment.status;
  const transitions = {
    pending: ["accepted", "cancelled"],
    accepted: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  };

  if (!transitions[current].includes(status) && current !== status) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Invalid status transition from ${current} to ${status}`
    );
  }

  // 4) Extra validation ONLY when marking as completed
  if (status === "completed") {
    if (!patient || !String(patient).trim()) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "patient (fullName) is required when completing appointment"
      );
    }

    const dbPatientName = appointment.patient?.fullName || "";
    if (String(patient).trim() !== dbPatientName) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Patient name does not match appointment patient"
      );
    }

    if (price === undefined || price === null || String(price).trim() === "") {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "price is required when completing appointment"
      );
    }

    const paidAmount = Number(price);
    if (!Number.isFinite(paidAmount) || paidAmount < 0) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "price must be a valid positive number"
      );
    }

    const doctorFee = Number(appointment.doctor?.fees?.amount || 0);
    if (paidAmount < doctorFee) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Paid amount is less than the doctor's fees"
      );
    }
//==============================================================================================================extra addddddddddddddddddddd
    appointment.paymentVerified = true;

    // appointment.paidAmount = paidAmount; // uncomment if you store it
  }

  // 5) save new status
  appointment.status = status;
  await appointment.save();

  // 6) NOTIFICATION to patient about status change
  const patientId = appointment.patient._id;
  const doctorId = appointment.doctor._id;
  const doctorName = appointment.doctor.fullName;
  const patientName = appointment.patient.fullName;

  let content = `Your appointment with ${doctorName} is now ${status}.`;

  if (status === "accepted") {
    content = `${doctorName} has accepted your appointment request.`;
  } else if (status === "cancelled") {
    content = `Your appointment with ${doctorName} has been cancelled.`;
  } else if (status === "completed") {
    content = `Your appointment with ${doctorName} has been completed.`;
  }

  await createNotification({
    userId: patientId,
    fromUserId: doctorId,
    type: "appointment_status_change",
    title: "Appointment status updated",
    content,
    appointmentId: appointment._id,
    meta: {
      status,
      price,
      doctorId,
      doctorName,
      patientName,
    },
  });

  let sessionInfo = null;

  if (status === "completed") {
    const { amount = 0, currency = "USD" } = appointment.doctor?.fees || {};

    sessionInfo = {
      sessionHolderName: patientName,
      payableAmount: amount,
      currency,
    };
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointment status updated",
    data: {
      appointment,
      sessionInfo,
    },
  });
});

// helper: date range for daily / weekly / monthly
const getDateRangeForView = (view) => {
  const now = new Date();
  now.setMilliseconds(0);
  const end = now;

  let start;

  if (view === "daily") {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999); // আজকের দিনের শেষ পর্যন্ত ===================================================new addddddd
  } else if (view === "weekly") {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
     end.setHours(23, 59, 59, 999); // আজকের দিনের শেষ পর্যন্ত ===================================================new addddddd
    start.setDate(start.getDate() - 6);
  } else if (view === "monthly") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  return { start, end };
};

/**
 * GET /appointment/earnings/overview?view=daily|weekly|monthly
 */
export const getEarningsOverview = catchAsync(async (req, res) => {
  const role = req.user.role;
  const userId = req.user._id;
  const view = (req.query.view || "monthly").toLowerCase();

  if (!["daily", "weekly", "monthly"].includes(view)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "view must be one of: daily, weekly, monthly"
    );
  }

  const { start, end } = getDateRangeForView(view);

  const baseMatch = {
    status: "completed",
  };

  if (start && end) {
    baseMatch.appointmentDate = { $gte: start, $lte: end };
  }

  if (role === "doctor") {
    const match = { ...baseMatch, doctor: userId };

    const appointments = await Appointment.find(match)
      .populate("doctor", "fees")
      .lean();

    let totalEarnings = 0;
    let physicalEarnings = 0;
    let videoEarnings = 0;
    let totalAppointments = appointments.length;
    let physicalCount = 0;
    let videoCount = 0;

    const weeklyByWeekday = [0, 0, 0, 0, 0, 0, 0];

    for (const appt of appointments) {
      const fee = Number(appt.doctor?.fees?.amount || 0);
      totalEarnings += fee;

      if (appt.appointmentType === "physical") {
        physicalEarnings += fee;
        physicalCount++;
      } else if (appt.appointmentType === "video") {
        videoEarnings += fee;
        videoCount++;
      }

      if (view === "weekly" && appt.appointmentDate) {
        const d = new Date(appt.appointmentDate);
        const idx = d.getDay();
        weeklyByWeekday[idx] += fee;
      }
    }

    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Doctor earnings overview fetched",
      data: {
        scope: "doctor",
        view,
        totalEarnings,
        totalAppointments,
        physical: {
          earnings: physicalEarnings,
          count: physicalCount,
        },
        video: {
          earnings: videoEarnings,
          count: videoCount,
        },
        weeklyByWeekday:
          view === "weekly"
            ? {
                labels: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
                values: weeklyByWeekday,
              }
            : null,
      },
    });
  }

  if (role === "admin") {
    const match = { ...baseMatch };

    const appointments = await Appointment.find(match)
      .populate("doctor", "fullName specialty fees")
      .lean();

    let totalEarnings = 0;
    let totalAppointments = appointments.length;

    const perDoctor = new Map();

    for (const appt of appointments) {
      const doc = appt.doctor;
      if (!doc) continue;

      const fee = Number(doc.fees?.amount || 0);
      totalEarnings += fee;

      const docId = String(doc._id);
      if (!perDoctor.has(docId)) {
        perDoctor.set(docId, {
          doctorId: docId,
          doctorName: doc.fullName || "",
          specialty: doc.specialty || "",
          appointments: 0,
          earnings: 0,
        });
      }

      const entry = perDoctor.get(docId);
      entry.appointments += 1;
      entry.earnings += fee;
    }

    const doctors = Array.from(perDoctor.values());
    const avgPerDoctor =
      doctors.length > 0 ? totalEarnings / doctors.length : 0;

    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Admin earnings overview fetched",
      data: {
        scope: "admin",
        view,
        totalEarnings,
        totalAppointments,
        avgPerDoctor,
        doctors,
      },
    });
  }

  throw new AppError(
    httpStatus.FORBIDDEN,
    "Only doctor or admin can view earnings overview"
  );
});
