// handlers/ownerHandlers.js

// =================================================================
// IMPORTS
// =================================================================
const db = require('../config/db');
const whatsapp = require('../services/whatsappService');
const { isValidIndianVehicleNumber, normalizePhoneNumber } = require('../utils/validators');
const { calculateFinalFee } = require('../utils/billing');
const logger = require('../utils/logger');
const aiService = require('../services/aiService');
const sharedHandlers = require('../handlers/sharedHandlers')

// =================================================================
// SHARED HANDLERS (Used by Owners & Attendants but kept here for simplicity)
// =================================================================



async function handleListVehicles(from, user) {
    // We need to fetch the full transaction object to calculate fees
    const listResult = await db.query(`SELECT * FROM Transactions WHERE lot_id = $1 AND vehicle_state = 'INSIDE' ORDER BY start_time ASC`, [user.lot_id]);
    
    if (listResult.rows.length === 0) {
        return await whatsapp.sendMessage(from, "✅ No vehicles are currently inside.");
    }
    
    let replyMessage = "--- Vehicles Currently Inside ---\n\n";
    
    // We use a for...of loop to handle the async fee calculation for each vehicle
    for (let i = 0; i < listResult.rows.length; i++) {
        const vehicle = listResult.rows[i];
        const parkedTime = new Date(vehicle.start_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        let paymentStatus = '';

        // --- NEW, SMARTER STATUS & FEE LOGIC ---
        if (vehicle.status.includes('PASS')) {
            paymentStatus = '💳 Pass Holder';
        } else {
            // Calculate the fee that would be due if they checked out right now
            const feeToCollect = await calculateFinalFee(user.lot_id, vehicle);

            if (feeToCollect > 0) {
                if (vehicle.status.includes('UNPAID')) {
                    paymentStatus = `⚠️ Unpaid (*₹${feeToCollect} due*)`;
                } else {
                    paymentStatus = `❗️ Overdue (*₹${feeToCollect} due*)`;
                }
            } else {
                paymentStatus = '✅ Paid';
            }
        }

        replyMessage += `${i + 1}. \`${vehicle.vehicle_number}\` (At: ${parkedTime})\n   - ${paymentStatus}\n`;
    }

    replyMessage += "\n_To check out a vehicle, simply reply with its list number (e.g.,_ `2` _)._";
    
    if (user.role === 'attendant' || user.role === 'owner') {
        // Both roles can now use checkout-by-list
        await setUserState(user, 'AWAITING_LIST_CHECKOUT', {});
    }
    
    await whatsapp.sendMessage(from, replyMessage);
}


// =================================================================
// OWNER-ONLY HANDLERS
// =================================================================

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


async function handleSetPricingModel(from, user, params) {
    if (user.role !== 'owner') return await whatsapp.sendMessage(from, "❌ This command is for Owners only.");
    const model_type = params.model_type ? params.model_type.toUpperCase() : null;

    if (!model_type || !['TIERED', 'BLOCK', 'HOURLY'].includes(model_type)) {
        return await whatsapp.sendMessage(from, "❌ Invalid model. Please choose TIERED, BLOCK, or HOURLY.");
    }
    await db.query(`UPDATE ParkingLots SET pricing_model = $1 WHERE lot_id = $2`, [model_type, user.lot_id]);
    await whatsapp.sendMessage(from, `✅ Success! Pricing model has been set to *${model_type}*.`);
}

async function handleSetTieredRate(from, user, params) {
    if (user.role !== 'owner') return await whatsapp.sendMessage(from, "❌ This command is for Owners only.");
    const { duration, fee } = params;

    if (!duration || !fee) return await whatsapp.sendMessage(from, "❌ Missing duration or fee. Example: `set rate for 4 hours to 30`");

    await db.query(`UPDATE ParkingLots SET pricing_model = 'TIERED' WHERE lot_id = $1`, [user.lot_id]);

    const query = `
        INSERT INTO RateCards (lot_id, duration_hours, fee) VALUES ($1, $2, $3)
        ON CONFLICT (lot_id, duration_hours) DO UPDATE SET fee = $3
    `;
    await db.query(query, [user.lot_id, parseInt(duration), parseInt(fee)]);
    await whatsapp.sendMessage(from, `✅ Tiered rate updated: Up to ${duration} hours will cost ₹${fee}.`);
}

async function handleSetFlatRate(from, user, params) {
    if (user.role !== 'owner') return await whatsapp.sendMessage(from, "❌ This command is for Owners only.");
    const { rate_type, fee, hours } = params;

    if (!rate_type || !fee) return await whatsapp.sendMessage(from, "❌ Missing rate type or fee.");

    if (rate_type === 'block') {
        if (!hours) return await whatsapp.sendMessage(from, "❌ For a block rate, you must specify the hours. Example: `set block rate 60 for 12 hours`");
        await db.query(
            `UPDATE ParkingLots SET pricing_model = 'BLOCK', block_rate_fee = $1, block_rate_hours = $2 WHERE lot_id = $3`,
            [parseInt(fee), parseInt(hours), user.lot_id]
        );
        await whatsapp.sendMessage(from, `✅ Block rate set: ₹${fee} per ${hours}-hour block.`);
    } else if (rate_type === 'hourly') {
        await db.query(
            `UPDATE ParkingLots SET pricing_model = 'HOURLY', hourly_rate = $1 WHERE lot_id = $2`,
            [parseInt(fee), user.lot_id]
        );
        await whatsapp.sendMessage(from, `✅ Hourly rate set: ₹${fee} per hour.`);
    } else {
        await whatsapp.sendMessage(from, "❌ Invalid rate type. Use 'block' or 'hourly'.");
    }
}

async function handleViewRates(from, user) {
    if (user.role !== 'owner') return await whatsapp.sendMessage(from, "❌ This command is for Owners only.");

    const lotResult = await db.query('SELECT * FROM ParkingLots WHERE lot_id = $1', [user.lot_id]);
    const lot = lotResult.rows[0];

    let rateMessage = `*--- Current Rate Card for ${lot.lot_name} ---*\n\n*Pricing Model:* ${lot.pricing_model}\n\n`;

    switch (lot.pricing_model) {
        case 'BLOCK':
            rateMessage += `*Block Rate:* ₹${lot.block_rate_fee || 0} / ${lot.block_rate_hours || 0} hours\n`;
            break;
        case 'HOURLY':
            rateMessage += `*Hourly Rate:* ₹${lot.hourly_rate || 0} / hour\n`;
            break;
        case 'TIERED':
        default:
            const rateCardResult = await db.query('SELECT * FROM RateCards WHERE lot_id = $1 ORDER BY duration_hours ASC', [user.lot_id]);
            if (rateCardResult.rows.length === 0) {
                rateMessage += "_No tiered rates have been set yet._\n";
            } else {
                rateCardResult.rows.forEach(tier => {
                    rateMessage += `• *Up to ${tier.duration_hours} hours:* ₹${tier.fee}\n`;
                });
            }
            break;
    }
    rateMessage += `\n*Monthly Pass Rate:* ₹${lot.pass_rate || 500}`;
    await whatsapp.sendMessage(from, rateMessage);
}

async function handleSetPassRate(from, user, params) {
    if (user.role !== 'owner') return await whatsapp.sendMessage(from, "❌ This command is for Owners only.");

    const { fee } = params;
    if (!fee || isNaN(parseInt(fee))) {
        return await whatsapp.sendMessage(from, "❌ Please provide a valid price. Example: `set pass rate 500`");
    }

    await db.query(`UPDATE ParkingLots SET pass_rate = $1 WHERE lot_id = $2`, [parseInt(fee), user.lot_id]);
    await whatsapp.sendMessage(from, `✅ Success! Your standard 30-day pass rate has been set to ₹${fee}.`);
}


async function handleAddPass(from, user, params, messageText) {
    if (user.role !== 'owner') return await whatsapp.sendMessage(from, "❌ This command can only be used by an Owner.");
    const { vehicle_number, duration_days = 30, customer_number, language } = params;

    if (!vehicle_number) return await whatsapp.sendMessage(from, "❌ AI Error: I'm missing the vehicle number for the pass.");

    if (!isValidIndianVehicleNumber(vehicle_number)) {
        let errorMessage;
        if (language === 'hi') {
            errorMessage = `❌ "${vehicle_number}" का वाहन नंबर प्रारूप गलत है।`;
        } else {
            errorMessage = `❌ Invalid vehicle number format for "${vehicle_number}".`;
        }
        return await whatsapp.sendMessage(from, errorMessage);
    }

    const lotResult = await db.query(`SELECT pass_rate FROM ParkingLots WHERE lot_id = $1`, [user.lot_id]);
    const passRate = lotResult.rows[0]?.pass_rate || 500;

    const normalizedCustomerNumber = normalizePhoneNumber(customer_number);
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + parseInt(duration_days));

    await db.query(`INSERT INTO Passes (lot_id, vehicle_number, expiry_date, status, customer_whatsapp_number) VALUES ($1, $2, $3, 'ACTIVE', $4) ON CONFLICT (lot_id, vehicle_number) DO UPDATE SET expiry_date = $3, status = 'ACTIVE', customer_whatsapp_number = $4`, [user.lot_id, vehicle_number, expiryDate, normalizedCustomerNumber]);

    let confirmationMessage = `
✅ Pass created for *${vehicle_number}*.
*Valid Until:* ${expiryDate.toLocaleDateString('en-GB')}

*Please collect ₹${passRate} from the customer.*
    `;
    if (normalizedCustomerNumber) {
        confirmationMessage += `\n\n_Customer number ${normalizedCustomerNumber} has been saved for reminders._`;
    }

    await whatsapp.sendMessage(from, confirmationMessage.trim());
}

async function handleRemovePass(from, user, params, messageText) {
    if (user.role !== 'owner') {
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
            [user.lot_id, vehicle_number]
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


async function handleRemoveAttendant(from, user, params) {
    if (user.role !== 'owner') return await whatsapp.sendMessage(from, "❌ This command can only be used by an Owner.");
    const { identifier } = params;
    if (!identifier) return await whatsapp.sendMessage(from, "❌ AI Error: I'm missing the attendant's number or list position to remove.");
    let attendantNumberToRemove;
    const listNumber = parseInt(identifier);

    if (!isNaN(listNumber) && listNumber > 0) {
        // Find by list number
        const listResult = await db.query(`SELECT whatsapp_number FROM Attendants WHERE lot_id = $1 AND is_active = TRUE ORDER BY name ASC LIMIT 1 OFFSET $2`, [user.lot_id, listNumber - 1]);
        if (listResult.rows.length > 0) {
            attendantNumberToRemove = listResult.rows[0].whatsapp_number;
        } else {
            return await whatsapp.sendMessage(from, `❌ Invalid list number. Please check the list and try again.`);
        }
    } else {
        // Find by phone number
        const normalizedNumber = normalizePhoneNumber(identifier);
        if (!normalizedNumber) return await whatsapp.sendMessage(from, `❌ Invalid phone number format for "${identifier}".`);
        attendantNumberToRemove = normalizedNumber;
    }

    const result = await db.query(`UPDATE Attendants SET is_active = FALSE WHERE whatsapp_number = $1 AND lot_id = $2`, [attendantNumberToRemove, user.lot_id]);
    if (result.rowCount > 0) {
        await whatsapp.sendMessage(from, `✅ Attendant ${attendantNumberToRemove} has been deactivated.`);
    } else {
        await whatsapp.sendMessage(from, `❌ Attendant with number ${attendantNumberToRemove} not found in your lot.`);
    }

}
async function handleAddAttendant(from, user, params) {
    if (user.role !== 'owner') return await whatsapp.sendMessage(from, "❌ This command can only be used by an Owner.");
    const { attendant_name, attendant_number } = params;
    if (!attendant_name || !attendant_number) return await whatsapp.sendMessage(from, "❌ AI Error: I'm missing the attendant's name or number.");

    // --- PLAN ENFORCEMENT ---
    const ownerPlanResult = await db.query('SELECT subscription_plan FROM Owners WHERE owner_id = $1', [user.user_id]);
    const plan = ownerPlanResult.rows[0]?.subscription_plan || 'Starter';
    let maxAttendants = 1;
    if (plan === 'Growth') maxAttendants = 5;
    if (plan === 'Pro') maxAttendants = 15;
    const currentAttendantsResult = await db.query('SELECT COUNT(*) FROM Attendants WHERE lot_id = $1 AND is_active = TRUE', [user.lot_id]);
    const currentAttendantCount = parseInt(currentAttendantsResult.rows[0].count);
    if (currentAttendantCount >= maxAttendants) {
        return await whatsapp.sendMessage(from, `❌ You have reached the maximum of ${maxAttendants} attendant(s) for your *${plan}* plan. Please upgrade to add more.`);
    }

    const normalizedAttendantNumber = normalizePhoneNumber(attendant_number);
    if (!normalizedAttendantNumber) return await whatsapp.sendMessage(from, `❌ Invalid phone number format for "${attendant_number}".`);

    try {
        await db.query(`INSERT INTO Attendants (lot_id, name, whatsapp_number) VALUES ($1, $2, $3)`, [user.lot_id, attendant_name, normalizedAttendantNumber]);
        await whatsapp.sendMessage(from, `✅ Attendant "${attendant_name}" added successfully. You now have ${currentAttendantCount + 1} of ${maxAttendants} attendants.`);
    } catch (err) {
        if (err.code === '23505') await whatsapp.sendMessage(from, `❌ Error: An attendant with number ${normalizedAttendantNumber} is already registered.`);
        else { logger.error("Error adding attendant:", err); await whatsapp.sendMessage(from, "❌ An error occurred while adding the attendant."); }
    }
}

async function handleViewPasses(from, user) {
    if (user.role !== 'owner') return await whatsapp.sendMessage(from, "❌ This command can only be used by an Owner.");
    const passesResult = await db.query(`SELECT vehicle_number, expiry_date FROM Passes WHERE lot_id = $1 AND status = 'ACTIVE' AND expiry_date >= NOW() ORDER BY expiry_date ASC`, [user.lot_id]);
    if (passesResult.rows.length === 0) return await whatsapp.sendMessage(from, "--- No Active Passes ---");

    let replyMessage = "--- Active Passes ---\n";
    passesResult.rows.forEach((pass, index) => {
        const expiry = new Date(pass.expiry_date).toLocaleDateString('en-GB');
        replyMessage += `${index + 1}. ${pass.vehicle_number} (Expires: ${expiry})\n`;
    });
    await whatsapp.sendMessage(from, replyMessage);
}

// async function handleShowMenu(from, role) {
//     if (role === 'owner') {
//         const ownerMenu = {
//             type: 'button',
//             body: { text: 'Welcome, Owner! I am your AI assistant. Please select an option.' },
//             action: {
//                 buttons: [
//                     { type: 'reply', reply: { id: 'owner_list_vehicles', title: 'List Vehicles' } },
//                     { type: 'reply', reply: { id: 'owner_get_report', title: 'Get Report' } },
//                     // --- THIS IS THE NEW BUTTON ---
//                     { type: 'reply', reply: { id: 'owner_list_attendants', title: 'Manage Staff' } }
//                 ]
//             }
//         };
//         await whatsapp.sendMessage(from, ownerMenu);
//     } else { // Attendant
//         const attendantMenu = { 
//             type: 'button', 
//             body: { text: 'Welcome! I am your AI assistant. Please select an option.' }, 
//             action: { 
//                 buttons: [
//                     { type: 'reply', reply: { id: 'attendant_list_parked', title: 'List Vehicles' } },
//                     { type: 'reply', reply: { id: 'attendant_check_status', title: 'Status' } }
//                 ]
//             } 
//         };
//         await whatsapp.sendMessage(from, attendantMenu);
//     }
// }
async function handleShowMenu(from, role) {
    if (role === 'owner') {
        // --- THIS IS THE NEW, UPGRADED LIST MESSAGE FOR OWNERS ---
        const ownerMenuList = {
            type: 'list',
            header: {
                type: 'text',
                text: 'Owner Menu'
            },
            body: {
                text: 'Welcome, Owner! Please select a primary action from the list below.'
            },
            footer: {
                text: 'Powered by ParkEasy'
            },
            action: {
                button: 'Show Options', // The text on the button that opens the list
                sections: [
                    {
                        title: 'Daily Operations',
                        rows: [
                            {
                                id: 'list_vehicles_row',
                                title: 'List Vehicles',
                                description: 'See all cars currently inside the lot.'
                            },
                            {
                                id: 'get_report_row',
                                title: 'Get Report',
                                description: "View today's or yesterday's business summary."
                            }
                        ]
                    },
                    {
                        title: 'Management',
                        rows: [
                            {
                                id: 'view_passes_row',
                                title: 'View Passes',
                                description: 'See a list of all active monthly passes.'
                            },
                            {
                                id: 'list_attendants_row',
                                title: 'Manage Staff',
                                description: 'View, add, or remove your attendants.'
                            }
                        ]
                    }
                ]
            }
        };
        await whatsapp.sendMessage(from, ownerMenuList);

    } else { // Attendant still gets the simple, fast buttons
        const attendantMenu = { 
            type: 'button', 
            body: { text: 'Welcome! Please select an option.' }, 
            action: { 
                buttons: [ 
                    { type: 'reply', reply: { id: 'attendant_list_parked', title: 'List Vehicles' } }, 
                    { type: 'reply', reply: { id: 'attendant_check_status', title: 'Status' } } 
                ] 
            } 
        };
        await whatsapp.sendMessage(from, attendantMenu);
    }
}

// THIS IS THE NEW, CORRECTED REPORTING FUNCTION
async function handleGetReport(from, user, params) {
    if (user.role !== 'owner') {
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

    // --- THIS IS THE NEW, CORRECTED QUERY ---
    const query = `
        SELECT
            -- Sum of fees from all transactions completed within the date range
            COALESCE(SUM(CASE WHEN status LIKE '%_CASH_%' THEN total_fee ELSE 0 END), 0) as cash_total,
            COALESCE(SUM(CASE WHEN status LIKE '%_UPI_%' THEN total_fee ELSE 0 END), 0) as upi_total,
            
            -- Count of vehicles that EXITED in the date range
            COUNT(DISTINCT CASE WHEN vehicle_state = 'EXITED' THEN transaction_id END) as total_exits,
            
            -- Count of pass holder vehicles that EXITED in the date range
            COUNT(DISTINCT CASE WHEN status LIKE '%_PASS_EXIT' THEN transaction_id END) as pass_exits
        FROM Transactions
        WHERE 
            lot_id = $1 AND 
            (
                -- Include payments made at EXIT within the date range
                (end_time BETWEEN $2 AND $3 AND status LIKE '%_EXIT') OR
                -- Include payments made at ENTRY within the date range
                (start_time BETWEEN $2 AND $3 AND status LIKE '%_ENTRY')
            )
    `;

    try {
        const reportResult = await db.query(query, [user.lot_id, startDate, endDate]);
        const data = reportResult.rows[0];
        const totalCollections = parseInt(data.cash_total) + parseInt(data.upi_total);
        const paidVehiclesExits = parseInt(data.total_exits) - parseInt(data.pass_exits);

        let replyMessage = `
*--- ParkEasy ${reportTitle} ---*
*Date:* ${startDate.toLocaleDateString('en-GB')}

*--- Collections Summary ---*
💰 *Total Collections:* ₹${totalCollections}
💵 *Cash Logged:* ₹${data.cash_total}
📲 *UPI Logged:* ₹${data.upi_total}

*--- Vehicle Exits Summary ---*
🚗 *Paid Vehicle Exits:* ${paidVehiclesExits}
💳 *Pass Holder Exits:* ${data.pass_exits}
*Total Vehicle Exits:* ${data.total_exits}

------------------------------------
_This is an automated report._
        `;

        await whatsapp.sendMessage(from, replyMessage.trim());
    } catch (err) {
        logger.error("Error generating report:", err);
        await whatsapp.sendMessage(from, "❌ Sorry, an error occurred while generating the report.");
    }
}



async function handleGetHelpList(from, user, params) {
    const { role } = user;
    const language = params.language || 'en';

    // Call the AI to generate the help message in the detected language
    const helpMessage = await aiService.generateHelpMessage(role, language);

    await whatsapp.sendMessage(from, helpMessage);
}




// --- THIS IS THE CORRECTED LIST FUNCTION ---
async function handleListAttendants(from, user, params) {
if (user.role !== 'owner') return await whatsapp.sendMessage(from, "❌ This command is for Owners only.");

// Check if the AI detected "all" in the user's message
const showAll = params.filter === 'all';

const query = `
    SELECT attendant_id, name, whatsapp_number, is_active FROM Attendants 
    WHERE lot_id = $1 ${showAll ? '' : 'AND is_active = TRUE'} 
    ORDER BY is_active DESC, name ASC`;

const result = await db.query(query, [user.lot_id]);

if (result.rows.length === 0) {
    return await whatsapp.sendMessage(from, `You have no ${showAll ? '' : 'active '}attendants registered.`);
}

const title = showAll ? 'All Attendants (Active & Inactive)' : 'Your Active Attendants';
let listMessage = `*--- ${title} ---*\n\n`;

result.rows.forEach((attendant, index) => {
    const status = attendant.is_active ? '✅ Active' : '❌ Inactive';
    listMessage += `${index + 1}. *${attendant.name}* (${status})\n`;
    listMessage += `   - \`${attendant.whatsapp_number}\`\n`;
});

if (showAll) {
    listMessage += "\n_To reactivate an attendant, use 'activate' and their list number (e.g.,_ `activate 2`_)_";
} else {
    listMessage += "\n_To remove an attendant, use 'remove' and their list number (e.g.,_ `remove 1`_)_.";
    listMessage += "\n_To see all staff (including inactive), type_ `list all attendants`_._";
}

await whatsapp.sendMessage(from, listMessage);

  

}

// --- THIS IS THE NEW CONVERSATIONAL REMOVAL FLOW ---

// STEP 1: Starts the removal process
// --- THIS IS THE NEW CONVERSATIONAL REMOVAL FLOW ---
// --- THIS IS THE CORRECTED REMOVAL FLOW ---
async function handleManageAttendant(from, user, params) {
    if (user.role !== 'owner') return await whatsapp.sendMessage(from, "❌ This command is for Owners only.");
    const { identifier } = params;
    if (!identifier) return await whatsapp.sendMessage(from, "❌ Please specify which attendant to remove. Example: `remove 2`");
    
    let attendantToRemove;
    const listNumber = parseInt(identifier);
    const listQuery = `SELECT attendant_id, name, whatsapp_number, is_active FROM Attendants WHERE lot_id = $1 ORDER BY is_active DESC, name ASC`;

    if (!isNaN(listNumber) && listNumber > 0) {
        const listResult = await db.query(`${listQuery} LIMIT 1 OFFSET $2`, [user.lot_id, listNumber - 1]);
        if (listResult.rows.length > 0) { attendantToRemove = listResult.rows[0]; } 
        else { return await whatsapp.sendMessage(from, `❌ Invalid list number.`); }
    } else {
        const normalizedNumber = normalizePhoneNumber(identifier);
        if (!normalizedNumber) return await whatsapp.sendMessage(from, `❌ Invalid phone number format.`);
        const findResult = await db.query(`SELECT attendant_id, name, whatsapp_number, is_active FROM Attendants WHERE lot_id = $1 AND whatsapp_number = $2`, [user.lot_id, normalizedNumber]);
        if (findResult.rows.length > 0) { attendantToRemove = findResult.rows[0]; } 
        else { return await whatsapp.sendMessage(from, `❌ Attendant with number ${normalizedNumber} not found.`); }
    }

    if (!attendantToRemove.is_active) {
        return await whatsapp.sendMessage(from, `Attendant *${attendantToRemove.name}* is already inactive. To reactivate, use the 'activate' command.`);
    }

    // This now correctly saves the state to the Owners table in the database
    await sharedHandlers.setUserState(user, 'AWAITING_REMOVAL_CONFIRMATION', { attendant_to_remove: attendantToRemove });

    const menu = {
        type: 'button',
        body: { text: `You are about to remove:\n*${attendantToRemove.name}*\n\`${attendantToRemove.whatsapp_number}\`\n\nHow do you want to proceed?` },
        action: { buttons: [ { type: 'reply', reply: { id: 'deactivate_confirm', title: 'Deactivate Only' } }, { type: 'reply', reply: { id: 'delete_confirm', title: 'Delete Forever' } }, { type: 'reply', reply: { id: 'cancel_removal', title: 'Cancel' } } ]}
    };
    await whatsapp.sendMessage(from, menu);
}

async function handleRemovalConfirmation(from, user, buttonText) {
    const { attendant_to_remove } = user.conversation_context;
    if (!attendant_to_remove) {
        await sharedHandlers.clearUserState(user);
        return await whatsapp.sendMessage(from, "Something went wrong. Please start again.");
    }
    
    try {
        if (buttonText === 'Deactivate Only') {
            await db.query(`UPDATE Attendants SET is_active = FALSE WHERE attendant_id = $1`, [attendant_to_remove.attendant_id]);
            await whatsapp.sendMessage(from, `✅ Attendant *${attendant_to_remove.name}* has been deactivated.`);
        } else if (buttonText === 'Delete Forever') {
            await db.query(`UPDATE Transactions SET attendant_id = NULL WHERE attendant_id = $1`, [attendant_to_remove.attendant_id]);
            await db.query(`DELETE FROM Attendants WHERE attendant_id = $1`, [attendant_to_remove.attendant_id]);
            await whatsapp.sendMessage(from, `🗑️ Attendant *${attendant_to_remove.name}* has been permanently deleted.`);
        } else { // Cancel
            await whatsapp.sendMessage(from, `✅ Action cancelled.`);
        }
    } catch (error) {
        logger.error("Error during attendant removal:", error);
        await whatsapp.sendMessage(from, "❌ An error occurred.");
    } finally {
        await sharedHandlers.clearUserState(user);
    }
}

// --- THIS IS THE NEW, ROBUST REACTIVATE FUNCTION ---
async function handleActivateAttendant(from, user, params) {
if (user.role !== 'owner') return await whatsapp.sendMessage(from, "❌ This command is for Owners only.");
const { identifier } = params;
if (!identifier) return await whatsapp.sendMessage(from, "❌ Please specify which attendant to activate. Example: activate 2");


    
let attendantToActivate;
const listNumber = parseInt(identifier);
// When activating, we must search from the FULL list of attendants
const listQuery = `SELECT attendant_id, name, whatsapp_number, is_active FROM Attendants WHERE lot_id = $1 ORDER BY is_active DESC, name ASC`;

if (!isNaN(listNumber) && listNumber > 0) {
    const listResult = await db.query(`${listQuery} LIMIT 1 OFFSET $2`, [user.lot_id, listNumber - 1]);
    if (listResult.rows.length > 0) {
        attendantToActivate = listResult.rows[0];
    } else {
        return await whatsapp.sendMessage(from, `❌ Invalid list number. Use 'list all attendants' to see all numbers.`);
    }
} else {
    const normalizedNumber = normalizePhoneNumber(identifier);
    if (!normalizedNumber) return await whatsapp.sendMessage(from, `❌ Invalid phone number format.`);
    const findResult = await db.query(`SELECT attendant_id, name, whatsapp_number, is_active FROM Attendants WHERE lot_id = $1 AND whatsapp_number = $2`, [user.lot_id, normalizedNumber]);
    if (findResult.rows.length > 0) {
        attendantToActivate = findResult.rows[0];
    } else {
        return await whatsapp.sendMessage(from, `❌ Attendant with number ${normalizedNumber} not found.`);
    }
}

if (attendantToActivate.is_active) {
    return await whatsapp.sendMessage(from, `Attendant *${attendantToActivate.name}* is already active.`);
}

// Now, perform the update using the unique attendant_id
const result = await db.query(
    `UPDATE Attendants SET is_active = TRUE WHERE attendant_id = $1`, 
    [attendantToActivate.attendant_id]
);

if (result.rowCount > 0) {
    await whatsapp.sendMessage(from, `✅ Attendant *${attendantToActivate.name}* has been reactivated.`);
} else {
    await whatsapp.sendMessage(from, `❌ Failed to reactivate attendant. Please try again.`);
}

  

}




module.exports = {
    handleVehicleCheckout,
    handleListVehicles,
    handleSetPricingModel,
    handleSetTieredRate,
    handleSetFlatRate,
    handleViewRates,
    handleSetPassRate,
    handleAddPass,
    handleRemovePass,
    handleRemoveAttendant,
    handleAddAttendant,
    handleViewPasses,
    handleShowMenu,
    handleGetReport,
    handleGetHelpList,
    handleListAttendants,
    handleListAttendants,
    handleManageAttendant,
    handleRemovalConfirmation,
    handleActivateAttendant
};