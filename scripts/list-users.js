/**
 * List users with email and UUID
 * Usage: node scripts/list-users.js
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

async function listUsers() {
  const { rows } = await pool.query(`
    SELECT u.email, u.user_id, u.name, u.created_at, r.current_stage, r.relationship_level
    FROM users u
    LEFT JOIN user_relationships r ON u.user_id::text = r.user_id
    ORDER BY u.created_at DESC
    LIMIT 25
  `);

  console.log('📧 Users (email → UUID):\n');
  console.log('='.repeat(80));

  rows.forEach(r => {
    console.log(`Email: ${r.email}`);
    console.log(`UUID:  ${r.user_id}`);
    console.log(`Name:  ${r.name || '(none)'}`);
    console.log(`Stage: ${r.current_stage || 'N/A'} (Level ${r.relationship_level || 0})`);
    console.log('-'.repeat(80));
  });

  await pool.end();
}

listUsers().catch(e => { console.error('Error:', e.message); process.exit(1); });
