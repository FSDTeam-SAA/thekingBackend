import { User } from "../model/user.model.js";

/**
 * Register/update device tokens for a user (Hybrid Approach)
 * POST /api/v1/user/fcm-token
 * Receives: { fcmToken?: string, voipToken?: string, platform: string }
 */
export const registerFCMToken = async (req, res) => {
  try {
    const { fcmToken, voipToken, platform } = req.body;
    const userId = req.user._id;

    if (!fcmToken && !voipToken) {
      return res.status(400).json({
        success: false,
        message: 'At least one token (fcmToken or voipToken) is required'
      });
    }

    if (!platform || !['android', 'ios', 'web'].includes(platform.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'Valid platform (android, ios, or web) is required'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update tokens
    if (fcmToken) user.fcmToken = fcmToken;
    if (voipToken) user.voipToken = voipToken;
    user.devicePlatform = platform.toLowerCase();

    await user.save();

    console.log(`✅ Tokens registered for user ${userId} on ${platform}`);

    return res.status(200).json({
      success: true,
      message: 'Tokens registered successfully'
    });
  } catch (error) {
    console.error('❌ Error registering tokens:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Remove/Clear tokens for a user (on logout)
 */
export const removeFCMToken = async (req, res) => {
  try {
    const userId = req.user._id;
    
    await User.findByIdAndUpdate(userId, {
      fcmToken: null,
      voipToken: null,
      devicePlatform: null
    });

    return res.status(200).json({
      success: true,
      message: 'Tokens cleared successfully'
    });
  } catch (error) {
    console.error('❌ Error clearing tokens:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * Get current active tokens for the user
 */
export const getFCMTokens = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select('fcmToken voipToken devicePlatform');
    
    return res.status(200).json({
      success: true,
      data: {
        fcmToken: user.fcmToken,
        voipToken: user.voipToken,
        platform: user.devicePlatform
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};