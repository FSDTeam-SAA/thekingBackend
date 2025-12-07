import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { Chat } from "../model/chat.model.js";
import { Message } from "../model/message.model.js";
import { User } from "../model/user.model.js";
import { uploadOnCloudinary } from "../utils/commonMethod.js";
import { io } from "../server.js";           // <- from your server.js

// helper: ensure chat is doctor<->doctor or doctor<->patient
const validateChatRoles = (u1, u2) => {
  const roles = [u1.role, u2.role];          // e.g. ["doctor", "patient"]

  const hasDoctor = roles.includes("doctor");
  const allPatients = roles.every((r) => r === "patient");

  if (!hasDoctor || allPatients) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Chats must be doctor-doctor or doctor-patient"
    );
  }
};

/**
 * POST /chat
 * body: { userId: "<otherUserId>" }
 * return existing 1-1 chat or create a new one.
 */
export const createOrGetChat = catchAsync(async (req, res) => {
  const meId = req.user._id;
  const { userId } = req.body;

  if (!userId) {
    throw new AppError(httpStatus.BAD_REQUEST, "userId is required");
  }
  if (String(meId) === String(userId)) {
    throw new AppError(httpStatus.BAD_REQUEST, "You cannot chat with yourself");
  }

  const [me, other] = await Promise.all([
    User.findById(meId),
    User.findById(userId),
  ]);

  if (!other) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  validateChatRoles(me, other);

  // check if chat already exists (2-person chat)
  let chat = await Chat.findOne({
    participants: { $all: [meId, userId], $size: 2 },
    isGroup: false,
  })
    .populate("participants", "fullName avatar role")
    .populate("lastMessage");

  if (!chat) {
    chat = await Chat.create({
      participants: [meId, userId],
      isGroup: false,
    });

    chat = await chat
      .populate("participants", "fullName avatar role")
      .execPopulate?.(); // older Mongoose; if not, re-query

    if (!chat.participants) {
      // in case execPopulate is not available
      chat = await Chat.findById(chat._id)
        .populate("participants", "fullName avatar role")
        .populate("lastMessage");
    }
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Chat ready",
    data: chat,
  });
});

/**
 * GET /chat
 * Get all chats for current user
 */
export const getMyChats = catchAsync(async (req, res) => {
  const meId = req.user._id;

  const chats = await Chat.find({ participants: meId })
    .sort({ updatedAt: -1 })
    .populate("participants", "fullName avatar role")
    .populate({
      path: "lastMessage",
      populate: { path: "sender", select: "fullName avatar role" },
    })
    .lean();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Chats fetched",
    data: chats,
  });
});

/**
 * GET /chat/:chatId/messages?page=&limit=
 */
export const getChatMessages = catchAsync(async (req, res) => {
  const { chatId } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const meId = req.user._id;

  const chat = await Chat.findById(chatId);
  if (!chat) throw new AppError(httpStatus.NOT_FOUND, "Chat not found");
  if (!chat.participants.some((p) => String(p) === String(meId))) {
    throw new AppError(httpStatus.FORBIDDEN, "Not part of this chat");
  }

  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 20;

  const [messages, total] = await Promise.all([
    Message.find({ chatId })
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate("sender", "fullName avatar role")
      .lean(),
    Message.countDocuments({ chatId }),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Messages fetched",
    data: {
      items: messages.reverse(), // oldest -> newest for UI
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
      },
    },
  });
});

/**
 * POST /chat/:chatId/message
 * form-data:
 *  - content (optional if files)
 *  - files[] (images/videos/etc)
 */
export const sendMessage = catchAsync(async (req, res) => {
  const { chatId } = req.params;
  const meId = req.user._id;

  const chat = await Chat.findById(chatId).populate(
    "participants",
    "_id fullName"
  );
  if (!chat) throw new AppError(httpStatus.NOT_FOUND, "Chat not found");
  if (!chat.participants.some((p) => String(p._id) === String(meId))) {
    throw new AppError(httpStatus.FORBIDDEN, "Not part of this chat");
  }

  const { content, contentType = "text" } = req.body;

  const files = req.files?.files || []; // if you use upload.array("files")
  const attachments = [];

  for (const file of files) {
    const up = await uploadOnCloudinary(file.buffer, {
      folder: "docmobi/chat",
      resource_type: "auto",
    });

    attachments.push({
      name: file.originalname,
      type: contentType === "text" ? "file" : contentType,
      url: up.secure_url,
    });
  }

  if (!content && attachments.length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "Nothing to send");
  }

  const message = await Message.create({
    chatId,
    sender: meId,
    content,
    contentType: attachments.length ? contentType : "text",
    attachments,
    seenBy: [meId],
  });

  chat.lastMessage = message._id;
  await chat.save();

  const populatedMsg = await Message.findById(message._id)
    .populate("sender", "fullName avatar role")
    .lean();

  // ----- SOCKET PUSH -----
  // notify all participants
  for (const p of chat.participants) {
    io.to(`chat_${p._id}`).emit("chat:newMessage", {
      chatId,
      message: populatedMsg,
    });
  }

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Message sent",
    data: populatedMsg,
  });
});
