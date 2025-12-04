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
    .populate("doctor", "fullName role specialty avatar")
    .populate("patient", "fullName role avatar");

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointments fetched successfully",
    data: appointments,
  });
});
