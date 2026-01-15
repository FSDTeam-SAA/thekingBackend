import express from "express";
import { protect } from "../controller/call.controller.js";
import auth from "../middleware/auth.middleware.js";


const router = express.Router();

router.post("/initiate", auth(), initiateCall);
router.post("/end", auth(), endCall);
router.get("/token", auth(), getToken); // ✅ New Token Route

export default router;