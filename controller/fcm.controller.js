import { validateFCMToken } from "../utils/fcm.js";
import { User } from "../model/user.model.js";

/**
 * Register/update FCM token for a user
 * Expects: { token: string, platform: string }
 */
export const registerFCMToken = async (req, res) => {
  try {
    const { token, platform } = req.body;
    const userId = req.user._id;

    // Validate input
    if (!token || !platform) {
      return res.status(400).json({
        success: false,
        message: 'FCM token and platform are required'
      });
    }

    // Validate platform
    if (!['android', 'ios', 'web'].includes(platform.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid platform. Must be: android, ios, or web'
      });
    }

    // Validate token format
    if (!validateFCMToken(token)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid FCM token format'
      });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Initialize fcmTokens array if it doesn't exist
    if (!user.fcmTokens) {
      user.fcmTokens = [];
    }

    // Check if token already exists
    const existingTokenIndex = user.fcmTokens.findIndex(
      fcmToken => fcmToken.token === token && fcmToken.isActive === true
    );

    if (existingTokenIndex !== -1) {
      // Token exists, update its info
      user.fcmTokens[existingTokenIndex].platform = platform.toLowerCase();
      user.fcmTokens[existingTokenIndex].createdAt = new Date();
      user.fcmTokens[existingTokenIndex].isActive = true;
    } else {
      // Remove any inactive tokens for the same platform (cleanup)
      user.fcmTokens = user.fcmTokens.filter(
        fcmToken => !(fcmToken.platform === platform.toLowerCase() && !fcmToken.isActive)
      );

      // Add new token
      user.fcmTokens.push({
        token,
        platform: platform.toLowerCase(),
        createdAt: new Date(),
        isActive: true
      });
    }

    // Limit the number of tokens per user (keep latest 5 per platform)
    const maxTokensPerPlatform = 5;
    const tokensByPlatform = {};
    
    user.fcmTokens.forEach(fcmToken => {
      if (!tokensByPlatform[fcmToken.platform]) {
        tokensByPlatform[fcmToken.platform] = [];
      }
      tokensByPlatform[fcmToken.platform].push(fcmToken);
    });

    // Keep only the most recent tokens for each platform
    user.fcmTokens = [];
    Object.keys(tokensByPlatform).forEach(platform => {
      const sortedTokens = tokensByPlatform[platform]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, maxTokensPerPlatform);
      
      user.fcmTokens.push(...sortedTokens);
    });

    await user.save();

    console.log(`✅ FCM token registered for user ${userId}: ${platform}`);

    res.status(200).json({
      success: true,
      message: 'FCM token registered successfully',
      data: {
        tokenCount: user.fcmTokens.length,
        platforms: [...new Set(user.fcmTokens.map(t => t.platform))]
      }
    });
  } catch (error) {
    console.error('❌ Error registering FCM token:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register FCM token',
      error: error.message
    });
  }
};

/**
 * Remove FCM token for a user
 * Expects: { token: string }
 */
export const removeFCMToken = async (req, res) => {
  try {
    const { token } = req.body;
    const userId = req.user._id;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'FCM token is required'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Remove the token (set isActive to false instead of removing for tracking)
    if (user.fcmTokens && user.fcmTokens.length > 0) {
      const tokenIndex = user.fcmTokens.findIndex(
        fcmToken => fcmToken.token === token
      );

      if (tokenIndex !== -1) {
        user.fcmTokens[tokenIndex].isActive = false;
        await user.save();
        
        console.log(`✅ FCM token removed for user ${userId}`);
        
        return res.status(200).json({
          success: true,
          message: 'FCM token removed successfully'
        });
      }
    }

    res.status(404).json({
      success: false,
      message: 'FCM token not found'
    });
  } catch (error) {
    console.error('❌ Error removing FCM token:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove FCM token',
      error: error.message
    });
  }
};

/**
 * Get user's FCM tokens
 */
export const getFCMTokens = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId).select('fcmTokens');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Return only active tokens
    const activeTokens = user.fcmTokens ? 
      user.fcmTokens.filter(token => token.isActive) : [];

    res.status(200).json({
      success: true,
      data: {
        tokens: activeTokens,
        count: activeTokens.length,
        platforms: [...new Set(activeTokens.map(t => t.platform))]
      }
    });
  } catch (error) {
    console.error('❌ Error getting FCM tokens:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get FCM tokens',
      error: error.message
    });
  }
};

/**
 * Clean up all inactive FCM tokens for a user
 */
export const cleanupFCMTokens = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.fcmTokens && user.fcmTokens.length > 0) {
      // Remove all inactive tokens
      const activeTokens = user.fcmTokens.filter(token => token.isActive);
      user.fcmTokens = activeTokens;
      
      await user.save();
      
      const removedCount = user.fcmTokens.length - activeTokens.length;
      console.log(`✅ Cleaned up ${removedCount} inactive FCM tokens for user ${userId}`);
      
      res.status(200).json({
        success: true,
        message: `Cleaned up ${removedCount} inactive tokens`,
        data: {
          remainingTokens: activeTokens.length
        }
      });
    } else {
      res.status(200).json({
        success: true,
        message: 'No tokens to clean up',
        data: {
          remainingTokens: 0
        }
      });
    }
  } catch (error) {
    console.error('❌ Error cleaning up FCM tokens:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clean up FCM tokens',
      error: error.message
    });
  }
};