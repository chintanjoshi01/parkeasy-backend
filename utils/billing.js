// // utils/billing.js
// const db = require('../config/db');

// async function calculateFinalFee(lotId, transaction) {
//     const lotResult = await db.query('SELECT * FROM ParkingLots WHERE lot_id = $1', [lotId]);
//     if (lotResult.rows.length === 0) return 0; // Lot not found
    
//     const lot = lotResult.rows[0];
//     const startTime = new Date(transaction.start_time);
//     const endTime = new Date();
//     // Calculate duration in hours, rounding up to the next full hour.
//     const totalHours = Math.ceil((endTime - startTime) / (1000 * 60 * 60));

//     let totalBill = 0;

//     switch (lot.pricing_model) {
//         case 'BLOCK':
//             if (!lot.block_rate_fee || !lot.block_rate_hours) { totalBill = 0; break; }
//             if (totalHours <= 0) { totalBill = lot.block_rate_fee; break; } // Charge for at least one block
//             const blocks = Math.ceil(totalHours / lot.block_rate_hours);
//             totalBill = blocks * lot.block_rate_fee;
//             break;

//         case 'HOURLY':
//             if (!lot.hourly_rate) { totalBill = 0; break; }
//             totalBill = Math.max(1, totalHours) * lot.hourly_rate; // Charge for at least one hour
//             break;

//         case 'TIERED':
//         default:
//             const rateCardResult = await db.query('SELECT * FROM RateCards WHERE lot_id = $1 ORDER BY duration_hours ASC', [lotId]);
//             const rateCard = rateCardResult.rows;
//             if (rateCard.length === 0) { totalBill = 0; break; }

//             let foundTier = false;
//             for (const tier of rateCard) {
//                 if (totalHours <= tier.duration_hours) {
//                     totalBill = tier.fee;
//                     foundTier = true;
//                     break;
//                 }
//             }
//             if (!foundTier) totalBill = rateCard[rateCard.length - 1].fee;
//             break;
//     }

//     // --- CRITICAL BILLING LOGIC ---
//     // If the vehicle was a 'Pay Later' type, the entire calculated bill is what's due now.
//     if (transaction.status === 'PARKED_UNPAID') {
//         return totalBill;
//     }

//     // If the vehicle ALREADY PAID an entry fee, the due amount is the difference.
//     if (transaction.status === 'COMPLETED_CASH_ENTRY' || transaction.status === 'COMPLETED_UPI_ENTRY') {
//         const amountAlreadyPaid = transaction.total_fee || 0;
//         const remainingDue = totalBill - amountAlreadyPaid;
//         return Math.max(0, remainingDue); // Return 0 if the total bill is less than what they already paid.
//     }
    
//     // For pass holders or other completed states, the fee to collect now is 0.
//     return 0;
// }

// module.exports = { calculateFinalFee };

// utils/billing.js
const db = require('../config/db');
const logger = require('../utils/logger');

async function calculateFinalFee(lotId, transaction) {
    const lotResult = await db.query('SELECT * FROM ParkingLots WHERE lot_id = $1', [lotId]);
    if (lotResult.rows.length === 0) {
        logger.error(`Could not find lot with ID ${lotId} during fee calculation.`);
        return 0;
    }
    
    const lot = lotResult.rows[0];
    const startTime = new Date(transaction.start_time);
    const endTime = new Date();
    
    // Calculate total duration in hours, rounded UP to the next full hour.
    const totalHours = Math.ceil((endTime - startTime) / (1000 * 60 * 60));

    let totalBill = 0;

    // --- STEP 1: CALCULATE THE TOTAL THEORETICAL BILL ---
    switch (lot.pricing_model) {
        case 'BLOCK':
            if (!lot.block_rate_fee || !lot.block_rate_hours || lot.block_rate_hours <= 0) {
                logger.error(`Block rate not properly configured for lot ID ${lotId}.`);
                totalBill = 0;
                break;
            }
            // If parked for 0 hours, it's still 1 block.
            const blocks = Math.max(1, Math.ceil(totalHours / lot.block_rate_hours));
            totalBill = blocks * lot.block_rate_fee;
            break;

        case 'HOURLY':
            if (!lot.hourly_rate) {
                logger.error(`Hourly rate not set for lot ID ${lotId}.`);
                totalBill = 0;
                break;
            }
            // If parked for 0 hours, it's still 1 hour.
            totalBill = Math.max(1, totalHours) * lot.hourly_rate;
            break;

        case 'TIERED':
        default:
            const rateCardResult = await db.query('SELECT * FROM RateCards WHERE lot_id = $1 ORDER BY duration_hours ASC', [lotId]);
            const rateCard = rateCardResult.rows;
            if (rateCard.length === 0) {
                logger.error(`Tiered pricing model is set for lot ID ${lotId}, but no rate card is defined.`);
                totalBill = 0;
                break;
            }

            let foundTier = false;
            for (const tier of rateCard) {
                if (totalHours <= tier.duration_hours) {
                    totalBill = tier.fee;
                    foundTier = true;
                    break;
                }
            }
            // If duration exceeds the max defined tier, calculate extra days based on the max tier.
            if (!foundTier) {
                const maxTier = rateCard[rateCard.length - 1];
                if (maxTier.duration_hours > 0) {
                    const hoursOverMax = totalHours - maxTier.duration_hours;
                    // Assuming the highest tier is a 24-hour rate for multi-day calculation
                    const daysOver = Math.ceil(hoursOverMax / 24);
                    totalBill = maxTier.fee + (daysOver * maxTier.fee);
                } else {
                    totalBill = maxTier.fee;
                }
            }
            break;
    }

    // --- STEP 2: SUBTRACT ANY AMOUNT ALREADY PAID ---
    const amountAlreadyPaid = transaction.total_fee || 0;

    // --- STEP 3: RETURN THE DIFFERENCE ---
    const feeToCollect = totalBill - amountAlreadyPaid;

    logger.info(`Fee Calculation for vehicle ${transaction.vehicle_number}: Total Bill=₹${totalBill}, Already Paid=₹${amountAlreadyPaid}, Fee to Collect=₹${Math.max(0, feeToCollect)}`);

    // Return the amount that still needs to be collected. Cannot be negative.
    return Math.max(0, feeToCollect);
}

module.exports = { calculateFinalFee };