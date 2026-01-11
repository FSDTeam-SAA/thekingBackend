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

// ✅ Increased payload limit for base64 images
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cookieParser());

app.use("/public", express.static("public"));

// ✅ Request logger middleware (optional - for debugging)
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`);
  next();
});

app.use("/api/v1", router);

app.get("/", (req, res) => {
  res.send("Server is running...!!");
});

app.use(globalErrorHandler);
app.use(notFound);

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("🔌 A client connected:", socket.id);

  socket.on("joinChatRoom", (userId) => {
    if (userId) {
      socket.join(`chat_${userId}`);
      console.log(`👤 Client ${socket.id} joined user room: ${userId}`);
    }
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

  socket.on("call:request", ({ fromUserId, toUserId, chatId }) => {
    if (!toUserId) return;
    io.to(`chat_${toUserId}`).emit("call:incoming", {
      fromUserId,
      chatId,
    });
  });

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
    console.log("❌ Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log("═════════════════════════════════════════");
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log("═════════════════════════════════════════");

  try {
    await mongoose.connect(process.env.MONGO_DB_URL);
    console.log("✅ MongoDB connected successfully");
    console.log("═════════════════════════════════════════");
    console.log("📋 Available Routes:");
    console.log("   - /api/v1/auth");
    console.log("   - /api/v1/user");
    console.log("   - /api/v1/appointment");
    console.log("   - /api/v1/posts          ✅ (plural)");
    console.log("   - /api/v1/reels          ✅ (plural)");
    console.log("   - /api/v1/chat");
    console.log("   - /api/v1/notification");
    console.log("   - /api/v1/doctor-review");
    console.log("═════════════════════════════════════════");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
});

export default app;