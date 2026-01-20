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

async function debugAdmin() {
    try {
        console.log("--- DEBUGGING ADMIN DATA (JSON) ---");

        // 1. Check ALL employers
        console.log("1. ALL EMPLOYERS IN DB (Last 5):");
        const [employers] = await pool.query("SELECT id, companyName, email, isAddressVerified, is_email_verified FROM employers ORDER BY id DESC LIMIT 5");
        console.log(JSON.stringify(employers, null, 2));

        // 2. Check what /api/admin/data returns for pending
        console.log("\n2. SIMULATING /api/admin/data (Pending):");
        const [pending] = await pool.query('SELECT * FROM employers WHERE isAddressVerified = 0');
        console.log(`Found ${pending.length} pending employers.`);

        if (pending.length > 0) {
            console.log("Pending Employers Details:");
            console.log(JSON.stringify(pending.map(e => ({
                id: e.id,
                name: e.companyName,
                email: e.email,
                addrVerified: e.isAddressVerified,
                emailVerified: e.is_email_verified,
                brCertificate: e.brCertificate ? 'EXISTS' : 'NULL'
            })), null, 2));
        } else {
            console.log("No pending employers found with current query.");
        }

        process.exit(0);

    } catch (e) {
        console.error("Critical Error:", e);
        process.exit(1);
    }
}

debugAdmin();
