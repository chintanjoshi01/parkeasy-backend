// handlers/cronHandler.js

const db = require('../config/db');
const whatsapp = require('../services/whatsappService');
const logger = require('../utils/logger');

// This function contains all the logic from the old daily_report.js file
async function handleDailyTasks() {
    logger.info('--- Starting Daily Cron Tasks ---');
    const client = await db.getClient();
    
    try {
        // --- TASK 1: SEND OWNER SUBSCRIPTION REMINDERS ---
        logger.info('Cron Task: Checking for expiring owner subscriptions...');
        const reminderQuery = `
            SELECT owner_id, name, whatsapp_number, subscription_end_date FROM Owners
            WHERE subscription_end_date BETWEEN NOW() AND NOW() + interval '3 days'
        `;
        const subsResult = await client.query(reminderQuery);
        if (subsResult.rowCount > 0) {
            for (const owner of subsResult.rows) {
                const endDate = new Date(owner.subscription_end_date).toLocaleDateString('en-GB');
                const reminderMsg = `🔔 ParkEasy Reminder 🔔\n\nHi ${owner.name}, your subscription is expiring soon on *${endDate}*.\n\nPlease contact support to renew your plan and ensure uninterrupted service.`;
                await whatsapp.sendMessage(owner.whatsapp_number, reminderMsg);
                logger.info(`Sent subscription reminder to owner ${owner.name}`);
            }
        } else {
            logger.info('Cron Task: No owner subscriptions expiring soon.');
        }


        // --- TASK 2: SEND DAILY REPORTS & CUSTOMER PASS REMINDERS ---
        logger.info('Cron Task: Generating daily reports for active owners...');
        const ownersResult = await client.query(`
            SELECT o.owner_id, o.whatsapp_number, p.lot_id, p.lot_name FROM Owners o 
            JOIN ParkingLots p ON o.owner_id = p.owner_id 
            WHERE o.subscription_end_date >= NOW()`);
        
        if (ownersResult.rowCount === 0) {
            logger.info('Cron Task: No active owners found to generate reports for.');
        }

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
            await whatsapp.sendMessage(owner.whatsapp_number, reportMessage.trim());
            logger.info(`Sent daily report to owner ${owner.whatsapp_number}`);

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
                await whatsapp.sendTemplate(pass.customer_whatsapp_number, 'pass_expiry_reminder', components);
                logger.info(`Sent pass expiry template for ${pass.vehicle_number}`);
            }
        }
    } catch (err) {
        logger.error('An error occurred during daily cron tasks:', err);
    } finally {
        client.release();
        logger.info('--- Daily Cron Tasks Finished ---');
    }
}

module.exports = {
    handleDailyTasks,
};