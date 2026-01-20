-- ===================================================
-- SUBSCRIPTION SYSTEM DATABASE SCHEMA
-- ===================================================
-- Created: 2026-01-15
-- Purpose: Add subscription plans with payment tracking
-- ===================================================

-- 1. Modify employers table to add subscription fields
-- (Commented out as columns likely exist, causing errors on re-run)
-- ALTER TABLE employers
-- ADD COLUMN currentPlan ENUM('free', 'bronze', 'gold', 'platinum') DEFAULT 'free',
-- ADD COLUMN jobPostsRemaining INT DEFAULT 2,
-- ADD COLUMN subscriptionExpiresAt DATETIME NULL;

-- 2. Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employerEmail VARCHAR(255) NOT NULL,
    planType ENUM('free', 'bronze', 'gold', 'platinum') NOT NULL,
    status ENUM('active', 'expired', 'cancelled') DEFAULT 'active',
    activatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    expiresAt DATETIME NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employerEmail) REFERENCES employers(email) ON DELETE CASCADE,
    INDEX idx_employer (employerEmail),
    INDEX idx_status (status)
);

-- 3. Create subscription_payments table
CREATE TABLE IF NOT EXISTS subscription_payments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employerEmail VARCHAR(255) NOT NULL,
    planType ENUM('bronze', 'gold', 'platinum') NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    receiptUrl VARCHAR(500) NOT NULL,
    status ENUM('pending', 'approved', 'declined') DEFAULT 'pending',
    declineReason TEXT NULL,
    submittedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewedBy VARCHAR(100) NULL,
    reviewedAt DATETIME NULL,
    FOREIGN KEY (employerEmail) REFERENCES employers(email) ON DELETE CASCADE,
    INDEX idx_status (status),
    INDEX idx_employer (employerEmail)
);

-- ===================================================
-- INITIAL DATA SETUP
-- ===================================================

-- Set all existing employers to FREE plan (2 job posts)
UPDATE employers 
SET currentPlan = 'free', 
    jobPostsRemaining = 2 
WHERE currentPlan IS NULL;

-- ===================================================
-- VERIFICATION QUERIES
-- ===================================================
-- Use these to verify the schema was created correctly:
-- 
-- SHOW COLUMNS FROM employers;
-- SHOW COLUMNS FROM subscriptions;
-- SHOW COLUMNS FROM subscription_payments;
-- SELECT email, currentPlan, jobPostsRemaining FROM employers;
