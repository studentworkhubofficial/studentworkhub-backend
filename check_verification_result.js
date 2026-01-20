const mysql = require('mysql2/promise');
const fs = require('fs');
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

async function check() {
    try {
        if (!fs.existsSync('temp_test_email.txt')) {
            console.error("No test email found.");
            process.exit(1);
        }
        const email = fs.readFileSync('temp_test_email.txt', 'utf8');
        console.log(`Checking status for: ${email}`);

        // 1. Check Plan
        const [emp] = await pool.query('SELECT currentPlan, jobPostsRemaining FROM employers WHERE email = ?', [email]);
        console.log('Employer Plan:', emp[0]);

        if (emp[0].currentPlan !== 'free') {
            console.error("FAIL: Plan was not downgraded to free.");
        } else {
            console.log("PASS: Plan downgraded to free.");
        }

        // 2. Check Active Jobs
        const [jobs] = await pool.query('SELECT status, count(*) c FROM jobs WHERE employerEmail = ? GROUP BY status', [email]);
        console.log('Job Counts:', jobs);

        const activeJobs = jobs.find(j => j.status === 'Active')?.c || 0;
        const closedJobs = jobs.find(j => j.status === 'Closed')?.c || 0;

        if (activeJobs > 2) {
            console.error(`FAIL: Too many active jobs (${activeJobs}). Should be max 2.`);
        } else {
            console.log(`PASS: Active jobs count is ${activeJobs} (<= 2).`);
        }

        if (closedJobs < 3) {
            console.error(`FAIL: Expected at least 3 closed jobs, found ${closedJobs}.`);
        } else {
            console.log(`PASS: Logic correctly closed excess jobs.`);
        }

        process.exit(0);

    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

check();
