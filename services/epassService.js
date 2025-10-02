// services/epassService.js
const nodeHtmlToImage = require('node-html-to-image');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const logger = require('../utils/logger');

async function generateEpassImage(lotId, vehicleNumber) {
    try {
        const lotResult = await db.query('SELECT lot_name FROM ParkingLots WHERE lot_id = $1', [lotId]);
        const passResult = await db.query(
            'SELECT p.expiry_date, p.status, pt.pass_name, pt.fee FROM Passes p JOIN PassTypes pt ON p.lot_id = pt.lot_id WHERE p.lot_id = $1 AND p.vehicle_number = $2 ORDER BY p.pass_id DESC LIMIT 1', 
            [lotId, vehicleNumber]
        );

        if (passResult.rows.length === 0) return null;

        const lotName = lotResult.rows[0]?.lot_name || 'ParkEasy Lot';
        const pass = passResult.rows[0];
        
        const qrData = JSON.stringify({ action: "PARKEASY_PASS_VERIFY", vehicle: vehicleNumber });
        const qrCodeUrl = await QRCode.toDataURL(qrData);

        const htmlTemplate = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; width: 400px; border: 4px solid #128C7E; border-radius: 15px; padding: 25px; background-color: #e6fffa; }
                    .header { text-align: center; border-bottom: 2px dashed #075E54; padding-bottom: 15px; }
                    .header h1 { color: #075E54; margin: 0; font-size: 32px; }
                    .header p { color: #555; margin: 5px 0 0 0; }
                    .details h2 { text-align: center; margin: 20px 0; color: #333; font-size: 24px; background-color: #b2f5ea; padding: 5px; border-radius: 5px; }
                    .details-grid { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; font-size: 18px; }
                    .label { font-weight: 600; color: #444; }
                    .value { font-weight: 400; color: #111; }
                    .qr-section { text-align: center; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>ParkEasy</h1>
                    <p>${lotName}</p>
                </div>
                <div class="details">
                    <h2>${pass.pass_name} E-Pass</h2>
                    <div class="details-grid">
                        <div class="label">Vehicle No:</div>
                        <div class="value">${vehicleNumber}</div>
                        <div class="label">Valid Until:</div>
                        <div class="value">${new Date(pass.expiry_date).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
                        <div class="label">Status:</div>
                        <div class="value">${pass.status}</div>
                    </div>
                </div>
                <div class="qr-section">
                    <img src="${qrCodeUrl}" width="140" height="140" />
                </div>
            </body>
            </html>
        `;

        const passesDir = path.join(__dirname, '..', 'passes');
        if (!fs.existsSync(passesDir)){ fs.mkdirSync(passesDir); }
        const outputPath = path.join(passesDir, `epass_${vehicleNumber}_${Date.now()}.png`);
        
        await nodeHtmlToImage({ output: outputPath, html: htmlTemplate });
        logger.info(`Generated E-Pass image at: ${outputPath}`);
        return outputPath;
    } catch (error) {
        logger.error("Failed to generate E-Pass image:", error);
        return null;
    }
}
function getPublicUrlForFile(filePath) {
    const fileName = path.basename(filePath);
    const baseUrl = process.env.PUBLIC_URL; 
    return `${baseUrl}/receipts/${fileName}`;
}
// ... (getPublicUrlForFile and cleanup functions can be reused from receiptService)

module.exports = { 
    generateEpassImage,
    getPublicUrlForFile
};