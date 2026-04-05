import admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';

// Firebase Admin initialization
let firebaseApp = null;

const getFirebaseCredential = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      return admin.credential.cert(serviceAccount);
    } catch (error) {
      console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', error);
    }
  }

  if (!process.env.FIREBASE_PROJECT_ID) {
    return null;
  }

  return admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  });
};

/**
 * Initialize Firebase Admin SDK
 */
export const initializeFirebase = () => {
  try {
    // Check if Firebase is already initialized
    if (!admin.apps.length) {
      const credential = getFirebaseCredential();
      if (!credential) {
        throw new Error(
          'Firebase credential missing. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY',
        );
      }

      firebaseApp = admin.initializeApp({
        credential,
        projectId: process.env.FIREBASE_PROJECT_ID,
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      });

      console.log('✅ Firebase Admin SDK initialized');
    } else {
      firebaseApp = admin.apps[0];
      console.log('✅ Firebase Admin SDK already initialized');
    }
  } catch (error) {
    console.error('❌ Firebase initialization error:', error);
    throw error;
  }
};

/**
 * Get Firebase Admin instance
 */
export const getFirebaseApp = () => {
  if (!firebaseApp) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.');
  }
  return firebaseApp;
};

/**
 * Send FCM notification to specific device tokens
 * @param {Array<string>} tokens - Array of FCM tokens
 * @param {Object} notification - Notification payload
 * @param {Object} data - Custom data payload
 * @returns {Promise<Object>} - Result of notification sending
 */
export const sendFCMNotification = async (tokens, notification, data = {}) => {
  try {
    if (!tokens || !tokens.length) {
      console.log('⚠️ No tokens provided for FCM notification');
      return { success: false, message: 'No tokens provided' };
    }

    // ✅ CRITICAL FIX: Convert all data values to strings
    const stringifiedData = {};
    for (const [key, value] of Object.entries(data)) {
      stringifiedData[key] = String(value);
    }

    const message = {
      // ✅ Notification block for chat messages
      notification: {
        title: notification.title || 'Docmobi Notification',
        body: notification.body || 'You have a new notification',
      },

      // ✅ Data payload with all values as strings
      data: {
        type: data.type || 'general',
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        title: notification.title || 'Docmobi Notification',
        body: notification.body || 'You have a new notification',
        ...stringifiedData,
      },

      android: {
        priority: 'high',
        notification: {
          channelId: 'docmobi_chat_notifications_v3',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          sound: 'default',
          priority: 'high',
          ...(notification.android && notification.android),
        },
      },

      apns: {
        payload: {
          aps: {
            alert: {
              title: notification.title || 'Docmobi Notification',
              body: notification.body || 'You have a new notification',
            },
            sound: 'default',
            badge: 1,
            'content-available': 1,
            'mutable-content': 1,
            ...(notification.ios && notification.ios),
          },
        },
        headers: {
          'apns-priority': '10',
        },
      },

      tokens: tokens,
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    console.log(`📱 FCM notification sent to ${tokens.length} devices:`, {
      successCount: response.successCount,
      failureCount: response.failureCount,
    });

    // Log failures for debugging
    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.error(`❌ Failed to send to token ${idx}:`, resp.error?.message);
        }
      });
    }

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses
    };
  } catch (error) {
    console.error('❌ Error sending FCM notification:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send FCM notification to a single token
 * @param {string} token - FCM token
 * @param {Object} notification - Notification payload
 * @param {Object} data - Custom data payload
 * @returns {Promise<Object>} - Result of notification sending
 */
export const sendSingleFCMNotification = async (token, notification, data = {}) => {
  return await sendFCMNotification([token], notification, data);
};

/**
 * Send FCM notification to multiple users
 * @param {Array<string>} userIds - Array of user IDs
 * @param {Object} notification - Notification payload
 * @param {Object} data - Custom data payload
 * @param {Object} UserModel - User mongoose model
 * @returns {Promise<Object>} - Result of notification sending
 */
export const sendFCMNotificationToUsers = async (userIds, notification, data = {}, UserModel) => {
  try {
    // Support: New devices[] array, Legacy fcmTokens[] array, and Legacy single fcmToken string.
    const users = await UserModel.find({
      _id: { $in: userIds },
      $or: [
        { 'devices.fcmToken': { $exists: true, $ne: null } },
        { 'fcmTokens.isActive': true },
        { fcmToken: { $exists: true, $ne: null } },
      ],
    }).select('devices fcmTokens fcmToken devicePlatform');

    if (!users || !users.length) {
      console.log('⚠️ No users found with any active device tokens');
      return { success: false, message: 'No users with active tokens' };
    }

    // Collect all active tokens
    const tokenMap = new Map();
    users.forEach(user => {
      // 1. New Professional Multi-Device Schema
      if (user.devices && Array.isArray(user.devices)) {
        user.devices.forEach(device => {
          if (device.fcmToken && device.isActive !== false) {
            tokenMap.set(device.fcmToken, {
              userId: user._id.toString(),
              platform: device.platform || 'unknown'
            });
          }
        });
      }

      // 2. Legacy fcmTokens Array Schema (Compatibility)
      if (user.fcmTokens && Array.isArray(user.fcmTokens)) {
        user.fcmTokens.forEach(fcmToken => {
          if (fcmToken.isActive) {
            tokenMap.set(fcmToken.token, {
              userId: user._id.toString(),
              platform: fcmToken.platform || 'unknown'
            });
          }
        });
      }

      // 3. Legacy single fcmToken string (Compatibility)
      if (user.fcmToken && typeof user.fcmToken === 'string') {
        tokenMap.set(user.fcmToken, {
          userId: user._id.toString(),
          platform: user.devicePlatform || 'unknown',
        });
      }
    });

    const tokens = Array.from(tokenMap.keys());
    if (!tokens.length) {
      console.log('⚠️ No active FCM tokens found for users');
      return { success: false, message: 'No active tokens' };
    }

    console.log(`📤 Sending notification to ${tokens.length} devices for ${userIds.length} users`);

    // Add user context to data
    const enrichedData = {
      ...data,
      timestamp: new Date().toISOString()
    };

    // Send notification
    const result = await sendFCMNotification(tokens, notification, enrichedData);

    // Handle failed tokens (cleanup)
    if (result.failureCount > 0) {
      const failedTokens = [];
      result.responses.forEach((response, index) => {
        if (!response.success) {
          failedTokens.push(tokens[index]);
        }
      });

      if (failedTokens.length > 0) {
        await cleanupInactiveTokens(failedTokens, UserModel);
      }
    }

    return result;
  } catch (error) {
    console.error('❌ Error sending FCM notification to users:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Clean up inactive FCM tokens
 * @param {Array<string>} tokens - Array of failed tokens
 * @param {Object} UserModel - User mongoose model
 */
export const cleanupInactiveTokens = async (tokens, UserModel) => {
  try {
    console.log(`🧹 Cleaning up ${tokens.length} inactive FCM tokens`);

    await Promise.all([
      // 1. Professional Multi-Device Schema
      UserModel.updateMany(
        { 'devices.fcmToken': { $in: tokens } },
        { $pull: { devices: { fcmToken: { $in: tokens } } } }
      ),
      // 2. Legacy fcmTokens Array Schema
      UserModel.updateMany(
        { 'fcmTokens.token': { $in: tokens } },
        { $pull: { fcmTokens: { token: { $in: tokens } } } }
      ),
      // 3. Legacy single fcmToken string
      UserModel.updateMany(
        { fcmToken: { $in: tokens } },
        { $set: { fcmToken: null } }
      ),
    ]);

    console.log('✅ Inactive tokens cleaned up successfully');
  } catch (error) {
    console.error('❌ Error cleaning up inactive tokens:', error);
  }
};

/**
 * Send topic-based FCM notification
 * @param {string} topic - Topic name
 * @param {Object} notification - Notification payload
 * @param {Object} data - Custom data payload
 * @returns {Promise<Object>} - Result of notification sending
 */
export const sendTopicNotification = async (topic, notification, data = {}) => {
  try {
    const message = {
      notification: {
        title: notification.title || 'Docmobi Notification',
        body: notification.body || 'You have a new notification',
        sound: 'default',
      },
      data: {
        type: data.type || 'general',
        click_action: data.clickAction || '',
        ...data
      },
      topic: topic,
      android: {
        priority: 'high',
      },
      apns: {
        headers: {
          'apns-priority': '10',
        },
      },
    };

    const response = await admin.messaging().send(message);

    console.log(`📱 FCM topic notification sent to ${topic}:`, response);

    return {
      success: true,
      messageId: response
    };
  } catch (error) {
    console.error('❌ Error sending FCM topic notification:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Subscribe users to FCM topics
 * @param {Array<string>} tokens - Array of FCM tokens
 * @param {string} topic - Topic name
 */
export const subscribeToTopic = async (tokens, topic) => {
  try {
    const response = await admin.messaging().subscribeToTopic(tokens, topic);

    console.log(`✅ Subscribed ${tokens.length} tokens to topic: ${topic}`);
    console.log('Subscription response:', response);

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount
    };
  } catch (error) {
    console.error('❌ Error subscribing to topic:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Unsubscribe users from FCM topics
 * @param {Array<string>} tokens - Array of FCM tokens
 * @param {string} topic - Topic name
 */
export const unsubscribeFromTopic = async (tokens, topic) => {
  try {
    const response = await admin.messaging().unsubscribeFromTopic(tokens, topic);

    console.log(`✅ Unsubscribed ${tokens.length} tokens from topic: ${topic}`);

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount
    };
  } catch (error) {
    console.error('❌ Error unsubscribing from topic:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Validate FCM token format
 * @param {string} token - FCM token to validate
 * @returns {boolean} - Whether token is valid
 */
export const validateFCMToken = (token) => {
  if (!token || typeof token !== 'string') {
    return false;
  }

  // Basic validation - FCM tokens are typically 100-200 characters
  return token.length >= 100 && token.length <= 200;
};

/**
 * 📞 Send Call Notification (Special high-priority notification for incoming calls)
 * @param {Array<Object>} tokenObjects - Array of { token, platform, tokenType }
 * @param {Object} callData - Call information
 * @returns {Promise<Object>} - Result of notification sending
 */
export const sendCallNotification = async (tokenObjects, callData) => {
  try {
    if (!tokenObjects || !tokenObjects.length) {
      console.log('⚠️ No tokens provided for call notification');
      return { success: false, message: 'No tokens provided' };
    }

    const { callerId, callerName, callerAvatar = '', chatId, callType = 'audio' } = callData;
    const callUuid = callData.uuid || uuidv4();

    // Group tokens by their processing requirements
    const iosVoipTokens = tokenObjects
      .filter(t => t.platform === 'ios' && t.tokenType === 'voip')
      .map(t => t.token);

    const standardTokens = tokenObjects
      .filter(t => !(t.platform === 'ios' && t.tokenType === 'voip'))
      .map(t => t.token);

    const results = [];

    // 1. Send to iOS VoIP Tokens (Requires special headers)
    if (iosVoipTokens.length > 0) {
      const voipMessage = {
        data: {
          type: 'incoming_call',
          callType: String(callType),
          callerId: String(callerId),
          callerName: String(callerName),
          callerAvatar: String(callerAvatar),
          chatId: String(chatId),
          isVideo: callType === 'video' ? 'true' : 'false',
          timestamp: new Date().toISOString(),
          uuid: callUuid,
          duration: '30000',
        },
        apns: {
          payload: {
            aps: {
              'content-available': 1,
              'mutable-content': 1,
              category: 'INCOMING_CALL',
              'interruption-level': 'time-sensitive',
            },
          },
          headers: {
            'apns-priority': '10',
            'apns-push-type': 'voip', // ✅ MANDATORY for VoIP pushes
            'apns-topic': process.env.IOS_BUNDLE_ID ? `${process.env.IOS_BUNDLE_ID}.voip` : undefined, // Often required for VoIP
          },
        },
        tokens: iosVoipTokens,
      };

      const voipResponse = await admin.messaging().sendEachForMulticast(voipMessage);
      console.log(`📞 VoIP Call notification sent to ${iosVoipTokens.length} iOS devices`);
      results.push(voipResponse);
    }

    // 2. Send to Standard Tokens (Android + Standard iOS FCM)
    if (standardTokens.length > 0) {
      const standardMessage = {
        data: {
          type: 'incoming_call',
          callType: String(callType),
          callerId: String(callerId),
          callerName: String(callerName),
          callerAvatar: String(callerAvatar),
          chatId: String(chatId),
          isVideo: callType === 'video' ? 'true' : 'false',
          timestamp: new Date().toISOString(),
          uuid: callUuid,
          duration: '30000',
        },
        android: {
          priority: 'high',
          ttl: 30000,
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: callType === 'video' ? '📹 Incoming Video Call' : '📞 Incoming Call',
                body: `${callerName} is calling you...`,
              },
              sound: 'default',
              'content-available': 1,
              'mutable-content': 1,
              'interruption-level': 'time-sensitive',
            },
          },
          headers: {
            'apns-priority': '10',
          },
        },
        tokens: standardTokens,
      };

      const standardResponse = await admin.messaging().sendEachForMulticast(standardMessage);
      console.log(`📞 Standard Call notification sent to ${standardTokens.length} devices`);
      results.push(standardResponse);
    }

    const successCount = results.reduce((acc, r) => acc + (r.successCount || 0), 0);
    const failureCount = results.reduce((acc, r) => acc + (r.failureCount || 0), 0);

    return {
      success: true,
      successCount,
      failureCount,
    };
  } catch (error) {
    console.error('❌ Error sending call notification:', error);
    return { success: false, error: error.message };
  }
};

/**
 * 📴 Send Call Cancel/End Notification
 * @param {Array<string>} tokens - Array of FCM tokens
 * @param {Object} data - Call data
 */
export const sendCallCancelNotification = async (tokens, data) => {
  try {
    if (!tokens || !tokens.length) return;

    const message = {
      data: {
        type: 'cancel_call',
        chatId: String(data.chatId),
        uuid: String(data.uuid || ''),
        timestamp: new Date().toISOString(),
      },
      android: { priority: 'high', ttl: 0 },
      apns: {
        payload: {
          aps: {
            'content-available': 1, // Silent push for iOS
          },
        },
        headers: { 'apns-priority': '10' },
      },
      tokens: tokens,
    };

    await admin.messaging().sendEachForMulticast(message);
    console.log(`📴 Call cancel notification sent to ${tokens.length} devices`);
  } catch (error) {
    console.error('❌ Error sending call cancel notification:', error);
  }
};
