// // handlers/attendantHandlers.js
// const db = require('../config/db');
// const whatsapp = require('../services/whatsappService');
// const receiptService = require('../services/receiptService');
// const { isValidIndianVehicleNumber, normalizePhoneNumber } = require('../utils/validators');
// const logger = require('../utils/logger');
// const { calculateFinalFee } = require('../utils/billing'); // Make sure to import this
// const epassService = require('../services/epassService'); // <-- NEW
// const sharedHandlers = require('../handlers/sharedHandlers')

// // --- FULL CONVERSATIONAL WORKFLOW ---

// // STEP 1: Attendant enters a vehicle number
// async function handleInitialVehicleEntry(from, user, vehicle_number) {
//     if (!isValidIndianVehicleNumber(vehicle_number)) {
//         return await whatsapp.sendMessage(from, `❌ Invalid vehicle number format for "${vehicle_number}". Please try again.`);
//     }

//     // --- THIS IS THE CORRECTED "ALREADY PARKED" LOGIC ---
//     const checkResult = await db.query(`SELECT 1 FROM Transactions WHERE lot_id = $1 AND vehicle_number = $2 AND vehicle_state = 'INSIDE'`, [user.lot_id, vehicle_number]);
//     if (checkResult.rows.length > 0) {
//         const context = { vehicle_number };
//         await sharedHandlers.setUserState(user, 'AWAITING_CHECKOUT_CONFIRMATION', context);

//         const alreadyParkedMenu = {
//             type: 'button',
//             body: { text: `⚠️ *VEHICLE ALREADY PARKED*\n\nVehicle \`${vehicle_number}\` is already inside the lot.\n\n*Did you mean to check this vehicle out?*` },
//             action: {
//                 buttons: [
//                     { type: 'reply', reply: { id: 'yes_checkout', title: 'Yes, Check Out' } },
//                     { type: 'reply', reply: { id: 'no_cancel', title: 'Cancel' } }
//                 ]
//             }
//         };
//         return await whatsapp.sendMessage(from, alreadyParkedMenu);
//     }
//     // --- END OF CORRECTED LOGIC ---

//     const passResult = await db.query(`SELECT 1 FROM Passes WHERE lot_id = $1 AND vehicle_number = $2 AND status = 'ACTIVE' AND expiry_date >= NOW()`, [user.lot_id, vehicle_number]);
//     const context = { vehicle_number, isPassHolder: passResult.rows.length > 0 };

//     if (context.isPassHolder) {
//         await sharedHandlers.setUserState(user, 'AWAITING_PARKING_CONFIRMATION', context);
//         const menu = { type: 'button', body: { text: `✅ *PASS HOLDER* (${vehicle_number})\n\nPark this vehicle?` }, action: { buttons: [{ type: 'reply', reply: { id: 'confirm_pass_park', title: 'Yes, Park' } }, { type: 'reply', reply: { id: 'cancel', title: 'Cancel' } }] } };
//         return await whatsapp.sendMessage(from, menu);
//     }

//      const customerResult = await db.query(`SELECT customer_whatsapp_number FROM Customers WHERE lot_id = $1 AND vehicle_number = $2`, [user.lot_id, vehicle_number]);

//     if (customerResult.rows.length > 0) {
//         context.customer_number = customerResult.rows[0].customer_whatsapp_number;
//         // The user is known. Proceed DIRECTLY to asking for payment.
//         logger.info(`Known customer found for ${vehicle_number}. Proceeding to payment.`);
//         // await sharedHandlers.setUserState(user, 'AWAITING_PAYMENT_TYPE', context);
//         await handlePaymentFlow(from, user, context);
//     } else {
//         await sharedHandlers.setUserState(user, 'AWAITING_CUSTOMER_NUMBER', context);
//         await whatsapp.sendMessage(from, `❓ *NEW CUSTOMER* (${vehicle_number})\n\nPlease reply with the customer's 10-digit mobile number to continue.`);
//     }
// }

// async function handleCustomerNumberInput(from, user, messageText) {
//     const normalizedNumber = normalizePhoneNumber(messageText);
//     if (!normalizedNumber) {
//         return await whatsapp.sendMessage(from, `⚠️ That doesn't look like a valid 10-digit number. Please try again or type *cancel*.`);
//     }

//     const context = user.conversation_context;
//     context.customer_number = normalizedNumber;

//     const query = `
//         INSERT INTO Customers (lot_id, vehicle_number, customer_whatsapp_number, last_seen) VALUES ($1, $2, $3, NOW())
//         ON CONFLICT (lot_id, vehicle_number) DO UPDATE SET customer_whatsapp_number = $3, last_seen = NOW()
//     `;
//     await db.query(query, [user.lot_id, context.vehicle_number, normalizedNumber]);

//     // await sharedHandlers.setUserState(user, 'AWAITING_PAYMENT_TYPE', context);
//     await handlePaymentFlow(from, user, context);
// }

// // --- NEW UNIFIED PAYMENT AND CONFIRMATION LOGIC ---
// async function handlePaymentFlow(from, user, context) {
//     const lotResult = await db.query('SELECT pricing_model, block_rate_fee, hourly_rate FROM ParkingLots WHERE lot_id = $1', [user.lot_id]);
//     const lot = lotResult.rows[0];
//     let entryFeeText = '';
//     let entryFee = 20;

//     switch (lot.pricing_model) {
//         case 'BLOCK': entryFee = lot.block_rate_fee || 20; entryFeeText = `Entry Fee: *₹${entryFee}* (1 Block)`; break;
//         case 'HOURLY': entryFee = lot.hourly_rate || 20; entryFeeText = `Entry Fee: *₹${entryFee}* (First Hour)`; break;
//         case 'TIERED':
//         default:
//             const tierResult = await db.query('SELECT fee FROM RateCards WHERE lot_id = $1 ORDER BY duration_hours ASC LIMIT 1', [user.lot_id]);
//             entryFee = tierResult.rows[0]?.fee || 20;
//             entryFeeText = `Entry Fee: *₹${entryFee}*`;
//             break;
//     }
//     context.entryFee = entryFee;

//     // Save the complete context, including the fee, BEFORE asking the user.
//     await sharedHandlers.setUserState(user, 'AWAITING_PAYMENT_TYPE', context);

//     const menu = {
//         type: 'button',
//         body: { text: `💰 *PAYMENT for ${context.vehicle_number}*\n\n${entryFeeText}\n\nHow will the customer pay?` },
//         action: { buttons: [{ type: 'reply', reply: { id: 'pay_cash', title: 'Cash' } }, { type: 'reply', reply: { id: 'pay_upi', title: 'UPI' } }, { type: 'reply', reply: { id: 'pay_later', title: 'Pay Later' } },] }
//     };
//     await whatsapp.sendMessage(from, menu);
// }

// async function handleFinalConfirmation(from, user, buttonText) {
//     const { vehicle_number, customer_number, entryFee = 0, isPassHolder } = user.conversation_context;
//     const attendantId = user.user_id;
//     let status = '';

//     if (isPassHolder) {
//         if (buttonText === 'Yes, Park') { status = 'PARKED_PASS'; }
//         else { await sharedHandlers.clearUserState(user); return await whatsapp.sendMessage(from, `✅ Action for ${vehicle_number} cancelled.`); }
//     } else {
//         switch (buttonText) {
//             case 'Cash': status = 'COMPLETED_CASH_ENTRY'; break;
//             case 'UPI': status = 'COMPLETED_UPI_ENTRY'; break;
//             case 'Pay Later': status = 'PARKED_UNPAID'; break;
//             default: await sharedHandlers.clearUserState(user); return await whatsapp.sendMessage(from, `✅ Action for ${vehicle_number} cancelled.`);
//         }
//     }

//     if (status.startsWith('COMPLETED')) {
//        await db.query(`INSERT INTO Transactions (lot_id, attendant_id, vehicle_number, start_time, total_fee, status, vehicle_state, customer_whatsapp_number) VALUES ($1, $2, $3, NOW(), $4, $5, 'INSIDE', $6)`, [user.lot_id, attendantId, vehicle_number, entryFee, status, customer_number]);
//     } else {
//         await db.query(`INSERT INTO Transactions (lot_id, attendant_id, vehicle_number, start_time, status, vehicle_state, customer_whatsapp_number) VALUES ($1, $2, $3, NOW(), $4, 'INSIDE', $5)`, [user.lot_id, attendantId, vehicle_number, status, customer_number]);
//     }

//     let confirmationMessage = `👍 *DONE!* Vehicle ${vehicle_number} is parked.`;
//     if (status === 'PARKED_UNPAID') { confirmationMessage = `⚠️ *PAYMENT PENDING!* Vehicle ${vehicle_number} is parked.` }
//     await whatsapp.sendMessage(from, confirmationMessage);

//     if (customer_number) {
//         await whatsapp.sendMessage(from, `Sending receipt to customer...`);
//         const imagePath = await receiptService.generateReceiptImage(user.lot_id, vehicle_number);
//         if (imagePath) {
//             const imageUrl = receiptService.getPublicUrlForFile(imagePath);
//             await whatsapp.sendImage(customer_number, imageUrl);
//             setTimeout(() => receiptService.cleanupReceiptImage(imagePath), 60000);
//         }
//     }
//     await sharedHandlers.clearUserState(user);
// }

// async function handleParkingConfirmation(from, user, buttonText) {
//     const { vehicle_number, customer_number, entryFee, isPassHolder } = user.conversation_context;
//     const attendantId = user.user_id;
//     let status = '';

//     if (isPassHolder) {
//         if (buttonText === 'Yes, Park') {
//             status = 'PARKED_PASS';
//         } else {
//             await sharedHandlers.clearUserState(user);
//             return await whatsapp.sendMessage(from, `✅ Action for ${vehicle_number} cancelled.`);
//         }
//     } else {
//         switch (buttonText) {
//             case 'Cash':
//                 status = 'COMPLETED_CASH_ENTRY';
//                 break;
//             case 'UPI':
//                 status = 'COMPLETED_UPI_ENTRY';
//                 break;
//             case 'Pay Later':
//                 status = 'PARKED_UNPAID';
//                 break;
//             default:
//                 await sharedHandlers.clearUserState(user);
//                 return await whatsapp.sendMessage(from, `✅ Action for ${vehicle_number} cancelled.`);
//         }
//     }

//     // --- THIS IS THE CORRECTED DATABASE LOGIC ---
//     if (status.startsWith('COMPLETED')) {
//         console.log("Enter the if sattus condition--", status)
//         await db.query(`INSERT INTO Transactions (lot_id, attendant_id, vehicle_number, start_time, end_time, total_fee, status, vehicle_state, customer_whatsapp_number) VALUES ($1, $2, $3, NOW(), NOW(), $4, $5, 'INSIDE', $6)`, [user.lot_id, attendantId, vehicle_number, entryFee, status, customer_number]);
//     } else {
//         await db.query(`INSERT INTO Transactions (lot_id, attendant_id, vehicle_number, start_time, status, vehicle_state, customer_whatsapp_number) VALUES ($1, $2, $3, NOW(), $4, 'INSIDE', $5)`, [user.lot_id, attendantId, vehicle_number, status, customer_number]);
//     }

//     await sharedHandlers.clearUserState(user);
//     let confirmationMessage = `👍 *DONE!* Vehicle ${vehicle_number} is parked.`;
//     if (status === 'PARKED_UNPAID') {
//         confirmationMessage = `⚠️ *PAYMENT PENDING!* Vehicle ${vehicle_number} is parked.`
//     }
//     await whatsapp.sendMessage(from, confirmationMessage);

//     if (customer_number) {
//         await whatsapp.sendMessage(from, `Sending receipt to customer...`);
//         const imagePath = await receiptService.generateReceiptImage(user.lot_id, vehicle_number);
//         if (imagePath) {
//             const imageUrl = receiptService.getPublicUrlForFile(imagePath);
//             await whatsapp.sendImage(customer_number, imageUrl);
//             setTimeout(() => receiptService.cleanupReceiptImage(imagePath), 60000);
//         }
//     }
// }

// // ... (handleInitialVehicleExit, handleExitConfirmation are also needed, I'll assume they are correct for now but can provide if needed)
// // --- EXIT WORKFLOW ---
// async function handleInitialVehicleExit(from, user, identifiers) {
//     if (!identifiers || identifiers.length === 0) {
//         return await whatsapp.sendMessage(from, `Please specify a vehicle or list number. Example: \`out 2\``);
//     }

//     // For now, the conversational exit flow will only handle one vehicle at a time.
//     if (identifiers.length > 1) {
//         return await whatsapp.sendMessage(from, `Please check out one vehicle at a time for the button flow. Or ask the owner to use the command: \`out 1,2,3 cash\``);
//     }
//     const identifier = identifiers[0];

//     let transaction;
//     const listNumber = parseInt(identifier);
//     if (!isNaN(listNumber) && listNumber > 0) {
//         const listResult = await db.query(`SELECT * FROM Transactions WHERE lot_id = $1 AND vehicle_state = 'INSIDE' ORDER BY start_time ASC LIMIT 1 OFFSET $2`, [user.lot_id, listNumber - 1]);
//         if (listResult.rows.length > 0) {
//             transaction = listResult.rows[0];
//         } else {
//             const countResult = await db.query(`SELECT COUNT(*) FROM Transactions WHERE lot_id = $1 AND vehicle_state = 'INSIDE'`, [user.lot_id]);
//             return await whatsapp.sendMessage(from, `❌ Error: Invalid list number. There are only ${countResult.rows[0].count} vehicles inside.`);
//         }
//     } else {
//         const transactionResult = await db.query(`SELECT * FROM Transactions WHERE lot_id = $1 AND vehicle_number = $2 AND vehicle_state = 'INSIDE' ORDER BY start_time DESC LIMIT 1`, [user.lot_id, identifier.toUpperCase()]);
//         if (transactionResult.rows.length > 0) {
//             transaction = transactionResult.rows[0];
//         } else {
//             return await whatsapp.sendMessage(from, `❌ No vehicle with number/ID "${identifier}" is currently inside the lot.`);
//         }
//     }

//     // let fee = 0;
//     // if (transaction.status !== 'COMPLETED_CASH_ENTRY' && transaction.status !== 'PARKED_PASS') {
//     //     fee = await calculateFinalFee(user.lot_id, transaction.start_time, new Date());
//     // }

//     // The calculateFinalFee function now takes the whole transaction object
//     const feeToCollect = await calculateFinalFee(user.lot_id, transaction);

//     const context = { vehicle_number: transaction.vehicle_number, fee: feeToCollect, transaction_id: transaction.transaction_id };
//     await sharedHandlers.setUserState(user, 'AWAITING_EXIT_CONFIRMATION', context);

//     if (feeToCollect > 0) {
//         const menu = { type: 'button', body: { text: `❗️*COLLECT PAYMENT* (${transaction.vehicle_number})\n\n*Remaining Amount Due: ₹${feeToCollect}*` }, action: { buttons: [{ type: 'reply', reply: { id: 'exit_cash', title: 'Cash Collected' } }, { type: 'reply', reply: { id: 'exit_upi', title: 'UPI Collected' } }, { type: 'reply', reply: { id: 'exit_cancel', title: 'Cancel' } }] } };
//         await whatsapp.sendMessage(from, menu);
//     } else {
//         const menu = { type: 'button', body: { text: `✅ *OK TO GO* (${transaction.vehicle_number})\n\nNo due payment. Confirm exit?` }, action: { buttons: [{ type: 'reply', reply: { id: 'exit_confirm', title: 'Confirm Exit' } }, { type: 'reply', reply: { id: 'exit_cancel', title: 'Cancel' } }] } };
//         await whatsapp.sendMessage(from, menu);
//     }
// }

// async function handleExitConfirmation(from, user, buttonText) {
//     const { vehicle_number, fee, transaction_id } = user.conversation_context;
//     let newStatus;

//     if (buttonText === 'Cancel') {
//         await sharedHandlers.clearUserState(user);
//         return await whatsapp.sendMessage(from, `✅ Exit for ${vehicle_number} cancelled.`);
//     }

//     const originalTransaction = await db.query(`SELECT status FROM Transactions WHERE transaction_id = $1`, [transaction_id]);
//     const originalStatus = originalTransaction.rows[0].status;

//     if (buttonText === 'Confirm Exit') {
//         newStatus = (originalStatus === 'PARKED_PASS') ? 'COMPLETED_PASS_EXIT' : 'COMPLETED_NO_FEE';
//     } else { // 'Cash Collected'
//         newStatus = 'COMPLETED_CASH_EXIT';
//     }

//     await db.query(
//         `UPDATE Transactions SET end_time = NOW(), status = $1, total_fee = $2, vehicle_state = 'EXITED' WHERE transaction_id = $3`,
//         [newStatus, fee, transaction_id]
//     );

//     await sharedHandlers.clearUserState(user);
//     await whatsapp.sendMessage(from, `👍 *Exit Confirmed!* The transaction for ${vehicle_number} is now closed.`);
// }


// async function handleStartPassCreation(from, user, vehicle_number) {
//     if (!isValidIndianVehicleNumber(vehicle_number)) {
//         return await whatsapp.sendMessage(from, `❌ Invalid vehicle number format for "${vehicle_number}".`);
//     }

//     const passTypesResult = await db.query(`SELECT * FROM PassTypes WHERE lot_id = $1 ORDER BY duration_days ASC`, [user.lot_id]);
//     if (passTypesResult.rows.length === 0) {
//         return await whatsapp.sendMessage(from, "❌ No pass types have been created for this lot yet. The owner must first set pass rates.");
//     }
    
//     const context = { vehicle_number };
//     await sharedHandlers.setUserState(user, 'AWAITING_PASS_TYPE_SELECTION', context);

//     const buttons = passTypesResult.rows.map(pt => ({
//         type: 'reply',
//         reply: { id: `pt_${pt.pass_type_id}`, title: `${pt.pass_name} (₹${pt.fee})` }
//     }));
//     buttons.push({ type: 'reply', reply: { id: 'cancel_pass', title: 'Cancel' } });

//     const menu = {
//         type: 'button',
//         body: { text: `Please select a pass type for *${vehicle_number}*:` },
//         action: { buttons }
//     };
//     await whatsapp.sendMessage(from, menu);
// }

// async function handlePassTypeSelection(from, user, buttonText) {
//     const context = user.conversation_context;
    
//     const feeMatch = buttonText.match(/₹(\d+)/);
//     const fee = feeMatch ? parseInt(feeMatch[1]) : 0;
//     const passName = buttonText.split('(')[0].trim();
    
//     const passTypeResult = await db.query(`SELECT duration_days FROM PassTypes WHERE lot_id = $1 AND pass_name = $2`, [user.lot_id, passName]);
//     if (passTypeResult.rows.length === 0 || !fee) {
//         await sharedHandlers.clearUserState(user);
//         return await whatsapp.sendMessage(from, "❌ Error: Invalid pass type selected. Please start over.");
//     }
    
//     context.fee = fee;
//     context.passName = passName;
//     context.duration_days = passTypeResult.rows[0].duration_days;

//     // Now, check if we know this customer
//     const customerResult = await db.query(`SELECT customer_whatsapp_number FROM Customers WHERE lot_id = $1 AND vehicle_number = $2`, [user.lot_id, context.vehicle_number]);
//     if (customerResult.rows.length > 0) {
//         context.customer_number = customerResult.rows[0].customer_whatsapp_number;
//         await sharedHandlers.setUserState(user, 'AWAITING_PASS_PAYMENT_CONFIRM', context);
//         await askForPassPayment(from, context);
//     } else {
//         await sharedHandlers.setUserState(user, 'AWAITING_PASS_CUSTOMER_NUMBER', context);
//         await whatsapp.sendMessage(from, `To create the *${passName}*, please provide the customer's 10-digit mobile number.`);
//     }
// }

// async function handlePassCustomerNumberInput(from, user, messageText) {
//     const normalizedNumber = normalizePhoneNumber(messageText);
//     if (!normalizedNumber) {
//         return await whatsapp.sendMessage(from, "⚠️ Invalid number. Please provide a 10-digit number or type *cancel*.");
//     }
    
//     const context = user.conversation_context;
//     context.customer_number = normalizedNumber;

//     await db.query(`INSERT INTO Customers (lot_id, vehicle_number, customer_whatsapp_number, last_seen) VALUES ($1, $2, $3, NOW()) ON CONFLICT (lot_id, vehicle_number) DO UPDATE SET customer_whatsapp_number = $3, last_seen = NOW()`, [user.lot_id, context.vehicle_number, normalizedNumber]);
    
//     await sharedHandlers.setUserState(user, 'AWAITING_PASS_PAYMENT_CONFIRM', context);
//     await askForPassPayment(from, context);
// }

// async function askForPassPayment(from, context) {
//     const menu = {
//         type: 'button',
//         body: { text: `*Final Confirmation*\n\nCreate *${context.passName}* for *${context.vehicle_number}*?\n\n*Amount to Collect: ₹${context.fee}*` },
//         action: { buttons: [
//             { type: 'reply', reply: { id: 'pass_paid_cash', title: 'Paid via Cash' } },
//             { type: 'reply', reply: { id: 'pass_paid_upi', title: 'Paid via UPI' } },
//             { type: 'reply', reply: { id: 'cancel', title: 'Cancel' } }
//         ]}
//     };
//     await whatsapp.sendMessage(from, menu);
// }

// async function handlePassFinalConfirmation(from, user, buttonText) {
//     const { vehicle_number, customer_number, duration_days, passName, fee } = user.conversation_context;

//     if (buttonText === 'Cancel') {
//         await sharedHandlers.clearUserState(user);
//         return await whatsapp.sendMessage(from, `✅ Pass creation for ${vehicle_number} cancelled.`);
//     }

//     const expiryDate = new Date();
//     expiryDate.setDate(expiryDate.getDate() + parseInt(duration_days));

//     await db.query(`
//         INSERT INTO Passes (lot_id, vehicle_number, expiry_date, status, customer_whatsapp_number) VALUES ($1, $2, $3, 'ACTIVE', $4)
//         ON CONFLICT (lot_id, vehicle_number) DO UPDATE SET expiry_date = $3, status = 'ACTIVE', customer_whatsapp_number = $4
//     `, [user.lot_id, vehicle_number, expiryDate, customer_number]);

//     await sharedHandlers.clearUserState(user);
//     await whatsapp.sendMessage(from, `✅ *Success!* ${passName} created for ${vehicle_number}.`);
    
//     if (customer_number) {
//         await whatsapp.sendMessage(from, `Sending E-Pass to the customer...`);
//         const imagePath = await epassService.generateEpassImage(user.lot_id, vehicle_number);
//         if (imagePath) {
//             const imageUrl = epassService.getPublicUrlForFile(imagePath).replace('/receipts/', '/passes/');
//             await whatsapp.sendImage(customer_number, imageUrl);
//             setTimeout(() => receiptService.cleanupReceiptImage(imagePath), 60000);
//             // ... cleanup
//         }
//     }
// }


// module.exports = {
//     handleInitialVehicleEntry,
//     handleCustomerNumberInput,
//     handleParkingConfirmation,
//     handleExitConfirmation,
//     handleInitialVehicleExit,
//     handlePaymentFlow, // <-- NEW EXPORT
//     handleFinalConfirmation, // <-- NEW EXPORT
//     handleStartPassCreation,
//     handlePassTypeSelection,
//     handlePassCustomerNumberInput,
//     handlePassFinalConfirmation,
// };

// handlers/attendantHandlers.js
const db = require('../config/db');
const whatsapp = require('../services/whatsappService');
const receiptService = require('../services/receiptService');
const epassService = require('../services/epassService');
const { isValidIndianVehicleNumber, normalizePhoneNumber } = require('../utils/validators');
const { calculateFinalFee } = require('../utils/billing');
const logger = require('../utils/logger');

// We import the functions from ownerHandlers to keep state management unified
const { setUserState, clearUserState } = require('../handlers/sharedHandlers');

// =================================================================
// ENTRY WORKFLOW
// =================================================================

async function handleInitialVehicleEntry(from, user, vehicle_number) {
    if (!isValidIndianVehicleNumber(vehicle_number)) {
        return await whatsapp.sendMessage(from, `❌ Invalid vehicle number format for "${vehicle_number}". Please try again.`);
    }

    const checkResult = await db.query(`SELECT 1 FROM Transactions WHERE lot_id = $1 AND vehicle_number = $2 AND vehicle_state = 'INSIDE'`, [user.lot_id, vehicle_number]);
    if (checkResult.rows.length > 0) {
        const context = { vehicle_number };
        await setUserState(user, 'AWAITING_CHECKOUT_CONFIRMATION', context);
        const alreadyParkedMenu = { type: 'button', body: { text: `⚠️ *VEHICLE ALREADY PARKED*\n\nVehicle \`${vehicle_number}\` is already inside the lot.\n\n*Did you mean to check this vehicle out?*` }, action: { buttons: [ { type: 'reply', reply: { id: 'yes_checkout', title: 'Yes, Check Out' } }, { type: 'reply', reply: { id: 'no_cancel', title: 'Cancel' } } ]}};
        return await whatsapp.sendMessage(from, alreadyParkedMenu);
    }

    const passResult = await db.query(`SELECT 1 FROM Passes WHERE lot_id = $1 AND vehicle_number = $2 AND status = 'ACTIVE' AND expiry_date >= NOW()`, [user.lot_id, vehicle_number]);
    const context = { vehicle_number, isPassHolder: passResult.rows.length > 0 };
    
    if (context.isPassHolder) {
        await setUserState(user, 'AWAITING_PARKING_CONFIRMATION', context);
        const menu = { type: 'button', body: { text: `✅ *PASS HOLDER* (${vehicle_number})\n\nPark this vehicle?` }, action: { buttons: [{ type: 'reply', reply: { id: 'confirm_pass_park', title: 'Yes, Park' } }, { type: 'reply', reply: { id: 'cancel', title: 'Cancel' } }]}};
        return await whatsapp.sendMessage(from, menu);
    }

    const customerResult = await db.query(`SELECT customer_whatsapp_number FROM Customers WHERE lot_id = $1 AND vehicle_number = $2`, [user.lot_id, vehicle_number]);
    if (customerResult.rows.length > 0) {
        context.customer_number = customerResult.rows[0].customer_whatsapp_number;
        await askForPaymentType(from, user, context);
    } else {
        await setUserState(user, 'AWAITING_CUSTOMER_NUMBER', context);
        await whatsapp.sendMessage(from, `❓ *NEW CUSTOMER* (${vehicle_number})\n\nPlease reply with the customer's 10-digit mobile number to continue, or type *cancel*.`);
    }
}

async function handleCustomerNumberInput(from, user, messageText) {
    const normalizedNumber = normalizePhoneNumber(messageText);
    if (!normalizedNumber) {
        return await whatsapp.sendMessage(from, `⚠️ That doesn't look like a valid 10-digit number. Please try again or type *cancel*.`);
    }
    
    const context = user.conversation_context;
    context.customer_number = normalizedNumber;
    await db.query(`INSERT INTO Customers (lot_id, vehicle_number, customer_whatsapp_number, last_seen) VALUES ($1, $2, $3, NOW()) ON CONFLICT (lot_id, vehicle_number) DO UPDATE SET customer_whatsapp_number = $3, last_seen = NOW()`, [user.lot_id, context.vehicle_number, normalizedNumber]);
    
    await askForPaymentType(from, user, context);
}

async function askForPaymentType(from, user, context) {
    const lotResult = await db.query('SELECT pricing_model, block_rate_fee, hourly_rate FROM ParkingLots WHERE lot_id = $1', [user.lot_id]);
    const lot = lotResult.rows[0];
    let entryFeeText = '';
    let entryFee = 20;
    
    switch (lot.pricing_model) {
        case 'BLOCK': entryFee = lot.block_rate_fee || 20; entryFeeText = `Entry Fee: *₹${entryFee}* (1 Block)`; break;
        case 'HOURLY': entryFee = lot.hourly_rate || 20; entryFeeText = `Entry Fee: *₹${entryFee}* (First Hour)`; break;
        case 'TIERED':
        default:
            const tierResult = await db.query('SELECT fee FROM RateCards WHERE lot_id = $1 ORDER BY duration_hours ASC LIMIT 1', [user.lot_id]);
            entryFee = tierResult.rows[0]?.fee || 20;
            entryFeeText = `Entry Fee: *₹${entryFee}*`;
            break;
    }
    context.entryFee = entryFee;
    await setUserState(user, 'AWAITING_PAYMENT_TYPE', context);

    const menu = { type: 'button', body: { text: `💰 *PAYMENT for ${context.vehicle_number}*\n\n${entryFeeText}\n\nHow will the customer pay?` }, action: { buttons: [ { type: 'reply', reply: { id: 'pay_cash', title: 'Cash' } }, { type: 'reply', reply: { id: 'pay_upi', title: 'UPI' } }, { type: 'reply', reply: { id: 'pay_later', title: 'Pay Later' } }, ]}};
    await whatsapp.sendMessage(from, menu);
}

async function handleParkingConfirmation(from, user, buttonText) {
    const { vehicle_number, customer_number, entryFee = 0, isPassHolder } = user.conversation_context;
    const attendantId = user.user_id;
    let status = '';

    if (isPassHolder) {
        if (buttonText === 'Yes, Park') { status = 'PARKED_PASS'; } 
        else { await clearUserState(user); return await whatsapp.sendMessage(from, `✅ Action for ${vehicle_number} cancelled.`); }
    } else {
        switch(buttonText) {
            case 'Cash': status = 'PARKED_PAID_CASH'; break;
            case 'UPI': status = 'PARKED_PAID_UPI'; break;
            case 'Pay Later': status = 'PARKED_UNPAID'; break;
            default: await clearUserState(user); return await whatsapp.sendMessage(from, `✅ Action for ${vehicle_number} cancelled.`);
        }
    }
    
    if (status.includes('PAID')) {
        await db.query(`INSERT INTO Transactions (lot_id, attendant_id, vehicle_number, start_time, total_fee, status, vehicle_state, customer_whatsapp_number) VALUES ($1, $2, $3, NOW(), $4, $5, 'INSIDE', $6)`, [user.lot_id, attendantId, vehicle_number, entryFee, status, customer_number]);
    } else {
        await db.query(`INSERT INTO Transactions (lot_id, attendant_id, vehicle_number, start_time, status, vehicle_state, customer_whatsapp_number) VALUES ($1, $2, $3, NOW(), $4, 'INSIDE', $5)`, [user.lot_id, attendantId, vehicle_number, status, customer_number]);
    }

    let confirmationMessage = `👍 *DONE!* Vehicle ${vehicle_number} is parked.`;
    if (status === 'PARKED_UNPAID') { confirmationMessage = `⚠️ *PAYMENT PENDING!* Vehicle ${vehicle_number} is parked.` }
    await whatsapp.sendMessage(from, confirmationMessage);

    if (customer_number) {
        await whatsapp.sendMessage(from, `Sending receipt to customer...`);
        const imagePath = await receiptService.generateReceiptImage(user.lot_id, vehicle_number);
        if (imagePath) {
            const imageUrl = receiptService.getPublicUrlForFile(imagePath);
            await whatsapp.sendImage(customer_number, imageUrl);
            setTimeout(() => receiptService.cleanupReceiptImage(imagePath), 60000);
        }
        await clearUserState(user);
    } else {
        await setUserState(user, 'AWAITING_CUSTOMER_NUMBER_FOR_RECEIPT', { vehicle_number });
        await whatsapp.sendMessage(from, `_To send a receipt, reply with their 10-digit number. Otherwise, send any other message to continue._`);
    }
}

async function handleReceiptCustomerNumber(from, user, messageText) {
    const { vehicle_number } = user.conversation_context;
    const normalizedNumber = normalizePhoneNumber(messageText);

    if (normalizedNumber) {
        await db.query('UPDATE Transactions SET customer_whatsapp_number = $1 WHERE vehicle_number = $2 AND lot_id = $3 AND vehicle_state = \'INSIDE\' ORDER BY start_time DESC LIMIT 1', [normalizedNumber, vehicle_number, user.lot_id]);
        await db.query(`INSERT INTO Customers (lot_id, vehicle_number, customer_whatsapp_number, last_seen) VALUES ($1, $2, $3, NOW()) ON CONFLICT (lot_id, vehicle_number) DO UPDATE SET customer_whatsapp_number = $3, last_seen = NOW()`, [user.lot_id, vehicle_number, normalizedNumber]);
        
        await whatsapp.sendMessage(from, `✅ Customer number saved for ${vehicle_number}. Sending receipt...`);
        
        const imagePath = await receiptService.generateReceiptImage(user.lot_id, vehicle_number);
        if (imagePath) {
            const imageUrl = receiptService.getPublicUrlForFile(imagePath);
            await whatsapp.sendImage(normalizedNumber, imageUrl);
            setTimeout(() => receiptService.cleanupReceiptImage(imagePath), 60000);
        }
    } else {
        await whatsapp.sendMessage(from, `⚠️ Not a valid number. Skipping receipt. You can now park the next vehicle.`);
    }
    await clearUserState(user);
}

// =================================================================
// EXIT WORKFLOW
// =================================================================
async function handleInitialVehicleExit(from, user, identifiers) {
    if (!identifiers || identifiers.length === 0) return await whatsapp.sendMessage(from, `Please specify a vehicle or list number.`);
    if (identifiers.length > 1) return await whatsapp.sendMessage(from, `Please check out one vehicle at a time for the button flow.`);
    
    const identifier = identifiers[0];
    let transaction;

    const listNumber = parseInt(identifier);
    if (!isNaN(listNumber) && listNumber > 0) {
        const listResult = await db.query(`SELECT * FROM Transactions WHERE lot_id = $1 AND vehicle_state = 'INSIDE' ORDER BY start_time ASC LIMIT 1 OFFSET $2`, [user.lot_id, listNumber - 1]);
        if (listResult.rows.length > 0) { transaction = listResult.rows[0]; } 
        else {
            const countResult = await db.query(`SELECT COUNT(*) FROM Transactions WHERE lot_id = $1 AND vehicle_state = 'INSIDE'`, [user.lot_id]);
            return await whatsapp.sendMessage(from, `❌ Error: Invalid list number. There are only ${countResult.rows[0].count} vehicles inside.`);
        }
    } else {
        const transactionResult = await db.query(`SELECT * FROM Transactions WHERE lot_id = $1 AND vehicle_number = $2 AND vehicle_state = 'INSIDE' ORDER BY start_time DESC LIMIT 1`, [user.lot_id, identifier.toUpperCase()]);
        if (transactionResult.rows.length > 0) { transaction = transactionResult.rows[0]; } 
        else { return await whatsapp.sendMessage(from, `❌ No vehicle with ID "${identifier}" is currently inside the lot.`); }
    }
    
    const feeToCollect = await calculateFinalFee(user.lot_id, transaction);
    const context = { vehicle_number: transaction.vehicle_number, fee: feeToCollect, transaction_id: transaction.transaction_id };
    await setUserState(user, 'AWAITING_EXIT_CONFIRMATION', context);

    if (feeToCollect > 0) {
        const menu = { type: 'button', body: { text: `❗️*COLLECT PAYMENT* (${transaction.vehicle_number})\n\n*Remaining Amount Due: ₹${feeToCollect}*` }, action: { buttons: [{ type: 'reply', reply: { id: 'exit_cash', title: 'Cash Collected' } }, { type: 'reply', reply: { id: 'exit_upi', title: 'UPI Collected' } },{ type: 'reply', reply: { id: 'exit_cancel', title: 'Cancel' } }]}};
        await whatsapp.sendMessage(from, menu);
    } else {
        const menu = { type: 'button', body: { text: `✅ *OK TO GO* (${transaction.vehicle_number})\n\nNo due payment. Confirm exit?` }, action: { buttons: [{ type: 'reply', reply: { id: 'exit_confirm', title: 'Confirm Exit' } }, { type: 'reply', reply: { id: 'exit_cancel', title: 'Cancel' } }]}};
        await whatsapp.sendMessage(from, menu);
    }
}

async function handleExitConfirmation(from, user, buttonText) {
    const { vehicle_number, fee, transaction_id } = user.conversation_context;
    let newStatus;
    
    if (buttonText === 'Cancel') {
        await clearUserState(user);
        return await whatsapp.sendMessage(from, `✅ Exit for ${vehicle_number} cancelled.`);
    }

    const originalTransactionResult = await db.query(`SELECT * FROM Transactions WHERE transaction_id = $1`, [transaction_id]);
    const originalTransaction = originalTransactionResult.rows[0];

    switch (buttonText) {
        case 'Confirm Exit':
            newStatus = (originalTransaction.status.includes('PASS')) ? 'COMPLETED_PASS_EXIT' : 'COMPLETED_NO_FEE_EXIT';
            break;
        case 'Cash Collected': newStatus = 'COMPLETED_CASH_EXIT'; break;
        case 'UPI Collected': newStatus = 'COMPLETED_UPI_EXIT'; break;
        default:
            await clearUserState(user);
            return await whatsapp.sendMessage(from, `Invalid option. Resetting.`);
    }
    
    const finalTotalFee = (originalTransaction.total_fee || 0) + fee;
    await db.query(
        `UPDATE Transactions SET end_time = NOW(), status = $1, total_fee = $2, vehicle_state = 'EXITED' WHERE transaction_id = $3`, 
        [newStatus, finalTotalFee, transaction_id]
    );
    
    await clearUserState(user);
    await whatsapp.sendMessage(from, `👍 *Exit Confirmed!* The transaction for ${vehicle_number} is now closed.`);

    if (originalTransaction.customer_whatsapp_number) {
        await whatsapp.sendMessage(from, `Sending final receipt to customer...`);
        const imagePath = await receiptService.generateReceiptImage(user.lot_id, vehicle_number);
        if (imagePath) {
            const imageUrl = receiptService.getPublicUrlForFile(imagePath);
            await whatsapp.sendImage(originalTransaction.customer_whatsapp_number, imageUrl);
            setTimeout(() => receiptService.cleanupReceiptImage(imagePath), 60000);
        }
    }
}

// =================================================================
// PASS CREATION WORKFLOW
// =================================================================
async function handleStartPassCreation(from, user, vehicleNumber) {
    if (!isValidIndianVehicleNumber(vehicleNumber)) return await whatsapp.sendMessage(from, `❌ Invalid vehicle number format.`);
    
    const passTypesResult = await db.query(`SELECT * FROM PassTypes WHERE lot_id = $1 ORDER BY duration_days ASC`, [user.lot_id]);
    if (passTypesResult.rows.length === 0) return await whatsapp.sendMessage(from, "❌ No pass types created for this lot yet. Owner must set pass rates.");
    
    const context = { vehicle_number: vehicleNumber };
    await setUserState(user, 'AWAITING_PASS_TYPE_SELECTION', context);

    const buttons = passTypesResult.rows.map(pt => ({ type: 'reply', reply: { id: `pt_${pt.pass_type_id}`, title: `${pt.pass_name} (₹${pt.fee})` }}));
    buttons.push({ type: 'reply', reply: { id: 'cancel_pass', title: 'Cancel' } });
    const menu = { type: 'button', body: { text: `Please select a pass type for *${vehicleNumber}*:` }, action: { buttons } };
    await whatsapp.sendMessage(from, menu);
}

async function handlePassTypeSelection(from, user, buttonText) {
    const context = user.conversation_context;
    const feeMatch = buttonText.match(/₹(\d+)/);
    const fee = feeMatch ? parseInt(feeMatch[1]) : 0;
    const passName = buttonText.split('(')[0].trim();
    
    const passTypeResult = await db.query(`SELECT duration_days FROM PassTypes WHERE lot_id = $1 AND pass_name = $2`, [user.lot_id, passName]);
    if (passTypeResult.rows.length === 0 || !fee) {
        await clearUserState(user);
        return await whatsapp.sendMessage(from, "❌ Invalid pass type selected. Starting over.");
    }
    
    context.fee = fee;
    context.passName = passName;
    context.duration_days = passTypeResult.rows[0].duration_days;

    const customerResult = await db.query(`SELECT customer_whatsapp_number FROM Customers WHERE lot_id = $1 AND vehicle_number = $2`, [user.lot_id, context.vehicle_number]);
    if (customerResult.rows.length > 0) {
        context.customer_number = customerResult.rows[0].customer_whatsapp_number;
        await setUserState(user, 'AWAITING_PASS_PAYMENT_CONFIRM', context);
        await askForPassPayment(from, context);
    } else {
        await setUserState(user, 'AWAITING_PASS_CUSTOMER_NUMBER', context);
        await whatsapp.sendMessage(from, `To create the *${passName}*, please provide the customer's 10-digit mobile number.`);
    }
}

async function handlePassCustomerNumberInput(from, user, messageText) {
    const normalizedNumber = normalizePhoneNumber(messageText);
    if (!normalizedNumber) return await whatsapp.sendMessage(from, "⚠️ Invalid number. Please provide a 10-digit number or type *cancel*.");
    
    const context = user.conversation_context;
    context.customer_number = normalizedNumber;
    await db.query(`INSERT INTO Customers (lot_id, vehicle_number, customer_whatsapp_number, last_seen) VALUES ($1, $2, $3, NOW()) ON CONFLICT (lot_id, vehicle_number) DO UPDATE SET customer_whatsapp_number = $3, last_seen = NOW()`, [user.lot_id, context.vehicle_number, normalizedNumber]);
    
    await setUserState(user, 'AWAITING_PASS_PAYMENT_CONFIRM', context);
    await askForPassPayment(from, context);
}

async function askForPassPayment(from, context) {
    const menu = { type: 'button', body: { text: `*Final Confirmation*\n\nCreate *${context.passName}* for *${context.vehicle_number}*?\n\n*Amount to Collect: ₹${context.fee}*` }, action: { buttons: [ { type: 'reply', reply: { id: 'pass_paid_cash', title: 'Paid via Cash' } }, { type: 'reply', reply: { id: 'pass_paid_upi', title: 'Paid via UPI' } }, { type: 'reply', reply: { id: 'cancel', title: 'Cancel' } } ]}};
    await whatsapp.sendMessage(from, menu);
}

async function handlePassFinalConfirmation(from, user, buttonText) {
    const { vehicle_number, customer_number, duration_days, passName, fee } = user.conversation_context;
    if (buttonText === 'Cancel') {
        await clearUserState(user);
        return await whatsapp.sendMessage(from, `✅ Pass creation for ${vehicle_number} cancelled.`);
    }

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + parseInt(duration_days));
    await db.query(`INSERT INTO Passes (lot_id, vehicle_number, expiry_date, status, customer_whatsapp_number) VALUES ($1, $2, $3, 'ACTIVE', $4) ON CONFLICT (lot_id, vehicle_number) DO UPDATE SET expiry_date = $3, status = 'ACTIVE', customer_whatsapp_number = $4`, [user.lot_id, vehicle_number, expiryDate, customer_number]);

    await clearUserState(user);
    await whatsapp.sendMessage(from, `✅ *Success!* ${passName} created for ${vehicle_number}.`);
    
    if (customer_number) {
        await whatsapp.sendMessage(from, `Sending E-Pass to the customer...`);
        const imagePath = await epassService.generateEpassImage(user.lot_id, vehicle_number);
        if (imagePath) {
            const imageUrl = epassService.getPublicUrlForFile(imagePath).replace('/receipts/', '/passes/');
            await whatsapp.sendImage(customer_number, imageUrl);
            setTimeout(() => receiptService.cleanupReceiptImage(imagePath), 60000);
        }
    }
}

module.exports = {
    setUserState,
    clearUserState,
    handleInitialVehicleEntry,
    handleCustomerNumberInput,
    handleParkingConfirmation,
    handleReceiptCustomerNumber,
    handleInitialVehicleExit,
    handleExitConfirmation,
    handleStartPassCreation,
    handlePassTypeSelection,
    handlePassCustomerNumberInput,
    handlePassFinalConfirmation,
};