-- ========================================
-- SQL Script to Create Test User with FRIEND_TENSION Stage (Level 22)
-- Run this in your Supabase SQL Editor: https://app.supabase.com
-- ========================================

-- Variables for the test user
-- Email: testuser@tension.test
-- Password: TestPassword123! (hashed below)
-- Stage: FRIEND_TENSION
-- Level: 22/100

-- Step 1: Generate a UUID for the user
-- (You can replace this with a specific UUID if you want)
DO $$
DECLARE
    new_user_id UUID := gen_random_uuid();
    test_email TEXT := 'testuser@tension.test';
    test_name TEXT := 'Test Tension User';
    -- This is bcrypt hash for 'TestPassword123!' with 10 rounds
    password_hash TEXT := '$2a$10$rKN3QJZ8KXZV5Zq9XYeZxu5FNjF7FoKr9dNgEUqT5cXsYB8Kz0LXe';
BEGIN
    -- Insert or update user in users table
    INSERT INTO users (email, name, password_hash, paid, user_id, terms_accepted_at, updated_at)
    VALUES (test_email, test_name, password_hash, TRUE, new_user_id, NOW(), NOW())
    ON CONFLICT (email) DO UPDATE
        SET name = EXCLUDED.name,
            password_hash = EXCLUDED.password_hash,
            paid = TRUE,
            terms_accepted_at = COALESCE(users.terms_accepted_at, NOW()),
            updated_at = NOW()
    RETURNING user_id INTO new_user_id;

    -- Get the actual user_id (in case it was an existing user)
    SELECT user_id INTO new_user_id FROM users WHERE email = test_email;

    -- Insert or update user_relationships with FRIEND_TENSION at level 22
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
    VALUES (
        new_user_id::TEXT,
        22,
        'FRIEND_TENSION',
        NOW(),
        50,
        5,
        5,
        'normal',
        0.3,
        NOW(),
        NOW()
    )
    ON CONFLICT (user_id) DO UPDATE
        SET relationship_level = 22,
            current_stage = 'FRIEND_TENSION',
            last_interaction = NOW(),
            updated_at = NOW();

    -- Add user_name to facts table
    INSERT INTO facts (user_id, category, fact, confidence, created_at, updated_at)
    VALUES (new_user_id::TEXT, 'user_name', test_name, 1.0, NOW(), NOW())
    ON CONFLICT DO NOTHING;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'Test user created successfully!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Email:    testuser@tension.test';
    RAISE NOTICE 'Password: TestPassword123!';
    RAISE NOTICE 'User ID:  %', new_user_id;
    RAISE NOTICE 'Stage:    FRIEND_TENSION';
    RAISE NOTICE 'Level:    22/100';
    RAISE NOTICE '========================================';
END $$;

-- Verify the user was created correctly
SELECT
    u.email,
    u.name,
    u.user_id,
    u.paid,
    r.current_stage,
    r.relationship_level
FROM users u
LEFT JOIN user_relationships r ON u.user_id::TEXT = r.user_id
WHERE u.email = 'testuser@tension.test';
