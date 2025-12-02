/**
 * Check what categories and nsfw_levels exist in ellie_photos
 * Usage: node scripts/check-photo-categories.js
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

async function checkCategories() {
  console.log('📸 Checking ellie_photos table...\n');

  // Get distinct categories
  const categories = await pool.query(`
    SELECT category, COUNT(*) as count
    FROM ellie_photos
    WHERE is_active = true
    GROUP BY category
    ORDER BY count DESC
  `);

  console.log('📂 Categories:');
  categories.rows.forEach(r => console.log(`   ${r.category}: ${r.count} photos`));

  // Get nsfw_level distribution
  const nsfwLevels = await pool.query(`
    SELECT nsfw_level, COUNT(*) as count
    FROM ellie_photos
    WHERE is_active = true
    GROUP BY nsfw_level
    ORDER BY nsfw_level
  `);

  console.log('\n🔞 NSFW Levels:');
  nsfwLevels.rows.forEach(r => console.log(`   Level ${r.nsfw_level}: ${r.count} photos`));

  // Get column names
  const columns = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'ellie_photos'
    ORDER BY ordinal_position
  `);

  console.log('\n📋 All columns in ellie_photos:');
  columns.rows.forEach(r => console.log(`   ${r.column_name} (${r.data_type})`));

  await pool.end();
}

checkCategories().catch(e => { console.error('Error:', e.message); process.exit(1); });
