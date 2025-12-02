/**
 * Script to create a test user with FRIEND_TENSION stage at level 22
 * Usage: node scripts/create-test-user.js
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Parse DATABASE_URL same way as server.js
const rawDbUrl = process.env.DATABASE_URL;
if (!rawDbUrl) {
  console.error("❌ Missing DATABASE_URL in .env");
  process.exit(1);
}

console.log("🔍 DATABASE_URL found, length:", rawDbUrl.length);

let pgConfig;
try {
  const u = new URL(rawDbUrl);
  pgConfig = {
    host: u.hostname,
    port: Number(u.port || 6543),
    user: decodeURIComponent(u.username || "postgres"),
    password: decodeURIComponent(u.password || ""),
    database: u.pathname.replace(/^\//, "") || "postgres",
  };
  const sslmode = u.searchParams.get("sslmode");
  if (!/localhost|127\.0\.0\.1/.test(pgConfig.host) || sslmode === "require") {
    pgConfig.ssl = { rejectUnauthorized: false };
  }
  console.log(`✅ DB config: host=${pgConfig.host}, port=${pgConfig.port}, db=${pgConfig.database}`);
} catch (e) {
  console.error("❌ Invalid DATABASE_URL:", e.message);
  process.exit(1);
}

const pool = new Pool(pgConfig);

async function createTestUser() {
  const testEmail = "testuser@tension.test";
  const testPassword = "TestPassword123!";
  const testName = "Test Tension User";
  const userId = crypto.randomUUID();

  console.log("🔧 Creating test user with FRIEND_TENSION stage...");
  console.log(`   Email: ${testEmail}`);
  console.log(`   Password: ${testPassword}`);
  console.log(`   User ID: ${userId}`);
  console.log(`   Stage: FRIEND_TENSION (level 22/100)`);

  try {
    // Hash the password
    const passwordHash = await bcrypt.hash(testPassword, 10);

    // Insert or update user
    await pool.query(`
      INSERT INTO users (email, name, password_hash, paid, user_id, terms_accepted_at, updated_at)
      VALUES ($1, $2, $3, TRUE, $4, NOW(), NOW())
      ON CONFLICT (email) DO UPDATE
        SET name = EXCLUDED.name,
            password_hash = EXCLUDED.password_hash,
            user_id = COALESCE(users.user_id, EXCLUDED.user_id),
            paid = TRUE,
            terms_accepted_at = COALESCE(users.terms_accepted_at, NOW()),
            updated_at = NOW()
      RETURNING user_id
    `, [testEmail, testName, passwordHash, userId]);

    console.log("✅ User created/updated in users table");

    // Get the actual user_id (might be existing one if user existed)
    const { rows: userRows } = await pool.query(
      `SELECT user_id FROM users WHERE email = $1`,
      [testEmail]
    );
    const actualUserId = userRows[0]?.user_id || userId;

    // Create/update user_relationships with FRIEND_TENSION at level 22
    await pool.query(`
      INSERT INTO user_relationships (
        user_id,
        relationship_level,
        current_stage,
        last_interaction,
        total_interactions,
        streak_days,
        longest_streak,
        last_mood,
        emotional_investment,
        created_at,
        updated_at
      )
      VALUES ($1, 22, 'FRIEND_TENSION', NOW(), 50, 5, 5, 'normal', 0.3, NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE
        SET relationship_level = 22,
            current_stage = 'FRIEND_TENSION',
            last_interaction = NOW(),
            updated_at = NOW()
    `, [actualUserId]);

    console.log("✅ User relationship set to FRIEND_TENSION (level 22)");

    // Add user_name to facts table
    await pool.query(`
      INSERT INTO facts (user_id, category, fact, confidence, created_at, updated_at)
      VALUES ($1, 'user_name', $2, 1.0, NOW(), NOW())
      ON CONFLICT DO NOTHING
    `, [actualUserId, testName]);

    console.log("✅ User name added to facts");

    console.log("\n========================================");
    console.log("🎉 Test user created successfully!");
    console.log("========================================");
    console.log(`Email:    ${testEmail}`);
    console.log(`Password: ${testPassword}`);
    console.log(`User ID:  ${actualUserId}`);
    console.log(`Stage:    FRIEND_TENSION`);
    console.log(`Level:    22/100`);
    console.log("========================================\n");

  } catch (error) {
    console.error("❌ Error creating test user:", error.message);
  } finally {
    await pool.end();
  }
}

createTestUser();
