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
      console.error('MongoDB URI not found in environment variables!');
      return;
    }
    
    await mongoose.connect(mongoUri);


    // Get all non-group chats
    const allChats = await Chat.find({ 
      isGroupChat: false 
    }).lean();


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


    let duplicatesRemoved = 0;
    let messagesTransferred = 0;

    // Process each group
    for (const [participantIds, chats] of chatGroups.entries()) {
      if (chats.length > 1) {

        // Sort by creation date (keep the oldest one)
        chats.sort((a, b) => a.createdAt - b.createdAt);

        const keepChat = chats[0];
        const duplicates = chats.slice(1);

        // Transfer messages from duplicates to the main chat
        for (const dupChat of duplicates) {
          // Count messages
          const messageCount = await Message.countDocuments({ 
            chatId: dupChat._id 
          });

          if (messageCount > 0) {
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



  } catch (error) {
    console.error(' Error during cleanup:', error);
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('MongoDB connection closed.');
  }
}

// Run the cleanup
cleanupDuplicateChats()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    process.exit(1);
  });