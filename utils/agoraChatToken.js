import pkg from 'agora-token';
const { ChatTokenBuilder } = pkg;

/**
 * Generate Agora Chat User Token
 * @param {string} userId - The user ID to generate the token for
 * @returns {string} - The generated Agora Chat token
 */
export const generateAgoraChatToken = (userId) => {
    const appId = process.env.AGORA_APP_ID || "8299a6de4a084700a4a48d1c15f15d21";
    const appCertificate = process.env.AGORA_APP_CERTIFICATE || "6875690246eb429b9854852880402f39";

    if (!appId || !appCertificate) {
        throw new Error("AGORA_APP_ID or AGORA_APP_CERTIFICATE is missing");
    }

    // Token valid for 24 hours
    const expirationInSeconds = 24 * 3600;

    try {
        const token = ChatTokenBuilder.buildUserToken(
            appId,
            appCertificate,
            userId,
            expirationInSeconds
        );
        return token;
    } catch (error) {
        throw error;
    }
};
