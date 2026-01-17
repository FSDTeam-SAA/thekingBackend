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

  // Verify chat exists or create one (since we are using Agora now, we might not have legacy Chats for everyone)
  let chat = await Chat.findById(chatId);

  if (!chat) {
    console.log(`🔍 Chat ID ${chatId} not found, searching by participants: ${callerId} & ${receiverId}`);
    // Try to find a 1v1 chat between these participants
    chat = await Chat.findOne({
      participants: { $all: [callerId, receiverId] },
      isGroupChat: false,
    });

    if (!chat) {
      console.log("🆕 No existing chat found, creating a new one for signaling persistence");
      chat = await Chat.create({
        participants: [callerId, receiverId],
        isGroupChat: false,
      });
    }
  }

  const actualChatId = chat._id;

  // Verify both users are in chat (redundant if we just created it, but good for security on existing)
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
    chatId: String(actualChatId),
    isVideo: callType === "video",
    callerName: req.user.fullName,
    callerAvatar: req.user.avatar?.url,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Call initiated",
    data: {
      chatId: actualChatId,
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

/**
 * Generate Agora Token
 * GET /api/v1/call/token?channelName=...
 */
export const getToken = catchAsync(async (req, res) => {
  const { channelName } = req.query;
  const uid = req.user.numericUid || 0;

  // Import dynamically to avoid top-level failures if package missing
  const { generateAgoraToken } = await import("../utils/agoraToken.js");

  if (!channelName) {
    throw new AppError(httpStatus.BAD_REQUEST, "channelName is required");
  }

  const token = generateAgoraToken(channelName, uid);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Token generated successfully",
    data: {
      token,
      channelName,
      uid,
    },
  });
});