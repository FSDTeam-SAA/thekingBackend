// utils/notify.js
import { Notification } from "../model/notification.model.js";

export const createNotification = async ({
  userId,
  fromUserId,
  type,
  title,
  content,
  appointmentId,
  meta,
}) => {
  if (!userId || !type || !title || !content) return;
  await Notification.create({
    userId,
    fromUserId,
    type,
    title,
    content,
    appointmentId,
    meta,
  });
};
