import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { Chat } from "../model/chat.model.js";
import { User } from "../model/user.model.js";
import { io } from "../server.js";

/**
 * Initiate a call (audio or video)
 * POST /api/v1/call/initiate
 */
export const initiateCall = catchAsync(async (req, res) => {
  const callerId = req.user._id;
  const { chatId, receiverId, callType } = req.body; // callType: 'audio' or 'video'

  if (!chatId || !receiverId || !callType) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "chatId, receiverId, and callType are required"
    );
  }

  // Verify chat exists
  const chat = await Chat.findById(chatId);
  if (!chat) {
    throw new AppError(httpStatus.NOT_FOUND, "Chat not found");
  }

  // Verify both users are in chat
  const callerInChat = chat.participants.some(
    (p) => String(p) === String(callerId)
  );
  const receiverInChat = chat.participants.some(
    (p) => String(p) === String(receiverId)
  );

  if (!callerInChat || !receiverInChat) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Both users must be in the chat"
    );
  }

  // Get receiver info
  const receiver = await User.findById(receiverId);
  if (!receiver) {
    throw new AppError(httpStatus.NOT_FOUND, "Receiver not found");
  }

  // Emit socket event to receiver
  io.to(`chat_${receiverId}`).emit("call:incoming", {
    fromUserId: String(callerId),
    chatId: String(chatId),
    isVideo: callType === "video",
    callerName: req.user.fullName,
    callerAvatar: req.user.avatar?.url,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Call initiated",
    data: {
      chatId,
      receiverId,
      callType,
    },
  });
});

/**
 * End a call
 * POST /api/v1/call/end
 */
export const endCall = catchAsync(async (req, res) => {
  const { chatId, userId } = req.body;

  if (!chatId || !userId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "chatId and userId are required"
    );
  }

  // Emit socket event to other user
  io.to(`chat_${userId}`).emit("call:end", {
    chatId: String(chatId),
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Call ended",
  });
});