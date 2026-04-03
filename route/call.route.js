import express from "express";
import { initiateCall, endCall, getToken, acceptCall, rejectCall } from "../controller/call.controller.js";
import { protect } from "../middleware/auth.middleware.js";


const router = express.Router();

router.post("/initiate", protect, initiateCall);
router.post("/accept", protect, acceptCall);
router.post("/reject", protect, rejectCall); // ✅ Added
router.post("/end", protect, endCall);
router.get("/token", protect, getToken);

export default router;