import jwt from "jsonwebtoken";
import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import { User } from "./../model/user.model.js";

export const protect = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Token not found");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    if (!decoded) {
      throw new AppError(httpStatus.UNAUTHORIZED, "Invalid or expired token");
    }

    // Check if user still exists
    const user = await User.findById(decoded._id).select("-password");
    if (!user) {
      throw new AppError(httpStatus.UNAUTHORIZED, "User not found or deleted");
    }

    // Attach user to request
    req.user = user;

    next(); 
  } catch (err) {
    next(err);
  }
};

// Admin middleware
export const isAdmin = (req, res, next) => {
  if (!req.user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }
  if (req.user.role !== "admin") {
    throw new AppError(httpStatus.FORBIDDEN, "Access denied. Admin only.");
  }
  next();
};

// Doctor middleware
export const isDoctor = (req, res, next) => {
  if (!req.user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }
  if (req.user.role !== "doctor") {
    throw new AppError(httpStatus.FORBIDDEN, "Access denied. Doctor only.");
  }
  next();
};

// Patient middleware
export const isPatient = (req, res, next) => {
  if (!req.user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }
  if (req.user.role !== "patient") {
    throw new AppError(httpStatus.FORBIDDEN, "Access denied. Patient only.");
  }
  next();
};
