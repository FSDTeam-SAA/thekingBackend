// test-basic-setup.js
// Test basic FCM setup without actual Firebase initialization
import dotenv from 'dotenv';
dotenv.config();

const mongoose = require('mongoose');
const User = require('./model/user.model.js');

async function testBasicSetup() {
  try {
    console.log('🧪 Testing Basic FCM Setup...\n');

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

    // Test notification creation logic
    if (users.length > 0) {
      console.log('\n🧪 Testing notification system integration...');
      
      // Import the notification utils
      const { createNotification } = require('./utils/notify');
      
      // Test creating a notification for the first user
      const testResult = await createNotification({
        userId: users[0]._id.toString(),
        type: 'appointment_confirmed',
        title: 'Test Appointment Confirmation',
        content: 'This is a test appointment confirmation notification',
        sendPush: false // Disable actual FCM send for testing
      });

      console.log('\n📱 Notification System Test:');
      console.log(`   Success: ${testResult.success}`);
      console.log(`   Message: ${testResult.message}`);
      
      if (testResult.success) {
        console.log('   ✅ Notification system is properly integrated');
      }
    } else {
      console.log('\n⚠️ No users with FCM tokens found');
    }

    console.log('\n✅ Basic Setup Test Complete!');
    console.log('📋 To test with actual FCM:');
    console.log('   1. Set up Firebase project');
    console.log('   2. Update .env with Firebase credentials');
    console.log('   3. Run: npm start');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ MongoDB connection closed');
  }
}

// Run the test
testBasicSetup();