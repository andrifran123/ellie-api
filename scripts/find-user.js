/**
 * Find a specific user by email
 * Usage: node scripts/find-user.js
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

async function findUser() {
  const email = 'agustomontana@gmail.com';

  console.log('Searching for:', email);
  console.log('');

  // Search in users table
  const users = await pool.query(
    "SELECT * FROM users WHERE email ILIKE $1",
    [`%${email.split('@')[0]}%`]
  );

  console.log('Found in users table:', users.rows.length, 'records');
  users.rows.forEach((u, i) => {
    console.log(`\n--- User ${i + 1} ---`);
    console.log('email:', u.email);
    console.log('user_id:', u.user_id);
    console.log('name:', u.name);
    console.log('created_at:', u.created_at);
    console.log('paid:', u.paid);
  });

  // Also check user_relationships for any matching
  if (users.rows.length > 0) {
    for (const user of users.rows) {
      const rel = await pool.query(
        "SELECT * FROM user_relationships WHERE user_id = $1",
        [user.user_id]
      );
      console.log(`\nRelationship for ${user.user_id}:`, rel.rows[0] || 'NOT FOUND');
    }
  }

  // Check if there are orphaned relationships (user_id not in users)
  console.log('\n--- Checking for orphaned relationships ---');
  const orphaned = await pool.query(`
    SELECT r.* FROM user_relationships r
    LEFT JOIN users u ON r.user_id = u.user_id::text
    WHERE u.user_id IS NULL
    LIMIT 5
  `);
  console.log('Orphaned relationships:', orphaned.rows.length);
  orphaned.rows.forEach(r => {
    console.log('  - user_id:', r.user_id, 'stage:', r.current_stage, 'level:', r.relationship_level);
  });

  await pool.end();
}

findUser().catch(e => { console.error('Error:', e.message); process.exit(1); });
