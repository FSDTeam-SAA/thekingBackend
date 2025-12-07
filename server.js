import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import router from "./mainroute/index.js";
import { createServer } from "http";
import { Server } from "socket.io";

import globalErrorHandler from "./middleware/globalErrorHandler.js";
import notFound from "./middleware/notFound.js";

const app = express();

app.set("trust proxy", true);

const server = createServer(app);
export const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  },
});

app.use(
  cors({
    credentials: true,
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/public", express.static("public"));

// Mount the main router
app.use("/api/v1", router);

// Basic route for testing
app.get("/", (req, res) => {
  res.send("Server is running...!!");
});

app.use(globalErrorHandler);
app.use(notFound);

/**
 * SOCKET.IO
 *  - joinChatRoom(userId): join personal room for chat/alerts
 *  - joinAlerts(): global alerts room
 *  - chat:typing / chat:stopTyping
 *  - call:* events: signaling for WebRTC video calls
 */
io.on("connection", (socket) => {
  console.log("A client connected:", socket.id);

  // each user joins a private room by their userId
  socket.on("joinChatRoom", (userId) => {
    if (userId) {
      socket.join(`chat_${userId}`);
      console.log(`Client ${socket.id} joined user room: ${userId}`);
    }
  });

  // optional: a global alerts room (for admin / system notifications)
  socket.on("joinAlerts", () => {
    socket.join("alerts");
    console.log(`Client ${socket.id} joined alerts room`);
  });

  // ----- TYPING INDICATOR -----
  socket.on("chat:typing", ({ toUserId, chatId }) => {
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("chat:typing", { chatId });
  });

  socket.on("chat:stopTyping", ({ toUserId, chatId }) => {
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("chat:stopTyping", { chatId });
  });

  // ----- VIDEO CALL SIGNALING -----
  // someone presses the call button
  socket.on("call:request", ({ fromUserId, toUserId, chatId }) => {
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("call:incoming", {
      fromUserId,
      chatId,
    });
  });

  // WebRTC offer/answer exchange
  socket.on("call:offer", ({ toUserId, chatId, offer }) => {
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("call:offer", { chatId, offer });
  });

  socket.on("call:answer", ({ toUserId, chatId, answer }) => {
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("call:answer", { chatId, answer });
  });

  socket.on("call:iceCandidate", ({ toUserId, chatId, candidate }) => {
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("call:iceCandidate", {
      chatId,
      candidate,
    });
  });

  socket.on("call:end", ({ toUserId, chatId }) => {
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("call:end", { chatId });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);

  try {
    await mongoose.connect(process.env.MONGO_DB_URL);
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
});
