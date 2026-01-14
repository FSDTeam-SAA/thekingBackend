// test-fcm-integration.js
// Simple test script to verify FCM integration
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { initializeFirebase, sendFCMNotificationToUsers } from './utils/fcm.js';
import { User } from './model/user.model.js';

async function testFCMIntegration() {
  try {
    console.log('🧪 Testing FCM Integration...\n');

    // Initialize Firebase
    initializeFirebase();
    console.log('✅ Firebase initialized\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_DB_URL);
    console.log('✅ MongoDB connected\n');

    // Check if users have FCM tokens
    const users = await User.find({ 'fcmTokens.0': { $exists: true } })
      .select('_id fullName fcmTokens')
      .limit(3);

    console.log(`📱 Found ${users.length} users with FCM tokens:`);
    
    users.forEach((user, index) => {
      console.log(`\n${index + 1}. ${user.fullName}`);
      console.log(`   Tokens: ${user.fcmTokens?.length || 0}`);
      
      if (user.fcmTokens && user.fcmTokens.length > 0) {
        user.fcmTokens.forEach((token, tokenIndex) => {
          const status = token.isActive ? '✅ Active' : '❌ Inactive';
          console.log(`   ${tokenIndex + 1}. ${status} - ${token.platform} - ${token.token.substring(0, 20)}...`);
        });
      }
    });

    // Test sending notification if user has tokens
    if (users.length > 0 && users[0].fcmTokens && users[0].fcmTokens.length > 0) {
      const testUser = users[0];
      const activeTokens = testUser.fcmTokens.filter(t => t.isActive);
      
      if (activeTokens.length > 0) {
        console.log('\n🧪 Testing FCM notification...');
        
        const testResult = await sendFCMNotificationToUsers(
          [testUser._id.toString()],
          {
            title: '🧪 FCM Test Notification',
            body: 'This is a test notification from Docmobi backend',
          },
          {
            type: 'test_notification',
            clickAction: '/notifications',
            timestamp: new Date().toISOString()
          },
          User
        );

        console.log('\n📱 FCM Test Results:');
        console.log(`   Success: ${testResult.success}`);
        console.log(`   Success Count: ${testResult.successCount || 0}`);
        console.log(`   Failure Count: ${testResult.failureCount || 0}`);
        
        if (testResult.responses) {
          testResult.responses.forEach((response, index) => {
            if (!response.success) {
              console.log(`   Failed Token ${index + 1}: ${response.error?.message || 'Unknown error'}`);
            }
          });
        }
      } else {
        console.log('\n⚠️ No active tokens to test');
      }
    } else {
      console.log('\n⚠️ No users with FCM tokens found');
    }

    console.log('\n✅ FCM Integration Test Complete!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ MongoDB connection closed');
  }
}

// Run the test
testFCMIntegration();