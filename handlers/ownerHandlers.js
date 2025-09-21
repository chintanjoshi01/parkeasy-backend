// handlers/ownerHandlers.js
const db = require('../config/db');
const whatsapp = require('../services/whatsappService');
const { isValidIndianVehicleNumber, normalizePhoneNumber } = require('../utils/validators');
const logger = require('../utils/logger');

async function handleAddPass(from, role, lot_id, params, messageText) {
    if (role !== 'owner') return await whatsapp.sendMessage(from, "❌ This command can only be used by an Owner.");
    
    let { vehicle_number, duration_days, customer_number, language } = params;

    // Fallback for vehicle number
    if (!vehicle_number && messageText) {
        const words = messageText.toUpperCase().split(' ');
        for (const word of words) {
            if (isValidIndianVehicleNumber(word)) { vehicle_number = word; break; }
        }
    }

    const duration = parseInt(duration_days);

    if (!vehicle_number || !duration_days) {
        return await whatsapp.sendMessage(from, "❌ I seem to be missing the vehicle number or the pass duration. Please try again.\n\n_Example: add pass for GJ01AB1234 for 30 days_");
    }

    if (isNaN(duration) || duration <= 0 || duration > 365) {
        let errorMsg = "❌ Invalid duration provided. Please specify a number of days (e.g., 30).";
        if (language === 'hi') { errorMsg = "❌ दिनों की संख्या गलत है। कृपया दिनों की संख्या बताएं (जैसे, 30)."; }
        return await whatsapp.sendMessage(from, errorMsg);
    }
    
    if (!isValidIndianVehicleNumber(vehicle_number)) {
        let errorMessage;
        if (language === 'hi') { errorMessage = `❌ "${vehicle_number}" का वाहन नंबर प्रारूप गलत है।\nकृपया GJ05RT1234 जैसा प्रारूप इस्तेमाल करें।`; } 
        else { errorMessage = `❌ Invalid vehicle number format for "${vehicle_number}".\nPlease use the format like GJ05RT1234.`; }
        return await whatsapp.sendMessage(from, errorMessage);
    }
    
    const normalizedCustomerNumber = customer_number ? normalizePhoneNumber(customer_number) : null;

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + duration);
    await db.query(`INSERT INTO Passes (lot_id, vehicle_number, expiry_date, status, customer_whatsapp_number) VALUES ($1, $2, $3, 'ACTIVE', $4) ON CONFLICT (lot_id, vehicle_number) DO UPDATE SET expiry_date = $3, status = 'ACTIVE', customer_whatsapp_number = $4`, [lot_id, vehicle_number, expiryDate, normalizedCustomerNumber]);
    
    let confirmationMessage = `✅ Pass added for ${vehicle_number}.\nValid until: ${expiryDate.toLocaleDateString('en-GB')}.`;
    if (normalizedCustomerNumber) {
        confirmationMessage += `\nCustomer number ${normalizedCustomerNumber} has been saved for reminders.`;
    }
    
    await whatsapp.sendMessage(from, confirmationMessage);
}

async function handleRemovePass(from, role, lot_id, params, messageText) {
    if (role !== 'owner') {
        return await whatsapp.sendMessage(from, "❌ This command can only be used by an Owner.");
    }

    let vehicle_number = params.vehicle_number;

    if (!vehicle_number && messageText) {
        const words = messageText.toUpperCase().split(' ');
        for (const word of words) {
            if (isValidIndianVehicleNumber(word)) {
                vehicle_number = word;
                logger.info(`AI failed to extract vehicle number for remove_pass, but code found it: ${vehicle_number}`);
                break;
            }
        }
    }

    if (!vehicle_number) {
        return await whatsapp.sendMessage(from, "❌ I couldn't identify a vehicle number in your message. Please try again.\n\n_Example: remove pass GJ01AB1234_");
    }

    try {
        const result = await db.query(
            `UPDATE Passes SET status = 'INACTIVE', expiry_date = NOW() - interval '1 day' 
             WHERE lot_id = $1 AND vehicle_number = $2 AND status = 'ACTIVE'`,
            [lot_id, vehicle_number]
        );

        if (result.rowCount > 0) {
            await whatsapp.sendMessage(from, `✅ Success! The active pass for ${vehicle_number} has been removed.`);
        } else {
            await whatsapp.sendMessage(from, `❌ No active pass found for the vehicle number ${vehicle_number}.`);
        }
    } catch (error) {
        logger.error("Error removing pass:", error);
        await whatsapp.sendMessage(from, "❌ An error occurred while trying to remove the pass. Please check the logs.");
    }
}


async function handleRemoveAttendant(from, role, lot_id, params) {
    if (role !== 'owner') return await whatsapp.sendMessage(from, "❌ This command can only be used by an Owner.");
    const { attendant_number } = params;
    if (!attendant_number) return await whatsapp.sendMessage(from, "❌ AI Error: I'm missing the attendant's number to remove.");

    const normalizedAttendantNumber = normalizePhoneNumber(attendant_number);
    if (!normalizedAttendantNumber) return await whatsapp.sendMessage(from, `❌ Invalid phone number format for "${attendant_number}".`);

    const result = await db.query(`UPDATE Attendants SET is_active = FALSE WHERE whatsapp_number = $1 AND lot_id = $2`, [normalizedAttendantNumber, lot_id]);
    if (result.rowCount > 0) await whatsapp.sendMessage(from, `✅ Attendant ${normalizedAttendantNumber} has been deactivated.`);
    else await whatsapp.sendMessage(from, `❌ Attendant with that number not found in your lot.`);
}

async function handleAddAttendant(from, role, lot_id, params) {
    if (role !== 'owner') return await whatsapp.sendMessage(from, "❌ This command can only be used by an Owner.");
    const { attendant_name, attendant_number } = params;
    if (!attendant_name || !attendant_number) return await whatsapp.sendMessage(from, "❌ AI Error: I'm missing the attendant's name or number.");

    const normalizedAttendantNumber = normalizePhoneNumber(attendant_number);
    if (!normalizedAttendantNumber) return await whatsapp.sendMessage(from, `❌ Invalid phone number format for "${attendant_number}".`);

    try {
        await db.query(`INSERT INTO Attendants (lot_id, name, whatsapp_number) VALUES ($1, $2, $3)`, [lot_id, attendant_name, normalizedAttendantNumber]);
        await whatsapp.sendMessage(from, `✅ Attendant "${attendant_name}" added successfully.`);
    } catch (err) {
        if (err.code === '23505') await whatsapp.sendMessage(from, `❌ Error: An attendant with number ${normalizedAttendantNumber} is already registered.`);
        else { logger.error("Error adding attendant:", err); await whatsapp.sendMessage(from, "❌ An error occurred while adding the attendant."); }
    }
}

async function handleViewPasses(from, role, lot_id) {
    if (role !== 'owner') return await whatsapp.sendMessage(from, "❌ This command can only be used by an Owner.");
    const passesResult = await db.query(`SELECT vehicle_number, expiry_date FROM Passes WHERE lot_id = $1 AND status = 'ACTIVE' AND expiry_date >= NOW() ORDER BY expiry_date ASC`, [lot_id]);
    if (passesResult.rows.length === 0) return await whatsapp.sendMessage(from, "--- No Active Passes ---");
    
    let replyMessage = "--- Active Passes ---\n";
    passesResult.rows.forEach((pass, index) => {
        const expiry = new Date(pass.expiry_date).toLocaleDateString('en-GB');
        replyMessage += `${index + 1}. ${pass.vehicle_number} (Expires: ${expiry})\n`;
    });
    await whatsapp.sendMessage(from, replyMessage);
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
        await whatsapp.sendMessage(from, ownerMenu);
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
        await whatsapp.sendMessage(from, attendantMenu);
    }
}

async function handleGetReport(from, role, lot_id, params) {
    if (role !== 'owner') {
        return await whatsapp.sendMessage(from, "❌ Reports are only available for Owners.");
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
        const reportResult = await db.query(query, [lot_id, startDate, endDate]);
        const data = reportResult.rows[0];

        let replyMessage = `
*--- ParkEasy ${reportTitle} ---*
*Date:* ${startDate.toLocaleDateString('en-GB')}
*Collections:* ₹${data.cash_total} (${data.cash_vehicles} vehicles)
*Pass Exits:* ${data.pass_vehicles} vehicles
------------------------------------
_This is an automated report._
        `;

        await whatsapp.sendMessage(from, replyMessage.trim());
    } catch (err) {
        logger.error("Error generating report:", err);
        await whatsapp.sendMessage(from, "❌ Sorry, an error occurred while generating the report.");
    }
}

async function handleGetHelpList(from, role) {
    if (role === 'owner') {
        const ownerHelpMessage = `
*--- ParkEasy Owner Command Guide ---*

You can speak to me naturally! Just make sure to include the necessary information.

*VEHICLE OPERATIONS*
(These can be used by you or your attendants)

➡️ *Check-In a Vehicle*
Logs a vehicle's entry.
_Example:_ \`in GJ05RT1234\`
_With Customer No:_ \`in GJ05RT1234 customer 9876543210\`

➡️ *Check-Out a Vehicle*
Logs exit and calculates fee.
_Example:_ \`out GJ05RT1234 cash\`
_By List No:_ \`out 2 cash\`
_Multiple Checkout:_ \`out 1, 3, 5 cash\`

➡️ *View Parked Cars*
Shows a numbered list of all parked cars.
_Example:_ \`list\`

➡️ *Get Status*
Shows a quick count of parked cars.
_Example:_ \`status\`

------------------------------------

*OWNER MANAGEMENT*
(Only you can use these commands)

➡️ *Add a Monthly Pass*
Creates or renews a pass.
_Example:_ \`add pass for GJ01AB1234 for 30 days\`
_With Reminder No:_ \`30 din ka pass for GJ01AB1234 customer 9876543210\`

➡️ *Remove a Pass*
Deactivates an active pass.
_Example:_ \`remove pass for GJ01AB1234\`

➡️ *View Active Passes*
Shows a list of all active passes.
_Example:_ \`viewpass\`

➡️ *Get a Daily Report*
Shows a summary of today's or yesterday's business.
_Example:_ \`report\`
_For yesterday:_ \`kal ka report do\`

➡️ *Add an Attendant*
Registers a new attendant to use the system.
_Example:_ \`add attendant Suresh with number 9876543210\`

➡️ *Remove an Attendant*
Deactivates an attendant's account.
_Example:_ \`remove attendant 9876543210\`
        `;
        await whatsapp.sendMessage(from, ownerHelpMessage.trim());
    } else { // Attendant Role
        const attendantHelpMessage = `
*--- ParkEasy Attendant Command Guide ---*

You can speak to me in plain language!

➡️ *Check-In a Vehicle*
Logs a vehicle's entry.
_Example:_ \`gaadi aayi GJ05RT1234\`
_With Customer No:_ \`in GJ05RT1234 customer 9876543210\`

➡️ *Check-Out a Vehicle*
Logs a vehicle's exit.
_Example:_ \`out GJ05RT1234 cash\`
_By List No:_ \`2 number out cash\`
_Multiple Checkout:_ \`out 1, 3, 5 cash\`

➡️ *View Parked Cars*
Shows a numbered list of all parked cars.
_Example:_ \`list\` or \`parked cars list\`

➡️ *Get Status*
Shows a quick count of parked cars.
_Example:_ \`status\` or \`kitni gaadiyan hain?\`
        `;
        await whatsapp.sendMessage(from, attendantHelpMessage.trim());
    }
}



module.exports = {
    handleAddPass,
    handleRemovePass,
    handleRemoveAttendant,
    handleAddAttendant,
    handleViewPasses,
    handleShowMenu,
    handleGetReport,
    handleGetHelpList,
};