// server/index.js  (drop-in replacement with voiceMode chooser)

const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();
const OpenAI = require("openai");
const { Pool } = require("pg");

// ADDED: for audio uploads (no files on disk)
const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});
const { toFile } = require("openai/uploads");

// ADDED: http server + websockets (for always-on voice mode)
const http = require("http");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

// ADDED: trust proxy so req.ip, secure cookies, etc. behave behind Render/other proxies
app.set("trust proxy", 1);

/* ──────────────────────────────────────────────────────────────
   ULTRA-EARLY HEALTH ROUTES (added before any heavy setup)
   ────────────────────────────────────────────────────────────── */
app.get("/", (_req, res) => res.type("text/plain").send("ok"));
app.get("/api", (_req, res) => res.type("text/plain").send("ok"));
app.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));
app.get("/api/healthz", (_req, res) => res.type("text/plain").send("ok"));

/* ──────────────────────────────────────────────────────────────
   CORS (configured BEFORE any other routes)
   ────────────────────────────────────────────────────────────── */
const defaultAllowed = [
  "https://ellie-web-ochre.vercel.app",
  "https://ellie-web.vercel.app",
  "http://localhost:3000",
  // ADDED: your Render backend origin so direct hits don’t get blocked
  "https://ellie-api-1.onrender.com",
];
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(s => s.trim()).filter(Boolean)
  : defaultAllowed;

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.options("*", cors());

/* ──────────────────────────────────────────────────────────────
   Config
   ────────────────────────────────────────────────────────────── */
const CHAT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 15000);
const MAX_MESSAGE_LEN = Number(process.env.MAX_MESSAGE_LEN || 4000);

// Base TTS voice (can be overridden per-user via preset)
const DEFAULT_VOICE = process.env.ELLIE_VOICE || "alloy";

// Simple presets (NO FX). We only map a vibe → OpenAI base voice.
const PRESET_TO_VOICE = {
  natural: "sage",   // neutral/clean
  warm:    "alloy",  // slightly warmer tone
  soft:    "ballad", // softer/rounder
  bright:  "nova",   // brighter/airier
};
function validPresetName(name) {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(PRESET_TO_VOICE, name);
}

// Probabilities & misc (kept; used by Ellie’s personality)
const FACT_DUP_SIM_THRESHOLD = Number(process.env.FACT_DUP_SIM_THRESHOLD || 0.8);
const WEIGHT_CONFIDENCE = Number(process.env.WEIGHT_CONFIDENCE || 0.6);
const WEIGHT_RECENCY = Number(process.env.WEIGHT_RECENCY || 0.4);
const PROB_MOOD_TONE = Number(process.env.PROB_MOOD_TONE || 0.25);
const PROB_CALLBACK = Number(process.env.PROB_CALLBACK || 0.25);
const PROB_QUIRKS = Number(process.env.PROB_QUIRKS || 0.25);
const PROB_IMPERFECTION = Number(process.env.PROB_IMPERFECTION || 0.2);
const PROB_FREEWILL = Number(process.env.PROB_FREEWILL || 0.25);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Health checks (kept — later duplicates are fine, early ones respond first)
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.head("/healthz", (_req, res) => res.status(200).end());
app.get("/api/healthz", (_req, res) => res.status(200).send("ok"));
app.head("/api/healthz", (_req, res) => res.status(200).end());

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
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

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
  await pool.query(`ALTER TABLE facts ADD COLUMN IF NOT EXISTS confidence REAL;`);
  await pool.query(`ALTER TABLE facts ADD COLUMN IF NOT EXISTS source TEXT;`);
  await pool.query(`ALTER TABLE facts ADD COLUMN IF NOT EXISTS source_ts TIMESTAMP;`);
  await pool.query(`ALTER TABLE facts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;`);
  await pool.query(`UPDATE facts SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL;`);

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
   Ellie system prompt (kept)
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

const histories = new Map(); // userId -> [{role, content}, ...]
const MAX_HISTORY_MESSAGES = 40;

function getHistory(userId) {
  if (!histories.has(userId)) {
    histories.set(userId, [{ role: "system", content: ELLIE_SYSTEM_PROMPT }]);
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
   Helpers (kept)
   ────────────────────────────────────────────────────────────── */
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
function getTurnCount(userId) {
  const h = histories.get(userId) || [];
  return Math.max(0, h.length - 1);
}
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
function shouldUseCallback(userId, userMsg) {
  if ((userMsg || "").trim.length < 4) return false;
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
function pickFreshFact(userId, storedFacts) {
  if (!storedFacts || !storedFacts.length) return null;
  const last = lastCallbackState.get(userId);
  const candidates = storedFacts.map(f => f?.fact).filter(Boolean)
    .filter(f => !last || f.toLowerCase() !== last.fact?.toLowerCase());
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
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

/* ──────────────────────────────────────────────────────────────
   Language support (kept)
   ────────────────────────────────────────────────────────────── */
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

/* ──────────────────────────────────────────────────────────────
   Fact & emotion extraction (kept)
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
  } finally { clearTimeout(to); }
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
  } finally { clearTimeout(to); }
}

/* ──────────────────────────────────────────────────────────────
   Persistence helpers (kept)
   ────────────────────────────────────────────────────────────── */
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

/* ──────────────────────────────────────────────────────────────
   Voice PRESET storage (kept) + mapping helpers
   ────────────────────────────────────────────────────────────── */
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
async function getEffectiveVoiceForUser(userId, fallbackVoice = DEFAULT_VOICE) {
  try {
    const preset = await getVoicePreset(userId);
    if (preset && PRESET_TO_VOICE[preset]) return PRESET_TO_VOICE[preset];
  } catch {}
  return fallbackVoice;
}

/* ──────────────────────────────────────────────────────────────
   Ellie reply generator (kept — unchanged behavior)
   ────────────────────────────────────────────────────────────── */
async function generateEllieReply({ userId, userText }) {
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

  const history = getHistory(userId);
  const memoryPrompt = {
    role: "system",
    content: `${history[0].content}\n\n${languageRules}\n\n${factsSummary}${moodLine}${moodStyle ? `\n${moodStyle}` : ""}\n\n${VOICE_MODE_HINT}`
  };

  const fullConversation = [memoryPrompt, ...history.slice(1), { role: "user", content: userText }];

  const completion = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: fullConversation,
    temperature: 0.6,
    top_p: 0.9,
  });

  let reply = (completion.choices?.[0]?.message?.content || "").trim();

  let finalReply = reply;

  if (randChance(PROB_FREEWILL)) {
    const refusal = addPlayfulRefusal(userText, aggregateMood(recentEmos).label);
    if (refusal && !(aggregateMood(recentEmos).label === "happy" && aggregateMood(recentEmos).avgIntensity < 0.5)) {
      finalReply = `${refusal}\n\n${finalReply}`;
    }
  }

  if (randChance(PROB_QUIRKS)) {
    finalReply = casualize(finalReply);
    finalReply = insertFavoriteEmoji(finalReply);
    finalReply = capOneEmoji(finalReply);
  }

  finalReply = dedupeLines(finalReply);

  pushToHistory(userId, { role: "user", content: userText });
  pushToHistory(userId, { role: "assistant", content: finalReply });

  return { reply: finalReply, language: prefLang };
}

/* ──────────────────────────────────────────────────────────────
   NEW: voiceMode chooser (heuristics only; cheap + fast)
   ────────────────────────────────────────────────────────────── */
function getTtsModelForVoiceMode(voiceMode) {
  return voiceMode === "full" ? "gpt-4o-tts" : "gpt-4o-mini-tts";
}

function decideVoiceMode({ replyText }) {
  const text = (replyText || "").trim();

  // 1) Long replies → full
  if (text.length > 280) return { voiceMode: "full", reason: "long reply (>280 chars)" };

  // 2) Obvious storytelling / reading vibes
  if (/(story|once upon a time|bedtime|narrate|read this|poem|monologue|letter)/i.test(text)) {
    return { voiceMode: "full", reason: "storytelling keyword" };
  }

  // 3) Emotional support phrases
  if (/(i care|i love|i miss you|i'm proud|i'm sorry|breathe with me|it’s okay|I’m here)/i.test(text)) {
    return { voiceMode: "full", reason: "emotional cue" };
  }

  // 4) Two+ sentences often benefit from richer prosody
  const sentenceCount = (text.match(/[.!?](\s|$)/g) || []).length;
  if (sentenceCount >= 3) return { voiceMode: "full", reason: "multi-sentence reply" };

  // Default: mini
  return { voiceMode: "mini", reason: "short/casual" };
}

/* ──────────────────────────────────────────────────────────────
   Chat endpoint (kept)
   ────────────────────────────────────────────────────────────── */
app.post("/api/chat", async (req, res) => {
  try {
    const { message, userId = "default-user" } = req.body;

    if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_LEN) {
      return res.status(400).json({ error: "E_BAD_INPUT", message: "Invalid message" });
    }

    const [extractedFacts, overallEmotion] = await Promise.all([
      extractFacts(message),
      extractEmotionPoint(message),
    ]);

    if (extractedFacts.length) await saveFacts(userId, extractedFacts, message);
    if (overallEmotion) await saveEmotion(userId, overallEmotion, message);

    const { reply, language } = await generateEllieReply({ userId, userText: message });

    res.json({ reply, language });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "E_INTERNAL", message: "Something went wrong" });
  }
});

/* ──────────────────────────────────────────────────────────────
   Maintenance + language endpoints (kept + get-language)
   ────────────────────────────────────────────────────────────── */
app.post("/api/reset", (req, res) => {
  const { userId = "default-user" } = req.body || {};
  histories.set(userId, [{ role: "system", content: ELLIE_SYSTEM_PROMPT }]);
  res.json({ status: "Conversation reset" });
});
app.get("/api/test-db", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT NOW() AS now");
    res.json({ ok: true, now: rows?.[0]?.now || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.get("/api/multer-test", (_req, res) => {
  try {
    const version = require("multer/package.json").version;
    res.json({ ok: true, multerVersion: version });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// language endpoints
app.get("/api/get-language", async (req, res) => {
  try {
    const userId = String(req.query.userId || "default-user");
    const code = await getPreferredLanguage(userId);
    res.json({ language: code });
  } catch (e) {
    res.status(500).json({ error: "E_INTERNAL", message: e.message });
  }
});
app.post("/api/set-language", async (req, res) => {
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

/* ──────────────────────────────────────────────────────────────
   Voice PRESET endpoints (simple, no FX)
   ────────────────────────────────────────────────────────────── */
app.get("/api/get-voice-presets", async (_req, res) => {
  try {
    const presets = Object.keys(PRESET_TO_VOICE).map(key => ({
      key,
      label: key[0].toUpperCase() + key.slice(1),
      voice: PRESET_TO_VOICE[key],
    }));
    res.json({ presets });
  } catch (e) {
    res.status(500).json({ error: "E_INTERNAL", message: String(e?.message || e) });
  }
});
app.get("/api/get-voice-preset", async (req, res) => {
  try {
    const userId = String(req.query.userId || "default-user");
    const preset = await getVoicePreset(userId);
    res.json({ preset: preset || null });
  } catch (e) {
    res.status(500).json({ error: "E_INTERNAL", message: String(e?.message || e) });
  }
});
app.post("/api/apply-voice-preset", async (req, res) => {
  try {
    const { userId = "default-user", preset } = req.body || {};
    if (!validPresetName(preset)) {
      return res.status(400).json({ error: "E_BAD_PRESET", message: "Unknown preset" });
    }
    await setVoicePreset(userId, preset);
    res.json({ ok: true, preset, voice: PRESET_TO_VOICE[preset] });
  } catch (e) {
    res.status(500).json({ error: "E_INTERNAL", message: String(e?.message || e) });
  }
});

// Back-compat: keep settings endpoints as NO-OPs so old UI doesn't break
app.get("/api/get-voice-settings", async (req, res) => {
  try {
    const userId = String(req.query.userId || "default-user");
    const preset = await getVoicePreset(userId);
    res.json({
      settings: null,
      preset: preset || null,
      note: "FX disabled: presets map to base voices only.",
    });
  } catch (e) {
    res.status(500).json({ error: "E_INTERNAL", message: String(e?.message || e) });
  }
});
app.post("/api/set-voice-settings", async (_req, res) => {
  res.json({ ok: true, note: "FX disabled; settings ignored." });
});

/* ──────────────────────────────────────────────────────────────
   Upload audio → Transcribe (kept) — returns raw text only
   ────────────────────────────────────────────────────────────── */
app.post("/api/upload-audio", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded. Field name must be 'audio'." });

    const okTypes = [
      "audio/webm","audio/ogg","audio/mpeg","audio/mp4","audio/wav","audio/x-wav",
    ];
    if (!okTypes.includes(req.file.mimetype)) {
      return res.status(415).json({ error: `Unsupported type ${req.file.mimetype}` });
    }

    const userId = (req.body?.userId || "default-user");

    let prefLang = await getPreferredLanguage(userId);
    const requestedLang = (req.body?.language || "").toLowerCase();
    if (requestedLang && SUPPORTED_LANGUAGES[requestedLang]) {
      prefLang = requestedLang;
      await setPreferredLanguage(userId, requestedLang);
    }
    if (!prefLang) prefLang = "en";

    const fileForOpenAI = await toFile(req.file.buffer, req.file.originalname || "audio.webm");
    const tr = await client.audio.transcriptions.create({
      model: "whisper-1",
      file: fileForOpenAI,
      language: prefLang,
    });

    res.json({ text: tr.text || "", language: prefLang });
  } catch (e) {
    console.error("upload-audio error:", e);
    res.status(500).json({ error: "TRANSCRIBE_FAILED", detail: String(e?.message || e) });
  }
});

/* ──────────────────────────────────────────────────────────────
   Voice chat (NO FX) — uses preset → base voice + voiceMode
   ────────────────────────────────────────────────────────────── */
app.post("/api/voice-chat", upload.single("audio"), async (req, res) => {
  try {
    const userId = (req.body?.userId || "default-user");

    const okTypes = ["audio/webm","audio/ogg","audio/mpeg","audio/mp4","audio/wav","audio/x-wav"];
    if (!req.file || !okTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: "E_BAD_AUDIO", message: "Upload audio/webm|ogg|mp3|m4a|wav ≤ 10MB" });
    }

    let prefLang = await getPreferredLanguage(userId);
    const requestedLang = (req.body?.language || "").toLowerCase();
    if (requestedLang && SUPPORTED_LANGUAGES[requestedLang]) {
      prefLang = requestedLang;
      await setPreferredLanguage(userId, requestedLang);
    }
    if (!prefLang) prefLang = "en";

    const fileForOpenAI = await toFile(req.file.buffer, req.file.originalname || "audio.webm");
    const tr = await client.audio.transcriptions.create({
      model: "whisper-1",
      file: fileForOpenAI,
      language: prefLang,
    });

    const userText = (tr.text || "").trim();
    if (!userText) {
      return res.status(200).json({ text: "", reply: "", language: prefLang, audioMp3Base64: null, voiceMode: "mini" });
    }

    const [extractedFacts, overallEmotion] = await Promise.all([
      extractFacts(userText),
      extractEmotionPoint(userText),
    ]);
    if (extractedFacts.length) await saveFacts(userId, extractedFacts, userText);
    if (overallEmotion) await saveEmotion(userId, overallEmotion, userText);

    const { reply, language } = await generateEllieReply({ userId, userText });

    // Decide voice mode for this reply
    const decision = decideVoiceMode({ replyText: reply });
    const model = getTtsModelForVoiceMode(decision.voiceMode);

    const chosenVoice = await getEffectiveVoiceForUser(userId, DEFAULT_VOICE);
    const speech = await client.audio.speech.create({
      model,
      voice: chosenVoice,
      input: reply,
      format: "mp3",
    });
    const ab = await speech.arrayBuffer();
    const audioMp3Base64 = Buffer.from(ab).toString("base64");

    res.json({ text: userText, reply, language, audioMp3Base64, voiceMode: decision.voiceMode, ttsModel: model });
  } catch (e) {
    console.error("voice-chat error:", e);
    res.status(500).json({ error: "VOICE_CHAT_FAILED", detail: String(e?.message || e) });
  }
});

/* ──────────────────────────────────────────────────────────────
   Text → Speech (MP3) with OpenAI TTS (NO FX) + voiceMode
   ────────────────────────────────────────────────────────────── */
app.post("/api/tts", async (req, res) => {
  try {
    const { text, voice, userId = "default-user", voiceMode } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing 'text' string in body." });
    }

    // Use client-provided voiceMode if valid; else decide heuristically
    const decision = (voiceMode === "full" || voiceMode === "mini")
      ? { voiceMode, reason: "client" }
      : decideVoiceMode({ replyText: text });

    const model = getTtsModelForVoiceMode(decision.voiceMode);
    const chosenVoice = voice || await getEffectiveVoiceForUser(userId, DEFAULT_VOICE);

    console.log(`[TTS] user=${userId} chars=${text.length} mode=${decision.voiceMode} model=${model} voice=${chosenVoice} reason=${decision.reason}`);

    const speech = await client.audio.speech.create({
      model,
      voice: chosenVoice,
      input: text,
      format: "mp3",
    });

    const ab = await speech.arrayBuffer();
    const buf = Buffer.from(ab);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-Voice-Mode", decision.voiceMode);
    res.setHeader("X-TTS-Model", model);
    return res.send(buf);
  } catch (e) {
    console.error("tts error:", e);
    res.status(500).json({ error: "TTS_FAILED", detail: String(e?.message || e) });
  }
});

/* ──────────────────────────────────────────────────────────────
   Quick voice preview (kept)
   ────────────────────────────────────────────────────────────── */
app.get("/api/tts-test/:voice", async (req, res) => {
  const voice = req.params.voice;
  try {
    const mp3 = await client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: "Hi, I’m Ellie. I can use different base voices like natural, warm, soft, or bright.",
      format: "mp3",
    });
    const ab = await mp3.arrayBuffer();
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(ab));
  } catch (e) {
    console.error("TTS test error:", e);
    res.status(500).json({ error: e.message || "TTS_TEST_FAILED" });
  }
});

/* ──────────────────────────────────────────────────────────────
   WebSocket voice sessions (always-on voice mode): /ws/voice
   (NO FX; uses preset → base voice + voiceMode)
   ────────────────────────────────────────────────────────────── */
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws/voice" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let userId = url.searchParams.get("userId") || "default-user";
  let sessionLang = null;
  let sessionVoice = DEFAULT_VOICE; // can be overridden by preset per message

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString("utf8"));

      if (msg.type === "hello") {
        userId = msg.userId || userId;
        if (typeof msg.voice === "string") sessionVoice = msg.voice;
        if (msg.preset && validPresetName(msg.preset)) await setVoicePreset(userId, msg.preset);
        const code = await getPreferredLanguage(userId);
        sessionLang = code || "en";
        ws.send(JSON.stringify({ type: "hello-ok", userId, language: sessionLang, voice: sessionVoice }));
        return;
      }

      if (msg.type === "audio" && msg.audio) {
        const mime = msg.mime || "audio/webm";
        const b = Buffer.from(msg.audio, "base64");

        const fileForOpenAI = await toFile(b, `chunk.${mime.includes("webm") ? "webm" : "wav"}`);
        const lang = sessionLang || (await getPreferredLanguage(userId)) || "en";
        const tr = await client.audio.transcriptions.create({
          model: "whisper-1",
          file: fileForOpenAI,
          language: lang,
        });
        const userText = (tr.text || "").trim();
        if (!userText) {
          ws.send(JSON.stringify({ type: "reply", text: "", reply: "", language: lang, audioMp3Base64: null, voiceMode: "mini" }));
          return;
        }

        const [facts, emo] = await Promise.all([extractFacts(userText), extractEmotionPoint(userText)]);
        if (facts.length) await saveFacts(userId, facts, userText);
        if (emo) await saveEmotion(userId, emo, userText);

        const { reply, language } = await generateEllieReply({ userId, userText });

        const decision = decideVoiceMode({ replyText: reply });
        const model = getTtsModelForVoiceMode(decision.voiceMode);

        const chosenVoice = await getEffectiveVoiceForUser(userId, sessionVoice || DEFAULT_VOICE);
        const speech = await client.audio.speech.create({
          model,
          voice: chosenVoice,
          input: reply,
          format: "mp3",
        });
        const ab = await speech.arrayBuffer();

        ws.send(JSON.stringify({
          type: "reply",
          text: userText,
          reply,
          language,
          audioMp3Base64: Buffer.from(ab).toString("base64"),
          voiceMode: decision.voiceMode,
          ttsModel: model
        }));
        return;
      }

      if (msg.type === "apply-preset" && validPresetName(msg.preset)) {
        await setVoicePreset(userId, msg.preset);
        ws.send(JSON.stringify({ type: "preset-ok", preset: msg.preset, voice: PRESET_TO_VOICE[msg.preset] }));
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

/* ──────────────────────────────────────────────────────────────
   graceful shutdown
   ────────────────────────────────────────────────────────────── */
function shutdown(signal) {
  console.log(`\n${signal} received. Closing DB pool...`);
  pool.end(() => {
    console.log("DB pool closed. Exiting.");
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Start server (HTTP + WS)
server.listen(PORT, () => {
  console.log(`🚀 Ellie API running at http://localhost:${PORT}`);
  console.log(`🔊 WebSocket voice at ws://localhost:${PORT}/ws/voice`);
});
