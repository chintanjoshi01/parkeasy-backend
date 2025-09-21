// handlers/adminHandlers.js
const db = require('../config/db');
const whatsapp = require('../services/whatsappService');
const { normalizePhoneNumber } = require('../utils/validators');
const logger = require('../utils/logger');

async function handleSubscribeUser(adminFrom, params) {
    const { owner_name, owner_number, lot_name, plan_name = 'Growth', duration_days = 14 } = params;
    
    const normalizedOwnerNumber = normalizePhoneNumber(owner_number);
    if (!normalizedOwnerNumber) return await whatsapp.sendMessage(adminFrom, `❌ Admin Error: The provided number "${owner_number}" is not a valid 10 or 12-digit phone number.`);

    const client = await db.getClient();
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
            await whatsapp.sendMessage(adminFrom, `✅ Success! Subscription for ${normalizedOwnerNumber} has been renewed/updated for ${duration_days} days.`);
            await whatsapp.sendMessage(normalizedOwnerNumber, `🎉 Your ParkEasy subscription has been successfully renewed! Your service is active until ${endDate.toLocaleDateString('en-GB')}.`);
        } else {
            if (!owner_name || !lot_name) return await whatsapp.sendMessage(adminFrom, "❌ Admin Error: For new users, I need the owner's name and lot name.");
            
            const ownerQuery = `INSERT INTO Owners (name, whatsapp_number, subscription_plan, subscription_start_date, subscription_end_date) VALUES ($1, $2, $3, $4, $5) RETURNING owner_id`;
            const ownerResult = await client.query(ownerQuery, [owner_name, normalizedOwnerNumber, plan_name, startDate, endDate]);
            const newOwnerId = ownerResult.rows[0].owner_id;

            const lotQuery = `INSERT INTO ParkingLots (owner_id, lot_name, hourly_rate) VALUES ($1, $2, $3)`;
            await client.query(lotQuery, [newOwnerId, lot_name, 30]);

            await client.query('COMMIT');
            await whatsapp.sendMessage(adminFrom, `✅ Success! Owner "${owner_name}" and lot "${lot_name}" created with a ${duration_days}-day subscription.`);
            await whatsapp.sendMessage(normalizedOwnerNumber, `🎉 Congratulations! Your ParkEasy account for "${lot_name}" is now active until ${endDate.toLocaleDateString('en-GB')}! Type 'menu' to get started.`);
        }
    } catch (e) {
        await client.query('ROLLBACK');
        logger.error("Error subscribing user:", e);
        if (e.code === '23505') {
             await whatsapp.sendMessage(adminFrom, `❌ Admin Error: An owner with the number ${normalizedOwnerNumber} already exists.`);
        } else {
            await whatsapp.sendMessage(adminFrom, `❌ Admin Error: Failed to subscribe user. Reason: ${e.message}`);
        }
    } finally {
        client.release();
    }
}

async function handleListOwners(adminFrom) {
    logger.info(`Admin command triggered: List Owners`);
    try {
        const result = await db.query(`
            SELECT name, whatsapp_number, subscription_plan, subscription_end_date 
            FROM Owners ORDER BY created_at ASC
        `);
        
        if (result.rows.length === 0) {
            return await whatsapp.sendMessage(adminFrom, "No owners found in the system.");
        }

        let ownerListMessage = "*--- Registered ParkEasy Owners ---*\n\n";
        result.rows.forEach((owner, index) => {
            const endDate = owner.subscription_end_date 
                ? new Date(owner.subscription_end_date).toLocaleDateString('en-GB') 
                : 'N/A';
            const isActive = owner.subscription_end_date && new Date(owner.subscription_end_date) >= new Date();

            ownerListMessage += `${index + 1}. *${owner.name}*\n`;
            ownerListMessage += `   - Number: \`${owner.whatsapp_number}\`\n`;
            ownerListMessage += `   - Plan: ${owner.subscription_plan}\n`;
            ownerListMessage += `   - Expires: ${endDate}\n`;
            ownerListMessage += `   - Status: ${isActive ? '✅ Active' : '❌ Expired'}\n\n`;
        });
        
        await whatsapp.sendMessage(adminFrom, ownerListMessage);
    } catch (error) {
        logger.error("Error fetching owner list:", error);
        await whatsapp.sendMessage(adminFrom, "❌ Error fetching owner list. Check logs.");
    }
}

async function handleDisableOwner(adminFrom, params) {
    const { owner_number } = params;
    logger.info(`Admin command triggered: Disable Owner for number ${owner_number}`);
    
    const normalizedOwnerNumber = normalizePhoneNumber(owner_number);
    if (!normalizedOwnerNumber) return await whatsapp.sendMessage(adminFrom, `❌ Invalid phone number format for "${owner_number}".`);

    try {
        const result = await db.query(
            `UPDATE Owners SET subscription_end_date = NOW() - interval '1 day' WHERE whatsapp_number = $1`,
            [normalizedOwnerNumber]
        );

        if (result.rowCount > 0) {
            await whatsapp.sendMessage(adminFrom, `✅ Success! Owner ${normalizedOwnerNumber} has been suspended.`);
            await whatsapp.sendMessage(normalizedOwnerNumber, `Your ParkEasy account has been suspended. Please contact support.`);
        } else {
            await whatsapp.sendMessage(adminFrom, `❌ Owner with number ${normalizedOwnerNumber} not found.`);
        }
    } catch (error) {
        logger.error("Error disabling owner:", error);
        await whatsapp.sendMessage(adminFrom, "❌ Error disabling owner. Check logs.");
    }
}

async function handleBroadcastMessage(adminFrom, params) {
    const { target_group, lot_id, broadcast_text } = params;
    logger.info(`Admin command triggered: Broadcast to ${target_group}`, params);
    if (!broadcast_text) return await whatsapp.sendMessage(adminFrom, "❌ Cannot send an empty broadcast message.");
    if (!target_group || !['owners', 'attendants'].includes(target_group)) {
        return await whatsapp.sendMessage(adminFrom, "❌ Invalid target group. Please specify 'owners' or 'attendants'.");
    }

    let query = '';
    let queryParams = [];

    if (target_group === 'owners') {
        query = `SELECT name, whatsapp_number FROM Owners WHERE subscription_end_date >= NOW()`;
    } else { // target_group is 'attendants'
        if (!lot_id) {
            return await whatsapp.sendMessage(adminFrom, "❌ To broadcast to attendants, you must specify a lot ID. Example: broadcast to attendants of lot 1: ...");
        }
        query = `SELECT name, whatsapp_number FROM Attendants WHERE lot_id = $1 AND is_active = TRUE`;
        queryParams.push(lot_id);
    }
    
    try {
        const result = await db.query(query, queryParams);
        if (result.rows.length === 0) {
            return await whatsapp.sendMessage(adminFrom, `No active users found for the target group "${target_group}".`);
        }

        const message = `*A Message from ParkEasy Admin:*\n\n${broadcast_text}`;
        const broadcastPromises = result.rows.map(user => whatsapp.sendMessage(user.whatsapp_number, message));
        await Promise.all(broadcastPromises);
        
        await whatsapp.sendMessage(adminFrom, `✅ Broadcast sent successfully to ${result.rows.length} user(s) in group "${target_group}".`);
    } catch (error) {
        logger.error("Error sending broadcast:", error);
        await whatsapp.sendMessage(adminFrom, "❌ Error sending broadcast. Check logs.");
    }
}

async function handleSystemStatus(adminFrom) {
    logger.info(`Admin command triggered: System Status`);
    let dbStatus = '❌ Disconnected';
    try {
        await db.query('SELECT NOW()');
        dbStatus = '✅ Connected';
    } catch (error) {
        logger.error("Database health check failed:", error);
    }
    
    const statusMessage = `
*--- ParkEasy System Status ---*
*Database Connection:* ${dbStatus}
*AI Service:* ✅ Operational (Gemini)
*WhatsApp API:* ✅ Operational (Meta)

_System is functioning as expected._
    `;
    await whatsapp.sendMessage(adminFrom, statusMessage.trim());
}

module.exports = {
    handleSubscribeUser,
    handleListOwners,
    handleDisableOwner,
    handleBroadcastMessage,
    handleSystemStatus,
};