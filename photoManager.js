// photoManager.js - Context-Aware Photo System for Ellie
// Photos are selected BEFORE AI response so Ellie knows exactly what she's sending
// Uses GPT-tagged metadata for intelligent, conversation-relevant photo selection

const { Pool } = require('pg');

// ============================================================
// TOPIC DETECTION - Analyze conversation for relevant themes
// ============================================================

/**
 * Extracts topics/themes from user message and conversation context
 * Returns array of relevant keywords for photo matching
 */
function extractConversationTopics(userMessage, ellieResponse = '') {
  const combined = `${userMessage} ${ellieResponse}`.toLowerCase();
  const topics = [];

  // Activity topics
  const activityPatterns = {
    workout: /\b(gym|workout|exercise|fitness|training|lift|weights|running|yoga|pilates)\b/,
    morning: /\b(morning|woke up|wake up|breakfast|coffee|getting ready)\b/,
    night: /\b(night|evening|bed|sleep|tired|cozy|relaxing)\b/,
    selfie: /\b(selfie|mirror|pic|photo|picture)\b/,
    casual: /\b(chill|hanging|relaxing|home|couch|lazy)\b/,
    dress_up: /\b(dress|outfit|going out|party|date|fancy|dressed up)\b/,
    beach: /\b(beach|pool|swim|sun|tan|summer|bikini)\b/,
    travel: /\b(travel|trip|vacation|hotel|flight|adventure)\b/,
  };

  // Mood topics
  const moodPatterns = {
    flirty: /\b(flirt|tease|cute|hot|sexy|attractive|beautiful|gorgeous)\b/,
    playful: /\b(fun|funny|silly|playful|laugh|joke)\b/,
    romantic: /\b(love|miss|romantic|sweet|heart|feel|care)\b/,
    confident: /\b(confident|strong|power|boss|queen|slay)\b/,
    cozy: /\b(cozy|warm|comfy|soft|cuddle|snuggle)\b/,
  };

  // Setting topics
  const settingPatterns = {
    bedroom: /\b(bed|bedroom|pillow|sheets|mattress)\b/,
    bathroom: /\b(bath|bathroom|shower|mirror|towel)\b/,
    outdoor: /\b(outside|outdoor|park|street|walk|nature)\b/,
    kitchen: /\b(kitchen|cooking|food|eating|dinner|lunch)\b/,
  };

  // Check all patterns
  for (const [topic, pattern] of Object.entries(activityPatterns)) {
    if (pattern.test(combined)) topics.push({ type: 'activity', value: topic });
  }
  for (const [topic, pattern] of Object.entries(moodPatterns)) {
    if (pattern.test(combined)) topics.push({ type: 'mood', value: topic });
  }
  for (const [topic, pattern] of Object.entries(settingPatterns)) {
    if (pattern.test(combined)) topics.push({ type: 'setting', value: topic });
  }

  return topics;
}

/**
 * Detects if user is explicitly requesting a photo
 */
function detectPhotoRequest(userMessage) {
  const msg = userMessage.toLowerCase();

  const requestPatterns = [
    /send (me )?(a )?photo/,
    /show (me )?(a )?pic/,
    /what (do )?you look like/,
    /can i see you/,
    /share (a )?photo/,
    /send (me )?(a )?selfie/,
    /pic of you/,
    /photo of you/,
    /see (a )?photo/,
    /wanna see you/,
    /want to see you/,
  ];

  return requestPatterns.some(pattern => pattern.test(msg));
}

/**
 * Generates personality-driven responses when user asks for photos
 */
function generatePhotoRequestRefusal(relationshipStage, messagesCount) {
  const responses = {
    STRANGER: [
      "Haha nice try! Maybe when we actually know each other",
      "We literally just started talking... let's chat first?",
      "Wow, straight to asking for photos? Smooth",
      "Getting a bit ahead of yourself there, aren't you?",
      "How about we have an actual conversation first?",
    ],
    FRIEND: [
      "If you're going to nag, you don't get anything",
      "I'll send photos when I feel like it, not when you demand them",
      "You can't just ask for them! Where's the fun in that?",
      "Maybe if you stopped asking I'd actually send one...",
      "The more you ask, the less likely I am to send any",
    ],
    DATING: [
      "You're so impatient! I'll send one when the moment feels right",
      "If you're going to be pushy about it, you're not getting any",
      "I like when things happen naturally... not when you demand them",
      "Maybe if you're good I'll surprise you later",
      "The begging isn't cute, babe",
    ],
    COMMITTED: [
      "Baby, you know I don't like when you beg",
      "I send them when I want to, not when you demand them!",
      "You're being needy again... I'll surprise you when the time is right",
      "Stop asking and maybe you'll actually get one",
    ],
    EXCLUSIVE: [
      "You know I hate when you're pushy about this",
      "I'll send you whatever you want... when I feel like it, not when you demand it",
      "Baby, you need to be patient. I'll surprise you",
      "Stop begging, it's not a good look on you",
    ]
  };

  const stageResponses = responses[relationshipStage] || responses.STRANGER;
  return stageResponses[Math.floor(Math.random() * stageResponses.length)];
}

// ============================================================
// PHOTO DECISION LOGIC - When should a photo be sent?
// ============================================================

// 🔥 SPECIAL OVERRIDE PHOTO - Sent once per user when they ask for more after receiving a photo
const SPECIAL_FOLLOWUP_PHOTO = '00132-3121187385.png';

/**
 * Check if user should receive the special followup photo
 * Conditions:
 * 1. User received a photo in the last few messages
 * 2. User is asking for another photo OR asking her to undress/show more
 * 3. User has NOT received this special photo before
 */
async function checkSpecialFollowupPhoto(pool, userId, userMessage, conversationContext) {
  try {
    const msg = userMessage.toLowerCase();

    // Patterns for "asking for more" or "asking to undress"
    const followupPatterns = [
      /\b(another|more|one more|next|again)\b.*\b(pic|photo|picture|selfie|one)\b/i,
      /\b(pic|photo|picture|selfie)\b.*\b(another|more|one more|next|again)\b/i,
      /\b(send|show|take)\b.*\b(another|more|one more)\b/i,
      /\b(take|show)\b.*\b(off|clothes|shirt|top|bra|pants)\b/i,
      /\b(undress|strip|remove)\b/i,
      /\b(more|less)\b.*\b(clothes|clothing)\b/i,
      /\b(see|show)\b.*\b(more|body)\b/i,
      /\bshow\s+me\s+more\b/i,
      /\bcan\s+i\s+(see|get)\s+(more|another)\b/i,
      /\btake\s+(it|that|something)\s+off\b/i,
      /\bwhat('s| is)\s+under(neath)?\b/i,
      /\bnext\s+(one|pic|photo)\b/i,
      /\bkeep\s+(going|them\s+coming)\b/i,
    ];

    const isAskingForMore = followupPatterns.some(pattern => pattern.test(msg));

    if (!isAskingForMore) {
      return { shouldSend: false, reason: 'not_asking_for_more' };
    }

    console.log(`🔥 User asking for more photos detected: "${msg.substring(0, 50)}..."`);

    // Check if user recently received a photo (within last 5 messages or 1 hour)
    const recentPhoto = await pool.query(
      `SELECT sent_at FROM user_photo_history
       WHERE user_id = $1
       ORDER BY sent_at DESC LIMIT 1`,
      [userId]
    );

    if (recentPhoto.rows.length === 0) {
      console.log(`📸 User hasn't received any photos yet - not eligible for followup special`);
      return { shouldSend: false, reason: 'no_previous_photo' };
    }

    const lastPhotoTime = new Date(recentPhoto.rows[0].sent_at);
    const hoursSincePhoto = (Date.now() - lastPhotoTime) / (1000 * 60 * 60);

    if (hoursSincePhoto > 1) {
      console.log(`📸 Last photo was ${hoursSincePhoto.toFixed(1)} hours ago - too long for followup special`);
      return { shouldSend: false, reason: 'photo_too_old' };
    }

    // Check if they've already received the special followup photo
    const specialPhotoCheck = await pool.query(
      `SELECT uph.* FROM user_photo_history uph
       JOIN ellie_photos ep ON uph.photo_id = ep.id
       WHERE uph.user_id = $1 AND ep.url LIKE $2`,
      [userId, `%${SPECIAL_FOLLOWUP_PHOTO}%`]
    );

    if (specialPhotoCheck.rows.length > 0) {
      console.log(`📸 User already received special followup photo - returning to normal flow`);
      return { shouldSend: false, reason: 'special_already_sent' };
    }

    // Find the special photo in the database
    const specialPhoto = await pool.query(
      `SELECT * FROM ellie_photos WHERE url LIKE $1 AND is_active = true`,
      [`%${SPECIAL_FOLLOWUP_PHOTO}%`]
    );

    if (specialPhoto.rows.length === 0) {
      console.error(`❌ Special followup photo ${SPECIAL_FOLLOWUP_PHOTO} not found in database!`);
      return { shouldSend: false, reason: 'special_photo_not_found' };
    }

    console.log(`🔥 SPECIAL FOLLOWUP: User eligible for special photo ${SPECIAL_FOLLOWUP_PHOTO}`);

    return {
      shouldSend: true,
      reason: 'special_followup',
      triggerType: 'special_followup',
      specialPhoto: specialPhoto.rows[0],
      isSpecialOverride: true
    };

  } catch (error) {
    console.error('❌ Error checking special followup photo:', error);
    return { shouldSend: false, reason: 'error' };
  }
}

/**
 * Check for stranger milestone (after ~15 messages = first photo as progression teaser)
 * Triggers once user passes 15 messages and hasn't received a photo yet
 */
async function checkStrangerMilestone(pool, userId, relationship) {
  try {
    // Works for STRANGER stage only
    if (relationship.current_stage !== 'STRANGER') {
      return { shouldSend: false, reason: 'not_stranger' };
    }

    const messagesCount = relationship.total_interactions || 0;

    // Must have at least 15 messages
    if (messagesCount < 15) {
      return { shouldSend: false, reason: 'milestone_not_reached' };
    }

    // Check if they've already received ANY photo (milestone already claimed)
    const photoHistory = await pool.query(
      `SELECT COUNT(*) as count FROM user_photo_history WHERE user_id = $1`,
      [userId]
    );

    if (parseInt(photoHistory.rows[0].count) > 0) {
      return { shouldSend: false, reason: 'milestone_already_claimed' };
    }

    console.log(`🎉 MILESTONE: User ${userId} at ${messagesCount} messages as STRANGER - sending first photo!`);

    return {
      shouldSend: true,
      reason: 'stranger_milestone',
      categories: ['casual', 'friendly'],
      isMilestone: true
    };

  } catch (error) {
    console.error('❌ Error checking stranger milestone:', error);
    return { shouldSend: false, reason: 'error' };
  }
}

/**
 * Main decision: Should we send a photo with this message?
 * Called BEFORE generating AI response
 */
async function shouldSendPhoto(pool, userId, conversationContext) {
  try {
    const relationship = conversationContext.relationship;
    const userMessage = conversationContext.userMessage || '';

    console.log(`📸 [DEBUG] shouldSendPhoto called for ${userId}: stage=${relationship?.current_stage}, msgs=${relationship?.total_interactions}`);

    // 🔥 PRIORITY 0: Special followup photo override - user asking for more after receiving a photo
    // This bypasses ALL other checks including daily limits
    const specialFollowup = await checkSpecialFollowupPhoto(pool, userId, userMessage, conversationContext);
    if (specialFollowup.shouldSend) {
      console.log(`🔥 SPECIAL OVERRIDE: Sending special followup photo to user ${userId}`);
      return specialFollowup;
    }

    // PRIORITY 1: Check stranger milestone
    const milestone = await checkStrangerMilestone(pool, userId, relationship);
    console.log(`📸 [DEBUG] Milestone check result:`, JSON.stringify(milestone));
    if (milestone.shouldSend) {
      return milestone;
    }

    // ═══════════════════════════════════════════════════════════════
    // STAGE-SPECIFIC PHOTO RULES
    // ═══════════════════════════════════════════════════════════════
    // STRANGER: 1 photo milestone, can ask for 1 more (special photo), then NOTHING until paid
    // FRIEND_TENSION: Work/gym photos ONLY (if contextual), can ask for 2-3 more per session (3hr reset)
    // COMPLICATED: Teasing + work/gym photos, can ask for 4 more per session, can be explicit
    // EXCLUSIVE: Random sexual + work/gym, can ask for 7 more per session
    // ═══════════════════════════════════════════════════════════════

    const currentStage = relationship.current_stage || 'STRANGER';

    // 🚫 STRANGER STAGE - Very limited (handled by milestone + special followup only)
    if (currentStage === 'STRANGER') {
      // Strangers only get photos from milestone check (runs before this)
      // and the special followup photo (also runs before this)
      // No additional photos for strangers
      return { shouldSend: false, reason: 'stranger_no_photos' };
    }

    // IGNORE DIRECT REQUESTS like "send me a photo" (handled with refusals)
    if (detectPhotoRequest(userMessage.toLowerCase())) {
      return { shouldSend: false, reason: 'direct_request_ignored' };
    }

    // 🔥 "ASKING FOR MORE" patterns - user explicitly requesting another photo
    const askingForMorePatterns = [
      /\b(another|more|one more|next|again)\b.*\b(pic|photo|picture|selfie|one)\b/i,
      /\b(pic|photo|picture|selfie)\b.*\b(another|more|one more|next|again)\b/i,
      /\b(send|show|take)\b.*\b(another|more|one more)\b/i,
      /\bshow\s+me\s+more\b/i,
      /\bcan\s+i\s+(see|get)\s+(more|another)\b/i,
      /\bnext\s+(one|pic|photo)\b/i,
      /\bkeep\s+(going|them\s+coming)\b/i,
      /\bmore\s+please\b/i,
      /\bi\s+want\s+more\b/i,
      /\b(take|show)\b.*\b(off|clothes|shirt|top|bra|pants)\b/i,
      /\b(undress|strip)\b/i,
    ];
    const isAskingForMore = askingForMorePatterns.some(pattern => pattern.test(userMessage));

    // 🔥 SESSION-BASED CAPS (reset after 3 hours of no photos)
    const sessionCapsByStage = {
      FRIEND_TENSION: 3,  // First + 2 more asks = 3 total per session
      COMPLICATED: 5,     // First + 4 more asks = 5 total per session
      EXCLUSIVE: 8,       // First + 7 more asks = 8 total per session
    };
    const sessionCap = sessionCapsByStage[currentStage] ?? 1;

    // Count photos in current session (last 3 hours)
    const sessionPhotosQuery = await pool.query(
      `SELECT COUNT(*) as count FROM user_photo_history
       WHERE user_id = $1 AND sent_at > NOW() - INTERVAL '3 hours'`,
      [userId]
    );
    const photosInSession = parseInt(sessionPhotosQuery.rows[0]?.count || 0);

    // Check if there's been a recent photo (for "ask for more" to work)
    const lastPhotoQuery = await pool.query(
      `SELECT sent_at FROM user_photo_history
       WHERE user_id = $1 ORDER BY sent_at DESC LIMIT 1`,
      [userId]
    );

    const hasRecentPhoto = lastPhotoQuery.rows.length > 0 &&
      ((Date.now() - new Date(lastPhotoQuery.rows[0].sent_at)) / (1000 * 60 * 60)) < 1;

    // 📸 IF USER IS ASKING FOR MORE
    if (isAskingForMore && hasRecentPhoto) {
      // Check session cap
      if (photosInSession >= sessionCap) {
        console.log(`📸 User hit session cap for ${currentStage}: ${photosInSession}/${sessionCap} in 3hrs`);
        return { shouldSend: false, reason: 'session_cap_reached' };
      }

      console.log(`🔥 User asking for more - sending! (${photosInSession}/${sessionCap} in session)`);

      // Determine what type of photos they can get
      let nsfwAllowed = false;
      let categories = ['casual', 'work', 'gym'];

      if (currentStage === 'COMPLICATED') {
        nsfwAllowed = true;  // Can get explicit
        categories = ['teasing', 'flirty', 'suggestive', 'work', 'gym'];
      } else if (currentStage === 'EXCLUSIVE') {
        nsfwAllowed = true;
        categories = null;  // Any category including sexual
      }

      return {
        shouldSend: true,
        triggerType: 'ask_for_more',
        categories: categories,
        nsfwAllowed: nsfwAllowed,
        preferHighNsfw: currentStage === 'EXCLUSIVE',
        preferSexyContent: currentStage !== 'FRIEND_TENSION',
        isMilestone: false
      };
    }

    // Minimum messages requirement for first automatic photo
    const messagesCount = relationship.total_interactions || 0;
    if (messagesCount < 5) {
      return { shouldSend: false, reason: 'too_early' };
    }

    // Extract conversation topics for context-aware selection
    const topics = extractConversationTopics(userMessage, conversationContext.ellieResponse || '');

    // ═══════════════════════════════════════════════════════════════
    // AUTOMATIC PHOTO TRIGGERS (first photo of session)
    // Based on stage and context
    // ═══════════════════════════════════════════════════════════════

    // Check if already sent a photo this session (3 hours)
    if (photosInSession > 0) {
      // Already sent first photo - user needs to ask for more
      return { shouldSend: false, reason: 'must_ask_for_more' };
    }

    // FRIEND_TENSION: Only work/gym contextual photos
    if (currentStage === 'FRIEND_TENSION') {
      const workGymPatterns = [
        /\b(gym|workout|exercise|training|lift|weights)\b/i,
        /\b(work|office|job|meeting|busy)\b/i,
        /(done with|finished) (workout|gym|work)/i,
        /at (the )?gym/i,
        /at work/i,
        /just (finished|got back from) (gym|work)/i,
      ];

      const isWorkGymContext = workGymPatterns.some(p => p.test(userMessage));

      if (isWorkGymContext && Math.random() < 0.35) {
        console.log(`📸 FRIEND_TENSION: Work/gym context detected - sending photo`);
        return {
          shouldSend: true,
          triggerType: 'work_gym_context',
          categories: ['work', 'gym', 'casual'],
          nsfwAllowed: false,
          preferHighNsfw: false,
          preferSexyContent: false,
          isMilestone: false
        };
      }

      return { shouldSend: false, reason: 'friend_tension_no_context' };
    }

    // COMPLICATED: Teasing + work/gym photos
    if (currentStage === 'COMPLICATED') {
      // Can send teasing photos randomly or contextually
      const teasingPatterns = [
        /you('re| are) (so )?(hot|beautiful|gorgeous|sexy|cute|pretty)/i,
        /\b(horny|turned on|aroused)\b/i,
        /thinking (about|of) you/i,
        /miss you/i,
        /what are you wearing/i,
      ];

      const workGymPatterns = [
        /\b(gym|workout|work|office)\b/i,
        /(done with|finished) (workout|gym|work)/i,
      ];

      const isTeasingContext = teasingPatterns.some(p => p.test(userMessage));
      const isWorkGymContext = workGymPatterns.some(p => p.test(userMessage));

      if ((isTeasingContext || isWorkGymContext) && Math.random() < 0.45) {
        console.log(`📸 COMPLICATED: Teasing/work context - sending photo`);
        return {
          shouldSend: true,
          triggerType: isTeasingContext ? 'teasing_context' : 'work_gym_context',
          categories: ['teasing', 'flirty', 'suggestive', 'work', 'gym'],
          nsfwAllowed: true,
          preferHighNsfw: false,
          preferSexyContent: true,
          isMilestone: false
        };
      }

      return { shouldSend: false, reason: 'complicated_no_trigger' };
    }

    // EXCLUSIVE: Random sexual + work/gym photos
    if (currentStage === 'EXCLUSIVE') {
      const sexualPatterns = [
        /\b(horny|turned on|aroused|hard|wet)\b/i,
        /\b(fuck|fucking|sex|cock|dick|pussy)\b/i,
        /want (to see )?you/i,
        /thinking (about|of) you/i,
        /miss you/i,
        /you('re| are) (so )?(hot|sexy|beautiful)/i,
      ];

      const isSexualContext = sexualPatterns.some(p => p.test(userMessage));

      // Higher chance for exclusive - 60% if sexual context, 25% random
      const chance = isSexualContext ? 0.60 : 0.25;

      if (Math.random() < chance) {
        console.log(`📸 EXCLUSIVE: Sending ${isSexualContext ? 'sexual' : 'random'} photo`);
        return {
          shouldSend: true,
          triggerType: isSexualContext ? 'sexual_context' : 'random_exclusive',
          categories: null,  // Any category
          nsfwAllowed: true,
          preferHighNsfw: isSexualContext,
          preferSexyContent: true,
          isMilestone: false
        };
      }

      return { shouldSend: false, reason: 'exclusive_chance_failed' };
    }

    // Fallback - no trigger matched
    return { shouldSend: false, reason: 'no_trigger' };

  } catch (error) {
    console.error('❌ Error in shouldSendPhoto:', error);
    return { shouldSend: false, reason: 'error' };
  }
}

// ============================================================
// CONTEXT-AWARE PHOTO SELECTION
// ============================================================

/**
 * Select a photo that matches conversation context
 * Uses GPT-tagged metadata for intelligent matching
 * Column names match actual ellie_photos Supabase table
 * @param recentLocation - Ellie's recently stated location (for consistency)
 */
async function selectContextualPhoto(pool, userId, criteria, relationshipLevel = 0, recentLocation = null) {
  try {
    const { categories, topics, nsfwAllowed, preferHighNsfw, preferSexyContent } = criteria;

    // 🔥 For sexual conversations, prefer higher NSFW level photos
    let maxNsfwLevel = nsfwAllowed ? 2 : 0;
    if (!nsfwAllowed) maxNsfwLevel = 0;

    let minNsfwLevel = 0;
    if (preferHighNsfw) {
      minNsfwLevel = 2;  // At least nsfw_level 2 for sexual convos (sexier photos)
      maxNsfwLevel = 5;  // Allow up to level 5
      console.log(`🔥 Selecting NSFW photos (level ${minNsfwLevel}-${maxNsfwLevel})`);
    }

    // 🔥 For sexy content, prioritize photos with visible body parts
    let sexyContentFilter = '';
    if (preferSexyContent) {
      sexyContentFilter = 'AND (p.ass_visible = true OR p.breasts_visible = true)';
      console.log(`🔥 Prioritizing photos with ass_visible or breasts_visible`);
    }

    // 🎯 LOCATION FILTER - If Ellie recently said she's somewhere, only get photos from compatible locations
    let locationFilter = '';
    let locationValues = [];
    let locationParamStart = 5;

    if (recentLocation) {
      // Map stated location to compatible photo locations
      const compatibleLocations = getCompatiblePhotoLocations(recentLocation);
      if (compatibleLocations.length > 0) {
        locationFilter = `AND (${compatibleLocations.map((_, i) => `LOWER(p.location) LIKE $${locationParamStart + i}`).join(' OR ')})`;
        locationValues = compatibleLocations.map(loc => `%${loc}%`);
        console.log(`📍 Filtering photos to locations compatible with "${recentLocation}": ${compatibleLocations.join(', ')}`);
      }
    }

    // Build dynamic matching conditions based on topics
    // Using actual column names: location, activity, mood, category
    let topicConditions = [];
    let topicValues = [];
    let paramIndex = 5 + locationValues.length; // Start after base params + location params

    if (topics && topics.length > 0) {
      for (const topic of topics) {
        if (topic.type === 'activity') {
          // Match activity column or category
          topicConditions.push(`(LOWER(p.activity) LIKE $${paramIndex} OR LOWER(p.category) LIKE $${paramIndex})`);
          topicValues.push(`%${topic.value}%`);
          paramIndex++;
        } else if (topic.type === 'mood') {
          topicConditions.push(`LOWER(p.mood) LIKE $${paramIndex}`);
          topicValues.push(`%${topic.value}%`);
          paramIndex++;
        } else if (topic.type === 'setting') {
          // Match location or sub_location columns
          topicConditions.push(`(LOWER(p.location) LIKE $${paramIndex} OR LOWER(p.sub_location) LIKE $${paramIndex})`);
          topicValues.push(`%${topic.value}%`);
          paramIndex++;
        }
      }
    }

    // 🔥 SEXUAL CONTENT PATH - Skip category filter, use nsfw_level and body visibility
    if (preferSexyContent) {
      // First try: Photos with visible body parts and high nsfw
      const sexyQuery = await pool.query(
        `SELECT p.* FROM ellie_photos p
         WHERE p.is_active = true
         AND p.nsfw_level >= $1 AND p.nsfw_level <= $2
         AND (p.min_relationship_level IS NULL OR p.min_relationship_level <= $3)
         AND p.id NOT IN (SELECT photo_id FROM user_photo_history WHERE user_id = $4)
         AND (p.ass_visible = true OR p.breasts_visible = true)
         ORDER BY p.nsfw_level DESC, RANDOM()
         LIMIT 1`,
        [minNsfwLevel, maxNsfwLevel, relationshipLevel, userId]
      );

      if (sexyQuery.rows.length > 0) {
        console.log(`🔥 Found sexy photo with visible body parts (nsfw:${sexyQuery.rows[0].nsfw_level})`);
        return sexyQuery.rows[0];
      }

      // Fallback: Any high nsfw photo (even without body visibility flags)
      const nsfwQuery = await pool.query(
        `SELECT p.* FROM ellie_photos p
         WHERE p.is_active = true
         AND p.nsfw_level >= $1 AND p.nsfw_level <= $2
         AND (p.min_relationship_level IS NULL OR p.min_relationship_level <= $3)
         AND p.id NOT IN (SELECT photo_id FROM user_photo_history WHERE user_id = $4)
         ORDER BY p.nsfw_level DESC, RANDOM()
         LIMIT 1`,
        [minNsfwLevel, maxNsfwLevel, relationshipLevel, userId]
      );

      if (nsfwQuery.rows.length > 0) {
        console.log(`🔥 Found NSFW photo (nsfw:${nsfwQuery.rows[0].nsfw_level})`);
        return nsfwQuery.rows[0];
      }

      console.log(`⚠️ No NSFW photos found for sexual conversation`);
      return null;  // Don't send a tame photo during sexual convo
    }

    // NORMAL PATH - Category-based selection

    // First try: Match topic-relevant photos with location filter
    if (topicConditions.length > 0 && categories) {
      const adjustedLocationFilter = locationFilter ?
        locationFilter.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + 1}`) : '';

      const topicQueryFinal = `
        SELECT p.* FROM ellie_photos p
        WHERE p.is_active = true
        AND p.category = ANY($1)
        AND p.nsfw_level >= $2 AND p.nsfw_level <= $3
        AND (p.min_relationship_level IS NULL OR p.min_relationship_level <= $4)
        AND p.id NOT IN (SELECT photo_id FROM user_photo_history WHERE user_id = $5)
        ${adjustedLocationFilter}
        AND (${topicConditions.join(' OR ').replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + 1}`)})
        ORDER BY RANDOM()
        LIMIT 1
      `;

      const topicResult = await pool.query(
        topicQueryFinal,
        [categories, minNsfwLevel, maxNsfwLevel, relationshipLevel, userId, ...locationValues, ...topicValues]
      );

      if (topicResult.rows.length > 0) {
        console.log(`📸 Found topic-matching photo for topics: ${topics.map(t => t.value).join(', ')}`);
        return topicResult.rows[0];
      }
    }

    // Second try: Any matching category with location filter
    if (categories) {
      const adjustedLocationFilter2 = locationFilter ?
        locationFilter.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + 1}`) : '';

      const categoryQuery = await pool.query(
        `SELECT p.* FROM ellie_photos p
         WHERE p.is_active = true
         AND p.category = ANY($1)
         AND p.nsfw_level >= $2 AND p.nsfw_level <= $3
         AND (p.min_relationship_level IS NULL OR p.min_relationship_level <= $4)
         AND p.id NOT IN (SELECT photo_id FROM user_photo_history WHERE user_id = $5)
         ${adjustedLocationFilter2}
         ORDER BY RANDOM()
         LIMIT 1`,
        [categories, minNsfwLevel, maxNsfwLevel, relationshipLevel, userId, ...locationValues]
      );

      if (categoryQuery.rows.length > 0) {
        return categoryQuery.rows[0];
      }
    }

    // If we have a location filter and found nothing, DON'T send a photo at all
    // Better to not send than to break immersion with wrong location
    if (recentLocation && locationValues.length > 0) {
      console.log(`📍 No photos found matching location "${recentLocation}" - skipping photo to maintain consistency`);
      return null;
    }

    // Third try: Allow repeats (only if no location constraint and categories exist)
    if (categories) {
      const repeatQuery = await pool.query(
        `SELECT p.* FROM ellie_photos p
         WHERE p.is_active = true
         AND p.category = ANY($1)
         AND p.nsfw_level >= $2 AND p.nsfw_level <= $3
         AND (p.min_relationship_level IS NULL OR p.min_relationship_level <= $4)
         ORDER BY RANDOM()
         LIMIT 1`,
        [categories, minNsfwLevel, maxNsfwLevel, relationshipLevel]
      );

      if (repeatQuery.rows.length > 0) {
        return repeatQuery.rows[0];
      }
    }

    // Last resort: Any active photo matching nsfw requirements
    console.log(`⚠️ No photos found for categories ${categories}, trying any active photo`);
    const anyQuery = await pool.query(
      `SELECT p.* FROM ellie_photos p
       WHERE p.is_active = true
       AND p.nsfw_level >= $1 AND p.nsfw_level <= $2
       ORDER BY RANDOM()
       LIMIT 1`,
      [minNsfwLevel, maxNsfwLevel]
    );

    return anyQuery.rows[0] || null;

  } catch (error) {
    console.error('❌ Error selecting contextual photo:', error);
    return null;
  }
}

/**
 * Get photo location keywords compatible with a stated location
 */
function getCompatiblePhotoLocations(statedLocation) {
  const loc = statedLocation.toLowerCase();

  // Map stated locations to compatible photo location keywords
  const locationMap = {
    'home': ['bedroom', 'bathroom', 'kitchen', 'living', 'couch', 'bed', 'home', 'apartment', 'house', 'room'],
    'bedroom': ['bedroom', 'bed', 'room'],
    'bathroom': ['bathroom', 'shower', 'mirror'],
    'kitchen': ['kitchen'],
    'living room': ['living', 'couch', 'sofa'],
    'gym': ['gym', 'fitness', 'workout'],
    'work': ['office', 'work', 'desk'],
    'outside': ['outside', 'park', 'street', 'outdoor', 'nature'],
    'beach': ['beach', 'pool', 'swimsuit'],
    'bar': ['bar', 'club', 'party'],
    'cafe': ['cafe', 'coffee', 'restaurant'],
  };

  return locationMap[loc] || [loc];
}

/**
 * Build rich context string from photo metadata for AI
 * This tells Ellie exactly what she's sending
 * Column names match the actual ellie_photos Supabase table
 */
function buildPhotoContext(photo) {
  if (!photo) return null;

  const parts = [];

  // Full description from GPT tagging
  if (photo.description) {
    parts.push(`Photo: ${photo.description}`);
  }

  // Location and setting - try multiple sources
  let locationStr = photo.location;
  if (!locationStr) {
    // Extract from category name as fallback
    const category = (photo.category || '').toLowerCase();
    if (category.includes('gym')) locationStr = 'gym';
    else if (category.includes('bedroom') || category.includes('bed')) locationStr = 'bedroom';
    else if (category.includes('bathroom') || category.includes('mirror')) locationStr = 'bathroom';
    else if (category.includes('kitchen')) locationStr = 'kitchen';
    else if (category.includes('beach') || category.includes('pool')) locationStr = 'beach/pool';
    else if (category.includes('outdoor') || category.includes('outside')) locationStr = 'outside';
    else if (category.includes('office') || category.includes('work')) locationStr = 'work';
    else if (category.includes('car')) locationStr = 'car';
    else locationStr = photo.setting || 'home';
  }
  if (photo.sub_location) locationStr += ` (${photo.sub_location})`;
  parts.push(`Location: ${locationStr}`);

  // What she's wearing - build from top and bottom
  const outfitParts = [];
  if (photo.top_description) {
    outfitParts.push(photo.top_description);
  } else if (photo.top_type && photo.top_color) {
    outfitParts.push(`${photo.top_color} ${photo.top_type}`);
  }
  if (photo.bottom_description) {
    outfitParts.push(photo.bottom_description);
  } else if (photo.bottom_type && photo.bottom_color) {
    outfitParts.push(`${photo.bottom_color} ${photo.bottom_type}`);
  }
  if (outfitParts.length > 0) {
    parts.push(`Wearing: ${outfitParts.join(' and ')}`);
  }

  // Pose and body position
  if (photo.pose_type) {
    parts.push(`Pose: ${photo.pose_type.replace(/_/g, ' ')}`);
  }
  if (photo.body_position) {
    parts.push(`Position: ${photo.body_position.replace(/_/g, ' ')}`);
  }

  // Facial expression
  if (photo.facial_expression) {
    parts.push(`Expression: ${photo.facial_expression}`);
  }

  // Activity
  if (photo.activity) {
    parts.push(`Activity: ${photo.activity}`);
  }

  // Mood
  if (photo.mood) {
    parts.push(`Mood: ${photo.mood}`);
  }

  // Room/environment details
  if (photo.room_style) {
    parts.push(`Room style: ${photo.room_style}`);
  }

  // Lighting and time
  if (photo.lighting) {
    parts.push(`Lighting: ${photo.lighting}`);
  }

  // Hair
  if (photo.hair_style || photo.hair_color) {
    const hairDesc = [photo.hair_color, photo.hair_style].filter(Boolean).join(' ');
    if (hairDesc) parts.push(`Hair: ${hairDesc}`);
  }

  // AI suggested message (use this as caption hint)
  if (photo.ai_prompt) {
    parts.push(`Suggested caption: "${photo.ai_prompt}"`);
  }

  // Log what we built
  if (parts.length === 0) {
    console.warn('⚠️ No photo context found! Photo ID:', photo.id);
  } else {
    console.log(`📸 Photo context built (${parts.length} details):`, parts.slice(0, 3).join('. ') + '...');
  }

  return parts.join('. ');
}

/**
 * Create AI prompt injection to inform Ellie about the photo
 * Makes photo sending feel NATURAL, not forced
 */
function createPhotoAwarePrompt(photo, triggerType, isMilestone = false) {
  const context = buildPhotoContext(photo);

  // Get location for consistency - try multiple sources
  let location = photo.location;
  if (!location || location === 'somewhere') {
    // Try to extract from category name (e.g., "gym_mirror_selfie" -> "gym")
    const category = (photo.category || '').toLowerCase();
    if (category.includes('gym')) location = 'gym';
    else if (category.includes('bedroom') || category.includes('bed')) location = 'bedroom';
    else if (category.includes('bathroom') || category.includes('mirror')) location = 'bathroom';
    else if (category.includes('kitchen')) location = 'kitchen';
    else if (category.includes('beach') || category.includes('pool')) location = 'beach/pool';
    else if (category.includes('outdoor') || category.includes('outside')) location = 'outside';
    else if (category.includes('office') || category.includes('work')) location = 'work';
    else if (category.includes('car')) location = 'car';
    else location = photo.setting || 'home'; // Default to home, not 'somewhere'
  }
  console.log(`📸 Photo location resolved: "${location}" (from: location=${photo.location}, category=${photo.category}, setting=${photo.setting})`);

  const activity = photo.activity || '';
  const wearing = [];
  if (photo.top_description) wearing.push(photo.top_description);
  else if (photo.top_type) wearing.push(photo.top_type);
  if (photo.bottom_description) wearing.push(photo.bottom_description);
  else if (photo.bottom_type) wearing.push(photo.bottom_type);
  const outfitBrief = wearing.length > 0 ? wearing.join(' and ') : 'casual clothes';

  // Generate natural context based on trigger type and photo content
  let naturalContext = '';
  if (triggerType === 'outfit_mention' || photo.category?.includes('outfit')) {
    naturalContext = 'You want their opinion on your outfit';
  } else if (triggerType === 'flirty' || triggerType === 'intimate') {
    naturalContext = 'You feel flirty and want to tease them';
  } else if (location.includes('gym')) {
    naturalContext = 'You just finished working out and feel good';
  } else if (location.includes('bed') || location.includes('home')) {
    naturalContext = 'You just woke up or are relaxing at home';
  } else if (activity) {
    naturalContext = `You're ${activity} and wanted to share the moment`;
  } else {
    naturalContext = 'You thought of them and wanted to share';
  }

  return `
═══════════════════════════════════════════════════════════════
📸 PHOTO CONTEXT - You're sending a photo naturally
═══════════════════════════════════════════════════════════════

You are at: ${location}
You are wearing: ${outfitBrief}
${activity ? `Doing: ${activity}` : ''}
Why you're sharing: ${naturalContext}

⚠️ IMPORTANT - Make it feel NATURAL:
1. You ARE at ${location} - stay consistent with this location
2. DON'T announce "I'm sending you a pic" awkwardly
3. Instead, share it naturally like:
   - "what do you think of this?" (asking opinion)
   - "me rn 😊" (sharing moment)
   - "how's this look?" (outfit check)
   - "just finished ${activity || 'up'}" (context)
4. Keep it SHORT - 1 sentence max
5. NO asterisks * or (actions)

❌ NEVER say things like:
- "hey, just sent you a pic from..." (too forced)
- "I'm sending you a photo" (awkward)
- Long descriptions of the photo

Your current location: ${location}
═══════════════════════════════════════════════════════════════
`;
}

// ============================================================
// RECORD KEEPING
// ============================================================

async function recordPhotoSent(pool, userId, photoId, context) {
  try {
    await pool.query(
      `INSERT INTO user_photo_history (user_id, photo_id, context, sent_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, photo_id) DO UPDATE SET sent_at = NOW()`,
      [userId, photoId, context]
    );
  } catch (error) {
    console.error('❌ Error recording photo history:', error);
  }
}

// ============================================================
// LOCATION CONSISTENCY CHECK
// ============================================================

/**
 * Extract Ellie's recently stated location from conversation history
 * Returns null if no recent location mentioned, or the location string
 */
async function getRecentStatedLocation(pool, userId) {
  try {
    // Get Ellie's messages from the last 30 minutes
    const { rows } = await pool.query(
      `SELECT content FROM conversation_history
       WHERE user_id = $1
       AND role = 'assistant'
       AND created_at > NOW() - INTERVAL '30 minutes'
       ORDER BY created_at DESC
       LIMIT 10`,
      [userId]
    );

    if (!rows.length) return null;

    // Location keywords to search for
    const locationPatterns = [
      { pattern: /\b(at home|at my place|in my apartment|in my room|my place)\b/i, location: 'home' },
      { pattern: /\b(at the gym|at gym|working out|at the fitness)\b/i, location: 'gym' },
      { pattern: /\b(at work|at the office|in the office)\b/i, location: 'work' },
      { pattern: /\b(in bed|in my bed|lying in bed)\b/i, location: 'bedroom' },
      { pattern: /\b(in the bathroom|in my bathroom|taking a shower|in the shower)\b/i, location: 'bathroom' },
      { pattern: /\b(at a cafe|at the cafe|coffee shop|at starbucks)\b/i, location: 'cafe' },
      { pattern: /\b(outside|at the park|walking|on a walk)\b/i, location: 'outside' },
      { pattern: /\b(at a bar|at the bar|at a club|clubbing)\b/i, location: 'bar' },
      { pattern: /\b(at the beach|on the beach)\b/i, location: 'beach' },
      { pattern: /\b(in the kitchen|cooking|making food)\b/i, location: 'kitchen' },
      { pattern: /\b(in the living room|on the couch|watching tv)\b/i, location: 'living room' },
      { pattern: /\b(just woke up|waking up|still in bed)\b/i, location: 'bedroom' },
    ];

    // Check recent messages for location mentions
    for (const row of rows) {
      const content = row.content.toLowerCase();
      for (const { pattern, location } of locationPatterns) {
        if (pattern.test(content)) {
          console.log(`📍 Found recent stated location: "${location}" in message: "${content.substring(0, 50)}..."`);
          return location;
        }
      }
    }

    return null;
  } catch (error) {
    console.error('❌ Error checking recent location:', error);
    return null;
  }
}

/**
 * Map photo locations to standardized location names
 */
function normalizePhotoLocation(photoLocation) {
  if (!photoLocation) return null;
  const loc = photoLocation.toLowerCase();

  if (loc.includes('gym') || loc.includes('fitness')) return 'gym';
  if (loc.includes('bedroom') || loc.includes('bed')) return 'bedroom';
  if (loc.includes('bathroom') || loc.includes('shower')) return 'bathroom';
  if (loc.includes('kitchen')) return 'kitchen';
  if (loc.includes('living') || loc.includes('couch')) return 'living room';
  if (loc.includes('office') || loc.includes('work')) return 'work';
  if (loc.includes('outside') || loc.includes('park') || loc.includes('street')) return 'outside';
  if (loc.includes('beach')) return 'beach';
  if (loc.includes('bar') || loc.includes('club')) return 'bar';
  if (loc.includes('cafe') || loc.includes('coffee')) return 'cafe';
  if (loc.includes('home') || loc.includes('apartment') || loc.includes('house')) return 'home';

  return loc; // Return as-is if no match
}

/**
 * Check if photo location is compatible with stated location
 */
function isLocationCompatible(photoLocation, statedLocation) {
  if (!statedLocation || !photoLocation) return true; // No constraint

  const normalizedPhoto = normalizePhotoLocation(photoLocation);
  const normalizedStated = statedLocation.toLowerCase();

  // Direct match
  if (normalizedPhoto === normalizedStated) return true;

  // Home includes bedroom, living room, kitchen, bathroom
  if (normalizedStated === 'home' && ['bedroom', 'living room', 'kitchen', 'bathroom'].includes(normalizedPhoto)) {
    return true;
  }

  // Bedroom is compatible with "just woke up" / home context
  if (normalizedStated === 'bedroom' && normalizedPhoto === 'home') return true;

  return false;
}

// ============================================================
// MAIN ENTRY POINT - Called BEFORE AI generates response
// ============================================================

/**
 * Prepare photo for sending - called BEFORE generating AI response
 * Returns photo data and prompt injection for AI context
 */
async function preparePhotoForMessage(pool, userId, conversationContext) {
  try {
    const decision = await shouldSendPhoto(pool, userId, conversationContext);

    if (!decision.shouldSend) {
      return null;
    }

    console.log(`📸 Photo trigger for user ${userId}: ${decision.triggerType || decision.reason}`);

    let photo;

    // 🔥 SPECIAL OVERRIDE: Use the pre-selected special photo
    if (decision.isSpecialOverride && decision.specialPhoto) {
      photo = decision.specialPhoto;
      console.log(`🔥 Using SPECIAL OVERRIDE photo: ${photo.url}`);
    } else {
      // 🎯 CHECK LOCATION CONSISTENCY - Don't send gym photo if she just said she's at home
      const recentLocation = await getRecentStatedLocation(pool, userId);
      if (recentLocation) {
        console.log(`📍 Ellie recently stated she's at: ${recentLocation}`);
      }

      const relationshipLevel = conversationContext.relationship?.relationship_level || 0;

      // Select contextually appropriate photo (with location filter if needed)
      photo = await selectContextualPhoto(pool, userId, decision, relationshipLevel, recentLocation);
    }

    if (!photo) {
      console.log(`⚠️ No suitable photo found for user ${userId}`);
      return null;
    }

    // Record that we're sending this photo
    await recordPhotoSent(pool, userId, photo.id, conversationContext.userMessage || decision.reason);

    console.log(`✅ Prepared photo ${photo.id} (${photo.category}, nsfw:${photo.nsfw_level}) for user ${userId}`);

    // 🔥 Special followup gets a simple AI prompt - just "how's this one" type response
    let aiPromptInjection;
    if (decision.isSpecialOverride) {
      aiPromptInjection = `
═══════════════════════════════════════════════════════════════
📸 SPECIAL PHOTO - You're sending a follow-up photo they requested
═══════════════════════════════════════════════════════════════

The user asked for another photo or asked you to show more. You're sending them this one.

⚠️ Keep your response VERY SHORT and natural:
- "how's this one?"
- "better? 😏"
- "what do you think?"
- "there you go"
- "happy now? 😊"

❌ DO NOT:
- Describe the photo
- Make it awkward
- Say "here's another" or "sending another"

Just a SHORT, natural response. 1-3 words is perfect.
═══════════════════════════════════════════════════════════════
`;
    } else {
      // Normal photo prompt
      aiPromptInjection = createPhotoAwarePrompt(
        photo,
        decision.triggerType || 'spontaneous',
        decision.isMilestone || false
      );
    }

    return {
      photo: {
        id: photo.id,
        url: photo.url,
        category: photo.category,
        mood: photo.mood,
        activity: photo.activity,
        setting: photo.setting,
        outfit: photo.outfit,
        description: photo.description,
        nsfwLevel: photo.nsfw_level
      },
      aiPromptInjection: aiPromptInjection,
      triggerType: decision.triggerType || decision.reason,
      isMilestone: decision.isMilestone || false,
      isSpecialOverride: decision.isSpecialOverride || false,
      photoContext: buildPhotoContext(photo)
    };

  } catch (error) {
    console.error('❌ Error in preparePhotoForMessage:', error);
    return null;
  }
}

// Legacy function for backwards compatibility
async function handlePhotoSending(pool, userId, conversationContext) {
  const result = await preparePhotoForMessage(pool, userId, conversationContext);
  if (!result) return null;

  return {
    photoUrl: result.photo.url,
    message: '', // Message will come from AI now
    photoId: result.photo.id,
    category: result.photo.category,
    mood: result.photo.mood,
    activity: result.photo.activity,
    isMilestone: result.isMilestone
  };
}

module.exports = {
  detectPhotoRequest,
  generatePhotoRequestRefusal,
  shouldSendPhoto,
  handlePhotoSending,
  preparePhotoForMessage,  // NEW: Main entry point
  selectContextualPhoto,   // NEW: Context-aware selection
  buildPhotoContext,       // NEW: Rich metadata string
  createPhotoAwarePrompt,  // NEW: AI prompt injection
  extractConversationTopics, // NEW: Topic extraction
  recordPhotoSent
};
