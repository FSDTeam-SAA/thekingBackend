import { User } from "../model/user.model.js";

/**
 * Register/update device tokens for a user (Hybrid Approach)
 * POST /api/v1/user/fcm-token
 * Receives: { fcmToken?: string, voipToken?: string, platform: string }
 */
/**
 * Register/update device tokens for a user (Professional Multi-Device Architecture)
 * POST /api/v1/user/fcm-token
 * Receives: { fcmToken?: string, voipToken?: string, platform: string, deviceId: string }
 */
export const registerFCMToken = async (req, res) => {
  try {
    const { fcmToken, voipToken, platform, deviceId } = req.body;
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

    //  1. Uniqueness Fix: Remove these tokens from ANY other user record
    // This ensures a device belongs to only one user at a time.
    if (fcmToken) {
      await User.updateMany(
        { _id: { $ne: userId }, "devices.fcmToken": fcmToken },
        { $pull: { devices: { fcmToken: fcmToken } } }
      );
      // Legacy cleanup
      await User.updateMany(
        { _id: { $ne: userId }, fcmToken: fcmToken },
        { fcmToken: null }
      );
    }
    
    if (voipToken) {
      await User.updateMany(
        { _id: { $ne: userId }, "devices.voipToken": voipToken },
        { $pull: { devices: { voipToken: voipToken } } }
      );
      // Legacy cleanup
      await User.updateMany(
        { _id: { $ne: userId }, voipToken: voipToken },
        { voipToken: null }
      );
    }

    // 2. Add/Update the current user's device list
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Clean up devices array if it doesn't exist yet
    if (!user.devices) user.devices = [];

    // Identify device (Using deviceId or token as fallback)
    const deviceIdentifier = deviceId || fcmToken || voipToken;
    const existingDeviceIndex = user.devices.findIndex(
      d => d.deviceId === deviceId || d.fcmToken === fcmToken || d.voipToken === voipToken
    );

    const deviceData = {
      deviceId: deviceId || deviceIdentifier,
      fcmToken: fcmToken || user.devices[existingDeviceIndex]?.fcmToken,
      voipToken: voipToken || user.devices[existingDeviceIndex]?.voipToken,
      platform: platform.toLowerCase(),
      lastUsed: new Date(),
      isActive: true
    };

    if (existingDeviceIndex > -1) {
      // Update existing device
      user.devices[existingDeviceIndex] = { ...user.devices[existingDeviceIndex], ...deviceData };
    } else {
      // Add new device (Cap at 5 devices per user to prevent bloat)
      if (user.devices.length >= 5) {
        user.devices.sort((a, b) => a.lastUsed - b.lastUsed).shift();
      }
      user.devices.push(deviceData);
    }

    // 3. Backward Compatibility: Always update the legacy top-level fields
    // This ensures old parts of the app still work until fully migrated.
    if (fcmToken) user.fcmToken = fcmToken;
    if (voipToken) user.voipToken = voipToken;
    user.devicePlatform = platform.toLowerCase();

    await user.save();

    console.log(`✅ Multi-device tokens registered for user ${userId} on ${platform}`);

    return res.status(200).json({
      success: true,
      message: 'Device registered successfully',
      deviceCount: user.devices.length
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
 * Clears the specific device token if provided, else clears all.
 */
export const removeFCMToken = async (req, res) => {
  try {
    const userId = req.user._id;
    const { fcmToken } = req.body;
    
    if (fcmToken) {
      // Remove specific device
      await User.findByIdAndUpdate(userId, {
        $pull: { devices: { fcmToken: fcmToken } }
      });
      console.log(`🗑️ Removed specific device token for user ${userId}`);
    } else {
      // Clear all (Legacy behavior or full logout)
      await User.findByIdAndUpdate(userId, {
        devices: [],
        fcmToken: null,
        voipToken: null,
        devicePlatform: null
      });
      console.log(`🗑️ Cleared ALL device tokens for user ${userId}`);
    }

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