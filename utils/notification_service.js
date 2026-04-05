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
    const rawCertPath = process.env.APNS_VOIP_CERT_PATH || 'voip_auth.p12';
    
    // Check various paths for the certificate (including the one in utils and project root)
    const candidatePaths = [
      rawCertPath,
      path.resolve(process.cwd(), rawCertPath),
      path.resolve(moduleDir, rawCertPath),
      path.resolve(moduleDir, '..', rawCertPath),
      path.resolve(moduleDir, 'voip_auth.p12'),
      path.resolve(process.cwd(), 'thekingBackend/utils', 'voip_auth.p12')
    ];
    
    const certPath = candidatePaths.find((candidate) => candidate && fs.existsSync(candidate));

    if (certPath) {
      try {
        const isProduction = process.env.APNS_PRODUCTION === 'true' || process.env.NODE_ENV === 'production';
        apnProvider = new apn.Provider({
          pfx: certPath,
          passphrase: process.env.APNS_VOIP_PASSPHRASE || '',
          production: isProduction,
        });
        console.log(`✅ Direct APNs Provider initialized using: ${certPath} | Mode: ${isProduction ? 'Production' : 'Sandbox (Development)'}`);
      } catch (error) {
        if (error.message.includes('Unsupported PKCS12')) {
          console.error('❌ CRITICAL APNs ERROR: Unsupported PKCS12 PFX data.');
          console.error('👉 FIX: Your .p12 certificate encoding is not supported by this Node.js version.');
          console.error('👉 RUN this command on your Mac to convert it:');
          console.error('   openssl pkcs12 -in voip_auth.p12 -nodes -out voip_auth_new.p12 -legacy');
          console.error('👉 Then upload "voip_auth_new.p12" and update your .env file.');
        } else {
          console.error('❌ Direct APNs initialization error:', error);
        }
      }
    } else {
      console.warn('⚠️ APNs VoIP certificate not found. Calls to iOS may fail when app is closed.');
    }
  }
};

/**
 * 📞 Send Call Notification (Hybrid & Multi-Device Approach)
 * - iOS: Direct APNs (VoIP) to all registered iOS devices.
 * - Android: Firebase to all registered Android devices.
 */
export const sendCallNotification = async (receiver, callData) => {
  const { callerName, callType = 'audio' } = callData;
  const callUuid = callData.uuid || uuidv4();
  const normalizedPayload = {
    ...callData,
    id: callUuid,
    uuid: callUuid,
    type: 'incoming_call',
    callerId: callData.callerId, // Keep for legacy
    fromUserId: callData.callerId, // Added for consistency with Socket/Frontend
    callerName,
    nameCaller: callerName,
    handle: callType === 'video' ? 'Video Call' : 'Audio Call',
    isVideo: callType === 'video',
    timestamp: callData.timestamp || new Date().toISOString(),
  };

  const results = [];

  // Identify all target tokens (Modern & Legacy)
  const iosVoipTokens = new Set();
  const androidFcmTokens = new Set();
  const iosFcmTokens = new Set(); // For fallback standard pushes

  if (receiver.devices && Array.isArray(receiver.devices)) {
    receiver.devices.forEach(d => {
      if (!d.isActive) return;
      if (d.platform === 'ios') {
        if (d.voipToken) iosVoipTokens.add(d.voipToken);
        if (d.fcmToken) iosFcmTokens.add(d.fcmToken);
      } else {
        if (d.fcmToken) androidFcmTokens.add(d.fcmToken);
      }
    });
  }

  // Legacy fallback
  if (receiver.devicePlatform === 'ios' && receiver.voipToken) iosVoipTokens.add(receiver.voipToken);
  if (receiver.devicePlatform === 'ios' && receiver.fcmToken) iosFcmTokens.add(receiver.fcmToken);
  if (receiver.devicePlatform === 'android' && receiver.fcmToken) androidFcmTokens.add(receiver.fcmToken);
  if (!receiver.devicePlatform && receiver.fcmToken) androidFcmTokens.add(receiver.fcmToken);

  // 1. Send Direct APNs to all iOS VoIP Tokens
  if (apnProvider && iosVoipTokens.size > 0) {
    for (const token of iosVoipTokens) {
      try {
        const notification = new apn.Notification();
        notification.expiry = Math.floor(Date.now() / 1000) + 30;
        notification.priority = 10;
        notification.pushType = 'voip';
        const response = await apnProvider.send(notification, token);
        if (response.failed.length > 0) {
          const failure = response.failed[0];
          const reason = failure.response?.reason || failure.error?.message;
          console.error(`❌ APNs send FAILED for device ${receiver._id}: ${reason}`);
          
          if (reason === 'BadDeviceToken' || reason === 'Unregistered') {
            console.warn(`👉 IMPORTANT: ${reason} detected. This specific device token is invalid for the current Production gateway.`);
            console.warn('👉 FIX: The user MUST LOGOUT and LOGIN again in the TestFlight app to refresh a valid Production VoIP Token.');
            console.warn('👉 Without a valid Production token, Calls will NOT ring in Background/Terminated state.');
          }
          results.push({ path: 'apns', success: false, error: reason });
        } else {
          console.log(`📱 Direct APNs Call sent successfully to device for ${receiver._id}`);
          results.push({ path: 'apns', success: true });
        }
      } catch (err) {
        console.error('❌ APNs system send error (Check VPS Firewall/Cert):', err);
        results.push({ path: 'apns', success: false, error: err.message });
      }
    }
  }

  // 2. Send Firebase to all Android or fallback iOS devices
  // ✅ ENHANCEMENT: For CALLS on iOS, we ONLY use VoIP. Sending FCM for calls on iOS 
  // causes a secondary "Ghost Screen" because VoIP already triggers CallKit natives.
  const allFcmTokens = (normalizedPayload.type === 'incoming_call')
    ? [...androidFcmTokens] // Only Android for Calls
    : [...androidFcmTokens, ...iosFcmTokens]; // Everyone for normal messages

  if (allFcmTokens.length > 0) {
    for (const token of allFcmTokens) {
      try {
        const message = {
          data: {
            ...Object.fromEntries(
              Object.entries(normalizedPayload).map(([k, v]) => [k, String(v)])
            ),
            callType: String(callType),
          },
          android: { priority: 'high', ttl: 30000 },
          token: token,
        };
        await admin.messaging().send(message);
        console.log(`📱 Firebase notification sent for type: ${normalizedPayload.type}`);
        results.push({ path: 'firebase', success: true });
      } catch (err) {
        console.error('❌ Firebase single send error:', err);
      }
    }
  }

  return { 
    success: results.some(r => r.success), 
    deviceCount: results.length 
  };
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
  if (!chatId) return;

  const cancelPayload = {
    type: 'cancel_call',
    status: 'cancelled',
    chatId: String(chatId),
    id: String(uuid || ''), // Added for native iOS lookup
    uuid: String(uuid || ''),
    timestamp: new Date().toISOString(),
  };

  const iosVoipTokens = new Set();
  const fcmTokens = new Set();

  // 1. Identify all target tokens (Modern & Legacy)
  if (receiver.devices && Array.isArray(receiver.devices)) {
    receiver.devices.forEach(d => {
      if (!d.isActive) return;
      if (d.platform === 'ios') {
        if (d.voipToken) iosVoipTokens.add(d.voipToken);
        if (d.fcmToken) fcmTokens.add(d.fcmToken); // Android/FCM logic handles cancel
      } else {
        if (d.fcmToken) fcmTokens.add(d.fcmToken);
      }
    });
  }

  // Legacy fallback
  if (receiver.devicePlatform === 'ios' && receiver.voipToken) iosVoipTokens.add(receiver.voipToken);
  if (receiver.fcmToken) fcmTokens.add(receiver.fcmToken);

  // 2. iOS PATHWAY (Direct APNs VoIP) - Most reliable for CallKit cleanup
  if (apnProvider && iosVoipTokens.size > 0) {
    for (const token of iosVoipTokens) {
      try {
        const notification = new apn.Notification();
        notification.pushType = 'voip';
        notification.topic = `${process.env.IOS_BUNDLE_ID}.voip`;
        notification.priority = 10;
        notification.contentAvailable = 1;
        notification.payload = cancelPayload;
        
        const response = await apnProvider.send(notification, token);
        if (response.failed.length > 0) {
          const failure = response.failed[0];
          console.error(`❌ APNs Cancel FAILED for device ${receiver._id}:`);
          console.error(`   - Status: ${failure.status || 'N/A'}`);
          console.error(`   - Error: ${failure.error || 'N/A'}`);
          console.error(`   - Response: ${JSON.stringify(failure.response || 'No response from Apple')}`);
        } else {
          console.log(`📴 Direct APNs Cancel sent successfully for ${receiver._id}`);
        }
      } catch (error) {
        console.error('❌ APNs Cancel system error (Check VPS Firewall/Cert):', error);
      }
    }
  }

  // 3. ANDROID / FALLBACK (Firebase)
  if (fcmTokens.size > 0) {
    for (const token of fcmTokens) {
      try {
        const message = {
          data: {
            ...cancelPayload,
            // Ensure strings for FCM
            type: 'cancel_call',
            chatId: String(chatId),
            uuid: String(uuid || ''),
          },
          android: { priority: 'high', ttl: 0 },
          apns: {
            payload: { 
              aps: { 
                'content-available': 1,
                'mutable-content': 1
              } 
            },
            headers: { 
              'apns-priority': '10',
              'apns-push-type': 'background'
            }
          },
          token: token,
        };
        await admin.messaging().send(message);
        console.log(`📴 Firebase Cancel sent to token for ${receiver._id}`);
      } catch (error) {
        // Silently skip expired tokens
        if (error.code !== 'messaging/registration-token-not-registered') {
          console.error('❌ Firebase Cancel Error:', error);
        }
      }
    }
  }
};
