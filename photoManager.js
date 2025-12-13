// photoManager.js - Ellie Photo System v2.0
// Complete rewrite with location awareness, throwbacks, and smart selection

// ============================================================
// CONFIGURATION
// ============================================================

const LOCATION_GROUPS = {
  // When Ellie is "at home" she can send from any of these locations
  home: ['bedroom', 'living_room', 'bathroom', 'home', 'kitchen'],
  bedroom: ['bedroom', 'living_room', 'bathroom', 'home'],
  living_room: ['bedroom', 'living_room', 'bathroom', 'home'],
  bathroom: ['bedroom', 'living_room', 'bathroom', 'home'],

  // Work/office - strict, only office photos
  work: ['office'],
  office: ['office'],

  // Gym - strict, only gym photos (or throwbacks)
  gym: ['gym'],

  // Outside locations
  outside: ['outside', 'street', 'park', 'car'],
  car: ['car', 'outside'],

  // Other
  cafe: ['cafe', 'coffee_shop'],
  beach: ['beach', 'pool'],
};

// Locations where explicit photos are NOT possible in real-time
// (she would need to use throwbacks)
const RESTRICTED_LOCATIONS = ['office', 'work', 'gym', 'cafe', 'outside', 'car', 'beach'];

// Time window to check recent location (in minutes)
const LOCATION_LOOKBACK_MINUTES = 40;

// ============================================================
// LOCATION DETECTION - Where is Ellie right now?
// ============================================================

async function detectCurrentLocation(pool, userId) {
  try {
    // Check Ellie's messages from the last 40 minutes
    const { rows } = await pool.query(
      `SELECT content, photo_context FROM conversation_history
       WHERE user_id = $1
       AND role = 'assistant'
       AND created_at > NOW() - INTERVAL '${LOCATION_LOOKBACK_MINUTES} minutes'
       ORDER BY created_at DESC
       LIMIT 30`,
      [userId]
    );

    if (!rows.length) return null;

    // Priority 1: Check photo_context (most accurate - from actual photo metadata)
    for (const row of rows) {
      if (row.photo_context) {
        const location = extractLocationFromPhotoContext(row.photo_context);
        if (location) {
          console.log(`📍 Ellie's location from photo: "${location}"`);
          return location;
        }
      }
    }

    // Priority 2: Check her text messages
    const locationPatterns = [
      { patterns: [/\b(at home|my place|my apartment|got home|back home)\b/i], location: 'home' },
      { patterns: [/\b(in bed|my bed|lying in bed|in my room|bedroom)\b/i], location: 'bedroom' },
      { patterns: [/\b(at work|the office|at the office|stuck at work|working)\b/i], location: 'work' },
      { patterns: [/\b(at the gym|gym|working out|about to workout)\b/i], location: 'gym' },
      { patterns: [/\b(in the shower|taking a shower|bathroom)\b/i], location: 'bathroom' },
      { patterns: [/\b(living room|on the couch|watching tv)\b/i], location: 'living_room' },
      { patterns: [/\b(outside|walking|park|street)\b/i], location: 'outside' },
      { patterns: [/\b(driving|in the car|in my car|traffic)\b/i], location: 'car' },
      { patterns: [/\b(cafe|coffee shop|starbucks|getting coffee)\b/i], location: 'cafe' },
      { patterns: [/\b(beach|pool|swimming)\b/i], location: 'beach' },
    ];

    for (const row of rows) {
      const content = row.content.toLowerCase();
      for (const { patterns, location } of locationPatterns) {
        if (patterns.some(p => p.test(content))) {
          console.log(`📍 Ellie's location from text: "${location}"`);
          return location;
        }
      }
    }

    return null;
  } catch (error) {
    console.error('❌ Error detecting location:', error.message);
    return null;
  }
}

function extractLocationFromPhotoContext(photoContext) {
  if (!photoContext) return null;

  const ctx = photoContext.toLowerCase();

  // Check for location mentions in photo context
  if (/office|work|desk/.test(ctx)) return 'office';
  if (/gym|fitness|workout/.test(ctx)) return 'gym';
  if (/bedroom|bed/.test(ctx)) return 'bedroom';
  if (/bathroom|shower/.test(ctx)) return 'bathroom';
  if (/living|couch/.test(ctx)) return 'living_room';
  if (/kitchen/.test(ctx)) return 'kitchen';
  if (/outside|park|street/.test(ctx)) return 'outside';
  if (/car/.test(ctx)) return 'car';
  if (/beach|pool/.test(ctx)) return 'beach';
  if (/cafe|coffee/.test(ctx)) return 'cafe';
  if (/home|apartment/.test(ctx)) return 'home';

  return null;
}

function getCompatibleLocations(currentLocation) {
  if (!currentLocation) return null; // No location restriction
  return LOCATION_GROUPS[currentLocation.toLowerCase()] || [currentLocation.toLowerCase()];
}

function isRestrictedLocation(location) {
  if (!location) return false;
  return RESTRICTED_LOCATIONS.includes(location.toLowerCase());
}

// ============================================================
// PHOTO REQUEST DETECTION
// ============================================================

function detectPhotoRequest(userMessage) {
  const msg = userMessage.toLowerCase();
  const patterns = [
    /send (me )?(a )?(photo|pic|picture|selfie)/i,
    /show (me )?(a )?(photo|pic|picture|selfie)/i,
    /can i see (you|a photo|a pic)/i,
    /want to see (you|a photo)/i,
    /let me see/i,
    /pic of you/i,
    /photo of you/i,
    // "More" requests (after receiving a photo)
    /\b(send|show) (me )?more\b/i,
    /\banother (one|photo|pic|picture)\b/i,
    /\bmore (photos?|pics?|pictures?)\b/i,
    /\bone more\b/i,
    /\bagain\b/i,
  ];
  return patterns.some(p => p.test(msg));
}

function detectExplicitRequest(userMessage) {
  const msg = userMessage.toLowerCase();
  const patterns = [
    /\b(nude|naked|tits|boobs|ass|pussy|nipple)/i,
    /\b(show me (your|more)|take (it )?off|undress|strip)\b/i,
    /\b(something sexy|something naughty|something hot)\b/i,
    /\b(more revealing|less clothes)\b/i,
    /\bsee (your )?(body|boobs|tits|ass)\b/i,
  ];
  return patterns.some(p => p.test(msg));
}

function detectPositionRequest(userMessage) {
  const msg = userMessage.toLowerCase();

  // Check for specific position requests
  const positions = {
    'bent_over': /\b(bend over|bent over|from behind|doggy)\b/i,
    'on_knees': /\b(on (your )?knees|kneeling)\b/i,
    'laying_down': /\b(lay(ing)? down|on (the |your )?bed|lying)\b/i,
    'standing': /\b(standing|stand up)\b/i,
    'sitting': /\b(sitting|sit down)\b/i,
    'mirror': /\b(mirror (pic|selfie|photo))\b/i,
    'back_view': /\b(from (the )?back|back view|turn around)\b/i,
  };

  for (const [position, pattern] of Object.entries(positions)) {
    if (pattern.test(msg)) return position;
  }

  return null;
}

function detectThrowbackRequest(userMessage) {
  const msg = userMessage.toLowerCase();
  const patterns = [
    /\b(old|older) (photo|pic|picture)/i,
    /\b(throwback|from before|saved|on your phone)\b/i,
    /\b(one you (have|took) before)\b/i,
  ];
  return patterns.some(p => p.test(msg));
}

// ============================================================
// PHOTO REFUSAL RESPONSES
// ============================================================

function generatePhotoRefusal(stage, reason) {
  const refusals = {
    too_early: {
      STRANGER: [
        "lol we literally just started talking",
        "slow down there, we just met",
        "maybe when I actually know you better",
      ],
      FRIEND_TENSION: [
        "patience... good things come to those who wait",
        "I'll send something when I feel like it",
      ],
    },
    already_sent: [
      "I already sent you one! greedy much?",
      "you just got one, chill",
      "one wasn't enough? lol",
    ],
    restricted_location: {
      work: [
        "I'm at work rn... can't exactly take pics here lol",
        "my coworkers would see me 💀",
        "wait till I get home",
      ],
      gym: [
        "I'm literally at the gym, people would see",
        "let me finish my workout first",
        "maybe after... if you're good",
      ],
      default: [
        "I can't really take one right now",
        "bad timing, I'm out",
        "later when I'm somewhere more private",
      ],
    },
    explicit_too_early: [
      "lol you wish",
      "we're not there yet",
      "earn it first",
      "someone's eager... too bad",
    ],
    nsfw_restricted: [
      "you're getting ahead of yourself",
      "we're not there yet babe",
      "maybe someday if you're lucky",
    ],
  };

  if (reason === 'too_early') {
    const stageRefusals = refusals.too_early[stage] || refusals.too_early.STRANGER;
    return stageRefusals[Math.floor(Math.random() * stageRefusals.length)];
  }

  if (reason === 'restricted_location') {
    return null; // Let the system offer throwback instead
  }

  if (reason === 'explicit_too_early') {
    return refusals.explicit_too_early[Math.floor(Math.random() * refusals.explicit_too_early.length)];
  }

  if (reason === 'already_sent') {
    return refusals.already_sent[Math.floor(Math.random() * refusals.already_sent.length)];
  }

  if (reason === 'nsfw_restricted') {
    return refusals.nsfw_restricted[Math.floor(Math.random() * refusals.nsfw_restricted.length)];
  }

  return "not right now";
}

// ============================================================
// MAIN PHOTO DECISION LOGIC
// ============================================================

async function shouldSendPhoto(pool, userId, context) {
  const { userMessage, relationship, recentMessageCount } = context;
  const stage = relationship?.current_stage || 'STRANGER';
  const level = relationship?.relationship_level || 0;
  const totalInteractions = relationship?.total_interactions || 0;

  // Get current location
  const currentLocation = await detectCurrentLocation(pool, userId);
  const isRestricted = isRestrictedLocation(currentLocation);

  // Check what kind of request this is
  const isDirectRequest = detectPhotoRequest(userMessage);
  const isExplicitRequest = detectExplicitRequest(userMessage);
  const requestedPosition = detectPositionRequest(userMessage);
  const isThrowbackRequest = detectThrowbackRequest(userMessage);

  // Check recent photo history
  const recentPhotos = await getRecentPhotoCount(pool, userId, 60); // last hour
  const sessionPhotos = await getRecentPhotoCount(pool, userId, 180); // last 3 hours

  // ============================================================
  // STRANGER PHASE - Very limited (DISABLED FOR TESTING)
  // ============================================================
  // if (stage === 'STRANGER') {
  //   // Milestone: First photo at 15+ interactions
  //   if (totalInteractions >= 15 && recentPhotos === 0) {
  //     const hasEverReceivedPhoto = await hasReceivedAnyPhoto(pool, userId);
  //     if (!hasEverReceivedPhoto) {
  //       return {
  //         shouldSend: true,
  //         type: 'milestone',
  //         maxNsfw: 1, // Very SFW only
  //         categories: ['casual', 'selfie'],
  //         currentLocation,
  //       };
  //     }
  //   }
  //
  //   // No other photos for strangers
  //   if (isDirectRequest) {
  //     return { shouldSend: false, reason: 'too_early', stage };
  //   }
  //
  //   return { shouldSend: false, reason: 'stranger_no_photos' };
  // }

  // TESTING: Allow STRANGER to get photos like FRIEND_TENSION
  if (stage === 'STRANGER') {
    maxNsfw = 2; // Same as FRIEND_TENSION for testing
  }

  // ============================================================
  // NSFW LEVEL LIMITS BY STAGE
  // ============================================================
  let maxNsfw = 0;
  let minNsfw = 0;

  if (stage === 'FRIEND_TENSION') {
    maxNsfw = 2; // Suggestive max
  } else if (stage === 'COMPLICATED') {
    maxNsfw = 3; // Teasing/revealing
  } else if (stage === 'EXCLUSIVE') {
    maxNsfw = 5; // Full access
    if (isExplicitRequest) minNsfw = 3; // If they ask explicit, give explicit
  }

  // ============================================================
  // EXPLICIT REQUEST HANDLING
  // ============================================================
  if (isExplicitRequest) {
    // Too early for explicit
    if (stage === 'FRIEND_TENSION') {
      return { shouldSend: false, reason: 'explicit_too_early', stage };
    }

    // At restricted location - offer throwback
    if (isRestricted && (stage === 'COMPLICATED' || stage === 'EXCLUSIVE')) {
      return {
        shouldSend: true,
        type: 'throwback_explicit',
        useThrowback: true,
        requireExplicit: true, // Must have breasts_visible, ass_visible, or pussy_visible
        maxNsfw: maxNsfw,
        minNsfw: 2,
        currentLocation,
        offerThrowback: true, // AI should mention "I have an old one on my phone..."
      };
    }

    // Can send explicit from current location
    if (stage === 'COMPLICATED' || stage === 'EXCLUSIVE') {
      return {
        shouldSend: true,
        type: 'explicit_request',
        requireExplicit: true,
        maxNsfw: maxNsfw,
        minNsfw: 2,
        currentLocation,
        compatibleLocations: getCompatibleLocations(currentLocation),
      };
    }
  }

  // ============================================================
  // POSITION REQUEST HANDLING
  // ============================================================
  if (requestedPosition) {
    if (stage === 'STRANGER' || stage === 'FRIEND_TENSION') {
      return { shouldSend: false, reason: 'too_early', stage };
    }

    // At restricted location - use throwback with position
    if (isRestricted) {
      return {
        shouldSend: true,
        type: 'throwback_position',
        useThrowback: true,
        bodyPosition: requestedPosition,
        maxNsfw: maxNsfw,
        currentLocation,
        offerThrowback: true,
      };
    }

    return {
      shouldSend: true,
      type: 'position_request',
      bodyPosition: requestedPosition,
      maxNsfw: maxNsfw,
      currentLocation,
      compatibleLocations: getCompatibleLocations(currentLocation),
    };
  }

  // ============================================================
  // DIRECT PHOTO REQUEST (non-explicit)
  // ============================================================
  if (isDirectRequest || isThrowbackRequest) {
    // Session limits - DISABLED FOR TESTING
    // const sessionLimits = { FRIEND_TENSION: 3, COMPLICATED: 5, EXCLUSIVE: 10 };
    // const limit = sessionLimits[stage] || 2;
    // if (sessionPhotos >= limit) {
    //   return { shouldSend: false, reason: 'session_limit', stage };
    // }

    // At restricted location - throwback only
    if (isRestricted && !isThrowbackRequest) {
      return {
        shouldSend: true,
        type: 'throwback_offer',
        useThrowback: true,
        maxNsfw: maxNsfw,
        currentLocation,
        offerThrowback: true,
      };
    }

    // Explicit throwback request
    if (isThrowbackRequest) {
      return {
        shouldSend: true,
        type: 'throwback_request',
        useThrowback: true,
        maxNsfw: maxNsfw,
        currentLocation,
      };
    }

    // Normal request from compatible location
    return {
      shouldSend: true,
      type: 'direct_request',
      maxNsfw: maxNsfw,
      currentLocation,
      compatibleLocations: getCompatibleLocations(currentLocation),
    };
  }

  // ============================================================
  // ORGANIC/RANDOM PHOTO TRIGGERS
  // ============================================================

  // No organic photos if already sent recently - DISABLED FOR TESTING
  // if (recentPhotos > 0) {
  //   return { shouldSend: false, reason: 'recent_photo_sent' };
  // }

  // Organic triggers based on conversation
  const organicChance = getOrganicPhotoChance(stage, userMessage);

  if (Math.random() < organicChance) {
    // At restricted location - can still send SFW photo from that location
    return {
      shouldSend: true,
      type: 'organic',
      maxNsfw: isRestricted ? 1 : Math.min(maxNsfw, 2), // Keep organic photos tasteful
      currentLocation,
      compatibleLocations: getCompatibleLocations(currentLocation),
    };
  }

  return { shouldSend: false, reason: 'no_trigger' };
}

function getOrganicPhotoChance(stage, userMessage) {
  const msg = userMessage.toLowerCase();

  // Base chances by stage
  let chance = 0;
  if (stage === 'FRIEND_TENSION') chance = 0.08;
  else if (stage === 'COMPLICATED') chance = 0.12;
  else if (stage === 'EXCLUSIVE') chance = 0.15;

  // Boost for certain keywords
  if (/\b(miss you|thinking about you|wish you were here)\b/i.test(msg)) chance += 0.10;
  if (/\b(what are you doing|wyd|what's up)\b/i.test(msg)) chance += 0.05;
  if (/\b(you're (hot|cute|beautiful|gorgeous))\b/i.test(msg)) chance += 0.08;
  if (/\b(good morning|good night|gm|gn)\b/i.test(msg)) chance += 0.05;

  return Math.min(chance, 0.30); // Cap at 30%
}

async function getRecentPhotoCount(pool, userId, minutes) {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as count FROM user_photo_history
       WHERE user_id = $1 AND sent_at > NOW() - INTERVAL '${minutes} minutes'`,
      [userId]
    );
    return parseInt(rows[0]?.count || 0);
  } catch {
    return 0;
  }
}

async function hasReceivedAnyPhoto(pool, userId) {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as count FROM user_photo_history WHERE user_id = $1`,
      [userId]
    );
    return parseInt(rows[0]?.count || 0) > 0;
  } catch {
    return false;
  }
}

// ============================================================
// PHOTO SELECTION FROM DATABASE
// ============================================================

async function selectPhoto(pool, userId, criteria) {
  try {
    const {
      maxNsfw = 2,
      minNsfw = 0,
      useThrowback = false,
      requireExplicit = false,
      bodyPosition = null,
      compatibleLocations = null,
      currentLocation = null,
    } = criteria;

    // Build the query
    let conditions = [
      'p.is_active = true',
      'p.nsfw_level >= $1',
      'p.nsfw_level <= $2',
      'p.id NOT IN (SELECT photo_id FROM user_photo_history WHERE user_id = $3)',
    ];
    let params = [minNsfw, maxNsfw, userId];
    let paramIndex = 4;

    // Throwback filter
    if (useThrowback) {
      conditions.push(`p.photo_type = 'throwback'`);
    }

    // Explicit content filter
    if (requireExplicit) {
      conditions.push(`(p.breasts_visible = true OR p.ass_visible = true OR p.pussy_visible = true)`);
    }

    // Body position filter
    if (bodyPosition) {
      conditions.push(`LOWER(p.body_position) LIKE $${paramIndex}`);
      params.push(`%${bodyPosition}%`);
      paramIndex++;
    }

    // Location filter (only if not throwback)
    if (!useThrowback && compatibleLocations && compatibleLocations.length > 0) {
      const locationConditions = compatibleLocations.map((_, i) =>
        `LOWER(p.location) = $${paramIndex + i}`
      ).join(' OR ');
      conditions.push(`(${locationConditions})`);
      params.push(...compatibleLocations.map(l => l.toLowerCase()));
      paramIndex += compatibleLocations.length;
    }

    const query = `
      SELECT p.* FROM ellie_photos p
      WHERE ${conditions.join(' AND ')}
      ORDER BY RANDOM()
      LIMIT 1
    `;

    console.log(`📸 Photo query: nsfw=${minNsfw}-${maxNsfw}, throwback=${useThrowback}, explicit=${requireExplicit}, position=${bodyPosition}, locations=${compatibleLocations?.join(',')}`);

    const { rows } = await pool.query(query, params);

    if (rows.length > 0) {
      console.log(`📸 Selected photo: id=${rows[0].id}, location=${rows[0].location}, nsfw=${rows[0].nsfw_level}`);
      return rows[0];
    }

    // Fallback: Try without location restriction
    if (compatibleLocations && !useThrowback) {
      console.log(`📸 No location-matched photo, trying throwback fallback`);
      return selectPhoto(pool, userId, { ...criteria, useThrowback: true, compatibleLocations: null });
    }

    // Fallback: Try with looser criteria
    if (requireExplicit) {
      console.log(`📸 No explicit photo found, trying without explicit requirement`);
      return selectPhoto(pool, userId, { ...criteria, requireExplicit: false });
    }

    console.log(`📸 No photo found matching criteria`);
    return null;

  } catch (error) {
    console.error('❌ Error selecting photo:', error.message);
    return null;
  }
}

// ============================================================
// PHOTO CONTEXT BUILDER - Tell AI what photo is being sent
// ============================================================

function buildPhotoContext(photo) {
  if (!photo) return null;

  const parts = [];

  if (photo.description) parts.push(`Photo shows: ${photo.description}`);
  if (photo.location) parts.push(`Location: ${photo.location}`);
  if (photo.tags) parts.push(`Style: ${photo.tags}`);
  if (photo.body_position) parts.push(`Position: ${photo.body_position}`);

  // What's visible (for AI awareness)
  const visible = [];
  if (photo.breasts_visible) visible.push('breasts');
  if (photo.ass_visible) visible.push('ass');
  if (photo.pussy_visible) visible.push('pussy');
  if (visible.length > 0) parts.push(`Showing: ${visible.join(', ')}`);

  return parts.join('. ');
}

function createPhotoAIPrompt(photo, criteria) {
  const context = buildPhotoContext(photo);
  const isThrowback = criteria.useThrowback || photo.photo_type === 'throwback';

  let prompt = `
═══════════════════════════════════════════════════════════════
📸 YOU ARE SENDING A PHOTO
═══════════════════════════════════════════════════════════════

${context}

`;

  if (isThrowback) {
    prompt += `⚠️ THIS IS A THROWBACK PHOTO (old photo from your phone)
- Mention it's an older photo you have saved
- Examples: "I have this one from a while ago...", "found this on my phone", "here's one I took before"
- The photo location may not match where you are NOW - that's fine, it's old

`;
  } else {
    prompt += `⚠️ THIS IS A LIVE PHOTO (you're taking it now)
- Your caption should match where you are: ${photo.location || 'unknown'}
- React naturally to what's in the photo

`;
  }

  prompt += `CAPTION RULES:
- Keep it SHORT and natural (1 sentence max)
- Don't describe the photo in detail - they can see it
- Be flirty/teasing if it's sexy, casual if it's SFW
- NEVER say "I'm sending you a photo" - just send it with a caption
═══════════════════════════════════════════════════════════════
`;

  return prompt;
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

async function preparePhotoForMessage(pool, userId, context) {
  try {
    const decision = await shouldSendPhoto(pool, userId, context);

    if (!decision.shouldSend) {
      // Check if we should return a refusal message
      if (decision.reason === 'too_early' || decision.reason === 'explicit_too_early') {
        return {
          photo: null,
          refusalMessage: generatePhotoRefusal(decision.stage, decision.reason),
        };
      }
      return null;
    }

    // Select the photo
    const photo = await selectPhoto(pool, userId, decision);

    if (!photo) {
      console.log(`📸 No suitable photo found for ${userId}`);
      return null;
    }

    // Record that we sent this photo
    await recordPhotoSent(pool, userId, photo.id, decision.type);

    return {
      photo: {
        id: photo.id,
        url: photo.url,
        location: photo.location,
        description: photo.description,
        tags: photo.tags,
        nsfwLevel: photo.nsfw_level,
        bodyPosition: photo.body_position,
        isThrowback: decision.useThrowback || photo.photo_type === 'throwback',
      },
      aiPromptInjection: createPhotoAIPrompt(photo, decision),
      photoContext: buildPhotoContext(photo),
      triggerType: decision.type,
      offerThrowback: decision.offerThrowback || false,
      currentLocation: decision.currentLocation,
    };

  } catch (error) {
    console.error('❌ Error preparing photo:', error.message);
    return null;
  }
}

async function recordPhotoSent(pool, userId, photoId, context) {
  try {
    await pool.query(
      `INSERT INTO user_photo_history (user_id, photo_id, context, sent_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, photo_id) DO UPDATE SET sent_at = NOW(), context = $3`,
      [userId, photoId, context]
    );
  } catch (error) {
    console.error('❌ Error recording photo:', error.message);
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Main functions
  preparePhotoForMessage,
  shouldSendPhoto,
  selectPhoto,

  // Detection functions
  detectPhotoRequest,
  detectExplicitRequest,
  detectPositionRequest,
  detectThrowbackRequest,
  detectCurrentLocation,

  // Helper functions
  generatePhotoRefusal,
  buildPhotoContext,
  createPhotoAIPrompt,
  getCompatibleLocations,
  isRestrictedLocation,
};
