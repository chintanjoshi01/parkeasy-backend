// handlers/sharedHandlers.js
const db = require('../config/db');
const whatsapp = require('../services/whatsappService');
const { isValidIndianVehicleNumber, normalizePhoneNumber } = require('../utils/validators');
const logger = require('../utils/logger');

// This is a helper function used only by handleVehicleCheckout
async function checkoutSingleVehicle(from, lot_id, vehicleNumber) {
    const transactionResult = await db.query(`SELECT transaction_id, start_time, customer_whatsapp_number FROM Transactions WHERE lot_id = $1 AND vehicle_number = $2 AND status = 'PARKED' ORDER BY start_time DESC LIMIT 1`, [lot_id, vehicleNumber]);
    if (transactionResult.rows.length === 0) {
        await whatsapp.sendMessage(from, `❌ Skipped: Vehicle ${vehicleNumber} not found or already checked out.`);
        return;
    }
    
    const transaction = transactionResult.rows[0];
    const passResult = await db.query(`SELECT pass_id FROM Passes WHERE lot_id = $1 AND vehicle_number = $2 AND status = 'ACTIVE' AND expiry_date >= NOW()`, [lot_id, vehicleNumber]);
    if (passResult.rows.length > 0) {
        await db.query(`UPDATE Transactions SET end_time = NOW(), status = 'COMPLETED_PASS' WHERE transaction_id = $1`, [transaction.transaction_id]);
        await whatsapp.sendMessage(from, `👍 ${vehicleNumber} (Pass Holder) exit logged.`);
    } else {
        const ownerResult = await db.query('SELECT o.whatsapp_number, p.lot_name FROM Owners o JOIN ParkingLots p ON o.owner_id = p.owner_id WHERE p.lot_id = $1', [lot_id]);
        const lotResult = await db.query('SELECT hourly_rate FROM ParkingLots WHERE lot_id = $1', [lot_id]);
        const { whatsapp_number: ownerNumber, lot_name: lotName } = ownerResult.rows[0] || {};
        const { hourly_rate: hourlyRate } = lotResult.rows[0] || {};

        if (!hourlyRate) {
            await whatsapp.sendMessage(from, `❌ Error for ${vehicleNumber}: Parking rate not set.`);
            return;
        }
        
        const startTime = new Date(transaction.start_time);
        const endTime = new Date();
        const durationHours = Math.max(1, Math.ceil((endTime - startTime) / (1000 * 60 * 60)));
        const fee = durationHours * hourlyRate;

        await db.query(`UPDATE Transactions SET end_time = NOW(), total_fee = $1, status = 'COMPLETED_CASH' WHERE transaction_id = $2`, [fee, transaction.transaction_id]);
        await whatsapp.sendMessage(from, `👍 ₹${fee} logged for ${vehicleNumber}.`);
        if (ownerNumber && from !== ownerNumber) await whatsapp.sendMessage(ownerNumber, `💰 Cash payment of ₹${fee} logged for ${vehicleNumber}.`);
    }
}

async function handleVehicleCheckIn(from, role, user_id, lot_id, params) {
    const { vehicle_number, customer_number, language } = params;
    if (!vehicle_number) return await whatsapp.sendMessage(from, "❌ AI Error: I couldn't identify a vehicle number in your message. Please try again.");
    
    if (!isValidIndianVehicleNumber(vehicle_number)) {
        let errorMessage;
        if (language === 'hi') {
            errorMessage = `❌ "${vehicle_number}" का वाहन नंबर प्रारूप गलत है।\nकृपया GJ05RT1234 जैसा प्रारूप इस्तेमाल करें।`;
        } else {
            errorMessage = `❌ Invalid vehicle number format for "${vehicle_number}".\nPlease use the format like GJ05RT1234.`;
        }
        return await whatsapp.sendMessage(from, errorMessage);
    }

    const checkResult = await db.query(`SELECT transaction_id FROM Transactions WHERE lot_id = $1 AND vehicle_number = $2 AND status = 'PARKED'`, [lot_id, vehicle_number]);
    if (checkResult.rows.length > 0) {
        return await whatsapp.sendMessage(from, `❌ Error: ${vehicle_number} is already marked as PARKED.`);
    }
    
    const attendantId = (role === 'attendant') ? user_id : null;
    const normalizedCustomerNumber = normalizePhoneNumber(customer_number);

    await db.query(`INSERT INTO Transactions (lot_id, attendant_id, vehicle_number, start_time, status, customer_whatsapp_number) VALUES ($1, $2, $3, NOW(), 'PARKED', $4)`, [lot_id, attendantId, vehicle_number, normalizedCustomerNumber]);
    await whatsapp.sendMessage(from, `✅ ${vehicle_number} parked at ${new Date().toLocaleTimeString('en-IN')}.`);
}

async function handleVehicleCheckout(from, lot_id, params) {
    const { identifiers } = params;
    if (!identifiers || identifiers.length === 0) return await whatsapp.sendMessage(from, "❌ AI Error: I couldn't identify any vehicles to check out.");

    const parkedList = await db.query(`SELECT vehicle_number FROM Transactions WHERE lot_id = $1 AND status = 'PARKED' ORDER BY start_time ASC`, [lot_id]);
    const vehicleNumbersToCheckOut = new Set(); 

    for (const identifier of identifiers) {
        let vehicleNumber = identifier.toUpperCase();
        const listNumber = parseInt(identifier);
        if (!isNaN(listNumber) && listNumber > 0) {
            if (parkedList.rows.length >= listNumber) {
                vehicleNumbersToCheckOut.add(parkedList.rows[listNumber - 1].vehicle_number);
            } else {
                await whatsapp.sendMessage(from, `⚠️ Warning: Invalid list number ${listNumber}. Skipping.`);
            }
        } else if (isValidIndianVehicleNumber(vehicleNumber)) {
            vehicleNumbersToCheckOut.add(vehicleNumber);
        } else {
             await whatsapp.sendMessage(from, `⚠️ Warning: Invalid vehicle number "${identifier}". Skipping.`);
        }
    }

    const uniqueVehicles = Array.from(vehicleNumbersToCheckOut);
    if (uniqueVehicles.length > 0) {
        await whatsapp.sendMessage(from, `Processing checkout for ${uniqueVehicles.length} vehicle(s)...`);
        for (const vehicleNo of uniqueVehicles) {
            await checkoutSingleVehicle(from, lot_id, vehicleNo);
        }
    }
}

async function handleGetStatus(from, lot_id) {
    const statusResult = await db.query(`SELECT COUNT(*) as parked_count FROM Transactions WHERE lot_id = $1 AND status = 'PARKED'`, [lot_id]);
    const parkedCount = statusResult.rows[0].parked_count;
    await whatsapp.sendMessage(from, `📊 Currently ${parkedCount} vehicles are parked.`);
}

async function handleListVehicles(from, lot_id) {
    const listResult = await db.query(`SELECT vehicle_number, start_time FROM Transactions WHERE lot_id = $1 AND status = 'PARKED' ORDER BY start_time ASC`, [lot_id]);
    if (listResult.rows.length === 0) return await whatsapp.sendMessage(from, "✅ No vehicles are currently parked.");
    
    let replyMessage = "--- Currently Parked Vehicles ---\n";
    listResult.rows.forEach((vehicle, index) => {
        const parkedTime = new Date(vehicle.start_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        replyMessage += `${index + 1}. ${vehicle.vehicle_number} (At: ${parkedTime})\n`;
    });
    await whatsapp.sendMessage(from, replyMessage);
}

module.exports = {
    handleVehicleCheckIn,
    handleVehicleCheckout,
    handleGetStatus,
    handleListVehicles,
};