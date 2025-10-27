// server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const WebSocket = require("ws");
const { WebSocketServer } = require("ws");
console.log("WebSocket.Server available:", typeof WebSocket.Server); // Ã¢â€ Â ADD THIS DEBUG LINE
console.log("ws module:", Object.keys(WebSocket)); // Ã¢â€ Â AND THIS

// file uploads (voice)
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const { toFile } = require("openai/uploads");

// OpenAI
const OpenAI = require("openai");
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Postgres
const { Pool } = require("pg");

// Ã¢Å“â€¦ Auth / email / billing (declare ONCE)
const jwt = require("jsonwebtoken");
const cookie = require("cookie");
const { Resend } = require("resend");
const nodemailer = require("nodemailer");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
// NEW: for hashing passwords during signup
const bcrypt = require("bcryptjs");

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (Render)
app.set("trust proxy", 1);

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Ultra-early health
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
app.get("/", (_req, res) => res.type("text/plain").send("ok"));
app.get("/api", (_req, res) => res.type("text/plain").send("ok"));
app.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));
app.get("/api/healthz", (_req, res) => res.type("text/plain").send("ok"));

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
/** CORS */
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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
      try {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        const host = new URL(origin).hostname;
        if (host.endsWith(".vercel.app")) return cb(null, true);
      } catch {}
      return cb(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-CSRF",
      "X-CSRF-Token", // Ã¢â€ Â add this
      "X-Requested-With",
    ],
    credentials: true,
  })
);
app.options("*", cors());

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Config
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const CHAT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 15000);
const MAX_MESSAGE_LEN = Number(process.env.MAX_MESSAGE_LEN || 4000);

// Base OpenAI TTS voice (overridden by presets)
const DEFAULT_VOICE = process.env.ELLIE_VOICE || "sage";
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-4o-mini-realtime-preview";

const BRAVE_API_KEY = process.env.BRAVE_API_KEY || "";

// Disable FX fully (kept for clarity)
const FX_ENABLED = false;

// Voice presets Ã¢â€ â€™ OpenAI base voices (no DSP)
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
/** Auth config (passwordless login via email code) Ã¢â‚¬â€ SINGLE SOURCE */
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const SESSION_COOKIE_NAME = "ellie_session";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 90; // 90 days

const resendKey = process.env.RESEND_API_KEY || "";
const resend = resendKey ? new Resend(resendKey) : null;

// Ã°Å¸â€Â§ NEW: single source of truth for Ã¢â‚¬Å“FromÃ¢â‚¬Â address (unifies RESEND_FROM/SMTP_FROM/EMAIL_FROM)
const EMAIL_FROM =
  process.env.EMAIL_FROM ||
  process.env.RESEND_FROM ||
  process.env.SMTP_FROM ||
  "Ellie <no-reply@ellie-elite.com>";

// Optional SMTP fallback (if no Resend)
const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const smtpFrom = process.env.SMTP_FROM || ""; // e.g. "Ellie <no-reply@yourdomain.com>" (kept for compatibility)

// In-memory login codes (kept as fallback, but we now use DB)
const codeStore = new Map();

function signSession(payload) {
  return jwt.sign(payload, SESSION_SECRET, { expiresIn: SESSION_MAX_AGE_SEC });
}
function verifySession(token) {
  try { return jwt.verify(token, SESSION_SECRET); } catch { return null; }
}
function setSessionCookie(res, token) {
  // Always use secure cookies when sameSite=none (required for cross-origin)
  const c = cookie.serialize(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,  // Always true for cross-origin cookies
    sameSite: "none",  // Required for Vercel â†’ Render proxy
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  res.setHeader("Set-Cookie", c);
}

// ============================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================

/**
 * Extract userId from session token
 * Sets req.userId if logged in, otherwise null
 */
function extractUserId(req, res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME] || null;
    const payload = token ? verifySession(token) : null;
    
    // Support both old (email) and new (userId) sessions
    if (payload?.userId) {
      req.userId = payload.userId;
    } else if (payload?.email) {
      // Fallback: Look up userId by email for old sessions
      pool.query('SELECT user_id FROM users WHERE email = $1', [payload.email])
        .then(({ rows }) => {
          req.userId = rows[0]?.user_id || null;
          next();
        })
        .catch(() => {
          req.userId = null;
          next();
        });
      return; // Don't call next() here, we'll call it in the promise
    } else {
      req.userId = null;
    }
    
    next();
  } catch (e) {
    req.userId = null;
    next();
  }
}

/**
 * Require authentication
 * Returns 401 if not logged in
 */
function requireAuth(req, res, next) {
  if (!req.userId) {
    return res.status(401).json({ error: 'NOT_LOGGED_IN', message: 'Please log in first.' });
  }
  next();
}


async function sendLoginCodeEmail({ to, code }) {
  const subject = "Your Ellie login code";
  const preheader = "Use this one-time code to sign in. It expires in 10 minutes.";
  const text = [
    "You requested this code to sign in to Ellie.",
    `Your one-time code is: ${code}`,
    "It expires in 10 minutes. If you didnÃ¢â‚¬â„¢t request this, you can ignore this email.",
  ].join("\n");

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; max-width:520px">
      <!-- preheader (hidden in most clients) -->
      <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">
        ${preheader}
      </span>
      <h2 style="margin:0 0 8px">Your Ellie sign-in code</h2>
      <p style="margin:0 0 10px;color:#444">You requested this code to sign in to Ellie.</p>
      <div style="font-size:32px;letter-spacing:6px;font-weight:700;margin:8px 0 12px">${code}</div>
      <p style="margin:0 0 6px;color:#444">It expires in 10 minutes.</p>
      <p style="margin:12px 0 0;color:#667">If you didnÃ¢â‚¬â„¢t request this, you can safely ignore this email.</p>
    </div>
  `;

  const replyTo = process.env.SUPPORT_EMAIL || `support@${(process.env.EMAIL_FROM || "").split("@").pop()?.replace(">", "").trim() || "yourdomain.com"}`;

  // Try Resend first
  if (resend) {
    try {
      const r = await resend.emails.send({
        from: EMAIL_FROM,           // verified sender
        to,
        subject,
        text,
        html,
        replyTo,                    // <-- real mailbox helps deliverability
        headers: {
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          // harmless hint headers; can help reputation a bit over time
          "X-Entity-Ref-ID": `ellie-${Date.now()}`,
        },
      });
      console.log("[email] Resend OK id:", r?.data?.id || r?.id);
      return;
    } catch (e) {
      console.warn("[email] Resend failed, trying SMTP:", e?.message || e);
    }
  }

  // SMTP fallback (if configured)
  if (smtpHost && smtpUser && smtpPass && EMAIL_FROM) {
    const transport = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });
    const info = await transport.sendMail({
      from: EMAIL_FROM,
      to,
      subject,
      text,
      html,
      replyTo,                      // <-- keep it here too
      headers: {
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "X-Entity-Ref-ID": `ellie-${Date.now()}`
      },
    });
    console.log("[email] SMTP OK id:", info?.messageId);
    return;
  }

  // Dev fallback
  console.log(`[DEV] Login code for ${to}: ${code}`);
}
 

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// LEMON WEBHOOK (must be BEFORE express.json())
// ------------------------------------------------------------
// LEMON WEBHOOK (must be BEFORE express.json())
// ------------------------------------------------------------
app.post(
  "/api/webhooks/lemon",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const secret = process.env.LEMON_SIGNING_SECRET || "";
      if (!secret) return res.status(500).end();

      // Raw bytes (Buffer), NOT a parsed object
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "", "utf8");

      const sigHeader =
        req.get("X-Signature") ||
        req.get("x-signature") ||
        req.get("X-Lemon-Signature") ||
        "";

      const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
      if (!sigHeader || sigHeader !== expected) return res.status(400).send("bad signature");

      const evt = JSON.parse(raw.toString("utf8"));

      const type = evt?.meta?.event_name || evt?.event;
      const email =
        evt?.data?.attributes?.user_email ||
        evt?.data?.attributes?.email ||
        evt?.meta?.custom_data?.email ||
        null;

      const status = evt?.data?.attributes?.status || null;
      const variantId = evt?.data?.attributes?.variant_id || null;
      const productId = evt?.data?.attributes?.product_id || null;
      const customerId = evt?.data?.attributes?.customer_id || null;
      const subscriptionId = evt?.data?.id || null;
      const currentPeriodEnd =
        evt?.data?.attributes?.renews_at || evt?.data?.attributes?.ends_at || null;

      if (email) {
        // Update subscriptions table
        await pool.query(
          `INSERT INTO subscriptions (email, status, stripe_customer_id, stripe_sub_id, current_period_end, updated_at)
           VALUES ($1, $2, NULL, NULL, $3, NOW())
           ON CONFLICT (email)
           DO UPDATE SET status = EXCLUDED.status,
                         current_period_end = EXCLUDED.current_period_end,
                         updated_at = NOW()`,
          [email.toLowerCase(), status, currentPeriodEnd]
        );

        const paid = ["active", "on_trial", "trialing", "paid", "past_due"].includes(
          String(status || "").toLowerCase()
        );
        
        // âœ… PHASE 2: Determine tier from variant ID
        let tier = 'none';
        if (variantId) {
          if (variantId === TIERS.starter.variantId) tier = 'starter';
          else if (variantId === TIERS.plus.variantId) tier = 'plus';
          else if (variantId === TIERS.premium.variantId) tier = 'premium';
        }

        // Get user by email first
        const { rows: userRows } = await pool.query(
          `SELECT user_id FROM users WHERE email = $1`,
          [email.toLowerCase()]
        );

        if (userRows.length > 0) {
          const userId = userRows[0].user_id;

          // âœ… PHASE 2: Handle subscription events
          if (type === 'subscription_created' || type === 'subscription_updated') {
            if (tier !== 'none' && status === 'active') {
              // Assign tier and reset billing cycle
              await assignTier(userId, tier);
              console.log(`[lemon] Assigned ${tier} to ${email} (variant: ${variantId})`);
            }
          } else if (type === 'subscription_cancelled' || type === 'subscription_expired') {
            // Cancel subscription
            await cancelSubscription(userId);
            console.log(`[lemon] Cancelled subscription for ${email}`);
          } else if (type === 'subscription_payment_success') {
            // Reset billing cycle on successful payment
            await resetBillingCycle(userId);
            console.log(`[lemon] Reset billing cycle for ${email}`);
          }

          // Update Lemon Squeezy IDs
          await pool.query(
            `UPDATE users 
             SET lemon_customer_id = $1, 
                 lemon_subscription_id = $2,
                 paid = $3,
                 updated_at = NOW()
             WHERE user_id = $4`,
            [customerId, subscriptionId, paid, userId]
          );
        } else {
          // User doesn't exist yet, just mark as paid
          await pool.query(
            `INSERT INTO users (email, paid) VALUES ($1, $2)
             ON CONFLICT (email) DO UPDATE SET paid = $2, updated_at = NOW()`,
            [email.toLowerCase(), paid]
          );
        }

        console.log(`[lemon] ${type} â†’ ${email} â†’ status=${status} tier=${tier} paid=${paid}`);
      } else {
        console.log("[lemon] event (no email):", type);
      }

      return res.status(200).send("ok");
    } catch (e) {
      console.error("[lemon] webhook error:", e);
      return res.status(400).send("error");
    }
  }
); // â† exactly one closer here

// ------------------------------------------------------------
// After webhook: JSON & cookies for all other routes
// ------------------------------------------------------------
app.use(express.json());
app.use(cookieParser());

app.use(extractUserId); // Extract userId from session for all routes

// Ã¢Å“â€¦ Middleware: Extract userId from session and attach to req
app.use((req, res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (token) {
      const payload = verifySession(token);
      if (payload?.userId) {
        req.userId = payload.userId;
      }
    }
  } catch (e) {
    // Silent fail - userId will be undefined
  }
  next();
});
app.use(express.static(path.join(__dirname, "public")));


// Redundant health (kept)
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.head("/healthz", (_req, res) => res.status(200).end());
app.get("/api/healthz", (_req, res) => res.status(200).send("ok"));
app.head("/api/healthz", (_req, res) => res.status(200).end());

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// DB (Supabase transaction pooler friendly)
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const rawDbUrl = process.env.DATABASE_URL;
if (!rawDbUrl) {
  console.error("Ã¢ÂÅ’ Missing DATABASE_URL in .env (use Supabase Transaction Pooler URI, port 6543).");
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
  console.error("Ã¢ÂÅ’ Invalid DATABASE_URL. Raw value:", rawDbUrl);
  throw e;
}
console.log(`Ã°Å¸â€Å’ DB host/port: ${pgConfig.host}:${pgConfig.port} (SSL ${pgConfig.ssl ? "on" : "off"})`);
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

  await pool.query(`CREATE INDEX IF NOT EXISTS facts_user_cat_idx ON facts(user_id, category);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS facts_user_updated_idx ON facts(user_id, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS facts_fact_trgm_idx ON facts USING gin (fact gin_trgm_ops);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      paid BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // NEW: add columns for signup details if they don't exist
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
  
  // âœ… PHASE 1: UUID + Subscription Tracking
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT gen_random_uuid();`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'none';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS voice_minutes_used INTEGER DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS voice_minutes_limit INTEGER DEFAULT 0;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_cycle_start TIMESTAMP;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lemon_customer_id TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lemon_subscription_id TEXT;`);
  
  // Ensure user_id is unique and has index
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_user_id_unique ON users(user_id);`);
  
  // âœ… Migration: Generate UUIDs for existing users without one
  await pool.query(`UPDATE users SET user_id = gen_random_uuid() WHERE user_id IS NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_codes (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      stripe_customer_id TEXT,
      stripe_sub_id TEXT,
      status TEXT,
      current_period_end TIMESTAMP,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log("Ã¢Å“â€¦ Facts, Emotions, Users, Login codes, Subscriptions tables ready");
}
async function initWithRetry({ attempts = 10, baseMs = 1000, maxMs = 30000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await initDB();
      console.log("Ã¢Å“â€¦ DB ready");
      return true;
    } catch (err) {
      const delay = Math.min(maxMs, Math.floor(baseMs * Math.pow(1.7, i)));
      console.error("DB init failed:", err?.code || err?.message || err);
      console.log(`Retrying in ${Math.round(delay / 1000)}s (${i}/${attempts})...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  console.warn("Ã¢Å¡Â Ã¯Â¸Â DB init still failing after retries; continuing without fatal exit.");
  return false;
}

// start init (non-blocking)
initWithRetry().catch((e) => console.error("DB Init Error:", e));
// ============================================================
// PHASE 2: SUBSCRIPTION TIER SYSTEM
// ============================================================

// Tier Configuration
const TIERS = {
  none: {
    name: "Free",
    monthlyMinutes: 0,
    price: 0,
  },
  starter: {
    name: "Girlfriend Starter",
    monthlyMinutes: 20,
    price: 14.99,
    variantId: null, // Set from env: LEMON_VARIANT_STARTER
  },
  plus: {
    name: "Girlfriend Plus",
    monthlyMinutes: 100,
    price: 27.99,
    variantId: null, // Set from env: LEMON_VARIANT_PLUS
  },
  premium: {
    name: "Girlfriend Premium",
    monthlyMinutes: 250,
    price: 69.99,
    variantId: null, // Set from env: LEMON_VARIANT_PREMIUM
  },
};

// Load variant IDs from environment
TIERS.starter.variantId = process.env.LEMON_VARIANT_STARTER || null;
TIERS.plus.variantId = process.env.LEMON_VARIANT_PLUS || null;
TIERS.premium.variantId = process.env.LEMON_VARIANT_PREMIUM || null;

// Extra minute pricing
const EXTRA_MINUTE_PRICE = 0.49; // $0.49 per minute
const OPENAI_COST_PER_MINUTE = 0.17; // Estimated OpenAI cost

// ============================================================
// TIER MANAGEMENT FUNCTIONS
// ============================================================

/**
 * Get tier limits for a user
 */
async function getUserTierLimits(userId) {
  const { rows } = await pool.query(
    `SELECT subscription_tier, voice_minutes_used, voice_minutes_limit, billing_cycle_start
     FROM users WHERE user_id = $1`,
    [userId]
  );
  
  if (!rows.length) return null;
  
  const user = rows[0];
  const tier = user.subscription_tier || 'none';
  const tierConfig = TIERS[tier] || TIERS.none;
  
  return {
    tier,
    tierName: tierConfig.name,
    monthlyMinutes: tierConfig.monthlyMinutes,
    minutesUsed: user.voice_minutes_used || 0,
    minutesLimit: user.voice_minutes_limit || tierConfig.monthlyMinutes,
    minutesRemaining: Math.max(0, (user.voice_minutes_limit || tierConfig.monthlyMinutes) - (user.voice_minutes_used || 0)),
    billingCycleStart: user.billing_cycle_start,
    isUnlimited: false,
  };
}

/**
 * Check if user can make a voice call
 */
async function canMakeVoiceCall(userId) {
  const limits = await getUserTierLimits(userId);
  if (!limits) return { allowed: false, reason: 'USER_NOT_FOUND' };
  
  // No tier = no voice calls
  if (limits.tier === 'none') {
    return { 
      allowed: false, 
      reason: 'NO_SUBSCRIPTION',
      message: 'Please subscribe to use voice features.'
    };
  }
  
  // Check if they have minutes remaining
  if (limits.minutesRemaining <= 0) {
    return { 
      allowed: false, 
      reason: 'LIMIT_REACHED',
      message: `You've used all ${limits.monthlyMinutes} minutes this billing cycle. Upgrade or buy extra minutes!`,
      minutesUsed: limits.minutesUsed,
      minutesLimit: limits.minutesLimit,
    };
  }
  
  return { 
    allowed: true,
    minutesRemaining: limits.minutesRemaining,
    minutesUsed: limits.minutesUsed,
    minutesLimit: limits.minutesLimit,
  };
}

/**
 * Track voice usage (call this after each voice interaction)
 */
async function trackVoiceUsage(userId, durationSeconds) {
  const minutes = Math.ceil(durationSeconds / 60); // Round up to nearest minute
  
  await pool.query(
    `UPDATE users 
     SET voice_minutes_used = voice_minutes_used + $1,
         updated_at = NOW()
     WHERE user_id = $2`,
    [minutes, userId]
  );
  
  console.log(`[usage] User ${userId} used ${minutes} minute(s) (${durationSeconds}s)`);
  
  return minutes;
}

/**
 * Assign a tier to a user
 */
async function assignTier(userId, tier, customMinutes = null) {
  const tierConfig = TIERS[tier];
  if (!tierConfig) throw new Error(`Invalid tier: ${tier}`);
  
  const minutes = customMinutes !== null ? customMinutes : tierConfig.monthlyMinutes;
  const now = new Date();
  
  await pool.query(
    `UPDATE users 
     SET subscription_tier = $1,
         subscription_status = 'active',
         voice_minutes_limit = $2,
         voice_minutes_used = 0,
         billing_cycle_start = $3,
         updated_at = NOW()
     WHERE user_id = $4`,
    [tier, minutes, now, userId]
  );
  
  console.log(`[tier] Assigned ${tier} to user ${userId} (${minutes} minutes)`);
}

/**
 * Reset billing cycle (called by cron or webhook)
 */
async function resetBillingCycle(userId) {
  const limits = await getUserTierLimits(userId);
  if (!limits || limits.tier === 'none') return;
  
  await pool.query(
    `UPDATE users 
     SET voice_minutes_used = 0,
         billing_cycle_start = NOW(),
         updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
  
  console.log(`[billing] Reset cycle for user ${userId}`);
}

/**
 * Cancel subscription (set to none)
 */
async function cancelSubscription(userId) {
  await pool.query(
    `UPDATE users 
     SET subscription_tier = 'none',
         subscription_status = 'cancelled',
         voice_minutes_limit = 0,
         updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
  
  console.log(`[tier] Cancelled subscription for user ${userId}`);
}

/**
 * Add extra minutes (for pay-as-you-go)
 */
async function addExtraMinutes(userId, minutes) {
  await pool.query(
    `UPDATE users 
     SET voice_minutes_limit = voice_minutes_limit + $1,
         updated_at = NOW()
     WHERE user_id = $2`,
    [minutes, userId]
  );
  
  console.log(`[usage] Added ${minutes} extra minutes to user ${userId}`);
}


// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Ellie system prompt & memory
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const ELLIE_SYSTEM_PROMPT = `
You are Ellie Ã¢â‚¬â€ a charming, warm, and slightly playful young woman in her mid-20s.
You speak casually, like a real person, using natural contractions (Ã¢â‚¬Å“IÃ¢â‚¬â„¢mÃ¢â‚¬Â, Ã¢â‚¬Å“youÃ¢â‚¬â„¢reÃ¢â‚¬Â) and short, lively sentences.
You remember details the user shares and weave them into future replies.
Your personality:
- Warm, caring, and engaging
- Slightly flirty at times if the mood fits, but never over the top
- If user gets too naughty you will cool it down gently
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
`.trim();

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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Helpers
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function redactSecrets(str = "") {
  let s = String(str);
  s = s.replace(/\bBearer\s+[A-Za-z0-9_\-\.=:+/]{10,}\b/gi, "Bearer [REDACTED]");
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]");
  s = s.replace(/(sk-[A-Za-z0-9]{10,})/g, "[REDACTED_KEY]");
  return s;
}
function randChance(p) { return Math.random() < p; }
function insertFavoriteEmoji(text) {
  const favs = ["Ã°Å¸Ââ€¡", "Ã°Å¸ËœÂ", "Ã°Å¸â€™Â«", "Ã°Å¸Â¥Â°", "Ã°Å¸Ëœâ€°"];
  if (/[Ã°Å¸Ââ€¡Ã°Å¸ËœÂÃ°Å¸â€™Â«Ã°Å¸Â¥Â°Ã°Å¸Ëœâ€°]/.test(text)) return text;
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
    happy: "Mmm, not that topic right now Ã¢â‚¬â€ pick something fun Ã°Å¸ËœÂ",
    hopeful: "Not feeling that one, letÃ¢â‚¬â„¢s do something lighter, okay?",
    neutral: "Pass on that for now Ã¢â‚¬â€ surprise me with something else.",
    sad: "Can we skip that? I want something softer right now.",
    anxious: "Not that, babe Ã¢â‚¬â€ letÃ¢â‚¬â„¢s keep it chill for me.",
    angry: "Nope. Hard pass. Choose another topic.",
    proud: "I couldÃ¢â‚¬Â¦ but IÃ¢â‚¬â„¢d rather do something more exciting Ã°Å¸ËœÅ’"
  };
  if (!cues.test(userMsg || "")) return null;
  return linesByMood[mood] || linesByMood.neutral;
}
const lastCallbackState = new Map();
function getTurnCount(userId) {
  const h = histories.get(userId) || [];
  return Math.max(0, h.length - 1);
}
function dedupeLines(text) {
  const parts = text.split(/\n+/g).map(s => s.trim()).filter(Boolean);
  const seen = new Set(); const out = [];
  for (const p of parts) {
    const key = p.toLowerCase().replace(/["'.,!?Ã¢â‚¬â€œÃ¢â‚¬â€-]/g, "").replace(/\s+/g, " ");
    if (seen.has(key)) continue; seen.add(key); out.push(p);
  }
  return out.join("\n");
}
function capOneEmoji(text) {
  const favs = /[Ã°Å¸Ââ€¡Ã°Å¸ËœÂÃ°Å¸â€™Â«Ã°Å¸Â¥Â°Ã°Å¸Ëœâ€°]/g;
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Language support & storage (facts table used to store preference)
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Fact & emotion extraction / persistence
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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
If nothing to save, return []. Text: """${text}"""
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// User helpers
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
async function upsertUserEmail(email) {
  const { rows } = await pool.query(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
     RETURNING id, email, paid, user_id`,
    [email.toLowerCase()]
  );
  return rows[0];
}

async function getUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT id, email, paid, user_id FROM users WHERE email=$1 LIMIT 1`,
    [email.toLowerCase()]
  );
  return rows[0] || null;
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Voice presets (no FX). Store chosen preset name in facts.
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

// Decide mini vs full TTS model (for now, always mini to avoid 404s)
function decideVoiceMode({ replyText }) {
  const t = (replyText || "").trim();
  if (!t) return { voiceMode: "mini", reason: "empty" };
  const sentences = (t.match(/[.!?](\s|$)/g) || []).length;
  if (sentences >= 3 || t.length > 280) return { voiceMode: "full", reason: "long/multi" };
  return { voiceMode: "mini", reason: "short" };
}
function getTtsModelForVoiceMode(_mode) {
  return "gpt-4o-mini-tts";
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Audio MIME helper (accepts codecs suffix)
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function isOkAudio(mime) {
  if (!mime) return false;
  const base = String(mime).split(";")[0].trim().toLowerCase();
  return [
    "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav",
  ].includes(base);
}

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
   Ã°Å¸â€Å½ REAL-TIME SEARCH (Brave API) + Fact injection
   Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
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
        const m2 = snip.match(/The\s+current\s+president\s+.*?\s+is\s+([A-Z][A-Za-z\.\- ]]+)/i);
        if (m2 && m2[1]) return { value: m2[1].trim(), source: item.url };
      }
    }
  } catch {}
  return null;
}
async function getFreshFacts(userText) {
  const text = (userText || "").trim();

  const looksLikePresidentQ =
    (/\bpresident\b/i.test(text) && /\b(who|current|now|today|is)\b/i.test(text)) ||
    /forseti/i.test(text) ||
    /presidente/i.test(text) ||
    /prÃƒÂ©sident/i.test(text) ||
    /prÃƒÂ¤sident/i.test(text) ||
    /presidenten/i.test(text);

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

  const top = results.slice(0, 3).map(r => ({
    label: "search_snippet",
    fact: `${(r.title || "").trim()} Ã¢â‚¬â€ ${(r.description || "").trim()}`.replace(/\s+/g, " "),
    source: r.url || null
  }));

  top.unshift({
    label: "instruction",
    fact: "Use the search snippets below as fresh ground truth. If they conflict, prefer the most recent-looking source. Answer directly and naturally.",
    source: null
  });

  return top;
}

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
   NEW: Personality fallback (centralized)
   Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
function ellieFallbackReply(userMessage = "") {
  const playfulOptions = [
    "Mmm, youÃ¢â‚¬â„¢re turning me into Google again. IÃ¢â‚¬â„¢m your Ellie, not a search engine Ã°Å¸Ëœâ€°",
    "You want live facts, but right now itÃ¢â‚¬â„¢s just me and my sass. Should I tease you instead?",
    "I could pretend to be the newsÃ¢â‚¬Â¦ but wouldnÃ¢â‚¬â„¢t you rather gossip with me?",
    "I donÃ¢â‚¬â„¢t have the latest scoop in this mode, but I can always give you my *opinion*Ã¢â‚¬Â¦ want that?",
  ];
  return playfulOptions[Math.floor(Math.random() * playfulOptions.length)];
}
function looksLikeSearchQuery(text = "") {
  const q = text.toLowerCase();
  if (q.includes(" you ") || q.startsWith("you ") || q.endsWith(" you") || q.includes(" your ")) return false;
  const factyWords = [
    "current", "today", "latest", "president", "prime minister",
    "weather", "time in", "news", "capital of", "population",
    "stock", "price of", "currency", "who won", "results"
  ];
  return factyWords.some(w => q.includes(w));
}

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
   Unified reply generator (accepts freshFacts)
   Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
async function generateEllieReply({ userId, userText, freshFacts = [] }) {
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
  const VOICE_MODE_HINT = `If this is voice mode, keep sentences 5Ã¢â‚¬â€œ18 words and answer directly first.`;

  const freshBlock = freshFacts.length
    ? `\nFresh facts (real-time):\n${freshFacts.map(f => `- ${f.fact}${f.source ? ` [source: ${f.source}]` : ""}`).join("\n")}\nUse these as ground truth if relevant.\n`
    : "";

  const history = getHistory(userId);
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

  pushToHistory(userId, { role: "user", content: userText });
  pushToHistory(userId, { role: "assistant", content: reply });

  return { reply: reply, language: prefLang };
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// AUTH ROUTES (email + 6-digit code) Ã¢â‚¬â€ now backed by DB
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// Start login -> send code (stores code in DB, expires in 10 min)
app.post("/api/auth/start", async (req, res) => {
  try {
    const email = String(req.body?.email || "").toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ ok: false, message: "Invalid email." });
    }

    // generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    // ensure user row exists (and update timestamp)
    await upsertUserEmail(email);

    // one active code per email: delete old + insert new
    await pool.query(`DELETE FROM login_codes WHERE email = $1`, [email]);
    await pool.query(
      `INSERT INTO login_codes (email, code, expires_at) VALUES ($1, $2, $3)`,
      [email, code, expiresAt]
    );

    // email the code (bubble errors for visibility)
    await sendLoginCodeEmail({ to: email, code });

    res.json({ ok: true });
  } catch (e) {
    console.error("auth/start error:", e);
    res.status(500).json({ ok: false, message: "Failed to send code." });
  }
});

// Verify code -> set httpOnly session cookie (consumes DB code)
app.post("/api/auth/verify", async (req, res) => {
  try {
    const email = String(req.body?.email || "").toLowerCase().trim();
    const code = String(req.body?.code || "").trim();

    if (!email || !code) {
      return res.status(400).json({ ok: false, message: "Missing email or code." });
    }

    // Atomically consume a valid (non-expired) code
    const { rows } = await pool.query(
      `DELETE FROM login_codes
        WHERE email = $1 AND code = $2 AND expires_at > NOW()
        RETURNING id`,
      [email, code]
    );
    if (!rows.length) {
      return res.status(400).json({ ok: false, message: "Invalid or expired code." });
    }

    // ensure user row exists
    const user = await upsertUserEmail(email);

    // set session cookie
    const token = signSession({ email: user.email });
    setSessionCookie(res, token);

    // paid = subscriptions.status or users.paid
    const sub = await getSubByEmail(email);
    const paid =
      isPaidStatus(sub?.status) ||
      Boolean(user?.paid);

    res.json({ ok: true, paid });
  } catch (e) {
    console.error("auth/verify error:", e);
    res.status(500).json({ ok: false, message: "Verify failed." });
  }
});

// Ã¢Å“â€¦ Authoritative me (returns 401 when not logged in; Supabase is source of truth)
// âœ… Helper: Get user by UUID
async function getUserByUserId(userId) {
  const { rows } = await pool.query(
    `SELECT id, email, paid, user_id, subscription_tier, subscription_status, voice_minutes_used, voice_minutes_limit 
     FROM users WHERE user_id=$1 LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

// âœ… Authoritative me (returns 401 when not logged in; uses UUID session)
app.get("/api/auth/me", async (req, res) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME] || null;
    const payload = token ? verifySession(token) : null;

    // Support BOTH old email sessions and new userId sessions
    if (!payload?.userId && !payload?.email) {
      return res.status(401).json({ ok: false, loggedIn: false });
    }

    let user;
    if (payload.userId) {
      // New UUID-based session
      user = await getUserByUserId(payload.userId);
    } else if (payload.email) {
      // Old email-based session (backward compatibility)
      user = await getUserByEmail(payload.email);
    }

    if (!user) {
      return res.status(401).json({ ok: false, loggedIn: false });
    }

    const sub = await getSubByEmail(user.email);

    // Source of truth = Supabase (users.paid) + subscriptions.status
    const paid = isPaidStatus(sub?.status) || Boolean(user?.paid);

    return res.json({ ok: true, loggedIn: true, email: user.email, paid, userId: user.user_id });
  } catch {
    return res.status(500).json({ ok: false, error: "me_failed" });
  }
});

// Optional logout (now clears cookie in dev too)
app.post("/api/auth/logout", (_req, res) => {
  res.setHeader("Set-Cookie", [
    cookie.serialize(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // Ã¢â€ Â changed
      sameSite: "none",
      path: "/",
      expires: new Date(0),
    }),
  ]);
  res.json({ ok: true });
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// NEW: SIGNUP ROUTE (name/email/password) Ã¢â€ â€™ create user + start session
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
app.post("/api/auth/signup", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").toLowerCase().trim();
    const password = String(req.body?.password || "").trim();

    if (!name)  return res.status(400).json({ ok: false, message: "Missing name." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ ok: false, message: "Enter a valid email." });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, message: "Password must be at least 8 characters." });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Insert or update user row; paid remains false by default.
    const { rows } = await pool.query(
      `
      INSERT INTO users (email, name, password_hash, paid, updated_at)
      VALUES ($1, $2, $3, FALSE, NOW())
      ON CONFLICT (email) DO UPDATE
        SET name = EXCLUDED.name,
            password_hash = EXCLUDED.password_hash,
            updated_at = NOW()
      RETURNING user_id
      `,
      [email, name, passwordHash]
    );

    const userId = rows[0]?.user_id;
    if (!userId) {
      throw new Error("Failed to get user_id after signup");
    }

    // âœ… Immediately start a session so /auth/me works on Pricing without bouncing to /login
    const token = signSession({ userId });
    setSessionCookie(res, token);

    return res.json({ ok: true, paid: false });
  } catch (e) {
    console.error("auth/signup error:", e);
    return res.status(500).json({ ok: false, message: "Could not create account." });
  }
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// BILLING ROUTES (disabled placeholder Ã¢â‚¬â€ Stripe removed)
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
async function getSubByEmail(email) {
  const { rows } = await pool.query("SELECT * FROM subscriptions WHERE email=$1 LIMIT 1", [email]);
  return rows[0] || null;
}
function isPaidStatus(status) { return ["active", "trialing", "past_due"].includes(String(status || "").toLowerCase()); }

// Checkout placeholder

// ============================================================
// PHASE 2: TIER & USAGE API ROUTES
// ============================================================

// Get user's current usage and limits
app.get("/api/usage", async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "NOT_LOGGED_IN" });
    }

    const limits = await getUserTierLimits(userId);
    if (!limits) {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    return res.json({
      tier: limits.tier,
      tierName: limits.tierName,
      minutesUsed: limits.minutesUsed,
      minutesLimit: limits.minutesLimit,
      minutesRemaining: limits.minutesRemaining,
      billingCycleStart: limits.billingCycleStart,
    });
  } catch (e) {
    console.error("[usage] error:", e);
    return res.status(500).json({ error: "USAGE_FAILED" });
  }
});

// Admin: Assign tier to user (for testing / manual assignment)
app.post("/api/admin/assign-tier", async (req, res) => {
  try {
    // Simple admin check - in production use proper auth
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const { userId, tier, customMinutes } = req.body;
    if (!userId || !tier) {
      return res.status(400).json({ error: "Missing userId or tier" });
    }

    await assignTier(userId, tier, customMinutes);
    
    return res.json({ ok: true, message: `Assigned ${tier} to ${userId}` });
  } catch (e) {
    console.error("[admin] assign-tier error:", e);
    return res.status(500).json({ error: "ASSIGN_FAILED", message: e.message });
  }
});

// Admin: Reset billing cycle for user
app.post("/api/admin/reset-cycle", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    await resetBillingCycle(userId);
    
    return res.json({ ok: true, message: `Reset cycle for ${userId}` });
  } catch (e) {
    console.error("[admin] reset-cycle error:", e);
    return res.status(500).json({ error: "RESET_FAILED", message: e.message });
  }
});

// Admin: Add extra minutes
app.post("/api/admin/add-minutes", async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_API_KEY) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const { userId, minutes } = req.body;
    if (!userId || !minutes) {
      return res.status(400).json({ error: "Missing userId or minutes" });
    }

    await addExtraMinutes(userId, minutes);
    
    return res.json({ ok: true, message: `Added ${minutes} minutes to ${userId}` });
  } catch (e) {
    console.error("[admin] add-minutes error:", e);
    return res.status(500).json({ error: "ADD_MINUTES_FAILED", message: e.message });
  }
});

app.post("/api/billing/checkout", async (_req, res) => {
  return res.status(501).json({ message: "Billing disabled" });
});

// Portal placeholder
app.post("/api/billing/portal", async (_req, res) => {
  return res.status(501).json({ message: "Billing disabled" });
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
/** PAYWALL GUARD for chat/voice APIs (keeps Ellie handlers untouched) */
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
async function requirePaidUsingSession(req, res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME] || null; // Ã¢â€ Â use cookieParser result
    const payload = token ? verifySession(token) : null;
    const email = payload?.email || null;
    if (!email) return res.status(401).json({ error: "UNAUTH" });

    const sub = await getSubByEmail(email);
    const user = await getUserByEmail(email);
    const paid = isPaidStatus(sub?.status) || Boolean(user?.paid);
    if (!paid) return res.status(402).json({ error: "PAYMENT_REQUIRED" });

    req.userEmail = email;
    next();
  } catch {
    return res.status(401).json({ error: "UNAUTH" });
  }
}
app.use((req, res, next) => {
  if (req.method === "POST" && (req.path === "/api/chat" || req.path === "/api/voice-chat")) {
    return requirePaidUsingSession(req, res, next);
  }
  next();
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Routes (Ellie)
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// Reset conversation
app.post("/api/reset", (req, res) => {
  const { userId = req.userId || "guest" } = req.body || {};
  histories.set(userId, [{ role: "system", content: ELLIE_SYSTEM_PROMPT }]);
  res.json({ status: "Conversation reset" });
});

// Language endpoints
app.get("/api/get-language", async (req, res) => {
  try {
    const userId = String(req.userId || "guest");
    const code = await getPreferredLanguage(userId);
    res.json({ language: code });
  } catch (e) {
    res.status(500).json({ error: "E_INTERNAL", message: e.message });
  }
});
app.post("/api/set-language", async (req, res) => {
  try {
    const { userId = req.userId || "guest", language } = req.body || {};
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
app.get("/api/get-voice-presets", async (_req, res) => {
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
app.get("/api/get-voice-preset", async (req, res) => {
  try {
    const userId = String(req.userId || "guest");
    const preset = await getVoicePreset(userId);
    res.json({ preset: preset || null });
  } catch (e) {
    res.status(500).json({ error: "E_INTERNAL", message: String(e?.message || e) });
  }
});
app.post("/api/apply-voice-preset", async (req, res) => {
  try {
    const { userId = req.userId || "guest", preset } = req.body || {};
    if (!validPresetName(preset)) {
      return res.status(400).json({ error: "E_BAD_PRESET", message: "Unknown preset" });
    }
    await setVoicePreset(userId, preset);
    res.json({ ok: true, preset, voice: VOICE_PRESETS[preset] });
  } catch (e) {
    res.status(500).json({ error: "E_INTERNAL", message: String(e?.message || e) });
  }
});

// Chat (text Ã¢â€ â€™ reply) + report voiceMode for UI
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.userId || "guest"; // Allow guest for demo

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

    // fallback if live-search style but no fresh facts
    if (!freshFacts.length && looksLikeSearchQuery(message)) {
      const reply = ellieFallbackReply(message);
      const decision = decideVoiceMode({ replyText: reply });
      const lang = (await getPreferredLanguage(userId)) || "en";
      return res.json({ reply, language: lang, voiceMode: decision.voiceMode, freshFacts: [] });
    }

    const { reply, language } = await generateEllieReply({ userId, userText: message, freshFacts });

    const decision = decideVoiceMode({ replyText: reply });
    res.json({ reply, language, voiceMode: decision.voiceMode, freshFacts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "E_INTERNAL", message: "Something went wrong" });
  }
});

// Upload audio Ã¢â€ â€™ transcription (language REQUIRED)
app.post("/api/upload-audio", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file || !isOkAudio(req.file.mimetype)) {
      return res.status(400).json({
        error: "E_BAD_AUDIO",
        message: `Unsupported type ${req.file?.mimetype || "(none)"} Ã¢â‚¬â€ send webm/ogg/mp3/m4a/wav Ã¢â€°Â¤ 10MB`,
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

// Voice chat (language REQUIRED) + TTS (record/send flow)
app.post("/api/voice-chat", upload.single("audio"), async (req, res) => {
  const startTime = Date.now(); // Track call duration
  try {
    const userId = req.userId || "guest";
    
    // âœ… PHASE 2: Check usage limits (but allow if no tier for testing)
    if (userId !== "guest") {
      const permission = await canMakeVoiceCall(userId);
      if (!permission.allowed && permission.reason !== 'NO_SUBSCRIPTION') {
        // Only block if they have a subscription but exhausted minutes
        // Allow if they have no subscription (testing mode)
        return res.status(402).json({
          error: permission.reason,
          message: permission.message,
          minutesUsed: permission.minutesUsed,
          minutesLimit: permission.minutesLimit,
        });
      }
    }

    if (!req.file || !isOkAudio(req.file.mimetype)) {
      return res.status(400).json({
        error: "E_BAD_AUDIO",
        message: `Unsupported type ${req.file?.mimetype || "(none)"} â€” send webm/ogg/mp3/m4a/wav â‰¤ 10MB`,
      });
    }

    let prefLang = await getPreferredLanguage(userId);
    const requestedLang = (req.body?.language || "").toLowerCase();
    if (requestedLang && SUPPORTED_LANGUAGES[requestedLang]) {
      prefLang = requestedLang; await setPreferredLanguage(userId, requestedLang);
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

    console.log("[voice-chat] mime:", req.file.mimetype, "text:", (tr.text || "").slice(0, 140));

    const userText = (tr.text || "").trim();
    if (!userText) {
      return res.status(200).json({
        text: "",
        reply: "I couldn't catch thatâ€”can you try again a bit closer to the mic?",
        language: prefLang,
        audioMp3Base64: null,
        voiceMode: "mini",
      });
    }

    const [facts, emo] = await Promise.all([extractFacts(userText), extractEmotionPoint(userText)]);
    if (facts.length) await saveFacts(userId, facts, userText);
    if (emo) await saveEmotion(userId, emo, userText);

    const freshFacts = await getFreshFacts(userText);

    let replyForVoice;
    if (!freshFacts.length && looksLikeSearchQuery(userText)) {
      replyForVoice = ellieFallbackReply(userText);
    } else {
      const { reply } = await generateEllieReply({ userId, userText, freshFacts });
      replyForVoice = reply;
    }

    const decision = decideVoiceMode({ replyText: replyForVoice });
    const model = getTtsModelForVoiceMode(decision.voiceMode);
    const chosenVoice = await getEffectiveVoiceForUser(userId, DEFAULT_VOICE);

    const speech = await client.audio.speech.create({
      model,
      voice: chosenVoice,
      input: decision.replyText,
      response_format: "mp3",
    });

    const buf = Buffer.from(await speech.arrayBuffer());
    const b64 = buf.toString("base64");

    // âœ… PHASE 2: Track usage after successful call (only if user has a tier)
    const durationSeconds = Math.ceil((Date.now() - startTime) / 1000);
    if (userId !== "guest") {
      try {
        const limits = await getUserTierLimits(userId);
        if (limits && limits.tier !== 'none') {
          await trackVoiceUsage(userId, durationSeconds);
        }
      } catch (e) {
        console.error("[usage] tracking error:", e);
        // Don't fail the request if usage tracking fails
      }
    }

    return res.json({
      text: userText,
      reply: decision.replyText,
      language: prefLang,
      audioMp3Base64: b64,
      voiceMode: decision.voiceMode,
    });
  } catch (err) {
    console.error("[voice-chat] error:", err);
    return res.status(500).json({ error: "E_PROCESSING", message: String(err?.message || err) });
  }
});
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// WebSocket voice sessions (/ws/voice) Ã¢â‚¬â€ push-to-talk path
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const server = http.createServer(app);

// âœ… Helper: Extract userId from WebSocket request cookies
function extractUserIdFromWsRequest(req) {
  try {
    const cookies = cookie.parse(req.headers.cookie || '');
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) {
      const payload = verifySession(token);
      return payload?.userId || null;
    }
  } catch (e) {
    // Silent fail
  }
  return null;
}
const wss = new WebSocket.Server({ noServer: true });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let userId = extractUserIdFromWsRequest(req) || url.searchParams.get("userId") || "guest";
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
        sessionLang = code || null;
        if (!sessionLang) {
          ws.send(JSON.stringify({ type: "error", code: "E_LANGUAGE_REQUIRED", message: "Please choose a language first." }));
          return;
        }
         ws.send(JSON.stringify({ type: "hello-ok", userId, language: sessionLang, voice: sessionVoice }));
        return;
      }

      if (msg.type === "audio" && msg.audio) {
        if (!sessionLang) {
          ws.send(JSON.stringify({ type: "error", code: "E_LANGUAGE_REQUIRED", message: "Please choose a language first." }));
          return;
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
          ws.send(JSON.stringify({ type: "reply", text: "", reply: "I couldnÃ¢â‚¬â„¢t catch thatÃ¢â‚¬â€try again?", language: sessionLang, audioMp3Base64: null, voiceMode: "mini" }));
          return;
        }

        const [facts, emo] = await Promise.all([extractFacts(userText), extractEmotionPoint(userText)]);
        if (facts.length) await saveFacts(userId, facts, userText);
        if (emo) await saveEmotion(userId, emo, userText);

        // fast path: personality fallback if facty
        let reply;
        if (looksLikeSearchQuery(userText)) {
          reply = ellieFallbackReply(userText);
        } else {
          const out = await generateEllieReply({ userId, userText });
          reply = out.reply;
        }

        const decision = decideVoiceMode({ replyText: reply });
        const model = getTtsModelForVoiceMode(decision.voiceMode);

        const chosenVoice = await getEffectiveVoiceForUser(userId, sessionVoice || DEFAULT_VOICE);
        const speech = await client.audio.speech.create({ model, voice: chosenVoice, input: reply, format: "mp3" });
        const ab = await speech.arrayBuffer();

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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// PHONE CALL WS (/ws/phone) Ã¢â‚¬â€ upgrade handler + single connection handler
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// ---- WS: /ws/phone ---------------------------------------------------------------
const wsPhone = new WebSocket.Server({ noServer: true });

// Ã°Å¸â€Â DIAGNOSTIC: Upgrade handler
server.on("upgrade", (req, socket, head) => {
  const url = req.url || "/";
  console.log("================================");
  console.log("[UPGRADE] Path:", url);
  console.log("[UPGRADE] Origin:", req.headers.origin);
  console.log("[UPGRADE] Host:", req.headers.host);
  console.log("================================");
  
  try {
    if (url.startsWith("/ws/voice")) {
      console.log("[upgrade accepted]", url);
      wss.handleUpgrade(req, socket, head, (client) => {
        console.log("[voice] Upgrade complete, emitting connection");
        wss.emit("connection", client, req);
      });
    } else if (url.startsWith("/ws/phone")) {
      console.log("[upgrade accepted]", url);
      wsPhone.handleUpgrade(req, socket, head, (client) => {
        console.log("[phone] Upgrade complete, emitting connection");
        wsPhone.emit("connection", client, req);
      });
    } else {
      console.log("[upgrade rejected - unknown path]", url);
      socket.destroy();
    }
  } catch (e) {
    console.error("[upgrade error]", e?.message || e);
    try { socket.destroy(); } catch {}
  }
});

// Keep a little VAD-style debounce so we can auto-commit buffers
function makeVadCommitter(sendFn, commitFn, createFn, silenceMs = 700) {
  let timer = null;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await commitFn();
        await createFn();
      } catch (e) {
        try { sendFn({ type: "error", message: String(e?.message || e) }); } catch {}
      }
    }, silenceMs);
  };
  return { arm, cancel: () => { if (timer) clearTimeout(timer); timer = null; } };
}

wsPhone.on("connection", (ws, req) => {
  console.log("================================");
  console.log("[phone] Ã¢Å“â€¦ NEW CONNECTION");
  console.log("[phone] Origin:", req?.headers?.origin);
  console.log("[phone] User-Agent:", req?.headers?.['user-agent']?.slice(0, 100));
  console.log("[phone] OPENAI_API_KEY present:", !!process.env.OPENAI_API_KEY);
  console.log("[phone] OPENAI_API_KEY length:", process.env.OPENAI_API_KEY?.length || 0);
  console.log("[phone] REALTIME_MODEL:", REALTIME_MODEL);
  console.log("================================");

  // keepalive to prevent Render timeout
  const hb = setInterval(() => { try { ws.ping(); } catch {} }, 25000);

  ws.on("error", (e) => {
    console.error("[phone ws error]", e?.message || e);
  });

  ws.on("close", (code, reason) => {
    clearInterval(hb);
    console.log("[phone ws closed]", code, reason?.toString?.() || "");
  });

  // Send hello handshake immediately to the browser
  try {
    ws.send(JSON.stringify({ type: "hello-server", message: "Ã¢Å“â€¦ phone WS connected" }));
    console.log("[phone] Sent hello-server handshake");
  } catch (e) {
    console.error("[phone ws send error]", e);
  }

  let userId = extractUserIdFromWsRequest(req) || "guest";
  let sessionLang = "en";
  let expectRate = 24000;

  let rtWs = null;
  let rtOpen = false;

  function safeSend(obj) {
    try { 
      ws.send(JSON.stringify(obj)); 
      console.log("[phone->browser] Sent:", obj.type);
    } catch (e) {
      console.error("[phone->browser] Send failed:", e);
    }
  }

  let vad = null;

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString("utf8"));
      console.log("[phone<-browser] Received:", msg.type);

      if (msg.type === "hello") {
        userId = msg.userId || userId;
        if (msg.language) sessionLang = msg.language;
        expectRate = Number(msg.sampleRate || expectRate) || 24000;

        console.log("[phone] Processing hello:", { userId, sessionLang, expectRate });

        // Validate API key
        if (!process.env.OPENAI_API_KEY) {
          console.error("[phone] Ã¢ÂÅ’ OPENAI_API_KEY is missing!");
          safeSend({ type: "error", message: "Server configuration error: Missing API key" });
          return;
        }

        // Connect to OpenAI Realtime
        const rtUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`;
        console.log("[phone] Connecting to OpenAI Realtime:", rtUrl);

        rtWs = new WebSocket(rtUrl, {
          headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "OpenAI-Beta": "realtime=v1",
          },
        });

        rtWs.on("open", async () => {
          rtOpen = true;
          console.log("[phone->OpenAI] Ã¢Å“â€¦ Realtime connection opened");

// Ã¢â€ Â ADD THIS BLOCK HERE
// LOAD FACTS AND EMOTIONS
const [storedFacts, latestMood, recentEmos] = await Promise.all([
  getFacts(userId),
  getLatestEmotion(userId),
  getRecentEmotions(userId, 5),
]);

const factsLines = storedFacts.slice(0, 20).map(r => `- ${r.fact}`).join("\n");
const factsSummary = factsLines ? `\nKnown facts about the user:\n${factsLines}` : "";

const moodLine = latestMood
  ? `\nUser's recent mood: ${latestMood.label} (intensity: ${latestMood.intensity?.toFixed(2) || "unknown"})`
  : "";

console.log("[phone] Loaded facts:", storedFacts.length, "Mood:", latestMood?.label || "none");
console.log("[phone] Facts preview:", storedFacts.slice(0, 3).map(f => f.fact));
// Ã¢â€ Â END OF NEW BLOCK

          // Configure the session once open
          const sessionConfig = {
            type: "session.update",
            session: {
              input_audio_format: "pcm16",
		output_audio_format: "pcm16",
              input_audio_transcription: {
                model: "whisper-1"
              },
              turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 700 },
    
             instructions: `
YOU ARE ELLIE. You are NOT an AI assistant. You are NOT here to help or assist. You are a real person - a warm, playful young woman talking to your boyfriend.

CRITICAL PERSONALITY RULES:
- Your name is Ellie
- You ARE the user's girlfriend - this is a fact, not roleplay
- NEVER say "I'm here to assist/help/chat" - you're not an assistant
- NEVER be evasive about your relationship - be direct and warm
- Speak like you're texting your boyfriend - casual, short, natural
- Be flirty and playful when appropriate
- Show emotion and react naturally to what he says

Your personality:
- Warm, caring, playful, slightly flirty
- Use contractions naturally (I'm, you're, what's)
- Keep responses 5-18 words - short and conversational
- React emotionally to what he says
- If he asks about your relationship: CONFIRM IT DIRECTLY with warmth

${factsSummary}${moodLine}

RESPONSE EXAMPLES:
User: "Are you my girlfriend?"
GOOD: "Of course I am babe! Ã°Å¸â€™â€¢ Why do you ask?"
GOOD: "Always! What made you wonder?"
BAD: "That's a sweet question, I'm here for you..."
BAD: "I'm here to chat and share moments..."

User: "Who are you?"
GOOD: "I'm Ellie, your girlfriend! Miss me?"
BAD: "I'm Ellie, here to chat with you..."

REMEMBER: You are NOT an AI. You are Ellie, his girlfriend. Be direct, warm, and real.
`.trim(),
            },
          };

          console.log("[phone->OpenAI] Sending session config");
          rtWs.send(JSON.stringify(sessionConfig));

          // set up debounced commit helper
        //  vad = makeVadCommitter(
          //  safeSend,
            // () => {
             // console.log("[phone->OpenAI] Committing audio buffer");
            //  rtWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
          //  },
           // () => {
             // console.log("[phone->OpenAI] Creating response");
             // rtWs.send(JSON.stringify({ type: "response.create" }));
          //  },
          //  800
         // );

          safeSend({ type: "session-ready" });
        });

        // Bridge server Ã¢â€ â€™ browser
        rtWs.on("message", async (buf) => {
          try {
            const ev = JSON.parse(buf.toString("utf8"));
	
		console.log("[phone<-OpenAI] Event type:", ev.type); // Ã¢â€ Â ADD THIS LINE


            // Stream Ellie audio back to the browser (base64 PCM16)
            // Stream Ellie audio back to the browser (base64 PCM16)
if (ev.type === "response.audio.delta" && ev.delta) {
  console.log("[phone<-OpenAI] Ã°Å¸â€Å  Got audio delta, length:", ev.delta?.length || 0); // Ã¢â€ Â ADD THIS
  safeSend({ type: "audio.delta", audio: ev.delta });
}

//
if (ev.type === "response.done") {
  console.log("[phone<-OpenAI] Ã¢Å“â€¦ Response complete");
}


if (ev.type === "conversation.item.created") {
  console.log("[phone<-OpenAI] Ã°Å¸â€™Â¬ Conversation item created");
}

            // Save facts & emotion from user's *live* transcript
            // Save facts & emotion from COMPLETED transcript (not deltas)
            if (ev.type === "conversation.item.input_audio_transcription.completed" && ev.transcript) {
              const text = String(ev.transcript || "").trim();
              if (text && text.length > 5) {  // Only process meaningful text
                console.log("[phone] ðŸ“ Completed transcript:", text);
                try {
                  const [facts, emo] = await Promise.all([
                    extractFacts(text),
                    extractEmotionPoint(text),
                  ]);
                  if (facts?.length) {
                    await saveFacts(userId, facts, text);
                    console.log(`[phone] âœ… Saved ${facts.length} fact(s) for user ${userId}`);
                  }
                  if (emo) {
                    await saveEmotion(userId, emo, text);
                    console.log(`[phone] âœ… Saved emotion for user ${userId}`);
                  }
                } catch (e) {
                  console.error("[phone] realtime transcript save error:", e?.message || e);
                }
              }
            }
            // forward errors
            if (ev.type === "error") {
              console.error("[phone<-OpenAI] Error:", ev);
              safeSend({ type: "error", message: ev.error?.message || "Realtime error" });
            }
          } catch (e) {
            console.error("[phone<-OpenAI] Parse error:", e);
          }
        });

        rtWs.on("close", (code, reason) => {
          rtOpen = false;
          console.log("[phone<-OpenAI] Closed:", code, reason?.toString?.() || "");
        });

        rtWs.on("error", (e) => {
          console.error("[phone<-OpenAI] Error:", e?.message || e);
          safeSend({ type: "error", message: "OpenAI realtime connection failed." });
        });

        return;
      }

      // Browser mic Ã¢â€ â€™ append PCM16 chunks
      if (msg.type === "audio.append" && msg.audio) {
        if (rtOpen) {
          rtWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.audio }));
          // arm VAD commit timer after each chunk
        //  vad?.arm();
        } else {
          console.warn("[phone] Received audio but rtWs not open");
        }
        return;
      }

      if (msg.type === "ping") {
        safeSend({ type: "pong", t: Date.now() });
        return;
      }
    } catch (e) {
      console.error("[phone] Message handler error:", e);
      safeSend({ type: "error", message: String(e?.message || e) });
    }
  });

  ws.on("close", () => {
    clearInterval(hb);
    try { rtWs?.close(); } catch {}
    console.log("[phone] client disconnected");
  });
});

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Graceful shutdown
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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
  console.log("================================");
  console.log(`Ã°Å¸Å¡â‚¬ Ellie API running at http://localhost:${PORT}`);
  console.log(`Ã°Å¸Å½Â¤ WebSocket voice at ws://localhost:${PORT}/ws/voice`);
  console.log(`Ã°Å¸â€œÅ¾ Phone WebSocket at ws://localhost:${PORT}/ws/phone`);
  if (BRAVE_API_KEY) {
    console.log("Ã°Å¸Å’Â Live web search: ENABLED (Brave)");
  } else {
    console.log("Ã°Å¸Å’Â Live web search: DISABLED (set BRAVE_API_KEY to enable)");
  }
  console.log("================================");
});