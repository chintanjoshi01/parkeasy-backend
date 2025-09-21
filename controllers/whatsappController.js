// controllers/whatsappController.js
const logger = require('../utils/logger');
const db = require('../config/db');
const aiService = require('../services/aiService');
const whatsapp = require('../services/whatsappService');

const { handleVehicleCheckIn, handleVehicleCheckout, handleGetStatus, handleListVehicles } = require('../handlers/sharedHandlers');
const { handleAddPass, handleRemovePass, handleRemoveAttendant, handleAddAttendant, handleViewPasses, handleGetReport, handleShowMenu, handleGetHelpList } = require('../handlers/ownerHandlers');
const { handleSubscribeUser, handleListOwners, handleDisableOwner, handleBroadcastMessage, handleSystemStatus } = require('../handlers/adminHandlers');

async function handleIncomingMessage(req, res) {
    const body = req.body;
    let messageText = '';
    let from = '';
    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
        const messageObject = body.entry[0].changes[0].value.messages[0];
        if (messageObject) {
            from = messageObject.from;
            if (messageObject.text) { messageText = messageObject.text.body; }
            else if (messageObject.interactive && messageObject.interactive.button_reply) { messageText = messageObject.interactive.button_reply.title; }
        }
    } else { return res.sendStatus(404); }
    
    logger.info(`Received message "${messageText}" from ${from}`);
    
    try {
        const aiResponse = await aiService.getAiIntent(messageText);
        const intent = aiResponse.intent;
        const params = aiResponse;

        if (from === process.env.ADMIN_PHONE_NUMBER) {
            switch (intent) {
                case 'admin_start_subscription':
                    await handleSubscribeUser(from, params);
                    return res.sendStatus(200);
                case 'admin_list_owners':
                    await handleListOwners(from);
                    return res.sendStatus(200);
                case 'admin_disable_owner':
                    await handleDisableOwner(from, params);
                    return res.sendStatus(200);
                case 'admin_broadcast_message':
                    await handleBroadcastMessage(from, params, messageText); // Pass raw text
                    return res.sendStatus(200);
                case 'admin_system_status':
                    await handleSystemStatus(from);
                    return res.sendStatus(200);
            }
        }

        const userQuery = `
            SELECT 'attendant' as role, o.subscription_end_date, attendant_id as user_id, a.lot_id FROM Attendants a
            JOIN ParkingLots l ON a.lot_id = l.lot_id
            JOIN Owners o ON l.owner_id = o.owner_id
            WHERE a.whatsapp_number = $1 AND a.is_active = TRUE
            UNION
            SELECT 'owner' as role, subscription_end_date, o.owner_id as user_id, l.lot_id FROM Owners o
            JOIN ParkingLots l ON o.owner_id = l.owner_id
            WHERE o.whatsapp_number = $1;
        `;
        const userResult = await db.query(userQuery, [from]);

        if (userResult.rows.length === 0) {
            const welcomeMessage = `Welcome to ParkEasy! 🚗\n\nTo start a FREE 14-day trial, please contact our support team or reply with your business name, and we will set up your account.`;
            await whatsapp.sendMessage(from, welcomeMessage);
            return res.sendStatus(200);
        }
        
        const { role, subscription_end_date, user_id, lot_id } = userResult.rows[0];

        if (!subscription_end_date || new Date(subscription_end_date) < new Date()) {
            await whatsapp.sendMessage(from, "❌ Your ParkEasy subscription has expired. Please contact the parking owner or support to renew the plan and continue service.");
            return res.sendStatus(200);
        }

        // Pass messageText to all handlers that might need it for fallback logic
        switch (intent) {
            case 'vehicle_check_in':
                await handleVehicleCheckIn(from, role, user_id, lot_id, params, messageText);
                break;
            case 'vehicle_checkout':
                await handleVehicleCheckout(from, lot_id, params, messageText);
                break;
            case 'get_status':
                await handleGetStatus(from, lot_id);
                break;
            case 'list_vehicles':
                await handleListVehicles(from, lot_id);
                break;
            case 'add_pass':
                await handleAddPass(from, role, lot_id, params, messageText);
                break;
            case 'remove_pass':
                await handleRemovePass(from, role, lot_id, params, messageText);
                break;
            case 'remove_attendant':
                await handleRemoveAttendant(from, role, lot_id, params, messageText);
                break;
            case 'add_attendant':
                await handleAddAttendant(from, role, lot_id, params, messageText);
                break;
            case 'view_passes':
                await handleViewPasses(from, role, lot_id);
                break;
            case 'get_report':
                await handleGetReport(from, role, lot_id, params);
                break;
            case 'get_help':
                await handleGetHelpList(from, role);
                break;
            case 'show_menu':
                await handleShowMenu(from, role);
                break;
            case 'fallback':
            default:
                await whatsapp.sendMessage(from, "I'm sorry, I didn't understand. Here are some options:");
                await handleShowMenu(from, role);
                break;
        }
    } catch (error) {
        logger.error('Error in webhook controller:', { message: error.message, stack: error.stack });
        await whatsapp.sendMessage(from, 'An internal server error occurred. Please try again.');
    }
    
    return res.sendStatus(200);
}

function verifyWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token && mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        logger.info("Webhook verified successfully!");
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
}

module.exports = {
    handleIncomingMessage,
    verifyWebhook,
};