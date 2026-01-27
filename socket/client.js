import { io as socketIoClient, Socket } from "socket.io-client";

const SERVER_URL = "http://localhost:5000";
const USER_ID = "6947249c686615dc352744b2"; // Example user ID

const socket = socketIoClient(SERVER_URL, {
  query: { userId: USER_ID },
});

socket.on("connect", () => {
  console.log("Connected to server:", socket.id);
});

socket.on("notification:newDoctor", (notification) => {
  //   type: "doctor_signup",
  //   title: "New Doctor Registered",
  //   content: `A new doctor, Dr. ${newUser.fullName}, specialized in ${newUser.specialty} has joined our platform.`,
  //   meta: {
  //     doctorId: newUser._id,
  //     doctorName: newUser.fullName,
  //     specialty: newUser.specialty,
  //   },
  console.log("   Content:", notification.content);
});

socket.on("like_post_notification", (notification) => {
  console.log("🔔 New Like Post Notification Received:");
  console.log("   Content:", notification.content);
});

socket.on("post_comment_notification", (notification) => {
  console.log("🔔 New Comment Post Notification Received:");
  console.log("   Content:", notification.content);
});

socket.on("reel_comment_notification", (notification) => {
  console.log("🔔 New Reel Comment Notification Received:");
  console.log("   Content:", notification.content);
});

socket.on("reel_like_notification", (notification) => {
  console.log("🔔 New Reel Like Notification Received:");
  console.log("   Content:", notification.content);
});

socket.on("disconnect", () => {
  console.log("❌ Disconnected from server");
});
