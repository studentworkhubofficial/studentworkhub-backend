const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const mysql = require('mysql2/promise');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Helper: Generate OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// ===================================================
// ============= DATABASE CONFIGURATION ==============
// ===================================================

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '12121212',
    database: process.env.DB_NAME || 'studentworkhub',
    port: process.env.DB_PORT || 3306, // Default to 3306 if not in env
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // THE FIX FOR AIVEN DATABASE:
    ssl: {
        rejectUnauthorized: false
    }
});

// ===================================================
// ================= MIDDLEWARE SETUP ================
// ===================================================

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Updated CORS to allow connections from anywhere (Fixes connection errors)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());

// Ensure Uploads Directory Exists
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// ===================================================
// ================= FILE UPLOAD CONFIG ==============
// ===================================================

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

// Allow images and PDFs up to 10MB
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

// ===================================================
// ================= EMAIL CONFIGURATION =============
// ===================================================

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'studentworkhubofficial@gmail.com',
        pass: process.env.EMAIL_PASS || 'tapn iurf qevx zvto' // Better to use Env Var
    }
});

async function sendEmail(to, subject, html) {
    try {
        await transporter.sendMail({
            from: '"StudentWorkHub" <studentworkhubofficial@gmail.com>',
            to,
            subject,
            html
        });
        console.log(`📧 Email successfully sent to ${to}`);
    } catch (err) {
        console.error("❌ Email Error:", err);
    }
}

// Helper to get full URL for uploaded files
const getBaseUrl = (req) => `${req.protocol}://${req.get('host')}`;

// Helper: Get Plan Limit (Base + Plan Allowance)
function getPlanLimit(planType) {
    const baseLimit = 2; // Free plan (and base for others)
    const planAllowances = {
        free: 0,
        bronze: 4,
        gold: 8,
        platinum: 999999 // Unlimited
    };
    const allow = planAllowances[planType.toLowerCase()] !== undefined ? planAllowances[planType.toLowerCase()] : 0;
    return baseLimit + allow;
}

// Helper: Get Remaining Jobs for Employer
async function getRemainingJobs(employerEmail) {
    // 1. Get Current Plan
    const [emp] = await pool.query('SELECT currentPlan FROM employers WHERE email = ?', [employerEmail]);
    if (emp.length === 0) return 0;

    const currentPlan = emp[0].currentPlan || 'free';
    const totalLimit = getPlanLimit(currentPlan);

    if (totalLimit >= 999999) return 999999; // Unlimited

    // 2. Count Active Jobs
    const [jobs] = await pool.query('SELECT COUNT(*) as count FROM jobs WHERE employerEmail = ? AND status = "Active"', [employerEmail]);
    const activeJobs = jobs[0].count;

    // 3. Calculate Remainder
    return Math.max(0, totalLimit - activeJobs);
}

// Helper: Expire Boosts after 10 days
async function checkExpiredBoosts() {
    try {
        await pool.query('UPDATE jobs SET isPremium = 0 WHERE isPremium = 1 AND promotedAt < DATE_SUB(NOW(), INTERVAL 10 DAY)');
    } catch (e) {
        console.error("Expire boosts error:", e);
    }
}

// Helper: Auto-Close Expired Jobs
async function autoCloseJobs() {
    try {
        console.log("Running auto-close jobs check...");
        await pool.query('UPDATE jobs SET status = "Closed" WHERE deadline < CURDATE() AND status = "Active"');
    } catch (e) {
        console.error("Auto-close error:", e);
    }
}

// Helper: Check Expired Subscriptions & Downgrade
async function checkExpiredSubscriptions() {
    try {
        console.log("Running expired subscription check...");
        // Find employers with expired subscriptions who are NOT on 'free' plan
        const [expired] = await pool.query(
            'SELECT email, currentPlan FROM employers WHERE subscriptionExpiresAt < NOW() AND currentPlan != "free"'
        );

        for (const emp of expired) {
            console.log(`Downgrading expired subscription for: ${emp.email}`);

            // 1. Downgrade to Free Plan (Reset Boosts to 0)
            await pool.query(
                'UPDATE employers SET currentPlan = "free", jobPostsRemaining = 2, boostsRemaining = 0 WHERE email = ?',
                [emp.email]
            );

            // 2. Enforce Job Limits (Free plan allows 2 active jobs)
            const [activeJobs] = await pool.query(
                'SELECT id FROM jobs WHERE employerEmail = ? AND status = "Active" ORDER BY postedDate DESC',
                [emp.email]
            );

            if (activeJobs.length > 2) {
                // Keep the first 2 (most recent), close the rest
                const jobsToClose = activeJobs.slice(2);
                const idsToClose = jobsToClose.map(j => j.id);

                if (idsToClose.length > 0) {
                    await pool.query(
                        `UPDATE jobs SET status = "Closed" WHERE id IN (${idsToClose.join(',')})`
                    );
                    console.log(`Closed ${idsToClose.length} excess jobs for ${emp.email}`);
                }
            }

            // 3. Notify User
            await pool.query(
                'INSERT INTO notifications (userEmail, message, type) VALUES (?, ?, ?)',
                [emp.email, `Your ${emp.currentPlan.toUpperCase()} subscription has expired. You have been downgraded to the Free Plan.`, 'warning']
            );
        }
    } catch (e) {
        console.error("Subscription expiry check error:", e);
    }
}

// Run checks every 24 hours (and on startup)
setInterval(() => {
    autoCloseJobs();
    checkExpiredSubscriptions();
    checkExpiredBoosts();
}, 24 * 60 * 60 * 1000);

// Run immediately on server start for testing/verification
setTimeout(() => {
    autoCloseJobs();
    checkExpiredSubscriptions();
    checkExpiredBoosts();
}, 5000);

// ===================================================
// =================== ADMIN ROUTES ==================
// ===================================================

// 1. Verify or Decline Employer
app.post('/api/admin/verify-employer', async (req, res, next) => {
    try {
        const { id, status, verifiedBy, methods, reason } = req.body;

        if (status === 2) {
            // --- DECLINED LOGIC ---
            await pool.query(
                'UPDATE employers SET isAddressVerified = 2, verifiedBy = ?, rejectionReason = ? WHERE id = ?',
                [verifiedBy, reason, id]
            );

            // Fetch employer details for email
            const [emp] = await pool.query('SELECT email, companyName FROM employers WHERE id = ?', [id]);
            if (emp.length > 0) {
                const email = emp[0].email;
                const name = emp[0].companyName;

                // Send Email
                const emailHtml = `
                    <h2>Account Verification Declined</h2>
                    <p>Hello ${name},</p>
                    <p>We regret to inform you that your employer account verification was declined.</p>
                    <p><strong>Reason:</strong> ${reason}</p>
                    <p>You may register again with valid documents or contact support.</p>
                    <br>
                    <p>Regards,<br>StudentWorkHub Admin Team</p>
                `;
                sendEmail(email, "Account Verification Status", emailHtml);

                // Create Notification
                await pool.query('INSERT INTO notifications (userEmail, message, type) VALUES (?, ?, ?)',
                    [email, `Verification Declined: ${reason}`, 'error']);
            }

        } else {
            // --- ACCEPTED LOGIC ---
            await pool.query(
                'UPDATE employers SET isAddressVerified = 1, verifiedBy = ?, verificationMethods = ? WHERE id = ?',
                [verifiedBy, methods, id]
            );

            const [emp] = await pool.query('SELECT email, companyName FROM employers WHERE id = ?', [id]);
            if (emp.length > 0) {
                const email = emp[0].email;
                const name = emp[0].companyName;

                // Create Notification
                await pool.query('INSERT INTO notifications (userEmail, message, type) VALUES (?, ?, ?)',
                    [email, `Your account has been verified! You can now post jobs.`, 'success']);

                // Send Acceptance Email
                const acceptEmailHtml = `
                    <h2>Account Verified Successfully! 🎉</h2>
                    <p>Dear ${name},</p>
                    <p>Congratulations! Your employer account has been <strong>verified and approved</strong> by our administrative team.</p>
                    <h3>What You Can Do Now:</h3>
                    <ul>
                        <li>Post job listings to connect with talented students</li>
                        <li>Review applications from interested candidates</li>
                        <li>Manage your job postings through your dashboard</li>
                        <li>Access all employer features on StudentWorkHub</li>
                    </ul>
                    <p>We're excited to help you find the right talent for your organization!</p>
                    <br>
                    <p>Get started by logging into your account and posting your first job.</p>
                    <br>
                    <p>Best Regards,<br>StudentWorkHub Admin Team</p>
                `;
                sendEmail(email, "Account Verified - Welcome to StudentWorkHub!", acceptEmailHtml);
            }
        }

        res.json({ success: true });
    } catch (err) { next(err); }
});

// 2. Suspend Student
app.post('/api/admin/suspend-student', upload.array('proof', 5), async (req, res, next) => {
    try {
        const { userId, reason } = req.body;
        const [user] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);

        if (user.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

        const targetEmail = user[0].email;
        const targetName = user[0].firstName + ' ' + user[0].lastName;
        const proofPaths = req.files ? req.files.map(f => `${getBaseUrl(req)}/uploads/${f.filename}`) : [];

        // Add to Suspended Table
        await pool.query(
            'INSERT INTO suspended_users (email, name, reason, proofFiles) VALUES (?, ?, ?, ?)',
            [targetEmail, targetName, reason, JSON.stringify(proofPaths)]
        );

        // Clean up User Data
        await pool.query('DELETE FROM applications WHERE studentEmail = ?', [targetEmail]);
        await pool.query('DELETE FROM notifications WHERE userEmail = ?', [targetEmail]);
        await pool.query('DELETE FROM users WHERE id = ?', [userId]);

        // Notify
        sendEmail(targetEmail, "Account Suspended", `<h2>Account Suspended</h2><p>Reason: ${reason}</p>`);
        res.json({ success: true });
    } catch (err) { next(err); }
});

// 3. Get Employer Jobs (For Admin View)
app.get('/api/admin/employer-details/:id', async (req, res, next) => {
    try {
        const [emp] = await pool.query('SELECT email FROM employers WHERE id = ?', [req.params.id]);
        if (emp.length === 0) return res.json({ success: false });

        const [jobs] = await pool.query('SELECT * FROM jobs WHERE employerEmail = ?', [emp[0].email]);
        res.json({ success: true, jobs });
    } catch (err) { next(err); }
});

// 4. Get Suspended List
app.get('/api/admin/suspended', async (req, res, next) => {
    try {
        const [rows] = await pool.query('SELECT * FROM suspended_users ORDER BY suspendedAt DESC');
        res.json({ success: true, suspended: rows });
    } catch (err) { next(err); }
});

// 5. Admin Data Dashboard
app.get('/api/admin/data', async (req, res) => {
    try {
        const [pending] = await pool.query('SELECT * FROM employers WHERE isAddressVerified = 0');
        const [accepted] = await pool.query('SELECT * FROM employers WHERE isAddressVerified = 1');
        const [declined] = await pool.query('SELECT * FROM employers WHERE isAddressVerified = 2');
        const [students] = await pool.query('SELECT * FROM users');

        // Stats
        const [s] = await pool.query('SELECT COUNT(*) c FROM users');
        const [v] = await pool.query('SELECT COUNT(*) c FROM employers WHERE isAddressVerified=1');
        const [r] = await pool.query('SELECT COUNT(*) c FROM employers WHERE isAddressVerified=2');
        const [j] = await pool.query('SELECT COUNT(*) c FROM jobs WHERE status = "Active"');
        const [c] = await pool.query('SELECT COUNT(*) c FROM jobs WHERE status = "Closed"');

        // Subscription Stats
        const [bronze] = await pool.query('SELECT COUNT(*) c FROM employers WHERE LOWER(currentPlan)="bronze"');
        const [gold] = await pool.query('SELECT COUNT(*) c FROM employers WHERE LOWER(currentPlan)="gold"');
        const [platinum] = await pool.query('SELECT COUNT(*) c FROM employers WHERE LOWER(currentPlan)="platinum"');

        res.json({
            success: true,
            pending, accepted, declined, students,
            stats: {
                totalStudents: s[0].c,
                verifiedEmployers: v[0].c,
                rejectedEmployers: r[0].c,
                activeJobs: j[0].c,
                closedJobs: c[0].c,
                bronze: bronze[0].c,
                gold: gold[0].c,
                platinum: platinum[0].c
            }
        });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 6. Delete User (Admin Action)
app.delete('/api/admin/delete-user/:type/:id', async (req, res, next) => {
    try {
        const { type, id } = req.params;
        if (type === 'employer') {
            const [e] = await pool.query('SELECT email FROM employers WHERE id=?', [id]);
            if (e.length) {
                await pool.query('DELETE FROM jobs WHERE employerEmail=?', [e[0].email]);
                await pool.query('DELETE FROM employers WHERE id=?', [id]);
            }
        } else {
            await pool.query('DELETE FROM users WHERE id=?', [id]);
        }
        res.json({ success: true });
    } catch (err) { next(err); }
});

// 7. Admin Login
app.post('/api/admin/login', (req, res) => {
    if (req.body.username === 'admin' && req.body.password === 'admin') {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false });
    }
});


// ===================================================
// ================== AUTH ROUTES ====================
// ===================================================

// Login Student
app.post('/api/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0 || users[0].password !== password) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        if (users[0].is_email_verified === 0) {
            return res.status(403).json({ success: false, requireOtp: true, email: users[0].email, message: 'Please verify your email address.' });
        }

        res.json({
            success: true,
            userName: users[0].firstName + ' ' + users[0].lastName,
            email: users[0].email,
            role: 'student',
            profilePic: users[0].profilePic
        });
    } catch (err) { next(err); }
});

// Login Employer
app.post('/api/login-employer', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const [employers] = await pool.query('SELECT * FROM employers WHERE email = ?', [email]);
        if (employers.length === 0 || employers[0].password !== password) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        // Check Email Verification
        if (employers[0].is_email_verified === 0) {
            return res.status(403).json({ success: false, requireOtp: true, email: employers[0].email, message: 'Please verify your email address.' });
        }

        // Check Admin Verification Status
        // 0 = Pending, 1 = Verified, 2 = Declined
        if (employers[0].isAddressVerified === 2) {
            return res.status(403).json({ success: false, message: 'Your account application was declined.' });
        }

        res.json({
            success: true,
            name: employers[0].companyName,
            email: employers[0].email,
            logo: employers[0].logo,
            role: 'employer',
            isVerified: employers[0].isAddressVerified
        });
    } catch (err) { next(err); }
});

// 1. Register Student
app.post('/api/register', async (req, res, next) => {
    try {
        const { firstName, lastName, email, phone, dob, city, password } = req.body;

        // Validate Phone
        if (!/^\+94\d{9,10}$/.test(phone)) {
            return res.status(400).json({ success: false, message: 'Invalid phone number format.' });
        }

        // Check Suspension List
        const [suspended] = await pool.query('SELECT * FROM suspended_users WHERE email = ?', [email]);
        if (suspended.length > 0) return res.status(403).json({ success: false, message: 'This email is permanently suspended.' });

        const [existing] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            if (existing[0].is_email_verified === 1) {
                return res.status(400).json({ success: false, message: 'Email already registered.' });
            }
            // Allow re-registration if not verified
            await pool.query('DELETE FROM users WHERE email = ?', [email]);
        }

        const otp = generateOTP();

        await pool.query(
            'INSERT INTO users (firstName, lastName, email, phone, dob, city, password, role, otp_code, otp_created_at, is_email_verified) VALUES (?, ?, ?, ?, ?, ?, ?, "student", ?, NOW(), 0)',
            [firstName, lastName, email, phone, dob, city, password, otp]
        );

        const emailHtml = `
            <h2>Verify Your Email</h2>
            <p>Thank you for registering. Please enter the code below to verify your email address.</p>
            <h1 style="background: #f0f9ff; padding: 10px; color: #0284c7; display: inline-block; letter-spacing: 5px; border-radius: 8px;">${otp}</h1>
            <p>This code will expire in 10 minutes.</p>
        `;

        sendEmail(email, "Your Verification Code - StudentWorkHub", emailHtml);

        // Return requireOtp so frontend redirects
        res.json({ success: true, requireOtp: true, email, role: 'student' });
    } catch (err) { next(err); }
});

// 2. Register Employer
app.post('/api/register-employer', upload.single('brFile'), async (req, res, next) => {
    try {
        const { companyName, brNumber, industry, address, city, email, phone, password } = req.body;

        // Validate Phone
        if (!/^\+94\d{9,10}$/.test(phone)) {
            return res.status(400).json({ success: false, message: 'Invalid phone number format.' });
        }

        const [exists] = await pool.query('SELECT * FROM employers WHERE email = ?', [email]);
        if (exists.length > 0) {
            if (exists[0].is_email_verified === 1) {
                if (exists[0].isAddressVerified === 2) {
                    return res.status(400).json({ success: false, message: 'Email taken. Contact admin if you were declined previously.' });
                }
                return res.status(400).json({ success: false, message: 'Email already registered.' });
            }
            // Allow re-registration if not verified
            await pool.query('DELETE FROM employers WHERE email = ?', [email]);
        }

        let brPath = req.file ? `${getBaseUrl(req)}/uploads/${req.file.filename}` : null;
        const otp = generateOTP();

        await pool.query(
            'INSERT INTO employers (companyName, brNumber, industry, address, city, email, phone, password, role, isAddressVerified, brCertificate, otp_code, otp_created_at, is_email_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "employer", 0, ?, ?, NOW(), 0)',
            [companyName, brNumber, industry, address, city, email, phone, password, brPath, otp]
        );

        // Verification Email
        const emailHtml = `
            <h2>Verify Your Employer Account</h2>
            <p>Welcome, ${companyName}!</p>
            <p>Please enter the code below to verify your email address.</p>
            <h1 style="background: #f0f9ff; padding: 10px; color: #0284c7; display: inline-block; letter-spacing: 5px; border-radius: 8px;">${otp}</h1>
            <p>This code will expire in 10 minutes.</p>
        `;

        sendEmail(email, "Your Verification Code - StudentWorkHub", emailHtml);

        res.json({ success: true, requireOtp: true, email, role: 'employer' });
    } catch (err) { next(err); }
});

// ===================================================
// ================== OTP ROUTES =====================
// ===================================================

// 1. Verify OTP
app.post('/api/verify-otp', async (req, res, next) => {
    try {
        const { email, otp, role } = req.body;
        const table = role === 'employer' ? 'employers' : 'users';

        const [user] = await pool.query(`SELECT * FROM ${table} WHERE email = ?`, [email]);

        if (user.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

        if (user[0].otp_code !== otp) {
            return res.status(400).json({ success: false, message: 'Invalid OTP Code' });
        }

        // Activate User
        await pool.query(`UPDATE ${table} SET is_email_verified = 1, otp_code = NULL WHERE email = ?`, [email]);

        // If employer, add notifications now (delayed from registration)
        if (role === 'employer') {
            await pool.query(
                'INSERT INTO notifications (userEmail, message, type) VALUES (?, ?, ?)',
                [email, `Welcome to StudentWorkHub! Your email has been verified.`, 'success']
            );
            await pool.query(
                'INSERT INTO notifications (userEmail, message, type) VALUES (?, ?, ?)',
                [email, `Your account is under review by our admin team.`, 'info']
            );
        }

        // Return Auth Data
        if (role === 'employer') {
            res.json({
                success: true,
                name: user[0].companyName,
                email: user[0].email,
                logo: user[0].logo,
                role: 'employer',
                isVerified: user[0].isAddressVerified
            });
        } else {
            res.json({
                success: true,
                userName: user[0].firstName + ' ' + user[0].lastName,
                email: user[0].email,
                role: 'student',
                profilePic: user[0].profilePic
            });
        }

    } catch (err) { next(err); }
});

// 2. Resend OTP
app.post('/api/resend-otp', async (req, res, next) => {
    try {
        const { email, role } = req.body;
        const table = role === 'employer' ? 'employers' : 'users';

        const [user] = await pool.query(`SELECT otp_created_at FROM ${table} WHERE email = ?`, [email]);

        if (user.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

        // Check Cooldown (3 Minutes)
        if (user[0].otp_created_at) {
            const lastSent = new Date(user[0].otp_created_at);
            const now = new Date();
            const diffMs = now - lastSent;
            const diffMins = diffMs / 1000 / 60;

            if (diffMins < 3) {
                return res.json({ success: false, message: 'Please wait before requesting a new code.' });
            }
        }

        const otp = generateOTP();
        await pool.query(`UPDATE ${table} SET otp_code = ?, otp_created_at = NOW() WHERE email = ?`, [otp, email]);

        const emailHtml = `
            <h2>New Verification Code</h2>
            <p>Your new verification code is:</p>
            <h1 style="background: #f0f9ff; padding: 10px; color: #0284c7; display: inline-block; letter-spacing: 5px; border-radius: 8px;">${otp}</h1>
        `;
        sendEmail(email, "New Verification Code - StudentWorkHub", emailHtml);

        res.json({ success: true });
    } catch (err) { next(err); }
});

// 3. Update Email (and Resend)
// Requires password for security even if not fully logged in
app.post('/api/update-email', async (req, res, next) => {
    try {
        const { oldEmail, newEmail, role, password } = req.body;
        const table = role === 'employer' ? 'employers' : 'users';

        // Check Creds
        const [user] = await pool.query(`SELECT * FROM ${table} WHERE email = ? AND password = ?`, [oldEmail, password]);
        if (user.length === 0) return res.status(401).json({ success: false, message: 'Invalid specific password.' });

        // Check availability
        const [exists] = await pool.query(`SELECT * FROM ${table} WHERE email = ?`, [newEmail]);
        if (exists.length > 0) return res.status(400).json({ success: false, message: 'Email already in use.' });

        const otp = generateOTP();

        // Update with new OTP
        await pool.query(
            `UPDATE ${table} SET email = ?, otp_code = ?, otp_created_at = NOW(), is_email_verified = 0 WHERE email = ?`,
            [newEmail, otp, oldEmail]
        );

        const emailHtml = `
            <h2>Verify Your New Email</h2>
            <p>You have updated your email address. Please use this code to verify it:</p>
            <h1 style="background: #f0f9ff; padding: 10px; color: #0284c7; display: inline-block; letter-spacing: 5px; border-radius: 8px;">${otp}</h1>
        `;
        sendEmail(newEmail, "Verification Code - StudentWorkHub", emailHtml);

        res.json({ success: true });
    } catch (err) { next(err); }
});


// ===================================================
// ============= SUBSCRIPTION ROUTES =================
// ===================================================

// 1. Get Subscription Plans Info
app.get('/api/subscription/plans', (req, res) => {
    const plans = [
        {
            id: 'free',
            name: 'FREE PLAN',
            emoji: '🆓',
            price: 0,
            currency: 'LKR',
            features: ['2 Job Posts', '0 Job Boost'],
            jobPosts: 2,
            boosts: 0
        },
        {
            id: 'bronze',
            name: 'BRONZE PLAN',
            emoji: '🥉',
            price: 3500,
            currency: 'LKR',
            features: ['4 Job Posts', '1 Job Boost (10 days)'],
            jobPosts: 4,
            boosts: 1,
            popular: false
        },
        {
            id: 'gold',
            name: 'GOLD PLAN',
            emoji: '🥇',
            price: 7500,
            currency: 'LKR',
            features: ['8 Job Posts', '3 Job Boosts (10 days each)'],
            jobPosts: 8,
            boosts: 3,
            popular: true
        },
        {
            id: 'platinum',
            name: 'PLATINUM PLAN',
            emoji: '💎',
            price: 14000,
            currency: 'LKR',
            features: ['Unlimited Job Posts', '5 Job Boosts (10 days each)', 'Priority Listing'],
            jobPosts: -1, // -1 means unlimited
            boosts: 5,
            priority: true,
            popular: false
        }
    ];
    res.json({ success: true, plans });
});

// 2. Get Employer's Current Subscription
app.get('/api/employer/subscription/:email', async (req, res, next) => {
    try {
        const [emp] = await pool.query(
            'SELECT currentPlan, boostsRemaining, subscriptionExpiresAt FROM employers WHERE email = ?',
            [req.params.email]
        );

        if (emp.length === 0) {
            return res.status(404).json({ success: false, message: 'Employer not found' });
        }

        // Calculate dynamic remaining jobs
        const remaining = await getRemainingJobs(req.params.email);

        // Check for pending payment
        const [pending] = await pool.query(
            'SELECT * FROM subscription_payments WHERE employerEmail = ? AND status = "pending" ORDER BY submittedAt DESC LIMIT 1',
            [req.params.email]
        );

        res.json({
            success: true,
            subscription: {
                currentPlan: emp[0].currentPlan,
                jobPostsRemaining: remaining,
                boostsRemaining: emp[0].boostsRemaining,
                expiresAt: emp[0].subscriptionExpiresAt,
                hasPendingPayment: pending.length > 0,
                pendingPayment: pending.length > 0 ? pending[0] : null
            }
        });
    } catch (err) { next(err); }
});

// 3. Submit Subscription Payment
app.post('/api/subscription/submit-payment', upload.single('receipt'), async (req, res, next) => {
    try {
        const { employerEmail, planType, amount } = req.body;

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Receipt image is required' });
        }

        const receiptUrl = `${getBaseUrl(req)}/uploads/${req.file.filename}`;

        // Check if already has pending payment
        const [existing] = await pool.query(
            'SELECT * FROM subscription_payments WHERE employerEmail = ? AND status = "pending"',
            [employerEmail]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'You already have a pending payment submission. Please wait for admin review.'
            });
        }

        // Insert payment record
        await pool.query(
            'INSERT INTO subscription_payments (employerEmail, planType, amount, receiptUrl, status) VALUES (?, ?, ?, ?, "pending")',
            [employerEmail, planType, amount, receiptUrl]
        );

        // Get employer details
        const [emp] = await pool.query('SELECT companyName FROM employers WHERE email = ?', [employerEmail]);
        const companyName = emp[0]?.companyName || 'Employer';

        // Send confirmation email
        const emailHtml = `
            <h2>Payment Submitted Successfully! 📄</h2>
            <p>Dear ${companyName},</p>
            <p>Your subscription payment for the <strong>${planType.toUpperCase()}</strong> plan has been submitted successfully.</p>
            <h3>Payment Details:</h3>
            <ul>
                <li><strong>Plan:</strong> ${planType.toUpperCase()}</li>
                <li><strong>Amount:</strong> LKR ${amount}</li>
                <li><strong>Status:</strong> Pending Admin Review</li>
            </ul>
            <p>Our admin team will review your payment receipt and activate your subscription within 1-2 business days.</p>
            <p>You will receive a notification once your payment is approved.</p>
            <br>
            <p>Thank you for choosing StudentWorkHub!</p>
            <br>
            <p>Best Regards,<br>StudentWorkHub Team</p>
        `;
        sendEmail(employerEmail, "Subscription Payment Submitted - StudentWorkHub", emailHtml);

        // Send notification
        await pool.query(
            'INSERT INTO notifications (userEmail, message, type) VALUES (?, ?, ?)',
            [employerEmail, `Your ${planType.toUpperCase()} plan payment has been submitted and is pending admin review.`, 'info']
        );

        res.json({ success: true, message: 'Payment submitted successfully. Awaiting admin review.' });
    } catch (err) { next(err); }
});

// 4. Get All Pending Payments (Admin)
app.get('/api/admin/subscription-payments', async (req, res, next) => {
    try {
        const [payments] = await pool.query(`
            SELECT sp.*, e.companyName 
            FROM subscription_payments sp
            LEFT JOIN employers e ON sp.employerEmail = e.email
            ORDER BY sp.submittedAt DESC
        `);
        res.json({ success: true, payments });
    } catch (err) { next(err); }
});

// 5. Approve Subscription Payment (Admin)
app.post('/api/admin/subscription-payments/:id/approve', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reviewedBy } = req.body;

        // Get payment details
        const [payment] = await pool.query('SELECT * FROM subscription_payments WHERE id = ?', [id]);

        if (payment.length === 0) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        const { employerEmail, planType, amount } = payment[0];

        // Define boosts
        const boostLimits = {
            bronze: 1,
            gold: 3,
            platinum: 5
        };
        const boosts = boostLimits[planType] || 0;

        // Calculate Job Limit (Dynamic)
        const limit = getPlanLimit(planType);

        // Update employer subscription
        await pool.query(
            'UPDATE employers SET currentPlan = ?, jobPostsRemaining = ?, boostsRemaining = ? WHERE email = ?',
            [planType, limit, boosts, employerEmail]
        );

        // Update payment status
        await pool.query(
            'UPDATE subscription_payments SET status = "approved", reviewedBy = ?, reviewedAt = NOW() WHERE id = ?',
            [reviewedBy, id]
        );

        // Create subscription record
        await pool.query(
            'INSERT INTO subscriptions (employerEmail, planType, status, activatedAt) VALUES (?, ?, "active", NOW())',
            [employerEmail, planType]
        );

        // Calculate expiration date (30 days from now)
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        // Update employer with expiration date
        await pool.query(
            'UPDATE employers SET subscriptionExpiresAt = ? WHERE email = ?',
            [expiresAt, employerEmail]
        );

        // Get employer info
        const [emp] = await pool.query('SELECT companyName FROM employers WHERE email = ?', [employerEmail]);
        const companyName = emp[0]?.companyName || 'Employer';

        // Send approval email
        const emailHtml = `
            <h2>Subscription Activated! 🎉</h2>
            <p>Dear ${companyName},</p>
            <p>Great news! Your subscription payment has been approved and your <strong>${planType.toUpperCase()}</strong> plan is now active.</p>
            <h3>Your Plan Benefits:</h3>
            <ul>
                <li><strong>Plan:</strong> ${planType.toUpperCase()}</li>
                <li><strong>Job Posts Available:</strong> ${planType === 'platinum' ? 'Unlimited' : jobPosts}</li>
                <li><strong>Amount Paid:</strong> LKR ${amount}</li>
            </ul>
            <p>You can now start posting jobs and take full advantage of your subscription benefits!</p>
            <br>
            <p>Login to your dashboard to get started.</p>
            <br>
            <p>Best Regards,<br>StudentWorkHub Team</p>
        `;
        sendEmail(employerEmail, "Subscription Activated - StudentWorkHub", emailHtml);

        // Send notification
        await pool.query(
            'INSERT INTO notifications (userEmail, message, type) VALUES (?, ?, ?)',
            [employerEmail, `Your ${planType.toUpperCase()} plan has been activated! You now have a total limit of ${limit} active job posts.`, 'success']
        );

        res.json({ success: true, message: 'Payment approved and subscription activated' });
    } catch (err) { next(err); }
});

// 6. Decline Subscription Payment (Admin)
app.post('/api/admin/subscription-payments/:id/decline', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reviewedBy, reason } = req.body;

        // Get payment details
        const [payment] = await pool.query('SELECT * FROM subscription_payments WHERE id = ?', [id]);

        if (payment.length === 0) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        const { employerEmail, planType } = payment[0];

        // Update payment status
        await pool.query(
            'UPDATE subscription_payments SET status = "declined", reviewedBy = ?, reviewedAt = NOW(), declineReason = ? WHERE id = ?',
            [reviewedBy, reason, id]
        );

        // Get employer info
        const [emp] = await pool.query('SELECT companyName FROM employers WHERE email = ?', [employerEmail]);
        const companyName = emp[0]?.companyName || 'Employer';

        // Send decline email
        const emailHtml = `
            <h2>Subscription Payment Declined</h2>
            <p>Dear ${companyName},</p>
            <p>We regret to inform you that your subscription payment for the <strong>${planType.toUpperCase()}</strong> plan has been declined.</p>
            <p><strong>Reason:</strong> ${reason}</p>
            <p>Please review the reason and submit a new payment with the correct details.</p>
            <p>If you have any questions, please contact our support team.</p>
            <br>
            <p>Best Regards,<br>StudentWorkHub Team</p>
        `;
        sendEmail(employerEmail, "Subscription Payment Declined - StudentWorkHub", emailHtml);

        // Send notification
        await pool.query(
            'INSERT INTO notifications (userEmail, message, type) VALUES (?, ?, ?)',
            [employerEmail, `Your ${planType.toUpperCase()} plan payment was declined. Reason: ${reason}`, 'error']
        );

        res.json({ success: true, message: 'Payment declined' });
    } catch (err) { next(err); }
});


// ===================================================
// ================== JOB ROUTES =====================
// ===================================================

// Promote an existing job
app.post('/api/promote-job', async (req, res, next) => {
    try {
        const { jobId, employerEmail } = req.body;

        // Check boosts
        const [emp] = await pool.query('SELECT boostsRemaining FROM employers WHERE email = ?', [employerEmail]);
        if (emp.length === 0) return res.status(404).json({ success: false });

        if (emp[0].boostsRemaining <= 0) {
            return res.status(403).json({ success: false, message: 'No boosts remaining.' });
        }

        // Check job
        const [job] = await pool.query('SELECT isPremium FROM jobs WHERE id = ? AND employerEmail = ?', [jobId, employerEmail]);
        if (job.length === 0) return res.status(404).json({ success: false, message: 'Job not found.' });
        if (job[0].isPremium) return res.status(400).json({ success: false, message: 'Job is already promoted.' });

        // Update
        await pool.query('UPDATE jobs SET isPremium = 1, promotedAt = NOW() WHERE id = ?', [jobId]);
        await pool.query('UPDATE employers SET boostsRemaining = boostsRemaining - 1 WHERE email = ?', [employerEmail]);

        res.json({ success: true, message: 'Job promoted successfully!' });
    } catch (err) { next(err); }
});

// 1. Post a Job (WITH SUBSCRIPTION LIMIT CHECK)
app.post('/api/post-job', upload.array('posters', 5), async (req, res, next) => {
    try {
        const { employerEmail, companyName, jobTitle, location, schedule, hoursPerDay, payAmount, payFrequency, description, category, isPremium, deadline } = req.body;

        // ===== SUBSCRIPTION LIMIT CHECK =====
        const [employer] = await pool.query(
            'SELECT currentPlan, boostsRemaining FROM employers WHERE email = ?',
            [employerEmail]
        );

        if (employer.length === 0) {
            return res.status(404).json({ success: false, message: 'Employer not found' });
        }

        const { currentPlan, boostsRemaining } = employer[0];

        // Check Remaining Jobs (Dynamic)
        const remaining = await getRemainingJobs(employerEmail);

        if (remaining <= 0) {
            return res.status(403).json({
                success: false,
                message: 'Job post limit reached! Please upgrade your subscription plan to post more jobs.',
                limitReached: true,
                currentPlan: currentPlan
            });
        }

        // Check Boost Limit if Premium requested
        let premiumStatus = isPremium;
        if (isPremium == 1 || isPremium == 'true') {
            if (boostsRemaining <= 0) {
                return res.status(403).json({
                    success: false,
                    message: 'You have used all your Job Boosts. Please upgrade or post as a standard listing.',
                    boostLimitReached: true
                });
            }
            premiumStatus = 1;
        } else {
            premiumStatus = 0;
        }

        const imgs = req.files ? JSON.stringify(req.files.map(f => `${getBaseUrl(req)}/uploads/${f.filename}`)) : '[]';

        // Enforce max 30-day deadline
        let validDeadline = deadline;
        const maxDate = new Date();
        maxDate.setDate(maxDate.getDate() + 30);

        if (!validDeadline || new Date(validDeadline) > maxDate) {
            validDeadline = maxDate;
        }

        const promotedAt = premiumStatus ? new Date() : null;

        await pool.query(
            'INSERT INTO jobs (employerEmail, companyName, jobTitle, location, schedule, hoursPerDay, payAmount, payFrequency, description, category, isPremium, promotedAt, status, deadline, jobImages, postedDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "Active", ?, ?, NOW())',
            [employerEmail, companyName, jobTitle, location, schedule, hoursPerDay, payAmount, payFrequency, description, category, premiumStatus, promotedAt, validDeadline, imgs]
        );

        // ===== DECREMENT COUNTERS =====
        // Note: jobPostsRemaining is no longer decremented as we use dynamic limit vs active count.

        if (premiumStatus) {
            await pool.query('UPDATE employers SET boostsRemaining = boostsRemaining - 1 WHERE email = ?', [employerEmail]);
        }

        // Send success notification
        await pool.query(
            'INSERT INTO notifications (userEmail, message, type) VALUES (?, ?, ?)',
            [employerEmail, `Your job listing "${jobTitle}" has been posted successfully!`, 'success']
        );

        // Warning if running low on posts (less than 2 remaining)
        const remainingAfterPost = remaining - 1;
        if (currentPlan !== 'platinum' && remainingAfterPost > 0 && remainingAfterPost <= 1) {
            await pool.query(
                'INSERT INTO notifications (userEmail, message, type) VALUES (?, ?, ?)',
                [employerEmail, `Warning: You have only ${remainingAfterPost} job post${remainingAfterPost === 1 ? '' : 's'} remaining. Consider upgrading your plan.`, 'warning']
            );
        }

        // Send confirmation email
        const jobPostEmailHtml = `
            <h2>Job Posted Successfully! 🎉</h2>
            <p>Dear ${companyName},</p>
            <p>Your job listing has been successfully posted on StudentWorkHub and is now visible to students!</p>
            <h3>Job Details:</h3>
            <ul>
                <li><strong>Position:</strong> ${jobTitle}</li>
                <li><strong>Location:</strong> ${location}</li>
                <li><strong>Category:</strong> ${category}</li>
                <li><strong>Pay:</strong> LKR ${payAmount} ${payFrequency}</li>
                <li><strong>Schedule:</strong> ${schedule} (${hoursPerDay} hrs/day)</li>
                <li><strong>Application Deadline:</strong> ${deadline ? new Date(deadline).toLocaleDateString() : 'No deadline'}</li>
                ${isPremium == 1 ? '<li><strong>⭐ Premium Listing</strong> - Featured for better visibility</li>' : ''}
            </ul>
            <p><strong>Remaining Job Posts:</strong> ${currentPlan === 'platinum' ? 'Unlimited' : remainingAfterPost}</p>
            <p>Students can now view and apply for this position. You'll receive notifications when applications are submitted.</p>
            <br>
            <p>You can manage this job listing anytime from your employer dashboard.</p>
            <br>
            <p>Best of luck finding the right candidate!</p>
            <br>
            <p>Best Regards,<br>StudentWorkHub Team</p>
        `;
        sendEmail(employerEmail, "Job Posted Successfully - StudentWorkHub", jobPostEmailHtml);

        res.json({
            success: true,
            jobPostsRemaining: currentPlan === 'platinum' ? 'unlimited' : remainingAfterPost
        });
    } catch (err) { next(err); }
});


// 2. Fetch All Jobs (Public - Student View)
// FIX: JOIN WITH EMPLOYERS to get the LOGO and VERIFIED STATUS correctly
app.get('/api/jobs', async (req, res, next) => {
    try {
        await autoCloseJobs();
        const [r] = await pool.query(`
            SELECT j.*, 
                   e.companyName, 
                   e.isAddressVerified, 
                   e.logo 
            FROM jobs j 
            LEFT JOIN employers e ON j.employerEmail = e.email 
            ORDER BY 
                CASE WHEN j.status = 'Active' THEN 1 ELSE 2 END ASC,
                j.isPremium DESC,
                j.postedDate DESC
        `);
        res.json({ success: true, jobs: r });
    } catch (err) { next(err); }
});

// 3. Fetch My Jobs (Employer View)
app.get('/api/my-jobs/:email', async (req, res, next) => {
    try {
        await autoCloseJobs();
        const [r] = await pool.query('SELECT * FROM jobs WHERE employerEmail=? ORDER BY postedDate DESC', [req.params.email]);
        res.json({ success: true, jobs: r });
    } catch (err) { next(err); }
});

// 4. Update Job
app.put('/api/jobs/:id', upload.array('posters', 5), async (req, res, next) => {
    try {
        const { jobTitle, location, schedule, hoursPerDay, payAmount, payFrequency, description, category, isPremium, status, deadline, keepExisting, existingImages, replaceImages } = req.body;

        let updateQuery = 'UPDATE jobs SET jobTitle=?, location=?, schedule=?, hoursPerDay=?, payAmount=?, payFrequency=?, description=?, category=?, isPremium=?, status=?, deadline=?';
        let params = [jobTitle, location, schedule, hoursPerDay, payAmount, payFrequency, description, category, isPremium, status, deadline];

        // Handle images based on the scenario
        if (keepExisting === 'true' && existingImages) {
            // Keep existing images - no change to jobImages column
            updateQuery += ', jobImages=?';
            params.push(existingImages);
        } else if (replaceImages === 'true' || req.files?.length > 0) {
            // Replace with new images or remove all (if no files uploaded)
            const imgs = req.files && req.files.length > 0
                ? JSON.stringify(req.files.map(f => `${getBaseUrl(req)}/uploads/${f.filename}`))
                : '[]';
            updateQuery += ', jobImages=?';
            params.push(imgs);
        }
        // If neither flag is set, don't update images at all

        updateQuery += ' WHERE id=?';
        params.push(req.params.id);

        await pool.query(updateQuery, params);
        res.json({ success: true });
    } catch (err) { next(err); }
});

// 5. Delete Job
app.delete('/api/jobs/:id', async (req, res, next) => {
    try {
        await pool.query('DELETE FROM jobs WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { next(err); }
});


// ===================================================
// ============= APPLICATION & NOTIFICATIONS =========
// ===================================================

// 1. Get List of Applied Jobs (Student)
app.get('/api/student/applications/:email', async (req, res, next) => {
    try {
        const [rows] = await pool.query('SELECT jobId FROM applications WHERE studentEmail = ?', [req.params.email]);
        res.json({ success: true, appliedJobIds: rows.map(r => r.jobId) });
    } catch (err) { next(err); }
});

// 2. Apply for a Job (FIXED UNDEFINED NOTIFICATIONS)
app.post('/api/apply-job', upload.single('newCv'), async (req, res, next) => {
    try {
        const { jobId, studentEmail, useExisting } = req.body;
        let cvPath = null;

        // 1. Fetch Job Details explicitly to ensure we have the Title and Company Name
        const [jobCheck] = await pool.query('SELECT * FROM jobs WHERE id = ?', [jobId]);

        if (jobCheck.length === 0 || jobCheck[0].status === 'Closed') {
            return res.status(400).json({ success: false, message: 'Job is closed or does not exist.' });
        }

        // 2. Extract details safely
        const jobTitle = jobCheck[0].jobTitle;
        const companyName = jobCheck[0].companyName;
        const employerEmail = jobCheck[0].employerEmail;

        // 3. Handle CV
        if (useExisting === 'true') {
            const [user] = await pool.query('SELECT cvFile FROM users WHERE email = ?', [studentEmail]);
            if (user.length > 0 && user[0].cvFile) {
                cvPath = user[0].cvFile;
            } else {
                return res.status(400).json({ success: false, message: 'No existing CV found in your profile.' });
            }
        } else {
            if (!req.file) return res.status(400).json({ success: false, message: "No PDF uploaded" });
            cvPath = `${getBaseUrl(req)}/uploads/${req.file.filename}`;
        }

        // 4. Insert Application
        await pool.query(
            'INSERT INTO applications (jobId, studentEmail, cvFile, appliedAt) VALUES (?, ?, ?, NOW())',
            [jobId, studentEmail, cvPath]
        );

        // 5. Send Notifications (Now using variables we are certain exist)
        // To Student
        await pool.query(
            'INSERT INTO notifications (userEmail, message, type) VALUES (?, ?, ?)',
            [studentEmail, `You successfully applied to ${companyName}`, 'success']
        );

        // To Employer (Dashboard Notification)
        await pool.query(
            'INSERT INTO notifications (userEmail, message, type) VALUES (?, ?, ?)',
            [employerEmail, `New application received for ${jobTitle}`, 'info']
        );

        // To Employer (Email Notification)
        const emailHtml = `
            <h2>New Job Application</h2>
            <p><strong>Job:</strong> ${jobTitle}</p>
            <p><strong>Applicant:</strong> ${studentEmail}</p>
            <p>Login to your dashboard to view the CV.</p>
        `;
        sendEmail(employerEmail, "New Application Received", emailHtml);

        res.json({ success: true });
    } catch (err) { next(err); }
});

// 3. Get Employer Applications (FIXED UNDEFINED EMAIL)
app.get('/api/employer/applications/:email', async (req, res, next) => {
    try {
        // We select u.email explicitly so the frontend can access it
        const [r] = await pool.query(`
            SELECT a.*, 
                   u.firstName, 
                   u.lastName, 
                   u.phone, 
                   u.email as studentEmail, 
                   j.jobTitle 
            FROM applications a 
            JOIN jobs j ON a.jobId = j.id 
            JOIN users u ON a.studentEmail = u.email 
            WHERE j.employerEmail = ?`,
            [req.params.email]
        );
        res.json({ success: true, applications: r });
    } catch (err) { next(err); }
});

// 4. Get Notifications
app.get('/api/notifications/:email', async (req, res, next) => {
    try {
        const [r] = await pool.query('SELECT * FROM notifications WHERE userEmail=? ORDER BY createdAt DESC', [req.params.email]);
        res.json({ success: true, notifications: r });
    } catch (err) { next(err); }
});

// 5. Mark Notification Read
app.put('/api/notifications/read/:id', async (req, res, next) => {
    try {
        await pool.query('UPDATE notifications SET isRead = 1 WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { next(err); }
});


// ===================================================
// ================= USER PROFILES ===================
// ===================================================

app.get('/api/employer/:email', async (req, res, next) => {
    try {
        const [r] = await pool.query('SELECT * FROM employers WHERE email=?', [req.params.email]);
        if (r.length > 0) res.json({ success: true, employer: r[0] });
        else res.status(404).json({ success: false });
    } catch (err) { next(err); }
});

app.get('/api/user/:email', async (req, res, next) => {
    try {
        const [r] = await pool.query('SELECT * FROM users WHERE email=?', [req.params.email]);
        if (r.length > 0) res.json({ success: true, user: r[0] });
        else res.status(404).json({ success: false });
    } catch (err) { next(err); }
});

// Update Employer Profile
app.put('/api/update-employer', upload.single('logo'), async (req, res, next) => {
    try {
        const { email, address, city, phone, emailNotifications } = req.body;
        const notifVal = (emailNotifications == 1 || emailNotifications == 'true') ? 1 : 0;

        let sql = 'UPDATE employers SET address=?, city=?, phone=?, emailNotifications=?';
        let params = [address, city, phone, notifVal];

        if (req.file) {
            sql += ', logo=?';
            params.push(`${getBaseUrl(req)}/uploads/${req.file.filename}`);
        }

        sql += ' WHERE email=?';
        params.push(email);

        await pool.query(sql, params);

        // Return the Updated Employer Object so Frontend can refresh immediately
        const [rows] = await pool.query('SELECT * FROM employers WHERE email = ?', [email]);
        res.json({ success: true, employer: rows[0] });
    } catch (err) { next(err); }
});

// Update Student Profile
app.post('/api/update-profile', upload.fields([{ name: 'profilePic' }, { name: 'cvFile' }]), async (req, res, next) => {
    try {
        const { email, firstName, lastName, phone, dob, city, educationLevel } = req.body;
        let sql = `UPDATE users SET firstName=?, lastName=?, phone=?, dob=?, city=?, educationLevel=?`;
        let params = [firstName, lastName, phone, dob, city, educationLevel];

        if (req.files && req.files['profilePic']) {
            sql += `, profilePic=?`;
            params.push(`${getBaseUrl(req)}/uploads/${req.files['profilePic'][0].filename}`);
        }
        if (req.files && req.files['cvFile']) {
            sql += `, cvFile=?`;
            params.push(`${getBaseUrl(req)}/uploads/${req.files['cvFile'][0].filename}`);
        }

        sql += ` WHERE email=?`;
        params.push(email);

        await pool.query(sql, params);
        const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        res.json({ success: true, user: rows[0] });
    } catch (err) { next(err); }
});

// Delete Student CV/Photo
app.delete('/api/user/cv/:email', async (req, res, next) => {
    try {
        await pool.query('UPDATE users SET cvFile=NULL WHERE email=?', [req.params.email]);
        res.json({ success: true });
    } catch (err) { next(err); }
});

app.delete('/api/user/photo/:email', async (req, res, next) => {
    try {
        await pool.query('UPDATE users SET profilePic=NULL WHERE email=?', [req.params.email]);
        res.json({ success: true });
    } catch (err) { next(err); }
});

// ===================================================
// ================ GLOBAL ERROR HANDLER =============
// ===================================================
app.use((err, req, res, next) => {
    console.error("🔥 Global Error:", err);
    res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
module.exports = app;