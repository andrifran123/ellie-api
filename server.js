// server/index.js

const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();
const OpenAI = require("openai");
const { Pool } = require("pg");

// uploads
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const { toFile } = require("openai/uploads");

// http + ws
const http = require("http");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;
app.set("trust proxy", 1);

/* ─────────── health ─────────── */
app.get("/", (_req, res) => res.type("text/plain").send("ok"));
app.get("/api", (_req, res) => res.type("text/plain").send("ok"));
app.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));
app.get("/api/healthz", (_req, res) => res.type("text/plain").send("ok"));

/* ─────────── CORS ─────────── */
const defaultAllowed = [
  "https://ellie-web-ochre.vercel.app",
  "https://ellie-web.vercel.app",
  "http://localhost:3000",
  "https://ellie-api-1.onrender.com",
];
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(s => s.trim()).filter(Boolean)
  : defaultAllowed;

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.options("*", cors());

/* ─────────── Config ─────────── */
const CHAT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 15000);
const MAX_MESSAGE_LEN = Number(process.env.MAX_MESSAGE_LEN || 4000);

// Base TTS voice (can be overridden by preset)
const DEFAULT_VOICE = process.env.ELLIE_VOICE || "alloy";

// Presets → base OpenAI voices (no FX)
const PRESET_TO_VOICE = {
  natural: "sage",
  warm: "alloy",
  soft: "ballad",
  bright: "nova",
};
function validPresetName(n) { return typeof n === "string" && PRESET_TO_VOICE[n]; }

// voiceMode → TTS model
function getTtsModelForVoiceMode(mode) {
  return mode === "full" ? "gpt-4o-tts" : "gpt-4o-mini-tts";
}

// Cheap heuristic to choose mini/full (used across endpoints)
function decideVoiceMode({ replyText }) {
  const t = (replyText || "").trim();
  if (t.length > 280) return { voiceMode: "full", reason: "long reply" };
  if (/(story|once upon a time|narrate|bedtime|poem|monologue|read this)/i.test(t)) {
    return { voiceMode: "full", reason: "storytelling" };
  }
  if (/(i care|i love|i miss you|i'm proud|i'm sorry|breathe with me|it’s okay|i'm here)/i.test(t)) {
    return { voiceMode: "full", reason: "emotional" };
  }
  const sentences = (t.match(/[.!?](\s|$)/g) || []).length;
  if (sentences >= 3) return { voiceMode: "full", reason: "multi-sentence" };
  return { voiceMode: "mini", reason: "short/casual" };
}

// misc knobs (kept)
const FACT_DUP_SIM_THRESHOLD = Number(process.env.FACT_DUP_SIM_THRESHOLD || 0.8);
const WEIGHT_CONFIDENCE = Number(process.env.WEIGHT_CONFIDENCE || 0.6);
const WEIGHT_RECENCY = Number(process.env.WEIGHT_RECENCY || 0.4);
const PROB_MOOD_TONE = Number(process.env.PROB_MOOD_TONE || 0.25);
const PROB_CALLBACK = Number(process.env.PROB_CALLBACK || 0.25);
const PROB_QUIRKS = Number(process.env.PROB_QUIRKS || 0.25);
const PROB_IMPERFECTION = Number(process.env.PROB_IMPERFECTION || 0.2);
const PROB_FREEWILL = Number(process.env.PROB_FREEWILL || 0.25);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.head("/healthz", (_req, res) => res.status(200).end());
app.get("/api/healthz", (_req, res) => res.status(200).send("ok"));
app.head("/api/healthz", (_req, res) => res.status(200).end());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ─────────── DB ─────────── */
const { rows: _noop } = { rows: [] }; // lint quiet
const rawDbUrl = process.env.DATABASE_URL;
if (!rawDbUrl) {
  console.error("❌ Missing DATABASE_URL in .env");
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
  console.error("❌ Invalid DATABASE_URL:", rawDbUrl);
  throw e;
}
const { Pool } = require("pg");
const pool = new Pool(pgConfig);

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
    );`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS emotions (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL,
      intensity REAL,
      source TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );`);
  await pool.query(`CREATE INDEX IF NOT EXISTS facts_user_cat_idx ON facts(user_id, category);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS facts_user_updated_idx ON facts(user_id, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS facts_fact_trgm_idx ON facts USING gin (fact gin_trgm_ops);`);
  console.log("✅ Facts & Emotions tables ready");
}
initDB().catch(err => { console.error("DB Init Error:", err); process.exit(1); });

/* ─────────── Ellie prompt & memory ─────────── */
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
const histories = new Map();
const MAX_HISTORY_MESSAGES = 40;

function getHistory(userId) {
  if (!histories.has(userId)) histories.set(userId, [{ role: "system", content: ELLIE_SYSTEM_PROMPT }]);
  return histories.get(userId);
}
function pushToHistory(userId, msg) {
  const h = getHistory(userId); h.push(msg);
  if (h.length > MAX_HISTORY_MESSAGES) histories.set(userId, [h[0], ...h.slice(-1 * (MAX_HISTORY_MESSAGES - 1))]);
}

/* ─────────── helpers ─────────── */
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
  return text.replace(/\bkind of\b/gi, "kinda").replace(/\bgoing to\b/gi, "gonna").replace(/\bwant to\b/gi, "wanna");
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
async function getRecentEmotions(userId, n = 5) {
  const { rows } = await pool.query(
    `SELECT label, intensity, created_at FROM emotions WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, n]);
  return rows || [];
}
function aggregateMood(emotions) {
  if (!emotions.length) return { label: "neutral", avgIntensity: 0.3 };
  const weights = emotions.map((_, i) => (emotions.length - i));
  const bucket = {};
  emotions.forEach((e, i) => {
    const w = weights[i]; const label = e.label || "neutral";
    const intensity = typeof e.intensity === "number" ? e.intensity : 0.5;
    bucket[label] = (bucket[label] || 0) + w * intensity;
  });
  const top = Object.entries(bucket).sort((a, b) => b[1] - a[1])[0];
  const label = top ? top[0] : "neutral";
  const avgIntensity = emotions.reduce((a, e) => a + (typeof e.intensity === "number" ? e.intensity : 0.5), 0) / emotions.length;
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
  const intensifier = intensity > 0.7 ? "Lean into it a bit more than usual."
    : intensity < 0.3 ? "Keep it subtle."
    : "Keep it natural.";
  return `${soft} ${intensifier}`;
}

/* ─────────── language + facts ─────────── */
const SUPPORTED_LANGUAGES = {
  en: "English", is: "Icelandic", pt: "Portuguese", es: "Spanish", fr: "French",
  de: "German", it: "Italian", sv: "Swedish", da: "Danish", no: "Norwegian",
  nl: "Dutch", pl: "Polish", ar: "Arabic", hi: "Hindi", ja: "Japanese",
  ko: "Korean", zh: "Chinese",
};
async function getPreferredLanguage(userId) {
  const { rows } = await pool.query(
    `SELECT fact FROM facts WHERE user_id=$1 AND category='language' ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1`, [userId]);
  const code = rows?.[0]?.fact?.toLowerCase();
  return code && SUPPORTED_LANGUAGES[code] ? code : null;
}
async function setPreferredLanguage(userId, langCode) {
  if (!SUPPORTED_LANGUAGES[langCode]) return;
  await upsertFact(userId, { category: "language", fact: langCode, confidence: 1.0 }, "system:setPreferredLanguage");
}
async function upsertFact(userId, fObj, sourceText) {
  const { category = null, fact, sentiment = null, confidence = null } = fObj;
  if (!fact) return;
  const { rows } = await pool.query(
    `SELECT id, fact, similarity(lower(fact), lower($3)) AS sim
     FROM facts WHERE user_id=$1 AND (category IS NOT DISTINCT FROM $2)
     AND similarity(lower(fact), lower($3)) > $4
     ORDER BY sim DESC LIMIT 1`,
    [userId, category, fact, FACT_DUP_SIM_THRESHOLD]
  );
  const now = new Date();
  const sourceExcerpt = redactSecrets((sourceText || "").slice(0, 280));
  if (rows.length) {
    await pool.query(
      `UPDATE facts SET sentiment=COALESCE($2, sentiment), confidence=COALESCE($3, confidence),
       source=$4, source_ts=$5, updated_at=NOW() WHERE id=$1`,
      [rows[0].id, sentiment, confidence, sourceExcerpt, now]
    );
  } else {
    await pool.query(
      `INSERT INTO facts (user_id, category, fact, sentiment, confidence, source, source_ts)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, category, fact, sentiment, confidence, sourceExcerpt, now]
    );
  }
}
async function saveFacts(userId, facts, sourceText) { for (const f of facts) await upsertFact(userId, f, sourceText); }
async function getFacts(userId) {
  const { rows } = await pool.query(
    `SELECT category, fact, sentiment, confidence,
      (1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - COALESCE(updated_at, created_at))) / 86400.0)) AS recency_factor,
      (COALESCE(confidence,0) * $2) +
      ((1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - COALESCE(updated_at, created_at))) / 86400.0)) * $3) AS score
     FROM facts WHERE user_id=$1
     ORDER BY score DESC, COALESCE(updated_at, created_at) DESC
     LIMIT 60`,
    [userId, WEIGHT_CONFIDENCE, WEIGHT_RECENCY]
  );
  return rows;
}
async function saveEmotion(userId, emo, sourceText) {
  if (!emo) return;
  const intensity = typeof emo.intensity === "number" ? Math.max(0, Math.min(1, emo.intensity)) : null;
  await pool.query(`INSERT INTO emotions (user_id,label,intensity,source) VALUES ($1,$2,$3,$4)`,
    [userId, emo.label, intensity, redactSecrets((sourceText || "").slice(0, 280))]);
}
async function getLatestEmotion(userId) {
  const { rows } = await pool.query(
    `SELECT label, intensity, created_at FROM emotions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, [userId]);
  return rows[0] || null;
}

/* ─────────── Voice preset storage ─────────── */
async function getVoicePreset(userId) {
  const { rows } = await pool.query(
    `SELECT fact FROM facts WHERE user_id=$1 AND category='voice_preset'
     ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1`, [userId]);
  return rows?.[0]?.fact || null;
}
async function setVoicePreset(userId, preset) {
  if (!validPresetName(preset)) return null;
  await upsertFact(userId, { category: "voice_preset", fact: preset, confidence: 1.0 }, "system:setVoicePreset");
  return preset;
}
async function getEffectiveVoiceForUser(userId, fallback = DEFAULT_VOICE) {
  try {
    const preset = await getVoicePreset(userId);
    if (preset && PRESET_TO_VOICE[preset]) return PRESET_TO_VOICE[preset];
  } catch {}
  return fallback;
}

/* ─────────── Ellie reply generator (unchanged behavior) ─────────── */
async function generateEllieReply({ userId, userText }) {
  let prefLang = await getPreferredLanguage(userId); if (!prefLang) prefLang = "en";

  const [storedFacts, latestMood, recentEmos] = await Promise.all([
    getFacts(userId), getLatestEmotion(userId), getRecentEmotions(userId, 5),
  ]);

  const factsLines = storedFacts.map(r => {
    const conf = r.confidence != null ? ` (conf ${Number(r.confidence).toFixed(2)})` : "";
    const emo  = r.sentiment && r.sentiment !== "neutral" ? ` [${r.sentiment}]` : "";
    return `- ${r.fact}${emo}${conf}`;
  });
  const factsSummary = factsLines.length ? `Known facts:\n${factsLines.join("\n")}` : "No stored facts yet.";
  const moodLine = latestMood ? `\nRecent mood: ${latestMood.label}${typeof latestMood.intensity === "number" ? ` (${latestMood.intensity.toFixed(2)})` : ""}.` : "";

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
    model: CHAT_MODEL, messages: fullConversation, temperature: 0.6, top_p: 0.9,
  });

  let reply = (completion.choices?.[0]?.message?.content || "").trim();

  // personality flourishes (kept)
  if (randChance(PROB_FREEWILL)) {
    const refusal = addPlayfulRefusal(userText, agg.label);
    if (refusal && !(agg.label === "happy" && agg.avgIntensity < 0.5)) reply = `${refusal}\n\n${reply}`;
  }
  if (randChance(PROB_QUIRKS)) {
    reply = casualize(reply);
    reply = insertFavoriteEmoji(reply);
    reply = reply.replace(/[🐇😏💫🥰😉]/g, (m => {
      let kept = false;
      return () => kept ? "" : (kept = true, m);
    })());
  }
  reply = reply.split(/\n+/g).map(s => s.trim()).filter(Boolean).filter((s => {
    const seen = new Set(); return t => { const k = t.toLowerCase().replace(/["'.,!?–—-]/g,"").replace(/\s+/g," "); if (seen.has(k)) return false; seen.add(k); return true; };
  })()).join("\n");

  pushToHistory(userId, { role: "user", content: userText });
  pushToHistory(userId, { role: "assistant", content: reply });

  return { reply, language: prefLang };
}

/* ─────────── chat ─────────── */
app.post("/api/chat", async (req, res) => {
  try {
    const { message, userId = "default-user" } = req.body;
    if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_LEN) {
      return res.status(400).json({ error: "E_BAD_INPUT", message: "Invalid message" });
    }

    const [facts, emo] = await Promise.all([extractFacts(message), extractEmotionPoint(message)]);
    if (facts.length) await saveFacts(userId, facts, message);
    if (emo) await saveEmotion(userId, emo, message);

    const { reply, language } = await generateEllieReply({ userId, userText: message });

    // NEW: decide voiceMode for UI visibility even on text chat
    const decision = decideVoiceMode({ replyText: reply });
    res.json({ reply, language, voiceMode: decision.voiceMode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "E_INTERNAL", message: "Something went wrong" });
  }
});

/* ─────────── maintenance + language ─────────── */
app.post("/api/reset", (req, res) => {
  const { userId = "default-user" } = req.body || {};
  histories.set(userId, [{ role: "system", content: ELLIE_SYSTEM_PROMPT }]);
  res.json({ status: "Conversation reset" });
});
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

/* ─────────── voice presets (no FX) ─────────── */
app.get("/api/get-voice-presets", async (_req, res) => {
  try {
    const presets = Object.keys(PRESET_TO_VOICE).map(key => ({
      key, label: key[0].toUpperCase() + key.slice(1), voice: PRESET_TO_VOICE[key]
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
// Back-compat no-op:
app.get("/api/get-voice-settings", async (_req, res) => res.json({ settings: null, note: "FX disabled" }));
app.post("/api/set-voice-settings", async (_req, res) => res.json({ ok: true, note: "FX disabled" }));

/* ─────────── STT upload ─────────── */
app.post("/api/upload-audio", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded. Field must be 'audio'." });
    const okTypes = ["audio/webm","audio/ogg","audio/mpeg","audio/mp4","audio/wav","audio/x-wav"];
    if (!okTypes.includes(req.file.mimetype)) return res.status(415).json({ error: `Unsupported type ${req.file.mimetype}` });

    const userId = (req.body?.userId || "default-user");

    let prefLang = await getPreferredLanguage(userId);
    const requestedLang = (req.body?.language || "").toLowerCase();
    if (requestedLang && SUPPORTED_LANGUAGES[requestedLang]) {
      prefLang = requestedLang; await setPreferredLanguage(userId, requestedLang);
    }
    if (!prefLang) prefLang = "en";

    const fileForOpenAI = await toFile(req.file.buffer, req.file.originalname || "audio.webm");
    const tr = await client.audio.transcriptions.create({ model: "whisper-1", file: fileForOpenAI, language: prefLang });

    res.json({ text: tr.text || "", language: prefLang });
  } catch (e) {
    console.error("upload-audio error:", e);
    res.status(500).json({ error: "TRANSCRIBE_FAILED", detail: String(e?.message || e) });
  }
});

/* ─────────── voice chat (uses voiceMode) ─────────── */
app.post("/api/voice-chat", upload.single("audio"), async (req, res) => {
  try {
    const userId = (req.body?.userId || "default-user");
    const okTypes = ["audio/webm","audio/ogg","audio/mpeg","audio/mp4","audio/wav","audio/x-wav"];
    if (!req.file || !okTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: "E_BAD_AUDIO", message: "Upload audio/webm|ogg|mp3|m4a|wav ≤ 10MB" });
    }

    let prefLang = await getPreferredLanguage(userId);
    const requestedLang = (req.body?.language || "").toLowerCase();
    if (requestedLang && SUPPORTED_LANGUAGES[requestedLang]) { prefLang = requestedLang; await setPreferredLanguage(userId, requestedLang); }
    if (!prefLang) prefLang = "en";

    const fileForOpenAI = await toFile(req.file.buffer, req.file.originalname || "audio.webm");
    const tr = await client.audio.transcriptions.create({ model: "whisper-1", file: fileForOpenAI, language: prefLang });

    const userText = (tr.text || "").trim();
    if (!userText) return res.status(200).json({ text: "", reply: "", language: prefLang, audioMp3Base64: null, voiceMode: "mini" });

    const [facts, emo] = await Promise.all([extractFacts(userText), extractEmotionPoint(userText)]);
    if (facts.length) await saveFacts(userId, facts, userText);
    if (emo) await saveEmotion(userId, emo, userText);

    const { reply, language } = await generateEllieReply({ userId, userText });

    const decision = decideVoiceMode({ replyText: reply });
    const model = getTtsModelForVoiceMode(decision.voiceMode);
    const chosenVoice = await getEffectiveVoiceForUser(userId, DEFAULT_VOICE);

    const speech = await client.audio.speech.create({ model, voice: chosenVoice, input: reply, format: "mp3" });
    const ab = await speech.arrayBuffer();
    const audioMp3Base64 = Buffer.from(ab).toString("base64");

    res.json({ text: userText, reply, language, audioMp3Base64, voiceMode: decision.voiceMode, ttsModel: model });
  } catch (e) {
    console.error("voice-chat error:", e);
    res.status(500).json({ error: "VOICE_CHAT_FAILED", detail: String(e?.message || e) });
  }
});

/* ─────────── TTS (accepts optional voiceMode) ─────────── */
app.post("/api/tts", async (req, res) => {
  try {
    const { text, voice, userId = "default-user", voiceMode } = req.body || {};
    if (!text || typeof text !== "string") return res.status(400).json({ error: "Missing 'text' string in body." });

    const decision = (voiceMode === "full" || voiceMode === "mini")
      ? { voiceMode, reason: "client" }
      : decideVoiceMode({ replyText: text });
    const model = getTtsModelForVoiceMode(decision.voiceMode);
    const chosenVoice = voice || await getEffectiveVoiceForUser(userId, DEFAULT_VOICE);

    console.log(`[TTS] user=${userId} chars=${text.length} mode=${decision.voiceMode} model=${model} voice=${chosenVoice} reason=${decision.reason}`);

    const speech = await client.audio.speech.create({ model, voice: chosenVoice, input: text, format: "mp3" });
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

/* ─────────── Preview (quick voice sample) ─────────── */
app.get("/api/tts-test/:voice", async (req, res) => {
  const voice = req.params.voice;
  try {
    const mp3 = await client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: "Hi, I’m Ellie. This is a quick preview.",
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

/* ─────────── STT helpers ─────────── */
async function extractFacts(text) {
  const prompt = `
From the text, extract personal facts/preferences/events if any.
Return ONLY JSON array like:
[{"category":"other","fact":"string","sentiment":"neutral","confidence":0.9}]
If none, return [].
Text: """${text}"""`.trim();

  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), OPENAI_TIMEOUT_MS);
  try {
    const completion = await client.chat.completions.create(
      {
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: "Return strict JSON only." },
          { role: "user", content: prompt }
        ],
        temperature: 0
      },
      { signal: ac.signal }
    );
    try { const parsed = JSON.parse(completion.choices[0].message.content); if (Array.isArray(parsed)) return parsed; }
    catch {}
    return [];
  } finally { clearTimeout(to); }
}
async function extractEmotionPoint(text) {
  const prompt = `Return ONLY JSON like {"label":"happy|sad|angry|anxious|proud|hopeful|neutral","intensity":0..1}
Text: """${text}"""`;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), OPENAI_TIMEOUT_MS);
  try {
    const completion = await client.chat.completions.create(
      {
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: "Return strict JSON only." },
          { role: "user", content: prompt }
        ],
        temperature: 0
      },
      { signal: ac.signal }
    );
    try { const obj = JSON.parse(completion.choices[0].message.content); if (obj && typeof obj.label === "string") return obj; }
    catch {}
    return null;
  } finally { clearTimeout(to); }
}

/* ─────────── WebSocket voice ─────────── */
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws/voice" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let userId = url.searchParams.get("userId") || "default-user";
  let sessionLang = null;
  let sessionVoice = DEFAULT_VOICE;

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
        const tr = await client.audio.transcriptions.create({ model: "whisper-1", file: fileForOpenAI, language: lang });

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
        const speech = await client.audio.speech.create({ model, voice: chosenVoice, input: reply, format: "mp3" });
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
      try { ws.send(JSON.stringify({ type: "error", message: String(e?.message || e) })); } catch {}
    }
  });
});

/* ─────────── shutdown ─────────── */
function shutdown(signal) {
  console.log(`\n${signal} received. Closing DB pool...`);
  pool.end(() => { console.log("DB pool closed. Exiting."); process.exit(0); });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

server.listen(PORT, () => {
  console.log(`🚀 Ellie API running at http://localhost:${PORT}`);
  console.log(`🔊 WebSocket voice at ws://localhost:${PORT}/ws/voice`);
});
