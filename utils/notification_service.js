import admin from 'firebase-admin';
import apn from 'apn';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Firebase Admin initialization
let firebaseApp = null;
let apnProvider = null;
const moduleDir = path.dirname(new URL(import.meta.url).pathname);

const getFirebaseCredential = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      return admin.credential.cert(serviceAccount);
    } catch (error) {
      console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', error);
    }
  }

  if (process.env.FIREBASE_PROJECT_ID) {
    return admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    });
  }

  return null;
};

/**
 * Initialize All Notification Providers
 */
export const initializeNotifications = () => {
  // 1. Initialize Firebase
  if (!admin.apps.length) {
    const firebaseCredential = getFirebaseCredential();
    if (firebaseCredential) {
      admin.initializeApp({
        credential: firebaseCredential,
      });
      console.log('✅ Firebase Admin SDK initialized');
    } else {
      console.warn('⚠️ Firebase Admin SDK not initialized: missing Firebase credentials');
    }
  }

  // 2. Initialize Direct APNs (.p12 Hybrid Approach)
  if (!apnProvider) {
    const rawCertPath =
      process.env.APNS_VOIP_CERT_PATH || '/Users/Yeasin/Downloads/voip_auth.p12';
    const candidatePaths = path.isAbsolute(rawCertPath)
      ? [rawCertPath]
      : [
          path.resolve(process.cwd(), rawCertPath),
          path.resolve(moduleDir, '..', rawCertPath),
        ];
    const certPath = candidatePaths.find((candidate) => fs.existsSync(candidate));

    if (!certPath) {
      console.error(
        `❌ APNs VoIP certificate not found. Checked: ${candidatePaths.join(', ')}`,
      );
      return;
    }
    
    const options = {
      pfx: certPath,
      passphrase: process.env.APNS_VOIP_PASSPHRASE || '',
      production: process.env.NODE_ENV === 'production',
    };

    try {
      apnProvider = new apn.Provider(options);
      console.log('✅ Direct APNs Provider initialized using .p12');
    } catch (error) {
      console.error('❌ Direct APNs initialization error:', error);
    }
  }
};

/**
 * 📞 Send Call Notification (Hybrid Approach)
 * - Android: Node.js -> Firebase -> Android
 * - iOS: Node.js -> Direct APNs -> iOS (CallKit)
 */
export const sendCallNotification = async (receiver, callData) => {
  const { callerName, callType = 'audio' } = callData;
  const callUuid = callData.uuid || uuidv4();
  const normalizedPayload = {
    ...callData,
    id: callUuid,
    uuid: callUuid,
    type: 'incoming_call',
    callerName,
    nameCaller: callerName,
    handle: callType === 'video' ? 'Video Call' : 'Audio Call',
    isVideo: callType === 'video',
    timestamp: callData.timestamp || new Date().toISOString(),
  };

  // 1. iOS PATHWAY (Direct to Apple)
  if (receiver.devicePlatform === 'ios' && receiver.voipToken && apnProvider) {
    try {
      const notification = new apn.Notification();
      notification.expiry = Math.floor(Date.now() / 1000) + 30; // 30 SECONDS! Prevent old calls from ringing.
      notification.priority = 10;
      notification.pushType = 'voip';
      notification.topic = `${process.env.IOS_BUNDLE_ID}.voip`;
      notification.contentAvailable = 1;
      notification.mutableContent = 1;
      notification.payload = normalizedPayload;

      // For VoIP pushes (PushKit), Apple strictly forbids standard 'alert', 'sound', or 'badge' keys.
      // The push must be entirely silent and handled natively via CallKit.
      // notification.alert = ... (REMOVED to prevent Apple rejection)

      const result = await apnProvider.send(notification, receiver.voipToken);
      console.log('📱 Direct APNs Call Result:', result.sent.length ? 'Sent' : 'Failed');
      return { success: result.sent.length > 0, path: 'apns' };
    } catch (error) {
      console.error('❌ APNs sending error:', error);
    }
  }

  // 2. ANDROID / FALLBACK PATHWAY (Firebase)
  if (receiver.fcmToken) {
    try {
      const message = {
        data: {
          ...Object.fromEntries(
            Object.entries(normalizedPayload).map(([k, v]) => [k, String(v)])
          ),
          callType: String(callType),
        },
        android: { priority: 'high', ttl: 30000 }, // 30 seconds
        apns: {
          headers: {
            'apns-expiration': String(Math.floor(Date.now() / 1000) + 30), // Prevent stale FCM delivery to iOS
            'apns-priority': '10',
          },
        },
        token: receiver.fcmToken,
      };

      const response = await admin.messaging().send(message);
      console.log('📱 Firebase Call Result: Sent', response);
      return { success: true, path: 'firebase' };
    } catch (error) {
      console.error('❌ Firebase sending error:', error);
    }
  }

  return { success: false, message: 'No valid tokens found' };
};

/**
 * 💬 Send Standard Notification (Firebase for All)
 */
export const sendStandardNotification = async (token, notification, data = {}) => {
  if (!token) return;

  const message = {
    notification: {
      title: notification.title,
      body: notification.body,
    },
    data: {
      ...data,
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    },
    token: token,
  };

  try {
    await admin.messaging().send(message);
    return { success: true };
  } catch (error) {
    console.error('❌ Firebase Standard Notification Error:', error);
    return { success: false, error: error.message };
  }
};
/**
 * 📴 Send Call Cancel/End Notification
 */
export const sendCallCancelNotification = async (receiver, data) => {
  const { chatId, uuid } = data;

  // 1. iOS PATHWAY (Direct APNs)
  if (receiver.devicePlatform === 'ios' && receiver.voipToken && apnProvider) {
    try {
      const notification = new apn.Notification();
      notification.pushType = 'voip';
      notification.topic = `${process.env.IOS_BUNDLE_ID}.voip`;
      notification.priority = 10;
      notification.contentAvailable = 1;
      notification.payload = {
        type: 'cancel_call',
        chatId: String(chatId),
        uuid: String(uuid || ''),
      };
      
      await apnProvider.send(notification, receiver.voipToken);
    } catch (error) {
      console.error('❌ APNs Cancel Error:', error);
    }
  }

  // 2. ANDROID / FALLBACK (Firebase)
  if (receiver.fcmToken) {
    try {
      const message = {
        data: {
          type: 'cancel_call',
          chatId: String(chatId),
          uuid: String(uuid || ''),
        },
        token: receiver.fcmToken,
      };
      await admin.messaging().send(message);
    } catch (error) {
      console.error('❌ Firebase Cancel Error:', error);
    }
  }
};
