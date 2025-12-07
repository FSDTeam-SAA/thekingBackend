import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";
import {
  createOrGetChat,
  getMyChats,
  getChatMessages,
  sendMessage,
} from "../controller/chat.controller.js";

const router = express.Router();

// create / fetch a 1-1 chat
router.post("/", protect, createOrGetChat);

// my chats
router.get("/", protect, getMyChats);

// messages in a chat
router.get("/:chatId/messages", protect, getChatMessages);

// send message (supports attachments)
router.post(
  "/:chatId/messages",
  protect,
  upload.array("files", 10),
  sendMessage
);

export default router;
