// daily_report.js (Final Version with Subscription Reminders and Template Messages)

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