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

async function seed() {
    try {
        console.log("Seeding expired user...");
        const email = 'test_expired_' + Date.now() + '@example.com';

        // 1. Create Employer with EXPIRED subscription
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        // Added valid dummy data for required fields
        await pool.query(
            `INSERT INTO employers 
            (companyName, email, password, currentPlan, jobPostsRemaining, subscriptionExpiresAt, isAddressVerified, brNumber, industry, address, city, phone, role, brCertificate) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                'Expired Co',
                email,
                'password',
                'gold',
                8,
                yesterday,
                1,
                'BR123456',       // brNumber
                'Technology',     // industry
                '123 Test St',    // address
                'Colombo',        // city
                '0771234567',     // phone
                'employer',       // role
                'dummy_path.jpg'  // brCertificate
            ]
        );

        console.log(`Created expired employer: ${email}`);

        // 2. Create 5 Active Jobs (Free limit is 2)
        // jobTitle, location, schedule, hoursPerDay, payAmount, payFrequency, description, category
        for (let i = 1; i <= 5; i++) {
            await pool.query(
                `INSERT INTO jobs 
                (employerEmail, companyName, jobTitle, location, schedule, hoursPerDay, payAmount, payFrequency, description, category, status, postedDate, deadline) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
                [
                    email,
                    'Expired Co',
                    `Job ${i}`,
                    'Colombo',      // location
                    'Part-time',    // schedule
                    4,              // hoursPerDay
                    1500,           // payAmount
                    'Hourly',       // payFrequency
                    'Test Job Desc',// description
                    'IT',           // category
                    'Active',       // status
                    new Date(Date.now() + 86400000 * 30) // Deadline in future
                ]
            );
        }
        console.log("Created 5 active jobs.");

        console.log("Seed complete. Restart server to trigger check.");

        // Save email to a temp file for the checker to read
        const fs = require('fs');
        fs.writeFileSync('temp_test_email.txt', email);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

seed();
