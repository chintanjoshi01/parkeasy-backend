// utils/validators.js

function isValidIndianVehicleNumber(number) {
    if (!number || typeof number !== 'string') return false;
    
    // --- NEW, CORRECTED REGEX ---
    // This regex enforces:
    // ^         - Start of the string
    // [A-Z]{2}  - Exactly 2 uppercase letters (e.g., GJ)
    // [0-9]{2}  - Exactly 2 digits (e.g., 05)
    // [A-Z]{1,3} - Between 1 and 3 uppercase letters (e.g., RT or ABC)
    // [0-9]{4}  - Exactly 4 digits (e.g., 1234)
    // $         - End of the string
    const regex = /^[A-Z]{2}[0-9]{2}[A-Z]{1,3}[0-9]{4}$/;
    
    return regex.test(number.toUpperCase());
}

function normalizePhoneNumber(phoneStr) {
    if (!phoneStr) return null;
    const digitsOnly = phoneStr.replace(/\D/g, '');
    if (digitsOnly.length === 10) {
        return `91${digitsOnly}`;
    }
    if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
        return digitsOnly;
    }
    if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
        return `91${digitsOnly.substring(1)}`;
    }
    return null;
}

module.exports = {
    isValidIndianVehicleNumber,
    normalizePhoneNumber,
};