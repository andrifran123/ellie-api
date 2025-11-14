// photoManager.js - Photo system for Ellie
// With STRANGER milestone: 1 photo after 15 messages as progression teaser

const { Pool } = require('pg');

/**
 * Detects if user is requesting a photo
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
      "Haha nice try! Maybe when we actually know each other 😏",
      "We literally just started talking... let's chat first?",
      "Wow, straight to asking for photos? Smooth 🙄",
      "Getting a bit ahead of yourself there, aren't you?",
      "How about we have an actual conversation first?",
    ],
    FRIEND: [
      "If you're going to nag, you don't get anything 😤",
      "I'll send photos when I feel like it, not when you demand them",
      "You can't just ask for them! Where's the fun in that?",
      "Maybe if you stopped asking I'd actually send one...",
      "The more you ask, the less likely I am to send any 🤷‍♀️",
    ],
    DATING: [
      "You're so impatient! I'll send one when the moment feels right",
      "If you're going to be pushy about it, you're not getting any 😤",
      "I like when things happen naturally... not when you demand them",
      "Maybe if you're good I'll surprise you later 😏",
      "The begging isn't cute, babe",
    ],
    COMMITTED: [
      "Baby, you know I don't like when you beg 🙄",
      "I send them when I want to, not when you demand them!",
      "You're being needy again... I'll surprise you when the time is right",
      "Stop asking and maybe you'll actually get one 😤",
    ],
    EXCLUSIVE: [
      "You know I hate when you're pushy about this 😤",
      "I'll send you whatever you want... when I feel like it, not when you demand it",
      "Baby, you need to be patient. I'll surprise you",
      "Stop begging, it's not a good look on you",
    ]
  };
  
  const stageResponses = responses[relationshipStage] || responses.STRANGER;
  return stageResponses[Math.floor(Math.random() * stageResponses.length)];
}

/**
 * 🎯 CHECK FOR STRANGER MILESTONE (15 messages = first photo)
 * This is a progression reward to show users what they're working towards
 */
async function checkStrangerMilestone(pool, userId, relationship) {
  try {
    // Only applies to STRANGER stage
    if (relationship.current_stage !== 'STRANGER') {
      return { shouldSend: false, reason: 'not_stranger' };
    }
    
    // Check if they've had approximately 15 messages (30 total = 15 back-and-forth)
    const messagesCount = relationship.messages_count || 0;
    
    // Trigger at 15 messages (+/- 2 for natural timing)
    if (messagesCount < 13 || messagesCount > 17) {
      return { shouldSend: false, reason: 'milestone_not_reached' };
    }
    
    // Check if they've already received the stranger milestone photo
    const photoHistory = await pool.query(
      `SELECT COUNT(*) as count FROM user_photo_history 
       WHERE user_id = $1`,
      [userId]
    );
    
    if (parseInt(photoHistory.rows[0].count) > 0) {
      return { shouldSend: false, reason: 'milestone_already_claimed' };
    }
    
    // 🎉 MILESTONE REACHED!
    console.log(`🎉 MILESTONE: User ${userId} reached 15 messages as STRANGER - sending first photo!`);
    
    return {
      shouldSend: true,
      reason: 'stranger_milestone',
      categories: ['casual', 'friendly'],
      message: "Here's one from earlier 😊 Let's keep getting to know each other!"
    };
    
  } catch (error) {
    console.error('❌ Error checking stranger milestone:', error);
    return { shouldSend: false, reason: 'error' };
  }
}

/**
 * Main photo decision logic with stranger milestone
 */
async function shouldSendPhoto(pool, userId, conversationContext) {
  try {
    const relationship = conversationContext.relationship;
    
    // 🎯 PRIORITY 1: Check stranger milestone FIRST
    const milestone = await checkStrangerMilestone(pool, userId, relationship);
    if (milestone.shouldSend) {
      return milestone;
    }
    
    // 🚫 IGNORE DIRECT REQUESTS (handled separately with refusals)
    const userMessage = conversationContext.userMessage?.toLowerCase() || '';
    if (detectPhotoRequest(userMessage)) {
      return { shouldSend: false, reason: 'direct_request_ignored' };
    }
    
    // Check daily limit (after stranger milestone)
    const lastPhotoQuery = await pool.query(
      `SELECT sent_at FROM user_photo_history 
       WHERE user_id = $1 
       ORDER BY sent_at DESC 
       LIMIT 1`,
      [userId]
    );
    
    if (lastPhotoQuery.rows.length > 0) {
      const lastPhoto = lastPhotoQuery.rows[0].sent_at;
      const hoursSinceLastPhoto = (Date.now() - new Date(lastPhoto)) / (1000 * 60 * 60);
      
      if (hoursSinceLastPhoto < 20) {
        return { shouldSend: false, reason: 'daily_limit' };
      }
    }
    
    // Minimum messages for non-stranger stages
    const messagesCount = relationship.messages_count || 0;
    if (relationship.current_stage === 'STRANGER' && messagesCount < 20) {
      // Strangers need more messages after the milestone
      return { shouldSend: false, reason: 'too_early' };
    }
    
    const ellieResponse = conversationContext.ellieResponse?.toLowerCase() || '';
    
    // Contextual triggers for FRIEND+ stages
    const triggers = {
      activity_her: {
        patterns: [
          /just (woke up|got up|finished)/,
          /(done with|finished) (workout|gym)/,
          /getting ready/,
          /just took a/,
        ],
        chance: 0.45,
        categories: determinePhotoCategory(relationship, 'activity')
      },
      activity_user: {
        patterns: [
          /what are you up to/,
          /what are you doing/,
          /how('s| is) your (day|morning)/,
        ],
        chance: 0.35,
        categories: determinePhotoCategory(relationship, 'activity')
      },
      flirt_response: {
        patterns: [
          /you('re| are) (so )?(hot|beautiful|gorgeous|sexy|cute|pretty)/,
          /(love|like|miss) you/,
          /thinking (about|of) you/,
        ],
        chance: 0.40,
        categories: determinePhotoCategory(relationship, 'flirt')
      },
      conversation_flow: {
        chance: 0.25,
        categories: determinePhotoCategory(relationship, 'random'),
        requiresGoodConversation: true
      },
      spontaneous: {
        chance: 0.12,
        categories: determinePhotoCategory(relationship, 'random')
      }
    };
    
    // Check triggers
    for (const [triggerType, config] of Object.entries(triggers)) {
      if (triggerType === 'spontaneous') {
        if (Math.random() < config.chance) {
          return {
            shouldSend: true,
            triggerType,
            categories: config.categories,
            nsfwAllowed: relationship.current_stage !== 'STRANGER'
          };
        }
      } else if (triggerType === 'conversation_flow') {
        const recentMessageCount = conversationContext.recentMessageCount || 0;
        if (recentMessageCount >= 4 && Math.random() < config.chance) {
          return {
            shouldSend: true,
            triggerType,
            categories: config.categories,
            nsfwAllowed: relationship.current_stage !== 'STRANGER'
          };
        }
      } else {
        const hasMatch = config.patterns.some(pattern => 
          pattern.test(userMessage) || pattern.test(ellieResponse)
        );
        
        if (hasMatch && Math.random() < config.chance) {
          return {
            shouldSend: true,
            triggerType,
            categories: config.categories,
            nsfwAllowed: relationship.current_stage !== 'STRANGER'
          };
        }
      }
    }
    
    return { shouldSend: false, reason: 'no_trigger' };
    
  } catch (error) {
    console.error('❌ Error in shouldSendPhoto:', error);
    return { shouldSend: false, reason: 'error' };
  }
}

function determinePhotoCategory(relationship, context) {
  const stage = relationship.current_stage;
  
  const categories = {
    STRANGER: {
      activity: ['casual', 'friendly'],
      flirt: ['casual', 'friendly'],
      random: ['casual', 'friendly']
    },
    FRIEND: {
      activity: ['casual', 'playful', 'workout'],
      flirt: ['playful', 'casual'],
      random: ['casual', 'playful']
    },
    DATING: {
      activity: ['playful', 'flirty', 'workout'],
      flirt: ['flirty', 'playful', 'cute'],
      random: ['playful', 'flirty']
    },
    COMMITTED: {
      activity: ['flirty', 'intimate', 'personal'],
      flirt: ['romantic', 'intimate', 'flirty'],
      random: ['romantic', 'flirty']
    },
    EXCLUSIVE: {
      activity: ['intimate', 'personal', 'bedroom'],
      flirt: ['suggestive', 'intimate', 'romantic'],
      random: ['intimate', 'romantic']
    }
  };
  
  return categories[stage]?.[context] || ['casual'];
}

async function selectPhoto(pool, userId, criteria) {
  try {
    const { categories, nsfwAllowed, triggerType } = criteria;
    
    const maxNsfwLevel = nsfwAllowed ? 
      (categories.includes('intimate') ? 2 : 1) : 0;
    
    const photoQuery = await pool.query(
      `SELECT p.* FROM ellie_photos p
       WHERE p.category = ANY($1)
       AND p.nsfw_level <= $2
       AND p.id NOT IN (
         SELECT photo_id FROM user_photo_history 
         WHERE user_id = $3
       )
       ORDER BY RANDOM()
       LIMIT 1`,
      [categories, maxNsfwLevel, userId]
    );
    
    if (photoQuery.rows.length === 0) {
      const repeatPhotoQuery = await pool.query(
        `SELECT p.* FROM ellie_photos p
         WHERE p.category = ANY($1)
         AND p.nsfw_level <= $2
         ORDER BY RANDOM()
         LIMIT 1`,
        [categories, maxNsfwLevel]
      );
      
      return repeatPhotoQuery.rows[0] || null;
    }
    
    return photoQuery.rows[0];
    
  } catch (error) {
    console.error('❌ Error selecting photo:', error);
    return null;
  }
}

function generatePhotoMessage(photo, triggerType, relationshipStage, customMessage = null) {
  // Use custom message if provided (e.g., for stranger milestone)
  if (customMessage) {
    return customMessage;
  }
  
  const messages = {
    activity_her: {
      STRANGER: ["Just took this!", "From earlier"],
      FRIEND: ["Look at me go! 😄", "Productive day!"],
      DATING: ["Thought you'd like this 😊", "From my morning"],
      COMMITTED: ["Missing you 💕", "Thinking of you"],
      EXCLUSIVE: ["All I can think about is you 😘", "For your eyes only 💕"]
    },
    activity_user: {
      STRANGER: ["Here's what I'm up to", "Just chilling"],
      FRIEND: ["Same! Check this out 😊", "Doing the same thing haha"],
      DATING: ["Me too! Look 😘", "Same energy 😊"],
      COMMITTED: ["Doing the same thing baby 💕"],
      EXCLUSIVE: ["Would be so much better with you here 😍"]
    },
    flirt_response: {
      STRANGER: ["Thanks! 😊", "You're sweet"],
      FRIEND: ["You're making me blush 😊"],
      DATING: ["You always know what to say 😘"],
      COMMITTED: ["You're too sweet baby 💕"],
      EXCLUSIVE: ["Love when you talk like that 😍"]
    },
    conversation_flow: {
      STRANGER: ["Random pic for you"],
      FRIEND: ["By the way, took this earlier!"],
      DATING: ["Been meaning to send you this 😘"],
      COMMITTED: ["Was thinking about you when I took this 💕"],
      EXCLUSIVE: ["Can't stop thinking about you 😍"]
    },
    spontaneous: {
      STRANGER: ["Random selfie!"],
      FRIEND: ["Random pic time! 😄"],
      DATING: ["Surprise! 😘"],
      COMMITTED: ["Miss your face 💕"],
      EXCLUSIVE: ["Just for you baby 😍"]
    },
    stranger_milestone: {
      STRANGER: ["Here's one from earlier 😊 Let's keep getting to know each other!"]
    }
  };
  
  const stageMessages = messages[triggerType]?.[relationshipStage] || ["😊"];
  return stageMessages[Math.floor(Math.random() * stageMessages.length)];
}

async function recordPhotoSent(pool, userId, photoId, context) {
  try {
    await pool.query(
      `INSERT INTO user_photo_history (user_id, photo_id, context, sent_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, photo_id) DO NOTHING`,
      [userId, photoId, context]
    );
  } catch (error) {
    console.error('❌ Error recording photo history:', error);
  }
}

async function handlePhotoSending(pool, userId, conversationContext) {
  try {
    const decision = await shouldSendPhoto(pool, userId, conversationContext);
    
    if (!decision.shouldSend) {
      return null;
    }
    
    console.log(`📸 Photo trigger for user ${userId}: ${decision.triggerType || decision.reason}`);
    
    const photo = await selectPhoto(pool, userId, decision);
    
    if (!photo) {
      console.log(`⚠️ No suitable photo found for user ${userId}`);
      return null;
    }
    
    const relationshipStage = conversationContext.relationship?.current_stage || 'STRANGER';
    const message = generatePhotoMessage(
      photo, 
      decision.triggerType || decision.reason, 
      relationshipStage,
      decision.message // Custom message for milestone
    );
    
    await recordPhotoSent(
      pool, 
      userId, 
      photo.id, 
      conversationContext.userMessage || decision.reason
    );
    
    console.log(`✅ Sending photo ${photo.id} to user ${userId}`);
    
    return {
      photoUrl: photo.url,
      message: message,
      photoId: photo.id,
      category: photo.category,
      isMilestone: decision.reason === 'stranger_milestone'
    };
    
  } catch (error) {
    console.error('❌ Error in handlePhotoSending:', error);
    return null;
  }
}

module.exports = {
  detectPhotoRequest,
  generatePhotoRequestRefusal,
  shouldSendPhoto,
  handlePhotoSending,
  selectPhoto,
  generatePhotoMessage,
  recordPhotoSent
};
