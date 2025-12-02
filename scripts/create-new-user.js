/**
 * Create a NEW test user with FRIEND_TENSION stage at level 22
 * Usage: node scripts/create-new-user.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

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

async function createUser() {
  // Generate unique email with timestamp
  const timestamp = Date.now();
  const testEmail = `testuser_${timestamp}@tension.test`;
  const testPassword = 'TestPassword123!';
  const userId = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(testPassword, 10);

  console.log('🔧 Creating NEW user...');

  // Create user with NO name, NO onboarding data - fresh start
  await pool.query(`
    INSERT INTO users (email, password_hash, paid, user_id, terms_accepted_at, updated_at)
    VALUES ($1, $2, TRUE, $3, NOW(), NOW())
  `, [testEmail, passwordHash, userId]);

  // Set relationship level to FRIEND_TENSION (22) but no onboarding facts
  await pool.query(`
    INSERT INTO user_relationships (user_id, relationship_level, current_stage, last_interaction, total_interactions, streak_days, longest_streak, last_mood, emotional_investment, created_at, updated_at)
    VALUES ($1, 22, 'FRIEND_TENSION', NOW(), 0, 0, 0, 'normal', 0, NOW(), NOW())
  `, [userId]);

  // NO facts pre-populated - user will go through full onboarding:
  // 1. Select language
  // 2. Enter name
  // 3. See disclaimer

  console.log('');
  console.log('========================================');
  console.log('🎉 NEW User Created!');
  console.log('========================================');
  console.log(`Email:    ${testEmail}`);
  console.log(`Password: ${testPassword}`);
  console.log(`User ID:  ${userId}`);
  console.log('Stage:    FRIEND_TENSION');
  console.log('Level:    22/100');
  console.log('========================================');

  await pool.end();
}

createUser().catch(e => { console.error('Error:', e.message); process.exit(1); });
