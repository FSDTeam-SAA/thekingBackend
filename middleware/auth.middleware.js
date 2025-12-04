import jwt from "jsonwebtoken";
import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import { User } from "./../model/user.model.js";

export const protect = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) throw new AppError(httpStatus.NOT_FOUND, "Token not found");

  try {
    const decoded = await jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    console.log("Decoded token:", decoded);
    // console.log(decoded)
    const user = await User.findById(decoded._id);
    if (user) {
      
      req.user = user;
      console.log("User authenticated:", user);
    }
    next();
  } catch (err) {
    throw new AppError(401, "Invalid token");
  }
};


// New middleware to check for 'Admin' role
export const isAdmin = (req, res, next) => {
  console.log("Checking admin role for user:", req.user);
  if (req.user?.role !== "admin") {
    throw new AppError(403, "Access denied. You are not an admin.");
  }
  next();
};


// New middleware to check for 'Doctor' role
export const isDoctor = (req, res, next) => {
  if (req.user?.role !== "doctor") {
    throw new AppError(403, "Access denied. You are not an doctor.");
  }
  next();
};

//middleware to check if the user is a patient
export const isPatient = (req, res, next) => {
  if (req.user?.role !== "patient") {
    throw new AppError(403, "Access denied. You are not an patient.");
  }
  next();
};
