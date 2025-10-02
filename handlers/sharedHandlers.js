// handlers/sharedHandlers.js
const db = require('../config/db');
const whatsapp = require('../services/whatsappService');
const { isValidIndianVehicleNumber, normalizePhoneNumber } = require('../utils/validators');
const logger = require('../utils/logger');
const { calculateFinalFee } = require('../utils/billing'); // Make sure to import this




// --- THIS IS THE CORRECT, UNIFIED STATE MANAGEMENT ---
async function setUserState(user, state, context = {}) {
    if (!user || !user.role || !user.user_id) {
        logger.error("setUserState failed: Invalid user object provided.", { user });
        return;
    }
    const table = user.role === 'owner' ? 'Owners' : 'Attendants';
    const idColumn = user.role === 'owner' ? 'owner_id' : 'attendant_id';
    await db.query(`UPDATE ${table} SET conversation_state = $1, conversation_context = $2 WHERE ${idColumn} = $3`, [state, JSON.stringify(context), user.user_id]);
}

async function clearUserState(user) {
    await setUserState(user, 'IDLE', {});
}

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



async function handleGetStatus(from, user) {
    const statusResult = await db.query(`SELECT COUNT(*) as parked_count FROM Transactions WHERE lot_id = $1 AND vehicle_state = 'INSIDE'`, [user.lot_id]);
    const parkedCount = statusResult.rows[0].parked_count;
    await whatsapp.sendMessage(from, `📊 Currently ${parkedCount} vehicles are inside.`);
}


// async function handleListVehicles(from, user) {
//     const listResult = await db.query(`SELECT vehicle_number, start_time, status FROM Transactions WHERE lot_id = $1 AND vehicle_state = 'INSIDE' ORDER BY start_time ASC`, [user.lot_id]);
//     if (listResult.rows.length === 0) return await whatsapp.sendMessage(from, "✅ No vehicles are currently inside.");

//     let replyMessage = "--- Vehicles Currently Inside ---\n";
//     listResult.rows.forEach((vehicle, index) => {
//         const parkedTime = new Date(vehicle.start_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
//         let paymentStatus = '';
//         if (vehicle.status.includes('PAID') || vehicle.status === 'COMPLETED_CASH_ENTRY') { paymentStatus = ' - *Paid*'; }
//         else if (vehicle.status.includes('UNPAID')) { paymentStatus = ' - *Pay Later*'; }
//         else if (vehicle.status.includes('PASS')) { paymentStatus = ' - *Pass Holder*'; }
//         replyMessage += `${index + 1}. \`${vehicle.vehicle_number}\` (At: ${parkedTime})${paymentStatus}\n`;
//     });

//     replyMessage += "\n_To check out a vehicle, reply with its list number (e.g.,_ `2` _)._";

//     if (user.role === 'attendant') {
//         // Only attendants have conversation states
//         await db.query('UPDATE Attendants SET conversation_state = $1 WHERE attendant_id = $2', ['AWAITING_LIST_CHECKOUT', user.user_id]);
//     }
//     await whatsapp.sendMessage(from, replyMessage);
// }

// --- THIS IS THE FINAL, DEFINITIVE LIST FUNCTION ---
// --- THIS IS THE PERMANENTLY FIXED LIST FUNCTION ---
async function handleListVehicles(from, user) {
    const listResult = await db.query(`SELECT * FROM Transactions WHERE lot_id = $1 AND vehicle_state = 'INSIDE' ORDER BY start_time ASC`, [user.lot_id]);
    if (listResult.rows.length === 0) return await whatsapp.sendMessage(from, "✅ No vehicles are currently inside.");
    
    let replyMessage = "--- Vehicles Currently Inside ---\n\n";
    
    for (const vehicle of listResult.rows) {
        const index = listResult.rows.indexOf(vehicle) + 1;
        const parkedTime = new Date(vehicle.start_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        let paymentStatus = '';

        // --- NEW, SIMPLER, AND CORRECT STATUS LOGIC ---
        if (vehicle.status.includes('PASS')) {
            paymentStatus = '💳 Pass Holder';
        } else if (vehicle.status.includes('UNPAID')) {
            const feeToCollect = await calculateFinalFee(user.lot_id, vehicle);
            paymentStatus = `⚠️ Unpaid (*₹${feeToCollect} due*)`;
        } else if (vehicle.status.includes('PAID') || vehicle.status === 'COMPLETED_CASH_ENTRY') {
            const feeToCollect = await calculateFinalFee(user.lot_id, vehicle);
            if (feeToCollect > 0) {
                paymentStatus = `❗️ Overdue (*₹${feeToCollect} due*)`;
            } else {
                paymentStatus = '✅ Paid';
            }
        }

        replyMessage += `${index}. \`${vehicle.vehicle_number}\` (At: ${parkedTime})\n   - ${paymentStatus}\n`;
    }

    replyMessage += "\n_To check out, reply with the list number (e.g.,_ `out 1,2` _)._";
    
    await setUserState(user, 'AWAITING_LIST_CHECKOUT', {});
    await whatsapp.sendMessage(from, replyMessage);
}



// THIS IS THE NEW, UNIFIED MULTI-CHECKOUT HANDLER
async function handleVehicleCheckout(from, user, params) {
    const { identifiers } = params;
    if (!identifiers || identifiers.length === 0) return await whatsapp.sendMessage(from, "❌ AI Error: I couldn't identify any vehicles to check out.");

    const parkedList = await db.query(`SELECT transaction_id, vehicle_number, start_time, status, total_fee FROM Transactions WHERE lot_id = $1 AND vehicle_state = 'INSIDE' ORDER BY start_time ASC`, [user.lot_id]);

    const listMap = new Map();
    parkedList.rows.forEach((vehicle, index) => {
        listMap.set((index + 1).toString(), vehicle);
    });

    const results = [];
    await whatsapp.sendMessage(from, `Processing checkout for ${identifiers.length} vehicle(s)...`);

    for (const identifier of identifiers) {
        let transaction;
        const upperIdentifier = identifier.toUpperCase();

        if (listMap.has(upperIdentifier)) {
            transaction = listMap.get(upperIdentifier);
        } else {
            transaction = parkedList.rows.find(v => v.vehicle_number === upperIdentifier);
        }

        if (!transaction) {
            results.push(`- \`${identifier}\`: ❌ Not Found`);
            continue;
        }

        if (transaction.status.includes('PAID') || transaction.status.includes('PASS') || transaction.status === 'COMPLETED_CASH_ENTRY') {
            const newStatus = transaction.status.includes('PASS') ? 'COMPLETED_PASS_EXIT' : 'COMPLETED_NO_FEE_EXIT';
            await db.query(
                `UPDATE Transactions SET end_time = NOW(), status = $1, vehicle_state = 'EXITED' WHERE transaction_id = $2`,
                [newStatus, transaction.transaction_id]
            );
            results.push(`- \`${transaction.vehicle_number}\`: ✅ Checked Out (Paid)`);
        } else {
            const feeToCollect = await calculateFinalFee(user.lot_id, transaction);
            results.push(`- \`${transaction.vehicle_number}\`: ❗️ Payment Pending (*₹${feeToCollect}*). Please use the single checkout flow for this vehicle.`);
        }
    }

    let finalReport = "*--- Checkout Summary ---*\n\n";
    finalReport += results.join('\n');
    await whatsapp.sendMessage(from, finalReport);
}







module.exports = {
    handleVehicleCheckIn,
    handleVehicleCheckout,
    handleGetStatus,
    handleListVehicles,
    setUserState,
    clearUserState
};