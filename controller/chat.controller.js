import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { Chat } from "../model/chat.model.js";
import { Message } from "../model/message.model.js";
import { User } from "../model/user.model.js";
import { uploadOnCloudinary } from "../utils/commonMethod.js";
import { io } from "../server.js";
import { sendFCMNotificationToUsers } from "../utils/fcm.js";

// helper: ensure chat is doctor<->doctor or doctor<->patient
const validateChatRoles = (u1, u2) => {
  const roles = [u1.role, u2.role];
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
 * ✅ FIXED: isGroupChat instead of isGroup
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

  // ✅ FIXED: Check with isGroupChat: false (matching model field)
  let chat = await Chat.findOne({
    participants: { $all: [meId, userId], $size: 2 },
    isGroupChat: false, // ✅ Changed from isGroup to isGroupChat
  })
    .populate("participants", "fullName avatar role specialty experienceYears bio degrees")
    .populate({
      path: "lastMessage",
      populate: { path: "sender", select: "fullName avatar role" },
    });

  if (!chat) {

    chat = await Chat.create({
      participants: [meId, userId],
      isGroupChat: false, // ✅ Changed from isGroup to isGroupChat
    });

    // Re-fetch with populated fields
    chat = await Chat.findById(chat._id)
      .populate("participants", "fullName avatar role specialty experienceYears bio degrees")
      .populate({
        path: "lastMessage",
        populate: { path: "sender", select: "fullName avatar role" },
      });
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
 * Get all chats for current user with unread count
 * ✅ FIXED: Better sorting and deduplication
 */
export const getMyChats = catchAsync(async (req, res) => {
  const meId = req.user._id;

  const chats = await Chat.find({
    participants: meId,
    isGroupChat: false, // ✅ Only get 1-1 chats
  })
    .sort({ updatedAt: -1 })
    .populate("participants", "fullName avatar role specialty experienceYears bio degrees")
    .populate({
      path: "lastMessage",
      populate: { path: "sender", select: "fullName avatar role" },
    })
    .lean();

  // ✅ Remove any duplicate chats (same participants)
  const uniqueChats = [];
  const seenPairIds = new Set();

  for (const chat of chats) {
    // Create a unique key from participant IDs
    const participantIds = chat.participants
      .map(p => p._id.toString())
      .sort()
      .join('-');

    if (!seenPairIds.has(participantIds)) {
      seenPairIds.add(participantIds);

      // Calculate unread count
      const unreadCount = await Message.countDocuments({
        chatId: chat._id,
        sender: { $ne: meId },
        seenBy: { $ne: meId },
      });

      uniqueChats.push({
        ...chat,
        unreadCount,
      });
    }
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Chats fetched",
    data: uniqueChats,
  });
});

/**
 * GET /chat/:chatId/messages?page=&limit=
 */
export const getChatMessages = catchAsync(async (req, res) => {
  const { chatId } = req.params;
  const { page = 1, limit = 50 } = req.query;
  const meId = req.user._id;

  const chat = await Chat.findById(chatId);
  if (!chat) throw new AppError(httpStatus.NOT_FOUND, "Chat not found");
  if (!chat.participants.some((p) => String(p) === String(meId))) {
    throw new AppError(httpStatus.FORBIDDEN, "Not part of this chat");
  }

  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 50;

  const [messages, total] = await Promise.all([
    Message.find({ chatId })
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate("sender", "fullName avatar role")
      .lean(),
    Message.countDocuments({ chatId }),
  ]);

  // Mark messages as seen
  await Message.updateMany(
    {
      chatId,
      sender: { $ne: meId },
      seenBy: { $ne: meId },
    },
    {
      $addToSet: { seenBy: meId },
    }
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Messages fetched",
    data: {
      items: messages.reverse(),
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
 * ✅ FIXED: Properly handle file attachments with correct field name
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

  const files = req.files?.files || req.files || [];
  const fileUrls = []; // ✅ Changed from attachments to fileUrls

  // ✅ Upload files to cloudinary
  for (const file of files) {
    try {
      const up = await uploadOnCloudinary(file.buffer, {
        folder: "docmobi/chat",
        resource_type: "auto",
        filename: file.originalname,
      });

      fileUrls.push({
        name: file.originalname,
        url: up.secure_url,
        content: file.mimetype,
      });
    } catch (error) {
      new AppError(httpStatus.INTERNAL_SERVER_ERROR, "File upload failed");
    }
  }

  if (!content && fileUrls.length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "Nothing to send");
  }

  // ✅ Determine content type based on files
  let finalContentType = contentType;
  if (fileUrls.length > 0) {
    const firstFile = fileUrls[0];
    if (firstFile.content?.startsWith('image/')) {
      finalContentType = 'image';
    } else if (firstFile.content?.startsWith('video/')) {
      finalContentType = 'video';
    } else {
      finalContentType = 'file';
    }
  }

  const message = await Message.create({
    chatId,
    sender: meId,
    content: content || '',
    contentType: finalContentType,
    fileUrl: fileUrls, // ✅ Changed from attachments to fileUrl
    seenBy: [meId],
  });

  chat.lastMessage = message._id;
  await chat.save();

  const populatedMsg = await Message.findById(message._id)
    .populate("sender", "fullName avatar role")
    .lean();

  // Socket notification to all participants
  for (const p of chat.participants) {
    if (String(p._id) !== String(meId)) {
      // Don't send socket event to self if not needed, but usually we do for multi-device sync
      // Actually, existing code sent to all, that's fine.
    }
    io.to(`chat_${p._id}`).emit("message:new", {
      chatId,
      message: populatedMsg,
    });
  }

  // ✅ Send FCM Push Notification to recipients (exclude sender)
  const recipientIds = chat.participants
    .map((p) => String(p._id))
    .filter((id) => id !== String(meId));

  if (recipientIds.length > 0) {
    const senderName = populatedMsg.sender.fullName;
    const notificationBody =
      finalContentType === "text"
        ? (content.length > 100 ? content.substring(0, 97) + "..." : content)
        : `Sent a ${finalContentType}`;

    // Fire and forget - don't await blocking response


        sendFCMNotificationToUsers(
      recipientIds,
      {
        title: senderName,
        body: notificationBody,
      },
      {
        type: "chat",
        chatId: String(chatId),        // String
        otherUserId: String(meId),     // Sender ID
        userName: senderName,          // Chat screen
        userAvatar: populatedMsg.sender.avatar?.url || "", 
        clickAction: "FLUTTER_NOTIFICATION_CLICK",
      },
      User
    ).catch((err) =>
      console.error("❌ Failed to send chat notification:", err)
    );



    // sendFCMNotificationToUsers(
    //   recipientIds,
    //   {
    //     title: senderName,
    //     body: notificationBody,
    //   },
    //   {
    //     type: "chat",
    //     chatId: chatId,
    //     senderId: String(meId),
    //     clickAction: "FLUTTER_NOTIFICATION_CLICK",
    //   },
    //   User
    // ).catch((err) =>
    //   console.error("❌ Failed to send chat notification:", err)
    // );


  }

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Message sent",
    data: populatedMsg,
  });
});

/**
 * GET /chat/token
 * Generate Agora Chat Token for current user
 */
export const getChatToken = catchAsync(async (req, res) => {
  const meId = req.user._id;
  const { generateAgoraChatToken } = await import("../utils/agoraChatToken.js");

  const token = generateAgoraChatToken(String(meId));

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Agora Chat Token generated",
    data: {
      token,
      userId: String(meId),
    },
  });
});

/**
 * PATCH /chat/:chatId/read
 * Mark all messages in a chat as read
 */
export const markChatAsRead = catchAsync(async (req, res) => {
  const { chatId } = req.params;
  const meId = req.user._id;

  const chat = await Chat.findById(chatId);
  if (!chat) throw new AppError(httpStatus.NOT_FOUND, "Chat not found");
  if (!chat.participants.some((p) => String(p) === String(meId))) {
    throw new AppError(httpStatus.FORBIDDEN, "Not part of this chat");
  }

  // Mark all messages as seen
  await Message.updateMany(
    {
      chatId,
      sender: { $ne: meId },
      seenBy: { $ne: meId },
    },
    {
      $addToSet: { seenBy: meId },
    }
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Chat marked as read",
  });
});