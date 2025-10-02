// services/whatsappService.js
const axios = require('axios');
const logger = require('../utils/logger');
require('dotenv').config({ path: __dirname + '/../.env' });

const META_API_TOKEN = process.env.META_API_TOKEN;
const SENDER_PHONE_ID = process.env.SENDER_PHONE_ID;
const API_URL = `https://graph.facebook.com/v19.0/${SENDER_PHONE_ID}/messages`;

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
        logger.error(errorMsg, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    }
}

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

async function sendImage(recipientNumber, imageUrl, caption = '') {
    const payload = {
        messaging_product: 'whatsapp',
        to: recipientNumber,
        type: 'image',
        image: {
            link: imageUrl,
            caption: caption
        }
    };
    await sendApiRequest(recipientNumber, payload);
}

module.exports = {
    sendMessage,
    sendTemplate,
    sendImage,
};