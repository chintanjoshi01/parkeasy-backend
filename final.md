ParkEasy - AI-Powered WhatsApp Parking Management System: Developer Documentation v3.1 (Complete)

Document Version: 3.1 (AI-Integrated, Subscription-Managed, Full Code)
Date: September 20, 2025
1. Project Overview

ParkEasy is a SaaS (Software as a Service) platform designed to revolutionize India's unorganized parking sector. It provides parking lot owners and their attendants with a hardware-free, intelligent assistant on WhatsApp to manage daily operations. The system is powered by Google's Gemini AI to understand natural language (English and Hinglish), providing a flexible and user-friendly experience.

Core Objectives:

    Provide a conversational interface that understands user intent rather than rigid commands.

    Eliminate revenue leakage through transparent, real-time logging.

    Automate the entire business lifecycle, including user onboarding, subscription management, and customer notifications.

    Ensure data integrity through robust validation for vehicle numbers and phone numbers.

2. System Architecture

The application is built on a modern, scalable architecture:

    Frontend Interface: WhatsApp (via the Meta Business API).

    Backend Server: A single Node.js application built with the Express.js framework. It serves as the webhook receiver and contains all business logic.

    Database: A PostgreSQL database for all persistent data storage.

    AI Brain (NLU): Google's Gemini 1.5 Flash model, accessed via the @google/generative-ai SDK. This is implemented in a dedicated module (gemini_ai.js).

    Scheduled Tasks: A standalone Node.js script (daily_report.js) designed to be executed as a daily cron job.

Core Logic Flow:

    A user sends a message on WhatsApp.

    Meta's API forwards the message to the /webhook endpoint on the Node.js server.

    The server first checks if the user is new (onboarding) or if they are an existing user with an expired subscription (access control).

    For valid users, the server sends the raw message text to the Gemini API (gemini_ai.js).

    Gemini processes the text against a specialized system prompt and returns a structured JSON object with the user's intent and extracted parameters.

    The server uses a switch statement on the intent to call the appropriate handler function (e.g., handleVehicleCheckIn).

    The handler function executes validation, database queries, and business logic.

    The handler function calls a utility (sendWhatsAppMessage or sendWhatsAppTemplate) to send a response back to the user via the Meta API.

3. Getting Started: Setup Guide
3.1. Prerequisites

    Node.js (v18 or later)

    PostgreSQL Server

3.2. Installation

    Clone the repository.

    Navigate to the project directory: cd parkeasy-backend

    Install dependencies: npm install express pg dotenv axios @google/generative-ai

3.3. Environment Configuration (.env)

Create a .env file in the root directory and populate it with the following keys:
code .env
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END

    
# PostgreSQL Database Configuration
DB_USER=postgres
DB_HOST=localhost
DB_DATABASE=parkeasy_db
DB_PASSWORD=your_postgres_password
DB_PORT=5432

# Meta WhatsApp API Credentials
META_API_TOKEN=your_temporary_or_permanent_access_token
SENDER_PHONE_ID=your_whatsapp_business_phone_number_id
VERIFY_TOKEN=a_secret_string_you_create_for_webhook_verification

# Google Gemini API Key
GEMINI_API_KEY=your_google_ai_studio_api_key

# Application Admin Number
ADMIN_PHONE_NUMBER=91... (Your 12-digit admin WhatsApp number)

# Application Port
PORT=3000

  

3.4. Database Schema Setup

Execute the following SQL commands in your PostgreSQL database to create the required tables and constraints.
code SQL
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END

    
-- Create Tables
CREATE TABLE Owners (
    owner_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    whatsapp_number VARCHAR(20) UNIQUE NOT NULL,
    subscription_plan VARCHAR(50) DEFAULT 'TRIAL',
    subscription_start_date TIMESTAMPTZ,
    subscription_end_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ParkingLots (
    lot_id SERIAL PRIMARY KEY,
    owner_id INTEGER REFERENCES Owners(owner_id),
    lot_name VARCHAR(255) NOT NULL,
    hourly_rate INTEGER NOT NULL
);

CREATE TABLE Attendants (
    attendant_id SERIAL PRIMARY KEY,
    lot_id INTEGER REFERENCES ParkingLots(lot_id),
    name VARCHAR(255) NOT NULL,
    whatsapp_number VARCHAR(20) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE Transactions (
    transaction_id SERIAL PRIMARY KEY,
    lot_id INTEGER REFERENCES ParkingLots(lot_id),
    attendant_id INTEGER, -- Nullable to allow owner operations
    vehicle_number VARCHAR(20) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    total_fee INTEGER,
    status VARCHAR(50) NOT NULL,
    customer_whatsapp_number VARCHAR(20)
);

CREATE TABLE Passes (
    pass_id SERIAL PRIMARY KEY,
    lot_id INTEGER REFERENCES ParkingLots(lot_id),
    vehicle_number VARCHAR(20) NOT NULL,
    expiry_date TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE',
    customer_whatsapp_number VARCHAR(20),
    UNIQUE(lot_id, vehicle_number)
);

  

3.5. Running the Application

    Main Server: node index.js

    Daily Tasks (Manual Run): node daily_report.js

4. Codebase

This section contains the complete and final code for all application files.
4.1. AI Module (gemini_ai.js)

This module is the "brain" of the application.
code JavaScript
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END

    
// gemini_ai.js

require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize the Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});

const systemPrompt = `
You are a Natural Language Understanding AI for ParkEasy, a WhatsApp-based parking management system. Your SOLE JOB is to analyze user text and convert it into a structured JSON command that our backend system can process.

**RULES:**
1.  **NEVER respond conversationally.**
2.  **ONLY output a single, valid JSON object.**
3.  You MUST detect the primary language of the user's text (options: 'en' for English, 'hi' for Hindi/Hinglish) and include it in the JSON as a \`language\` field.
4.  Standardize vehicle numbers (e.g., "GJ05RT4567"). **Extract phone numbers as the user provides them (10 or 12 digits).**
5.  If the text is ambiguous or does not match any intent, you MUST output: \`{"intent": "fallback", "text": "[user's original text]"}\`.

**INTENT & PARAMETER DEFINITIONS:**

**1. Intent: \`vehicle_check_in\`**
   - **Description:** A vehicle is entering the parking lot.
   - **Parameters:**
     - \`vehicle_number\` (string, required)
     - \`customer_number\` (string, optional)
     - \`language\` (string, required, 'en' or 'hi')
   - **Examples:** "in GJ05RT4567", "gaadi aayi GJ 05 RT 4567 customer 9876543210"

**2. Intent: \`vehicle_checkout\`**
   - **Description:** A vehicle is leaving the lot.
   - **Parameters:**
     - \`identifier\` (string, required) - This can be a vehicle number OR a list number.
     - \`payment_method\` (string, required, default: "cash")
   - **Examples:** "out 2 cash", "gaadi GJ05RT4567 out karo cash se"

**3. Intent: \`get_status\`**
   - **Description:** User wants to know how many cars are parked.
   - **Parameters:** None
   - **Examples:** "status", "kitni gaadi hai?"

**4. Intent: \`list_vehicles\`**
   - **Description:** User wants a list of all parked cars.
   - **Parameters:** None
   - **Examples:** "list", "show all cars"

**5. Intent: \`add_pass\`**
   - **Description:** Owner wants to add a monthly pass.
   - **Parameters:**
     - \`vehicle_number\` (string, required)
     - \`duration_days\` (integer, required)
     - \`customer_number\` (string, optional)
     - \`language\` (string, required, 'en' or 'hi')
   - **Examples:** "addpass GJ05RT4567 30 customer 9876543210", "30 din ka pass bana do GJ05RT4567"

**6. Intent: \`remove_attendant\`**
   - **Description:** Owner wants to deactivate an attendant.
   - **Parameters:**
     - \`attendant_number\` (string, required)
   - **Examples:** "remove attendant 9876543210", "deactivate 9876543210"
     
**7. Intent: \`add_attendant\`**
   - **Description:** Owner wants to register a new attendant.
   - **Parameters:**
     - \`attendant_name\` (string, required)
     - \`attendant_number\` (string, required)
   - **Examples:** "add attendant Suresh 9876543210", "Suresh ko add karo 9876543210"

**8. Intent: \`view_passes\`**
   - **Description:** Owner wants to see a list of active passes.
   - **Parameters:** None
   - **Examples:** "viewpass", "show all passes"

**9. Intent: \`get_report\`**
   - **Description:** This is a specific request for a daily business summary.
   - **Parameters:**
     - \`date_period\` (string, optional, can be "today" or "yesterday")
   - **Examples:** "report", "show me today's report", "kal ka report do"

**10. Intent: \`show_menu\`**
    - **Description:** User is asking for the main menu, help, or doesn't know what to do.
    - **Parameters:** None
    - **Examples:** "help", "madad", "menu"

**11. Intent: \`start_subscription\`**
    - **Description:** (Admin Only) Creates a new owner or renews a subscription.
    - **Parameters:**
      - \`owner_name\` (string, required for new users)
      - \`owner_number\` (string, required)
      - \`lot_name\` (string, required for new users)
      - \`plan_name\` (string, optional, defaults to "Growth")
      - \`duration_days\` (integer, optional, defaults to 30 for paid, 14 for trial)
    - **Examples:** "subscribe new owner Park Plaza with number 9876543210 on the lot Plaza Parking", "renew subscription for 9876543210 for 30 days"

Now, analyze the following user text and provide only the JSON output.
`;

async function getAiIntent(userText) {
    try {
        const fullPrompt = `${systemPrompt}\n\nUser Text: "${userText}"`;
        
        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const jsonResponse = response.text().trim().replace(/^```json\s*|```$/g, '');

        return JSON.parse(jsonResponse);

    } catch (error) {
        console.error("Error getting intent from Gemini:", error);
        return { intent: "fallback", text: userText };
    }
}

module.exports = { getAiIntent };

  

4.2. Main Server Application (index.js)

This file contains all the business logic, webhook handlers, and database interactions.
code JavaScript
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END

    
// index.js (Version 17.1 - Final, Phone Normalization, Subscription, Complete)

// 1. Import necessary libraries
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const { getAiIntent } = require('./gemini_ai');

// 2. Initialize Express App & DB Pool
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// 3. Helper Functions
function isValidIndianVehicleNumber(number) {
    if (!number || typeof number !== 'string') return false;
    const regex = /^[A-Z]{2}[0-9]{1,2}(?:[A-Z])?(?:[A-Z]*)?[0-9]{4}$/;
    return regex.test(number.toUpperCase());
}

function normalizePhoneNumber(phoneStr) {
    if (!phoneStr) return null;
    const digitsOnly = phoneStr.replace(/\D/g, '');
    if (digitsOnly.length === 10) {
        return `91${digitsOnly}`;
    }
    if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
        return digitsOnly;
    }
    if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
        return `91${digitsOnly.substring(1)}`;
    }
    return null;
}

async function sendWhatsAppMessage(recipientNumber, messagePayload) {
    const META_API_TOKEN = process.env.META_API_TOKEN;
    const SENDER_PHONE_ID = process.env.SENDER_PHONE_ID;
    const url = `https://graph.facebook.com/v19.0/${SENDER_PHONE_ID}/messages`;
    let payload;
    if (typeof messagePayload === 'string') {
        payload = { messaging_product: 'whatsapp', to: recipientNumber, text: { body: messagePayload } };
    } else {
        payload = { messaging_product: 'whatsapp', to: recipientNumber, type: 'interactive', interactive: messagePayload };
    }
    const headers = { 'Authorization': `Bearer ${META_API_TOKEN}`, 'Content-Type': 'application/json' };
    try {
        await axios.post(url, payload, { headers });
        console.log(`Successfully sent message to ${recipientNumber}`);
    } catch (error) {
        console.error('Error sending WhatsApp message:', error.response ? error.response.data : error.message);
    }
}

// 4. Webhook Verification Endpoint
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token && mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        console.log("Webhook verified successfully!");
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// 5. Main Webhook Endpoint
app.post('/webhook', async (req, res) => {
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
    
    console.log(`Received message "${messageText}" from ${from}`);
    
    try {
        const aiResponse = await getAiIntent(messageText);
        const intent = aiResponse.intent;
        const params = aiResponse;

        if (intent === 'start_subscription' && from === process.env.ADMIN_PHONE_NUMBER) {
            await handleSubscribeUser(from, params);
            return res.sendStatus(200);
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
        const userResult = await pool.query(userQuery, [from]);

        if (userResult.rows.length === 0) {
            const welcomeMessage = `Welcome to ParkEasy! 🚗\n\nTo start a FREE 14-day trial, please contact our support team or reply with your business name, and we will set up your account.`;
            await sendWhatsAppMessage(from, welcomeMessage);
            return res.sendStatus(200);
        }
        
        const { role, subscription_end_date, user_id, lot_id } = userResult.rows[0];

        if (!subscription_end_date || new Date(subscription_end_date) < new Date()) {
            await sendWhatsAppMessage(from, "❌ Your ParkEasy subscription has expired. Please contact the parking owner or support to renew the plan and continue service.");
            return res.sendStatus(200);
        }

        switch (intent) {
            case 'vehicle_check_in':
                await handleVehicleCheckIn(from, role, user_id, lot_id, params);
                break;
            case 'vehicle_checkout':
                await handleVehicleCheckout(from, lot_id, params);
                break;
            case 'get_status':
                await handleGetStatus(from, lot_id);
                break;
            case 'list_vehicles':
                await handleListVehicles(from, lot_id);
                break;
            case 'add_pass':
                await handleAddPass(from, role, lot_id, params);
                break;
            case 'remove_attendant':
                await handleRemoveAttendant(from, role, lot_id, params);
                break;
            case 'add_attendant':
                await handleAddAttendant(from, role, lot_id, params);
                break;
            case 'view_passes':
                await handleViewPasses(from, role, lot_id);
                break;
            case 'get_report':
                await handleGetReport(from, role, lot_id, params);
                break;
            case 'show_menu':
                await handleShowMenu(from, role);
                break;
            case 'fallback':
            default:
                await sendWhatsAppMessage(from, "I'm sorry, I didn't understand. Here are some options:");
                await handleShowMenu(from, role);
                break;
        }
    } catch (error) {
        console.error('Error processing command:', error);
        await sendWhatsAppMessage(from, 'An internal server error occurred. Please try again.');
    }
    
    return res.sendStatus(200);
});

// --- 6. Handler Functions ---

async function handleSubscribeUser(adminFrom, params) {
    const { owner_name, owner_number, lot_name, plan_name = 'Growth', duration_days = 14 } = params;
    
    const normalizedOwnerNumber = normalizePhoneNumber(owner_number);
    if (!normalizedOwnerNumber) return await sendWhatsAppMessage(adminFrom, `❌ Admin Error: The provided number "${owner_number}" is not a valid 10 or 12-digit phone number.`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const existingOwner = await client.query('SELECT owner_id FROM Owners WHERE whatsapp_number = $1', [normalizedOwnerNumber]);
        
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(startDate.getDate() + parseInt(duration_days));

        if (existingOwner.rows.length > 0) {
            const ownerId = existingOwner.rows[0].owner_id;
            await client.query(
                `UPDATE Owners SET subscription_start_date = $1, subscription_end_date = $2, subscription_plan = $3 WHERE owner_id = $4`,
                [startDate, endDate, plan_name, ownerId]
            );
            await client.query('COMMIT');
            await sendWhatsAppMessage(adminFrom, `✅ Success! Subscription for ${normalizedOwnerNumber} has been renewed/updated for ${duration_days} days.`);
            await sendWhatsAppMessage(normalizedOwnerNumber, `🎉 Your ParkEasy subscription has been successfully renewed! Your service is active until ${endDate.toLocaleDateString('en-GB')}.`);
        } else {
            if (!owner_name || !lot_name) return await sendWhatsAppMessage(adminFrom, "❌ Admin Error: For new users, I need the owner's name and lot name.");
            
            const ownerQuery = `INSERT INTO Owners (name, whatsapp_number, subscription_plan, subscription_start_date, subscription_end_date) VALUES ($1, $2, $3, $4, $5) RETURNING owner_id`;
            const ownerResult = await client.query(ownerQuery, [owner_name, normalizedOwnerNumber, plan_name, startDate, endDate]);
            const newOwnerId = ownerResult.rows[0].owner_id;

            const lotQuery = `INSERT INTO ParkingLots (owner_id, lot_name, hourly_rate) VALUES ($1, $2, $3)`;
            await client.query(lotQuery, [newOwnerId, lot_name, 30]);

            await client.query('COMMIT');
            await sendWhatsAppMessage(adminFrom, `✅ Success! Owner "${owner_name}" and lot "${lot_name}" created with a ${duration_days}-day subscription.`);
            await sendWhatsAppMessage(normalizedOwnerNumber, `🎉 Congratulations! Your ParkEasy account for "${lot_name}" is now active until ${endDate.toLocaleDateString('en-GB')}! Type 'menu' to get started.`);
        }
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Error subscribing user:", e);
        if (e.code === '23505') {
             await sendWhatsAppMessage(adminFrom, `❌ Admin Error: An owner with the number ${normalizedOwnerNumber} already exists.`);
        } else {
            await sendWhatsAppMessage(adminFrom, `❌ Admin Error: Failed to subscribe user. Reason: ${e.message}`);
        }
    } finally {
        client.release();
    }
}

async function handleVehicleCheckIn(from, role, user_id, lot_id, params) {
    const { vehicle_number, customer_number, language } = params;
    if (!vehicle_number) return await sendWhatsAppMessage(from, "❌ AI Error: I couldn't identify a vehicle number in your message. Please try again.");
    
    if (!isValidIndianVehicleNumber(vehicle_number)) {
        let errorMessage;
        if (language === 'hi') {
            errorMessage = `❌ "${vehicle_number}" का वाहन नंबर प्रारूप गलत है।\nकृपया GJ05RT1234 जैसा प्रारूप इस्तेमाल करें।`;
        } else {
            errorMessage = `❌ Invalid vehicle number format for "${vehicle_number}".\nPlease use the format like GJ05RT1234.`;
        }
        return await sendWhatsAppMessage(from, errorMessage);
    }

    const checkResult = await pool.query(`SELECT transaction_id FROM Transactions WHERE lot_id = $1 AND vehicle_number = $2 AND status = 'PARKED'`, [lot_id, vehicle_number]);
    if (checkResult.rows.length > 0) {
        return await sendWhatsAppMessage(from, `❌ Error: ${vehicle_number} is already marked as PARKED.`);
    }
    
    const attendantId = (role === 'attendant') ? user_id : null;
    const normalizedCustomerNumber = normalizePhoneNumber(customer_number);

    await pool.query(`INSERT INTO Transactions (lot_id, attendant_id, vehicle_number, start_time, status, customer_whatsapp_number) VALUES ($1, $2, $3, NOW(), 'PARKED', $4)`, [lot_id, attendantId, vehicle_number, normalizedCustomerNumber]);
    await sendWhatsAppMessage(from, `✅ ${vehicle_number} parked at ${new Date().toLocaleTimeString('en-IN')}.`);
}

async function handleVehicleCheckout(from, lot_id, params) {
    const { identifier } = params;
    if (!identifier) return await sendWhatsAppMessage(from, "❌ AI Error: I couldn't identify a vehicle to check out. Please provide a vehicle number or a list number.");

    let vehicleNumber = identifier.toUpperCase();
    const listNumber = parseInt(identifier);
    if (!isNaN(listNumber) && listNumber > 0) {
        const listResult = await pool.query(`SELECT vehicle_number FROM Transactions WHERE lot_id = $1 AND status = 'PARKED' ORDER BY start_time ASC`, [lot_id]);
        if (listResult.rows.length >= listNumber) {
            vehicleNumber = listResult.rows[listNumber - 1].vehicle_number;
            await sendWhatsAppMessage(from, `ℹ️ Checking out ${vehicleNumber} from list position ${listNumber}.`);
        } else {
            return await sendWhatsAppMessage(from, `❌ Error: Invalid list number. There are only ${listResult.rows.length} vehicles parked.`);
        }
    }

    const transactionResult = await pool.query(`SELECT transaction_id, start_time, customer_whatsapp_number FROM Transactions WHERE lot_id = $1 AND vehicle_number = $2 AND status = 'PARKED' ORDER BY start_time DESC LIMIT 1`, [lot_id, vehicleNumber]);
    if (transactionResult.rows.length === 0) return await sendWhatsAppMessage(from, `❌ Error: Vehicle ${vehicleNumber} not found or already checked out.`);
    
    const transaction = transactionResult.rows[0];
    const passResult = await pool.query(`SELECT pass_id FROM Passes WHERE lot_id = $1 AND vehicle_number = $2 AND status = 'ACTIVE' AND expiry_date >= NOW()`, [lot_id, vehicleNumber]);
    if (passResult.rows.length > 0) {
        await pool.query(`UPDATE Transactions SET end_time = NOW(), status = 'COMPLETED_PASS' WHERE transaction_id = $1`, [transaction.transaction_id]);
        await sendWhatsAppMessage(from, `👍 ${vehicleNumber} is a Pass Holder. Exit logged.`);
    } else {
        const ownerResult = await pool.query('SELECT o.whatsapp_number, p.lot_name FROM Owners o JOIN ParkingLots p ON o.owner_id = p.owner_id WHERE p.lot_id = $1', [lot_id]);
        const lotResult = await pool.query('SELECT hourly_rate FROM ParkingLots WHERE lot_id = $1', [lot_id]);
        const { whatsapp_number: ownerNumber, lot_name: lotName } = ownerResult.rows[0] || {};
        const { hourly_rate: hourlyRate } = lotResult.rows[0] || {};

        if (!hourlyRate) return await sendWhatsAppMessage(from, `❌ Error: Parking rate not set for this lot.`);
        
        const startTime = new Date(transaction.start_time);
        const endTime = new Date();
        const durationHours = Math.max(1, Math.ceil((endTime - startTime) / (1000 * 60 * 60)));
        const fee = durationHours * hourlyRate;

        await pool.query(`UPDATE Transactions SET end_time = NOW(), total_fee = $1, status = 'COMPLETED_CASH' WHERE transaction_id = $2`, [fee, transaction.transaction_id]);
        await sendWhatsAppMessage(from, `👍 Cash payment of ₹${fee} logged for ${vehicleNumber}.`);
        if (ownerNumber && from !== ownerNumber) await sendWhatsAppMessage(ownerNumber, `💰 Cash payment of ₹${fee} logged for ${vehicleNumber}.`);
        if (transaction.customer_whatsapp_number) {
            await sendWhatsAppMessage(transaction.customer_whatsapp_number, `Thank you for parking at ${lotName}!\nTotal Amount: ₹${fee}.\n\nPowered by ParkEasy`);
        }
    }
}

async function handleGetStatus(from, lot_id) {
    const statusResult = await pool.query(`SELECT COUNT(*) as parked_count FROM Transactions WHERE lot_id = $1 AND status = 'PARKED'`, [lot_id]);
    const parkedCount = statusResult.rows[0].parked_count;
    await sendWhatsAppMessage(from, `📊 Currently ${parkedCount} vehicles are parked.`);
}

async function handleListVehicles(from, lot_id) {
    const listResult = await pool.query(`SELECT vehicle_number, start_time FROM Transactions WHERE lot_id = $1 AND status = 'PARKED' ORDER BY start_time ASC`, [lot_id]);
    if (listResult.rows.length === 0) return await sendWhatsAppMessage(from, "✅ No vehicles are currently parked.");
    
    let replyMessage = "--- Currently Parked Vehicles ---\n";
    listResult.rows.forEach((vehicle, index) => {
        const parkedTime = new Date(vehicle.start_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        replyMessage += `${index + 1}. ${vehicle.vehicle_number} (At: ${parkedTime})\n`;
    });
    await sendWhatsAppMessage(from, replyMessage);
}

async function handleAddPass(from, role, lot_id, params) {
    if (role !== 'owner') return await sendWhatsAppMessage(from, "❌ This command can only be used by an Owner.");
    const { vehicle_number, duration_days, customer_number, language } = params;
    if (!vehicle_number || !duration_days) return await sendWhatsAppMessage(from, "❌ AI Error: I'm missing the vehicle number or the pass duration.");

    if (!isValidIndianVehicleNumber(vehicle_number)) {
        let errorMessage;
        if (language === 'hi') {
            errorMessage = `❌ "${vehicle_number}" का वाहन नंबर प्रारूप गलत है।\nकृपया GJ05RT1234 जैसा प्रारूप इस्तेमाल करें।`;
        } else {
            errorMessage = `❌ Invalid vehicle number format for "${vehicle_number}".\nPlease use the format like GJ05RT1234.`;
        }
        return await sendWhatsAppMessage(from, errorMessage);
    }
    
    const normalizedCustomerNumber = normalizePhoneNumber(customer_number);

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + parseInt(duration_days));
    await pool.query(`INSERT INTO Passes (lot_id, vehicle_number, expiry_date, status, customer_whatsapp_number) VALUES ($1, $2, $3, 'ACTIVE', $4) ON CONFLICT (lot_id, vehicle_number) DO UPDATE SET expiry_date = $3, status = 'ACTIVE', customer_whatsapp_number = $4`, [lot_id, vehicle_number, expiryDate, normalizedCustomerNumber]);
    await sendWhatsAppMessage(from, `✅ Pass added for ${vehicle_number}. Valid until ${expiryDate.toLocaleDateString('en-GB')}.`);
}

async function handleRemoveAttendant(from, role, lot_id, params) {
    if (role !== 'owner') return await sendWhatsAppMessage(from, "❌ This command can only be used by an Owner.");
    const { attendant_number } = params;
    if (!attendant_number) return await sendWhatsAppMessage(from, "❌ AI Error: I'm missing the attendant's number to remove.");

    const normalizedAttendantNumber = normalizePhoneNumber(attendant_number);
    if (!normalizedAttendantNumber) return await sendWhatsAppMessage(from, `❌ Invalid phone number format for "${attendant_number}".`);

    const result = await pool.query(`UPDATE Attendants SET is_active = FALSE WHERE whatsapp_number = $1 AND lot_id = $2`, [normalizedAttendantNumber, lot_id]);
    if (result.rowCount > 0) await sendWhatsAppMessage(from, `✅ Attendant ${normalizedAttendantNumber} has been deactivated.`);
    else await sendWhatsAppMessage(from, `❌ Attendant with that number not found in your lot.`);
}

async function handleAddAttendant(from, role, lot_id, params) {
    if (role !== 'owner') return await sendWhatsAppMessage(from, "❌ This command can only be used by an Owner.");
    const { attendant_name, attendant_number } = params;
    if (!attendant_name || !attendant_number) return await sendWhatsAppMessage(from, "❌ AI Error: I'm missing the attendant's name or number.");

    const normalizedAttendantNumber = normalizePhoneNumber(attendant_number);
    if (!normalizedAttendantNumber) return await sendWhatsAppMessage(from, `❌ Invalid phone number format for "${attendant_number}".`);

    try {
        await pool.query(`INSERT INTO Attendants (lot_id, name, whatsapp_number) VALUES ($1, $2, $3)`, [lot_id, attendant_name, normalizedAttendantNumber]);
        await sendWhatsAppMessage(from, `✅ Attendant "${attendant_name}" added successfully.`);
    } catch (err) {
        if (err.code === '23505') await sendWhatsAppMessage(from, `❌ Error: An attendant with number ${normalizedAttendantNumber} is already registered.`);
        else { console.error("Error adding attendant:", err); await sendWhatsAppMessage(from, "❌ An error occurred while adding the attendant."); }
    }
}

async function handleViewPasses(from, role, lot_id) {
    if (role !== 'owner') return await sendWhatsAppMessage(from, "❌ This command can only be used by an Owner.");
    const passesResult = await pool.query(`SELECT vehicle_number, expiry_date FROM Passes WHERE lot_id = $1 AND status = 'ACTIVE' AND expiry_date >= NOW() ORDER BY expiry_date ASC`, [lot_id]);
    if (passesResult.rows.length === 0) return await sendWhatsAppMessage(from, "--- No Active Passes ---");
    
    let replyMessage = "--- Active Passes ---\n";
    passesResult.rows.forEach((pass, index) => {
        const expiry = new Date(pass.expiry_date).toLocaleDateString('en-GB');
        replyMessage += `${index + 1}. ${pass.vehicle_number} (Expires: ${expiry})\n`;
    });
    await sendWhatsAppMessage(from, replyMessage);
}

async function handleShowMenu(from, role) {
    if (role === 'owner') {
        const ownerMenu = { 
            type: 'button', 
            body: { text: 'Welcome, Owner! I am your AI assistant. Please select an option.' }, 
            action: { 
                buttons: [ 
                    { type: 'reply', reply: { id: 'owner_list_vehicles', title: 'list vehicles' } },
                    { type: 'reply', reply: { id: 'owner_view_passes', title: 'view passes' } },
                    { type: 'reply', reply: { id: 'owner_get_report', title: 'report' } }
                ] 
            } 
        };
        await sendWhatsAppMessage(from, ownerMenu);
    } else { // Attendant
        const attendantMenu = { 
            type: 'button', 
            body: { text: 'Welcome! I am your AI assistant. Please select an option.' }, 
            action: { 
                buttons: [ 
                    { type: 'reply', reply: { id: 'attendant_check_status', title: 'status' } }, 
                    { type: 'reply', reply: { id: 'attendant_list_parked', title: 'list vehicles' } } 
                ] 
            } 
        };
        await sendWhatsAppMessage(from, attendantMenu);
    }
}

async function handleGetReport(from, role, lot_id, params) {
    if (role !== 'owner') {
        return await sendWhatsAppMessage(from, "❌ Reports are only available for Owners.");
    }

    const datePeriod = params.date_period || 'today';
    let reportTitle = "Today's Report";

    const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
    let startDate = new Date(now);
    let endDate = new Date(now);

    if (datePeriod === 'yesterday') {
        startDate.setDate(now.getDate() - 1);
        endDate.setDate(now.getDate() - 1);
        reportTitle = "Yesterday's Report";
    }

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    const query = `
        SELECT
            COALESCE(SUM(CASE WHEN status = 'COMPLETED_CASH' THEN total_fee ELSE 0 END), 0) as cash_total,
            COUNT(CASE WHEN status = 'COMPLETED_CASH' THEN 1 END) as cash_vehicles,
            COUNT(CASE WHEN status = 'COMPLETED_PASS' THEN 1 END) as pass_vehicles
        FROM Transactions
        WHERE lot_id = $1 AND end_time BETWEEN $2 AND $3
    `;

    try {
        const reportResult = await pool.query(query, [lot_id, startDate, endDate]);
        const data = reportResult.rows[0];

        let replyMessage = `
*--- ParkEasy ${reportTitle} ---*
*Date:* ${startDate.toLocaleDateString('en-GB')}

*--- Collections Summary ---*
💰 *Total Cash Logged:* ₹${data.cash_total}
🚗 *Vehicles Billed (Cash):* ${data.cash_vehicles}

*--- Vehicle Exits ---*
💳 *Pass Holder Exits:* ${data.pass_vehicles}
*Total Exits:* ${parseInt(data.cash_vehicles) + parseInt(data.pass_vehicles)}

------------------------------------
_This is an automated report._
        `;

        await sendWhatsAppMessage(from, replyMessage.trim());
    } catch (err) {
        console.error("Error generating report:", err);
        await sendWhatsAppMessage(from, "❌ Sorry, an error occurred while generating the report.");
    }
}

// 9. Start the Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

  

4.3. Scheduled Tasks (daily_report.js)

This file runs independently to send daily summaries and reminders.
code JavaScript
IGNORE_WHEN_COPYING_START
IGNORE_WHEN_COPYING_END

    
// daily_report.js (Final Version with Subscription Reminders)

require('dotenv').config();
const { Pool } = require('pg');
const axios = require('axios');

async function sendWhatsAppMessage(recipientNumber, messageText) {
    const META_API_TOKEN = process.env.META_API_TOKEN;
    const SENDER_PHONE_ID = process.env.SENDER_PHONE_ID;
    const url = `https://graph.facebook.com/v19.0/${SENDER_PHONE_ID}/messages`;
    const payload = { messaging_product: 'whatsapp', to: recipientNumber, text: { body: messageText } };
    const headers = { 'Authorization': `Bearer ${META_API_TOKEN}`, 'Content-Type': 'application/json' };
    try {
        await axios.post(url, payload, { headers });
        console.log(`Successfully sent scheduled message to ${recipientNumber}`);
    } catch (error) {
        console.error(`Failed to send scheduled message to ${recipientNumber}:`, error.response ? error.response.data : error.message);
    }
}

async function sendWhatsAppTemplate(recipientNumber, templateName, components) {
    const META_API_TOKEN = process.env.META_API_TOKEN;
    const SENDER_PHONE_ID = process.env.SENDER_PHONE_ID;
    const url = `https://graph.facebook.com/v19.0/${SENDER_PHONE_ID}/messages`;
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
    const headers = { 'Authorization': `Bearer ${META_API_TOKEN}`, 'Content-Type': 'application/json' };
    try {
        await axios.post(url, payload, { headers });
        console.log(`Successfully sent template '${templateName}' to ${recipientNumber}`);
    } catch (error) {
        console.error(`Error sending template message to ${recipientNumber}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    }
}


const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function runDailyTasks() {
    console.log('Starting daily tasks...');
    const client = await pool.connect();
    
    try {
        // --- TASK 1: SEND OWNER SUBSCRIPTION REMINDERS ---
        console.log('Checking for expiring owner subscriptions...');
        const reminderQuery = `
            SELECT owner_id, name, whatsapp_number, subscription_end_date FROM Owners
            WHERE subscription_end_date BETWEEN NOW() AND NOW() + interval '3 days'
        `;
        const subsResult = await client.query(reminderQuery);
        for (const owner of subsResult.rows) {
            const endDate = new Date(owner.subscription_end_date).toLocaleDateString('en-GB');
            const reminderMsg = `🔔 ParkEasy Reminder 🔔\n\nHi ${owner.name}, your subscription is expiring soon on *${endDate}*.\n\nPlease contact support to renew your plan and ensure uninterrupted service.`;
            await sendWhatsAppMessage(owner.whatsapp_number, reminderMsg);
            console.log(`Sent subscription reminder to owner ${owner.name}`);
        }

        // --- TASK 2: SEND DAILY REPORTS & CUSTOMER PASS REMINDERS ---
        console.log('Generating daily reports for active owners...');
        const ownersResult = await client.query(`
            SELECT o.owner_id, o.whatsapp_number, p.lot_id, p.lot_name FROM Owners o 
            JOIN ParkingLots p ON o.owner_id = p.owner_id 
            WHERE o.subscription_end_date >= NOW()`);
        
        for (const owner of ownersResult.rows) {
            // A. Send Yesterday's Summary Report to Owner
            let reportTitle = "Yesterday's Report";
            const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
            let startDate = new Date(now);
            startDate.setDate(now.getDate() - 1);
            let endDate = new Date(now);
            endDate.setDate(now.getDate() - 1);
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            
            const reportQuery = `
                SELECT COALESCE(SUM(CASE WHEN status = 'COMPLETED_CASH' THEN total_fee ELSE 0 END), 0) as cash_total,
                       COUNT(CASE WHEN status = 'COMPLETED_CASH' THEN 1 END) as cash_vehicles,
                       COUNT(CASE WHEN status = 'COMPLETED_PASS' THEN 1 END) as pass_vehicles
                FROM Transactions WHERE lot_id = $1 AND end_time BETWEEN $2 AND $3
            `;
            const reportResult = await client.query(reportQuery, [owner.lot_id, startDate, endDate]);
            const data = reportResult.rows[0];
            let reportMessage = `
*--- ParkEasy ${reportTitle} ---*
*Date:* ${startDate.toLocaleDateString('en-GB')}
*Collections:* ₹${data.cash_total} (${data.cash_vehicles} vehicles)
*Pass Exits:* ${data.pass_vehicles} vehicles
------------------------------------
_This is an automated report._`;
            await sendWhatsAppMessage(owner.whatsapp_number, reportMessage.trim());

            // B. Send Expiry Reminders to Customers using a Template
            const passReminderQuery = `
                SELECT vehicle_number, customer_whatsapp_number, expiry_date FROM Passes
                WHERE lot_id = $1 AND expiry_date BETWEEN NOW() AND NOW() + interval '3 days' AND customer_whatsapp_number IS NOT NULL`;
            const passRemindersResult = await client.query(passReminderQuery, [owner.lot_id]);
            for (const pass of passRemindersResult.rows) {
                const endDate = new Date(pass.expiry_date).toLocaleDateString('en-GB');
                const components = [{
                    type: 'body',
                    parameters: [
                        { type: 'text', text: pass.vehicle_number },
                        { type: 'text', text: owner.lot_name },
                        { type: 'text', text: endDate }
                    ]
                }];
                // Assumes a template named 'pass_expiry_reminder' is approved
                await sendWhatsAppTemplate(pass.customer_whatsapp_number, 'pass_expiry_reminder', components);
                console.log(`Sent pass expiry template for ${pass.vehicle_number}`);
            }
        }

    } catch (err) {
        console.error('An error occurred during daily tasks:', err);
    } finally {
        client.release();
        await pool.end();
        console.log('Daily tasks finished. Connection closed.');
    }
}

runDailyTasks();

  