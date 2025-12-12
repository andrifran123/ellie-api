require('dotenv').config();
const { Pool } = require('pg');

const rawDbUrl = process.env.DATABASE_URL;
const u = new URL(rawDbUrl);
const pool = new Pool({
  host: u.hostname,
  port: Number(u.port || 6543),
  user: decodeURIComponent(u.username || 'postgres'),
  password: decodeURIComponent(u.password || ''),
  database: u.pathname.replace(/^\//, '') || 'postgres',
  ssl: { rejectUnauthorized: false }
});

const userId = process.argv[2] || '2ff9e42d-4600-44e9-b4bf-c2bb76117933';

async function check() {
  try {
    console.log('Checking memories for:', userId);

    // Get memories from user_memories table
    const memRes = await pool.query(
      'SELECT memory_type, content, importance FROM user_memories WHERE user_id = $1 ORDER BY importance DESC',
      [userId]
    );
    console.log('\n=== USER_MEMORIES TABLE ===');
    console.log('Total:', memRes.rows.length);
    memRes.rows.forEach(r => console.log(`  [${r.memory_type}] ${r.content} (imp: ${r.importance})`));

    // Get facts from facts table
    const factsRes = await pool.query(
      'SELECT category, fact, sentiment, confidence FROM facts WHERE user_id = $1',
      [userId]
    );
    console.log('\n=== FACTS TABLE ===');
    console.log('Total:', factsRes.rows.length);
    factsRes.rows.forEach(r => console.log(`  [${r.category}] ${r.fact} (conf: ${r.confidence})`));

    await pool.end();
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

check();
