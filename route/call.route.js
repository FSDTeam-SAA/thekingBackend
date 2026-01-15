import express from "express";
import { initiateCall, endCall, getToken } from "../controller/call.controller.js";
import auth from "../middleware/auth.js";

const router = express.Router();

router.post("/initiate", auth(), initiateCall);
router.post("/end", auth(), endCall);
router.get("/token", auth(), getToken); // ✅ New Token Route

export default router;