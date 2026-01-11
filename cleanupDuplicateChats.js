import { Chat } from "./model/chat.model.js";
import { Message } from "./model/message.model.js";
import mongoose from "mongoose";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

/**
 * ✅ Script to remove duplicate chats
 * Run this ONCE to clean up existing duplicates
 * 
 * Usage: node cleanupDuplicateChats.js
 */

async function cleanupDuplicateChats() {
  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    
    // Try multiple possible env variable names
    const mongoUri = process.env.MONGO_DB_URL || 
                     process.env.MONGODB_URI || 
                     process.env.DATABASE_URL || 
                     process.env.MONGO_URI ||
                     process.env.DB_URL;
    
    if (!mongoUri) {
      console.error('❌ MongoDB URI not found in environment variables!');
      console.log('Please check your .env file has one of these:');
      console.log('  - MONGO_DB_URL');
      console.log('  - MONGODB_URI');
      console.log('  - DATABASE_URL');
      return;
    }
    
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected\n');
    
    console.log('🔍 Finding duplicate chats...');

    // Get all non-group chats
    const allChats = await Chat.find({ 
      isGroupChat: false 
    }).lean();

    console.log(`📊 Found ${allChats.length} total 1-1 chats`);

    // Group chats by participant pair
    const chatGroups = new Map();

    for (const chat of allChats) {
      // Create a unique key from sorted participant IDs
      const participantIds = chat.participants
        .map(p => p.toString())
        .sort()
        .join('-');
      
      if (!chatGroups.has(participantIds)) {
        chatGroups.set(participantIds, []);
      }
      
      chatGroups.get(participantIds).push(chat);
    }

    console.log(`👥 Found ${chatGroups.size} unique participant pairs`);

    let duplicatesRemoved = 0;
    let messagesTransferred = 0;

    // Process each group
    for (const [participantIds, chats] of chatGroups.entries()) {
      if (chats.length > 1) {
        console.log(`\n🔄 Processing duplicate group: ${participantIds}`);
        console.log(`   Found ${chats.length} duplicate chats`);

        // Sort by creation date (keep the oldest one)
        chats.sort((a, b) => a.createdAt - b.createdAt);

        const keepChat = chats[0];
        const duplicates = chats.slice(1);

        console.log(`   ✅ Keeping chat: ${keepChat._id}`);
        console.log(`   ❌ Removing ${duplicates.length} duplicates`);

        // Transfer messages from duplicates to the main chat
        for (const dupChat of duplicates) {
          // Count messages
          const messageCount = await Message.countDocuments({ 
            chatId: dupChat._id 
          });

          if (messageCount > 0) {
            console.log(`   📨 Transferring ${messageCount} messages from ${dupChat._id}`);
            
            // Update all messages to point to the kept chat
            await Message.updateMany(
              { chatId: dupChat._id },
              { chatId: keepChat._id }
            );

            messagesTransferred += messageCount;
          }

          // Delete the duplicate chat
          await Chat.findByIdAndDelete(dupChat._id);
          duplicatesRemoved++;
          
          console.log(`   🗑️  Deleted duplicate chat: ${dupChat._id}`);
        }

        // Update the kept chat's lastMessage to the most recent one
        const latestMessage = await Message.findOne({ 
          chatId: keepChat._id 
        })
          .sort({ createdAt: -1 });

        if (latestMessage) {
          await Chat.findByIdAndUpdate(keepChat._id, {
            lastMessage: latestMessage._id,
            updatedAt: latestMessage.createdAt,
          });
        }
      }
    }

    console.log('\n✅ Cleanup complete!');
    console.log(`   🗑️  Removed ${duplicatesRemoved} duplicate chats`);
    console.log(`   📨 Transferred ${messagesTransferred} messages`);
    console.log(`   ✅ ${chatGroups.size} unique chats remain`);

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('\n🔌 MongoDB connection closed');
  }
}

// Run the cleanup
cleanupDuplicateChats()
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });