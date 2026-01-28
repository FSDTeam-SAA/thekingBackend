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
    } else {
      firebaseApp = admin.apps[0];
    }
  } catch (error) {
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

    const message = {
      notification: {
        title: notification.title || 'Docmobi Notification',
        body: notification.body || 'You have a new notification',
        sound: 'default',
        badge: '1',
        ...(notification.android && {
          android: notification.android
        }),
        ...(notification.ios && {
          apns: notification.ios
        }),
      },
      data: {
        type: data.type || 'general',
        click_action: data.clickAction || '',
        ...data
      },
      tokens: tokens,
      priority: 'high',
      contentAvailable: true,
      mutableContent: true,
    };

    const response = await admin.messaging().sendMulticast(message);
    
    console.log(`📱 FCM notification sent to ${tokens.length} devices:`, {
      successCount: response.successCount,
      failureCount: response.failureCount,
      failureInfo: response.responses?.filter(r => !r.success) || []
    });

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
 * @param {Object} User model - User mongoose model
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

    // Add user context to data
    const enrichedData = {
      ...data,
      userIds: userIds,
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
      priority: 'high',
    };

    const response = await admin.messaging().send(message);
    
    console.log(`📱 FCM topic notification sent to ${topic}:`, response.messageId);
    
    return {
      success: true,
      messageId: response.messageId
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