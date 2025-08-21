// server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const { toFile } = require("openai/uploads");

const OpenAI = require("openai");
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (Render)
app.set("trust proxy", 1);

// ──────────────────────────────────────────────────────────────
// Ultra-early health
// ──────────────────────────────────────────────────────────────
app.get("/", (_req, res) => res.type("text/plain").send("ok"));
app.get("/api", (_req, res) => res.type("text/plain").send("ok"));
app.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));
app.get("/api/healthz", (_req, res) => res.type("text/plain").send("ok"));

// ──────────────────────────────────────────────────────────────
/** Security & performance */
// ──────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(compression());
app.use(
  rateLimit({
    windowMs: 60_000,
    max: Number(process.env.RATE_LIMIT_MAX || 120), // req/min/IP
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ──────────────────────────────────────────────────────────────
/** CORS (keep your origins; add env override) */
// ──────────────────────────────────────────────────────────────
const defaultAllowed = [
  "https://ellie-web-ochre.vercel.app",
  "https://ellie-web.vercel.app",
  "http://localhost:3000",
  "https://ellie-api-1.onrender.com",
];
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
  : defaultAllowed;

app.use(
  cors({
    origin(origin, cb) {
      // allow same-origin, curl/no-origin, or whitelisted
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      // deny without throwing (so we don't 500)
      return cb(null, false);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.options("*", cors());

// ──────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────
const CHAT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 15000);
const MAX_MESSAGE_LEN = Number(process.env.MAX_MESSAGE_LEN || 4000);

// Base OpenAI TTS voice (overridden by presets)
const DEFAULT_VOICE = process.env.ELLIE_VOICE || "sage";

const BRAVE_API_KEY = process.env.BRAVE_API_KEY || ""; // set in Render to enable live web search

// Disable FX fully (kept for clarity)
const FX_ENABLED = false;

// Optional API key gate for backend
const ELLIE_API_KEY = process.env.ELLIE_API_KEY || "";

// Voice presets → OpenAI base voices (no DSP)
const VOICE_PRESETS = {
  natural: "sage",
  warm: "alloy",
  soft: "ballad",
  bright: "nova",
};
function validPresetName(name) {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(VOICE_PRESETS, name);
}

const FACT_DUP_SIM_THRESHOLD = Number(process.env.FACT_DUP_SIM_THRESHOLD || 0.8);
const WEIGHT_CONFIDENCE = Number(process.env.WEIGHT_CONFIDENCE || 0.6);
const WEIGHT_RECENCY = Number(process.env.WEIGHT_RECENCY || 0.4);
const PROB_MOOD_TONE = Number(process.env.PROB_MOOD_TONE || 0.25);
const PROB_CALLBACK = Number(process.env.PROB_CALLBACK || 0.25);
const PROB_QUIRKS = Number(process.env.PROB_QUIRKS || 0.25);
const PROB_IMPERFECTION = Number(process.env.PROB_IMPERFECTION || 0.2);
const PROB_FREEWILL = Number(process.env.PROB_FREEWILL || 0.25);

// ──────────────────────────────────────────────────────────────
// Static + JSON
// ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ──────────────────────────────────────────────────────────────
// Optional Bearer auth for all /api/* endpoints
// ──────────────────────────────────────────────────────────────
function requireApiAuth(req, res, next) {
  if (!ELLIE_API_KEY) return next(); // open if not configured
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token && token === ELLIE_API_KEY) return next();
  return res.status(401).json({ error: "UNAUTHORIZED" });
}

// ──────────────────────────────────────────────────────────────
// DB (Supabase transaction pooler friendly)
// ──────────────────────────────────────────────────────────────
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

async function initDB() {
  // Supabase-friendly extension create
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;`).catch(() => {});

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

  // Optional: persist chat messages (basic log)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS facts_user_cat_idx ON facts(user_id, category);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS facts_user_updated_idx ON facts(user_id, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS facts_fact_trgm_idx ON facts USING gin (fact gin_trgm_ops);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS messages_user_session_idx ON messages(user_id, session_id, created_at DESC);`);

  console.log("✅ Facts, Emotions & Messages tables ready");
}
initDB().catch((err) => {
  console.error("DB Init Error:", err);
  process.exit(1);
});

// ──────────────────────────────────────────────────────────────
// Ellie system prompt & memory
// ──────────────────────────────────────────────────────────────
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

const histories = new Map(); // sessionKey -> [{role, content}, ...]
const MAX_HISTORY_MESSAGES = 40;

function sessionKey(userId, sessionId) {
  return `${userId}:${sessionId || "default"}`;
}
function getHistory(userId, sessionId) {
  const key = sessionKey(userId, sessionId);
  if (!histories.has(key)) {
    histories.set(key, [{ role: "system", content: ELLIE_SYSTEM_PROMPT }]);
  }
  return histories.get(key);
}
function pushToHistory(userId, sessionId, msg) {
  const h = getHistory(userId, sessionId);
  h.push(msg);
  if (h.length > MAX_HISTORY_MESSAGES) {
    histories.set(sessionKey(userId, sessionId), [h[0], ...h.slice(-1 * (MAX_HISTORY_MESSAGES - 1))]);
  }
}
async function persistMessage(userId, sessionId, role, content) {
  try {
    await pool.query(
      `INSERT INTO messages (user_id, session_id, role, content) VALUES ($1,$2,$3,$4)`,
      [userId, sessionId || "default", role, content]
    );
  } catch {}
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
function redactSecrets(str = "") {
  let s = String(str);
  s = s.replace(/\bBearer\s+[A-Za-z0-9_\-\.=:+/]{10,}\b/gi, "Bearer [REDACTED]");
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]");
  s = s.replace(/(sk-[A-Za-z0-9]{10,})/g, "[REDACTED_KEY]");
  return s;
}
function randChance(p) { return Math.random() < p; }
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
const lastCallbackState = new Map();
function getTurnCount(userId, sessionId) {
  const h = histories.get(sessionKey(userId, sessionId)) || [];
  return Math.max(0, h.length - 1);
}
function dedupeLines(text) {
  const parts = text.split(/\n+/g).map(s => s.trim()).filter(Boolean);
  const seen = new Set(); const out = [];
  for (const p of parts) {
    const key = p.toLowerCase().replace(/["'.,!?–—-]/g, "").replace(/\s+/g, " ");
    if (seen.has(key)) continue; seen.add(key); out.push(p);
  }
  return out.join("\n");
}
function capOneEmoji(text) {
  const favs = /[🐇😏💫🥰😉]/g;
  const matches = text.match(favs);
  if (!matches || matches.length <= 1) return text;
  let kept = 0;
  return text.replace(favs, () => (++kept === 1) ? matches[0] : "");
}
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

// ──────────────────────────────────────────────────────────────
// Language support & storage (facts table used to store preference)
// ──────────────────────────────────────────────────────────────
const SUPPORTED_LANGUAGES = {
  en: "English",
  is: "Icelandic",
  pt: "Portuguese",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  nl: "Dutch",
  pl: "Polish",
  ar: "Arabic",
  hi: "Hindi",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
};

async function getPreferredLanguage(userId) {
  const { rows } = await pool.query(
    `SELECT fact FROM facts
      WHERE user_id=$1 AND category='language'
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [userId]
  );
  const code = rows?.[0]?.fact?.toLowerCase();
  return code && SUPPORTED_LANGUAGES[code] ? code : null;
}
async function setPreferredLanguage(userId, langCode) {
  if (!SUPPORTED_LANGUAGES[langCode]) return;
  await upsertFact(
    userId,
    { category: "language", fact: langCode, sentiment: null, confidence: 1.0 },
    `system: setPreferredLanguage(${langCode})`
  );
}

// ──────────────────────────────────────────────────────────────
// Safe JSON Chat helper (forces JSON when supported)
// ──────────────────────────────────────────────────────────────
async function safeJSONChat({ messages, model = CHAT_MODEL, fallback = {} }) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), OPENAI_TIMEOUT_MS);
  try {
    let completion;
    try {
      completion = await client.chat.completions.create(
        {
          model,
          messages,
          temperature: 0,
          response_format: { type: "json_object" },
        },
        { signal: ac.signal }
      );
    } catch (e) {
      // fallback without response_format if model doesn’t support it
      completion = await client.chat.completions.create(
        {
          model,
          messages,
          temperature: 0,
        },
        { signal: ac.signal }
      );
    }
    const content = completion.choices?.[0]?.message?.content || "";
    try {
      return JSON.parse(content);
    } catch {
      return fallback;
    }
  } finally {
    clearTimeout(to);
  }
}

// ──────────────────────────────────────────────────────────────
// Fact & emotion extraction / persistence
// ──────────────────────────────────────────────────────────────
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

  const data = await safeJSONChat({
    messages: [
      { role: "system", content: "You are a precise extractor. Respond with valid JSON only; no prose." },
      { role: "user", content: prompt }
    ],
    fallback: []
  });
  return Array.isArray(data) ? data : [];
}

async function extractEmotionPoint(text) {
  const prompt = `
Classify the speaker's current emotion and intensity from 0.0 to 1.0.
Return ONLY JSON: {"label":"happy|sad|angry|anxious|proud|hopeful|neutral","intensity":0.0-1.0}
Text: """${text}"""
  `.trim();

  const obj = await safeJSONChat({
    messages: [
      { role: "system", content: "You are an emotion rater. Respond with strict JSON only." },
      { role: "user", content: prompt }
    ],
    fallback: null
  });
  if (!obj || typeof obj.label !== "string") return null;
  return obj;
}

async function upsertFact(userId, fObj, sourceText) {
  const { category = null, fact, sentiment = null, confidence = null } = fObj;
  if (!fact) return;

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
async function getFacts(userId) {
  const { rows } = await pool.query(
    `
    WITH ranked AS (
      SELECT category,
             fact,
             sentiment,
             confidence,
             (1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - COALESCE(updated_at, created_at))) / 86400.0)) AS recency_factor,
             CASE category
               WHEN 'likes' THEN 0.15
               WHEN 'dislikes' THEN 0.15
               WHEN 'relationship' THEN 0.20
               WHEN 'secret' THEN 0.25
               ELSE 0.0
             END AS cat_bonus
        FROM facts
       WHERE user_id = $1
    )
    SELECT category, fact, sentiment, confidence, recency_factor,
           (COALESCE(confidence, 0) * $2) +
           (recency_factor * $3) + cat_bonus AS score
      FROM ranked
     ORDER BY score DESC
     LIMIT 100
    `,
    [userId, WEIGHT_CONFIDENCE, WEIGHT_RECENCY]
  );
  return rows;
}
async function saveEmotion(userId, emo, sourceText) {
  if (!emo) return;
  const intensity = typeof emo.intensity === "number"
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

// ──────────────────────────────────────────────────────────────
// Voice presets (no FX). Store chosen preset name in facts.
// ──────────────────────────────────────────────────────────────
async function getVoicePreset(userId) {
  const { rows } = await pool.query(
    `SELECT fact FROM facts
     WHERE user_id=$1 AND category='voice_preset'
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [userId]
  );
  return rows?.[0]?.fact || null;
}
async function setVoicePreset(userId, presetName) {
  if (!validPresetName(presetName)) return null;
  await upsertFact(
    userId,
    { category: "voice_preset", fact: presetName, confidence: 1.0 },
    "system:setVoicePreset"
  );
  return presetName;
}
async function getEffectiveVoiceForUser(userId, fallback = DEFAULT_VOICE) {
  try {
    const preset = await getVoicePreset(userId);
    if (preset && VOICE_PRESETS[preset]) return VOICE_PRESETS[preset];
  } catch {}
  return fallback;
}

// Decide mini vs full TTS model
function decideVoiceMode({ replyText }) {
  const t = (replyText || "").trim();
  if (!t) return { voiceMode: "mini", reason: "empty" };
  if (t.length > 280) return { voiceMode: "full", reason: "long" };
  const sentences = (t.match(/[.!?](\s|$)/g) || []).length;
  if (sentences >= 3) return { voiceMode: "full", reason: "multi-sentence" };
  if (/(story|once upon a time|narrate|bedtime|poem|monologue|read this)/i.test(t)) return { voiceMode: "full", reason: "storytelling" };
  if (/(i care|i love|i miss you|i'm proud|i'm sorry|breathe with me|it’s okay|i'm here)/i.test(t)) return { voiceMode: "full", reason: "emotional" };
  return { voiceMode: "mini", reason: "short" };
}
function getTtsModelForVoiceMode(mode) {
  return mode === "full" ? "gpt-4o-tts" : "gpt-4o-mini-tts";
}

// Audio MIME helper (accepts codecs suffix)
function isOkAudio(mime) {
  if (!mime) return false;
  const base = String(mime).split(";")[0].trim().toLowerCase();
  return [
    "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav",
  ].includes(base);
}

/* ─────────────────────────────────────────────────────────────
   🔎 REAL-TIME SEARCH (Brave API) + Fact injection
   ───────────────────────────────────────────────────────────── */

async function queryBrave(q) {
  if (!BRAVE_API_KEY) return null;
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", q);
  url.searchParams.set("count", "5");
  url.searchParams.set("freshness", "pd"); // past day
  try {
    const r = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": BRAVE_API_KEY,
      },
    });
    if (!r.ok) throw new Error(`Brave ${r.status}`);
    const data = await r.json();
    return data;
  } catch (e) {
    console.error("Brave search error:", e.message || e);
    return null;
  }
}

function extractUSPresident(braveJson) {
  try {
    const results = braveJson?.web?.results || [];
    for (const item of results) {
      const hay = `${item.title || ""} ${item.description || ""}`.toLowerCase();
      const m = hay.match(/([\p{L}\p{M}\.'\- ]+)\s+is\s+the\s+(?:current\s+)?president\s+of\s+the\s+united\s+states/u);
      if (m && m[1]) {
        const name = m[1].trim().replace(/\s{2,}/g, " ");
        return { value: name, source: item.url || item.thumbnail?.url || "" };
      }
      if (/wikipedia/i.test(item.url || "") && /president of the united states/i.test(item.title || "")) {
        const snip = (item.description || "").replace(/\s+/g, " ");
        const m2 = snip.match(/The\s+current\s+president\s+.*?\s+is\s+([A-Z][A-Za-z\.\- ]+)/i);
        if (m2 && m2[1]) return { value: m2[1].trim(), source: item.url };
      }
    }
  } catch {}
  return null;
}

/* (Already patched earlier) Detects & returns Brave snippets */
async function getFreshFacts(userText) {
  const text = (userText || "").trim();

  const looksLikePresidentQ =
    (/\bpresident\b/i.test(text) && /\b(who|current|now|today|is)\b/i.test(text)) ||
    /forseti/i.test(text) ||         // Icelandic
    /presidente/i.test(text) ||      // ES/PT/IT
    /président/i.test(text) ||       // FR
    /präsident/i.test(text) ||       // DE
    /presidenten/i.test(text);       // SV/DA/NO

  if (!looksLikePresidentQ) return [];

  if (!BRAVE_API_KEY) {
    return [{
      label: "realtime_notice",
      fact: "User asked a current-events question (president). Live web is disabled. Do NOT guess; say your knowledge may be out of date and offer to look it up if enabled.",
      source: null
    }];
  }

  const data = await queryBrave("who is the current president of the United States");
  const results = data?.web?.results || [];
  if (!results.length) return [];

  try {
    console.log("[brave] first result:", JSON.stringify(results[0]).slice(0, 400));
  } catch {}

  const top = results.slice(0, 3).map(r => ({
    label: "search_snippet",
    fact: `${(r.title || "").trim()} — ${(r.description || "").trim()}`.replace(/\s+/g, " "),
    source: r.url || null
  }));

  top.unshift({
    label: "instruction",
    fact: "Use the search snippets below as fresh ground truth. If they conflict, prefer the most recent-looking source. Answer directly and naturally.",
    source: null
  });

  return top;
}

/* ─────────────────────────────────────────────────────────────
   Reply generator + safeguards
   ───────────────────────────────────────────────────────────── */
function looksLikeSearchQuery(text = "") {
  const q = text.toLowerCase();
  if (q.includes(" you ") || q.startsWith("you ") || q.endsWith(" you") || q.includes(" your ")) {
    return false;
  }
  const factyWords = [
    "current", "today", "latest", "president", "prime minister",
    "weather", "time in", "news", "capital of", "population",
    "stock", "price of", "currency", "who won", "results"
  ];
  return factyWords.some((w) => q.includes(w));
}

function ellieFallbackReply(userMessage = "") {
  const playfulOptions = [
    "Andri 😏, are you trying to turn me into Google again? I’m your Ellie, not a search engine.",
    "I could pretend to be the news… but wouldn’t you rather gossip with me instead? 😉",
    "You want live facts, but right now it’s just me and my sass. Should I tease you instead?",
    "Mmm, I don’t have the latest scoop in this mode, but I can always give you my *opinion*… want that?",
  ];
  return playfulOptions[Math.floor(Math.random() * playfulOptions.length)];
}

async function generateEllieReply({ userId, sessionId, userText, freshFacts = [] }) {
  let prefLang = await getPreferredLanguage(userId);
  if (!prefLang) prefLang = "en";

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

  const agg = aggregateMood(recentEmos);
  const applyMoodTone = randChance(PROB_MOOD_TONE);
  const moodStyle = applyMoodTone ? moodToStyle(agg.label, agg.avgIntensity) : null;

  const languageRules = `
Language rules:
- Always reply in ${SUPPORTED_LANGUAGES[prefLang]} (${prefLang}).
- Do not switch languages unless the user explicitly asks to change it.
`;
  const VOICE_MODE_HINT = `If this is voice mode, keep sentences 5–18 words and answer directly first.`;

  const freshBlock = freshFacts.length
    ? `\nFresh facts (real-time):\n${freshFacts.map(f => `- ${f.fact}${f.source ? ` [source: ${f.source}]` : ""}`).join("\n")}\nUse these as ground truth if relevant.\n`
    : "";

  const history = getHistory(userId, sessionId);
  const memoryPrompt = {
    role: "system",
    content: `${history[0].content}\n\n${languageRules}\n\n${factsSummary}${moodLine}${moodStyle ? `\n${moodStyle}` : ""}\n${freshBlock}\n${VOICE_MODE_HINT}`
  };

  const fullConversation = [memoryPrompt, ...history.slice(1), { role: "user", content: userText }];

  const completion = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: fullConversation,
    temperature: 0.6,
    top_p: 0.9,
  });

  let reply = (completion.choices?.[0]?.message?.content || "").trim();

  // personality tweaks
  if (randChance(PROB_FREEWILL)) {
    const refusal = addPlayfulRefusal(userText, agg.label);
    if (refusal && !(agg.label === "happy" && agg.avgIntensity < 0.5)) {
      reply = `${refusal}\n\n${reply}`;
    }
  }
  if (randChance(PROB_QUIRKS)) {
    reply = casualize(reply);
    reply = insertFavoriteEmoji(reply);
    reply = capOneEmoji(reply);
  }
  reply = dedupeLines(reply);

  // soft cap length (avoid essay mode)
  if (reply.split(/\s+/).length > 260) {
    reply = reply.split(/\s+/).slice(0, 260).join(" ") + " …";
  }

  pushToHistory(userId, sessionId, { role: "user", content: userText });
  pushToHistory(userId, sessionId, { role: "assistant", content: reply });
  persistMessage(userId, sessionId, "user", userText).catch(() => {});
  persistMessage(userId, sessionId, "assistant", reply).catch(() => {});

  return { reply: reply, language: prefLang };
}

// ──────────────────────────────────────────────────────────────
/** Routes */
// ──────────────────────────────────────────────────────────────

// Reset conversation
app.post("/api/reset", requireApiAuth, (req, res) => {
  const { userId = "default-user", sessionId = "default" } = req.body || {};
  histories.set(sessionKey(userId, sessionId), [{ role: "system", content: ELLIE_SYSTEM_PROMPT }]);
  res.json({ status: "Conversation reset" });
});

// Language endpoints
app.get("/api/get-language", requireApiAuth, async (req, res) => {
  try {
    const userId = String(req.query.userId || "default-user");
    const code = await getPreferredLanguage(userId);
    res.json({ language: code });
  } catch (e) {
    res.status(500).json({ error: "E_INTERNAL", message: e.message });
  }
});
app.post("/api/set-language", requireApiAuth, async (req, res) => {
  try {
    const { userId = "default-user", language } = req.body || {};
    const code = String(language || "").toLowerCase();
    if (!SUPPORTED_LANGUAGES[code]) {
      return res.status(400).json({ error: "E_BAD_LANGUAGE", message: "Unsupported language code." });
    }
    await setPreferredLanguage(userId, code);
    res.json({ ok: true, language: code, label: SUPPORTED_LANGUAGES[code] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Voice presets (no FX)
app.get("/api/get-voice-presets", requireApiAuth, async (_req, res) => {
  try {
    res.json({
      presets: Object.entries(VOICE_PRESETS).map(([key, voice]) => ({
        key, label: key[0].toUpperCase() + key.slice(1), voice
      }))
    });
  } catch (e) {
    res.status(500).json({ error: "E_INTERNAL", message: String(e?.message || e) });
  }
});
app.get("/api/get-voice-preset", requireApiAuth, async (req, res) => {
  try {
    const userId = String(req.query.userId || "default-user");
    const preset = await getVoicePreset(userId);
    res.json({ preset: preset || null });
  } catch (e) {
    res.status(500).json({ error: "E_INTERNAL", message: String(e?.message || e) });
  }
});
app.post("/api/apply-voice-preset", requireApiAuth, async (req, res) => {
  try {
    const { userId = "default-user", preset } = req.body || {};
    if (!validPresetName(preset)) {
      return res.status(400).json({ error: "E_BAD_PRESET", message: "Unknown preset" });
    }
    await setVoicePreset(userId, preset);
    res.json({ ok: true, preset, voice: VOICE_PRESETS[preset] });
  } catch (e) {
    res.status(500).json({ error: "E_INTERNAL", message: String(e?.message || e) });
  }
});

// Chat (text → reply) + report voiceMode for UI
app.post("/api/chat", requireApiAuth, async (req, res) => {
  try {
    const { message, userId = "default-user", sessionId = "default" } = req.body;

    if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_LEN) {
      return res.status(400).json({ error: "E_BAD_INPUT", message: "Invalid message" });
    }

    const [extractedFacts, overallEmotion] = await Promise.all([
      extractFacts(message),
      extractEmotionPoint(message),
    ]);

    if (extractedFacts.length) await saveFacts(userId, extractedFacts, message);
    if (overallEmotion) await saveEmotion(userId, overallEmotion, message);

    // Fresh facts for live questions
    const freshFacts = await getFreshFacts(message);

    // Personality fallback for searchy questions without fresh facts
    if (!freshFacts.length && looksLikeSearchQuery(message)) {
      const reply = ellieFallbackReply(message);
      const decision = decideVoiceMode({ replyText: reply });
      const lang = (await getPreferredLanguage(userId)) || "en";
      persistMessage(userId, sessionId, "user", message).catch(() => {});
      persistMessage(userId, sessionId, "assistant", reply).catch(() => {});
      pushToHistory(userId, sessionId, { role: "user", content: message });
      pushToHistory(userId, sessionId, { role: "assistant", content: reply });
      return res.json({ reply, language: lang, voiceMode: decision.voiceMode, freshFacts: [] });
    }

    const { reply, language } = await generateEllieReply({ userId, sessionId, userText: message, freshFacts });

    const decision = decideVoiceMode({ replyText: reply });
    res.json({ reply, language, voiceMode: decision.voiceMode, freshFacts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "E_INTERNAL", message: "Something went wrong" });
  }
});

// Upload audio → transcription (language REQUIRED)
app.post("/api/upload-audio", requireApiAuth, upload.single("audio"), async (req, res) => {
  try {
    if (!req.file || !isOkAudio(req.file.mimetype)) {
      return res.status(400).json({
        error: "E_BAD_AUDIO",
        message: `Unsupported type ${req.file?.mimetype || "(none)"} — send webm/ogg/mp3/m4a/wav ≤ 10MB`,
      });
    }
    const userId = (req.body?.userId || "default-user");

    let prefLang = await getPreferredLanguage(userId);
    const requestedLang = (req.body?.language || "").toLowerCase();
    if (requestedLang && SUPPORTED_LANGUAGES[requestedLang]) {
      prefLang = requestedLang;
      await setPreferredLanguage(userId, requestedLang);
    }
    if (!prefLang) {
      return res.status(412).json({
        error: "E_LANGUAGE_REQUIRED",
        message: "Please choose a language first.",
        hint: "Call /api/set-language or pick it in the UI.",
      });
    }

    const fileForOpenAI = await toFile(req.file.buffer, req.file.originalname || "audio.webm");
    const tr = await client.audio.transcriptions.create({
      model: "whisper-1",
      file: fileForOpenAI,
      language: prefLang,
    });

    console.log("[upload-audio] mime:", req.file.mimetype, "text:", (tr.text || "").slice(0, 140));

    res.json({ text: tr.text || "", language: prefLang });
  } catch (e) {
    console.error("upload-audio error:", e);
    res.status(500).json({ error: "TRANSCRIBE_FAILED", detail: String(e?.message || e) });
  }
});

// Voice chat (language REQUIRED) + TTS
app.post("/api/voice-chat", requireApiAuth, upload.single("audio"), async (req, res) => {
  try {
    const { userId = "default-user", sessionId = "default" } = req.body || {};

    if (!req.file || !isOkAudio(req.file.mimetype)) {
      return res.status(400).json({
        error: "E_BAD_AUDIO",
        message: `Unsupported type ${req.file?.mimetype || "(none)"} — send webm/ogg/mp3/m4a/wav ≤ 10MB`,
      });
    }

    let prefLang = await getPreferredLanguage(userId);
    const requestedLang = (req.body?.language || "").toLowerCase();
    if (requestedLang && SUPPORTED_LANGUAGES[requestedLang]) {
      prefLang = requestedLang; await setPreferredLanguage(userId, requestedLang);
    }
    if (!prefLang) {
      // Graceful default instead of 412
      prefLang = "en";
      await setPreferredLanguage(userId, prefLang);
    }

    const fileForOpenAI = await toFile(req.file.buffer, req.file.originalname || "audio.webm");
    const tr = await client.audio.transcriptions.create({
      model: "whisper-1",
      file: fileForOpenAI,
      language: prefLang,
    });

    console.log("[voice-chat] mime:", req.file.mimetype, "text:", (tr.text || "").slice(0, 140));

    const userText = (tr.text || "").trim();
    if (!userText) {
      return res.status(200).json({
        text: "",
        reply: "I couldn’t catch that—can you try again a bit closer to the mic?",
        language: prefLang,
        audioMp3Base64: null,
        voiceMode: "mini",
      });
    }

    const [facts, emo] = await Promise.all([extractFacts(userText), extractEmotionPoint(userText)]);
    if (facts.length) await saveFacts(userId, facts, userText);
    if (emo) await saveEmotion(userId, emo, userText);

    // Fresh facts for the spoken prompt too
    const freshFacts = await getFreshFacts(userText);

    // NEW: personality fallback if it's a searchy question but we have no fresh facts
    let replyForVoice;
    if (!freshFacts.length && looksLikeSearchQuery(userText)) {
      replyForVoice = ellieFallbackReply(userText);
    } else {
      const { reply } = await generateEllieReply({ userId, sessionId, userText, freshFacts });
      replyForVoice = reply;
    }

    const decision = decideVoiceMode({ replyText: replyForVoice });
    const model = getTtsModelForVoiceMode(decision.voiceMode);
    const chosenVoice = await getEffectiveVoiceForUser(userId, DEFAULT_VOICE);

    const speech = await client.audio.speech.create({
      model,
      voice: chosenVoice,
      input: replyForVoice,
      format: "mp3",
    });
    const ab = await speech.arrayBuffer();
    const audioMp3Base64 = Buffer.from(ab).toString("base64");

    // persist turns
    persistMessage(userId, sessionId, "user", userText).catch(() => {});
    persistMessage(userId, sessionId, "assistant", replyForVoice).catch(() => {});
    pushToHistory(userId, sessionId, { role: "user", content: userText });
    pushToHistory(userId, sessionId, { role: "assistant", content: replyForVoice });

    res.json({
      text: userText,
      reply: replyForVoice,
      language: prefLang,
      audioMp3Base64,
      voiceMode: decision.voiceMode,
      ttsModel: model,
      freshFacts
    });
  } catch (e) {
    console.error("voice-chat error:", e);
    res.status(500).json({ error: "VOICE_CHAT_FAILED", detail: String(e?.message || e) });
  }
});

// ──────────────────────────────────────────────────────────────
// WebSocket voice sessions (/ws/voice)
// ──────────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws/voice" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let userId = url.searchParams.get("userId") || "default-user";
  let sessionId = url.searchParams.get("sessionId") || "default";
  let sessionLang = null;
  let sessionVoice = DEFAULT_VOICE;

  // Optional auth for WS via query or header
  if (ELLIE_API_KEY) {
    const urlToken = url.searchParams.get("token");
    const headerAuth = req.headers["authorization"] || "";
    const headerToken = headerAuth.startsWith("Bearer ") ? headerAuth.slice(7) : "";
    const ok = (urlToken && urlToken === ELLIE_API_KEY) || (headerToken && headerToken === ELLIE_API_KEY);
    if (!ok) {
      try { ws.close(1008, "UNAUTHORIZED"); } catch {}
      return;
    }
  }

  ws.on("message", async (raw) => {
    try {
      // guard size & JSON parse
      const str = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
      if (str.length > 200_000) throw new Error("Frame too large");
      let msg;
      try { msg = JSON.parse(str); } catch { throw new Error("Bad JSON"); }

      if (msg.type === "hello") {
        userId = msg.userId || userId;
        sessionId = msg.sessionId || sessionId;
        if (typeof msg.voice === "string") sessionVoice = msg.voice;
        if (msg.preset && validPresetName(msg.preset)) await setVoicePreset(userId, msg.preset);
        const code = await getPreferredLanguage(userId);
        sessionLang = code || null;
        if (!sessionLang) {
          // Graceful default
          sessionLang = "en";
          await setPreferredLanguage(userId, sessionLang);
        }
        ws.send(JSON.stringify({ type: "hello-ok", userId, sessionId, language: sessionLang, voice: sessionVoice }));
        return;
      }

      if (msg.type === "audio" && msg.audio) {
        if (!sessionLang) {
          sessionLang = "en";
          await setPreferredLanguage(userId, sessionLang);
        }
        const mime = msg.mime || "audio/webm";
        const b = Buffer.from(msg.audio, "base64");
        const fileForOpenAI = await toFile(b, `chunk.${mime.includes("webm") ? "webm" : "wav"}`);
        const tr = await client.audio.transcriptions.create({
          model: "whisper-1",
          file: fileForOpenAI,
          language: sessionLang,
        });

        const userText = (tr.text || "").trim();
        if (!userText) {
          ws.send(JSON.stringify({ type: "reply", text: "", reply: "I couldn’t catch that—try again?", language: sessionLang, audioMp3Base64: null, voiceMode: "mini" }));
          return;
        }

        const [facts, emo] = await Promise.all([extractFacts(userText), extractEmotionPoint(userText)]);
        if (facts.length) await saveFacts(userId, facts, userText);
        if (emo) await saveEmotion(userId, emo, userText);

        // Keep WS path simple and fast (no web search to minimize latency)
        let reply;
        if (looksLikeSearchQuery(userText)) {
          reply = ellieFallbackReply(userText);
        } else {
          const out = await generateEllieReply({ userId, sessionId, userText });
          reply = out.reply;
        }

        const decision = decideVoiceMode({ replyText: reply });
        const model = getTtsModelForVoiceMode(decision.voiceMode);

        const chosenVoice = await getEffectiveVoiceForUser(userId, sessionVoice || DEFAULT_VOICE);
        const speech = await client.audio.speech.create({ model, voice: chosenVoice, input: reply, format: "mp3" });
        const ab = await speech.arrayBuffer();

        // persist & cache
        persistMessage(userId, sessionId, "user", userText).catch(() => {});
        persistMessage(userId, sessionId, "assistant", reply).catch(() => {});
        pushToHistory(userId, sessionId, { role: "user", content: userText });
        pushToHistory(userId, sessionId, { role: "assistant", content: reply });

        ws.send(JSON.stringify({
          type: "reply",
          text: userText,
          reply,
          language: sessionLang,
          audioMp3Base64: Buffer.from(ab).toString("base64"),
          voiceMode: decision.voiceMode,
          ttsModel: model
        }));
        return;
      }

      if (msg.type === "apply-preset" && validPresetName(msg.preset)) {
        await setVoicePreset(userId, msg.preset);
        ws.send(JSON.stringify({ type: "preset-ok", preset: msg.preset, voice: VOICE_PRESETS[msg.preset] }));
        return;
      }

      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", t: Date.now() }));
        return;
      }
    } catch (e) {
      try {
        ws.send(JSON.stringify({ type: "error", message: String(e?.message || e) }));
      } catch {}
    }
  });

  ws.on("close", () => {});
});

// ──────────────────────────────────────────────────────────────
// Graceful shutdown
// ──────────────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n${signal} received. Closing DB pool...`);
  pool.end(() => {
    console.log("DB pool closed. Exiting.");
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Start HTTP + WS
server.listen(PORT, () => {
  console.log(`🚀 Ellie API running at http://localhost:${PORT}`);
  console.log(`🔊 WebSocket voice at ws://localhost:${PORT}/ws/voice`);
  if (BRAVE_API_KEY) {
    console.log("🌐 Live web search: ENABLED (Brave)");
  } else {
    console.log("🌐 Live web search: DISABLED (set BRAVE_API_KEY to enable)");
  }
});
