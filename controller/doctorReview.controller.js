import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import sendResponse from "../utils/sendResponse.js";
import catchAsync from "../utils/catchAsync.js";

import { DoctorReview } from "../model/doctorReview.model.js";
import { User } from "../model/user.model.js";
import { Appointment } from "../model/appointment.model.js";

/**
 * POST /doctor-reviews
 * body: { doctorId, appointmentId?, rating, comment? }
 * - only patients
 * - optional: validate appointment (completed + belongs to patient & doctor)
 */
export const createDoctorReview = catchAsync(async (req, res) => {
  const { doctorId, appointmentId, rating, comment } = req.body;
  const patientId = req.user._id;
  const role = req.user.role;

  if (role !== "patient") {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only patients can submit doctor reviews"
    );
  }

  if (!doctorId || !rating) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "doctorId and rating are required"
    );
  }

  const ratingNum = Number(rating);
  if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Rating must be a number between 1 and 5"
    );
  }

  // check doctor
  const doctor = await User.findById(doctorId);
  if (!doctor || doctor.role !== "doctor") {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid doctor");
  }

  // ---------- APPOINTMENT VALIDATION ----------
  if (appointmentId) {
    const appointment = await Appointment.findById(appointmentId);

    if (!appointment) {
      throw new AppError(httpStatus.NOT_FOUND, "Appointment not found");
    }

    if (
      String(appointment.patient) !== String(patientId) ||
      String(appointment.doctor) !== String(doctorId)
    ) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "You are not allowed to review this appointment"
      );
    }

    if (appointment.status !== "completed") {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "You can only review completed appointments"
      );
    }
  }
  // -------------------------------------------

  // 🔁 UPSERT LOGIC (create or update)
  const query = {
    doctor: doctorId,
    patient: patientId,
  };

  if (appointmentId) {
    query.appointment = appointmentId;
  } else {
    query.appointment = { $exists: false };
  }

  const update = {
    $set: {
      doctor: doctorId,
      patient: patientId,
      appointment: appointmentId || undefined,
      rating: ratingNum,
      comment: comment ? String(comment).trim() : "",
    },
  };

  const options = {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  };

  let review = await DoctorReview.findOneAndUpdate(query, update, options);

  review = await review.populate([
    { path: "patient", select: "fullName avatar" },
    { path: "doctor", select: "fullName specialty" },
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Review saved successfully",
    data: review,
  });
});



/**
 * GET /doctor-reviews/doctor/:doctorId?page&limit
 * public: get reviews for doctor with avg rating & total count
 */
export const getDoctorReviews = catchAsync(async (req, res) => {
  const { doctorId } = req.params;
  const { page = 1, limit = 10 } = req.query;

  const doctor = await User.findById(doctorId);
  if (!doctor || doctor.role !== "doctor") {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;

  const [reviews, total, stats] = await Promise.all([
    DoctorReview.find({ doctor: doctorId })
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate("patient", "fullName avatar")
      .lean(),
    DoctorReview.countDocuments({ doctor: doctorId }),
    DoctorReview.aggregate([
      { $match: { doctor: doctor._id } },
      {
        $group: {
          _id: "$doctor",
          avgRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 },
        },
      },
    ]),
  ]);

  const summary =
    stats.length > 0
      ? {
          avgRating: Number(stats[0].avgRating.toFixed(1)),
          totalReviews: stats[0].totalReviews,
        }
      : {
          avgRating: 0,
          totalReviews: 0,
        };

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor reviews fetched successfully",
    data: {
      doctor: {
        _id: doctor._id,
        fullName: doctor.fullName,
        specialty: doctor.specialty,
      },
      summary,
      items: reviews,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
      },
    },
  });
});

/**
 * GET /doctor-reviews/me
 * - patient: reviews they have given
 * - doctor: reviews they have received
 */
export const getMyDoctorReviews = catchAsync(async (req, res) => {
  const role = req.user.role;
  const userId = req.user._id;

  let filter = {};

  if (role === "patient") {
    filter.patient = userId;
  } else if (role === "doctor") {
    filter.doctor = userId;
  } else {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only patients or doctors can view their reviews"
    );
  }

  const reviews = await DoctorReview.find(filter)
    .sort({ createdAt: -1 })
    .populate("doctor", "fullName specialty avatar")
    .populate("patient", "fullName avatar")
    .lean();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reviews fetched successfully",
    data: reviews,
  });
});

/**
 * DELETE /doctor-reviews/:id
 * - patient can delete own review
 * - admin can delete any review
 */
export const deleteDoctorReview = catchAsync(async (req, res) => {
  const { id } = req.params;
  const role = req.user.role;
  const userId = req.user._id;

  const review = await DoctorReview.findById(id);
  if (!review) {
    throw new AppError(httpStatus.NOT_FOUND, "Review not found");
  }

  const isOwner = String(review.patient) === String(userId);
  const isAdmin = role === "admin";

  if (!isOwner && !isAdmin) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "You are not allowed to delete this review"
    );
  }

  await review.deleteOne();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Review deleted successfully",
    data: null,
  });
});
