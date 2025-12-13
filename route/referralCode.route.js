import express from "express";
import { protect, isAdmin } from "../middleware/auth.middleware.js";
import {
  createReferralCode,
  getReferralCodes,
  getReferralCode,
  updateReferralCode,
  updateReferralCodeStatus,
  deleteReferralCode,
} from "../controller/referralCode.controller.js";

const router = express.Router();

router.use(protect, isAdmin);

router.route("/")
  .post(createReferralCode)
  .get(getReferralCodes);

router.route("/:id")
  .get(getReferralCode)
  .patch(updateReferralCode)
  .delete(deleteReferralCode);

router.patch("/:id/status", updateReferralCodeStatus);

export default router;
