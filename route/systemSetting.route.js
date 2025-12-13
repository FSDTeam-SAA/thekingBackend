import express from "express";
import { protect, isAdmin } from "../middleware/auth.middleware.js";
import {
  getReferralRequirementSetting,
  updateReferralRequirementSetting,
} from "../controller/systemSetting.controller.js";

const router = express.Router();

router.use(protect, isAdmin);

router
  .route("/referral-code-requirement")
  .get(getReferralRequirementSetting)
  .patch(updateReferralRequirementSetting);

export default router;
