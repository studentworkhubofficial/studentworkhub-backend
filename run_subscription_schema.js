const mysql = require('mysql2/promise');
const fs = require('fs');
require('dotenv').config();

async function runSchema() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '12121212',
        database: process.env.DB_NAME || 'studentworkhub',
        multipleStatements: true
    });

    try {
        console.log('📊 Reading subscription schema...');
        const schema = fs.readFileSync('./subscription_schema.sql', 'utf8');

        console.log('🔄 Executing schema changes...');
        await connection.query(schema);

        console.log('✅ Subscription schema applied successfully!');

        // Verify
        console.log('\n📋 Verifying changes...');
        const [employers] = await connection.query('SELECT email, currentPlan, jobPostsRemaining FROM employers LIMIT 5');
        console.log('Sample employer data:', employers);

        const [tables] = await connection.query('SHOW TABLES');
        console.log('\nAvailable tables:', tables.map(t => Object.values(t)[0]).join(', '));

    } catch (error) {
        console.error('❌ Error executing schema:', error.message);
    } finally {
        await connection.end();
    }
}

runSchema();
