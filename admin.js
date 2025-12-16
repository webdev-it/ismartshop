// admin.js — Admin panel UI + local fallback + API-sync helpers
(function(){
  const PRODUCTS_KEY = 'admin_products_v1';
  const CATS_KEY = 'admin_cats_v1';
  const THREAD_KEY = 'ismart_threads_v1'; // shared with frontend chat
  const USERS_KEY = 'ismart_users_v1';

  // API base and helper (credentials included)
  const API_BASE = window.ISMART_API_BASE || '';
  async function apiFetch(path, opts = {}){
    const url = (path.startsWith('http') || path.startsWith('/')) ? API_BASE + path : API_BASE + '/' + path;
    const init = { credentials: 'include', headers: {}, ...opts };
    if(init.body && typeof init.body === 'object' && !(init.body instanceof FormData)){
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(init.body);
    }
    return fetch(url, init);
  }

  // try API helper: returns JSON or null on failure
  async function tryApi(method, path, body){
    try{
      const res = await apiFetch(path, { method, body });
      if(!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if(ct.indexOf('application/json') !== -1) return await res.json();
      return true;
    }catch(e){ return null; }
  }

  // load products from API or localStorage fallback
  async function loadProducts(){
    const api = await tryApi('GET','/api/products');
    if(api) {
      localStorage.setItem(PRODUCTS_KEY, JSON.stringify(api));
      return api;
    }
    const s = localStorage.getItem(PRODUCTS_KEY);
    if(s) return JSON.parse(s);
    // no data available
    return [];
  }

  async function saveProductsLocally(products){
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
    // local saved; admin edits will try to save to API when possible (see form submit)
  }

  async function loadCategories(){
    const api = await tryApi('GET','/api/categories');
    if(api){ localStorage.setItem(CATS_KEY, JSON.stringify(api)); return api; }
    const s = localStorage.getItem(CATS_KEY); if(s) return JSON.parse(s);
    return [];
  }

  function saveCategoriesLocally(cats){ localStorage.setItem(CATS_KEY, JSON.stringify(cats)); }

  async function loadThreads(){
    const api = await tryApi('GET','/api/admin/threads');
    if(api) return api;
    try{ return JSON.parse(localStorage.getItem(THREAD_KEY) || '{}'); }catch(e){ return {}; }
  }
  function saveThreads(t){ localStorage.setItem(THREAD_KEY, JSON.stringify(t)); }

  async function loadUsers(){
    // prefer admin stats endpoint; but keep local fallback
    const stats = await tryApi('GET','/api/admin/stats');
    if(stats && typeof stats.users === 'number'){
      // return array-like placeholder using count
      return Array.from({length: stats.users}).map((_,i)=>({ id: i+1 }));
    }
    try{ return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); }catch(e){ return []; }
  }

  // UI helpers
  function $(sel){ return document.querySelector(sel); }
  function $all(sel){ return Array.from(document.querySelectorAll(sel)); }

  // Rendering
  async function renderDashboard(){
    const users = loadUsers();
    const products = await loadProducts();
    const threads = loadThreads();
    $('#stat-users').textContent = users.length;
    $('#stat-products').textContent = products.length;
    $('#stat-threads').textContent = Object.keys(threads).length;
  }

  // --- Auth helpers ---
  let currentUser = null;
  async function fetchMe(){
    const me = await tryApi('GET','/auth/me');
    currentUser = me;
    return me;
  }

  async function doLogin(email, pass){
    const res = await tryApi('POST','/auth/login', { email, password: pass });
    if(!res) return null;
    // after login, fetch profile
    return await fetchMe();
  }

  // admin login using ADMIN_USER/ADMIN_PASS via /auth/admin-login
  async function doAdminLogin(username, pass){
    const res = await tryApi('POST','/auth/admin-login', { username, password: pass });
    if(!res) return null;
    return await fetchMe();
  }

  async function doLogout(){
    await tryApi('POST','/auth/logout');
    currentUser = null;
    // reload UI
    $('#admin-status-text').textContent = 'offline';
    // show login modal
    showLoginModal(true);
  }

  function showLoginModal(show){
    const m = document.getElementById('admin-login-modal');
    if(!m) return;
    m.classList.toggle('hidden', !show);
  }

  async function initAfterAuth(){
    // default view after successful auth
    showView('dashboard');
    await renderDashboard();
    await renderProducts();
    await renderCategories();
    renderThreads();
    const h = await tryApi('GET','/api/health'); $('#admin-status-text').textContent = h? 'online' : 'offline';
  }

  async function renderProducts(){
    const list = $('#products-list'); list.innerHTML = '';
    const products = await loadProducts();
    products.forEach(p=>{
      const el = document.createElement('div'); el.className = 'admin-item';
      el.innerHTML = `<strong>${p.title}</strong><div>${p.price} — ${p.category}</div><div class="admin-item-actions"><button data-id="${p.id}" class="edit-product">Edit</button><button data-id="${p.id}" class="del-product">Delete</button></div>`;
      list.appendChild(el);
    });
    $all('.edit-product').forEach(b=> b.addEventListener('click', e=> openProductForm(e.target.dataset.id)));
    $all('.del-product').forEach(b=> b.addEventListener('click', async e=>{
      const id = e.target.dataset.id; if(!confirm('Удалить товар?')) return;
      const apiRes = await tryApi('DELETE', `/api/products/${id}`);
      const products = await loadProducts();
      const idx = products.findIndex(x=>x.id===id);
      if(apiRes){
        // refreshed during loadProducts if API available
      } else if(idx>=0){
        products.splice(idx,1); await saveProductsLocally(products);
      }
      renderProducts(); renderDashboard();
    }));
  }

  async function openProductForm(id){
    const wrap = $('#product-form-wrap'); wrap.innerHTML = '';
    const products = await loadProducts();
    const product = id ? products.find(x=>x.id===id) : { id: Date.now().toString(), title:'', price:'', image:'', category:'', description:'', colors:[] };
    const cats = await loadCategories();
    const form = document.createElement('form');
    form.innerHTML = `
      <label>Название<br><input name="title" value="${escapeHtml(product.title)}"></label>
      <label>Цена<br><input name="price" value="${escapeHtml(product.price)}"></label>
      <label>Категория<br><select name="category">${cats.map(c=>`<option value="${c.id}" ${c.id===product.category? 'selected':''}>${c.name}</option>`).join('')}</select></label>
      <label>Изображение (путь)<br><input name="image" value="${escapeHtml(product.image)}"></label>
      <label>Описание<br><textarea name="description">${escapeHtml(product.description)}</textarea></label>
      <div style="margin-top:8px"><button type="submit">Сохранить</button> <button type="button" id="cancel-product">Отмена</button></div>
    `;
    wrap.appendChild(form);
    $('#cancel-product').addEventListener('click', ()=>{ wrap.innerHTML=''; });
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const fd = new FormData(form); const updated = { id: product.id, title: fd.get('title'), price: fd.get('price'), image: fd.get('image'), category: fd.get('category'), description: fd.get('description'), colors: [] };
      // try to save to API (POST for new, PUT for existing). Fallback to localStorage on failure.
      const existing = (await loadProducts()).some(p=>p.id === product.id);
      let ok = null;
      if(existing){
        ok = await tryApi('PUT', `/api/products/${product.id}`, updated);
      } else {
        ok = await tryApi('POST', '/api/products', updated);
      }
      let products = await loadProducts();
      if(!ok){
        const idx = products.findIndex(x=>x.id===product.id);
        if(idx>=0) products[idx] = updated; else products.push(updated);
        await saveProductsLocally(products);
      }
      renderProducts(); renderDashboard(); wrap.innerHTML='';
    });
  }

  async function renderCategories(){
    const list = $('#categories-list'); list.innerHTML = '';
    const cats = await loadCategories();
    cats.forEach(c=>{
      const el = document.createElement('div'); el.className='admin-item'; el.innerHTML = `<strong>${c.name}</strong><div class="admin-item-actions"><button data-id="${c.id}" class="edit-cat">Edit</button><button data-id="${c.id}" class="del-cat">Delete</button></div>`; list.appendChild(el);
    });
    $all('.edit-cat').forEach(b=> b.addEventListener('click', e=> openCategoryForm(e.target.dataset.id)));
    $all('.del-cat').forEach(b=> b.addEventListener('click', async e=>{
      if(!confirm('Удалить категорию?')) return;
      const id = e.target.dataset.id;
      const apiRes = await tryApi('DELETE', `/api/categories/${id}`);
      if(!apiRes){
        const cats = await loadCategories(); const idx = cats.findIndex(x=>x.id===id); if(idx>=0){ cats.splice(idx,1); saveCategoriesLocally(cats); }
      }
      renderCategories();
    }));
  }

  async function openCategoryForm(id){
    const wrap = $('#category-form-wrap'); wrap.innerHTML='';
    const cats = await loadCategories();
    const cat = id ? cats.find(c=>c.id===id) : { id: Date.now().toString(), name:'' };
    const form = document.createElement('form');
    form.innerHTML = `<label>Название<br><input name="name" value="${escapeHtml(cat.name)}"></label><div style="margin-top:8px"><button type="submit">Сохранить</button> <button type="button" id="cancel-cat">Отмена</button></div>`;
    wrap.appendChild(form);
    $('#cancel-cat').addEventListener('click', ()=> wrap.innerHTML='');
    form.addEventListener('submit', async (e)=>{
      e.preventDefault(); const fd = new FormData(form); const name = fd.get('name');
      // try API create/update
      if(cat && cat.id){
        const res = await tryApi('PUT', `/api/categories/${cat.id}`, { name });
        if(res){ await loadCategories(); renderCategories(); wrap.innerHTML=''; return; }
      }
      const apiRes = await tryApi('POST', '/api/categories', { name });
      if(apiRes){ await loadCategories(); renderCategories(); wrap.innerHTML=''; return; }
      const cats2 = await loadCategories(); const idx = cats2.findIndex(x=>x.id===cat.id); if(idx>=0) cats2[idx].name = name; else cats2.push({ id: Date.now().toString(), name }); saveCategoriesLocally(cats2); renderCategories(); wrap.innerHTML='';
    });
  }

  // Chat rendering
  function renderThreads(){
    const threads = loadThreads(); const container = $('#chat-threads'); container.innerHTML='';
    const ids = Object.keys(threads).reverse();
    if(ids.length===0){ container.innerHTML = '<p>Пока нет чатов.</p>'; $('#chat-messages').innerHTML=''; return; }
    ids.forEach(id=>{
      const thread = threads[id]; const last = thread[thread.length-1];
      const el = document.createElement('div'); el.className='thread-item'; el.innerHTML = `<strong>${thread.title || ('Товар ' + id)}</strong><div class="muted">${last? last.text.slice(0,80): ''}</div>`;
      el.addEventListener('click', ()=> openThread(id)); container.appendChild(el);
    });
  }

  function openThread(id){
    const threads = loadThreads(); const thread = threads[id] || [];
    const messagesEl = $('#chat-messages'); messagesEl.innerHTML = '';
    thread.forEach(m=>{
      const d = document.createElement('div'); d.className = 'msg ' + (m.from==='user' ? 'user' : 'admin'); d.textContent = (m.from==='user' ? 'Пользователь: ' : 'Админ: ') + m.text; messagesEl.appendChild(d);
    });
    // attach send handler
    $('#chat-send').onclick = ()=>{
      const input = $('#chat-input'); const text = input.value.trim(); if(!text) return; const msg = { from:'admin', text, at: Date.now() };
      thread.push(msg); threads[id] = thread; saveThreads(threads); openThread(id); renderThreads(); input.value='';
    };
  }

  // Utils
  function escapeHtml(s){ return (s||'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  // Navigation
  function showView(name){
    $all('.admin-view').forEach(v=> v.classList.add('hidden'));
    const el = document.getElementById('view-'+name); if(el) el.classList.remove('hidden');
    $all('.nav-btn').forEach(b=> b.classList.toggle('active', b.dataset.view===name));
  }


  // Init
  async function init(){
    // wire nav
    $all('.nav-btn').forEach(b=> b.addEventListener('click', ()=>{ showView(b.dataset.view); if(b.dataset.view==='products') renderProducts(); if(b.dataset.view==='categories') renderCategories(); if(b.dataset.view==='chats') renderThreads(); }));
    $('#btn-refresh').addEventListener('click', ()=>{ renderDashboard(); renderProducts(); renderCategories(); renderThreads(); });
    $('#btn-new-product').addEventListener('click', ()=> openProductForm());
    $('#btn-new-category').addEventListener('click', ()=> openCategoryForm());
    $('#admin-logout')?.addEventListener('click', ()=> doLogout());
    // login modal submit
    const loginBtn = document.getElementById('admin-login-submit');
    if(loginBtn){
      loginBtn.addEventListener('click', async ()=>{
        const usernameEl = document.getElementById('admin-login-username');
        const userVal = usernameEl ? usernameEl.value.trim() : '';
        const pass = document.getElementById('admin-login-pass').value;
        // Only attempt admin-login using ADMIN_USER / ADMIN_PASS (no email fallback)
        const me = await doAdminLogin(userVal, pass);
        if(me && me.role === 'admin'){ showLoginModal(false); await initAfterAuth(); }
        else { alert('Login failed or not admin'); }
      });
    }

    // try to fetch current user; if not admin, show login modal
    const me = await fetchMe();
    if(!me || me.role !== 'admin'){ showLoginModal(true); $('#admin-status-text').textContent = 'offline'; return; }
    // if admin, continue init
    await initAfterAuth();
  }

  // run
  document.addEventListener('DOMContentLoaded', init);
})();
