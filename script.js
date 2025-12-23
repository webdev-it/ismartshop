// script.js — inject products and handle carousel
// Loader: keep initial animated logo visible for at least 3 seconds
const INITIAL_LOADER_MS = 3000;
function hideLoaderNow(){
  try{
    document.body.classList.remove('loading');
    const loader = document.getElementById('loader');
    if(loader){
      loader.classList.add('loader-hide');
      // remove from DOM after hide transition
      setTimeout(()=>{ loader.remove(); }, 420);
    }
  }catch(e){/* ignore */}
}
// start timer immediately so the loader always lasts ~3s
setTimeout(hideLoaderNow, INITIAL_LOADER_MS);

// No client-side sample products — products are fetched from the server.
// sampleProducts больше не используются — только серверные товары
const sampleProducts = [];

// --- Theme handling (dark / light) ---
const THEME_KEY = 'ismart_theme_v1';
function applyTheme(theme){
  document.documentElement.classList.remove('theme-light','theme-dark');
  document.documentElement.classList.add('theme-' + (theme === 'dark' ? 'dark' : 'light'));
  try{ localStorage.setItem(THEME_KEY, theme); }catch(e){}
  const btn = document.getElementById('theme-toggle');
  if(btn){ btn.setAttribute('aria-pressed', String(theme === 'dark')); btn.title = theme === 'dark' ? 'Тёмная тема' : 'Светлая тема'; }
  // swap header logo depending on theme: show darklogo in light theme for contrast
  try{
    const brandImg = document.querySelector('#brand img');
    if(brandImg){
      if(theme === 'light') brandImg.src = 'assets/images/darklogo.png';
      else brandImg.src = 'assets/images/logo.png';
    }
  }catch(e){/* ignore if DOM not ready */}
}

function setupThemeOnLoad(){
  try{
    const saved = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    applyTheme(theme);
  }catch(e){ applyTheme('dark'); }

  const btn = document.getElementById('theme-toggle');
  if(btn){
    btn.addEventListener('click', ()=>{
      const cur = document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light';
      const next = cur === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
  }
}

// categories come from the server; include an 'all' entry client-side when rendering if needed
const sampleCategories = [];

let selectedCategory = 'all';

// API base (set `window.ISMART_API_BASE` to full backend URL if needed)
const API_BASE = window.ISMART_API_BASE || '';

// helper for fetch that includes cookies for auth
async function apiFetch(path, opts = {}){
  const url = (path.startsWith('http') || path.startsWith('/')) ? API_BASE + path : API_BASE + '/' + path;
  const init = { credentials: 'include', headers: {}, ...opts };
  // ensure content-type when body is an object
  if(init.body && typeof init.body === 'object' && !(init.body instanceof FormData)){
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }
  return fetch(url, init);
}
async function fetchProducts(){
  try{
    const res = await apiFetch('/api/products');
    if(!res.ok) throw new Error('no api');
    return await res.json();
  }catch(e){
    return [];
  }
}

async function fetchCategories(){
  try{
    const res = await apiFetch('/api/categories');
    if(!res.ok) throw new Error('no api');
    return await res.json();
  }catch(e){
    // return empty categories if API unavailable
    return sampleCategories;
  }
}

// --- Chat / threads storage (localStorage) ---
const THREAD_KEY = 'ismart_threads_v1';
function loadThreads(){
  try{ return JSON.parse(localStorage.getItem(THREAD_KEY) || '{}'); }catch(e){return {}}
}
function saveThreads(t){ localStorage.setItem(THREAD_KEY, JSON.stringify(t)); }
function getThread(productId){ const t = loadThreads(); return t[productId] || []; }
function appendMessage(productId, msg){ const t = loadThreads(); t[productId] = t[productId] || []; t[productId].push(msg); saveThreads(t); }

// Map of productId -> threadId persisted inside threads JSON as meta: threads[productId].__threadId
function saveThreadIdForProduct(productId, threadId){ const t = loadThreads(); t[productId] = t[productId] || []; t[productId].__threadId = threadId; saveThreads(t); }
function getThreadIdForProduct(productId){ const t = loadThreads(); return (t[productId] && t[productId].__threadId) || null; }

// UI helpers for SPA tabs
function showView(id){
  document.querySelectorAll('[data-view]').forEach(v=> v.style.display = 'none');
  const el = document.getElementById(id);
  if(el) el.style.display = '';
  // update active tab button
  document.querySelectorAll('.tab').forEach(b=> b.classList.remove('active'));
  const btn = document.querySelector(`.tab[data-tab="${id}"]`);
  if(btn) btn.classList.add('active');
  // hide search on non-home views
  const searchRow = document.querySelector('.search-row');
  if(searchRow) searchRow.style.display = (id === 'view-home' ? '' : 'none');
}

// render chat list from products
function renderChatList(products){
  const el = document.getElementById('chat-list');
  el.innerHTML = '';
  const threads = loadThreads();
  const ids = Object.keys(threads).reverse();
  if(ids.length === 0){ el.innerHTML = '<p style="padding:16px;color:#666">У вас ещё нет чатов. Нажмите «Купить» на карточке, чтобы начать чат с админом.</p>'; return; }
  ids.forEach(pid=>{
    const p = productsCache.find(x=>x.id === pid) || {id:pid,title:'Товар',price:'',image:''};
    const item = document.createElement('div');
    item.className = 'chat-item';
    item.innerHTML = `
      <div class="price">${p.price || ''}</div>
      <div class="name">${p.title}</div>
    `;
    item.addEventListener('click', ()=> openChat(p.id));
    el.appendChild(item);
  });
}

let productsCache = [];
let categoriesCache = [];
let currentChatId = null;
let currentProductId = null;

// Open chat view for productId
function openChat(productId, prefillMessage){
  showView('view-chats');
  currentChatId = productId;
  // show chat-view area
  document.getElementById('chat-view').style.display = '';
  // find product
  const p = productsCache.find(x=>x.id === productId) || {title:'Продукт'};
  document.getElementById('chat-title').textContent = p.title;
  const messagesEl = document.getElementById('messages');
  messagesEl.innerHTML = '';
  const thread = getThread(productId);
  thread.forEach(msg =>{
    const d = document.createElement('div'); d.className = 'msg ' + (msg.from === 'user' ? 'user' : 'admin'); d.textContent = msg.text; messagesEl.appendChild(d);
  });
  // scroll to bottom
  setTimeout(()=> messagesEl.scrollTop = messagesEl.scrollHeight, 50);
  // prefill composer
  const input = document.getElementById('message-input');
  input.value = prefillMessage || `Здравствуйте! Я бы хотел купить ${p.title} .`;
  input.focus();
  // mark app as chat-open so everything else is hidden via CSS
  document.querySelector('.app')?.classList.add('chat-open');
  // bind send
  const sendBtn = document.getElementById('send-message');
  sendBtn.onclick = async ()=>{
    const text = input.value.trim(); if(!text) return;
    const user = loadUser();
    const msg = {from:'user', text, at: Date.now()};
    // Append locally immediately for snappy UI
    appendMessage(productId, msg);
    const d = document.createElement('div'); d.className = 'msg user'; d.textContent = text; messagesEl.appendChild(d);
    input.value = '';
    messagesEl.scrollTop = messagesEl.scrollHeight;
    const lastEl = document.getElementById(`last-${productId}`); if(lastEl) lastEl.textContent = text.slice(0,60);

    // Send to server when authenticated (best-effort)
    (async ()=>{
      try{
        const me = await checkCurrentUser();
        if(!me) return; // not logged in — keep local only
        // If no thread exists on server for this product, create it
        let threadId = getThreadIdForProduct(productId);
        if(!threadId){
          // create thread
          const resp = await apiFetch('/api/threads', { method: 'POST', body: { productId, text, userId: me.id, userName: me.name || 'Пользователь' } });
          if(resp && resp.ok){ const j = await resp.json().catch(()=>null); if(j && j.threadId){ threadId = j.threadId; saveThreadIdForProduct(productId, threadId); } }
        } else {
          // post message to existing thread
          await apiFetch(`/api/threads/${threadId}/messages`, { method: 'POST', body: { text } });
        }
      }catch(e){ console.log('Server message send failed (local cache still works):', e && e.message); }
    })();
  };
}

// chat delete from header
document.getElementById('chat-delete').addEventListener('click', ()=>{
  if(!currentChatId) return;
  if(confirm('Удалить этот чат?')){ deleteThread(currentChatId); renderChatList(productsCache); document.getElementById('chat-view').style.display = 'none'; }
});
// ensure chat-open class removed when chat deleted
document.getElementById('chat-delete')?.addEventListener('click', ()=>{ document.querySelector('.app')?.classList.remove('chat-open'); });

function deleteThread(productId){ const t = loadThreads(); if(t[productId]){ delete t[productId]; saveThreads(t); } }

// Product detail view
function showProduct(productId){
  showView('view-product');
  currentProductId = productId;
  const p = productsCache.find(x=>x.id === productId) || {title:'Товар', image:''};
  const img = document.getElementById('product-img'); if(img) img.src = p.image || '';
  const priceEl = document.getElementById('product-price'); if(priceEl) priceEl.textContent = p.price || '';
  const titleEl = document.getElementById('product-title'); if(titleEl) titleEl.textContent = p.title || '';
  const descEl = document.getElementById('product-desc'); if(descEl) descEl.textContent = p.description || '';
  const colorsEl = document.getElementById('product-colors'); if(colorsEl){ colorsEl.innerHTML = ''; if(p.colors && p.colors.length) colorsEl.textContent = 'Доступные цвета: ' + p.colors.join(', '); }
  // favorite pill state
  const pfav = document.getElementById('product-fav'); if(pfav){ pfav.dataset.id = productId; const favs = loadFavs(); if(favs.includes(productId)) pfav.classList.add('active'); else pfav.classList.remove('active'); }

  // ensure product-fav button contains an icon (heart) for consistency with cards
  if(pfav && !pfav.querySelector('svg')){
    pfav.innerHTML = `
      <svg viewBox="0 0 24 24" class="icon"><path d="M12 21s-7-4.6-9-7.2C1 10.2 3.2 6 7 6c2 0 3.5 1.3 5 3 1.5-1.7 3-3 5-3 3.8 0 6 4.2 4 7.8-2 2.6-9 7.2-9 7.2z"/></svg>
      В избранные
    `;
  }
  // buy button binds to open chat with prefilled message
  const pbuy = document.getElementById('product-buy'); if(pbuy){ pbuy.onclick = ()=> openChat(productId, `Здравствуйте! Я бы хотел купить ${p.title} .`); }
}

// bind product detail controls (close, fav)
document.getElementById('product-close')?.addEventListener('click', ()=>{ showView('view-home'); });
document.getElementById('product-fav')?.addEventListener('click', (e)=>{
  e.stopPropagation();
  const id = e.currentTarget.dataset.id; if(!id) return;
  // toggle and sync with server when possible
  toggleFavAndSync(id);
  const favs = loadFavs();
  // update product view button state
  if(favs.includes(id)) e.currentTarget.classList.add('active'); else e.currentTarget.classList.remove('active');
  // update any star overlays for this product in product lists
  document.querySelectorAll(`.fav-btn[data-id="${id}"]`).forEach(b=>{
    if(favs.includes(id)) { b.classList.add('active'); b.classList.add('pulse'); setTimeout(()=>b.classList.remove('pulse'),420); }
    else b.classList.remove('active');
  });
  // if currently viewing favorites, re-render
  const activeView = document.querySelector('.tab.active')?.dataset.tab;
  if(activeView === 'view-favorites') renderFavorites(productsCache);
});

// go back to chat list
document.addEventListener('click', (e)=>{
  if(e.target && e.target.id === 'chat-back'){
    document.getElementById('chat-view').style.display = 'none';
    document.querySelector('.app')?.classList.remove('chat-open');
  }
});

// attach tab buttons
function setupTabs(products){
  document.querySelectorAll('.tab').forEach(b=>{
    b.addEventListener('click', ()=>{
      const target = b.dataset.tab; if(target) showView(target);
      if(target === 'view-chats') renderChatList(products);
      if(target === 'view-favorites') renderFavorites(products);
    });
  });
}

// attach buy button handlers after rendering products
function attachBuyHandlers(){
  document.querySelectorAll('.buy').forEach(btn=>{
    btn.onclick = (ev)=>{
      ev.stopPropagation();
      const card = ev.target.closest('.card');
      if(!card) return;
      const id = card.dataset.id;
      if(id) openChat(id);
    };
  });
}

function attachCardHandlers(){
  document.querySelectorAll('.card').forEach(card=>{
    card.onclick = (ev)=>{
      // ignore clicks on buttons inside the card
      if(ev.target.closest('.buy') || ev.target.closest('.fav-btn')) return;
      const id = card.dataset.id;
      if(id) showProduct(id);
    };
  });
}

// Favorites storage and handlers
const FAV_KEY = 'ismart_favs_v1';
function loadFavs(){ try{ return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); }catch(e){return []} }
function saveFavs(arr){ localStorage.setItem(FAV_KEY, JSON.stringify(arr)); }
function toggleFav(id){ const f = loadFavs(); const idx = f.indexOf(id); if(idx>=0){ f.splice(idx,1);} else { f.push(id);} saveFavs(f); }

// Try to sync favorites with server when logged in (best-effort)
async function syncFavsFromServer(){
  try{
    const me = await checkCurrentUser();
    if(!me) return; // only sync for logged-in users
    const res = await apiFetch('/api/favorites');
    if(!res || !res.ok) return;
    const rows = await res.json();
    // rows may be array of {product_id} or legacy shapes; normalize
    const ids = rows.map(r => r.product_id || r.productId || r.productId || r.product_id || r.productId).filter(Boolean);
    if(ids && ids.length) saveFavs(ids);
  }catch(e){ /* ignore */ }
}

// Sync threads/messages for the logged-in user from server into local thread store
async function syncThreadsFromServer(){
  try{
    const me = await checkCurrentUser(); if(!me) return;
    const res = await apiFetch('/api/threads'); if(!res || !res.ok) return;
    const threads = await res.json();
    const local = loadThreads();
    for(const t of threads){
      try{
        const tid = t.id || t.threadId || t.id;
        const productId = t.productId || t.product_id || t.product_id || t.productId;
        if(!tid) continue;
        const msgsRes = await apiFetch(`/api/threads/${encodeURIComponent(tid)}/messages`);
        if(!msgsRes || !msgsRes.ok) continue;
        const msgs = await msgsRes.json();
        if(productId){
          // normalize message shape to {from,text,at,userId}
          local[productId] = msgs.map(m=>({ from: m.from_role || m.from || (m.fromRole||'user'), text: m.text || m.message || '', at: m.created_at || m.at || Date.now(), userId: m.user_id || m.userId || null }));
          local[productId].__threadId = tid;
        } else {
          // store under tid key when productId unknown
          local[tid] = msgs.map(m=>({ from: m.from_role || m.from || 'user', text: m.text || '', at: m.created_at || m.at || Date.now(), userId: m.user_id || null }));
          local[tid].__threadId = tid;
        }
      }catch(e){}
    }
    saveThreads(local);
  }catch(e){ /* ignore */ }
}

// Toggle favorite and attempt server update if authenticated
function toggleFavAndSync(id){
  const f = loadFavs(); const idx = f.indexOf(id);
  let adding = false;
  if(idx >= 0){ f.splice(idx,1); } else { f.push(id); adding = true; }
  saveFavs(f);
  (async ()=>{
    try{
      const me = await checkCurrentUser();
      if(!me) return; // no-op
      if(adding){ await apiFetch('/api/favorites', { method: 'POST', body: { productId: id } }); }
      else { await apiFetch(`/api/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
    }catch(e){ console.warn('Fav sync failed:', e && e.message); }
  })();
}

function attachFavoriteHandlers(){
  document.querySelectorAll('.fav-btn').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      const id = btn.dataset.id;
      toggleFavAndSync(id);
      const favs = loadFavs();
      if(favs.includes(id)) btn.classList.add('active'); else btn.classList.remove('active');
      // pulse feedback when added
      if(favs.includes(id)){
        btn.classList.add('pulse');
        setTimeout(()=> btn.classList.remove('pulse'), 420);
      }
      // if currently viewing favorites, re-render
      const activeView = document.querySelector('.tab.active')?.dataset.tab;
      if(activeView === 'view-favorites') renderFavorites(productsCache);
    };
    const favs = loadFavs(); if(favs.includes(btn.dataset.id)) btn.classList.add('active');
  });
}

// ============ AUTHENTICATION MODULE ============

const USER_KEY = 'ismart_user_v1';

function loadUser() { 
  try { 
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); 
  } catch(e) { 
    return null;
  } 
}

function saveUser(u) { 
  if(u) {
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  }
}

function clearUser() { 
  localStorage.removeItem(USER_KEY); 
}

function isLoggedIn() { 
  return !!loadUser(); 
}

// Show auth modal with proper error checking
function showAuthModal(mode) {
  const modal = document.getElementById('auth-modal');
  if (!modal) {
    console.warn('Auth modal element not found in DOM');
    return;
  }
  
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.add('open');
  
  const app = document.querySelector('.app');
  if (app) {
    app.classList.add('blurred');
  }
  
  // Switch tab
  switchAuthTab(mode || 'login');
}

// Hide auth modal
function hideAuthModal() { 
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('open');
  
  const app = document.querySelector('.app');
  if (app) {
    app.classList.remove('blurred');
  }
}

// Switch between login and register tabs
function switchAuthTab(mode) {
  // Clear all active states
  document.querySelectorAll('.auth-tab').forEach(el => {
    el.classList.remove('active');
  });
  document.querySelectorAll('.auth-form').forEach(el => {
    el.style.display = 'none';
  });
  
  if (mode === 'register') {
    const tab = document.getElementById('tab-register');
    const form = document.getElementById('form-register');
    if (tab) tab.classList.add('active');
    if (form) form.style.display = 'block';
  } else {
    const tab = document.getElementById('tab-login');
    const form = document.getElementById('form-login');
    if (tab) tab.classList.add('active');
    if (form) form.style.display = 'block';
  }
}

// Initialize auth tab buttons
function initAuthTabs() {
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  
  if (tabLogin) {
    tabLogin.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab('login');
    });
  }
  
  if (tabRegister) {
    tabRegister.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab('register');
    });
  }
}

// Show verification modal
function showVerifyModal(email) {
  const modal = document.getElementById('verify-modal');
  if (!modal) {
    console.warn('Verify modal element not found in DOM');
    return;
  }
  
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.add('open');
  
  const app = document.querySelector('.app');
  if (app) {
    app.classList.add('blurred');
  }
  
  // Pre-fill email
  const emailInput = document.getElementById('verify-email');
  if (emailInput) {
    emailInput.value = email || '';
    // focus the code input to make verification visible and convenient
    const codeInput = document.getElementById('verify-code');
    if(codeInput) setTimeout(()=> codeInput.focus(), 60);
  }
  // Ensure the verify form is visible (other code may have hidden all .auth-form elements)
  const verifyForm = document.getElementById('form-verify');
  if(verifyForm) verifyForm.style.display = 'block';
}

// Hide verification modal
function hideVerifyModal() {
  const modal = document.getElementById('verify-modal');
  if (!modal) return;
  
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('open');
  
  const app = document.querySelector('.app');
  if (app) {
    app.classList.remove('blurred');
  }
  
  // Clear inputs
  const emailInput = document.getElementById('verify-email');
  const codeInput = document.getElementById('verify-code');
  if (emailInput) emailInput.value = '';
  if (codeInput) codeInput.value = '';
}

// Handle registration
function initRegistration() {
  const submitBtn = document.getElementById('reg-submit');
  if (!submitBtn) return;
  console.log('initRegistration: submit button found');
  let inProgress = false;
  
  submitBtn.addEventListener('click', async (e) => {
    if(inProgress) return;
    inProgress = true;
    console.log('initRegistration: submit clicked');
    e.preventDefault();
    
    const nameInput = document.getElementById('reg-name');
    const emailInput = document.getElementById('reg-email');
    const passInput = document.getElementById('reg-password');
    const passConfirmInput = document.getElementById('reg-password-repeat');
    
    if (!nameInput || !emailInput || !passInput) {
      alert('Ошибка: элементы формы не найдены');
      return;
    }
    
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passInput.value;
    const passwordConfirm = (passConfirmInput && passConfirmInput.value) ? passConfirmInput.value : '';
    
    // Validation
    if (!name) {
      alert('Введите имя');
      nameInput.focus();
      return;
    }
    
    if (!email || !email.includes('@')) {
      alert('Введите корректный email');
      emailInput.focus();
      return;
    }
    
    if (!password || password.length < 6) {
      alert('Пароль должен быть не менее 6 символов');
      passInput.focus();
      return;
    }

    if(password !== passwordConfirm){
      alert('Пароли не совпадают');
      if(passConfirmInput) passConfirmInput.focus();
      return;
    }
    
    // Disable button
    submitBtn.disabled = true;
    submitBtn.textContent = 'Загрузка...';
    
    try {
      const res = await apiFetch('/auth/register', {
        method: 'POST',
        body: { name, email, password }
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        // Specific handling for 409 - offer to go to login
        if (res.status === 409) {
          const msg = (data && data.error) ? data.error : 'Email уже зарегистрирован';
          if (confirm(msg + '. Перейти к входу?')) showAuthModal('login');
        } else {
          alert('Ошибка: ' + (data.error || 'Неизвестная ошибка'));
        }
        submitBtn.disabled = false;
        submitBtn.textContent = 'Зарегистрироваться';
        return;
      }
      
      // Success
      hideAuthModal();
      nameInput.value = '';
      emailInput.value = '';
      passInput.value = '';
      if(passConfirmInput) passConfirmInput.value = '';
      // If server returned the code (debug mode), show it to the user so they can verify without email
      if (data && data.code) {
        alert('Код подтверждения (debug): ' + data.code);
        showVerifyModal(email);
      } else {
        // If response message indicates a resend, inform the user
        if (data && typeof data.message === 'string' && data.message.toLowerCase().includes('resent')) {
          alert('Код подтверждения отправлен повторно, проверьте почту.');
        }
        showVerifyModal(email);
      }
      
      submitBtn.disabled = false;
      submitBtn.textContent = 'Зарегистрироваться';
    } catch (err) {
      console.error('Registration error:', err);
      alert('Ошибка регистрации: ' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Зарегистрироваться';
      inProgress = false;
    }
  });
}

// Handle verification
function initVerification() {
  const submitBtn = document.getElementById('verify-submit');
  const resendBtn = document.getElementById('verify-resend');
  if (!submitBtn) return;
  console.log('initVerification: submit button found');
  
  submitBtn.addEventListener('click', async (e) => {
    console.log('initVerification: submit clicked');
    e.preventDefault();
    
    const emailInput = document.getElementById('verify-email');
    const codeInput = document.getElementById('verify-code');
    
    if (!emailInput || !codeInput) {
      alert('Ошибка: элементы формы не найдены');
      return;
    }
    
    const email = emailInput.value.trim();
    const code = codeInput.value.trim();
    
    if (!email || !code) {
      alert('Введите email и код');
      return;
    }
    
    submitBtn.disabled = true;
    submitBtn.textContent = 'Загрузка...';
    
    try {
      const res = await apiFetch('/auth/verify', {
        method: 'POST',
        body: { email, code }
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        alert('Ошибка: ' + (data.error || 'Неверный код'));
        submitBtn.disabled = false;
        submitBtn.textContent = 'Подтвердить';
        return;
      }
      
      // Success
      hideVerifyModal();
      alert('Аккаунт подтверждён!');
      showAuthModal('login');
      
      submitBtn.disabled = false;
      submitBtn.textContent = 'Подтвердить';
    } catch (err) {
      console.error('Verification error:', err);
      alert('Ошибка подтверждения: ' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Подтвердить';
    }
  });

  if(resendBtn){
    resendBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('verify-email');
      if(!emailInput) return alert('Email not found in form');
      const email = emailInput.value.trim();
      if(!email) return alert('Введите email');
      try{
        const res = await apiFetch('/auth/resend', { method: 'POST', body: { email } });
        const data = await res.json();
        if(!res.ok) return alert('Ошибка: ' + (data.error || 'Не удалось отправить код'));
        if(data.code) alert('Код подтверждения (debug): ' + data.code);
        alert('Код подтверждения отправлен повторно');
      }catch(err){ console.error('Resend error', err); alert('Ошибка при отправке кода'); }
    });
}
}

// Handle login
function initLogin() {
  const submitBtn = document.getElementById('login-submit');
  if (!submitBtn) return;
  console.log('initLogin: submit button found');
  let inProgress = false;
  
  submitBtn.addEventListener('click', async (e) => {
    if(inProgress) return; inProgress = true;
    console.log('initLogin: submit clicked');
    e.preventDefault();
    
    const emailInput = document.getElementById('login-email');
    const passInput = document.getElementById('login-password');
    
    if (!emailInput || !passInput) {
      alert('Ошибка: элементы формы не найдены');
      return;
    }
    
    const email = emailInput.value.trim();
    const password = passInput.value;
    
    if (!email || !password) {
      alert('Введите email и пароль');
      return;
    }
    
    submitBtn.disabled = true;
    submitBtn.textContent = 'Загрузка...';
    
    try {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        body: { email, password }
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        alert('Ошибка: ' + (data.error || 'Неверные учетные данные'));
        submitBtn.disabled = false;
        submitBtn.textContent = 'Войти';
        return;
      }
      
      // Fetch user data
      try {
        const userRes = await apiFetch('/auth/me');
        if (userRes.ok) {
          const user = await userRes.json();
          if (user) saveUser(user);
        }
      } catch (e) {
        console.warn('Could not fetch user profile');
      }

      // Ensure a minimal local marker so reload won't show auth modal if /auth/me wasn't available
      try { saveUser({ email }); } catch(e) { /* ignore */ }
      
      // Success
      hideAuthModal();
      emailInput.value = '';
      passInput.value = '';
      alert('Добро пожаловать!');
      
      submitBtn.disabled = false;
      submitBtn.textContent = 'Войти';
      
      // Do not reload page — update client state in-place so auth modal stays closed
      // (reloading can re-trigger auth checks that depend on cookies/localStorage timing)
      try{ window.ISMART_LOGGED_IN = true; }catch(e){}
      // Optionally refresh parts of the UI that depend on auth (best-effort)
      try{ const currentUser = await checkCurrentUser(); if(currentUser) { console.log('User after login:', currentUser.email); try{ await syncFavsFromServer(); renderFavorites(productsCache); }catch(e){} try{ await syncThreadsFromServer(); renderChatList(productsCache); }catch(e){} } }catch(e){}
    } catch (err) {
      console.error('Login error:', err);
      alert('Ошибка входа: ' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Войти';
      inProgress = false;
    }
  });
}

// header menu removed — burger button was intentionally removed from HTML


function renderFavorites(products){
  const el = document.getElementById('favorites');
  el.innerHTML = '';
  const favs = loadFavs();
  if(favs.length === 0){ el.innerHTML = '<p style="padding:16px;color:#666">У вас ещё нет избранных товаров.</p>'; return; }
  const list = products.filter(p=> favs.includes(p.id));
  list.forEach((p,i)=>{
    const wrap = document.createElement('div'); wrap.className = 'card-wrap';
    const card = document.createElement('article'); card.className = 'card';
    card.dataset.id = p.id;
    card.innerHTML = `
      <div class="card-surface">
        <div class="image"><img src="${p.image}" alt="${p.title}"/></div>
        <div class="footer">
          <div class="price">${p.price}</div>
          <div class="title">${p.title}</div>
          <button class="buy">Купить</button>
        </div>
      </div>
    `;
    // favorite button (heart icon)
    const favBtn = document.createElement('button'); favBtn.className = 'fav-btn active'; favBtn.dataset.id = p.id; favBtn.innerHTML = `
      <svg viewBox="0 0 24 24" class="icon"><path d="M12 21s-7-4.6-9-7.2C1 10.2 3.2 6 7 6c2 0 3.5 1.3 5 3 1.5-1.7 3-3 5-3 3.8 0 6 4.2 4 7.8-2 2.6-9 7.2-9 7.2z"/></svg>
    `; card.querySelector('.image').appendChild(favBtn);
    wrap.appendChild(card); el.appendChild(wrap);
    // staggered entrance
    setTimeout(()=> wrap.classList.add('entered'), 40 * i);
  });
  attachBuyHandlers(); attachFavoriteHandlers();
  attachCardHandlers();
}

function renderProducts(products){
  const el = document.getElementById('products');
  el.innerHTML = '';
  // filter by selected category
  const filtered = products.filter(p => selectedCategory === 'all' ? true : p.category === selectedCategory);
  filtered.forEach((p,i) => {
    const wrap = document.createElement('div');
    wrap.className = 'card-wrap';
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = p.id;
    card.innerHTML = `
      <div class="card-surface">
        <div class="image"></div>
        <div class="footer">
          <div class="price">${p.price}</div>
          <div class="title">${p.title}</div>
          <button class="buy">Купить</button>
        </div>
      </div>
    `;
    // create image element safely (avoid direct innerHTML src insertion)
    const imgWrap = card.querySelector('.image');
    const imgEl = document.createElement('img');
    imgEl.alt = p.title || '';
    // sanitize image src on client-side as an extra layer
    const src = (p.image || '').trim();
    if(!src || src === 'po' || src === '/po' || src.endsWith('/po')){
      imgEl.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
      imgEl.dataset.blocked = src;
    } else {
      imgEl.src = src;
    }
    imgWrap.appendChild(imgEl);
    // add favorite button overlay
    const favBtn = document.createElement('button');
    favBtn.className = 'fav-btn';
    favBtn.title = 'Добавить в избранное';
    favBtn.dataset.id = p.id;
    favBtn.innerHTML = `
      <svg viewBox="0 0 24 24" class="icon"><path d="M12 21s-7-4.6-9-7.2C1 10.2 3.2 6 7 6c2 0 3.5 1.3 5 3 1.5-1.7 3-3 5-3 3.8 0 6 4.2 4 7.8-2 2.6-9 7.2-9 7.2z"/></svg>
    `;
    card.querySelector('.image').appendChild(favBtn);
    wrap.appendChild(card);
    el.appendChild(wrap);
    // staggered entrance
    setTimeout(()=> wrap.classList.add('entered'), 30 * i);
  });
  // attach handlers after render
  attachBuyHandlers();
  attachFavoriteHandlers();
  attachCardHandlers();
}
function renderCategories(categories){
  const el = document.getElementById('categories');
  el.innerHTML = '';
  categories.forEach(c =>{
    const b = document.createElement('button');
    b.className = 'pill' + (c.id===selectedCategory? ' active':'');
    b.textContent = c.name;
    b.dataset.id = c.id;
    b.addEventListener('click', async ()=>{
      selectedCategory = c.id;
      // toggle active class
      document.querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));
      b.classList.add('active');
      // re-render products (ideally re-fetch from server)
      const products = await fetchProducts();
      renderProducts(products);
    });
    el.appendChild(b);
  });
}

// Carousel controls
function setupCarousel(){
  const carousel = document.getElementById('carousel');
  const slides = carousel.querySelectorAll('.slide');
  const dotsEl = document.getElementById('dots');
  let index = 0;

  function updateDots(){
    dotsEl.innerHTML = '';
    slides.forEach((s,i)=>{
      const d = document.createElement('div');
      d.className = 'dot' + (i===index? ' active':'');
      dotsEl.appendChild(d);
    });
  }

  function scrollTo(i){
    index = (i + slides.length) % slides.length;
    carousel.scrollTo({left: carousel.clientWidth * index, behavior:'smooth'});
    updateDots();
  }

  document.getElementById('prev').addEventListener('click', ()=> scrollTo(index-1));
  document.getElementById('next').addEventListener('click', ()=> scrollTo(index+1));

  // swipe / scroll listener to update dots
  carousel.addEventListener('scroll', ()=>{
    const i = Math.round(carousel.scrollLeft / carousel.clientWidth);
    if(i!==index){ index = i; updateDots(); }
  });

  updateDots();
}

// Check current user session on load
async function checkCurrentUser(){
  try {
    const res = await apiFetch('/auth/me');
    if (res.ok) {
      const user = await res.json();
      if (user) saveUser(user);
      return user;
    }
    // If server doesn't report a session, fall back to any saved client state
    const local = loadUser();
    if (local) return local;
    return null;
  } catch (e) {
    // Network or other error — use local storage as fallback so UI doesn't force-login users
    console.log('Session check (network error):', e.message);
    try { return loadUser(); } catch(err){ return null; }
  }
}

// Prevent unhandled form submissions
document.addEventListener('submit', (e) => {
  e.preventDefault();
  console.warn('Unhandled form submission prevented:', e.target);
});

// Instrumentation: detect image load errors and suspicious image src values (like '/po')
(function(){
  function reportImageIssue(details){
    try{
      console.warn('Reporting image issue', details);
      // Best-effort: send details to backend for logging (no need for response)
      if(navigator && navigator.sendBeacon){
        const url = (window.ISMART_API_BASE || '') + '/api/log-image-error';
        const blob = new Blob([JSON.stringify(details)], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
      } else {
        fetch((window.ISMART_API_BASE || '') + '/api/log-image-error', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(details)
        }).catch(()=>{});
      }
    }catch(e){/* ignore */}
  }

  // Catch image load errors
  window.addEventListener('error', (e) => {
    const t = e.target || e.srcElement;
    if(t && t.tagName === 'IMG'){
      const details = { type: 'img-error', src: t.currentSrc || t.src || null, outerHTML: t.outerHTML, page: location.href, time: Date.now() };
      console.warn('Image load error detected:', details);
      reportImageIssue(details);
    }
  }, true);

  // Watch for images added dynamically or changed
  const observer = new MutationObserver((records) => {
    for(const rec of records){
      for(const node of rec.addedNodes || []){
        if(node && node.tagName === 'IMG'){
          const src = node.getAttribute('src') || node.getAttribute('data-src') || '';
          if(src === '/po' || src === 'po' || src.endsWith('/po')){
            const details = { type: 'img-src-suspicious', src, outerHTML: node.outerHTML, page: location.href, time: Date.now() };
            console.warn('Suspicious image src detected:', details);
            reportImageIssue(details);
          }
        }
      }
      // attribute changes
      if(rec.type === 'attributes' && rec.target && rec.target.tagName === 'IMG'){
        const src = rec.target.getAttribute('src') || '';
        if(src === '/po' || src === 'po' || src.endsWith('/po')){
          const details = { type: 'img-src-suspicious', src, outerHTML: rec.target.outerHTML, page: location.href, time: Date.now() };
          console.warn('Suspicious image src changed:', details);
          reportImageIssue(details);
        }
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  // Initial scan for any existing imgs with suspicious src
  document.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || img.getAttribute('data-src') || img.src || '';
    if(src === '/po' || src === 'po' || (src && src.endsWith('/po'))){
      const details = { type: 'img-src-suspicious', src, outerHTML: img.outerHTML, page: location.href, time: Date.now() };
      console.warn('Suspicious image src found at init:', details);
      reportImageIssue(details);
    }
  });
})();

// Init (run after DOM is ready)
function onReady(fn){
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
}

onReady(async function(){
  // initialize theme early to avoid flash
  setupThemeOnLoad();
  
  // sanitize images to avoid requests to unexpected paths like '/po'
  (function sanitizeImages(){
    const placeholder = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    document.querySelectorAll('img').forEach(img=>{
      try{
        const src = (img.getAttribute('src') || '').trim();
        if(!src || src === 'po' || src === '/po' || src.endsWith('/po')){
          console.warn('Sanitizing image src', src, img);
          img.dataset.origSrc = src;
          img.src = placeholder;
          // report to backend for debugging
          try{ if(navigator && navigator.sendBeacon){ navigator.sendBeacon((window.ISMART_API_BASE||'') + '/api/log-image-error', new Blob([JSON.stringify({ type:'sanitized', src, outerHTML: img.outerHTML, page: location.href, time: Date.now() })], { type: 'application/json' })); } }catch(e){}
        }
      }catch(e){/* ignore */}
    });
  })();

  // Initialize auth handlers
  initAuthTabs();
  initRegistration();
  initLogin();
  initVerification();
  console.log('Auth handlers initialized');
  
  // check if user is already logged in
  const currentUser = await checkCurrentUser();
  if(!currentUser) {
    // Если пользователь не залогинен — сразу показать окно регистрации
    showAuthModal('register');
  } else {
    console.log('User already logged in:', currentUser.email);
    // sync server-side favorites and threads into local cache so UI reflects account data
    try{ await syncFavsFromServer(); }catch(e){}
    try{ await syncThreadsFromServer(); }catch(e){}
  }

  const [products, categories] = await Promise.all([fetchProducts(), fetchCategories()]);
  productsCache = products;
  categoriesCache = categories;
  renderCategories(categories);
  renderProducts(products);
  setupCarousel();
  setupTabs(products);
  renderChatList(products);
  attachBuyHandlers();
});
