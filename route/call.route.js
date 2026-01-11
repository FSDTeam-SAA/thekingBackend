import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { initiateCall, endCall } from "../controller/call.controller.js";

const router = express.Router();

// Initiate call
router.post("/initiate", protect, initiateCall);

// End call
router.post("/end", protect, endCall);

export default router;