const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '12121212',
    database: process.env.DB_NAME || 'studentworkhub',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function addColumns() {
    try {
        console.log("Checking and adding columns...");

        // 1. Add columns to users table
        try {
            await pool.query("ALTER TABLE users ADD COLUMN otp_code VARCHAR(10) NULL");
            console.log("Added otp_code to users");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') console.log("otp_code already exists in users");
            else console.error("Error adding otp_code to users:", e.message);
        }

        try {
            await pool.query("ALTER TABLE users ADD COLUMN otp_created_at DATETIME NULL");
            console.log("Added otp_created_at to users");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') console.log("otp_created_at already exists in users");
            else console.error("Error adding otp_created_at to users:", e.message);
        }

        try {
            await pool.query("ALTER TABLE users ADD COLUMN is_email_verified TINYINT(1) DEFAULT 0");
            console.log("Added is_email_verified to users");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') console.log("is_email_verified already exists in users");
            else console.error("Error adding is_email_verified to users:", e.message);
        }

        // 2. Add columns to employers table
        try {
            await pool.query("ALTER TABLE employers ADD COLUMN otp_code VARCHAR(10) NULL");
            console.log("Added otp_code to employers");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') console.log("otp_code already exists in employers");
            else console.error("Error adding otp_code to employers:", e.message);
        }

        try {
            await pool.query("ALTER TABLE employers ADD COLUMN otp_created_at DATETIME NULL");
            console.log("Added otp_created_at to employers");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') console.log("otp_created_at already exists in employers");
            else console.error("Error adding otp_created_at to employers:", e.message);
        }

        try {
            await pool.query("ALTER TABLE employers ADD COLUMN is_email_verified TINYINT(1) DEFAULT 0");
            console.log("Added is_email_verified to employers");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') console.log("is_email_verified already exists in employers");
            else console.error("Error adding is_email_verified to employers:", e.message);
        }

        console.log("Database update complete. Please restart your server if needed.");
        process.exit(0);

    } catch (e) {
        console.error("Critical Error:", e);
        process.exit(1);
    }
}

addColumns();
