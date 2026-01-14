# Firebase Cloud Messaging (FCM) Integration Setup

## 🎯 Overview
Successfully integrated Firebase Cloud Messaging into the Docmobi backend for push notifications. This enables real-time appointment confirmations and other notifications to be sent directly to users' devices.

## ✅ Implementation Summary

### 1. **Dependencies Added**
- Added `firebase-admin: ^12.0.0` to package.json
- Installed Firebase Admin SDK for server-side FCM operations

### 2. **User Model Enhanced**
Updated `/model/user.model.js` with FCM token storage:
```javascript
fcmTokens: [{
  token: { type: String, required: true },
  platform: { type: String, enum: ["android", "ios", "web"], required: true },
  createdAt: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true }
}]
```

### 3. **FCM Service Created**
Created `/utils/fcm.js` with comprehensive utilities:
- `initializeFirebase()` - Initialize Firebase Admin SDK
- `sendFCMNotification()` - Send to specific tokens
- `sendFCMNotificationToUsers()` - Send to multiple users
- `sendTopicNotification()` - Topic-based notifications
- `cleanupInactiveTokens()` - Clean up invalid tokens
- Token validation and management functions

### 4. **API Endpoints Added**
Created `/controller/fcm.controller.js` with:
- `POST /api/v1/user/fcm-token` - Register/update FCM token
- `DELETE /api/v1/user/fcm-token` - Remove FCM token  
- `GET /api/v1/user/fcm-tokens` - Get user's tokens
- `PATCH /api/v1/user/fcm-tokens/cleanup` - Clean inactive tokens

### 5. **Notification System Enhanced**
Updated `/utils/notify.js` to integrate FCM:
- `createNotification()` now supports `sendPush` parameter
- Type-specific FCM payloads for different notification types
- Enhanced `createBulkNotification()` for multiple users
- Automatic FCM sending when users have active tokens

### 6. **Appointment Confirmation Integration**
Updated `/controller/appointment.controller.js`:
- Appointment confirmed → `appointment_confirmed` notification type
- Appointment cancelled → `appointment_cancelled` notification type
- Proper notification titles and content for FCM
- Enhanced metadata for navigation

## 🔧 Configuration Required

### Environment Variables
Add to `.env` file:
```env
# Firebase Cloud Messaging Configuration
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=firebase-admin-sdk-xxxxx@your-firebase-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_DATABASE_URL=https://your-firebase-project-id-default-rtdb.firebaseio.com/
```

### Firebase Service Account Setup
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project or create new one
3. Go to Project Settings → Service Accounts
4. Generate new private key
5. Download JSON file and extract credentials
6. Add to `.env` file

## 📱 Client Integration Notes

### Flutter App Already Configured
The Flutter app already has:
- Firebase notification service (`lib/services/firebase_notification_service.dart`)
- Appointment provider with FCM integration  
- Enhanced notification screen
- Token registration in `AppointmentProvider`

### Required Client Updates
Make sure your Flutter app:
1. Registers FCM token with: `POST /api/v1/user/fcm-token`
2. Includes platform (android/ios/web) in request
3. Handles token refresh scenarios

## 🔄 Testing FCM Integration

### Test with Firebase Credentials
1. Set up Firebase project and get credentials
2. Update `.env` with Firebase configuration
3. Run the backend: `npm start`
4. Create an appointment and accept it
5. Check user receives push notification

### Mock Test Without Firebase
For testing the notification system without Firebase:
```javascript
// Test notification creation logic
const { createNotification } = require('./utils/notify');
const result = await createNotification({
  userId: 'user-id',
  type: 'appointment_confirmed',
  title: 'Test Confirmation',
  content: 'This is a test appointment confirmation',
  sendPush: false // Disable actual FCM send
});
```

## 📋 API Usage Examples

### Register FCM Token
```javascript
POST /api/v1/user/fcm-token
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "token": "fcm_device_token_here",
  "platform": "android" // or "ios" or "web"
}
```

### Response
```json
{
  "success": true,
  "message": "FCM token registered successfully",
  "data": {
    "tokenCount": 2,
    "platforms": ["android", "ios"]
  }
}
```

### Get FCM Tokens
```javascript
GET /api/v1/user/fcm-tokens
Authorization: Bearer <jwt_token>
```

### Response
```json
{
  "success": true,
  "data": {
    "tokens": [
      {
        "token": "fcm_token",
        "platform": "android",
        "isActive": true,
        "createdAt": "2025-01-14T10:30:00.000Z"
      }
    ],
    "count": 1,
    "platforms": ["android"]
  }
}
```

## 🎯 Notification Flow for Appointment Confirmation

### When Doctor Accepts Appointment:
1. **Database**: Notification stored in MongoDB
2. **FCM**: Push notification sent to patient's device
3. **Local**: Immediate notification shown in app
4. **Navigation**: Tap navigates to appointment details

### Notification Types Supported:
- `appointment_confirmed` - High priority, green color
- `appointment_cancelled` - High priority, red color  
- `appointment_reminder` - Normal priority, orange color
- `new_message` - Normal priority, blue color
- `incoming_call` - High priority, purple color
- `doctor_approved` - Normal priority, teal color

## 🔍 Debugging

### Check FCM Service Status
```javascript
// Check if Firebase is initialized
const admin = require('firebase-admin');
console.log('Firebase apps count:', admin.apps.length);

// Check environment variables
console.log('Project ID:', process.env.FIREBASE_PROJECT_ID ? 'Set' : 'Missing');
console.log('Client Email:', process.env.FIREBASE_CLIENT_EMAIL ? 'Set' : 'Missing');
console.log('Private Key:', process.env.FIREBASE_PRIVATE_KEY ? 'Set' : 'Missing');
```

### Monitor FCM Send Results
FCM service logs detailed information:
```
📱 FCM notification sent to 3 devices: {
  successCount: 2,
  failureCount: 1,
  failureInfo: [
    { error: 'UNREGISTERED', token: 'abc123...' }
  ]
}
```

## 🚀 Production Deployment

### Security Considerations
1. Store Firebase credentials securely (environment variables, not in code)
2. Validate FCM tokens on client before sending
3. Limit tokens per user (implemented: max 5 per platform)
4. Clean up inactive tokens automatically
5. Monitor FCM quota and usage

### Performance Optimizations
1. Batch FCM sends when possible
2. Automatic cleanup of invalid tokens
3. Token deduplication per user
4. Error handling and retry logic
5. FCM priority management based on notification type

## 📊 Monitoring

### Key Metrics to Track:
1. Notification delivery rates
2. Token validity rates  
3. Platform distribution
4. Response times
5. Error types and frequencies

### Recommended Monitoring Tools:
- Firebase Console Analytics
- Server logs (FCM service provides detailed logging)
- Database query performance
- API response times

## 🔧 Troubleshooting

### Common Issues and Solutions:

#### "FirebaseAppError: Service account object must contain a string 'project_id' property"
- ✅ Ensure FIREBASE_PROJECT_ID is set in .env
- ✅ Check for typos in variable name
- ✅ Restart server after updating .env

#### "Failed to parse private key: Error: Invalid PEM formatted message"
- ✅ Ensure private key is properly formatted in .env
- ✅ Check for extra quotes or escape characters
- ✅ Verify key wasn't corrupted during copy-paste

#### "UNREGISTERED" FCM errors
- ✅ Implement token refresh on client
- ✅ Clean up invalid tokens automatically
- ✅ Check app token registration logic

#### "User not found" in FCM operations
- ✅ Ensure user is logged in when registering tokens
- ✅ Check JWT token validation middleware
- ✅ Verify user exists in database

## 🎉 Next Steps

### Advanced Features to Consider:
1. **Scheduled Notifications**: Medication reminders, daily health tips
2. **Topic-Based Notifications**: Doctor announcements, health updates
3. **Notification Analytics**: Track open rates, engagement
4. **A/B Testing**: Different notification styles, timings
5. **Multilingual Support**: Localized notifications based on user language
6. **Notification Preferences**: User-controlled notification types
7. **Rich Media Notifications**: Images, videos in notifications
8. **Web Push Support**: Browser notifications for web platform

### Backend Enhancements:
1. **Queue System**: Queue FCM sends for reliability
2. **Retry Logic**: Automatic retries for failed sends
3. **Analytics Dashboard**: Internal notification metrics
4. **Rate Limiting**: Prevent spam, control costs
5. **Webhook Support**: Real-time notification status updates

## 📞 Support

For issues with FCM integration:
1. Check Firebase service account configuration
2. Verify environment variables are set correctly
3. Review server logs for detailed error messages
4. Test with actual FCM tokens from production devices
5. Consult Firebase documentation for latest requirements

---

**Integration Status**: ✅ Complete and Ready for Production