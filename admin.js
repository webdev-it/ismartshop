// admin.js — Admin panel UI + local fallback + API-sync helpers
(function(){
  const PRODUCTS_KEY = 'admin_products_v1';
  const CATS_KEY = 'admin_cats_v1';
  const USERS_KEY = 'ismart_users_v1';
  
  // Cache for products with TTL (5 min)
  let productsCache = null;
  let productsCacheTime = 0;
  const CACHE_TTL = 5 * 60 * 1000;
  const ADMIN_PAGE_LIMIT = 50;
  let adminPage = 1;
  let adminHasMore = true;
  let adminLoading = false;
  let adminLoadMoreObserver = null;
  
  // Image cache for resized previews (prevent re-resizing)
  const imagePreviewCache = new Map();

  // API base and helper (credentials included)
  const API_BASE = window.ISMART_API_BASE || '';
  async function apiFetch(path, opts = {}){
    const url = (path.startsWith('http') || path.startsWith('/')) ? API_BASE + path : API_BASE + '/' + path;
    const init = { credentials: 'include', headers: {}, ...opts };
    // attach stored bearer token if present (helps when cookies are not set cross-origin)
    try{
      const stored = localStorage.getItem('ismart_admin_token');
      if(stored && !init.headers.Authorization && !init.headers.Authorization){ init.headers['Authorization'] = 'Bearer ' + stored; }
    }catch(e){}
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

  // load products from API with pagination (no full list fetch)
  async function loadProducts({ page = 1, append = false } = {}){
    const now = Date.now();
    if(!append && page === 1 && productsCache && (now - productsCacheTime) < CACHE_TTL){
      return productsCache;
    }
    if(adminLoading) return productsCache || [];
    adminLoading = true;

    const api = await tryApi('GET', `/api/admin/products?page=${page}&limit=${ADMIN_PAGE_LIMIT}`);
    if(api && Array.isArray(api.products)){
      const sanitized = api.products.filter(p => p && typeof p === 'object').map(p => ({
        id: String(p.id || Date.now()),
        title: String(p.title || 'Unnamed'),
        price: String(p.price || '0'),
        category: String(p.category || ''),
        description: String(p.description || ''),
        images: Array.isArray(p.images) ? p.images : [],
        image: String(p.image || ''),
        colors: Array.isArray(p.colors) ? p.colors : [],
        status: String(p.status || 'approved')
      }));
      productsCache = append && Array.isArray(productsCache) ? productsCache.concat(sanitized) : sanitized;
      productsCacheTime = now;
      adminPage = page;
      adminHasMore = !!api.hasMore;
      adminLoading = false;
      return productsCache;
    }
    adminLoading = false;

    // fallback to localStorage only when API not available
    const s = localStorage.getItem(PRODUCTS_KEY);
    if(s) {
      try{
        const parsed = JSON.parse(s);
        if(Array.isArray(parsed)){
          productsCache = parsed;
          productsCacheTime = now;
          return parsed;
        }
        return [];
      }catch(e){
        console.warn('Failed to parse local products, clearing', e);
        localStorage.removeItem(PRODUCTS_KEY);
        return [];
      }
    }
    return [];
  }

  async function saveProductsLocally(products){
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
    // Update cache
    productsCache = products;
    productsCacheTime = Date.now();
    // local saved; admin edits will try to save to API when possible (see form submit)
  }

  async function loadCategories(){
    const api = await tryApi('GET','/api/categories');
    if(api){ localStorage.setItem(CATS_KEY, JSON.stringify(api)); return api; }
    const s = localStorage.getItem(CATS_KEY); 
    if(s) {
      try{
        return JSON.parse(s);
      }catch(e){
        console.warn('Failed to parse local categories, clearing', e);
        localStorage.removeItem(CATS_KEY);
        return [];
      }
    }
    return [];
  }

  function saveCategoriesLocally(cats){ localStorage.setItem(CATS_KEY, JSON.stringify(cats)); }

  // Chat system removed - was: loadThreads, saveThreads functions

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
    let usersCount = 0;
    let productsCount = 0;
    try{
      const stats = await tryApi('GET','/api/admin/stats');
      if(stats && typeof stats.users === 'number') usersCount = stats.users;
      if(stats && typeof stats.products === 'number') productsCount = stats.products;
    }catch(e){}
    if(!usersCount){
      try{
        const res = await apiFetch('/admin/db/users?limit=500');
        if(res.ok){ const users = await res.json(); usersCount = users.length; }
      }catch(e){}
    }
    $('#stat-users').textContent = usersCount || '—';
    $('#stat-products').textContent = productsCount || '—';
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
    try{
      const resp = await apiFetch('/auth/admin-login', { method: 'POST', body: { username, password: pass } });
      console.log('doAdminLogin: admin-login response status=', resp.status);
      const ct = resp.headers.get('content-type') || '';
      let body = null;
      if(ct.indexOf('application/json') !== -1) {
        body = await resp.json();
        console.log('doAdminLogin: admin-login body=', body);
      }
      if(!resp.ok){
        return { error: body || (`status ${resp.status}`) };
      }
      // persist token locally so subsequent requests can use Authorization header
      try{ if(body && body.token) localStorage.setItem('ismart_admin_token', body.token); }catch(e){}
      // on success, try to fetch current user (cookie should be set)
      let me = await tryApi('GET','/auth/me');
      // If cookie-based fetch returned null (sometimes cookies aren't set immediately),
      // retry using the returned token with an Authorization: Bearer header
      if((me === null || me === undefined) && body && body.token){
        try{
          const r2 = await apiFetch('/auth/me', { method: 'GET', headers: { Authorization: 'Bearer ' + body.token } });
          if(r2 && r2.ok){
            const ct2 = r2.headers.get('content-type') || '';
            if(ct2.indexOf('application/json') !== -1) me = await r2.json();
            else me = true;
          }
        }catch(err){ console.warn('doAdminLogin: bearer retry failed', err); }
      }
      console.log('doAdminLogin: /auth/me ->', me);
      return me;
    }catch(e){
      console.error('admin-login error', e);
      return { error: e.message };
    }
  }

  async function doLogout(){
    await tryApi('POST','/auth/logout');
    currentUser = null;
    try{ localStorage.removeItem('ismart_admin_token'); }catch(e){}
    // reload UI
    $('#admin-status-text').textContent = 'offline';
    // show login modal
    showLoginModal(true);
  }

  function showLoginModal(show){
    const m = document.getElementById('admin-login-modal');
    if(!m) return;
    m.classList.toggle('hidden', !show);
    // Блокируем/разблокируем навигацию и действия
    const nav = document.querySelector('.admin-top-nav');
    const actions = document.querySelector('.admin-actions');
    const main = document.querySelector('.admin-main');
    if(show){
      if(nav) nav.classList.add('disabled');
      if(actions) actions.classList.add('disabled');
      // Скрыть все секции кроме формы входа
      document.querySelectorAll('.admin-view').forEach(v=>v.classList.add('hidden'));
    } else {
      if(nav) nav.classList.remove('disabled');
      if(actions) actions.classList.remove('disabled');
    }
  }

  async function initAfterAuth(){
    // default view after successful auth
    showView('dashboard');
    try{ await renderDashboard(); }catch(e){ console.error('Error rendering dashboard:', e); }
    try{ await renderProducts(); }catch(e){ console.error('Error rendering products:', e); }
    try{ await renderCategories(); }catch(e){ console.error('Error rendering categories:', e); }
    try{
      const h = await tryApi('GET','/api/health'); 
      $('#admin-status-text').textContent = h? 'online' : 'offline';
    }catch(e){
      $('#admin-status-text').textContent = 'offline';
    }
  }

  async function renderProducts(){
    const products = await loadProducts({ page: 1, append: false });
    renderProductsList(products || [], { reset: true });
    setupAdminLoadMore();
  }

  // Render a given products array into the admin list (no API fetch)
  function renderProductsList(products, { reset = true } = {}){
    const list = $('#products-list'); 
    if(reset) list.innerHTML = '';
    const frags = document.createDocumentFragment(); // batch DOM operations
    (products || []).forEach(p=>{
      try{
        if(!p || !p.id || !p.title) return; // skip invalid products
        const el = document.createElement('div'); el.className = 'admin-item';
        const title = String(p.title || '').substring(0, 100);
        const price = String(p.price || '');
        const category = String(p.category || '');
        el.innerHTML = `<strong>${escapeHtml(title)}</strong><div>${escapeHtml(price)} — ${escapeHtml(category)}</div><div class="admin-item-actions"><button data-id="${p.id}" class="edit-product">Edit</button><button data-id="${p.id}" class="del-product">Delete</button></div>`;
        frags.appendChild(el);
      }catch(e){
        console.error('Failed to render product', p, e);
      }
    });
    list.appendChild(frags); // single DOM insert for all items
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

  async function loadMoreAdminProducts(){
    if(!adminHasMore || adminLoading) return;
    const nextPage = adminPage + 1;
    const prevLen = Array.isArray(productsCache) ? productsCache.length : 0;
    await loadProducts({ page: nextPage, append: true });
    const newItems = Array.isArray(productsCache) ? productsCache.slice(prevLen) : [];
    if(newItems.length){
      renderProductsList(newItems, { reset: false });
    }
    setupAdminLoadMore();
  }

  function setupAdminLoadMore(){
    const list = $('#products-list');
    if(!list) return;
    let sentinel = document.getElementById('admin-load-more');
    if(!adminHasMore){
      if(sentinel) sentinel.remove();
      if(adminLoadMoreObserver) adminLoadMoreObserver.disconnect();
      return;
    }
    if(!sentinel){
      sentinel = document.createElement('div');
      sentinel.id = 'admin-load-more';
      sentinel.style.height = '80px';
      sentinel.style.display = 'flex';
      sentinel.style.alignItems = 'center';
      sentinel.style.justifyContent = 'center';
      sentinel.style.color = 'var(--muted)';
      sentinel.textContent = 'Загружаю еще...';
      list.appendChild(sentinel);
    } else {
      list.appendChild(sentinel);
    }
    if(adminLoadMoreObserver) adminLoadMoreObserver.disconnect();
    adminLoadMoreObserver = new IntersectionObserver((entries)=>{
      entries.forEach(entry=>{
        if(entry.isIntersecting){
          loadMoreAdminProducts();
        }
      });
    }, { rootMargin: '200px', threshold: 0 });
    adminLoadMoreObserver.observe(sentinel);
  }

  // Filter products by search query (for search field)
  function filterAndRenderProducts(products, searchQuery){
    const filtered = products.filter(p => {
      const title = String(p.title || '').toLowerCase();
      const category = String(p.category || '').toLowerCase();
      const query = String(searchQuery || '').toLowerCase();
      return title.includes(query) || category.includes(query);
    });
    renderProductsList(filtered);
  }

  async function openProductForm(id){
    const wrap = $('#product-form-wrap'); wrap.innerHTML = '';
    const products = await loadProducts();
    const product = id ? products.find(x=>x.id===id) : { id: Date.now().toString(), title:'', price:'', images:[], category:'', description:'', colors:[] };
    const cats = await loadCategories();
    
    // Helper: Image uploader and cropper (multi-image)
      let selectedOriginals = Array.isArray(product.images) && product.images.length ? product.images.slice() : [];
      let selectedImages = selectedOriginals.slice();

      // create a resized preview (WebP if supported) from a dataURL or URL
      function createPreviewFromSrc(src, maxW = 1200, quality = 0.8){
        return new Promise((resolve)=>{
          // Check cache first
          const cacheKey = src.substring(0, 100) + '_' + maxW + '_' + quality;
          if(imagePreviewCache.has(cacheKey)){
            resolve(imagePreviewCache.get(cacheKey));
            return;
          }
          
          const img = new Image(); img.crossOrigin = 'anonymous';
          img.onload = ()=>{
            const ratio = Math.min(1, maxW / img.width);
            const w = Math.round(img.width * ratio);
            const h = Math.round(img.height * ratio);
            const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); ctx.drawImage(img, 0,0, w, h);
            try{ 
              const webp = c.toDataURL('image/webp', quality); 
              imagePreviewCache.set(cacheKey, webp);
              resolve(webp); 
            }catch(e){ 
              const png = c.toDataURL('image/png');
              imagePreviewCache.set(cacheKey, png);
              resolve(png); 
            }
          };
          img.onerror = ()=>{ resolve(src); };
          img.src = src;
        });
      }

    // Touch-friendly cropper modal: allows pan & pinch-zoom like mobile editors
    function openCropperModal(src, cb){
      const modal = document.createElement('div');
      modal.style.position = 'fixed'; modal.style.left = 0; modal.style.top = 0; modal.style.right = 0; modal.style.bottom = 0; modal.style.zIndex = 2000; modal.style.background = 'rgba(0,0,0,0.75)'; modal.style.display='flex'; modal.style.alignItems='center'; modal.style.justifyContent='center'; modal.style.padding = '20px';
      const card = document.createElement('div'); card.style.background='#fff'; card.style.padding='12px'; card.style.borderRadius='12px'; card.style.maxWidth='96vw'; card.style.maxHeight='92vh'; card.style.overflow='hidden'; card.style.display='flex'; card.style.flexDirection='column'; card.style.gap='8px'; card.style.alignItems='stretch';
      // viewport for crop (visual square area)
      const viewport = document.createElement('div'); viewport.style.width = 'min(720px, 86vw)'; viewport.style.height = 'min(540px, 64vh)'; viewport.style.background = '#111'; viewport.style.overflow = 'hidden'; viewport.style.position = 'relative'; viewport.style.borderRadius='8px'; viewport.style.touchAction = 'none';
      const imgEl = document.createElement('img'); imgEl.style.position = 'absolute'; imgEl.style.left = '50%'; imgEl.style.top = '50%'; imgEl.style.transform = 'translate(-50%, -50%) scale(1)'; imgEl.style.maxWidth = 'none'; imgEl.style.maxHeight = 'none'; imgEl.style.willChange = 'transform'; imgEl.draggable = false; imgEl.src = src;
      viewport.appendChild(imgEl);
      const info = document.createElement('div'); info.style.fontSize='13px'; info.style.color='#333'; info.textContent='Панорамируйте и масштабируйте изображение, затем нажмите "Обрезать".';
      const controls = document.createElement('div'); controls.style.display='flex'; controls.style.gap='8px'; controls.style.justifyContent='flex-end';
      const cancelBtn = document.createElement('button'); cancelBtn.textContent='Отмена';
      const cropBtn = document.createElement('button'); cropBtn.textContent='Обрезать';
      const zoomOut = document.createElement('button'); zoomOut.textContent='−'; zoomOut.title = 'Уменьшить';
      const zoomIn = document.createElement('button'); zoomIn.textContent='+'; zoomIn.title = 'Увеличить';
      controls.appendChild(zoomOut); controls.appendChild(zoomIn); controls.appendChild(cancelBtn); controls.appendChild(cropBtn);
      card.appendChild(viewport); card.appendChild(info); card.appendChild(controls); modal.appendChild(card); document.body.appendChild(modal);

      // simple local body lock for admin cropper
      const prevBodyOverflow = document.body.style.overflow; try{ document.body.style.overflow = 'hidden'; }catch(e){}

      let imgNaturalW = 0, imgNaturalH = 0;
      let scale = 1; let translate = { x:0, y:0 };
      function updateTransform(){ imgEl.style.transform = `translate(calc(-50% + ${translate.x}px), calc(-50% + ${translate.y}px)) scale(${scale})`; }

      imgEl.onload = ()=>{ imgNaturalW = imgEl.naturalWidth; imgNaturalH = imgEl.naturalHeight; // fit image initially
        const vw = viewport.clientWidth; const vh = viewport.clientHeight; const fitScale = Math.max(vw / imgNaturalW, vh / imgNaturalH); // cover
        scale = fitScale; translate = { x:0, y:0 }; updateTransform();
      };

      // pointer-based panning
      let pointerDown = false; let lastPos = null; let pointers = {};
      function onPointerDown(e){ e.preventDefault(); e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); pointers[e.pointerId] = { x: e.clientX, y: e.clientY }; if(Object.keys(pointers).length === 1){ pointerDown = true; lastPos = { x: e.clientX, y: e.clientY }; } }
      function onPointerMove(e){ e.preventDefault(); if(Object.keys(pointers).length === 2){ // pinch
          const ids = Object.keys(pointers).map(id=>parseInt(id,10)); const p0 = pointers[ids[0]]; const p1 = pointers[ids[1]]; if(!p0 || !p1) return; const curDist = Math.hypot(p1.x - p0.x, p1.y - p0.y); const newP0 = (e.pointerId==ids[0])? {x:e.clientX,y:e.clientY}:p0; const newP1 = (e.pointerId==ids[1])? {x:e.clientX,y:e.clientY}:p1; const newDist = Math.hypot(newP1.x - newP0.x, newP1.y - newP0.y); if(p0._startDist == null){ p0._startDist = curDist; p0._startScale = scale; }
            const base = p0._startDist || curDist; const factor = newDist / base; scale = Math.max(0.1, (p0._startScale || scale) * factor); updateTransform();
        } else if(pointerDown && lastPos){ const dx = e.clientX - lastPos.x; const dy = e.clientY - lastPos.y; translate.x += dx; translate.y += dy; lastPos = { x: e.clientX, y: e.clientY }; updateTransform(); }
        pointers[e.pointerId] && (pointers[e.pointerId].x = e.clientX, pointers[e.pointerId].y = e.clientY);
      }
      function onPointerUp(e){ e.preventDefault(); try{ e.target.releasePointerCapture && e.target.releasePointerCapture(e.pointerId); }catch(er){} delete pointers[e.pointerId]; if(Object.keys(pointers).length < 2) { pointerDown = false; lastPos = null; Object.values(pointers).forEach(p=>{ delete p._startDist; delete p._startScale; }); } }

      // touch pinch support (for browsers that don't forward multi pointers reliably)
      let lastTouchDist = null;
      viewport.addEventListener('touchstart', (ev)=>{ if(ev.touches.length === 2){ lastTouchDist = Math.hypot(ev.touches[0].clientX-ev.touches[1].clientX, ev.touches[0].clientY-ev.touches[1].clientY); } }, { passive:false });
      viewport.addEventListener('touchmove', (ev)=>{ if(ev.touches.length === 2){ ev.preventDefault(); const d = Math.hypot(ev.touches[0].clientX-ev.touches[1].clientX, ev.touches[0].clientY-ev.touches[1].clientY); if(lastTouchDist){ const factor = d / lastTouchDist; scale = Math.max(0.1, scale * factor); updateTransform(); } lastTouchDist = d; } }, { passive:false });
      viewport.addEventListener('touchend', (ev)=>{ if(ev.touches.length < 2) lastTouchDist = null; }, { passive:true });

      viewport.addEventListener('pointerdown', onPointerDown);
      viewport.addEventListener('pointermove', onPointerMove);
      viewport.addEventListener('pointerup', onPointerUp);
      viewport.addEventListener('pointercancel', onPointerUp);

      // wheel zoom (desktop)
      viewport.addEventListener('wheel', (e)=>{ e.preventDefault(); const delta = -e.deltaY; const factor = 1 + (delta>0?0.08:-0.08); scale = Math.max(0.1, scale * factor); updateTransform(); }, { passive:false });

      zoomIn.addEventListener('click', ()=>{ scale = scale * 1.12; updateTransform(); });
      zoomOut.addEventListener('click', ()=>{ scale = Math.max(0.1, scale / 1.12); updateTransform(); });

      function closeModal(result){ try{ viewport.removeEventListener('pointerdown', onPointerDown); viewport.removeEventListener('pointermove', onPointerMove); viewport.removeEventListener('pointerup', onPointerUp); viewport.removeEventListener('pointercancel', onPointerUp); }catch(e){} try{ document.body.style.overflow = prevBodyOverflow; }catch(e){} modal.remove(); cb && cb(result); }

      cancelBtn.addEventListener('click', ()=> closeModal(null));
      cropBtn.addEventListener('click', ()=>{
        // compute visible rect in image natural coordinates
        try{
          const vw = viewport.clientWidth; const vh = viewport.clientHeight;
          // image displayed center at 50%50 with translate and scale
          const dispW = imgNaturalW * scale; const dispH = imgNaturalH * scale;
          // top-left of image in viewport coords:
          const imgLeft = (vw/2) - (dispW/2) + translate.x;
          const imgTop = (vh/2) - (dispH/2) + translate.y;
          // intersection of viewport [0,vw]x[0,vh] with image rectangle
          const sx = Math.max(0, -imgLeft);
          const sy = Math.max(0, -imgTop);
          const sw = Math.min(dispW - sx, vw - Math.max(0, imgLeft));
          const sh = Math.min(dispH - sy, vh - Math.max(0, imgTop));
          if(sw <= 0 || sh <= 0) return alert('Неправильная позиция изображения для обрезки');
          // convert to natural image coords
          const nx = Math.round((sx / dispW) * imgNaturalW);
          const ny = Math.round((sy / dispH) * imgNaturalH);
          const nw = Math.round((sw / dispW) * imgNaturalW);
          const nh = Math.round((sh / dispH) * imgNaturalH);
          const out = document.createElement('canvas'); out.width = nw; out.height = nh; const octx = out.getContext('2d');
          const baseImg = new Image(); baseImg.crossOrigin = 'anonymous'; baseImg.onload = ()=>{ octx.drawImage(baseImg, nx, ny, nw, nh, 0,0, nw, nh); const data = out.toDataURL('image/png'); closeModal(data); };
          baseImg.src = src;
        }catch(err){ alert('Ошибка при обрезке: ' + (err && err.message)); }
      });
    }

    const createImageSection = () => {
      const section = document.createElement('div');
      section.innerHTML = `
        <label style="display:block;margin-bottom:8px">Изображения<br>
          <div style="display:flex;gap:8px;margin-top:4px">
            <input type="file" id="image-upload" accept="image/*" multiple style="flex:1">
            <button type="button" id="add-from-url">Добавить по URL</button>
          </div>
        </label>
        <div id="images-list" style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"></div>
        <input type="hidden" name="images" value="">
          <input type="hidden" name="images_preview" value="">
      `;

      const uploadInput = section.querySelector('#image-upload');
      const imagesList = section.querySelector('#images-list');
      const hiddenInput = section.querySelector('input[name="images"]');

      function refreshList(){
        imagesList.innerHTML = '';
        selectedImages.forEach((src, idx)=>{
          const thumb = document.createElement('div');
          thumb.draggable = true;
          thumb.dataset.index = String(idx);
          thumb.style.width = '100px'; thumb.style.height = '100px'; thumb.style.border = '1px solid #ddd'; thumb.style.borderRadius='8px'; thumb.style.backgroundSize='cover'; thumb.style.backgroundPosition='center'; thumb.style.position='relative';
          thumb.style.backgroundImage = `url('${src}')`;
          const controls = document.createElement('div'); controls.style.position='absolute'; controls.style.right='6px'; controls.style.bottom='6px'; controls.style.display='flex'; controls.style.gap='6px';
          const cropBtn = document.createElement('button'); cropBtn.textContent='Обрезать'; cropBtn.type='button'; cropBtn.style.fontSize='12px';
          const leftBtn = document.createElement('button'); leftBtn.textContent='◀'; leftBtn.type='button'; leftBtn.title='Переместить влево'; leftBtn.style.fontSize='12px';
          const rightBtn = document.createElement('button'); rightBtn.textContent='▶'; rightBtn.type='button'; rightBtn.title='Переместить вправо'; rightBtn.style.fontSize='12px';
          const delBtn = document.createElement('button'); delBtn.textContent='✖'; delBtn.type='button'; delBtn.style.fontSize='12px'; delBtn.title='Удалить';
          controls.appendChild(leftBtn); controls.appendChild(rightBtn); controls.appendChild(cropBtn); controls.appendChild(delBtn);
          thumb.appendChild(controls);
          imagesList.appendChild(thumb);

          leftBtn.addEventListener('click', ()=>{ if(idx>0){ const a=selectedImages[idx-1]; selectedImages[idx-1]=selectedImages[idx]; selectedImages[idx]=a; const ao = selectedOriginals[idx-1]; selectedOriginals[idx-1]=selectedOriginals[idx]; selectedOriginals[idx]=ao; refreshList(); } });
          rightBtn.addEventListener('click', ()=>{ if(idx<selectedImages.length-1){ const a=selectedImages[idx+1]; selectedImages[idx+1]=selectedImages[idx]; selectedImages[idx]=a; const ao = selectedOriginals[idx+1]; selectedOriginals[idx+1]=selectedOriginals[idx]; selectedOriginals[idx]=ao; refreshList(); } });
          delBtn.addEventListener('click', ()=>{ if(confirm('Удалить изображение?')){ selectedImages.splice(idx,1); selectedOriginals.splice(idx,1); refreshList(); } });
          cropBtn.addEventListener('click', ()=>{
            const origSrc = selectedOriginals[idx] || src;
            openCropperModal(origSrc, async (cropped)=>{ if(cropped){
              // replace original and regenerate preview
              selectedOriginals[idx] = cropped;
              const preview = await createPreviewFromSrc(cropped, 1200, 0.8);
              selectedImages[idx] = preview;
              refreshList();
            } });
          });

          // Drag & Drop handlers for reordering
          thumb.addEventListener('dragstart', (ev)=>{
            ev.dataTransfer.setData('text/plain', String(idx));
            thumb.style.opacity = '0.5';
          });
          thumb.addEventListener('dragend', (ev)=>{
            thumb.style.opacity = '';
            refreshList();
          });
          thumb.addEventListener('dragover', (ev)=>{ ev.preventDefault(); thumb.classList.add('drag-over'); });
          thumb.addEventListener('dragleave', ()=>{ thumb.classList.remove('drag-over'); });
          thumb.addEventListener('drop', (ev)=>{
            ev.preventDefault(); thumb.classList.remove('drag-over');
            const from = parseInt(ev.dataTransfer.getData('text/plain'), 10);
            const to = idx;
            if(Number.isFinite(from) && from !== to){
              const item = selectedImages.splice(from,1)[0];
              const itemOrig = selectedOriginals.splice(from,1)[0];
              selectedImages.splice(to,0,item);
              selectedOriginals.splice(to,0,itemOrig);
              refreshList();
            }
          });
        });
        hiddenInput.value = JSON.stringify(selectedImages.slice(0,10));
          const origInput = section.querySelector('input[name="images"]');
          const prevInput = section.querySelector('input[name="images_preview"]');
          if(origInput) origInput.value = JSON.stringify(selectedOriginals.slice(0,10));
          if(prevInput) prevInput.value = JSON.stringify(selectedImages.slice(0,10));
      }

        uploadInput.addEventListener('change', (e) => {
          const files = Array.from(e.target.files || []);
          if(!files.length) return;
          files.forEach(file=>{
            const reader = new FileReader();
            reader.onload = async (evt) => {
              // preserve original file dataURL
              const orig = evt.target.result;
              selectedOriginals.push(orig);
              // generate preview and push for UI
              const preview = await createPreviewFromSrc(orig, 1200, 0.8);
              selectedImages.push(preview);
              refreshList();
            };
            reader.readAsDataURL(file);
          });
        });

      // Add from URL
      section.querySelector('#add-from-url').addEventListener('click', async ()=>{
        const url = prompt('Вставьте ссылку на изображение');
        if(!url) return;
        // add as original and generate preview
        selectedOriginals.push(url);
        const preview = await createPreviewFromSrc(url, 1200, 0.8);
        selectedImages.push(preview);
        refreshList();
      });

      refreshList();
      return section;
    };
    
    const form = document.createElement('form');
    form.innerHTML = `
      <label>Название<br><input name="title" value="${escapeHtml(product.title)}" style="width:100%"></label>
      <label style="display:block;margin-top:8px">Цена (₽)<br><input name="price" type="text" inputmode="numeric" placeholder="0" value="${escapeHtml(product.price.toString().replace(/[^\d]/g, ''))}" style="width:100%"></label>
      <label style="display:block;margin-top:8px">Категория<br><select name="category" style="width:100%">${cats.map(c=>`<option value="${c.id}" ${c.id===product.category? 'selected':''}>${c.name}</option>`).join('')}</select></label>
      <label style="display:block;margin-top:8px">Описание<br><textarea name="description" style="width:100%;min-height:80px">${escapeHtml(product.description)}</textarea></label>
      <div style="margin-top:8px"><button type="submit">Сохранить</button> <button type="button" id="cancel-product">Отмена</button></div>
    `;
    
    // Insert image section after title
    const titleLabel = form.querySelector('label');
    titleLabel.parentNode.insertBefore(createImageSection(), titleLabel.nextSibling);
    
    wrap.appendChild(form);

    // ensure form can be closed with Escape and handlers are cleaned up
    let __adminFormKeyHandler = null;
    function closeProductForm(){
      try{ if(__adminFormKeyHandler) { document.removeEventListener('keydown', __adminFormKeyHandler); __adminFormKeyHandler = null; } }catch(e){}
      wrap.innerHTML = '';
    }
    __adminFormKeyHandler = (ev)=>{ if(ev.key === 'Escape') closeProductForm(); };
    document.addEventListener('keydown', __adminFormKeyHandler);
    
    // Handle price input - только цифры, автоматически добавляем рубль
    const priceInput = form.querySelector('input[name="price"]');
    priceInput.addEventListener('input', (e) => {
      let value = e.target.value.replace(/[^\d]/g, '');
      e.target.value = value;
    });
    priceInput.addEventListener('blur', (e) => {
      if(e.target.value) e.target.value = e.target.value + ' ₽';
    });
    priceInput.addEventListener('focus', (e) => {
      e.target.value = e.target.value.replace(/[^\d]/g, '');
    });
    
    $('#cancel-product').addEventListener('click', ()=>{ closeProductForm(); });
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const fd = new FormData(form);
      let priceValue = fd.get('price').replace(/[^\d]/g, '');
      let imagesVal = [];
        let imagesPreviewVal = [];
        try{ imagesVal = JSON.parse(fd.get('images') || '[]'); }catch(e){ imagesVal = []; }
        try{ imagesPreviewVal = JSON.parse(fd.get('images_preview') || '[]'); }catch(e){ imagesPreviewVal = []; }
        const updated = { id: product.id, title: fd.get('title'), price: priceValue, images: imagesVal.length ? imagesVal : imagesPreviewVal, image: (imagesVal.length ? imagesVal[0] : imagesPreviewVal[0]) || '', category: fd.get('category'), description: fd.get('description'), colors: [] };
      // try to save to API (POST for new, PUT for existing). Fallback to localStorage on failure.
      const existing = (await loadProducts()).some(p=>p.id === product.id);
      let ok = null;
      try{
        if(existing){
          ok = await tryApi('PUT', `/api/products/${product.id}`, updated);
        } else {
          ok = await tryApi('POST', '/api/products', updated);
        }
      }catch(err){ ok = null; }
      console.log('[Admin] save product response:', ok);
      let products = await loadProducts();
      if(!ok){
        // server save failed or returned non-JSON -> persist locally and inform admin
        const idx = products.findIndex(x=>x.id===product.id);
        if(idx>=0) products[idx] = updated; else products.push(updated);
        await saveProductsLocally(products);
        alert('Сохранено локально. Сервер недоступен или вернул ошибку. Проверьте консоль для деталей.');
      } else {
        // server saved: try to refresh products from API. If API GET doesn't yet include
        // the created product (eventual consistency), insert the returned object into
        // local cache so admin sees it immediately.
        try{
          const respList = await loadProducts();
          products = respList || [];
          try{
            if(ok && ok.id){
              const exists = products.some(p=> String(p.id) === String(ok.id));
              if(!exists){
                products.unshift(ok);
                await saveProductsLocally(products);
              } else {
                // replace if differs
                products = products.map(p=> String(p.id) === String(ok.id) ? ok : p);
                await saveProductsLocally(products);
              }
            }
          }catch(e){ console.warn('Failed to merge returned product into local cache', e); }
        }catch(e){ console.warn('Reload after save failed', e); }
      }
      renderProducts(); renderDashboard(); closeProductForm();
    });
  }

  async function renderCategories(){
    const list = $('#categories-list'); list.innerHTML = '';
    const cats = await loadCategories();
    const frags = document.createDocumentFragment();
    cats.forEach(c=>{
      const el = document.createElement('div'); el.className='admin-item'; el.innerHTML = `<strong>${c.name}</strong><div class="admin-item-actions"><button data-id="${c.id}" class="edit-cat">Edit</button><button data-id="${c.id}" class="del-cat">Delete</button></div>`; frags.appendChild(el);
    });
    list.appendChild(frags);
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

  // --------- Admin DB UI helpers ---------
  async function loadAdminDBInfo(){
    const info = await tryApi('GET','/admin/db/info');
    if(!info) return;
    $('#db-info-db').textContent = info.db ? 'Postgres' : 'JSON files';
    $('#db-info-users').textContent = info.userCount || '—';
    $('#db-info-size').textContent = info.dbSize || (info.userFileSize ? (info.userFileSize + ' bytes') : '—');
  }

  async function loadAdminUsers(){
    $('#db-users-list').innerHTML = '<div class="muted">Загрузка...</div>';
    const users = await tryApi('GET','/admin/db/users?limit=500');
    if(!users) { $('#db-users-list').innerHTML = '<div class="muted">Не удалось получить список пользователей</div>'; return; }
    const wrap = document.createElement('div'); wrap.style.display = 'flex'; wrap.style.flexDirection = 'column'; wrap.style.gap='8px';
    users.forEach(u=>{
      const r = document.createElement('div'); r.className='item-row'; r.innerHTML = `<div class="meta">${u.email || ''} <span class="muted" style="margin-left:8px">${u.name || ''}</span></div><div class="item-actions"><button data-email="${u.email}" class="db-del-user">Удалить</button></div>`;
      wrap.appendChild(r);
    });
    $('#db-users-list').innerHTML=''; $('#db-users-list').appendChild(wrap);
    $all('.db-del-user').forEach(b=> b.addEventListener('click', async e=>{
      const email = e.target.dataset.email; if(!confirm('Удалить пользователя ' + email + '? Это действие необратимо.')) return;
      const res = await tryApi('POST','/admin/db/delete-user', { email });
      if(!res) return alert('Удаление не удалось.');
      alert('Пользователь удалён: ' + (res.deleted && res.deleted.email)); loadAdminUsers(); loadAdminDBInfo(); renderDashboard();
    }));
  }

  async function doDbTruncate(){
    if(!confirm('Вы уверены? Все пользователи будут удалены. Эта операция необратима.')) return;
    const res = await tryApi('POST','/admin/db/truncate-users', { confirm: true });
    if(!res) return alert('Операция не удалась');
    alert('Таблица пользователей очищена'); loadAdminUsers(); loadAdminDBInfo(); renderDashboard();
  }

  async function doDbTruncateProducts(){
    if(!confirm('Вы уверены? Все товары будут удалены. Эта операция необратима.')) return;
    const res = await tryApi('POST','/admin/db/truncate-products', { confirm: true });
    if(!res) return alert('Операция не удалась');
    alert('Все товары удалены'); localStorage.removeItem(PRODUCTS_KEY); renderProducts(); renderDashboard();
  }

  async function doDbBackup(){
    const res = await tryApi('POST','/admin/db/backup-json');
    if(!res) return alert('Бэкап не выполнен');
    alert('Бэкап создан: ' + (res.copies ? res.copies.length + ' файлов' : 'ок'));
  }

  async function doDbVacuum(){
    const res = await tryApi('POST','/admin/db/vacuum', { full: false });
    if(!res) return alert('VACUUM не выполнен');
    alert('VACUUM выполнен');
  }

  async function doDbExecSql(){
    const sql = document.getElementById('db-sql').value || '';
    if(!sql.trim()) return alert('SQL-запрос пуст');
    const resultEl = document.getElementById('db-sql-result'); resultEl.style.display='block'; resultEl.textContent = 'Выполняется...';
    const res = await tryApi('POST','/admin/db/execute', { sql });
    if(!res){ resultEl.textContent = 'Выполнение не удалось'; return; }
    resultEl.textContent = JSON.stringify(res, null, 2);
  }



  async function openCategoryForm(id){
    const wrap = $('#category-form-wrap'); wrap.innerHTML='';
    const cats = await loadCategories();
    const isEditing = !!id; // true if editing existing category
    const cat = isEditing ? cats.find(c=>c.id===id) : { id: null, name:'' };
    const form = document.createElement('form');
    form.innerHTML = `<label>Название<br><input name="name" value="${escapeHtml(cat.name)}"></label><div style="margin-top:8px"><button type="submit">Сохранить</button> <button type="button" id="cancel-cat">Отмена</button></div>`;
    wrap.appendChild(form);
    $('#cancel-cat').addEventListener('click', ()=> wrap.innerHTML='');
    form.addEventListener('submit', async (e)=>{
      e.preventDefault(); const fd = new FormData(form); const name = fd.get('name');
      // try API create/update
      if(isEditing && cat && cat.id){
        const res = await tryApi('PUT', `/api/categories/${cat.id}`, { name });
        if(res){ await loadCategories(); renderCategories(); wrap.innerHTML=''; return; }
      } else {
        const apiRes = await tryApi('POST', '/api/categories', { name });
        if(apiRes){ await loadCategories(); renderCategories(); wrap.innerHTML=''; return; }
      }
      // fallback to local storage
      const cats2 = await loadCategories(); const idx = cats2.findIndex(x=>x.id===cat.id); if(idx>=0) cats2[idx].name = name; else cats2.push({ id: Date.now().toString(), name }); saveCategoriesLocally(cats2); renderCategories(); wrap.innerHTML='';
    });
  }

  // Chat rendering removed

  // Utils
  function escapeHtml(s){ return (s||'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  // Accessibility helpers (light-only theme)
  function enhanceAccessibility(){
    // Add ARIA roles/labels to nav buttons
    document.querySelectorAll('.nav-btn').forEach(b=>{
      if(!b.hasAttribute('aria-label')) b.setAttribute('aria-label', b.textContent.trim());
      b.setAttribute('role','button');
      b.tabIndex = 0;
      b.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); } });
    });
    // Ensure action buttons have accessible names
    ['btn-refresh','btn-new-product','btn-new-category','admin-logout','db-refresh-users','db-truncate-users','db-backup-json','db-vacuum','db-exec-sql'].forEach(id=>{
      const el = document.getElementById(id); if(el && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', el.textContent.trim());
    });
    // Ensure theme toggle (if present) is inert in light-only UI
    const themeToggle = document.getElementById('theme-toggle');
    if(themeToggle){ themeToggle.tabIndex = -1; }
  }

  // Navigation
  function showView(name){
    $all('.admin-view').forEach(v=> v.classList.add('hidden'));
    const el = document.getElementById('view-'+name); if(el) el.classList.remove('hidden');
    $all('.nav-btn').forEach(b=> b.classList.toggle('active', b.dataset.view===name));
  }


  // Init
  async function init(){
    // apply accessibility enhancements early (light-only UI)
    enhanceAccessibility();
    // wire nav
    $all('.nav-btn').forEach(b=> b.addEventListener('click', ()=>{ showView(b.dataset.view); if(b.dataset.view==='products') renderProducts(); if(b.dataset.view==='categories') renderCategories(); if(b.dataset.view==='database'){ loadAdminDBInfo(); loadAdminUsers(); } }));
    
    // Setup products search
    const searchInput = document.getElementById('products-search');
    if(searchInput){
      let searchTimeout = null;
      searchInput.addEventListener('input', async (e)=>{
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async ()=>{
          const query = e.target.value;
          const products = await loadProducts();
          filterAndRenderProducts(products, query);
        }, 300);
      });
    }
    
    $('#btn-refresh').addEventListener('click', ()=>{ renderDashboard(); renderProducts(); renderCategories(); loadAdminDBInfo(); loadAdminUsers(); });
    $('#btn-new-product').addEventListener('click', ()=> openProductForm());
    $('#btn-new-category').addEventListener('click', ()=> openCategoryForm());
    $('#admin-logout')?.addEventListener('click', ()=> doLogout());

    // DB action bindings
    $('#db-refresh-users')?.addEventListener('click', ()=> loadAdminUsers());
    $('#db-truncate-users')?.addEventListener('click', ()=> doDbTruncate());
    $('#db-truncate-products')?.addEventListener('click', ()=> doDbTruncateProducts());
    $('#db-backup-json')?.addEventListener('click', ()=> doDbBackup());
    $('#db-vacuum')?.addEventListener('click', ()=> doDbVacuum());
    $('#db-exec-sql')?.addEventListener('click', ()=> doDbExecSql());
    // login modal submit
    const loginBtn = document.getElementById('admin-login-submit');
    const loginUser = document.getElementById('admin-login-username');
    const loginPass = document.getElementById('admin-login-pass');
    function updateLoginBtn(){
      if(loginBtn && loginUser && loginPass){
        loginBtn.disabled = !(loginUser.value.trim() && loginPass.value);
      }
    }
    if(loginUser) loginUser.addEventListener('input', updateLoginBtn);
    if(loginPass) loginPass.addEventListener('input', updateLoginBtn);
    updateLoginBtn();
    if(loginBtn){
      loginBtn.addEventListener('click', async ()=>{
        if(loginBtn.disabled) return;
        const userVal = loginUser ? loginUser.value.trim() : '';
        const pass = loginPass ? loginPass.value : '';
        loginBtn.disabled = true;
        loginBtn.textContent = 'Вход...';
        const me = await doAdminLogin(userVal, pass);
        loginBtn.textContent = 'Войти';
        updateLoginBtn();
        if(me && me.role === 'admin'){
          showLoginModal(false);
          await initAfterAuth();
        } else if(me && me.error){
          const msg = (typeof me.error === 'string') ? me.error : (me.error.message || JSON.stringify(me.error));
          alert('Ошибка входа: ' + msg);
        } else {
          alert('Ошибка: нет доступа');
        }
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
