import express from "express";
import {
    getAppSetting,
  toggleReferralSystem,
} from "../controller/appSeeting.controller.js";

const router = express.Router();

router.patch("/toggle-referral-system", toggleReferralSystem);
router.get("/get-referral-setting", getAppSetting);

export default router;
