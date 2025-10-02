// services/receiptService.js
const nodeHtmlToImage = require('node-html-to-image');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const logger = require('../utils/logger');

async function generateReceiptImage(lotId, vehicleNumber) {
    try {
        const lotResult = await db.query('SELECT lot_name FROM ParkingLots WHERE lot_id = $1', [lotId]);
        const transactionResult = await db.query(
            'SELECT start_time, end_time, total_fee, status, vehicle_state FROM Transactions WHERE lot_id = $1 AND vehicle_number = $2 ORDER BY start_time DESC LIMIT 1', 
            [lotId, vehicleNumber]
        );

        if (transactionResult.rows.length === 0) {
            logger.error(`No transaction found for ${vehicleNumber} to generate receipt.`);
            return null;
        }

        const lotName = lotResult.rows[0]?.lot_name || 'ParkEasy Lot';
        const transaction = transactionResult.rows[0];

        // --- DYNAMIC CONTENT LOGIC ---
        let borderColor = '#25D366'; // Green for paid
        let title = 'Parking E-Receipt';
        let amountPaid = `₹ ${transaction.total_fee || 0}`;
        let paymentMode = 'N/A';
        let entryTime = new Date(transaction.start_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        let exitTime = transaction.end_time ? new Date(transaction.end_time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'INSIDE';

        if (transaction.status.includes('CASH')) paymentMode = 'Cash';
        if (transaction.status.includes('UPI')) paymentMode = 'UPI';
        if (transaction.status.includes('PASS')) { borderColor = '#128C7E'; title = 'Pass Holder Entry/Exit'; amountPaid = 'Pass'; paymentMode = 'Monthly Pass'; }
        if (transaction.status.includes('UNPAID')) { borderColor = '#dd2c00'; title = 'Payment Pending'; amountPaid = `₹ ${transaction.total_fee || 0} (Due)`; paymentMode = 'Pay Later'; }
        if (transaction.vehicle_state === 'EXITED' && transaction.status.includes('NO_FEE')) { amountPaid = `₹ ${transaction.total_fee || 0} (No Overstay)`; }
        
        const qrData = JSON.stringify({ action: "PARKEASY_INFO", vehicle: vehicleNumber });
        const qrCodeUrl = await QRCode.toDataURL(qrData);

        const htmlTemplate = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; width: 380px; border: 4px solid ${borderColor}; border-radius: 15px; padding: 25px; background-color: #ffffff; }
                    .header { text-align: center; border-bottom: 2px dashed #ccc; padding-bottom: 15px; }
                    .header h1 { color: #128C7E; margin: 0; font-size: 28px; }
                    .header p { color: #555; margin: 5px 0 0 0; }
                    .details h2 { text-align: center; margin: 20px 0; color: #333; font-size: 22px; }
                    .details-grid { display: grid; grid-template-columns: 1fr 2fr; gap: 8px; font-size: 16px; }
                    .label { font-weight: 600; color: #444; }
                    .value { font-weight: 400; color: #111; }
                    .qr-section { text-align: center; margin-top: 20px; }
                    .footer { text-align: center; margin-top: 10px; font-size: 12px; color: #888; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>ParkEasy</h1>
                    <p>${lotName}</p>
                </div>
                <div class="details">
                    <h2>${title}</h2>
                    <div class="details-grid">
                        <div class="label">Vehicle No:</div>
                        <div class="value">${vehicleNumber}</div>
                        <div class="label">Entry Time:</div>
                        <div class="value">${entryTime}</div>
                        <div class="label">Exit Time:</div>
                        <div class="value">${exitTime}</div>
                        <div class="label">Total Paid:</div>
                        <div class="value">${amountPaid}</div>
                        <div class="label">Pay Mode:</div>
                        <div class="value">${paymentMode}</div>
                    </div>
                </div>
                <div class="qr-section">
                    <img src="${qrCodeUrl}" width="120" height="120" />
                </div>
            </body>
            </html>
        `;

        const receiptsDir = path.join(__dirname, '..', 'receipts');
        if (!fs.existsSync(receiptsDir)){ fs.mkdirSync(receiptsDir); }
        const outputPath = path.join(receiptsDir, `receipt_${vehicleNumber}_${Date.now()}.png`);
        
        await nodeHtmlToImage({ output: outputPath, html: htmlTemplate });
        logger.info(`Generated receipt image at: ${outputPath}`);
        return outputPath;
    } catch (error) {
        logger.error("Failed to generate receipt image:", error);
        return null;
    }
}

function getPublicUrlForFile(filePath) {
    const fileName = path.basename(filePath);
    const baseUrl = process.env.PUBLIC_URL; 
    return `${baseUrl}/receipts/${fileName}`;
}

async function cleanupReceiptImage(filePath) {
    try {
        fs.unlinkSync(filePath);
        logger.info(`Cleaned up receipt image: ${filePath}`);
    } catch (error) {
        logger.error(`Failed to clean up receipt image ${filePath}:`, error);
    }
}

module.exports = { 
    generateReceiptImage,
    getPublicUrlForFile,
    cleanupReceiptImage,
};