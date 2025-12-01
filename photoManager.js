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
 * Check for stranger milestone (15 messages = first photo as progression teaser)
 */
async function checkStrangerMilestone(pool, userId, relationship) {
  try {
    if (relationship.current_stage !== 'STRANGER') {
      return { shouldSend: false, reason: 'not_stranger' };
    }

    const messagesCount = relationship.messages_count || 0;

    // Trigger at 15 messages (+/- 2 for natural timing)
    if (messagesCount < 13 || messagesCount > 17) {
      return { shouldSend: false, reason: 'milestone_not_reached' };
    }

    // Check if they've already received the stranger milestone photo
    const photoHistory = await pool.query(
      `SELECT COUNT(*) as count FROM user_photo_history WHERE user_id = $1`,
      [userId]
    );

    if (parseInt(photoHistory.rows[0].count) > 0) {
      return { shouldSend: false, reason: 'milestone_already_claimed' };
    }

    console.log(`🎉 MILESTONE: User ${userId} reached 15 messages as STRANGER - sending first photo!`);

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

    // PRIORITY 1: Check stranger milestone
    const milestone = await checkStrangerMilestone(pool, userId, relationship);
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
    const messagesCount = relationship.messages_count || 0;
    if (relationship.current_stage === 'STRANGER' && messagesCount < 20) {
      return { shouldSend: false, reason: 'too_early' };
    }

    // Extract conversation topics for context-aware selection
    const topics = extractConversationTopics(userMessage, conversationContext.ellieResponse || '');

    // Contextual triggers based on conversation
    const triggers = {
      activity_her: {
        patterns: [
          /just (woke up|got up|finished)/,
          /(done with|finished) (workout|gym)/,
          /getting ready/,
          /just took a/,
        ],
        chance: 0.45,
      },
      activity_user: {
        patterns: [
          /what are you up to/,
          /what are you doing/,
          /how('s| is) your (day|morning)/,
        ],
        chance: 0.35,
      },
      flirt_response: {
        patterns: [
          /you('re| are) (so )?(hot|beautiful|gorgeous|sexy|cute|pretty)/,
          /(love|like|miss) you/,
          /thinking (about|of) you/,
        ],
        chance: 0.40,
      },
      conversation_flow: {
        chance: 0.25,
        requiresGoodConversation: true
      },
      spontaneous: {
        chance: 0.12,
      }
    };

    // Determine photo categories based on relationship stage
    const stage = relationship.current_stage;
    const categoryMap = {
      STRANGER: ['casual', 'friendly'],
      FRIEND: ['casual', 'playful'],
      DATING: ['playful', 'flirty', 'cute'],
      COMMITTED: ['flirty', 'romantic', 'intimate'],
      EXCLUSIVE: ['intimate', 'romantic', 'suggestive']
    };

    // Check triggers
    for (const [triggerType, config] of Object.entries(triggers)) {
      let triggered = false;

      if (triggerType === 'spontaneous') {
        triggered = Math.random() < config.chance;
      } else if (triggerType === 'conversation_flow') {
        const recentMessageCount = conversationContext.recentMessageCount || 0;
        triggered = recentMessageCount >= 4 && Math.random() < config.chance;
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
 */
async function selectContextualPhoto(pool, userId, criteria, relationshipLevel = 0) {
  try {
    const { categories, topics, nsfwAllowed } = criteria;

    const maxNsfwLevel = nsfwAllowed ?
      (categories.includes('intimate') || categories.includes('suggestive') ? 2 : 1) : 0;

    // Build dynamic matching conditions based on topics
    let topicConditions = [];
    let topicValues = [];
    let paramIndex = 6; // Start after base params

    if (topics && topics.length > 0) {
      for (const topic of topics) {
        if (topic.type === 'activity') {
          topicConditions.push(`LOWER(p.activity) LIKE $${paramIndex}`);
          topicValues.push(`%${topic.value}%`);
          paramIndex++;
        } else if (topic.type === 'mood') {
          topicConditions.push(`LOWER(p.mood) LIKE $${paramIndex}`);
          topicValues.push(`%${topic.value}%`);
          paramIndex++;
        } else if (topic.type === 'setting') {
          topicConditions.push(`LOWER(p.setting) LIKE $${paramIndex}`);
          topicValues.push(`%${topic.value}%`);
          paramIndex++;
        }
      }
    }

    // First try: Match topic-relevant photos
    if (topicConditions.length > 0) {
      const topicQuery = `
        SELECT p.* FROM ellie_photos p
        WHERE p.is_active = true
        AND p.category = ANY($1)
        AND p.nsfw_level <= $2
        AND (p.min_relationship_level IS NULL OR p.min_relationship_level <= $3)
        AND p.id NOT IN (SELECT photo_id FROM user_photo_history WHERE user_id = $4)
        AND (${topicConditions.join(' OR ')})
        ORDER BY RANDOM()
        LIMIT 1
      `;

      const topicResult = await pool.query(
        topicQuery,
        [categories, maxNsfwLevel, relationshipLevel, userId, ...topicValues]
      );

      if (topicResult.rows.length > 0) {
        console.log(`📸 Found topic-matching photo for topics: ${topics.map(t => t.value).join(', ')}`);
        return topicResult.rows[0];
      }
    }

    // Second try: Any matching category (no topic filter)
    const categoryQuery = await pool.query(
      `SELECT p.* FROM ellie_photos p
       WHERE p.is_active = true
       AND p.category = ANY($1)
       AND p.nsfw_level <= $2
       AND (p.min_relationship_level IS NULL OR p.min_relationship_level <= $3)
       AND p.id NOT IN (SELECT photo_id FROM user_photo_history WHERE user_id = $4)
       ORDER BY RANDOM()
       LIMIT 1`,
      [categories, maxNsfwLevel, relationshipLevel, userId]
    );

    if (categoryQuery.rows.length > 0) {
      return categoryQuery.rows[0];
    }

    // Third try: Allow repeats
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

    // Last resort: Any active photo
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
 * Build rich context string from photo metadata for AI
 * This tells Ellie exactly what she's sending
 */
function buildPhotoContext(photo) {
  if (!photo) return null;

  // Debug: Log available photo columns
  console.log('📸 Photo metadata available:', Object.keys(photo).filter(k => photo[k] != null));

  const parts = [];

  // Core description - try multiple possible column names
  const description = photo.description || photo.photo_description || photo.gpt_description;
  if (description) {
    parts.push(`Photo description: ${description}`);
  }

  // What she's wearing
  const outfit = photo.outfit || photo.clothing || photo.attire;
  if (outfit) {
    parts.push(`Outfit: ${outfit}`);
  }

  // Where she is
  const setting = photo.setting || photo.location || photo.environment || photo.background;
  if (setting) {
    parts.push(`Setting: ${setting}`);
  }

  // Her pose/expression
  const pose = photo.pose || photo.body_pose;
  if (pose) {
    parts.push(`Pose: ${pose}`);
  }

  const expression = photo.expression || photo.facial_expression || photo.face;
  if (expression) {
    parts.push(`Expression: ${expression}`);
  }

  // Mood/vibe
  const mood = photo.mood || photo.vibe || photo.tone;
  if (mood) {
    parts.push(`Mood: ${mood}`);
  }

  // Activity
  const activity = photo.activity || photo.action || photo.doing;
  if (activity) {
    parts.push(`Activity: ${activity}`);
  }

  // Body details if relevant
  const bodyParts = photo.visible_body_parts || photo.body_parts || photo.visible;
  if (bodyParts) {
    parts.push(`Visible: ${bodyParts}`);
  }

  // Suggested caption from GPT tagging
  const caption = photo.suggested_caption || photo.caption || photo.suggested_message;
  if (caption) {
    parts.push(`Suggested caption style: ${caption}`);
  }

  // If we have almost no context, log a warning
  if (parts.length === 0) {
    console.warn('⚠️ No photo context found! Photo columns:', JSON.stringify(photo, null, 2));
  } else {
    console.log('📸 Photo context built:', parts.join('. '));
  }

  return parts.join('. ');
}

/**
 * Create AI prompt injection to inform Ellie about the photo
 */
function createPhotoAwarePrompt(photo, triggerType, isMilestone = false) {
  const context = buildPhotoContext(photo);

  if (isMilestone) {
    return `
[PHOTO ATTACHMENT - YOU ARE SENDING A PHOTO WITH THIS MESSAGE]
This is a special milestone! The user has been chatting with you enough that you're sharing your first photo with them.
${context}

IMPORTANT: You are attaching this photo to your message. Reference it naturally - mention what you're doing in the photo, where you are, or what you're wearing. Make it feel like you're sharing a genuine moment. Don't say "here's a photo" - just talk about what's in it naturally, like "Just got done with..." or "Chilling at home..." based on what the photo shows.
`;
  }

  const triggerContexts = {
    activity_her: `You're sharing what you're currently up to.`,
    activity_user: `The user asked what you're doing, so you're showing them.`,
    flirt_response: `You're feeling flirty and want to tease them with a pic.`,
    conversation_flow: `The conversation is going well, you feel like sharing a spontaneous photo.`,
    spontaneous: `You just felt like surprising them with a photo.`
  };

  return `
[PHOTO ATTACHMENT - YOU ARE SENDING A PHOTO WITH THIS MESSAGE]
${triggerContexts[triggerType] || 'You decided to share a photo.'}
${context}

IMPORTANT: You are attaching this photo to your message. Your response should naturally reference or introduce the photo. Don't say "I'm sending you a photo" - instead, talk about what's in the photo naturally. For example:
- If it's a gym photo: "Just finished my workout, feeling good"
- If it's a cozy bed photo: "So lazy today, haven't even gotten up yet"
- If it's a selfie: Reference your mood, outfit, or what you're doing

Make your message feel authentic to what the photo shows. The user will see both your message and the photo.
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

    const relationshipLevel = conversationContext.relationship?.relationship_level || 0;
    const relationshipStage = conversationContext.relationship?.current_stage || 'STRANGER';

    // Select contextually appropriate photo
    const photo = await selectContextualPhoto(pool, userId, decision, relationshipLevel);

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
