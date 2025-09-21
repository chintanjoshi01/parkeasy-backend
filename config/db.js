// config/db.js

const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' }); // Ensure .env is loaded
const logger = require('../utils/logger');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

pool.on('connect', () => {
    logger.info('Connected to the PostgreSQL database.');
});

pool.on('error', (err) => {
    logger.error('Unexpected error on idle PostgreSQL client', err);
    process.exit(-1);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    getClient: () => pool.connect(),
};