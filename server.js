const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { Client } = require('pg');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');

dotenv.config();

const PORT = process.env.PORT || 3000;
const app = express();

// disable ETag to avoid 304 Not Modified for dynamic auth endpoints
app.set('etag', false);

app.use(helmet());
// configure CORS to allow frontend origin(s) and credentials
// default to the production frontend if env not set
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://ismartshop.org';
// allow both https and http variants of the configured frontend plus common dev origins
const FRONTEND_HTTP = FRONTEND_URL.replace(/^https:/, 'http:');
const allowedOrigins = new Set([
  FRONTEND_URL,
  FRONTEND_HTTP,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8080'
]);

const corsOptions = {
  origin: (origin, callback) => {
    // origin is undefined for non-browser requests (curl, server-side)
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    console.warn('[CORS] Blocked origin:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));

// cookie options used when issuing auth cookies.
// Use SameSite=None to allow cross-site cookies (frontend on different origin).
// Ensure Secure is true when frontend/backend are served over HTTPS (Render/GitHub Pages).
// Detect HTTPS based on explicit environment variables (not the default FRONTEND_URL fallback)
const runningOnHttps = ((process.env.BACKEND_URL && process.env.BACKEND_URL.startsWith('https')) || (process.env.FRONTEND_URL && process.env.FRONTEND_URL.startsWith('https')) || (process.env.NODE_ENV === 'production'));
const cookieOptions = { httpOnly: true, sameSite: 'none', secure: runningOnHttps };
const sessionCookieOptions = { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 }; // 7 days

// default BACKEND_URL for email links if not set in env (use deployed Render URL)
process.env.BACKEND_URL = process.env.BACKEND_URL || 'https://ismartshopdatabase.onrender.com';

// static front + uploads
const frontendDir = path.join(__dirname, '..', 'frontend');
const frontendExists = fs.existsSync(frontendDir);
const FRONTEND_BASE = (FRONTEND_URL || '').replace(/\/$/, '');
if(frontendExists){
  app.use(express.static(frontendDir));
} else {
  console.warn('Frontend directory not found at', frontendDir, '\nServing will redirect to FRONTEND_URL (' + FRONTEND_BASE + ') instead.');
}
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// mount upload router
try{ const uploadRouter = require('./upload'); app.use('/upload', uploadRouter); }catch(e){ console.warn('upload router missing', e.message); }

// generic JSON file helpers
function readJSON(file, fallback){ try{ if(!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback)); return JSON.parse(fs.readFileSync(file)); }catch(e){ return fallback; } }
function writeJSON(file, data){ fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

// helper: test whether a string is a UUID (v1-v5 generally)
function isUuid(s){ if(!s || typeof s !== 'string') return false; return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s); }

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const PENDING_FILE = path.join(__dirname, 'data', 'pending_verifications.json');
const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
const CATEGORIES_FILE = path.join(__dirname, 'data', 'categories.json');
const FAVORITES_FILE = path.join(__dirname, 'data', 'favorites.json');

// ensure data dir exists
const dataDir = path.join(__dirname, 'data'); if(!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
// In-memory cache for pending verifications used as fallback when filesystem writes fail
let pendingCache = {};


// In-memory cache for pending verifications used as fallback when filesystem writes fail
// On startup: migrate any previously persisted unverified users into pending verifications
(function migrateUnverifiedUsers(){
  try{
    const users = readJSON(USERS_FILE, []);
    const pending = readPending();
    let migrated = 0;
    const remaining = [];
    for(const u of users){
      if(u && u.verified === false){
        const email = String(u.email || '').trim().toLowerCase();
        if(email){
          pending[email] = { name: u.name || '', email, passwordHash: u.passwordHash || '', code: u.verificationCode || generateVerificationCode(), createdAt: Date.now() };
          migrated++;
        }
      } else {
        remaining.push(u);
      }
    }
    if(migrated>0){
      writeJSON(USERS_FILE, remaining);
      writePending(pending);
      console.log(`[Startup] Migrated ${migrated} previously unverified user(s) into pending verifications`);
    }
  }catch(e){ console.warn('[Startup] Migration failed:', e.message); }
})();

// Sanitize product images stored on disk (fix any 'po' leftovers)
(function sanitizeStoredProducts(){
  try{
    const products = readJSON(PRODUCTS_FILE, []);
    let changed = false;
    for(const p of products){
      const s = (p.image || '') + '';
      if(s === 'po' || s === '/po' || s.endsWith('/po')){
        console.log('[Startup] Sanitizing product image for', p.id, p.title, 'from', s);
        p.image = '';
        changed = true;
      }
    }
    if(changed) writeJSON(PRODUCTS_FILE, products);
  }catch(e){ console.warn('[Startup] Product sanitization failed:', e.message); }
})();

// Postgres client (optional). If DATABASE_URL set, connect and use DB for main operations.
let db = null;
if(process.env.DATABASE_URL){
  db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  db.connect()
    .then(()=> console.log('Connected to Postgres'))
    .then(()=> applyMigrations())
    .then(()=> ensureSchemaCompat())
    .then(()=> migrateJsonToDb())
    .catch(e=> console.error('Postgres connect/migrate error', e.message));
}

// Ensure compatibility fixes for older DB schemas (add missing columns/indexes)
async function ensureSchemaCompat(){
  if(!db) return;
  try{
    const stmts = [
      `ALTER TABLE threads ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id UUID`,
      `ALTER TABLE favorites ADD COLUMN IF NOT EXISTS user_id UUID`,
      `CREATE INDEX IF NOT EXISTS idx_threads_user_id ON threads(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id)`,
      `CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id)`
    ];
    for(const s of stmts){
      try{ await db.query(s); }catch(e){ console.warn('[SCHEMA_FIX] statement failed (may already match or not permitted):', e.message); }
    }
    console.log('[SCHEMA_FIX] compatibility fixes applied');
  }catch(e){ console.warn('[SCHEMA_FIX] failed to apply fixes:', e.message); }
}

// Apply SQL migrations on startup when DB is available
async function applyMigrations(){
  if(!db) return;
  try{
    const sql = fs.readFileSync(path.join(__dirname, 'migrations.sql'), 'utf8');
    // split by semicolon and execute statements (simple approach)
    const stmts = sql.split(/;\s*\n/).map(s=>s.trim()).filter(Boolean);
    for(const s of stmts){
      try{ await db.query(s); }catch(e){ console.warn('[MIGRATE] statement failed (may already exist):', e.message); }
    }
    console.log('[MIGRATE] migrations applied');
  }catch(e){ console.warn('[MIGRATE] failed to apply migrations:', e.message); }
}

// Migrate JSON data into Postgres (opt-in via MIGRATE_JSON=true). It's idempotent: checks for existing rows.
async function migrateJsonToDb(){
  if(!db) return;
  if(String(process.env.MIGRATE_JSON).toLowerCase() !== 'true') return;
  try{
    console.log('[MIGRATE] starting JSON -> Postgres migration');
    const users = readJSON(USERS_FILE, []);
    for(const u of users){
      try{
        const exists = await db.query('SELECT id FROM users WHERE email=$1', [u.email]);
        if(exists.rowCount===0){
          await db.query('INSERT INTO users(id,email,name,password_hash,verified,role,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [u.id, u.email, u.name||null, u.passwordHash||null, !!u.verified, u.role||'user', u.createdAt || new Date().toISOString()]);
        }
      }catch(e){ console.warn('[MIGRATE] users insert failed:', e.message); }
    }

    const pending = readPending();
    for(const [email, p] of Object.entries(pending || {})){
      try{ const ex = await db.query('SELECT email FROM pending_verifications WHERE email=$1', [email]); if(ex.rowCount===0){ await db.query('INSERT INTO pending_verifications(email,name,password_hash,code,created_at) VALUES($1,$2,$3,$4,$5)', [email, p.name||null, p.passwordHash||null, p.code||null, new Date(p.createdAt || Date.now())]); } }catch(e){ console.warn('[MIGRATE] pending insert failed:', e.message); }
    }

    // migrate favorites if file exists
    try{
      const favs = readJSON(FAVORITES_FILE, []);
      for(const f of favs){
        try{ const exists = await db.query('SELECT id FROM favorites WHERE user_id=$1 AND product_id=$2', [f.userId, f.productId]); if(exists.rowCount===0){ await db.query('INSERT INTO favorites(user_id,product_id,created_at) VALUES($1,$2,$3)', [f.userId, f.productId, f.createdAt || new Date().toISOString()]); } }catch(e){ }
      }
    }catch(e){}

    console.log('[MIGRATE] JSON -> Postgres migration complete');
  }catch(e){ console.warn('[MIGRATE] migration failed:', e.message); }
}

async function queryDb(text, params){
  if(!db) throw new Error('db not configured');
  try{
    const r = await db.query(text, params);
    return r;
  }catch(e){
    // Log full error for diagnostics
    console.error('[queryDb] error executing:', text, 'params:', params, 'error:', e && e.stack ? e.stack : e.message || e);
    // If it's a schema-related error, attempt to apply compatibility fixes and retry once
    const msg = (e && e.message) ? String(e.message).toLowerCase() : '';
    if(msg.includes('column "user_id"') || msg.includes('relation "favorites"') || msg.includes('does not exist') || msg.includes('undefined column')){
      try{
        console.log('[queryDb] detected possible schema mismatch, attempting ensureSchemaCompat and retry');
        await ensureSchemaCompat();
        const r2 = await db.query(text, params);
        return r2;
      }catch(e2){
        console.error('[queryDb] retry after schema fix failed:', e2 && e2.stack ? e2.stack : e2.message || e2);
        throw e2;
      }
    }
    throw e;
  }
}

// setup nodemailer transporter (if SMTP configured)
let transporter = null;
if(process.env.SMTP_HOST){
  transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT||587), secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
}

app.get('/api/health', (req,res)=> res.json({ ok:true, time:Date.now() }));

// Get Telegram contact info (public endpoint)
app.get('/api/config', (req,res)=>{
  res.json({
    telegramContact: process.env.TELEGRAM_CONTACT || null
  });
});

// ============ AUTHENTICATION ============

// Helper function to validate email
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Helper function to generate a verification code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Escape HTML to avoid injection in email templates
function escapeHtml(str){
  if(!str) return '';
  return String(str).replace(/[&<>"'`]/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;', '`':'&#96;'})[m]; });
}

// Build verification email content (html + text) with safe escaping
function buildVerificationEmail(name, code){
  const n = name ? String(name).trim() : '';
  const subject = 'Добро пожаловать в iSmartShop — код подтверждения';
  const html = `
    <p>Эй, ${escapeHtml(n || '')}!</p>
    <p>Добро пожаловать на наш магазин iSmartShop.</p>
    <p>Вот ваш код верификации: <strong>${escapeHtml(code)}</strong></p>
    <p><strong>Внимание!</strong> Не делитесь этим кодом ни с кем, ни в коем случае, даже если к вам обращаются от имени сотрудников нашего магазина!</p>
    <p>Рекомендуется сначала ознакомиться с документацией перед использованием данного сервиса.</p>
    <p>С уважением,<br/>команда iSmartShop</p>
  `;
  const text = [
    `Эй, ${n}!`,
    '',
    'Добро пожаловать на наш магазин iSmartShop.',
    '',
    `Вот ваш код верификации: ${code}`,
    '',
    'Внимание! Не делитесь этим кодом ни с кем, ни в коем случае, даже если к вам обращаются от имени сотрудников нашего магазина!',
    '',
    'Рекомендуется сначала ознакомиться с документацией перед использованием данного сервиса.',
    '',
    'С уважением,',
    'команда iSmartShop'
  ].join('\n');
  return { subject, html, text };
}

// Password hashing helpers with fallback to pbkdf2 when bcrypt is unavailable/fails
async function hashPassword(password){
  try{
    return await bcrypt.hash(password, 10);
  }catch(e){
    console.warn('[Auth] bcrypt.hash failed, falling back to pbkdf2:', e && e.message ? e.message : e);
    const salt = crypto.randomBytes(16).toString('hex');
    const iterations = 310000;
    const derived = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');
    return `pbkdf2$${iterations}$${salt}$${derived}`;
  }
}

async function verifyPassword(password, storedHash){
  if(!storedHash) return false;
  try{
    if(String(storedHash).startsWith('pbkdf2$')){
      const parts = storedHash.split('$');
      const iterations = Number(parts[1] || 310000);
      const salt = parts[2] || '';
      const derived = parts[3] || '';
      const check = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');
      return check === derived;
    }
    // otherwise assume bcrypt
    return await bcrypt.compare(password, storedHash);
  }catch(e){
    console.warn('[Auth] verifyPassword fallback caught error:', e && e.message ? e.message : e);
    // As a last resort, attempt pbkdf2 compare in case storedHash was pbkdf2-like but malformed
    try{
      const parts = String(storedHash).split('$');
      if(parts[0] === 'pbkdf2'){
        const iterations = Number(parts[1] || 310000);
        const salt = parts[2] || '';
        const derived = parts[3] || '';
        const check = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('hex');
        return check === derived;
      }
    }catch(e2){/* ignore */}
    return false;
  }
}

// Pending verifications helpers
function readPending(){ try{ if(!fs.existsSync(PENDING_FILE)) fs.writeFileSync(PENDING_FILE, JSON.stringify({})); const s = JSON.parse(fs.readFileSync(PENDING_FILE)); // keep cache up-to-date
  pendingCache = s || {}; return s; }catch(e){ console.warn('[Pending] read failed, falling back to in-memory cache:', e && e.message ? e.message : e); return pendingCache || {}; } }
function writePending(data){ try{ fs.writeFileSync(PENDING_FILE, JSON.stringify(data, null, 2)); pendingCache = data; return true; }catch(e){ console.error('[Pending] write failed, using in-memory cache:', e && e.stack ? e.stack : e); pendingCache = data; return false; } }

// Purge pending entries older than 24 hours
function purgeExpiredPending(){
  try{
    const pending = readPending();
    const now = Date.now();
    let changed = false;
    Object.keys(pending).forEach(email=>{
      if(pending[email] && pending[email].createdAt && (now - pending[email].createdAt) > 24 * 3600 * 1000){
        delete pending[email]; changed = true;
      }
    });
    if(changed) writePending(pending);
  }catch(e){/* ignore */}
}


// POST /auth/register
app.post('/auth/register', async (req, res) => {
  try {
    purgeExpiredPending();
    const { email, password, name } = req.body;
    // minimal safe logging (do NOT log passwords)
    try{ console.log('[Register] request for:', { email: email ? String(email).slice(0,100) : null, name: name ? String(name).slice(0,40) : null }); }catch(e){}

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const normEmail = String(email).trim().toLowerCase();

    // If DB present, check users table
    if(db){
      const existing = await queryDb('SELECT id,email FROM users WHERE email=$1', [normEmail]).catch(()=>({ rowCount: 0 }));
      if(existing && existing.rowCount && existing.rowCount>0){
        return res.status(409).json({ error: 'Email already registered' });
      }

      // store pending verification in DB
      const pendingRow = (await queryDb('SELECT email,code,created_at FROM pending_verifications WHERE email=$1', [normEmail])).rows[0];
      const newCode = generateVerificationCode();
      const hashedPassword = await hashPassword(password);
      if(pendingRow){
        await queryDb('UPDATE pending_verifications SET code=$1, password_hash=$2, created_at=$3 WHERE email=$4', [newCode, hashedPassword, new Date().toISOString(), normEmail]);
      } else {
        await queryDb('INSERT INTO pending_verifications(email,name,password_hash,code,created_at) VALUES($1,$2,$3,$4,$5)', [normEmail, String(name).trim(), hashedPassword, newCode, new Date().toISOString()]);
      }

      if(transporter){ const msg = buildVerificationEmail(name || '', newCode); transporter.sendMail({ from: process.env.FROM_EMAIL||process.env.SMTP_USER, to: normEmail, subject: msg.subject, html: msg.html, text: msg.text }).catch(()=>{}); }
      const resp = { message: 'Verification code generated. Please verify your email.' };
      if(!transporter && process.env.DEBUG_SHOW_CODE==='true') resp.code = newCode;
      return res.status(201).json(resp);
    }

    // file fallback (existing behavior)
    const users = readJSON(USERS_FILE, []);
    if (users.find(user => user.email === normEmail)) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Create or update pending verification entry (do NOT persist user yet)
    const pending = readPending();

    if(pending[normEmail]){
      // Already pending: update code + timestamp (resend)
      const newCode = generateVerificationCode();
      pending[normEmail].code = newCode;
      if(password) pending[normEmail].passwordHash = await hashPassword(password);
      pending[normEmail].createdAt = Date.now();
      const saved = writePending(pending);
      if(!saved) console.warn('[Register] Warning: pending verification not persisted to disk, held in-memory only');
      if (transporter) {
        try{ const msg = buildVerificationEmail(pending[normEmail].name || '', newCode); transporter.sendMail({ from: process.env.FROM_EMAIL || process.env.SMTP_USER, to: normEmail, subject: msg.subject, html: msg.html, text: msg.text }).catch(()=>{}); }catch(e){}
      }
      const resp = { message: 'Verification code resent. Please check your email.' };
      if(!transporter && process.env.DEBUG_SHOW_CODE==='true') resp.code = newCode;
      return res.json(resp);
    }

    const code = generateVerificationCode();
    const hashedPassword = await hashPassword(password);

    pending[normEmail] = {
      name: String(name).trim(),
      email: normEmail,
      passwordHash: hashedPassword,
      code,
      createdAt: Date.now()
    };

    const saved = writePending(pending);
    if(!saved) console.warn('[Register] Warning: pending verification not persisted to disk, held in-memory only');
    console.log(`[Register] Pending verification created for ${normEmail}`);
    if(process.env.DEBUG_SHOW_CODE==='true') console.log(`[Register][DEBUG] code for ${normEmail}: ${code}`);

    if (transporter) {
      try{ const msg = buildVerificationEmail(pending[normEmail].name || '', code); transporter.sendMail({ from: process.env.FROM_EMAIL || process.env.SMTP_USER, to: normEmail, subject: msg.subject, html: msg.html, text: msg.text }).catch(()=>{}); }catch(e){}
    }

    const responseBody = { message: 'Verification code generated. Please verify your email.' };
    if(!transporter && process.env.DEBUG_SHOW_CODE==='true') responseBody.code = code;
    return res.status(201).json(responseBody);
  } catch (error) {
    console.error('[Register] Error stack:', error && error.stack ? error.stack : error);
    // In debug mode expose error message/stack for easier debugging; otherwise return a safe message
    if(process.env.DEBUG_REGISTER === 'true' || process.env.DEBUG_SHOW_CODE === 'true'){
      return res.status(500).json({ error: error && error.message ? error.message : 'Server error', stack: (error && error.stack) ? error.stack : undefined });
    }
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /auth/verify
app.post('/auth/verify', async (req, res) => {
  try {
    purgeExpiredPending();
    const { email, code } = req.body;
    if(!email || !code) return res.status(400).json({ error: 'Email and code are required' });
    const normEmail = String(email).trim().toLowerCase();
    if(db){
      const entryRow = (await queryDb('SELECT email,name,password_hash,code FROM pending_verifications WHERE email=$1', [normEmail])).rows[0];
      if(!entryRow) return res.status(404).json({ error: 'No pending verification found for this email' });
      if(String(entryRow.code) !== String(code).trim()) return res.status(400).json({ error: 'Invalid verification code' });

      // create user in DB
      const id = uuidv4();
      await queryDb('INSERT INTO users(id,email,name,password_hash,verified,role,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, entryRow.email, entryRow.name || null, entryRow.password_hash || null, true, 'user', new Date().toISOString()]);
      // remove pending
      await queryDb('DELETE FROM pending_verifications WHERE email=$1', [normEmail]);
      return res.json({ message: 'Email verified successfully' });
    }

    // file fallback
    const pending = readPending();
    const entry = pending[normEmail];
    if(!entry) return res.status(404).json({ error: 'No pending verification found for this email' });
    if(entry.code !== String(code).trim()){
      return res.status(400).json({ error: 'Invalid verification code' });
    }
    const users = readJSON(USERS_FILE, []);
    if(users.find(u=>u.email === entry.email)){
      delete pending[entry.email]; const savedExisting = writePending(pending); if(!savedExisting) console.warn('[Verify] Warning: pending removal not persisted, held in-memory only');
      return res.json({ message: 'Email verified successfully' });
    }
    const newUser = {
      id: uuidv4(),
      email: entry.email,
      passwordHash: entry.passwordHash,
      name: entry.name,
      verified: true,
      role: 'user',
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    writeJSON(USERS_FILE, users);
    delete pending[entry.email]; const savedRemove = writePending(pending); if(!savedRemove) console.warn('[Verify] Warning: pending removal not persisted, held in-memory only');
    console.log(`[Verify] User created and verified: ${entry.email}`);
    return res.json({ message: 'Email verified successfully' });
  } catch (error) {
    console.error('[Verify] Error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /auth/resend - resend verification code for pending email
app.post('/auth/resend', async (req, res) => {
  try{
    purgeExpiredPending();
    const { email } = req.body;
    if(!email) return res.status(400).json({ error: 'Email required' });
    const norm = String(email).trim().toLowerCase();
    if(db){
      const row = (await queryDb('SELECT email,name FROM pending_verifications WHERE email=$1', [norm])).rows[0];
      if(!row) return res.status(404).json({ error: 'No pending verification for this email' });
      const newCode = generateVerificationCode();
      await queryDb('UPDATE pending_verifications SET code=$1, created_at=$2 WHERE email=$3', [newCode, new Date().toISOString(), norm]);
      if(transporter){ const msg = buildVerificationEmail(row.name || '', newCode); transporter.sendMail({ from: process.env.FROM_EMAIL||process.env.SMTP_USER, to: norm, subject: msg.subject, html: msg.html, text: msg.text }).catch(()=>{}); }
      const resp = { ok: true }; if(!transporter && process.env.DEBUG_SHOW_CODE==='true') resp.code = newCode; return res.json(resp);
    }

    const pending = readPending();
    const entry = pending[norm];
    if(!entry) return res.status(404).json({ error: 'No pending verification for this email' });
    const newCode = generateVerificationCode();
    entry.code = newCode; entry.createdAt = Date.now();
    const savedResend = writePending(pending); if(!savedResend) console.warn('[Resend] Warning: pending update not persisted, held in-memory only');
    if(transporter){ try{ const msg = buildVerificationEmail(entry.name || '', newCode); transporter.sendMail({ from: process.env.FROM_EMAIL || process.env.SMTP_USER, to: entry.email, subject: msg.subject, html: msg.html, text: msg.text }).catch(()=>{}); }catch(e){}
    }
    const resp = { ok: true };
    if(!transporter && process.env.DEBUG_SHOW_CODE==='true') resp.code = newCode;
    return res.json(resp);
  }catch(e){ console.error('[Resend] Error:', e.message); return res.status(500).json({ error: 'Server error' }); }
});

// POST /auth/login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const norm = String(email || '').trim().toLowerCase();
    if(db){
      const q = await queryDb('SELECT id,email,password_hash,verified,role,name FROM users WHERE email=$1', [norm]);
      if(!q || q.rowCount===0) return res.status(401).json({ error: 'Invalid email or password' });
      const u = q.rows[0];
      const valid = await verifyPassword(password, u.password_hash || u.password_hash || u.passwordHash || null);
      if(!valid) return res.status(401).json({ error: 'Invalid email or password' });
      if(!u.verified) return res.status(403).json({ error: 'Email not verified' });
      const token = jwt.sign({ id: u.id, email: u.email, role: u.role || 'user' }, process.env.SESSION_SECRET || 'devsecret', { expiresIn: '7d' });
      res.cookie('token', token, sessionCookieOptions);
      return res.json({ message: 'Login successful', token });
    }

    // file fallback
    const users = readJSON(USERS_FILE, []);
    const user = users.find(user => user.email === norm);
    const valid = await verifyPassword(password, user && user.passwordHash);
    if (!user || !valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.verified) return res.status(403).json({ error: 'Email not verified' });
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.SESSION_SECRET || 'devsecret', { expiresIn: '7d' });
    res.cookie('token', token, sessionCookieOptions);
    res.json({ message: 'Login successful', token });
  } catch (error) {
    console.error('[Login] Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /auth/me - Get current user
app.get('/auth/me', async (req, res) => {
  try {
    // Do not cache auth responses
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    
    // Prefer cookie token, but accept Authorization: Bearer <token> as fallback
    let token = null;
    const authHeader = (req.headers && req.headers.authorization) || '';
    if (authHeader && String(authHeader).startsWith('Bearer ')) {
      token = String(authHeader).slice(7);
      console.log('[Auth/me] Using Bearer token from Authorization header');
    }
    if (!token) {
      token = (req.cookies && req.cookies.token) || null;
      if(token) console.log('[Auth/me] Using token from cookie');
    }

    if (!token) {
      console.log('[Auth/me] No token found in Authorization header or cookies');
      return res.json(null);
    }
    
    try {
      const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'devsecret');
      console.log('[Auth/me] Token verified. Decoded:', { id: decoded.id, role: decoded.role });
      
      // If the token represents the admin created via /auth/admin-login, return an admin profile
      if(decoded && decoded.role === 'admin'){
        const adminProfile = { id: decoded.id, email: decoded.email || null, name: process.env.ADMIN_USER || 'admin', role: 'admin', verified: true, createdAt: null };
        console.log('[Auth/me] Returning admin profile:', adminProfile);
        return res.json(adminProfile);
      }

      if(db){
        try{
          const q = await queryDb('SELECT id,email,name,role,verified,created_at FROM users WHERE id=$1', [decoded.id]);
          if(!q || q.rowCount===0) return res.json(null);
          const u = q.rows[0];
          return res.json({ id: u.id, email: u.email, name: u.name, role: u.role, verified: u.verified, createdAt: u.created_at });
        }catch(e){ console.error('[Auth/me] db read error', e.message); return res.json(null); }
      }
      const users = readJSON(USERS_FILE, []);
      const user = users.find(x => x.id === decoded.id);
      if (!user) { console.log('[Auth/me] User not found in users.json for id:', decoded.id); return res.json(null); }
      return res.json({ id: user.id, email: user.email, name: user.name, role: user.role, verified: user.verified, createdAt: user.createdAt });
    } catch (tokenErr) {
      // Invalid token
      console.error('[Auth/me] Token verification failed:', tokenErr.message);
      return res.json(null);
    }
  } catch (err) {
    console.error('[Auth/me] Error:', err.message);
    return res.json(null);
  }
});

// POST /auth/logout
app.post('/auth/logout', (req, res) => {
  res.clearCookie('token', cookieOptions);
  return res.json({ message: 'Logged out' });
});

// Middleware to log all incoming requests
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

// Auth middleware for protected routes
function authMiddleware(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.cookies && req.cookies.token) || null;
    
    if (!token) {
      return res.status(401).json({ error: 'unauthorized - token missing' });
    }
    
    const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'devsecret');
    req.user = decoded;
    next();
  } catch (e) {
    console.error('Token verification failed:', e.message);
    return res.status(401).json({ error: 'unauthorized - invalid token' });
  }
}

function adminOnly(req, res, next) { 
  if (!req.user) return res.status(401).json({ error: 'unauthorized' }); 
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' }); 
  next(); 
}

// Try decode token without throwing - used for optional auth inference
function tryDecodeTokenFromReq(req){
  try{
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.cookies && req.cookies.token) || null;
    if(!token) return null;
    const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'devsecret');
    return decoded;
  }catch(e){ return null; }
}

// Admin login using credentials from environment
app.post('/auth/admin-login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS) {
      return res.status(501).json({ error: 'Admin login not configured' });
    }
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    if (username !== process.env.ADMIN_USER || password !== process.env.ADMIN_PASS) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Create JWT token for admin
    const token = jwt.sign(
      { id: 'admin-' + (process.env.ADMIN_USER || 'admin'), role: 'admin', email: null },
      process.env.SESSION_SECRET || 'devsecret',
      { expiresIn: '7d' }
    );
    
    // Admin login should also set session cookie with same options
    res.cookie('token', token, sessionCookieOptions);
    
    console.log('[Admin Login] Successful');
    
    return res.json({ message: 'Admin login successful', token });
  } catch (err) {
    console.error('[Admin Login] Error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Debug endpoint - return decoded token (no verification)
app.get('/auth/debug-token', (req, res) => {
  try {
    const token = (req.cookies && req.cookies.token) || null;
    if (!token) {
      return res.status(400).json({ error: 'No token found' });
    }
    
    const decoded = jwt.decode(token);
    return res.json({ decoded });
  } catch (err) {
    return res.status(500).json({ error: 'Decode error' });
  }
});

// Auth info endpoint
app.get('/auth', (req, res) => {
  return res.json({
    message: 'iSmartShop Auth API',
    endpoints: {
      register: 'POST /auth/register',
      verify: 'POST /auth/verify', 
      login: 'POST /auth/login',
      logout: 'POST /auth/logout',
      me: 'GET /auth/me',
      adminLogin: 'POST /auth/admin-login'
    }
  });
});

// Products
app.get('/api/products', (req,res)=>{
  (async ()=>{
    if(db){
      try{
        const q = await queryDb("SELECT id,title,price,image,category,description,colors,status,owner_id,created_at FROM products " + (req.query.all==='1' ? '' : "WHERE status='approved'"));
        const rows = q.rows.map(r=> ({ id: r.id, title: r.title, price: r.price, image: sanitizeImageSrc(r.image), category: r.category, description: r.description, colors: r.colors || [], status: r.status, ownerId: r.owner_id, createdAt: r.created_at }));
        return res.json(rows);
      }catch(err){ console.error('db products err', err.message); }
    }
    const products = readJSON(PRODUCTS_FILE, []).map(p => ({ ...p, image: sanitizeImageSrc(p.image) }));
    const onlyApproved = req.query.all === '1' ? products : products.filter(p => p.status === 'approved');
    res.json(onlyApproved);
  })();
});

// Helper to sanitize image src values
function sanitizeImageSrc(src){
  try{
    if(!src) return '';
    const s = String(src).trim();
    if(s === 'po' || s === '/po' || s.endsWith('/po')) return '';
    return s;
  }catch(e){ return ''; }
}

app.get('/api/products/:id', (req,res)=>{
  (async ()=>{
    if(db){
      try{
        const q = await queryDb('SELECT id,title,price,image,category,description,colors,status,owner_id,created_at FROM products WHERE id=$1', [req.params.id]);
        if(q.rows.length===0) return res.status(404).json({ error:'not found' });
        const r = q.rows[0]; return res.json({ id: r.id, title: r.title, price: r.price, image: r.image || '', category: r.category, description: r.description, colors: r.colors || [], status: r.status, ownerId: r.owner_id, createdAt: r.created_at });
      }catch(e){ console.error('db product err', e.message); }
    }
    const products = readJSON(PRODUCTS_FILE, []);
    const p = products.find(x=>x.id === req.params.id);
    if(!p) return res.status(404).json({ error:'not found' });
    res.json({...p, image: p.image || ''});
  })();
});

app.post('/api/products', authMiddleware, async (req,res)=>{
  const body = req.body; if(!body.title || !body.price) return res.status(400).json({ error:'missing' });
  const image = sanitizeImageSrc(body.image || '');
  if(db){
    try{
      const id = Date.now().toString();
      await queryDb('INSERT INTO products(id,title,price,image,category,description,colors,owner_id,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, body.title, body.price, image, body.category||'', body.description||'', JSON.stringify(body.colors||[]), req.user.id, 'approved', new Date().toISOString()]);
      const q = await queryDb('SELECT id,title,price,image,category,description,colors,status,owner_id,created_at FROM products WHERE id=$1', [id]);
      const r = q.rows[0];
      return res.status(201).json({ id: r.id, title: r.title, price: r.price, image: sanitizeImageSrc(r.image), category: r.category, description: r.description, colors: r.colors || [], status: r.status, ownerId: r.owner_id, createdAt: r.created_at });
    }catch(e){ console.error('db insert product', e.message); return res.status(500).json({ error:'db error' }); }
  }
  const products = readJSON(PRODUCTS_FILE, []);
  const newP = { id: Date.now().toString(), title: body.title, price: body.price, image, category: body.category||'', description: body.description||'', colors: body.colors||[], ownerId: req.user.id, status:'approved', createdAt: new Date().toISOString() };
  products.push(newP); writeJSON(PRODUCTS_FILE, products); res.status(201).json(newP);
});

app.put('/api/products/:id', authMiddleware, (req,res)=>{
  (async ()=>{
    if(db){
      try{
        const body = req.body;
        const fields = [];
        const vals = [];
        let i = 1;
        for(const k of ['title','price','image','category','description','colors','status']){
          if(Object.prototype.hasOwnProperty.call(body,k)){
            fields.push(`${k} = $${i}`);
            if(k === 'colors') vals.push(JSON.stringify(body[k]));
            else if(k === 'image') vals.push(sanitizeImageSrc(body[k]));
            else vals.push(body[k]);
            i++;
          }
        }
        if(fields.length>0){
          vals.push(req.params.id);
          await queryDb(`UPDATE products SET ${fields.join(',')} WHERE id=$${i}`, vals);
        }
        const q = await queryDb('SELECT id,title,price,image,category,description,colors,status,owner_id,created_at FROM products WHERE id=$1', [req.params.id]);
        if(q.rows.length===0) return res.status(404).json({ error:'not found' });
        const r = q.rows[0]; return res.json({ id: r.id, title: r.title, price: r.price, image: r.image, category: r.category, description: r.description, colors: r.colors || [], status: r.status, ownerId: r.owner_id, createdAt: r.created_at });
      }catch(e){ console.error('db update product', e.message); }
    }
    const products = readJSON(PRODUCTS_FILE, []);
    const idx = products.findIndex(p=>p.id===req.params.id);
    if(idx===-1) return res.status(404).json({ error:'not found' });
    products[idx] = { ...products[idx], ...req.body, id: products[idx].id };
    writeJSON(PRODUCTS_FILE, products);
    res.json(products[idx]);
  })();
});

app.delete('/api/products/:id', authMiddleware, (req,res)=>{
  (async ()=>{
    if(db){
      try{
        const r = await queryDb('DELETE FROM products WHERE id=$1 RETURNING id', [req.params.id]);
        if(r.rowCount===0) return res.status(404).json({ error:'not found' });
        return res.json({ message:'deleted' });
      }catch(e){ console.error('db delete product', e.message); }
    }
    const products = readJSON(PRODUCTS_FILE, []);
    const filtered = products.filter(p=>p.id!==req.params.id);
    if(filtered.length===products.length) return res.status(404).json({ error:'not found' });
    writeJSON(PRODUCTS_FILE, filtered);
    res.json({ message:'deleted' });
  })();
});

// moderation endpoints
app.get('/api/products/moderation', authMiddleware, adminOnly, (req,res)=>{ const products = readJSON(PRODUCTS_FILE, []); res.json(products.filter(p=>p.status==='pending')); });
app.post('/api/products/:id/approve', authMiddleware, adminOnly, (req,res)=>{ const products = readJSON(PRODUCTS_FILE, []); const idx=products.findIndex(p=>p.id===req.params.id); if(idx===-1) return res.status(404).json({error:'not found'}); products[idx].status='approved'; writeJSON(PRODUCTS_FILE, products); res.json(products[idx]); });
app.post('/api/products/:id/reject', authMiddleware, adminOnly, (req,res)=>{ const products = readJSON(PRODUCTS_FILE, []); const idx=products.findIndex(p=>p.id===req.params.id); if(idx===-1) return res.status(404).json({error:'not found'}); products[idx].status='rejected'; writeJSON(PRODUCTS_FILE, products); res.json(products[idx]); });

// ---------------- CATEGORIES ----------------
app.get('/api/categories', (req,res)=>{ const cats = readJSON(CATEGORIES_FILE, []); res.json(cats); });
app.post('/api/categories', authMiddleware, adminOnly, (req,res)=>{ const cats = readJSON(CATEGORIES_FILE, []); if(!req.body.name) return res.status(400).json({ error:'name required' }); if(cats.some(c=>c.name.toLowerCase()===req.body.name.toLowerCase())) return res.status(409).json({ error:'exists' }); const nc = { id: Date.now().toString(), name: req.body.name }; cats.push(nc); writeJSON(CATEGORIES_FILE,cats); res.status(201).json(nc); });
app.delete('/api/categories/:id', authMiddleware, adminOnly, (req,res)=>{ const cats=readJSON(CATEGORIES_FILE,[]); const id=req.params.id; const filtered=cats.filter(c=>c.id!==id); if(filtered.length===cats.length) return res.status(404).json({error:'not found'}); writeJSON(CATEGORIES_FILE,filtered); // remove products in that category
  const products = readJSON(PRODUCTS_FILE,[]).filter(p=>p.category!==id); writeJSON(PRODUCTS_FILE, products); res.json({ message:'deleted' });
});

// No chat endpoints (chat system removed)

// ---------------- STATS ----------------
app.get('/api/admin/stats', authMiddleware, adminOnly, (req,res)=>{ const users = readJSON(USERS_FILE,[]); const products = readJSON(PRODUCTS_FILE,[]); res.json({ users: users.length, products: products.length }); });

// Favorites helpers (file fallback)
function readFavorites(){ try{ if(!fs.existsSync(FAVORITES_FILE)) fs.writeFileSync(FAVORITES_FILE, JSON.stringify([])); return JSON.parse(fs.readFileSync(FAVORITES_FILE)); }catch(e){ return []; } }
function writeFavorites(data){ try{ fs.writeFileSync(FAVORITES_FILE, JSON.stringify(data, null, 2)); return true; }catch(e){ return false; } }

// ---------------- FAVORITES ----------------
// Get current user's favorites
app.get('/api/favorites', authMiddleware, async (req,res)=>{
  const uid = req.user && req.user.id;
  console.log('[Favorites GET] User ID:', uid, 'User email:', req.user && req.user.email);
  if(!uid) return res.status(400).json({ error:'user required' });
  if(db){
    try{
      if(!isUuid(uid)){
        console.log('[Favorites GET] UID is not UUID:', uid, 'using file fallback');
        // skip DB when uid is not a UUID (use file fallback below)
      } else {
        const q = await queryDb('SELECT product_id,created_at FROM favorites WHERE user_id=$1 ORDER BY created_at DESC', [uid]);
        console.log('[Favorites GET] DB query result:', q.rows);
        return res.json(q.rows);
      }
    }catch(e){ console.error('[Favorites] db get error', e.message); }
  }
  const favs = readFavorites().filter(f=>f.userId === uid);
  console.log('[Favorites GET] File result:', { userId: uid, count: favs.length, items: favs });
  res.json(favs);
});

// Add favorite
app.post('/api/favorites', authMiddleware, async (req,res)=>{
  const uid = req.user && req.user.id; const { productId } = req.body || {};
  console.log('[Favorites POST] Adding favorite:', { userId: uid, productId, userEmail: req.user && req.user.email });
  if(!uid || !productId) return res.status(400).json({ error:'missing' });
  if(db){
    try{ await queryDb('INSERT INTO favorites(user_id,product_id,created_at) VALUES($1,$2,$3) ON CONFLICT (user_id,product_id) DO NOTHING', [uid, productId, new Date().toISOString()]); console.log('[Favorites POST] DB insert success'); return res.json({ ok:true }); }catch(e){ console.error('[Favorites] db insert error', e.message); }
  }
  const favs = readFavorites(); if(!favs.some(f=>f.userId===uid && f.productId===productId)){ favs.push({ userId: uid, productId, createdAt: new Date().toISOString() }); writeFavorites(favs); console.log('[Favorites POST] File insert success'); } res.json({ ok:true });
});

// Remove favorite
app.delete('/api/favorites/:productId', authMiddleware, async (req,res)=>{
  const uid = req.user && req.user.id; const pid = req.params.productId;
  console.log('[Favorites DELETE] Removing favorite:', { userId: uid, productId: pid, userEmail: req.user && req.user.email });
  if(!uid || !pid) return res.status(400).json({ error:'missing' });
  if(db){
    try{
      if(!isUuid(uid)){
        // skip DB delete when uid not UUID; fall back to file below
        console.log('[Favorites DELETE] userId not UUID, using file fallback');
      } else {
        await queryDb('DELETE FROM favorites WHERE user_id=$1 AND product_id=$2', [uid, pid]);
        console.log('[Favorites DELETE] DB delete success');
        return res.json({ ok:true });
      }
    }catch(e){ console.error('[Favorites DELETE] db delete error', e.message); }
  }
  let favs = readFavorites(); const before = favs.length; favs = favs.filter(f=> !(f.userId===uid && f.productId===pid)); if(favs.length !== before) { writeFavorites(favs); console.log('[Favorites DELETE] File delete success'); } else { console.log('[Favorites DELETE] Favorite not found in file'); } res.json({ ok:true });
});

// --------- Admin DB management endpoints (adminOnly) ---------
// Get DB / storage info
app.get('/admin/db/info', authMiddleware, adminOnly, async (req, res) => {
  try{
    const info = { db: !!db, dataDir, pendingFile: PENDING_FILE };
    if(db){
      const dbsize = (await queryDb("SELECT pg_size_pretty(pg_database_size(current_database())) as size")).rows[0].size;
      const usersize = (await queryDb("SELECT pg_size_pretty(pg_total_relation_size('public.users')) as size")).rows[0].size;
      info.dbSize = dbsize; info.usersTableSize = usersize;
      const q = await queryDb('SELECT count(1) as users_count FROM users'); info.userCount = Number(q.rows[0].users_count);
    } else {
      const users = readJSON(USERS_FILE, []);
      info.userCount = users.length;
      try{ const st = fs.statSync(USERS_FILE); info.userFileSize = st.size; }catch(e){}
    }
    return res.json(info);
  }catch(e){ console.error('[AdminDB] info error', e && e.stack ? e.stack : e); return res.status(500).json({ error: 'error' }); }
});

// List users (paginated)
app.get('/admin/db/users', authMiddleware, adminOnly, async (req,res)=>{
  try{
    const limit = Math.min(1000, Number(req.query.limit) || 200);
    if(db){
      const q = await queryDb('SELECT id,email,name,role,verified,created_at FROM users ORDER BY created_at DESC LIMIT $1', [limit]);
      return res.json(q.rows);
    }
    const users = readJSON(USERS_FILE, []);
    return res.json(users.slice(0, limit).map(u=>({ id: u.id, email: u.email, name: u.name, role: u.role, verified: u.verified, createdAt: u.createdAt })));
  }catch(e){ console.error('[AdminDB] users list error', e); return res.status(500).json({ error:'error' }); }
});

// Delete user by email
app.post('/admin/db/delete-user', authMiddleware, adminOnly, async (req,res)=>{
  try{
    const { email } = req.body || {};
    if(!email) return res.status(400).json({ error: 'email required' });
    if(db){
      const q = await queryDb('DELETE FROM users WHERE email=$1 RETURNING id,email', [String(email).trim()]);
      if(q.rowCount===0) return res.status(404).json({ error:'not found' });
      return res.json({ deleted: q.rows[0] });
    }
    // file storage fallback
    const users = readJSON(USERS_FILE, []);
    const idx = users.findIndex(u=>u.email === String(email).trim());
    if(idx === -1) return res.status(404).json({ error:'not found' });
    const removed = users.splice(idx,1)[0];
    // backup and write
    try{ fs.copyFileSync(USERS_FILE, `${USERS_FILE}.${Date.now()}.bak`); }catch(e){}
    writeJSON(USERS_FILE, users);
    return res.json({ deleted: { id: removed.id, email: removed.email } });
  }catch(e){ console.error('[AdminDB] delete-user error', e); return res.status(500).json({ error: 'error' }); }
});

// Truncate users (dangerous)
app.post('/admin/db/truncate-users', authMiddleware, adminOnly, async (req,res)=>{
  try{
    const confirm = req.body && req.body.confirm === true;
    if(!confirm) return res.status(400).json({ error: 'confirm required (send { confirm: true })' });
    if(db){
      await queryDb('TRUNCATE TABLE users RESTART IDENTITY CASCADE');
      return res.json({ ok:true });
    }
    // file-based: backup then clear
    try{ fs.copyFileSync(USERS_FILE, `${USERS_FILE}.${Date.now()}.bak`); }catch(e){}
    writeJSON(USERS_FILE, []);
    return res.json({ ok:true });
  }catch(e){ console.error('[AdminDB] truncate error', e); return res.status(500).json({ error:'error' }); }
});

// Run VACUUM / ANALYZE
app.post('/admin/db/vacuum', authMiddleware, adminOnly, async (req,res)=>{
  try{
    if(!db) return res.status(400).json({ error: 'not using postgres' });
    const full = !!(req.body && req.body.full);
    const sql = full ? 'VACUUM FULL;' : 'VACUUM ANALYZE;';
    await queryDb(sql);
    return res.json({ ok:true, type: full ? 'full' : 'analyze' });
  }catch(e){ console.error('[AdminDB] vacuum error', e); return res.status(500).json({ error:'error' }); }
});

// Execute arbitrary SQL (admin only) - use with caution
app.post('/admin/db/execute', authMiddleware, adminOnly, async (req,res)=>{
  try{
    const { sql } = req.body || {};
    if(!sql) return res.status(400).json({ error:'sql required' });
    if(!db) return res.status(400).json({ error:'Postgres not configured' });
    // Simple protection: reject statements containing pg_terminate_backend etc
    const forbidden = /pg_terminate_backend|pg_cancel_backend|\bdrop\b/mi;
    if(forbidden.test(sql)) return res.status(400).json({ error:'prohibited statement' });
    const q = await queryDb(sql);
    return res.json({ rows: q.rows, rowCount: q.rowCount });
  }catch(e){ console.error('[AdminDB] execute error', e); return res.status(500).json({ error: e.message || 'error' }); }
});

// Backup JSON data files
app.post('/admin/db/backup-json', authMiddleware, adminOnly, async (req,res)=>{
  try{
    const backupDir = path.join(__dirname, 'backups'); if(!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const ts = Date.now(); const files = [USERS_FILE, PRODUCTS_FILE, CATEGORIES_FILE, PENDING_FILE];
    const copied = [];
    for(const f of files){ try{ const dest = path.join(backupDir, path.basename(f) + '.' + ts + '.bak'); fs.copyFileSync(f, dest); copied.push(dest); }catch(e){} }
    return res.json({ ok:true, copies: copied });
  }catch(e){ console.error('[AdminDB] backup-json error', e); return res.status(500).json({ error:'error' }); }
});

// ------------------------------------------------------------


// serve admin.html explicitly
app.get('/admin', (req,res)=>{
  if(frontendExists) return res.sendFile(path.join(frontendDir, 'admin.html'));
  // redirect to external frontend admin page
  if(FRONTEND_BASE) return res.redirect(FRONTEND_BASE + '/admin.html');
  res.status(404).send('Admin UI not deployed on this instance');
});

// fallback for client-side routes
app.get('*', (req,res,next)=>{
  const url = req.originalUrl || req.url;
  if(url.startsWith('/api')||url.startsWith('/uploads')) return next();
  if(frontendExists) return res.sendFile(path.join(frontendDir, 'index.html'));
  // redirect to external frontend preserving path
  if(FRONTEND_BASE) return res.redirect(FRONTEND_BASE + url);
  res.status(404).send('Frontend not found on server');
});

// Endpoint to receive image-related debug reports from the frontend
app.post('/api/log-image-error', (req, res) => {
  try{
    const body = req.body || {};
    console.warn('[ImageDebug] report:', JSON.stringify(body));
    // store a simple log file for later inspection
    try{
      const logDir = path.join(__dirname, 'logs');
      if(!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logFile = path.join(logDir, 'image-errors.log');
      fs.appendFileSync(logFile, JSON.stringify({ time: new Date().toISOString(), report: body }) + '\n');
    }catch(writeErr){ console.warn('[ImageDebug] failed to write log file:', writeErr.message); }
    return res.json({ ok: true });
  }catch(e){
    console.error('[ImageDebug] Error handling report:', e.message);
    return res.status(500).json({ error: 'error' });
  }
});

// Safety: temporary endpoint to absorb accidental /po requests and avoid 404 noise
app.get('/po', (req, res) => {
  console.warn('[Safety] /po requested, responding 204 to reduce noise');
  res.status(204).send();
});

// Diagnostic endpoint (enabled only when DEBUG_REGISTER=true)
// Use this to validate filesystem and pending writeability on the host (eg. Render)
app.get('/admin/diag', (req, res) => {
  if(process.env.DEBUG_REGISTER !== 'true') return res.status(404).send('Not found');
  try{
    const result = { ok: true, time: new Date().toISOString(), env: { DEBUG_REGISTER: !!process.env.DEBUG_REGISTER, DEBUG_SHOW_CODE: !!process.env.DEBUG_SHOW_CODE, PENDING_FILE, dataDir } };

    // Test data dir write
    try{
      const tmp = path.join(dataDir, `diag.${Date.now()}.tmp`);
      fs.writeFileSync(tmp, String(Date.now()));
      const content = fs.readFileSync(tmp, 'utf8');
      fs.unlinkSync(tmp);
      result.fsWrite = 'ok';
    }catch(e){ result.fsWrite = { error: e && e.message ? e.message : String(e) }; }

    // Test pending read/write
    try{
      const pend = readPending();
      const key = `diag-${Date.now()}`;
      pend[key] = { name: 'diag', email: key, passwordHash: '', code: '000000', createdAt: Date.now() };
      const saved = writePending(pend);
      result.pendingWrite = saved ? 'on-disk' : 'in-memory';
      // cleanup
      delete pend[key]; writePending(pend);
    }catch(e){ result.pendingWrite = { error: e && e.message ? e.message : String(e) }; }

    // Test writing a JSON file
    try{
      const testFile = path.join(dataDir, `diag.${Date.now()}.json`);
      fs.writeFileSync(testFile, JSON.stringify({ t: Date.now() }));
      const stats = fs.statSync(testFile);
      fs.unlinkSync(testFile);
      result.testJson = { size: stats.size };
    }catch(e){ result.testJson = { error: e && e.message ? e.message : String(e) }; }

    console.log('[Diag] result:', result);
    return res.json(result);
  }catch(err){
    console.error('[Diag] Error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Catch-all route to log unhandled requests
app.use((req, res, next) => {
  console.warn(`Unhandled request: ${req.method} ${req.url}`);
  res.status(404).send('Not Found');
});

app.listen(PORT, ()=> console.log(`ismartshop backend listening on http://localhost:${PORT}`));
