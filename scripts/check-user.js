/**
 * Check and update a user's relationship
 * Usage: node scripts/check-user.js
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

async function checkAndUpdate() {
  const userId = '0622205b-8a44-4fd1-a170-19648faf4021';

  console.log('Checking user:', userId);
  console.log('');

  // Check user_relationships
  const rel = await pool.query('SELECT * FROM user_relationships WHERE user_id = $1', [userId]);
  console.log('Current relationship:', rel.rows[0] || 'NOT FOUND');
  console.log('');

  if (!rel.rows[0]) {
    console.log('Creating relationship record...');
    await pool.query(`
      INSERT INTO user_relationships (user_id, relationship_level, current_stage, last_interaction, total_interactions, streak_days, longest_streak, last_mood, emotional_investment, created_at, updated_at)
      VALUES ($1, 100, 'EXCLUSIVE', NOW(), 50, 5, 5, 'normal', 0.8, NOW(), NOW())
    `, [userId]);
    console.log('Created with EXCLUSIVE level 100');
  } else {
    console.log('Updating to EXCLUSIVE level 100...');
    await pool.query(`
      UPDATE user_relationships
      SET relationship_level = 100, current_stage = 'EXCLUSIVE', updated_at = NOW()
      WHERE user_id = $1
    `, [userId]);
    console.log('Updated!');
  }

  // Verify
  const verify = await pool.query('SELECT * FROM user_relationships WHERE user_id = $1', [userId]);
  console.log('');
  console.log('After update:', verify.rows[0]);

  await pool.end();
}

checkAndUpdate().catch(e => { console.error('Error:', e.message); process.exit(1); });
