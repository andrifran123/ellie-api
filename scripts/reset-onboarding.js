/**
 * Reset onboarding state for a user
 * Usage: node scripts/reset-onboarding.js [email]
 * Default email: testuser@tension.test
 */

require('dotenv').config();
const { Pool } = require('pg');

const rawDbUrl = process.env.DATABASE_URL;
const u = new URL(rawDbUrl);
const pgConfig = {
  host: u.hostname,
  port: Number(u.port || 6543),
  user: decodeURIComponent(u.username || 'postgres'),
  password: decodeURIComponent(u.password || ''),
  database: u.pathname.replace(/^\//, '') || 'postgres',
  ssl: { rejectUnauthorized: false }
};

const pool = new Pool(pgConfig);

async function resetOnboarding() {
  const email = process.argv[2] || 'testuser@tension.test';
  console.log(`🔧 Resetting onboarding for: ${email}`);

  const { rows } = await pool.query('SELECT user_id FROM users WHERE email = $1', [email]);

  if (!rows.length) {
    console.log('❌ User not found');
    await pool.end();
    return;
  }

  const userId = rows[0].user_id;
  console.log('   User ID:', userId);

  // Clear onboarding facts (language, name, disclaimer)
  const deleted = await pool.query(
    `DELETE FROM facts WHERE user_id = $1 AND category IN ('language', 'user_name', 'seen_chat_disclaimer') RETURNING category`,
    [userId]
  );

  console.log(`   Cleared ${deleted.rowCount} fact(s)`);

  // Also clear name from users table
  await pool.query('UPDATE users SET name = NULL WHERE user_id = $1', [userId]);

  console.log('');
  console.log('✅ Onboarding reset! User will now need to:');
  console.log('   1. Select language');
  console.log('   2. Enter name');
  console.log('   3. Acknowledge disclaimer');

  await pool.end();
}

resetOnboarding().catch(e => { console.error(e); process.exit(1); });
