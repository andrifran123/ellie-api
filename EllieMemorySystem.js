// ============================================================
// 🧠 ELLIE ADVANCED MEMORY SYSTEM v2.0
// ============================================================
// Clean, simple, and WORKING memory system
// Uses Supabase for storage with semantic embeddings
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

class EllieMemorySystem {
  constructor(supabaseUrl, supabaseKey, openaiKey) {
    // Validate credentials
    if (!supabaseUrl || !supabaseKey) {
      this.enabled = false;
      console.log('⚠️ Memory System: DISABLED (Missing Supabase credentials)');
      return;
    }

    if (!openaiKey) {
      this.enabled = false;
      console.log('⚠️ Memory System: DISABLED (Missing OpenAI key)');
      return;
    }

    // Initialize clients
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.openai = new OpenAI({ apiKey: openaiKey });
    this.enabled = true;

    console.log('✅ Memory System: ENABLED');
  }

  // ============================================================
  // 📝 EXTRACT MEMORIES FROM USER MESSAGE
  // ============================================================
  
  async extractMemories(userId, userMessage, context = {}) {
    if (!this.enabled) return null;

    try {
      console.log(`🔍 Extracting memories from: "${userMessage.substring(0, 50)}..."`);

      // Skip very short messages
      if (userMessage.length < 5) {
        console.log('⏭️ Message too short, skipping extraction');
        return null;
      }

      // Use GPT to extract structured memories
      const extractionPrompt = `Extract important information about the USER ONLY from their message.

USER MESSAGE: "${userMessage}"

CONTEXT:
- Relationship stage: ${context.stage || 'STRANGER'}
- Relationship level: ${context.relationshipLevel || 0}

RULES:
1. Extract ONLY information about the USER (not about Ellie or the conversation)
2. Be selective - only extract truly important/memorable information
3. Skip generic messages like "hey", "lol", "ok"

EXTRACT:
- facts: Concrete info (name, job, location, pets, family, hobbies)
- preferences: Likes/dislikes (food, music, activities)
- emotions: Current feelings (happy, sad, anxious, excited, horny)
- events: Past experiences they mention
- plans: Future intentions they share

FORMAT: Return JSON with arrays for each category.
Each item needs:
{
  "content": "Clear, specific statement",
  "confidence": 0.0-1.0,
  "importance": 0.0-1.0,
  "emotional_weight": -1.0 to 1.0
}

Example:
{
  "facts": [{"content": "User has a cat named Marcus", "confidence": 1.0, "importance": 0.8, "emotional_weight": 0.5}],
  "preferences": [{"content": "User dislikes peanuts", "confidence": 0.9, "importance": 0.6, "emotional_weight": -0.3}],
  "emotions": [],
  "events": [],
  "plans": []
}`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: 'You extract memories about the USER only. Be selective and accurate.' 
          },
          { role: 'user', content: extractionPrompt }
        ],
        temperature: 0.2,
        response_format: { type: "json_object" }
      });

      const extracted = JSON.parse(response.choices[0].message.content);

      // Count total memories extracted
      const totalMemories = Object.values(extracted).reduce((sum, arr) => sum + (arr?.length || 0), 0);
      
      if (totalMemories === 0) {
        console.log('ℹ️ No memories extracted from message');
        return null;
      }

      console.log(`✅ Extracted ${totalMemories} memories:`, {
        facts: extracted.facts?.length || 0,
        preferences: extracted.preferences?.length || 0,
        emotions: extracted.emotions?.length || 0,
        events: extracted.events?.length || 0,
        plans: extracted.plans?.length || 0
      });

      // Store memories in database
      await this.storeMemories(userId, extracted, context);

      return extracted;

    } catch (error) {
      console.error('❌ Memory extraction error:', error.message);
      return null;
    }
  }

  // ============================================================
  // 💾 STORE MEMORIES IN SUPABASE
  // ============================================================
  
  async storeMemories(userId, memories, context = {}) {
    if (!this.enabled) return;

    const memoryTypes = ['facts', 'preferences', 'emotions', 'events', 'plans'];
    let storedCount = 0;

    for (const type of memoryTypes) {
      const memoryArray = memories[type] || [];

      for (const memory of memoryArray) {
        // Only store high-confidence memories
        if (memory.confidence < 0.5) {
          console.log(`⏭️ Skipping low-confidence memory: ${memory.content}`);
          continue;
        }

        try {
          // Generate embedding for semantic search
          const embedding = await this.generateEmbedding(memory.content);

          if (!embedding) {
            console.error('❌ Failed to generate embedding for:', memory.content);
            continue;
          }

          // Check for duplicate memory (avoid storing same thing twice)
          const { data: existingMemory } = await this.supabase
            .from('user_memories')
            .select('id, content')
            .eq('user_id', userId)
            .eq('memory_type', type.slice(0, -1)) // Remove 's' from plural
            .eq('is_active', true)
            .ilike('content', memory.content)
            .limit(1);

          if (existingMemory && existingMemory.length > 0) {
            console.log(`ℹ️ Memory already exists, skipping: ${memory.content}`);
            continue;
          }

          // Insert into Supabase
          const { data, error } = await this.supabase
            .from('user_memories')
            .insert({
              user_id: userId,
              memory_type: type.slice(0, -1), // 'facts' -> 'fact'
              content: memory.content,
              confidence: memory.confidence,
              importance: memory.importance || 0.5,
              emotional_weight: memory.emotional_weight || 0,
              embedding: embedding,
              context_tags: context.tags || [],
              created_at: new Date().toISOString()
            });

          if (error) {
            console.error('❌ Error storing memory:', error.message);
            console.error('   Memory:', memory.content);
          } else {
            storedCount++;
            console.log(`💾 Stored: [${type.slice(0, -1)}] ${memory.content}`);
          }

        } catch (error) {
          console.error('❌ Error processing memory:', error.message);
        }
      }
    }

    if (storedCount > 0) {
      console.log(`✅ Successfully stored ${storedCount} memories for user ${userId}`);
    }
  }

  // ============================================================
  // 🔍 RECALL RELEVANT MEMORIES
  // ============================================================
  
  async recallMemories(userId, currentMessage, options = {}) {
    if (!this.enabled) return [];

    const limit = options.limit || 8;
    const minImportance = options.minImportance || 0.3;

    try {
      console.log(`🧠 Recalling memories for: "${currentMessage.substring(0, 50)}..."`);

      // Generate embedding for current message
      const messageEmbedding = await this.generateEmbedding(currentMessage);

      if (!messageEmbedding) {
        console.error('❌ Failed to generate embedding for recall');
        return [];
      }

      // Semantic search using vector similarity
      // Try RPC function first, fallback to simple query if it doesn't exist
      let memories = null;
      let error = null;

      // Try RPC function for semantic search
      const rpcResult = await this.supabase.rpc('match_memories', {
        query_embedding: messageEmbedding,
        match_user_id: userId,
        match_threshold: 0.5, // Similarity threshold (0-1)
        match_count: limit * 2 // Get more, then filter
      });

      // Check if RPC function exists
      if (rpcResult.error && rpcResult.error.message.includes('function')) {
        // RPC function doesn't exist - use fallback query
        console.log('ℹ️ RPC function not found, using fallback memory query');
        const fallbackResult = await this.supabase
          .from('user_memories')
          .select('*')
          .eq('user_id', userId)
          .eq('is_active', true)
          .gte('importance', minImportance)
          .order('created_at', { ascending: false })
          .limit(limit);
        
        memories = fallbackResult.data;
        error = fallbackResult.error;
      } else {
        memories = rpcResult.data;
        error = rpcResult.error;
      }

      if (error) {
        console.error('❌ Memory recall error:', error.message);
        return [];
      }

      if (!memories || memories.length === 0) {
        console.log('ℹ️ No memories found for this message');
        return [];
      }

      // Sort by importance and limit
      const sortedMemories = memories
        .filter(m => m.importance >= minImportance)
        .sort((a, b) => {
          const scoreA = (a.similarity || 0.5) * a.importance;
          const scoreB = (b.similarity || 0.5) * b.importance;
          return scoreB - scoreA;
        })
        .slice(0, limit);

      // Update last accessed timestamp (access_count removed - would need RPC function)
      const memoryIds = sortedMemories.map(m => m.id);
      if (memoryIds.length > 0) {
        await this.supabase
          .from('user_memories')
          .update({ 
            last_accessed_at: new Date().toISOString()
          })
          .in('id', memoryIds)
          .then(() => {})
          .catch(() => {}); // Silent fail - not critical
      }

      console.log(`✅ Recalled ${sortedMemories.length} relevant memories`);
      sortedMemories.forEach(m => {
        const similarity = m.similarity ? (m.similarity * 100).toFixed(0) : '??';
        console.log(`   📌 [${m.memory_type}] ${m.content} (${similarity}% match)`);
      });

      return sortedMemories;

    } catch (error) {
      console.error('❌ Memory recall error:', error.message);
      return [];
    }
  }

  // ============================================================
  // 🔧 HELPER: GENERATE EMBEDDING
  // ============================================================
  
  async generateEmbedding(text) {
    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
      });

      return response.data[0].embedding;

    } catch (error) {
      console.error('❌ Embedding generation error:', error.message);
      return null;
    }
  }

  // ============================================================
  // 📊 UTILITY: GET MEMORY STATS
  // ============================================================
  
  async getMemoryStats(userId) {
    if (!this.enabled) return null;

    try {
      const { data, error } = await this.supabase
        .from('user_memories')
        .select('memory_type, created_at')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) throw error;

      const stats = {
        total: data.length,
        byType: {},
        oldest: null,
        newest: null
      };

      data.forEach(m => {
        stats.byType[m.memory_type] = (stats.byType[m.memory_type] || 0) + 1;
      });

      if (data.length > 0) {
        const dates = data.map(m => new Date(m.created_at)).sort((a, b) => a - b);
        stats.oldest = dates[0];
        stats.newest = dates[dates.length - 1];
      }

      return stats;

    } catch (error) {
      console.error('❌ Error getting memory stats:', error.message);
      return null;
    }
  }
}

module.exports = EllieMemorySystem;