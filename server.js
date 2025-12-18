const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { Client } = require('pg');
const fs = require('fs');
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
// configure CORS to allow frontend origin and credentials
// default to the production frontend if env not set
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://ismartshop.org';
const corsOptions = { origin: FRONTEND_URL, credentials: true, optionsSuccessStatus: 200 };
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());

// cookie options used when issuing auth cookies.
// Use SameSite=None to allow cross-site cookies (frontend on different origin).
// Ensure Secure is true when frontend/backend are served over HTTPS (Render/GitHub Pages).
// Use the resolved FRONTEND_URL constant (may be default) rather than process.env directly.
const runningOnHttps = ((process.env.BACKEND_URL || '').startsWith('https')) || (FRONTEND_URL.startsWith('https')) || (process.env.NODE_ENV === 'production');
const cookieOptions = { httpOnly: true, sameSite: 'none', secure: runningOnHttps };

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

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');
const CATEGORIES_FILE = path.join(__dirname, 'data', 'categories.json');
const THREADS_FILE = path.join(__dirname, 'data', 'threads.json');

// ensure data dir exists
const dataDir = path.join(__dirname, 'data'); if(!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Postgres client (optional). If DATABASE_URL set, connect and use DB for main operations.
let db = null;
if(process.env.DATABASE_URL){
  db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  db.connect().then(()=> console.log('Connected to Postgres')).catch(e=> console.error('Postgres connect error', e.message));
}

async function queryDb(text, params){ if(!db) throw new Error('db not configured'); const r = await db.query(text, params); return r; }

// setup nodemailer transporter (if SMTP configured)
let transporter = null;
if(process.env.SMTP_HOST){
  transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT||587), secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
}

app.get('/api/health', (req,res)=> res.json({ ok:true, time:Date.now() }));

// ---------------- AUTH: register / verify / login ----------------
app.post('/auth/register', async (req,res)=>{
  const { email, password, name, surname } = req.body;
  if(!email || !password) return res.status(400).json({ error:'email and password required' });
  const users = readJSON(USERS_FILE, []);
  if(users.find(x=>x.email === email)) return res.status(409).json({ error:'email exists' });
  const hash = await bcrypt.hash(password, 10);
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const user = { id: uuidv4(), email, passwordHash: hash, name: name||'', surname: surname||'', verified:false, verificationCode: code, role: 'user', createdAt: new Date().toISOString() };
  users.push(user); writeJSON(USERS_FILE, users);
  // send verification email
  if(transporter){
    const mail = { from: process.env.FROM_EMAIL || process.env.SMTP_USER, to: email, subject: 'Код подтверждения аккаунта', text: `Ваш код подтверждения: ${code}`, html: `<p>Ваш код подтверждения: <b>${code}</b></p> <br> Настоятельно рекомендуем не передавать его третьим лицам.` };
    await transporter.sendMail(mail);
  }
  res.status(201).json({ message:'registered. verify email' });
});

// POST /auth/verify — подтверждение кода
app.post('/auth/verify', async (req,res)=>{
  const { email, code } = req.body || {};
  if(!email || !code) return res.status(400).json({ error:'missing email or code' });
  const users = readJSON(USERS_FILE, []);
  const u = users.find(x=>x.email === email && x.verificationCode === code && !x.verified);
  if(!u) return res.status(400).json({ error:'invalid code or email' });
  u.verified = true; delete u.verificationCode; writeJSON(USERS_FILE, users);
  res.json({ message:'verified' });
});
app.get('/auth/verify', (req,res)=>{
  const token = req.query.token; if(!token) return res.status(400).send('token required');
  const users = readJSON(USERS_FILE, []);
  const u = users.find(x=>x.verificationToken === token);
  if(!u) return res.status(404).send('token invalid');
  u.verified = true; delete u.verificationToken; writeJSON(USERS_FILE, users);
  // redirect to frontend confirmation page if FRONTEND_URL set
  const redirect = (process.env.FRONTEND_URL || '') + '/?verified=1';
  if(redirect) return res.redirect(redirect);
  res.send('verified');
});

// helpful index for auth endpoints (so visiting /auth in browser shows something)
app.get('/auth', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json({
    message: 'iSmartShop auth endpoints',
    endpoints: {
      register: 'POST /auth/register { email, password, name? }',
      verify: 'GET /auth/verify?token=TOKEN',
      login: 'POST /auth/login { email, password }',
      logout: 'POST /auth/logout',
      me: 'GET /auth/me',
      adminLogin: 'POST /auth/admin-login { username, password }'
    },
    notes: 'Use credentials via POST; admin-login requires ADMIN_USER/ADMIN_PASS env variables'
  });
});

app.post('/auth/login', async (req,res)=>{
  const { email, password } = req.body; if(!email||!password) return res.status(400).json({ error:'missing' });
  const users = readJSON(USERS_FILE, []);
  const u = users.find(x=>x.email === email);
  if(!u) return res.status(401).json({ error:'invalid' });
  const ok = await bcrypt.compare(password, u.passwordHash);
  if(!ok) return res.status(401).json({ error:'invalid' });
  if(!u.verified) return res.status(403).json({ error:'email not verified' });
  const token = jwt.sign({ id:u.id, role:u.role, email:u.email }, process.env.SESSION_SECRET || 'devsecret', { expiresIn:'7d' });
  // set cookie with options allowing cross-site usage from frontend domain
  res.cookie('token', token, cookieOptions);
  res.json({ message:'ok', token });
});

// Admin login using credentials from environment (ADMIN_USER / ADMIN_PASS)
app.post('/auth/admin-login', async (req,res)=>{
  // do not cache auth responses
  res.set('Cache-Control','no-store');
  const { username, password } = req.body || {};
  // log attempt (do not log passwords)
  const secret = process.env.SESSION_SECRET || 'devsecret';
  const secretMask = (typeof secret === 'string' && secret.length>6) ? (secret.slice(0,3) + '...' + secret.slice(-3)) : '(<short>)';
  console.log('admin-login attempt, username=', username, 'ADMIN_USER_set=', !!process.env.ADMIN_USER, 'SESSION_SECRET_mask=', secretMask);
  if(!process.env.ADMIN_USER || !process.env.ADMIN_PASS) {
    console.warn('admin-login requested but ADMIN_USER/ADMIN_PASS not configured');
    return res.status(501).json({ error: 'admin login not configured' });
  }
  if(!username || !password) return res.status(400).json({ error: 'missing' });
  const ok = username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS;
  if(!ok){
    console.warn('admin-login failed for username=', username);
    return res.status(401).json({ error: 'invalid' });
  }
  console.log('admin-login success for username=', username);
  const token = jwt.sign({ id: 'admin-'+(process.env.ADMIN_USER||'admin'), role: 'admin', email: null }, process.env.SESSION_SECRET || 'devsecret', { expiresIn:'7d' });
  res.cookie('token', token, cookieOptions);
  res.json({ message: 'ok' });
});

// debug: return decoded token payload (no verify) for troubleshooting only
app.get('/auth/debug-token', (req,res)=>{
  const token = (req.cookies && req.cookies.token) || null;
  if(!token) return res.status(404).json({ error:'no token' });
  try{
    const decoded = jwt.decode(token);
    return res.json({ decoded });
  }catch(e){
    return res.status(500).json({ error: 'decode error' });
  }
});

app.post('/auth/logout', (req,res)=>{
  // clear cookie with same options to ensure browser removes it
  res.clearCookie('token', cookieOptions);
  res.json({ message:'logged out' });
});

// Helper: try to extract user info from request (token in Authorization header or cookie). Returns decoded token payload or null.
function getUserFromReq(req){
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.cookies && req.cookies.token) || null;
  console.log('[getUserFromReq] cookies:', req.cookies);
  console.log('[getUserFromReq] headers:', req.headers);
  console.log('[getUserFromReq] token:', token);
  console.log('[getUserFromReq] SESSION_SECRET:', process.env.SESSION_SECRET);
  if(!token) {
    console.warn('[getUserFromReq] No token');
    return null;
  }
  try{
    const data = jwt.verify(token, process.env.SESSION_SECRET || 'devsecret');
    console.log('[getUserFromReq] decoded:', data);
    return data;
  }catch(e){
    console.warn('jwt verify failed:', e && e.message, 'token_mask=', (typeof token === 'string' ? token.slice(0,20)+'...' : typeof token));
    return null;
  }
}

// /auth/me: return user info if logged in, otherwise return null (200) to avoid noisy 401 on public pages.
app.get('/auth/me', async (req,res)=>{
  // do not cache auth responses
  res.set('Cache-Control','no-store');
  try{
    console.log('[auth/me] cookies:', req.cookies);
    console.log('[auth/me] headers:', req.headers);
    const decoded = getUserFromReq(req);
    console.log('/auth/me called, token present=', !!decoded, 'userId=', decoded? decoded.id : null);
    if(!decoded) {
      console.warn('[auth/me] decoded is null');
      return res.json(null);
    }
    // Если это админ-токен, возвращаем объект админа напрямую
    if(decoded.role === 'admin') {
      console.log('[auth/me] admin token detected, returning admin user');
      return res.json({ id: decoded.id, email: null, name: 'Admin', surname: '', role: 'admin', verified: true, createdAt: null });
    }
    // return minimal user info from DB or file storage
    if(db){
      const q = await queryDb('SELECT id,email,name,surname,role,verified,created_at FROM users WHERE id=$1', [decoded.id]);
      if(q.rows.length===0) return res.json(null);
      return res.json(q.rows[0]);
    }
    const users = readJSON(USERS_FILE, []);
    const u = users.find(x=>x.id === decoded.id);
    if(!u) return res.json(null);
    const { id, email, name, surname, role, verified, createdAt } = u;
    console.log('/auth/me returning user', id, 'role=', role);
    return res.json({ id, email, name, surname, role, verified, createdAt });
  }catch(e){ console.error('auth me err', e.message); return res.status(500).json({ error:'server error' }); }
});

function authMiddleware(req,res,next){
  const auth = req.headers.authorization || ''; const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.cookies && req.cookies.token) || null;
  if(!token) return res.status(401).json({ error:'unauth' });
  try{ const data = jwt.verify(token, process.env.SESSION_SECRET || 'devsecret'); req.user = data; next(); }catch(e){ return res.status(401).json({ error:'invalid token' }); }
}

function adminOnly(req,res,next){ if(!req.user) return res.status(401).json({ error:'unauth' }); if(req.user.role !== 'admin') return res.status(403).json({ error:'forbidden' }); next(); }

// ---------------- PRODUCTS ----------------
app.get('/api/products', (req,res)=>{
  (async ()=>{
    if(db){
      try{
        const q = await queryDb("SELECT id,title,price,image,category,description,colors,status,owner_id,created_at FROM products " + (req.query.all==='1' ? '' : "WHERE status='approved'"));
        const rows = q.rows.map(r=> ({ id: r.id, title: r.title, price: r.price, image: r.image, category: r.category, description: r.description, colors: r.colors || [], status: r.status, ownerId: r.owner_id, createdAt: r.created_at }));
        return res.json(rows);
      }catch(err){ console.error('db products err', err.message); }
    }
    const products = readJSON(PRODUCTS_FILE, []);
    const onlyApproved = req.query.all === '1' ? products : products.filter(p => p.status === 'approved');
    res.json(onlyApproved);
  })();
});

app.get('/api/products/:id', (req,res)=>{
  (async ()=>{
    if(db){
      try{
        const q = await queryDb('SELECT id,title,price,image,category,description,colors,status,owner_id,created_at FROM products WHERE id=$1', [req.params.id]);
        if(q.rows.length===0) return res.status(404).json({ error:'not found' });
        const r = q.rows[0]; return res.json({ id: r.id, title: r.title, price: r.price, image: r.image, category: r.category, description: r.description, colors: r.colors || [], status: r.status, ownerId: r.owner_id, createdAt: r.created_at });
      }catch(e){ console.error('db product err', e.message); }
    }
    const products = readJSON(PRODUCTS_FILE, []);
    const p = products.find(x=>x.id === req.params.id);
    if(!p) return res.status(404).json({ error:'not found' });
    res.json(p);
  })();
});

app.post('/api/products', authMiddleware, async (req,res)=>{
  const body = req.body; if(!body.title || !body.price) return res.status(400).json({ error:'missing' });
  if(db){
    try{
      const id = Date.now().toString();
      await queryDb('INSERT INTO products(id,title,price,image,category,description,colors,owner_id,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, body.title, body.price, body.image||'', body.category||'', body.description||'', JSON.stringify(body.colors||[]), req.user.id, 'approved', new Date().toISOString()]);
      const q = await queryDb('SELECT id,title,price,image,category,description,colors,status,owner_id,created_at FROM products WHERE id=$1', [id]);
      const r = q.rows[0];
      return res.status(201).json({ id: r.id, title: r.title, price: r.price, image: r.image, category: r.category, description: r.description, colors: r.colors || [], status: r.status, ownerId: r.owner_id, createdAt: r.created_at });
    }catch(e){ console.error('db insert product', e.message); return res.status(500).json({ error:'db error' }); }
  }
  const products = readJSON(PRODUCTS_FILE, []);
  const newP = { id: Date.now().toString(), title: body.title, price: body.price, image: body.image||'', category: body.category||'', description: body.description||'', colors: body.colors||[], ownerId: req.user.id, status:'approved', createdAt: new Date().toISOString() };
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
            vals.push(k==='colors' ? JSON.stringify(body[k]) : body[k]);
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

// ---------------- THREADS / CHAT ----------------
app.post('/api/threads', (req,res)=>{
  const { productId, userId, text, userName } = req.body;
  if(!productId || !text) return res.status(400).json({ error:'missing' });
  const threads = readJSON(THREADS_FILE, {});
  const id = Date.now().toString();
  threads[id] = [ { from:'user', text, at: new Date().toISOString(), userId: userId||null, userName: userName||'Пользователь' } ];
  // attach meta
  threads[id].title = `Товар ${productId}`;
  writeJSON(THREADS_FILE, threads);
  // notify admins via email (optional)
  if(transporter){
    const admins = readJSON(USERS_FILE,[]).filter(u=>u.role==='admin');
    admins.forEach(a=> transporter.sendMail({ from: process.env.FROM_EMAIL||process.env.SMTP_USER, to: a.email, subject: 'Новый чат', text: `Новый чат по товару ${productId}: ${text}` }).catch(()=>{}));
  }
  res.status(201).json({ threadId:id });
});

app.get('/api/admin/threads', authMiddleware, adminOnly, (req,res)=>{ const threads = readJSON(THREADS_FILE, {}); res.json(threads); });
app.get('/api/threads/:id/messages', (req,res)=>{ const threads = readJSON(THREADS_FILE, {}); res.json(threads[req.params.id] || []); });
app.post('/api/threads/:id/messages', authMiddleware, (req,res)=>{ const threads = readJSON(THREADS_FILE, {}); const id=req.params.id; if(!threads[id]) threads[id]=[]; threads[id].push({ from: req.user.role==='admin' ? 'admin' : 'user', text: req.body.text, at: new Date().toISOString(), userId: req.user.id }); writeJSON(THREADS_FILE, threads); res.json({ ok:true }); });

// ---------------- STATS ----------------
app.get('/api/admin/stats', authMiddleware, adminOnly, (req,res)=>{ const users = readJSON(USERS_FILE,[]); const products = readJSON(PRODUCTS_FILE,[]); const threads = readJSON(THREADS_FILE,{}); res.json({ users: users.length, products: products.length, threads: Object.keys(threads).length }); });

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

app.listen(PORT, ()=> console.log(`ismartshop backend listening on http://localhost:${PORT}`));
