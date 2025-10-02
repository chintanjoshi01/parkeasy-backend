// =================================================================
// ParkEasy: WhatsApp Controller v2.0 (Stable)
// =================================================================
// This file is the central nervous system of the application.
// It receives all incoming messages, identifies the user, and routes
// them to the appropriate logic flow (stateful conversation or stateless command).
// =================================================================

// -----------------------------------------------------------------
// Section 1: Imports & Setup
// -----------------------------------------------------------------
const logger = require('../utils/logger');
const db = require('../config/db');
const aiService = require('../services/aiService');
console.log("DEBUG aiService:", aiService);
const { getAiIntent, generateHelpMessage } = require('../services/aiService');

const whatsapp = require('../services/whatsappService');
const { isValidIndianVehicleNumber } = require('../utils/validators');


const attendantHandlers = require('../handlers/attendantHandlers');
const ownerHandlers = require('../handlers/ownerHandlers');
const adminHandlers = require('../handlers/adminHandlers');
const sharedHandlers = require('../handlers/sharedHandlers');

// -----------------------------------------------------------------
// Section 2: Main Webhook Handler
// -----------------------------------------------------------------
async function handleIncomingMessage(req, res) {
    // 2.1: Parse the incoming payload from Meta's Webhook
    const body = req.body;
    let messageText = '';
    let from = '';
    // if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
    //     const messageObject = body.entry[0].changes[0].value.messages[0];
    //     if (messageObject) {
    //         from = messageObject.from;
    //         if (messageObject.text) { messageText = messageObject.text.body; }
    //         else if (messageObject.interactive && messageObject.interactive.button_reply) { messageText = messageObject.interactive.button_reply.title; }
    //     }
    // } else {
    //     // This is not a standard message notification, so we ignore it.
    //     return res.sendStatus(404);
    // }

    // logger.info(`Received message "${messageText}" from ${from}`);

    try {

        if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
            const messageObject = body.entry[0].changes[0].value.messages[0];
            if (messageObject) {
                from = messageObject.from;
                const messageType = messageObject.type;

                if (messageType === 'text') {
                    messageText = messageObject.text.body;
                } else if (messageType === 'interactive') {
                    if (messageObject.interactive.type === 'button_reply') {
                        messageText = messageObject.interactive.button_reply.title;
                    } else if (messageObject.interactive.type === 'list_reply') {
                        messageText = messageObject.interactive.list_reply.title;
                    }
                }
            }
        }

        if (!from || !messageText) {
            // logger.warn("Received a message with no 'from' or 'messageText'. Skipping.", { payload: body });
            return res.sendStatus(200);
        }

        logger.info(`Received message "${messageText}" from ${from}`);


        // -----------------------------------------------------------------
        // Section 3: User Identification & Routing
        // -----------------------------------------------------------------

        // 3.1: Super Admin Check (Highest Priority)
        if (from === process.env.ADMIN_PHONE_NUMBER) {
            await handleAdminCommands(from, messageText);
            return res.sendStatus(200);
        }

        // 3.2: Identify User (Attendant, Owner, or New/Customer)
        // --- THIS IS THE PERMANENTLY FIXED USER QUERY ---
        const userQuery = `
            SELECT 'attendant' as role, a.attendant_id as user_id, a.lot_id, a.conversation_state, a.conversation_context, o.subscription_end_date FROM Attendants a
            JOIN ParkingLots l ON a.lot_id = l.lot_id JOIN Owners o ON l.owner_id = o.owner_id
            WHERE a.whatsapp_number = $1 AND a.is_active = TRUE
            UNION
            SELECT 'owner' as role, o.owner_id as user_id, l.lot_id, o.conversation_state, o.conversation_context, o.subscription_end_date FROM Owners o
            JOIN ParkingLots l ON o.owner_id = l.owner_id WHERE o.whatsapp_number = $1;
        `;
        const userResult = await db.query(userQuery, [from]);

        // 3.3: Handle Unregistered Users (New Leads & Existing Customers)
        if (userResult.rows.length === 0) {
            await handleUnregisteredUser(from, messageText);
            return res.sendStatus(200);
        }

        const user = userResult.rows[0];

        // 3.4: Subscription Enforcement for Registered Users
        if (!user.subscription_end_date || new Date(user.subscription_end_date) < new Date()) {
            await whatsapp.sendMessage(from, "❌ Your ParkEasy subscription has expired. Please contact support to continue service.");
            return res.sendStatus(200);
        }

        // 3.5: Main Logic Router
        await mainRouter(from, user, messageText);

    } catch (error) {
        logger.error('Critical Error in Main Controller:', { message: error.message, stack: error.stack });
        await whatsapp.sendMessage(from, 'An internal server error occurred. Our team has been notified.');
    }

    return res.sendStatus(200);
}

// =================================================================
// Section 4: Routers (The Core Logic Brain)
// =================================================================

async function mainRouter(from, user, messageText) {
    const { role, conversation_state: state, user_id } = user;

    // Universal cancel command that works in any state for any user
    if (messageText.toLowerCase() === 'cancel') {
        if (state !== 'IDLE') {
            await sharedHandlers.clearUserState(user_id);
        }
        return await whatsapp.sendMessage(from, "✅ Action cancelled. You can start again.");
    }

    // PRIORITY 1: Handle users already in a conversational flow.
    if (state && state !== 'IDLE') {
        switch (state) {
            case 'AWAITING_CUSTOMER_NUMBER':
                await attendantHandlers.handleCustomerNumberInput(from, user, messageText);
                break;
            case 'AWAITING_PAYMENT_TYPE':
            case 'AWAITING_PARKING_CONFIRMATION':
                await attendantHandlers.handleParkingConfirmation(from, user, messageText);
                break;
            case 'AWAITING_CHECKOUT_CONFIRMATION':
                if (messageText === 'Yes, Check Out') {
                    await attendantHandlers.handleInitialVehicleExit(from, user, [user.conversation_context.vehicle_number]);
                } else {
                    await sharedHandlers.clearUserState(user_id);
                    await whatsapp.sendMessage(from, "✅ Action cancelled.");
                }
                break;
            case 'AWAITING_EXIT_CONFIRMATION':
                await attendantHandlers.handleExitConfirmation(from, user, messageText);
                break;
            case 'AWAITING_PASS_TYPE_SELECTION':
                await attendantHandlers.handlePassTypeSelection(from, user, messageText);
                break;
            case 'AWAITING_PASS_CUSTOMER_NUMBER':
                await attendantHandlers.handlePassCustomerNumberInput(from, user, messageText);
                break;
            case 'AWAITING_PASS_PAYMENT_CONFIRM':
                await attendantHandlers.handlePassFinalConfirmation(from, user, messageText);
                break;

            // --- NEW OWNER CONVERSATION STATE ---
            case 'AWAITING_REMOVAL_CONFIRMATION':
                if (role === 'owner') {
                    await ownerHandlers.handleRemovalConfirmation(from, user, messageText);
                } else {
                    await sharedHandlers.clearUserState(user_id);
                    await whatsapp.sendMessage(from, "Invalid action.");
                }
                break;
                   case 'AWAITING_LIST_CHECKOUT':
                // Check if the reply is a number
                const listNumber = parseInt(messageText);
                if (!isNaN(listNumber) && listNumber > 0) {
                    // It is a number, so treat it as an exit command
                    await attendantHandlers.handleInitialVehicleExit(from, user, [messageText]);
                } else {
                    // It's not a number, so the user wants to do something else.
                    // Clear their state and re-process the command from idle.
                    await sharedHandlers.clearUserState(user);
                    await handleIdleUserCommands(from, user, messageText);
                }
                break;
            default:
                await sharedHandlers.clearUserState(user_id);
                await whatsapp.sendMessage(from, "Something went wrong, I'm resetting our conversation. Please start again.");
                break;
        }
    }
    // PRIORITY 2: Handle IDLE users starting a new action.
    else {
        await handleIdleUserCommands(from, user, messageText);
    }
}

async function handleIdleUserCommands(from, user, messageText) {
    const { role } = user;
    const upperText = messageText.toUpperCase().trim();
    const standardizedText = upperText.replace(/\s/g, '');

    // --- Fast-path for simple, universal commands that don't need AI ---
    if (upperText === 'LIST' || upperText === 'LIST VEHICLES') {
        return await sharedHandlers.handleListVehicles(from, user);
    }
    if (upperText === 'STATUS') {
        return await sharedHandlers.handleGetStatus(from, user);
    }
    if (isValidIndianVehicleNumber(standardizedText)) {
        return await attendantHandlers.handleInitialVehicleEntry(from, user, standardizedText);
    }
    if (upperText.startsWith('OUT')) {
        const identifiers = messageText.trim().split(' ').slice(1).join('').split(',').filter(id => id);
        if (identifiers.length > 0) {
            return await sharedHandlers.handleVehicleCheckout(from, user, { identifiers });
        } else {
            return await whatsapp.sendMessage(from, "Please specify a vehicle or list number. Example: `out 2`");
        }
    }
    if (upperText.startsWith('PASS')) {
        const vehicleNumber = messageText.trim().split(' ')[1];
        if (vehicleNumber) return await attendantHandlers.handleStartPassCreation(from, user, vehicleNumber);
        else return await whatsapp.sendMessage(from, "Please specify a vehicle number. Example: `pass GJ01AB1234`");
    }

    // --- If no fast-path matches, use the full AI for complex/owner commands ---
    const aiResponse = await getAiIntent(messageText);
    const intent = aiResponse.intent;
    const params = aiResponse;

    switch (intent) {
        case 'show_menu':
            await ownerHandlers.handleShowMenu(from, role);
            break;
        case 'get_help':
            await ownerHandlers.handleGetHelpList(from, user, params);
            break;

        // --- OWNER-ONLY COMMANDS ROUTER ---
        case 'add_pass': case 'remove_pass': case 'remove_attendant': case 'manage_attendant':
        case 'add_attendant': case 'view_passes': case 'get_report':
        case 'set_pricing_model': case 'set_tiered_rate': case 'set_flat_rate':
        case 'view_rates': case 'set_pass_rate': case 'list_attendants': case 'activate_attendant':
            if (user.role === 'owner') {
                // --- THIS IS THE CORRECTED LOGIC ---
                // Convert snake_case (like view_passes) to camelCase (like viewPasses)
                const camelCaseIntent = intent.replace(/_([a-z])/g, g => g[1].toUpperCase());
                // Prepend "handle" to get the full function name
                const handlerName = `handle${camelCaseIntent.charAt(0).toUpperCase() + camelCaseIntent.slice(1)}`;

                if (ownerHandlers[handlerName]) {
                    await ownerHandlers[handlerName](from, user, params, messageText);
                } else {
                    logger.error(`Handler not found for owner intent: ${intent} (tried to call ${handlerName})`);
                    await whatsapp.sendMessage(from, "Sorry, that owner feature is not available.");
                }
            } else {
                await whatsapp.sendMessage(from, "I'm sorry, that command is for owners only.");
            }
            break;

        case 'fallback':
        default:
            // ROUTE 4: THE VEHICLE NUMBER CHECK (The final major check)
            if (isValidIndianVehicleNumber(standardizedText)) {
                return await attendantHandlers.handleInitialVehicleEntry(from, user, standardizedText);
            }

            // ROUTE 5: FINAL FALLBACK
            let fallbackMessage = "I'm sorry, I didn't understand. Here are some options:";
            if (role === 'attendant') {
                fallbackMessage = `❌ Invalid command or vehicle number format ("${messageText}").\n\nPlease try again with the correct format (e.g., \`GJ05RT1234\`) or type \`menu\`.`;
            }
            await whatsapp.sendMessage(from, fallbackMessage);
            if (role === 'owner') {
                await ownerHandlers.handleShowMenu(from, role);
            }
            break;
    }
}

async function handleAdminCommands(from, messageText) {
    const aiResponse = await aiService.getAiIntent(messageText);
    const intent = aiResponse.intent;
    const params = aiResponse;
    switch (intent) {
        case 'admin_start_subscription': await adminHandlers.handleSubscribeUser(from, params); break;
        case 'admin_list_owners': await adminHandlers.handleListOwners(from); break;
        case 'admin_disable_owner': await adminHandlers.handleDisableOwner(from, params); break;
        case 'admin_broadcast_message': await adminHandlers.handleBroadcastMessage(from, params); break;
        case 'admin_system_status': await adminHandlers.handleSystemStatus(from); break;
        default:
            // If it's not an admin command, maybe it's an owner command the admin wants to use
            logger.info(`Admin command not found for intent: ${intent}. Treating as owner command.`);
            const adminAsOwnerResult = await db.query(`SELECT 'owner' as role, o.owner_id as user_id, l.lot_id FROM Owners o JOIN ParkingLots l ON o.owner_id = l.owner_id WHERE o.whatsapp_number = $1;`, [from]);
            if (adminAsOwnerResult.rows.length > 0) {
                await handleIdleUserCommands(from, adminAsOwnerResult.rows[0], messageText);
            } else {
                await whatsapp.sendMessage(from, "I didn't recognize that admin command.");
            }
            break;
    }
}

async function handleUnregisteredUser(from, messageText) {
    const customerQuery = `SELECT t.vehicle_number, t.status, t.vehicle_state FROM Customers c JOIN Transactions t ON c.vehicle_number = t.vehicle_number WHERE c.customer_whatsapp_number = $1 ORDER BY t.start_time DESC LIMIT 1`;
    const customerResult = await db.query(customerQuery, [from]);

    if (customerResult.rows.length > 0 && customerResult.rows[0].vehicle_state === 'INSIDE') {
        const status = customerResult.rows[0];
        await whatsapp.sendMessage(from, `Welcome back! Your vehicle ${status.vehicle_number} is currently parked. Status: ${status.status}`);
    } else {
        if (messageText.toLowerCase() === 'tell me more') {
            const moreInfo = `ParkEasy helps parking owners stop cash theft and manage their entire lot from a phone.\n\nAttendants use a simple, guided WhatsApp chat to log every vehicle's entry and exit. Owners get real-time notifications and daily reports.\n\nIt's fast, secure, and requires no expensive hardware.\n\nVisit our website to learn more:\nhttps://parkeasyai.in`;
            await whatsapp.sendMessage(from, moreInfo);
        } else if (messageText.toLowerCase() === 'request a call') {
            await whatsapp.sendMessage(from, `Thank you for your interest! Our team will call you at this number shortly.`);
            await whatsapp.sendMessage(process.env.ADMIN_PHONE_NUMBER, `🔔 New Lead!\nNumber: ${from}\nRequested a call.`);
        } else {
            const welcomeMessage = {
                type: 'button',
                body: { text: `Welcome to ParkEasy! 🚗\n\nWe provide smart WhatsApp solutions for parking management. How can we help you today?` },
                action: { buttons: [{ type: 'reply', reply: { id: 'know_more', title: 'Tell Me More' } }, { type: 'reply', reply: { id: 'call_me', title: 'Request a Call' } }] }
            };
            await whatsapp.sendMessage(from, welcomeMessage);
        }
    }
}

// =================================================================
// Section 8: Webhook Verification
// =================================================================
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