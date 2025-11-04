// videoMetadata.js - FREE Video Metadata Extraction
// No API keys required for basic functionality

const fetch = require('node-fetch');

class VideoMetadataExtractor {
  constructor() {
    // Cache results to avoid repeated fetches (1 hour TTL)
    this.cache = new Map();
    this.cacheTimeout = 60 * 60 * 1000; // 1 hour in milliseconds
  }

  /**
   * Main entry point - detects platform and extracts metadata
   */
  async extract(url, userId = null) {
    try {
      // Check cache first
      const cacheKey = `${url}_${userId || 'default'}`;
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheTimeout) {
          console.log('📦 Using cached metadata for:', url);
          return cached.data;
        }
      }

      // Clean and validate URL
      const cleanUrl = this.cleanUrl(url);
      if (!cleanUrl) {
        console.error('Invalid URL provided:', url);
        return null;
      }

      let metadata = null;

      // Detect platform and extract
      if (this.isTikTok(cleanUrl)) {
        metadata = await this.extractTikTok(cleanUrl);
      } else if (this.isYouTube(cleanUrl)) {
        metadata = await this.extractYouTube(cleanUrl);
      } else if (this.isInstagram(cleanUrl)) {
        metadata = await this.extractInstagram(cleanUrl);
      } else {
        console.log('Unsupported video platform:', cleanUrl);
        return null;
      }

      // Cache successful extraction
      if (metadata) {
        this.cache.set(cacheKey, {
          data: metadata,
          timestamp: Date.now()
        });
        
        // Auto-cleanup old cache entries
        setTimeout(() => this.cache.delete(cacheKey), this.cacheTimeout);
      }

      return metadata;

    } catch (error) {
      console.error('Metadata extraction failed:', error);
      return null;
    }
  }

  /**
   * TIKTOK EXTRACTION (FREE via oEmbed)
   */
  async extractTikTok(url) {
    console.log('🎵 Extracting TikTok metadata for:', url);
    
    try {
      // TikTok's official oEmbed endpoint (no API key needed!)
      const apiUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
      
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; VideoBot/1.0)'
        },
        timeout: 5000
      });

      if (!response.ok) {
        throw new Error(`TikTok oEmbed failed: ${response.status}`);
      }

      const data = await response.json();

      // Extract hashtags and mentions from title
      const hashtags = (data.title || '').match(/#[\w\u4e00-\u9fa5]+/gu) || [];
      const mentions = (data.title || '').match(/@[\w.]+/g) || [];
      
      // Clean the caption (remove hashtags for cleaner reading)
      const cleanCaption = (data.title || '')
        .replace(/#[\w\u4e00-\u9fa5]+/gu, '')
        .replace(/@[\w.]+/g, '')
        .trim();

      // Categorize content based on hashtags and caption
      const category = this.categorizeContent(data.title || '');
      const mood = this.detectMood(data.title || '');

      return {
        platform: 'tiktok',
        url: url,
        title: data.title || 'No caption',
        cleanCaption: cleanCaption || null,
        author: data.author_name || 'Unknown creator',
        authorUrl: data.author_url || null,
        thumbnail: data.thumbnail_url || null,
        hashtags: hashtags,
        mentions: mentions,
        category: category,
        mood: mood,
        embedHtml: data.html || null, // In case you want to embed it
        
        // Generate context for Ellie
        context: this.generateContext('tiktok', {
          caption: cleanCaption,
          category,
          mood,
          author: data.author_name
        })
      };

    } catch (error) {
      console.error('TikTok extraction error:', error);
      
      // Fallback: Extract basic info from URL
      const videoId = this.extractTikTokId(url);
      return {
        platform: 'tiktok',
        url: url,
        videoId: videoId,
        error: 'Could not fetch metadata',
        context: 'TikTok video (metadata unavailable)',
        fallback: true
      };
    }
  }

  /**
   * YOUTUBE EXTRACTION (FREE via oEmbed)
   */
  async extractYouTube(url) {
    console.log('📺 Extracting YouTube metadata for:', url);
    
    try {
      // YouTube's oEmbed endpoint (completely free!)
      const apiUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      
      const response = await fetch(apiUrl, {
        timeout: 5000
      });

      if (!response.ok) {
        throw new Error(`YouTube oEmbed failed: ${response.status}`);
      }

      const data = await response.json();
      
      // Extract video ID for additional features
      const videoId = this.extractYouTubeId(url);
      
      // Parse title for better understanding
      const category = this.categorizeContent(data.title || '');
      const mood = this.detectMood(data.title || '');

      return {
        platform: 'youtube',
        url: url,
        videoId: videoId,
        title: data.title || 'Untitled video',
        author: data.author_name || 'Unknown channel',
        authorUrl: data.author_url || null,
        thumbnail: data.thumbnail_url || null,
        category: category,
        mood: mood,
        
        // YouTube provides these extras
        width: data.width,
        height: data.height,
        
        // Generate context for Ellie
        context: this.generateContext('youtube', {
          title: data.title,
          category,
          mood,
          author: data.author_name
        })
      };

    } catch (error) {
      console.error('YouTube extraction error:', error);
      
      const videoId = this.extractYouTubeId(url);
      return {
        platform: 'youtube',
        url: url,
        videoId: videoId,
        // YouTube video IDs allow us to construct thumbnail URL even on failure
        thumbnail: videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null,
        error: 'Could not fetch metadata',
        context: 'YouTube video (metadata unavailable)',
        fallback: true
      };
    }
  }

  /**
   * INSTAGRAM EXTRACTION (Trickier but still free)
   */
  async extractInstagram(url) {
    console.log('📸 Extracting Instagram metadata for:', url);
    
    try {
      // Instagram's oEmbed (still works but being deprecated)
      // No API key needed while it lasts!
      const apiUrl = `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`;
      
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; VideoBot/1.0)'
        },
        timeout: 5000
      });

      if (!response.ok) {
        // If oEmbed fails, try alternative method
        return await this.extractInstagramAlternative(url);
      }

      const data = await response.json();
      
      // Extract hashtags and mentions from caption
      const caption = data.title || '';
      const hashtags = caption.match(/#[\w\u4e00-\u9fa5]+/gu) || [];
      const mentions = caption.match(/@[\w.]+/g) || [];
      
      const category = this.categorizeContent(caption);
      const mood = this.detectMood(caption);

      return {
        platform: 'instagram',
        url: url,
        title: caption || 'No caption',
        author: data.author_name || 'Unknown user',
        authorUrl: data.author_url || null,
        thumbnail: data.thumbnail_url || null,
        hashtags: hashtags,
        mentions: mentions,
        category: category,
        mood: mood,
        mediaType: data.type || 'post', // 'photo', 'video', or 'rich'
        
        // Generate context for Ellie
        context: this.generateContext('instagram', {
          caption: caption,
          category,
          mood,
          author: data.author_name,
          type: data.type
        })
      };

    } catch (error) {
      console.error('Instagram extraction error:', error);
      return this.extractInstagramAlternative(url);
    }
  }

  /**
   * Instagram Alternative Method (when oEmbed fails)
   */
  async extractInstagramAlternative(url) {
    // Extract post ID from URL
    const postId = this.extractInstagramId(url);
    
    if (!postId) {
      return {
        platform: 'instagram',
        url: url,
        error: 'Could not extract Instagram post ID',
        context: 'Instagram post (metadata unavailable)',
        fallback: true
      };
    }

    // We can at least identify if it's a reel, post, or story
    const postType = url.includes('/reel/') ? 'reel' : 
                     url.includes('/p/') ? 'post' : 
                     url.includes('/stories/') ? 'story' : 'content';

    return {
      platform: 'instagram',
      url: url,
      postId: postId,
      postType: postType,
      error: 'Limited metadata available',
      context: `Instagram ${postType}`,
      fallback: true,
      
      // Suggest alternative approach to user
      suggestion: 'Ask user to describe the content for better response'
    };
  }

  /**
   * HELPER FUNCTIONS
   */

  cleanUrl(url) {
    try {
      // Handle mobile URLs and shortlinks
      url = url.replace('vm.tiktok.com', 'www.tiktok.com');
      url = url.replace('youtu.be/', 'www.youtube.com/watch?v=');
      url = url.replace('m.youtube.com', 'www.youtube.com');
      
      // Ensure https
      if (!url.startsWith('http')) {
        url = 'https://' + url;
      }
      
      return url;
    } catch (error) {
      return null;
    }
  }

  // Platform detection
  isTikTok(url) {
    return /tiktok\.com|vm\.tiktok\.com/i.test(url);
  }

  isYouTube(url) {
    return /youtube\.com|youtu\.be|m\.youtube\.com/i.test(url);
  }

  isInstagram(url) {
    return /instagram\.com|instagr\.am/i.test(url);
  }

  // Extract video/post IDs
  extractTikTokId(url) {
    const match = url.match(/\/video\/(\d+)|\/v\/(\d+)|\/(\d+)/);
    return match ? (match[1] || match[2] || match[3]) : null;
  }

  extractYouTubeId(url) {
    const match = url.match(/(?:v=|\/v\/|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  extractInstagramId(url) {
    const match = url.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
    return match ? match[2] : null;
  }

  /**
   * Content Analysis (helps Ellie understand context)
   */
  categorizeContent(text) {
    const categories = {
      dating: /dating|relationship|boyfriend|girlfriend|crush|love|couple|toxic|red flag|romantic/i,
      funny: /funny|lol|lmao|hilarious|comedy|joke|meme|humor|prank|fail/i,
      motivational: /motivation|inspire|grind|success|mindset|growth|goals|hustle/i,
      fashion: /outfit|fashion|style|makeup|beauty|ootd|skincare|haul/i,
      food: /food|recipe|cooking|eating|restaurant|mukbang|chef|delicious/i,
      pets: /cat|dog|pet|puppy|kitten|animal|cute|paw|fur baby/i,
      fitness: /workout|gym|fitness|exercise|gains|muscle|yoga|health/i,
      music: /song|music|cover|singing|dance|choreo|remix|beat/i,
      sad: /sad|crying|depressed|heartbreak|pain|hurt|emotional|tears/i,
      drama: /drama|tea|expose|scandal|confrontation|beef|argument/i,
      educational: /learn|fact|science|history|explain|tutorial|how to|diy/i
    };

    for (const [category, regex] of Object.entries(categories)) {
      if (regex.test(text)) {
        return category;
      }
    }
    
    return 'general';
  }

  detectMood(text) {
    const moods = {
      excited: /omg|amazing|incredible|wow|best|love|yasss|excited|can't believe/i,
      funny: /lol|lmao|dying|dead|hilarious|crying|😂|🤣|💀/i,
      romantic: /cute|adorable|relationship|couple|love|heart|😍|❤️|🥰/i,
      sarcastic: /sure|right|totally|obviously|whatever|yeah right/i,
      shocked: /what|wtf|seriously|no way|can't believe|shocked|mind blown/i,
      sad: /sad|crying|depressed|hurt|pain|😢|😭|💔/i,
      angry: /angry|mad|pissed|annoyed|frustrated|hate|😤|😡|🤬/i
    };

    for (const [mood, regex] of Object.entries(moods)) {
      if (regex.test(text)) {
        return mood;
      }
    }
    
    return 'neutral';
  }

  /**
   * Generate context string for Ellie based on metadata
   */
  generateContext(platform, data) {
    let context = `[${platform} video`;
    
    if (data.category && data.category !== 'general') {
      context += ` about ${data.category}`;
    }
    
    if (data.mood && data.mood !== 'neutral') {
      context += ` (${data.mood} mood)`;
    }
    
    if (data.caption || data.title) {
      const text = data.caption || data.title;
      // Truncate long captions
      const shortText = text.length > 100 ? text.substring(0, 97) + '...' : text;
      context += `: "${shortText}"`;
    }
    
    if (data.author) {
      context += ` by @${data.author}`;
    }
    
    context += ']';
    
    return context;
  }

  /**
   * Generate a smart response suggestion for Ellie
   */
  generateResponseHint(metadata, relationshipLevel) {
    const hints = [];
    
    // Platform-specific hints
    if (metadata.platform === 'tiktok') {
      if (metadata.category === 'dating') {
        hints.push('This might be a hint or relate to your relationship');
      }
      if (metadata.mood === 'funny') {
        hints.push('React with humor, maybe tease them about their FYP');
      }
    }
    
    // Relationship-level specific hints
    if (relationshipLevel < 30) {
      hints.push('Keep response casual and curious');
    } else if (relationshipLevel < 60) {
      hints.push('Can be flirty if video is about relationships');
    } else {
      hints.push('React as if this might be about your relationship');
    }
    
    return hints;
  }
}

// Export singleton instance
module.exports = new VideoMetadataExtractor();