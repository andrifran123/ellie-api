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
    const userMessage = conversationContext.userMessage?.toLowerCase() || '';

    console.log(`📸 [DEBUG] shouldSendPhoto called for ${userId}: stage=${relationship?.current_stage}, msgs=${relationship?.total_interactions}`);

    // PRIORITY 1: Check stranger milestone
    const milestone = await checkStrangerMilestone(pool, userId, relationship);
    console.log(`📸 [DEBUG] Milestone check result:`, JSON.stringify(milestone));
    if (milestone.shouldSend) {
      return milestone;
    }

    // IGNORE DIRECT REQUESTS (handled with refusals)
    if (detectPhotoRequest(userMessage)) {
      return { shouldSend: false, reason: 'direct_request_ignored' };
    }

    // Check daily limit
    const lastPhotoQuery = await pool.query(
      `SELECT sent_at FROM user_photo_history
       WHERE user_id = $1 ORDER BY sent_at DESC LIMIT 1`,
      [userId]
    );

    if (lastPhotoQuery.rows.length > 0) {
      const lastPhoto = lastPhotoQuery.rows[0].sent_at;
      const hoursSinceLastPhoto = (Date.now() - new Date(lastPhoto)) / (1000 * 60 * 60);
      if (hoursSinceLastPhoto < 20) {
        return { shouldSend: false, reason: 'daily_limit' };
      }
    }

    // Minimum messages requirement
    const messagesCount = relationship.total_interactions || 0;
    if (relationship.current_stage === 'STRANGER' && messagesCount < 20) {
      return { shouldSend: false, reason: 'too_early' };
    }

    // Extract conversation topics for context-aware selection
    const topics = extractConversationTopics(userMessage, conversationContext.ellieResponse || '');

    // Contextual triggers based on conversation
    // Lower chances = more human-like, not every request gets a photo
    const triggers = {
      activity_her: {
        patterns: [
          /just (woke up|got up|finished)/,
          /(done with|finished) (workout|gym)/,
          /getting ready/,
          /just took a/,
        ],
        chance: 0.20,  // Lowered - she doesn't always share
      },
      activity_user: {
        patterns: [
          /what are you up to/,
          /what are you doing/,
          /how('s| is) your (day|morning)/,
        ],
        chance: 0.15,  // Lowered - rare to send pic just for this
      },
      flirt_response: {
        patterns: [
          /you('re| are) (so )?(hot|beautiful|gorgeous|sexy|cute|pretty)/,
          /(love|like|miss) you/,
          /thinking (about|of) you/,
        ],
        chance: 0.25,  // Lowered - not always rewarding compliments
      },
      // Indirect requests - still higher but not guaranteed
      indirect_tease: {
        patterns: [
          /i bet you look/i,
          /you must look/i,
          /wish i could see what you/i,
          /what are you wearing/i,
          /describe yourself/i,
          /paint me a picture/i,
          /prove it/i,
        ],
        chance: 0.45,  // Lowered from 85% - she's not always in the mood
      },
      conversation_flow: {
        chance: 0.12,  // Lowered - rare natural photo shares
        requiresGoodConversation: true
      },
      // Spontaneous DISABLED - photos should only come when contextually appropriate
      // spontaneous: {
      //   chance: 0.12,
      // }
    };

    // Determine photo categories based on relationship stage
    const stage = relationship.current_stage;
    const categoryMap = {
      STRANGER: ['casual', 'friendly'],
      FRIEND: ['casual', 'playful'],
      FRIEND_TENSION: ['casual', 'playful', 'flirty'],
      DATING: ['playful', 'flirty', 'cute'],
      COMPLICATED: ['flirty', 'suggestive', 'intimate'],
      COMMITTED: ['flirty', 'romantic', 'intimate'],
      EXCLUSIVE: ['intimate', 'romantic', 'suggestive']
    };

    // Check triggers - ONLY send photos when there's a natural reason
    for (const [triggerType, config] of Object.entries(triggers)) {
      let triggered = false;

      // REMOVED: spontaneous trigger - was too random and felt unnatural
      if (triggerType === 'conversation_flow') {
        // Only after 6+ messages AND good conversation flow
        const recentMessageCount = conversationContext.recentMessageCount || 0;
        triggered = recentMessageCount >= 6 && Math.random() < config.chance;
      } else if (config.patterns) {
        const hasMatch = config.patterns.some(pattern => pattern.test(userMessage));
        triggered = hasMatch && Math.random() < config.chance;
      }

      if (triggered) {
        return {
          shouldSend: true,
          triggerType,
          categories: categoryMap[stage] || ['casual'],
          topics: topics,
          nsfwAllowed: stage !== 'STRANGER',
          isMilestone: false
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
    const { categories, topics, nsfwAllowed } = criteria;

    const maxNsfwLevel = nsfwAllowed ?
      (categories.includes('intimate') || categories.includes('suggestive') ? 2 : 1) : 0;

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

    // First try: Match topic-relevant photos with location filter
    if (topicConditions.length > 0) {
      const topicQuery = `
        SELECT p.* FROM ellie_photos p
        WHERE p.is_active = true
        AND p.category = ANY($1)
        AND p.nsfw_level <= $2
        AND (p.min_relationship_level IS NULL OR p.min_relationship_level <= $3)
        AND p.id NOT IN (SELECT photo_id FROM user_photo_history WHERE user_id = $4)
        ${locationFilter}
        AND (${topicConditions.join(' OR ')})
        ORDER BY RANDOM()
        LIMIT 1
      `;

      const topicResult = await pool.query(
        topicQuery,
        [categories, maxNsfwLevel, relationshipLevel, userId, ...locationValues, ...topicValues]
      );

      if (topicResult.rows.length > 0) {
        console.log(`📸 Found topic-matching photo for topics: ${topics.map(t => t.value).join(', ')}`);
        return topicResult.rows[0];
      }
    }

    // Second try: Any matching category with location filter
    const categoryQuery = await pool.query(
      `SELECT p.* FROM ellie_photos p
       WHERE p.is_active = true
       AND p.category = ANY($1)
       AND p.nsfw_level <= $2
       AND (p.min_relationship_level IS NULL OR p.min_relationship_level <= $3)
       AND p.id NOT IN (SELECT photo_id FROM user_photo_history WHERE user_id = $4)
       ${locationFilter}
       ORDER BY RANDOM()
       LIMIT 1`,
      [categories, maxNsfwLevel, relationshipLevel, userId, ...locationValues]
    );

    if (categoryQuery.rows.length > 0) {
      return categoryQuery.rows[0];
    }

    // If we have a location filter and found nothing, DON'T send a photo at all
    // Better to not send than to break immersion with wrong location
    if (recentLocation && locationValues.length > 0) {
      console.log(`📍 No photos found matching location "${recentLocation}" - skipping photo to maintain consistency`);
      return null;
    }

    // Third try: Allow repeats (only if no location constraint)
    const repeatQuery = await pool.query(
      `SELECT p.* FROM ellie_photos p
       WHERE p.is_active = true
       AND p.category = ANY($1)
       AND p.nsfw_level <= $2
       AND (p.min_relationship_level IS NULL OR p.min_relationship_level <= $3)
       ORDER BY RANDOM()
       LIMIT 1`,
      [categories, maxNsfwLevel, relationshipLevel]
    );

    if (repeatQuery.rows.length > 0) {
      return repeatQuery.rows[0];
    }

    // Last resort: Any active photo (only if no location constraint)
    console.log(`⚠️ No photos found for categories ${categories}, trying any active photo`);
    const anyQuery = await pool.query(
      `SELECT p.* FROM ellie_photos p
       WHERE p.is_active = true AND p.nsfw_level <= $1
       ORDER BY RANDOM() LIMIT 1`,
      [maxNsfwLevel]
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

  // Location and setting
  if (photo.location) {
    let locationStr = photo.location;
    if (photo.sub_location) locationStr += ` (${photo.sub_location})`;
    parts.push(`Location: ${locationStr}`);
  }

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

  // Get location for consistency
  const location = photo.location || 'somewhere';
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

    // 🎯 CHECK LOCATION CONSISTENCY - Don't send gym photo if she just said she's at home
    const recentLocation = await getRecentStatedLocation(pool, userId);
    if (recentLocation) {
      console.log(`📍 Ellie recently stated she's at: ${recentLocation}`);
    }

    const relationshipLevel = conversationContext.relationship?.relationship_level || 0;
    const relationshipStage = conversationContext.relationship?.current_stage || 'STRANGER';

    // Select contextually appropriate photo (with location filter if needed)
    let photo = await selectContextualPhoto(pool, userId, decision, relationshipLevel, recentLocation);

    if (!photo) {
      console.log(`⚠️ No suitable photo found for user ${userId}`);
      return null;
    }

    // Record that we're sending this photo
    await recordPhotoSent(pool, userId, photo.id, conversationContext.userMessage || decision.reason);

    console.log(`✅ Prepared photo ${photo.id} (${photo.category}, nsfw:${photo.nsfw_level}) for user ${userId}`);

    // Create prompt injection for AI
    const aiPromptInjection = createPhotoAwarePrompt(
      photo,
      decision.triggerType || 'spontaneous',
      decision.isMilestone || false
    );

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
