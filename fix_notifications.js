const mysql = require('mysql2/promise');
require('dotenv').config();

async function fix() {
    console.log("Connecting to database...");
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '12121212',
        database: process.env.DB_NAME || 'studentworkhub',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    try {
        console.log("Checking for bad notifications...");
        const [rows] = await pool.query('SELECT * FROM notifications WHERE message LIKE "%undefined%"');
        console.log(`Found ${rows.length} bad notifications.`);

        if (rows.length > 0) {
            console.log("Deleting bad notifications...");
            await pool.query('DELETE FROM notifications WHERE message LIKE "%undefined%"');
            console.log("Deleted.");
        } else {
            console.log("No bad notifications found. The issue might be purely visual or already resolved.");
        }

    } catch (e) {
        console.error("Error:", e.message);
    } finally {
        await pool.end();
    }
}

fix();
