import admin from 'firebase-admin';

// Firebase Admin initialization
let firebaseApp = null;

/**
 * Initialize Firebase Admin SDK
 */
export const initializeFirebase = () => {
  try {
    // Check if Firebase is already initialized
    if (!admin.apps.length) {
      // Check if required environment variables are set
      if (!process.env.FIREBASE_PROJECT_ID) {
        throw new Error('FIREBASE_PROJECT_ID is required in environment variables');
      }

      // Use simplified initialization without service account for testing
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
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
    // Find users and their active FCM tokens
    const users = await UserModel.find({
      _id: { $in: userIds },
      'fcmTokens.isActive': true
    }).select('fcmTokens');

    if (!users || !users.length) {
      console.log('⚠️ No users found with active FCM tokens');
      return { success: false, message: 'No users with active tokens' };
    }

    // Collect all active tokens
    const tokenMap = new Map();
    users.forEach(user => {
      if (user.fcmTokens && Array.isArray(user.fcmTokens)) {
        user.fcmTokens.forEach(fcmToken => {
          if (fcmToken.isActive) {
            tokenMap.set(fcmToken.token, {
              userId: user._id.toString(),
              platform: fcmToken.platform
            });
          }
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

    await UserModel.updateMany(
      { 'fcmTokens.token': { $in: tokens } },
      { $pull: { fcmTokens: { token: { $in: tokens } } } }
    );

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
 * This function sends a DATA-ONLY notification for Android (to trigger background handler)
 * and a full notification for iOS
 * @param {Array<string>} tokens - Array of FCM tokens
 * @param {Object} callData - Call information
 * @param {string} callData.callerId - Caller's user ID
 * @param {string} callData.callerName - Caller's name
 * @param {string} callData.callerAvatar - Caller's avatar URL
 * @param {string} callData.chatId - Chat/Channel ID
 * @param {string} callData.callType - 'audio' or 'video'
 * @returns {Promise<Object>} - Result of notification sending
 */
export const sendCallNotification = async (tokens, callData) => {
  try {
    if (!tokens || !tokens.length) {
      console.log('⚠️ No tokens provided for call notification');
      return { success: false, message: 'No tokens provided' };
    }

    const { callerId, callerName, callerAvatar = '', chatId, callType = 'audio' } = callData;

    // Generate unique call ID for tracking
    const { v4: uuidv4 } = require('uuid');
    const callUuid = uuidv4();

    const message = {
      // ✅ Data-only for Android (triggers background handler immediately)
      data: {
        type: 'incoming_call',
        callType: String(callType),
        callerId: String(callerId),
        callerName: String(callerName),
        callerAvatar: String(callerAvatar),
        chatId: String(chatId),
        isVideo: callType === 'video' ? 'true' : 'false',
        timestamp: new Date().toISOString(),
        // ✅ NEW: Add unique ID and duration for CallKit
        uuid: callUuid,
        duration: '30000', // 30 seconds timeout
      },

      android: {
        priority: 'high',
        ttl: 30000,
        // ✅ NO notification block - let CallKit handle UI
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
            category: 'INCOMING_CALL',
            'interruption-level': 'time-sensitive',
          },
        },
        headers: {
          'apns-priority': '10',
        },
      },

      tokens: tokens,
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    console.log(`📞 Call notification sent:`, {
      successCount: response.successCount,
      failureCount: response.failureCount,
    });

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
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