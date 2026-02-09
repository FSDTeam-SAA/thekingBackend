import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import router from "./mainroute/index.js";
import { createServer } from "http";
import { Server } from "socket.io";
import chalk from "chalk";
import morgan from "morgan";

import globalErrorHandler from "./middleware/globalErrorHandler.js";
import notFound from "./middleware/notFound.js";
import { serverRunningTemplate } from "./template/serverRunning.template.js";
import { rateLimiter } from "./middleware/rateLimiter.js";

const app = express();

app.use(morgan("dev"));

app.set("trust proxy", 1);

const server = createServer(app);
export const io = new Server(server, {
  cors: {
    origin: ["https://admin.docmobidz.com", "http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  },
});

app.use(
  cors({
    credentials: true,
    origin: ["https://admin.docmobidz.com", "http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  }),
);

// Increased payload limit for base64 images
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
// app.use(rateLimiter(200));
app.use(cookieParser());

app.use("/public", express.static("public"));

// // Request logger middleware (optional - for debugging)
// app.use((req, res, next) => {
//   console.log(`📥 ${req.method} ${req.path}`);
//   next();
// });
app.use("/api/v1", router);

app.get("/", serverRunningTemplate);

app.use(globalErrorHandler);
app.use(notFound);

//  connect to MongoDB and start the server

const mongoConnect = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_DB_URL);
    console.log("------------------------------------");
    console.log(
      chalk.yellow.bold(
        "MongoDB connected successfully:",
        conn.connection.host,
      ),
    );
  } catch (err) {
    console.error(chalk.red.bold("MongoDB connection error:", err));
    process.exit(1);
  }
};
await mongoConnect().then(() => {
  const PORT = process.env.PORT || 5000;
  try {
    server.listen(PORT, () => {
      console.log(
        chalk.green.bold(`Server is running on http://localhost:${PORT}  `),
      );
    });
  } catch (error) {
    console.error(chalk.red.bold("Server error:", error));
    process.exit(1);
  }
});
// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("🔌 A client connected:", socket.id);
  const userId = socket.handshake.query.userId;
  if (userId) {
    socket.join(userId);
    console.log(`👤 joined user room: ${userId}`);
  }

  socket.on("joinUserRoom", (userId) => {
    if (userId) {
      socket.join(`chat_${userId}`);
      console.log(
        `👤 Client ${socket.id} joined user signaling room: ${userId}`,
      );
    }
  });

  socket.on("joinChatRoom", (userId) => {
    if (userId) {
      socket.join(`chat_${userId}`);
      console.log(`👤 Client ${socket.id} joined legacy chat room: ${userId}`);
    }
  });

  // ✅ NEW: Real-time Chat Presence (Online/Offline in Chat)
  socket.on("chat:join", ({ chatId, userId }) => {
    if (!chatId || !userId) return;

    const roomName = `conversation_${chatId}`;
    socket.join(roomName);

    // Store joined rooms for disconnect handling
    if (!socket.chatRooms) socket.chatRooms = new Set();
    socket.chatRooms.add(roomName);

    // Notify others in this chat that I am online
    socket.to(roomName).emit("user:online", { userId, chatId });

    console.log(`🟢 User ${userId} joined chat ${chatId} (Online)`);

    // Optional: Send list of online users in this room to the joiner
    const clients = io.sockets.adapter.rooms.get(roomName);
    if (clients) {
      // This part is tricky without mapping socketId -> userId globally, 
      // but for 1-1 chat, if someone else is there, they are online.
      if (clients.size > 1) {
        socket.emit("user:online", { count: clients.size });
      }
    }
  });

  socket.on("chat:leave", ({ chatId, userId }) => {
    if (!chatId || !userId) return;

    const roomName = `conversation_${chatId}`;
    socket.leave(roomName);

    if (socket.chatRooms) socket.chatRooms.delete(roomName);

    // Notify others
    socket.to(roomName).emit("user:offline", { userId, chatId });
    console.log(`🔴 User ${userId} left chat ${chatId} (Offline)`);
  });

  socket.on("joinAlerts", () => {
    socket.join("alerts");
    console.log(`🔔 Client ${socket.id} joined alerts room`);
  });

  socket.on("chat:typing", ({ toUserId, chatId }) => {
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("chat:typing", { chatId });
  });

  socket.on("chat:stopTyping", ({ toUserId, chatId }) => {
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("chat:stopTyping", { chatId });
  });

  socket.on("call:request", ({ fromUserId, toUserId, chatId, isVideo }) => {
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("call:incoming", {
      fromUserId,
      chatId,
      isVideo: isVideo ?? true, // Default to video if not specified
    });
  });

  socket.on("call:offer", (data) => {
    const { toUserId } = data;
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("call:offer", data);
  });

  socket.on("call:answer", (data) => {
    const { toUserId } = data;
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("call:answer", data);
  });

  socket.on("call:iceCandidate", (data) => {
    const { toUserId } = data;
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("call:iceCandidate", data);
  });

  socket.on("call:media_update", (data) => {
    const { toUserId } = data;
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("call:media_update", data);
  });

  socket.on("call:switch_request", (data) => {
    const { toUserId } = data;
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("call:switch_request", data);
  });

  socket.on("call:switch_response", (data) => {
    const { toUserId } = data;
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("call:switch_response", data);
  });

  socket.on("call:end", ({ toUserId, chatId }) => {
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("call:ended", { chatId });
  });

  socket.on("call:reject", ({ toUserId, chatId }) => {
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("call:rejected", { chatId });
    console.log(`❌ Call rejected in chat: ${chatId} for user: ${toUserId}`);
  });

  socket.on("call:accept", ({ fromUserId, chatId }) => {
    if (!fromUserId) return;
    io.to(`chat_${fromUserId}`).emit("call:accepted", { chatId });
    console.log(`✅ Call accepted in chat: ${chatId} by user: ${fromUserId}`);
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);

    // ✅ Notify all joined chat rooms that user is offline
    if (socket.chatRooms) {
      // We need userId for this. It was passed in handshake query, or we can store it on socket
      const userId = socket.handshake.query.userId;
      if (userId) {
        socket.chatRooms.forEach(roomName => {
          // roomName is conversation_CHATID
          // extract chatID? Or just emit generic offline
          const chatId = roomName.replace('conversation_', '');
          socket.to(roomName).emit("user:offline", { userId, chatId });
          console.log(`🔴 User ${userId} disconnected from chat ${chatId}`);
        });
      }
    }
  });
});

export default app;
