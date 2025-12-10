// photoManager.js - Context-Aware Photo System for Ellie
// UPDATED: Fixed location consistency (4h lookback) + Strict anti-conflict filtering

const { Pool } = require('pg');

// ============================================================
// TOPIC DETECTION - Analyze conversation for relevant themes
// ============================================================

function extractConversationTopics(userMessage, ellieResponse = '') {
  const combined = `${userMessage} ${ellieResponse}`.toLowerCase();
  const topics = [];

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

  const moodPatterns = {
    flirty: /\b(flirt|tease|cute|hot|sexy|attractive|beautiful|gorgeous)\b/,
    playful: /\b(fun|funny|silly|playful|laugh|joke)\b/,
    romantic: /\b(love|miss|romantic|sweet|heart|feel|care)\b/,
    confident: /\b(confident|strong|power|boss|queen|slay)\b/,
    cozy: /\b(cozy|warm|comfy|soft|cuddle|snuggle)\b/,
  };

  const settingPatterns = {
    bedroom: /\b(bed|bedroom|pillow|sheets|mattress)\b/,
    bathroom: /\b(bath|bathroom|shower|mirror|towel)\b/,
    outdoor: /\b(outside|outdoor|park|street|walk|nature)\b/,
    kitchen: /\b(kitchen|cooking|food|eating|dinner|lunch)\b/,
    work: /\b(work|office|desk|meeting|boss|colleague)\b/,
    gym: /\b(gym|locker room)\b/
  };

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

function detectPhotoRequest(userMessage) {
  const msg = userMessage.toLowerCase();
  const requestPatterns = [
    /send (me )?(a )?photo/, /show (me )?(a )?pic/, /what (do )?you look like/,
    /can i see you/, /share (a )?photo/, /send (me )?(a )?selfie/,
    /pic of you/, /photo of you/, /see (a )?photo/, /wanna see you/,
    /want to see you/,
  ];
  return requestPatterns.some(pattern => pattern.test(msg));
}

function generatePhotoRequestRefusal(relationshipStage, messagesCount) {
  const responses = {
    STRANGER: [
      "Haha nice try! Maybe when we actually know each other",
      "We literally just started talking... let's chat first?",
      "Wow, straight to asking for photos? Smooth",
      "Getting a bit ahead of yourself there, aren't you?",
    ],
    FRIEND: [
      "If you're going to nag, you don't get anything",
      "I'll send photos when I feel like it, not when you demand them",
      "You can't just ask for them! Where's the fun in that?",
    ],
    DATING: [
      "You're so impatient! I'll send one when the moment feels right",
      "If you're going to be pushy about it, you're not getting any",
      "I like when things happen naturally... not when you demand them",
    ],
    COMMITTED: [
      "Baby, you know I don't like when you beg",
      "I send them when I want to, not when you demand them!",
    ],
    EXCLUSIVE: [
      "You know I hate when you're pushy about this",
      "I'll send you whatever you want... when I feel like it, not when you demand it",
    ]
  };
  const stageResponses = responses[relationshipStage] || responses.STRANGER;
  return stageResponses[Math.floor(Math.random() * stageResponses.length)];
}

// ============================================================
// PHOTO DECISION LOGIC
// ============================================================

const SPECIAL_FOLLOWUP_PHOTO = '00132-3121187385.png';

async function checkSpecialFollowupPhoto(pool, userId, userMessage, conversationContext) {
  try {
    const msg = userMessage.toLowerCase();
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
    ];

    const isAskingForMore = followupPatterns.some(pattern => pattern.test(msg));
    if (!isAskingForMore) return { shouldSend: false, reason: 'not_asking_for_more' };

    const recentPhoto = await pool.query(
      `SELECT sent_at FROM user_photo_history WHERE user_id = $1 ORDER BY sent_at DESC LIMIT 1`,
      [userId]
    );

    if (recentPhoto.rows.length === 0) return { shouldSend: false, reason: 'no_previous_photo' };

    const lastPhotoTime = new Date(recentPhoto.rows[0].sent_at);
    if ((Date.now() - lastPhotoTime) / (1000 * 60 * 60) > 1) return { shouldSend: false, reason: 'photo_too_old' };

    const specialPhotoCheck = await pool.query(
      `SELECT uph.* FROM user_photo_history uph JOIN ellie_photos ep ON uph.photo_id = ep.id
       WHERE uph.user_id = $1 AND ep.url LIKE $2`,
      [userId, `%${SPECIAL_FOLLOWUP_PHOTO}%`]
    );

    if (specialPhotoCheck.rows.length > 0) return { shouldSend: false, reason: 'special_already_sent' };

    const specialPhoto = await pool.query(
      `SELECT * FROM ellie_photos WHERE url LIKE $1 AND is_active = true`,
      [`%${SPECIAL_FOLLOWUP_PHOTO}%`]
    );

    if (specialPhoto.rows.length === 0) return { shouldSend: false, reason: 'special_photo_not_found' };

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

async function checkStrangerMilestone(pool, userId, relationship) {
  try {
    if (relationship.current_stage !== 'STRANGER') return { shouldSend: false, reason: 'not_stranger' };
    if ((relationship.total_interactions || 0) < 15) return { shouldSend: false, reason: 'milestone_not_reached' };

    const photoHistory = await pool.query(`SELECT COUNT(*) as count FROM user_photo_history WHERE user_id = $1`, [userId]);
    if (parseInt(photoHistory.rows[0].count) > 0) return { shouldSend: false, reason: 'milestone_already_claimed' };

    return { shouldSend: true, reason: 'stranger_milestone', categories: ['casual', 'friendly'], isMilestone: true };
  } catch (error) {
    return { shouldSend: false, reason: 'error' };
  }
}

async function shouldSendPhoto(pool, userId, conversationContext) {
  try {
    const relationship = conversationContext.relationship;
    const userMessage = conversationContext.userMessage || '';
    const currentStage = relationship.current_stage || 'STRANGER';

    // 0. Special Override
    const specialFollowup = await checkSpecialFollowupPhoto(pool, userId, userMessage, conversationContext);
    if (specialFollowup.shouldSend) return specialFollowup;

    // 1. Stranger Milestone
    const milestone = await checkStrangerMilestone(pool, userId, relationship);
    if (milestone.shouldSend) return milestone;

    if (currentStage === 'STRANGER') return { shouldSend: false, reason: 'stranger_no_photos' };

    // Direct photo requests - EXCLUSIVE stage complies, others ignore
    const isDirectRequest = detectPhotoRequest(userMessage.toLowerCase());
    if (isDirectRequest) {
      if (currentStage === 'EXCLUSIVE') {
        // Boyfriend asked, girlfriend sends
        console.log(`📸 Direct photo request in EXCLUSIVE stage - complying`);
        return {
          shouldSend: true,
          triggerType: 'direct_request_exclusive',
          categories: null, // Any category is fine
          nsfwAllowed: true,
          preferHighNsfw: true,
          preferSexyContent: true,
          isMilestone: false
        };
      }
      // Other stages ignore direct requests
      return { shouldSend: false, reason: 'direct_request_ignored' };
    }

    // 2. Session Limits
    const askingForMorePatterns = [/\b(another|more|one more|next|again)\b.*\b(pic|photo|picture|selfie)\b/i];
    const isAskingForMore = askingForMorePatterns.some(pattern => pattern.test(userMessage));

    const sessionCapsByStage = { FRIEND_TENSION: 3, COMPLICATED: 5, EXCLUSIVE: 8 };
    const sessionCap = sessionCapsByStage[currentStage] ?? 1;

    const sessionPhotosQuery = await pool.query(
      `SELECT COUNT(*) as count FROM user_photo_history WHERE user_id = $1 AND sent_at > NOW() - INTERVAL '3 hours'`,
      [userId]
    );
    const photosInSession = parseInt(sessionPhotosQuery.rows[0]?.count || 0);

    const lastPhotoQuery = await pool.query(
      `SELECT sent_at FROM user_photo_history WHERE user_id = $1 ORDER BY sent_at DESC LIMIT 1`,
      [userId]
    );
    const hasRecentPhoto = lastPhotoQuery.rows.length > 0 &&
      ((Date.now() - new Date(lastPhotoQuery.rows[0].sent_at)) / (1000 * 60 * 60)) < 1;

    if (isAskingForMore && hasRecentPhoto) {
      if (photosInSession >= sessionCap) return { shouldSend: false, reason: 'session_cap_reached' };

      let nsfwAllowed = false;
      let categories = ['casual', 'work', 'gym'];
      if (currentStage === 'COMPLICATED') {
        nsfwAllowed = true;
        categories = ['teasing', 'flirty', 'suggestive', 'work', 'gym'];
      } else if (currentStage === 'EXCLUSIVE') {
        nsfwAllowed = true;
        categories = null;
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

    if ((relationship.total_interactions || 0) < 5) return { shouldSend: false, reason: 'too_early' };
    if (photosInSession > 0) return { shouldSend: false, reason: 'must_ask_for_more' };

    // 3. Stage Triggers
    if (currentStage === 'FRIEND_TENSION') {
      const isWorkGym = /\b(gym|workout|work|office)\b/i.test(userMessage);
      if (isWorkGym && Math.random() < 0.35) {
        return { shouldSend: true, triggerType: 'work_gym_context', categories: ['work', 'gym', 'casual'], nsfwAllowed: false };
      }
    }

    if (currentStage === 'COMPLICATED') {
      const isTeasing = /\b(hot|sexy|miss you)\b/i.test(userMessage);
      const isWorkGym = /\b(gym|workout|work|office)\b/i.test(userMessage);
      if ((isTeasing || isWorkGym) && Math.random() < 0.45) {
        return {
          shouldSend: true,
          triggerType: isTeasing ? 'teasing_context' : 'work_gym_context',
          categories: ['teasing', 'flirty', 'work', 'gym'],
          nsfwAllowed: true,
          preferSexyContent: true
        };
      }
    }

    if (currentStage === 'EXCLUSIVE') {
      const isSexual = /\b(horny|sex|wet)\b/i.test(userMessage);
      if (Math.random() < (isSexual ? 0.60 : 0.25)) {
        return {
          shouldSend: true,
          triggerType: isSexual ? 'sexual_context' : 'random_exclusive',
          categories: null,
          nsfwAllowed: true,
          preferHighNsfw: isSexual,
          preferSexyContent: true
        };
      }
    }

    return { shouldSend: false, reason: 'no_trigger' };
  } catch (error) {
    console.error('❌ Error in shouldSendPhoto:', error);
    return { shouldSend: false, reason: 'error' };
  }
}

// ============================================================
// CONTEXT-AWARE PHOTO SELECTION (STRICT CONSISTENCY)
// ============================================================

async function selectContextualPhoto(pool, userId, criteria, relationshipLevel = 0, recentLocation = null) {
  try {
    const { categories, topics, nsfwAllowed, preferHighNsfw, preferSexyContent } = criteria;
    const maxNsfwLevel = nsfwAllowed ? (preferHighNsfw ? 5 : 2) : 0;
    const minNsfwLevel = preferHighNsfw ? 2 : 0;

    // ⛔ ANTI-CONFLICT FILTERING: Explicitly exclude clashing categories
    let negativeCategoryFilter = '';
    if (recentLocation === 'work') {
      // If at work, NEVER send gym, bed, bathroom, or beach photos
      negativeCategoryFilter = "AND p.category NOT IN ('gym', 'bedroom', 'bed', 'bathroom', 'shower', 'beach', 'pool')";
    } else if (recentLocation === 'gym') {
      negativeCategoryFilter = "AND p.category NOT IN ('work', 'office', 'bed', 'bedroom')";
    } else if (recentLocation === 'bedroom' || recentLocation === 'home') {
      negativeCategoryFilter = "AND p.category NOT IN ('work', 'office', 'gym')";
    }

    // 📍 POSITIVE LOCATION FILTER
    let locationFilter = '';
    let locationValues = [];
    let locationParamStart = 5;

    if (recentLocation) {
      const compatibleLocations = getCompatiblePhotoLocations(recentLocation);
      if (compatibleLocations.length > 0) {
        // Match explicit location tags
        locationFilter = `AND (${compatibleLocations.map((_, i) => `LOWER(p.location) LIKE $${locationParamStart + i}`).join(' OR ')})`;
        locationValues = compatibleLocations.map(loc => `%${loc}%`);
        console.log(`📍 Filtering photos for location "${recentLocation}" -> compatible: [${compatibleLocations.join(', ')}]`);
        console.log(`📍 Location filter SQL: ${locationFilter}`);
        console.log(`📍 Location values: ${JSON.stringify(locationValues)}`);
      }
    }

    // Base query parts
    const baseWhere = `
      p.is_active = true
      AND p.nsfw_level >= $1 AND p.nsfw_level <= $2
      AND (p.min_relationship_level IS NULL OR p.min_relationship_level <= $3)
      AND p.id NOT IN (SELECT photo_id FROM user_photo_history WHERE user_id = $4)
      ${negativeCategoryFilter}
    `;
    const baseParams = [minNsfwLevel, maxNsfwLevel, relationshipLevel, userId];

    // 1. Try Topic Match (Highest Precision)
    if (topics && topics.length > 0) {
      let topicConditions = [];
      let topicValues = [];
      let paramIdx = baseParams.length + locationValues.length + 1;

      for (const topic of topics) {
        if (topic.type === 'activity' || topic.type === 'setting') {
          topicConditions.push(`(LOWER(p.activity) LIKE $${paramIdx} OR LOWER(p.category) LIKE $${paramIdx} OR LOWER(p.location) LIKE $${paramIdx})`);
          topicValues.push(`%${topic.value}%`);
          paramIdx++;
        }
      }

      if (topicConditions.length > 0) {
        const query = `
          SELECT p.* FROM ellie_photos p
          WHERE ${baseWhere}
          ${locationFilter}
          AND (${topicConditions.join(' OR ')})
          ORDER BY RANDOM() LIMIT 1
        `;
        const params = [...baseParams, ...locationValues, ...topicValues];
        const res = await pool.query(query, params);
        if (res.rows.length > 0) {
          console.log(`📸 Found topic-matched photo for ${userId}`);
          return res.rows[0];
        }
      }
    }

    // 2. Try Category Match (if provided)
    if (categories) {
      const query = `
        SELECT p.* FROM ellie_photos p
        WHERE ${baseWhere}
        ${locationFilter}
        AND p.category = ANY($${baseParams.length + locationValues.length + 1})
        ORDER BY RANDOM() LIMIT 1
      `;
      const params = [...baseParams, ...locationValues, categories];
      const res = await pool.query(query, params);
      if (res.rows.length > 0) {
        console.log(`📸 Found category-matched photo for ${userId}`);
        return res.rows[0];
      }
    }

    // ⛔ CRITICAL: If location is strict, DO NOT FALL BACK to random photos
    // If we are at 'work' and found no 'work' photos, returning a random 'bed' photo is bad.
    if (recentLocation && locationValues.length > 0) {
      // Debug: Check what photos exist with this location
      const debugQuery = `SELECT id, location, category, nsfw_level FROM ellie_photos WHERE is_active = true LIMIT 20`;
      const debugRes = await pool.query(debugQuery);
      console.log(`📍 [DEBUG] Available photos in DB:`, debugRes.rows.map(r => `${r.id}: loc=${r.location}, cat=${r.category}, nsfw=${r.nsfw_level}`));
      console.log(`📍 No photos matched strict location "${recentLocation}" - sending NO photo to preserve immersion.`);
      return null;
    }

    // 3. Fallback: Any valid photo (only if no location constraint active)
    console.log(`⚠️ No specific match, selecting random valid photo`);
    const anyQuery = `
      SELECT p.* FROM ellie_photos p
      WHERE ${baseWhere}
      ORDER BY RANDOM() LIMIT 1
    `;
    const res = await pool.query(anyQuery, baseParams);

    return res.rows[0] || null;

  } catch (error) {
    console.error('❌ Error selecting contextual photo:', error);
    return null;
  }
}

// ============================================================
// LOCATION CONSISTENCY CHECK - IMPROVED
// ============================================================

async function getRecentStatedLocation(pool, userId) {
  try {
    // ⬆️ UPDATED: Look back 4 hours and 50 messages
    // 🔧 FIX: Check ONLY Ellie's (assistant) messages + her photo_context for location consistency
    const { rows } = await pool.query(
      `SELECT content, photo_context FROM conversation_history
       WHERE user_id = $1
       AND role = 'assistant'
       AND created_at > NOW() - INTERVAL '4 hours'
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    if (!rows.length) return null;

    // 📸 PRIORITY 1: Check photo_context FIRST (most accurate - where photo was taken)
    // This is the most reliable source since it's metadata from the actual photo
    const photoLocationPatterns = [
      { pattern: /location[^:]*:\s*(home|apartment|house)/i, location: 'home' },
      { pattern: /location[^:]*:\s*(gym|fitness)/i, location: 'gym' },
      { pattern: /location[^:]*:\s*(office|work|desk)/i, location: 'work' },
      { pattern: /location[^:]*:\s*(bedroom|bed)/i, location: 'bedroom' },
      { pattern: /location[^:]*:\s*(bathroom|shower)/i, location: 'bathroom' },
      { pattern: /location[^:]*:\s*(cafe|coffee)/i, location: 'cafe' },
      { pattern: /location[^:]*:\s*(outside|park|street)/i, location: 'outside' },
      { pattern: /location[^:]*:\s*(car)/i, location: 'car' },
    ];

    // Check most recent photo first for location
    for (const row of rows) {
      if (row.photo_context) {
        for (const { pattern, location } of photoLocationPatterns) {
          if (pattern.test(row.photo_context)) {
            console.log(`📍 Detected Ellie's location: "${location}" from her recent photo`);
            return location;
          }
        }
      }
    }

    // PRIORITY 2: Check Ellie's text messages for location statements
    const locationPatterns = [
      { pattern: /\b(at home|at my place|in my apartment|in my room)\b/i, location: 'home' },
      { pattern: /\b(at the gym|at gym|working out|hitting the gym)\b/i, location: 'gym' },
      { pattern: /\b(at work|at the office|in the office|stuck at work|heading to work)\b/i, location: 'work' },
      { pattern: /\b(in bed|in my bed|lying in bed|woke up)\b/i, location: 'bedroom' },
      { pattern: /\b(taking a shower|in the shower|bath)\b/i, location: 'bathroom' },
      { pattern: /\b(at a cafe|coffee shop|starbucks)\b/i, location: 'cafe' },
      { pattern: /\b(walking|outside|park|stroll)\b/i, location: 'outside' },
      { pattern: /\b(driving|in the car|traffic)\b/i, location: 'car' },
    ];

    for (const row of rows) {
      const content = row.content.toLowerCase();
      for (const { pattern, location } of locationPatterns) {
        if (pattern.test(content)) {
          console.log(`📍 Detected Ellie's location: "${location}" from her message`);
          return location;
        }
      }
    }

    console.log(`📍 [DEBUG] No location detected for Ellie in last 50 messages`);
    return null;
  } catch (error) {
    console.error('❌ Error checking recent location:', error);
    return null;
  }
}

function getCompatiblePhotoLocations(statedLocation) {
  const loc = statedLocation.toLowerCase();
  const locationMap = {
    'home': ['bedroom', 'bathroom', 'kitchen', 'living', 'couch', 'bed', 'home', 'apartment', 'house'],
    'bedroom': ['bedroom', 'bed', 'room', 'sheets'],
    'bathroom': ['bathroom', 'shower', 'mirror'],
    'kitchen': ['kitchen', 'cooking'],
    'gym': ['gym', 'fitness', 'workout'],
    'work': ['office', 'work', 'desk'],
    'outside': ['outside', 'park', 'street', 'nature', 'car'],
    'car': ['car', 'driving'],
    'cafe': ['cafe', 'coffee', 'restaurant'],
  };
  return locationMap[loc] || [loc];
}

function buildPhotoContext(photo) {
  if (!photo) return null;
  const parts = [];
  if (photo.description) parts.push(`Photo shows: ${photo.description}`);

  let locationStr = photo.location || photo.setting || photo.category || 'somewhere';
  parts.push(`Location in photo: ${locationStr}`);

  if (photo.top_description || photo.top_type) parts.push(`Wearing: ${photo.top_description || photo.top_type}`);
  if (photo.pose_type) parts.push(`Pose: ${photo.pose_type}`);
  if (photo.activity) parts.push(`Action: ${photo.activity}`);

  return parts.join('. ');
}

function createPhotoAwarePrompt(photo, triggerType, isMilestone = false) {
  const context = buildPhotoContext(photo);
  const location = photo.location || photo.setting || 'unknown';

  return `
═══════════════════════════════════════════════════════════════
📸 PHOTO AWARENESS - YOU ARE SENDING A PHOTO
═══════════════════════════════════════════════════════════════

You are currently sending the photo described below.
Your text MUST match the content of this photo.

👀 PHOTO DETAILS:
${context}

⚠️ INSTRUCTIONS:
1. Acknowledge what is in the photo (e.g., if holding coffee, mention the coffee).
2. Be consistent with the location: You are at ${location}.
3. Keep the caption short and natural (e.g., "Thoughts?" or "Look what I'm doing").
4. Do NOT say "I am sending a photo". Just send it like a real person sharing a moment.

═══════════════════════════════════════════════════════════════
`;
}

async function preparePhotoForMessage(pool, userId, conversationContext) {
  try {
    const decision = await shouldSendPhoto(pool, userId, conversationContext);
    if (!decision.shouldSend) return null;

    let photo;
    if (decision.isSpecialOverride && decision.specialPhoto) {
      photo = decision.specialPhoto;
    } else {
      const recentLocation = await getRecentStatedLocation(pool, userId);
      const relationshipLevel = conversationContext.relationship?.relationship_level || 0;
      photo = await selectContextualPhoto(pool, userId, decision, relationshipLevel, recentLocation);
    }

    if (!photo) return null;

    await recordPhotoSent(pool, userId, photo.id, decision.triggerType || decision.reason);

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
      aiPromptInjection: createPhotoAwarePrompt(photo, decision.triggerType),
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

module.exports = {
  detectPhotoRequest,
  generatePhotoRequestRefusal,
  shouldSendPhoto,
  preparePhotoForMessage,
  selectContextualPhoto,
  buildPhotoContext,
  createPhotoAwarePrompt,
  extractConversationTopics,
  recordPhotoSent
};
