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
  const userId = process.argv[2] || '0622205b-8a44-4fd1-a170-19648faf4021';
  const stage = process.argv[3] || 'EXCLUSIVE';
  const level = parseInt(process.argv[4]) || 100;

  console.log('Checking user:', userId);
  console.log('Target stage:', stage, 'level:', level);
  console.log('');

  // Check user_relationships
  const rel = await pool.query('SELECT * FROM user_relationships WHERE user_id = $1', [userId]);
  console.log('Current relationship:', rel.rows[0] || 'NOT FOUND');
  console.log('');

  if (!rel.rows[0]) {
    console.log('Creating relationship record...');
    await pool.query(`
      INSERT INTO user_relationships (user_id, relationship_level, current_stage, last_interaction, total_interactions, streak_days, longest_streak, last_mood, emotional_investment, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), 50, 5, 5, 'normal', 0.8, NOW(), NOW())
    `, [userId, level, stage]);
    console.log('Created with', stage, 'level', level);
  } else {
    console.log('Updating to', stage, 'level', level, '...');
    await pool.query(`
      UPDATE user_relationships
      SET relationship_level = $2, current_stage = $3, updated_at = NOW()
      WHERE user_id = $1
    `, [userId, level, stage]);
    console.log('Updated!');
  }

  // Verify
  const verify = await pool.query('SELECT * FROM user_relationships WHERE user_id = $1', [userId]);
  console.log('');
  console.log('After update:', verify.rows[0]);

  await pool.end();
}

checkAndUpdate().catch(e => { console.error('Error:', e.message); process.exit(1); });
