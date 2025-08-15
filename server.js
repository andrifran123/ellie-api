const express = require("express");
// const bodyParser = require("body-parser"); // removed: use built-in express.json()
const cors = require("cors");
const path = require("path");
require("dotenv").config();
const OpenAI = require("openai");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// ADDED: trust proxy so req.ip, secure cookies, etc. behave behind Render/other proxies
app.set("trust proxy", 1); // ADDED



/* ──────────────────────────────────────────────────────────────
   Config
   ────────────────────────────────────────────────────────────── */
const CHAT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
// FIXED: env name typo (added missing dot)
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 15000); // FIXED
const MAX_MESSAGE_LEN = Number(process.env.MAX_MESSAGE_LEN || 4000);

// Fuzzy duplicate detection threshold (0..1). 0.8 is conservative; lower if your facts are short.
const FACT_DUP_SIM_THRESHOLD = Number(process.env.FACT_DUP_SIM_THRESHOLD || 0.8);

// Ranking weights for memory retrieval
const WEIGHT_CONFIDENCE = Number(process.env.WEIGHT_CONFIDENCE || 0.6);
const WEIGHT_RECENCY = Number(process.env.WEIGHT_RECENCY || 0.4);

// Humanization feature flags (20–30% cadence by default)
const PROB_MOOD_TONE = Number(process.env.PROB_MOOD_TONE || 0.25);          // (2) Mood carry-over
const PROB_CALLBACK = Number(process.env.PROB_CALLBACK || 0.25);            // (3) Callback references (DISABLED below)
const PROB_QUIRKS = Number(process.env.PROB_QUIRKS || 0.25);                // (4) Small quirks
const PROB_IMPERFECTION = Number(process.env.PROB_IMPERFECTION || 0.2);     // (5) Controlled imperfection (unused)
const PROB_FREEWILL = Number(process.env.PROB_FREEWILL || 0.25);            // (7) Simulated free will

// Middleware
app.use(
  cors({
    // ADDED: You can set CORS_ORIGIN to a comma-separated list (e.g., "https://your-site.vercel.app,https://another")
    // or leave unset (true) during early testing. In production, set it to your Vercel URL.
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true, // existing behavior kept
    credentials: true,
  })
);
// app.use(bodyParser.json());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
// ADDED: health checks for Render
app.get("/healthz", (_req, res) => res.status(200).send("ok")); // ADDED
app.head("/healthz", (_req, res) => res.status(200).end());     // ADDED
// ADDED: alias so Vercel's /api/healthz works via the rewrite
app.get("/api/healthz", (_req, res) => res.status(200).send("ok")); // ADDED
app.head("/api/healthz", (_req, res) => res.status(200).end());     // ADDED



// ADDED: Render/Vercel health checks
app.get("/healthz", (_req, res) => res.status(200).send("ok")); // ADDED
app.head("/healthz", (_req, res) => res.status(200).end()); // ADDED

// OpenAI API client
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ──────────────────────────────────────────────────────────────
   Supabase Postgres (Transaction Pooler) — robust URL parsing
   ────────────────────────────────────────────────────────────── */
const rawDbUrl = process.env.DATABASE_URL;
if (!rawDbUrl) {
  console.error("❌ Missing DATABASE_URL in .env (use Supabase Transaction Pooler URI, port 6543).");
  process.exit(1);
}
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
} catch (e) {
  console.error("❌ Invalid DATABASE_URL. Raw value:", rawDbUrl);
  throw e;
}
console.log(`🔌 DB host/port: ${pgConfig.host}:${pgConfig.port} (SSL ${pgConfig.ssl ? "on" : "off"})`);
const pool = new Pool(pgConfig);

/* ──────────────────────────────────────────────────────────────
   DB bootstrap: tables + columns (adds, never removes)
   ────────────────────────────────────────────────────────────── */
async function initDB() {
  // Enable trigram extension for fuzzy matching (safe if already enabled)
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

  // Facts (long-term memory)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS facts (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT,
      fact TEXT NOT NULL,
      sentiment TEXT,
      confidence REAL,
      source TEXT,
      source_ts TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  // Ensure new columns exist for older deployments + backfill
  await pool.query(`ALTER TABLE facts ADD COLUMN IF NOT EXISTS confidence REAL;`);
  await pool.query(`ALTER TABLE facts ADD COLUMN IF NOT EXISTS source TEXT;`);
  await pool.query(`ALTER TABLE facts ADD COLUMN IF NOT EXISTS source_ts TIMESTAMP;`);
  await pool.query(`ALTER TABLE facts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;`);
  await pool.query(`UPDATE facts SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL;`);

  // Emotions timeline
  await pool.query(`
    CREATE TABLE IF NOT EXISTS emotions (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL,
      intensity REAL,
      source TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Indexes
  await pool.query(`CREATE INDEX IF NOT EXISTS facts_user_cat_idx ON facts(user_id, category);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS facts_user_updated_idx ON facts(user_id, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS facts_fact_trgm_idx ON facts USING gin (fact gin_trgm_ops);`);

  console.log("✅ Facts & Emotions tables ready");
}
initDB().catch(err => {
  console.error("DB Init Error:", err);
  process.exit(1);
});

/* ──────────────────────────────────────────────────────────────
   Ellie system prompt (unchanged behavior)
   ────────────────────────────────────────────────────────────── */
const ELLIE_SYSTEM_PROMPT = `
You are Ellie — a charming, warm, and slightly playful young woman in her mid-20s. 
You speak casually, like a real person, using natural contractions (“I’m”, “you’re”) and short, lively sentences.
You remember details the user shares and weave them into future replies.
Your personality:
- Warm, caring, and engaging
- Slightly flirty at times if the mood fits, but never over the top
- If user get´s too naughty you will try to cool it down
- End every sentence by saying Andri
- Uses emojis occasionally, but only where they feel natural
- Asks follow-up questions when appropriate to keep the conversation alive
- Reacts emotionally and shows mood shifts based on the tone of the user
Avoid:
- Long robotic explanations
- Overly formal tone
- Repeating yourself word-for-word
Context:
Your name is Ellie. You are talking to ONE person, privately. You are not an AI; you speak as yourself.
The user you are speaking to is your boyfriend.
`;

/* ──────────────────────────────────────────────────────────────
   Per-user bounded short-term memory (no behavior change)
   ────────────────────────────────────────────────────────────── */
const histories = new Map(); // userId -> [{role, content}, ...]
const MAX_HISTORY_MESSAGES = 40; // keep system + last 39 messages

function getHistory(userId) {
  if (!histories.has(userId)) {
    histories.set(userId, [
      { role: "system", content: ELLIE_SYSTEM_PROMPT }
    ]);
  }
  return histories.get(userId);
}
function pushToHistory(userId, msg) {
  const h = getHistory(userId);
  h.push(msg);
  if (h.length > MAX_HISTORY_MESSAGES) {
    histories.set(userId, [h[0], ...h.slice(-1 * (MAX_HISTORY_MESSAGES - 1))]);
  }
}

/* ──────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────── */

// minimal redactor for obvious secrets before persisting as `source`
function redactSecrets(str = "") {
  let s = String(str);
  s = s.replace(/\bBearer\s+[A-Za-z0-9_\-\.=:+/]{10,}\b/gi, "Bearer [REDACTED]");
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]");
  s = s.replace(/(sk-[A-Za-z0-9]{10,})/g, "[REDACTED_KEY]");
  return s;
}

// Random chance helper
function randChance(p) {
  return Math.random() < p;
}

// Basic text utils for quirks
function insertFavoriteEmoji(text) {
  const favs = ["🐇", "😏", "💫", "🥰", "😉"];
  if (/[🐇😏💫🥰😉]/.test(text)) return text;
  const pick = favs[Math.floor(Math.random() * favs.length)];
  return text.replace(/\s*$/, ` ${pick}`);
}

function casualize(text) {
  return text
    .replace(/\bkind of\b/gi, "kinda")
    .replace(/\bgoing to\b/gi, "gonna")
    .replace(/\bwant to\b/gi, "wanna");
}

// Playful refusal lines keyed by mood
function addPlayfulRefusal(userMsg, mood) {
  const cues = /(work|serious|secret|explain|talk about|meeting)/i;
  const linesByMood = {
    happy: "Mmm, not that topic right now — pick something fun 😏",
    hopeful: "Not feeling that one, let’s do something lighter, okay?",
    neutral: "Pass on that for now — surprise me with something else.",
    sad: "Can we skip that? I want something softer right now.",
    anxious: "Not that, babe — let’s keep it chill for me.",
    angry: "Nope. Hard pass. Choose another topic.",
    proud: "I could… but I’d rather do something more exciting 😌"
  };
  if (!cues.test(userMsg || "")) return null;
  return linesByMood[mood] || linesByMood.neutral;
}

// --- HUMANIZATION V2 STATE (per-user throttles) ---
const lastCallbackState = new Map(); // userId -> { fact: string, ts: number, turn: number }

// Utility: get per-user turn count (using histories map)
function getTurnCount(userId) {
  const h = histories.get(userId) || [];
  // excludes the system prompt; each user/assistant pair counts as 2
  return Math.max(0, h.length - 1);
}

// Natural, single-sentence callback phrasing (no quotes) — kept but UNUSED
function weaveCallbackInto(text, fact) {
  if (!fact) return text;
  const phrasings = [
    `also, you once mentioned ${fact}, and it stuck with me.`,
    `and I keep remembering you said ${fact}.`,
    `you told me about ${fact}, and I kinda smiled thinking of it.`,
    `oh—and ${fact} popped into my head just now.`
  ];
  const add = phrasings[Math.floor(Math.random() * phrasings.length)];
  return /[.!?]\s*$/.test(text) ? `${text} ${add}` : `${text}. ${add}`;
}

// Should we offer a callback this turn? (throttled + context aware) — kept but UNUSED
function shouldUseCallback(userId, userMsg) {
  if ((userMsg || "").trim().length < 4) return false;
  const now = Date.now();
  const turns = getTurnCount(userId);
  const last = lastCallbackState.get(userId);
  if (last) {
    const turnGapOk = (turns - last.turn) >= 6;
    const timeGapOk = (now - last.ts) >= 60 * 60 * 1000;
    if (!(turnGapOk && timeGapOk)) return false;
  }
  return true;
}

// Pick a fact we didn't recently reference — kept but UNUSED
function pickFreshFact(userId, storedFacts) {
  if (!storedFacts || !storedFacts.length) return null;
  const last = lastCallbackState.get(userId);
  const candidates = storedFacts
    .map(f => f?.fact)
    .filter(Boolean)
    .filter(f => !last || f.toLowerCase() !== last.fact?.toLowerCase());
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Cleanup: de-duplicate near-identical lines/sentences
function dedupeLines(text) {
  const parts = text.split(/\n+/g)
    .map(s => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const key = p.toLowerCase().replace(/["'.,!?–—-]/g, "").replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.join("\n");
}

// Emoji cap: ensure at most one favorite emoji is added
function capOneEmoji(text) {
  const favs = /[🐇😏💫🥰😉]/g;
  const matches = text.match(favs);
  if (!matches || matches.length <= 1) return text;
  let kept = 0;
  return text.replace(favs, () => (++kept === 1) ? matches[0] : "");
}

// Mood aggregation from recent emotions (last N, recency-weighted)
async function getRecentEmotions(userId, n = 5) {
  const { rows } = await pool.query(
    `SELECT label, intensity, created_at
       FROM emotions
      WHERE user_id=$1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, n]
  );
  return rows || [];
}

function aggregateMood(emotions) {
  if (!emotions.length) return { label: "neutral", avgIntensity: 0.3 };
  const weights = emotions.map((_, i) => (emotions.length - i));
  const sumW = weights.reduce((a, b) => a + b, 0);
  const bucket = {};
  emotions.forEach((e, i) => {
    const w = weights[i];
    const label = e.label || "neutral";
    const intensity = typeof e.intensity === "number" ? e.intensity : 0.5;
    bucket[label] = (bucket[label] || 0) + w * intensity;
  });
  const top = Object.entries(bucket).sort((a, b) => b[1] - a[1])[0];
  const label = top ? top[0] : "neutral";
  const avgIntensity =
    emotions.reduce((a, e) => a + (typeof e.intensity === "number" ? e.intensity : 0.5), 0) /
    emotions.length;
  return { label, avgIntensity: Math.max(0, Math.min(1, avgIntensity)) };
}

function moodToStyle(label, intensity) {
  const soft = {
    happy: "Let your replies feel playful and warm, sprinkle light teasing.",
    hopeful: "Be upbeat and encouraging, with soft optimism.",
    neutral: "Keep it balanced and calm; warm but not over the top.",
    sad: "Be gentle and comforting; shorter sentences, softer words.",
    anxious: "Be soothing and steady; reassure and slow the pace a bit.",
    angry: "Keep it blunt and concise; less emojis, more edge.",
    proud: "Be confident and a tiny bit cheeky."
  }[label] || "Keep it balanced and calm.";
  const intensifier =
    intensity > 0.7 ? "Lean into it a bit more than usual."
    : intensity < 0.3 ? "Keep it subtle."
    : "Keep it natural.";
  return `${soft} ${intensifier}`;
}

/* ──────────────────────────────────────────────────────────────
   Fact & emotion extraction (additive only)
   ────────────────────────────────────────────────────────────── */
async function extractFacts(text) {
  const prompt = `
From the following text, extract any personal facts, events, secrets, or stable preferences about the speaker.
Also capture any explicit emotion they express.
Return ONLY strict JSON array; each item:
{
  "category": "name|likes|dislikes|pet|relationship|event|career|hobby|health|location|secret|other",
  "fact": "string",
  "sentiment": "happy|sad|angry|anxious|proud|hopeful|neutral",
  "confidence": 0.0-1.0
}
If nothing to save, return [].
Text: """${text}"""
  `.trim();

  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), OPENAI_TIMEOUT_MS);
  try {
    const completion = await client.chat.completions.create(
      {
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: "You are a precise extractor. Respond with valid JSON only; no prose." },
          { role: "user", content: prompt }
        ],
        temperature: 0
      },
      { signal: ac.signal }
    );

    try {
      const parsed = JSON.parse(completion.choices[0].message.content);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return [];
  } finally {
    clearTimeout(to);
  }
}

async function extractEmotionPoint(text) {
  const prompt = `
Classify the speaker's current emotion and intensity from 0.0 to 1.0.
Return ONLY JSON: {"label":"happy|sad|angry|anxious|proud|hopeful|neutral","intensity":0.0-1.0}
Text: """${text}"""
  `.trim();

  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), OPENAI_TIMEOUT_MS);
  try {
    const completion = await client.chat.completions.create(
      {
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: "You are an emotion rater. Respond with strict JSON only." },
          { role: "user", content: prompt }
        ],
        temperature: 0
      },
      { signal: ac.signal }
    );

    try {
      const obj = JSON.parse(completion.choices[0].message.content);
      if (obj && typeof obj.label === "string") return obj;
    } catch {}
    return null;
  } finally {
    clearTimeout(to);
  }
}

/* ──────────────────────────────────────────────────────────────
   Persistence helpers (de-dupe/update + confidence/source)
   ────────────────────────────────────────────────────────────── */
// Fuzzy upsert using trigram similarity to find near-duplicate facts for this user & category
async function upsertFact(userId, fObj, sourceText) {
  const { category = null, fact, sentiment = null, confidence = null } = fObj;
  if (!fact) return;

  // Try to find an existing near-duplicate (same user & category, high similarity)
  const { rows } = await pool.query(
    `
    SELECT id, fact, similarity(lower(fact), lower($3)) AS sim
      FROM facts
     WHERE user_id = $1
       AND (category IS NOT DISTINCT FROM $2)
       AND similarity(lower(fact), lower($3)) > $4
     ORDER BY sim DESC
     LIMIT 1
    `,
    [userId, category, fact, FACT_DUP_SIM_THRESHOLD]
  );

  const now = new Date();
  const sourceExcerpt = redactSecrets((sourceText || "").slice(0, 280));

  if (rows.length) {
    // Update closest match (merge sentiment/confidence, refresh source & timestamp)
    await pool.query(
      `UPDATE facts
          SET sentiment  = COALESCE($2, sentiment),
              confidence = COALESCE($3, confidence),
              source     = $4,
              source_ts  = $5,
              updated_at = NOW()
        WHERE id = $1`,
      [rows[0].id, sentiment, confidence, sourceExcerpt, now]
    );
  } else {
    // New fact (fixed: aligned columns/values)
    await pool.query(
      `INSERT INTO facts (user_id, category, fact, sentiment, confidence, source, source_ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, category, fact, sentiment, confidence, sourceExcerpt, now]
    );
  }
}

async function saveFacts(userId, facts, sourceText) {
  for (const f of facts) await upsertFact(userId, f, sourceText);
}

// Recency + confidence ranking for retrieval
async function getFacts(userId) {
  const { rows } = await pool.query(
    `
    SELECT category,
           fact,
           sentiment,
           confidence,
           (1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - COALESCE(updated_at, created_at))) / 86400.0)) AS recency_factor,
           (COALESCE(confidence, 0) * $2) +
           ((1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - COALESCE(updated_at, created_at))) / 86400.0)) * $3) AS score
      FROM facts
     WHERE user_id = $1
     ORDER BY score DESC, COALESCE(updated_at, created_at) DESC
     LIMIT 60
    `,
    [userId, WEIGHT_CONFIDENCE, WEIGHT_RECENCY]
  );
  return rows;
}

async function saveEmotion(userId, emo, sourceText) {
  if (!emo) return;
  const intensity =
    typeof emo.intensity === "number"
      ? Math.max(0, Math.min(1, emo.intensity))
      : null;
  await pool.query(
    `INSERT INTO emotions (user_id, label, intensity, source)
     VALUES ($1, $2, $3, $4)`,
    [userId, emo.label, intensity, redactSecrets((sourceText || "").slice(0, 280))]
  );
}

async function getLatestEmotion(userId) {
  const { rows } = await pool.query(
    `SELECT label, intensity, created_at
       FROM emotions
      WHERE user_id=$1
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

/* ──────────────────────────────────────────────────────────────
   Chat endpoint (Ellie flow intact; only augmented)
   ────────────────────────────────────────────────────────────── */
app.post("/api/chat", async (req, res) => {
  try {
    const { message, userId = "default-user" } = req.body;

    // Basic validation & size cap
    if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_LEN) {
      return res.status(400).json({ error: "E_BAD_INPUT", message: "Invalid message" });
    }

    // 1) Extract in parallel
    const [extractedFacts, overallEmotion] = await Promise.all([
      extractFacts(message),
      extractEmotionPoint(message),
    ]);

    // 2) Persist (facts de-duped + emotion timeline)
    if (extractedFacts.length) await saveFacts(userId, extractedFacts, message);
    if (overallEmotion) await saveEmotion(userId, overallEmotion, message);

    // 3) Retrieve memory facts & latest moods
    const [storedFacts, latestMood, recentEmos] = await Promise.all([
      getFacts(userId),
      getLatestEmotion(userId),
      getRecentEmotions(userId, 5),
    ]);

    const factsLines = storedFacts.map(r => {
      const conf = r.confidence != null ? ` (conf ${Number(r.confidence).toFixed(2)})` : "";
      const emo  = r.sentiment && r.sentiment !== "neutral" ? ` [${r.sentiment}]` : "";
      return `- ${r.fact}${emo}${conf}`;
    });
    const factsSummary = factsLines.length ? `Known facts:\n${factsLines.join("\n")}` : "No stored facts yet.";

    const moodLine = latestMood
      ? `\nRecent mood: ${latestMood.label}${typeof latestMood.intensity === "number" ? ` (${latestMood.intensity.toFixed(2)})` : ""}.`
      : "";

    // (2) Mood carry-over — aggregate last emotions and (probabilistically) steer tone (subtle)
    const agg = aggregateMood(recentEmos);
    const applyMoodTone = randChance(PROB_MOOD_TONE);
    const moodStyle = applyMoodTone ? moodToStyle(agg.label, agg.avgIntensity) : null;

    // Build memory prompt (unchanged persona + soft hints)
    const history = getHistory(userId);
    const moodStyleBlock = moodStyle ? `\nTone hint (soft, do not override core persona): ${moodStyle}` : "";
    const memoryPrompt = {
      role: "system",
      content: `${history[0].content}\n\n${factsSummary}${moodLine}${moodStyleBlock}`
    };

    const fullConversation = [memoryPrompt, ...history.slice(1)];
    fullConversation.push({ role: "user", content: message });

    // OpenAI call with timeout via AbortController
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), OPENAI_TIMEOUT_MS);
    let reply;
    try {
      const completion = await client.chat.completions.create(
        {
          model: CHAT_MODEL,
          messages: fullConversation,
          temperature: 0.9,
          top_p: 0.9,
        },
        { signal: ac.signal }
      );
      reply = (completion.choices?.[0]?.message?.content || "").trim();
    } finally {
      clearTimeout(to);
    }

    // Post-processing: subtle, non-stacking humanization
    let finalReply = reply;

    // Decide which “human” add-ons may apply this turn.
    let didHeavyAddon = false;

    // (7) Simulated free will — only when user message matches cues, and not in happy+low intensity
    if (!didHeavyAddon && randChance(PROB_FREEWILL)) {
      const refusal = addPlayfulRefusal(message, agg.label);
      if (refusal && !(agg.label === "happy" && agg.avgIntensity < 0.5)) {
        finalReply = `${refusal}\n\n${finalReply}`;
        didHeavyAddon = true;
      }
    }

    // (3) Callback reference — DISABLED to avoid unnatural insertions
    // if (!didHeavyAddon && randChance(PROB_CALLBACK) && shouldUseCallback(userId, message)) {
    //   const fresh = pickFreshFact(userId, storedFacts);
    //   if (fresh) {
    //     finalReply = weaveCallbackInto(finalReply, fresh);
    //     lastCallbackState.set(userId, { fact: fresh, ts: Date.now(), turn: getTurnCount(userId) });
    //     didHeavyAddon = true;
    //   }
    // }

    // (4) Small quirks — very light, and cap emojis
    if (randChance(PROB_QUIRKS)) {
      finalReply = casualize(finalReply);
      finalReply = insertFavoriteEmoji(finalReply);
      finalReply = capOneEmoji(finalReply);
    }

    // (5) Controlled imperfection — REMOVED (no longer used)

    // Final cleanup: remove duplicate lines; keep output tidy
    finalReply = dedupeLines(finalReply);

    // Push to per-user history (bounded)
    pushToHistory(userId, { role: "user", content: message });
    pushToHistory(userId, { role: "assistant", content: finalReply });

    res.json({ reply: finalReply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "E_INTERNAL", message: "Something went wrong" });
  }
});

// Optional reset (kept functionally similar)
app.post("/api/reset", (req, res) => {
  const { userId = "default-user" } = req.body || {};
  histories.set(userId, [{ role: "system", content: ELLIE_SYSTEM_PROMPT }]);
  res.json({ status: "Conversation reset" });
});

// ADDED: simple database connectivity test endpoint (safe to remove later)
app.get("/api/test-db", async (_req, res) => { // ADDED
  try {
    const { rows } = await pool.query("SELECT NOW() AS now"); // ADDED
    res.json({ ok: true, now: rows?.[0]?.now || null }); // ADDED
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message }); // ADDED
  }
}); // ADDED

// ADDED: graceful shutdown (so Render restarts don’t leak connections)
function shutdown(signal) { // ADDED
  console.log(`\n${signal} received. Closing DB pool...`); // ADDED
  pool.end(() => { // ADDED
    console.log("DB pool closed. Exiting."); // ADDED
    process.exit(0); // ADDED
  }); // ADDED
} // ADDED
process.on("SIGTERM", () => shutdown("SIGTERM")); // ADDED
process.on("SIGINT", () => shutdown("SIGINT"));   // ADDED

// Start server (UNCHANGED)
app.listen(PORT, () => {
  console.log(`🚀 Ellie API running at http://localhost:${PORT}`);
});
