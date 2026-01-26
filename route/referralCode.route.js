import express from "express";
import { protect, isAdmin } from "../middleware/auth.middleware.js";
import {
  createReferralCode,
  getReferralCodes,
  getReferralCode,
  updateReferralCode,
  deleteReferralCode,
} from "../controller/referralCode.controller.js";

const router = express.Router();

router.use(protect, isAdmin);

// router.get("/unread-count", protect, getUnreadCount);

router.post("/create-referral-code", createReferralCode);
router.get("/get-referral-codes", getReferralCodes);
router.get("/get-referral-code/:id", getReferralCode);
router.patch("/update-referral-code/:id", updateReferralCode);
router.delete("/delete-referral-code/:id", deleteReferralCode);  

export default router;
