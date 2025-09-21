// services/whatsappService.js
const axios = require('axios');
const logger = require('../utils/logger');
require('dotenv').config({ path: __dirname + '/../.env' });

const META_API_TOKEN = process.env.META_API_TOKEN;
const SENDER_PHONE_ID = process.env.SENDER_PHONE_ID;
const API_URL = `https://graph.facebook.com/v19.0/${SENDER_PHONE_ID}/messages`;

async function sendMessage(recipientNumber, messagePayload) {
    let payload;
    if (typeof messagePayload === 'string') {
        payload = { messaging_product: 'whatsapp', to: recipientNumber, text: { body: messagePayload } };
    } else {
        payload = { messaging_product: 'whatsapp', to: recipientNumber, type: 'interactive', interactive: messagePayload };
    }
    await sendApiRequest(recipientNumber, payload);
}

async function sendTemplate(recipientNumber, templateName, components) {
    const payload = {
        messaging_product: 'whatsapp',
        to: recipientNumber,
        type: 'template',
        template: {
            name: templateName,
            language: { code: 'en' },
            components: components
        }
    };
    await sendApiRequest(recipientNumber, payload, templateName);
}

async function sendApiRequest(recipientNumber, payload, templateName = null) {
    const headers = { 'Authorization': `Bearer ${META_API_TOKEN}`, 'Content-Type': 'application/json' };
    try {
        await axios.post(API_URL, payload, { headers });
        const logMsg = templateName 
            ? `Successfully sent template '${templateName}' to ${recipientNumber}`
            : `Successfully sent message to ${recipientNumber}`;
        logger.info(logMsg);
    } catch (error) {
        const errorMsg = `Error sending message to ${recipientNumber}:`;
        // --- NEW: DETAILED ERROR LOGGING ---
        logger.error(errorMsg, { 
            status: error.response ? error.response.status : 'N/A',
            data: error.response ? error.response.data : 'N/A', // This will show the exact error from Meta
            message: error.message 
        });
    }
}

module.exports = {
    sendMessage,
    sendTemplate,
};