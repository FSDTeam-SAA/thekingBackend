import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import router from "./mainroute/index.js";
import { createServer } from "http";
import { Server } from "socket.io";
import chalk from "chalk";

import globalErrorHandler from "./middleware/globalErrorHandler.js";
import notFound from "./middleware/notFound.js";

const app = express();

app.set("trust proxy", true);

const server = createServer(app);
export const io = new Server(server, {
  cors: {
    origin: ["*"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  },
});

app.use(
  cors({
    credentials: true,
    origin: ["*"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  }),
);

// ✅ Increased payload limit for base64 images
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
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
      console.log(chalk.green.bold(`Server is running on http://localhost:${PORT}  `));
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
  });
});

export default app;
