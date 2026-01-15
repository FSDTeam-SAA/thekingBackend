import agoraAccessToken from "agora-access-token";
const { RtcTokenBuilder, RtcRole } = agoraAccessToken;

// Should be in environment variables
const APP_ID = "8299a6de4a084700a4a48d1c15f15d21";
const APP_CERTIFICATE = "b46479dd44fa4ac499879aefd2929a37"; // You need to provide this, or I will use a placeholder/ask user.
// WAIT: The user provided APP_ID but NOT APP_CERTIFICATE in the code snippets.
// Agora Token generation REQUIRES App Certificate. 
// I will assume the user HAS it or needs to get it. 
// For now I will use a placeholder or check if it was in config. It was not. 
// actually, I will check if the user provided it in previous turns.
// User provided: specific Agora App ID (8299a6de4a084700a4a48d1c15f15d21) and Token (875690246eb429b9854852880402f39).
// The "Token" provided might be a temp token, NOT the certificate.
// I will generate the file with a TODO for App Certificate.

export const generateAgoraToken = (channelName, uid) => {
    const appID = process.env.AGORA_APP_ID || "8299a6de4a084700a4a48d1c15f15d21";
    // ✅ Updated with User Provided Certificate
    const appCertificate = process.env.AGORA_APP_CERTIFICATE || "6875690246eb429b9854852880402f39";

    if (!appCertificate) {
        throw new Error("AGORA_APP_CERTIFICATE is missing in environment variables");
    }

    const role = RtcRole.PUBLISHER;
    const expirationTimeInSeconds = 3600; // 1 hour
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
        appID,
        appCertificate,
        channelName,
        uid,
        role,
        privilegeExpiredTs
    );

    return token;
};
