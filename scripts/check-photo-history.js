require('dotenv').config();
const { Pool } = require('pg');

const rawDbUrl = process.env.DATABASE_URL;
const u = new URL(rawDbUrl);
const pgConfig = {
  host: u.hostname,
  port: Number(u.port || 6543),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ''),
  ssl: { rejectUnauthorized: false }
};

const pool = new Pool(pgConfig);

async function check() {
  const userId = process.argv[2] || '66f14fd5-4dbb-4efe-9057-1efe41d1cbc9';

  const { rows } = await pool.query(
    'SELECT * FROM user_photo_history WHERE user_id = $1 ORDER BY sent_at DESC',
    [userId]
  );

  console.log('Photo history for', userId + ':', rows.length, 'photos');
  rows.forEach(r => console.log('- photo_id:', r.photo_id, 'sent_at:', r.sent_at));

  await pool.end();
}

check().catch(e => { console.error(e.message); process.exit(1); });
