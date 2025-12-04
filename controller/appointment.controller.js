import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { uploadOnCloudinary } from "../utils/commonMethod.js";
import { User } from "../model/user.model.js";
import { Appointment } from "../model/appointment.model.js";

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

export const createAppointment = catchAsync(async (req, res) => {
  // const { doctorId } = req.params;
  const {
    doctorId,
    appointmentType, // "physical" | "video"
    date,            // "2025-12-04"
    time,            // "10:30"
    symptoms,
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
    status: { $in: ["pending", "approved"] },
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
    appointmentType: type,
    appointmentDate,
    time,
    symptoms,
    medicalDocuments,
    paymentScreenshot,
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
  const { doctorId, date } = req.body; // 👈 frontend sends these as query params

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

  // if no schedule for that day → no available slots
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
    status: { $in: ["pending", "approved"] }, // treat these as "booked"
  }).select("time");

  const bookedTimesSet = new Set(existingAppointments.map((a) => a.time));

  // 5) mark which slots are booked / free
  const allSlots = (daySchedule.slots || []).map((slot) => ({
    start: slot.start,              // "10:00"
    end: slot.end,                  // "10:30"
    isBooked: bookedTimesSet.has(slot.start),
  }));

  const availableSlots = allSlots.filter((s) => !s.isBooked);

  // 6) respond
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Available appointment slots fetched",
    data: {
      date,
      day: dayName,
      slots: availableSlots,        // [{start, end, isBooked:false}, ...]
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
    // optional filters for admin
    if (doctorId) filter.doctor = doctorId;
    if (patientId) filter.patient = patientId;
  } else {
    throw new AppError(httpStatus.FORBIDDEN, "Invalid role");
  }

  if (status) {
    filter.status = status; // pending / approved / rejected / cancelled / completed
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
  const { status, patient, price } = req.body; // status + extras
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
  // pending -> accepted / cancelled
  // accepted -> completed / cancelled
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
    // patient full name required
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

    // price required
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

    // (optional) store paidAmount on appointment
    // appointment.paidAmount = paidAmount;
  }

  // 5) save new status
  appointment.status = status;
  await appointment.save();

  // 6) response (sessionInfo only useful for UI, mainly on completed)
  let sessionInfo = null;

  if (status === "completed") {
    const patientName = appointment.patient?.fullName || "";
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
  } else if (view === "weekly") {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6); // last 7 days including today
  } else if (view === "monthly") {
    start = new Date(now.getFullYear(), now.getMonth(), 1); // first day of month
  }

  return { start, end };
};

/**
 * GET /appointment/earnings/overview?view=daily|weekly|monthly
 *
 * - doctor: earnings from *own* completed appointments
 * - admin : earnings from *all* completed appointments + per-doctor summary
 */
export const getEarningsOverview = catchAsync(async (req, res) => {
  const role = req.user.role; // "patient" | "doctor" | "admin"
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
    status: "completed", // ✅ only completed appointments count
  };

  if (start && end) {
    baseMatch.appointmentDate = { $gte: start, $lte: end };
  }

  // ---------- DOCTOR ----------
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

    // for weekly bar chart: Sun..Sat
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
        const idx = d.getDay(); // 0=Sun..6=Sat
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

  // ---------- ADMIN ----------
  if (role === "admin") {
    const match = { ...baseMatch };

    const appointments = await Appointment.find(match)
      .populate("doctor", "fullName specialty fees")
      .lean();

    let totalEarnings = 0;
    let totalAppointments = appointments.length;

    // doctorId -> stats
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
        doctors, // for the Doctors Management table
      },
    });
  }

  // patients don't have earnings
  throw new AppError(
    httpStatus.FORBIDDEN,
    "Only doctor or admin can view earnings overview"
  );
});


