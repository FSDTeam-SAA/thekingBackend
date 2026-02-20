import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { Chat } from "../model/chat.model.js";
import { User } from "../model/user.model.js";
import { io } from "../server.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Initiate a call (audio or video)
 * POST /api/v1/call/initiate
 */
export const initiateCall = catchAsync(async (req, res) => {
  const callerId = req.user._id;
  const { chatId, receiverId, isVideo } = req.body;

  // ✅ Support both 'isVideo' (frontend sends this) and 'callType' (old format)
  const callType = req.body.callType || (isVideo ? "video" : "audio");

  if (!chatId || !receiverId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "chatId and receiverId are required"
    );
  }

  // Find or create chat
  let chat = await Chat.findById(chatId);
  if (!chat) {
    chat = await Chat.findOne({
      participants: { $all: [callerId, receiverId] },
      isGroupChat: false,
    });
    if (!chat) {
      chat = await Chat.create({
        participants: [callerId, receiverId],
        isGroupChat: false,
      });
    }
  }

  const actualChatId = chat._id;

  // Verify participants
  const callerInChat = chat.participants.some(
    (p) => String(p) === String(callerId)
  );
  const receiverInChat = chat.participants.some(
    (p) => String(p) === String(receiverId)
  );

  if (!callerInChat || !receiverInChat) {
    throw new AppError(httpStatus.FORBIDDEN, "Both users must be in the chat");
  }

  // Get receiver
  const receiver = await User.findById(receiverId);
  if (!receiver) {
    throw new AppError(httpStatus.NOT_FOUND, "Receiver not found");
  }

  // ✅ ONE UUID for both socket + FCM — prevents double CallKit UI
  const callUuid = uuidv4();
  const callTimestamp = new Date().toISOString();

  const callPayload = {
    fromUserId: String(callerId),
    chatId: String(actualChatId),
    isVideo: callType === "video",
    callerName: req.user.fullName,
    callerAvatar: req.user.avatar?.url || "",
    uuid: callUuid,
    timestamp: callTimestamp,
  };

  // ✅ server.js এ joinUserRoom করলে room হয় chat_${userId}
  // আর connection query তে userId দিলে room হয় ${userId}
  // দুটোতেই emit করি যাতে কোনো mismatch না হয়
  io.to(`chat_${receiverId}`).emit("call:incoming", callPayload);
  io.to(String(receiverId)).emit("call:incoming", callPayload);

  console.log(`📞 Call emitted to receiver rooms: chat_${receiverId} & ${receiverId}`);
  console.log(`   UUID: ${callUuid} | Type: ${callType}`);

  // ✅ Send FCM with same UUID (background / terminated state)
  try {
    const activeTokens = (receiver.fcmTokens || [])
      .filter((t) => t.isActive)
      .map((t) => t.token);

    if (activeTokens.length > 0) {
      const { sendCallNotification } = await import("../utils/fcm.js");
      await sendCallNotification(activeTokens, {
        callerId: String(callerId),
        callerName: req.user.fullName,
        callerAvatar: req.user.avatar?.url || "",
        chatId: String(actualChatId),
        callType: callType,
        uuid: callUuid,        // ✅ Same UUID — no double CallKit
        timestamp: callTimestamp,
      });
      console.log(`✅ Call FCM sent to ${activeTokens.length} device(s)`);
    } else {
      console.log("⚠️ Receiver has no active FCM tokens");
    }
  } catch (fcmError) {
    console.error("❌ FCM call notification failed:", fcmError);
    // Don't throw — socket already delivered
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Call initiated",
    data: {
      chatId: actualChatId,
      receiverId,
      callType,
      uuid: callUuid,
    },
  });
});

/**
 * End a call
 * POST /api/v1/call/end
 */
export const endCall = catchAsync(async (req, res) => {
  const { chatId, userId, uuid } = req.body;

  if (!chatId || !userId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "chatId and userId are required"
    );
  }

  const endPayload = {
    chatId: String(chatId),
    timestamp: new Date().toISOString(),
  };

  // ✅ Both room names + both event names for full compatibility
  io.to(`chat_${userId}`).emit("call:ended", endPayload);
  io.to(`chat_${userId}`).emit("call:end", endPayload);
  io.to(String(userId)).emit("call:ended", endPayload);
  io.to(String(userId)).emit("call:end", endPayload);

  console.log(`📴 Call end emitted to: chat_${userId} & ${userId}`);

  // ✅ Send FCM cancel (background / terminated state)
  try {
    const receiver = await User.findById(userId);
    const activeTokens = (receiver?.fcmTokens || [])
      .filter((t) => t.isActive)
      .map((t) => t.token);

    if (activeTokens.length > 0) {
      const { sendCallCancelNotification } = await import("../utils/fcm.js");
      await sendCallCancelNotification(activeTokens, { chatId: String(chatId), uuid: uuid || '' });
      console.log(`📴 Call cancel FCM sent to ${activeTokens.length} device(s) (UUID: ${uuid || 'none'})`);
    }
  } catch (error) {
    console.error("❌ FCM cancel notification failed:", error);
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Call ended",
  });
});

/**
 * Accept a call (Signal via API if socket is slow)
 * POST /api/v1/call/accept
 */
export const acceptCall = catchAsync(async (req, res) => {
  const { chatId, fromUserId } = req.body; // fromUserId is the CALLER's ID
  const receiverId = req.user._id;

  if (!chatId || !fromUserId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "chatId and fromUserId are required"
    );
  }

  const acceptPayload = {
    chatId: String(chatId),
    fromUserId: String(fromUserId), // The one who CALLED
    timestamp: new Date().toISOString(),
  };

  // ✅ FIX: Emit 'call:accepted' (NOT 'call:accept') — caller's call screen listens for 'call:accepted'
  // Previously emitted 'call:accept' which the Flutter client never received
  io.to(String(fromUserId)).emit("call:accepted", {
    chatId: String(chatId),
    fromUserId: String(receiverId), // The one who ACCEPTED (me)
  });

  io.to(`chat_${fromUserId}`).emit("call:accepted", {
    chatId: String(chatId),
    fromUserId: String(receiverId),
  });

  console.log(`📞 Call ACCEPTED via API by ${receiverId}`);
  console.log(`   Signal sent to caller: ${fromUserId}`);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Call accepted signal sent",
  });
});

/**
 * Generate Agora Token
 * GET /api/v1/call/token?channelName=...
 */
export const getToken = catchAsync(async (req, res) => {
  const { channelName } = req.query;
  const uid = req.user.numericUid || 0;

  const { generateAgoraToken } = await import("../utils/agoraToken.js");

  if (!channelName) {
    throw new AppError(httpStatus.BAD_REQUEST, "channelName is required");
  }

  const token = generateAgoraToken(channelName, uid);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Token generated successfully",
    data: { token, channelName, uid },
  });
});