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

// Image lazy loading for main page (reduce initial bandwidth)
function setupImageLazyLoading(){
  try {
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if(entry.isIntersecting){
          const img = entry.target;
          if(img.dataset.src){
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
            imageObserver.unobserve(img);
          }
        }
      });
    }, { rootMargin: '50px' });
    
    document.querySelectorAll('img[data-src]').forEach(img => imageObserver.observe(img));
  } catch(e) { /* no intersection observer support, skip */ }
}

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
let currentSearchQuery = '';
let searchDebounceTimeout = null;

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
async function fetchProductsPage(page = 1){
  const res = await apiFetch(`/api/products?page=${page}&limit=${SERVER_PAGE_SIZE}`);
  if(!res.ok) throw new Error('no api');
  const data = await res.json();
  const products = Array.isArray(data) ? data : (data.products || []);
  const hasMore = Array.isArray(data) ? false : !!data.hasMore;
  return { products, hasMore };
}

async function fetchProducts(){
  try{
    // Check if cache is still fresh
    const now = Date.now();
      if(productsCache.length > 0 && (now - productsCacheTime) < PRODUCTS_CACHE_TTL){
      console.log('[Cache] Using cached products');
      return productsCache;
    }

    serverPage = 1;
    const first = await fetchProductsPage(1);
    serverHasMore = !!first.hasMore;
    productsCacheTime = now;
    return first.products || [];
  }catch(e){
    return [];
  }
}

async function fetchCategories(){
  try{
    // Check if cache is still fresh
    const now = Date.now();
      if(categoriesCache.length > 0 && (now - categoriesCacheTime) < CATEGORIES_CACHE_TTL){
      console.log('[Cache] Using cached categories');
      return categoriesCache;
    }
    
    const res = await apiFetch('/api/categories');
    if(!res.ok) throw new Error('no api');
    const data = await res.json();
    
    // Update cache time
    categoriesCacheTime = now;
    return data;
  }catch(e){
    // return empty categories if API unavailable
    return sampleCategories;
  }
}

// Fetch app config (Telegram contact, etc)
async function fetchConfig(){
  try{
    const res = await apiFetch('/api/config');
    if(!res.ok) return;
    const config = await res.json();
    if(config.telegramContact){
      window.TELEGRAM_CONTACT = config.telegramContact;
    }
  }catch(e){
    // config fetch failed, TELEGRAM_CONTACT will be undefined
    console.log('Config fetch failed:', e && e.message);
  }
}

// Format price for display: ensure a trailing ₽ if missing
function formatPrice(p){
  try{
    if(p === null || p === undefined) return '';
    let s = String(p).trim();
    if(!s) return '';
    // If already contains currency symbol, return as-is
    if(/₽|руб\.?/i.test(s)) return s;
    return s + ' ₽';
  }catch(e){ return String(p || ''); }
}

// --- Chat / threads storage (localStorage) ---
// REMOVED: Chat system completely removed, replaced with Telegram redirect

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
  // hide JivoSite chat widget on profile view
  const jivoChatWidget = document.querySelector('.jivochat-container, [class*="jivo"]');
  if(jivoChatWidget) {
    jivoChatWidget.style.display = (id === 'view-profile' ? 'none' : '');
  }
}

let productsCache = [];
let categoriesCache = [];
let currentProductId = null;

// Cache with TTL (3 minutes for products, 10 min for categories)
const PRODUCTS_CACHE_TTL = 3 * 60 * 1000;
const CATEGORIES_CACHE_TTL = 10 * 60 * 1000;
let productsCacheTime = 0;
let categoriesCacheTime = 0;

// Lazy loading (infinite scroll) parameters
const PRODUCTS_PER_PAGE = 8; // Load 8 cards at a time for bandwidth optimization
const SERVER_PAGE_SIZE = 24; // API page size to keep responses small
let currentPage = 0;
let allFilteredProducts = [];
let isLoadingMore = false;
let hasMoreProducts = true;
let loadMoreObserver = null;
let serverPage = 1;
let serverHasMore = true;
let serverLoading = false;
// Normalize products: ensure `images` array and numeric `priceNum`
function normalizeProducts(list){
  return (list || []).map(p=>{
    let imgs = Array.isArray(p.images) ? p.images.slice() : [];
    if(!imgs.length && p.image){ imgs = [p.image]; }
    if(!imgs.length && p.images && typeof p.images === 'string'){
      try{ const parsed = JSON.parse(p.images); if(Array.isArray(parsed)) imgs = parsed; }catch(e){}
    }
    const imgsSan = (imgs || []).map(s=> (s||'').trim()).filter(Boolean);
    const priceNum = Number(String(p.price || p.price === 0 ? p.price : '').replace(/[^0-9.\-\.]/g, '')) || 0;
    return { ...p, images: imgsSan, image: imgsSan[0] || '', priceNum };
  });
}
// Body scroll lock helpers for modals
let __productScrollY = 0;
let __savedTabbarDisplay = null;
function lockBodyScroll(){
  try{
    __productScrollY = window.scrollY || window.pageYOffset || 0;
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${__productScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
  }catch(e){}
  // hide tabbar if present
  try{ const tab = document.querySelector('.tabbar'); if(tab){ __savedTabbarDisplay = tab.style.display || ''; tab.style.display = 'none'; } }catch(e){}
}
function unlockBodyScroll(){
  try{
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.documentElement.style.scrollBehavior = '';
    window.scrollTo(0, __productScrollY || 0);
  }catch(e){}
  // restore tabbar
  try{ const tab = document.querySelector('.tabbar'); if(tab){ tab.style.display = (__savedTabbarDisplay === undefined ? '' : __savedTabbarDisplay); __savedTabbarDisplay = null; } }catch(e){}
}

// Product detail view
async function showProduct(productId){
  showView('view-product');
  currentProductId = productId;
  // try to fetch fresh product data from API to ensure images[] are present
  let p = productsCache.find(x=>x.id === productId) || {title:'Товар', images:[]};
  try{
    const res = await apiFetch('/api/products/' + encodeURIComponent(productId));
    if(res && res.ok){
      const json = await res.json();
      if(json && json.id){
        try{
          // normalize server product so `images` is an array (handles JSON-string legacy)
          const norm = normalizeProducts([json])[0];
          p = norm || json;
          // merge into local cache so other views see the fresh shape
          const idx = productsCache.findIndex(x=>x.id === p.id);
          if(idx >= 0) productsCache[idx] = p; else productsCache.push(p);
        }catch(e){ p = json; }
      }
    }
  }catch(e){ /* fallback to cache */ }
  // build images array (support legacy `image` field)
  try{
    // ensure product shape normalized (images => array)
    p = normalizeProducts([p])[0] || p;
  }catch(e){/* ignore */}
  const imgs = (Array.isArray(p.images) && p.images.length) ? p.images : (p.image ? [p.image] : []);
  console.log('[showProduct] product id=', p.id, 'images:', p.images, 'imgs.length=', imgs.length);
  // render gallery inside .product-image
  const imgContainer = document.querySelector('.product-image');
    if(imgContainer){
    // prevent body scroll while modal open
    try{ lockBodyScroll(); }catch(e){}
    imgContainer.innerHTML = '';
    const gallery = document.createElement('div'); gallery.id = 'product-gallery'; gallery.style.position='relative'; gallery.style.display='flex'; gallery.style.alignItems='center'; gallery.style.justifyContent='center'; gallery.style.height='320px'; gallery.style.overflow='hidden';
    const slides = document.createElement('div'); slides.style.display='flex'; slides.style.transition='transform 220ms ease'; slides.style.height='100%'; slides.style.width = imgs.length > 0 ? (imgs.length * 100) + '%' : '100%';
    imgs.forEach((s, i)=>{
      const wrap = document.createElement('div'); wrap.style.flex = '0 0 100%'; wrap.style.display='flex'; wrap.style.alignItems='center'; wrap.style.justifyContent='center'; wrap.style.height='100%'; wrap.style.overflow='hidden';
      const im = document.createElement('img'); im.style.width = '100%'; im.style.height = '100%'; im.style.objectFit = 'cover'; im.alt = p.title || '';
      im.src = (s||'').trim() || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
      im.onerror = ()=>{ im.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='; im.style.opacity='0.4'; };
      wrap.appendChild(im); slides.appendChild(wrap);
    });
    if(imgs.length === 0){ const place = document.createElement('div'); place.style.width='100%'; place.style.height='100%'; place.style.display='flex'; place.style.alignItems='center'; place.style.justifyContent='center'; place.textContent='Изображение отсутствует'; slides.appendChild(place); }
    gallery.appendChild(slides);
    // controls
    if(imgs.length > 1){
      const prev = document.createElement('button'); prev.id='pg-prev'; prev.textContent='‹'; prev.style.position='absolute'; prev.style.left='8px'; prev.style.top='50%'; prev.style.transform='translateY(-50%)'; prev.style.zIndex=10;
      const next = document.createElement('button'); next.id='pg-next'; next.textContent='›'; next.style.position='absolute'; next.style.right='8px'; next.style.top='50%'; next.style.transform='translateY(-50%)'; next.style.zIndex=10;
      gallery.appendChild(prev); gallery.appendChild(next);
      let index = 0;
      // dots indicator
      const dots = document.createElement('div'); dots.id = 'pg-dots'; dots.style.position='absolute'; dots.style.bottom='8px'; dots.style.left='50%'; dots.style.transform='translateX(-50%)'; dots.style.display='flex'; dots.style.gap='6px'; dots.style.zIndex=12;
      const dotEls = [];
      for(let i=0;i<imgs.length;i++){ const d = document.createElement('button'); d.className='pg-dot'; d.style.width='8px'; d.style.height='8px'; d.style.borderRadius='50%'; d.style.border='0'; d.style.padding='0'; d.style.background='rgba(255,255,255,0.6)'; d.style.opacity='0.6'; d.dataset.i = String(i); d.addEventListener('click', ()=>{ index = i; update(); }); dots.appendChild(d); dotEls.push(d); }
      gallery.appendChild(dots);
      function update(){ slides.style.transform = `translateX(${-index * 100}%)`; dotEls.forEach((d,i)=> d.style.opacity = (i===index? '1' : '0.6')); }
      prev.addEventListener('click', ()=>{ index = (index - 1 + imgs.length) % imgs.length; update(); });
      next.addEventListener('click', ()=>{ index = (index + 1) % imgs.length; update(); });

      // touch / swipe support for mobile
      let touchStartX = 0, touchDeltaX = 0;
      slides.addEventListener('touchstart', (ev)=>{ if(ev.touches && ev.touches[0]) touchStartX = ev.touches[0].clientX; }, { passive:true });
      slides.addEventListener('touchmove', (ev)=>{ if(ev.touches && ev.touches[0]) touchDeltaX = ev.touches[0].clientX - touchStartX; }, { passive:true });
      slides.addEventListener('touchend', ()=>{ if(Math.abs(touchDeltaX) > 40){ if(touchDeltaX < 0) index = (index + 1) % imgs.length; else index = (index - 1 + imgs.length) % imgs.length; } touchDeltaX = 0; update(); });

      // Prevent overscroll bounce on iOS inside slides container
      slides.addEventListener('touchmove', function(e){
        const containerWidth = gallery.clientWidth || 1;
        const maxOffset = (imgs.length - 1) * containerWidth;
        const curOffset = -index * containerWidth + (touchDeltaX || 0);
        if((curOffset >= 0 && touchDeltaX > 0) || (Math.abs(curOffset) >= maxOffset && touchDeltaX < 0)){
          e.preventDefault();
        }
      }, { passive:false });
    }
    imgContainer.appendChild(gallery);
    // Attach keyboard (Escape) and overlay click handlers to ensure modal can be closed
    try{
      const vp = document.getElementById('view-product');
      if(vp){
        try{ if(__productModalKeyHandler) document.removeEventListener('keydown', __productModalKeyHandler); }catch(e){}
        try{ if(__productModalOverlayHandler) vp.removeEventListener('click', __productModalOverlayHandler); }catch(e){}
        __productModalKeyHandler = (ev)=>{ if(ev.key === 'Escape') closeProductModal(); };
        document.addEventListener('keydown', __productModalKeyHandler);
        __productModalOverlayHandler = (ev)=>{ if(ev.target === vp) closeProductModal(); };
        vp.addEventListener('click', __productModalOverlayHandler);
        // focus trap inside modal
        const focusableSelector = 'a[href], area[href], input:not([disabled]), button:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
        let prevFocus = document.activeElement;
        const focusables = Array.from(vp.querySelectorAll(focusableSelector));
        if(focusables.length) focusables[0].focus();
        const onKeyTab = (e)=>{
          if(e.key !== 'Tab') return;
          const f = focusables;
          if(!f.length) return;
          const idx = f.indexOf(document.activeElement);
          if(e.shiftKey){ // backward
            if(idx === 0){ e.preventDefault(); f[f.length-1].focus(); }
          } else {
            if(idx === f.length-1){ e.preventDefault(); f[0].focus(); }
          }
        };
        document.addEventListener('keydown', onKeyTab);
        // store handler so we can remove it on close
        __productModalFocusTrap = onKeyTab;
      }
    }catch(e){}
  }
  const priceEl = document.getElementById('product-price'); if(priceEl) priceEl.textContent = formatPrice(p.price || '');
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
  // buy button redirects to Telegram
  const pbuy = document.getElementById('product-buy'); if(pbuy){ pbuy.onclick = ()=> { if(window.TELEGRAM_CONTACT) window.open(window.TELEGRAM_CONTACT, '_blank'); else alert('Telegram контакт не установлен'); } }
}

// bind product detail controls (close, fav)
// Centralized close handler for product modal (ensures cleanup)
let __productModalKeyHandler = null;
let __productModalOverlayHandler = null;
let __productModalFocusTrap = null;
function closeProductModal(){
  showView('view-home');
  try{ unlockBodyScroll(); }catch(e){}
  try{ if(__productModalKeyHandler) { document.removeEventListener('keydown', __productModalKeyHandler); __productModalKeyHandler = null; } }catch(e){}
  try{ if(__productModalOverlayHandler){ const vp = document.getElementById('view-product'); vp && vp.removeEventListener('click', __productModalOverlayHandler); __productModalOverlayHandler = null; } }catch(e){}
  try{ if(__productModalFocusTrap){ document.removeEventListener('keydown', __productModalFocusTrap); __productModalFocusTrap = null; } }catch(e){}
}
document.getElementById('product-close')?.addEventListener('click', (ev)=>{ ev.stopPropagation(); closeProductModal(); });
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

// attach tab buttons
function setupTabs(products){
  document.querySelectorAll('.tab').forEach(b=>{
    b.addEventListener('click', ()=>{
      const target = b.dataset.tab; if(target) showView(target);
      if(target === 'view-profile') renderProfile();
      if(target === 'view-favorites') renderFavorites(products);
    });
  });
}

// attach buy button handlers after rendering products
function attachBuyHandlers(){
  document.querySelectorAll('.buy').forEach(btn=>{
    btn.onclick = (ev)=>{
      ev.stopPropagation();
      if(window.TELEGRAM_CONTACT) window.open(window.TELEGRAM_CONTACT, '_blank');
      else alert('Telegram контакт не установлен');
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
    if(!me){ 
      console.log('[Sync Favs] Not logged in, skipping server sync');
      return; // only sync for logged-in users
    }
    console.log('[Sync Favs] Syncing for user:', me.email);
    const res = await apiFetch('/api/favorites');
    if(!res || !res.ok){ 
      console.warn('[Sync Favs] Server returned status:', res ? res.status : 'null');
      return;
    }
    const rows = await res.json();
    console.log('[Sync Favs] Got from server:', rows);
    // rows may be array of {product_id} or legacy shapes; normalize
    const ids = rows.map(r => r.product_id || r.productId || (typeof r === 'string' ? r : null)).filter(Boolean);
    console.log('[Sync Favs] Normalized IDs:', ids);
    // replace local favorites with server-side favorites (server is source-of-truth for logged-in users)
    saveFavs(ids);
    console.log('[Sync Favs] Saved to local storage');
  }catch(e){ 
    console.error('[Sync Favs] Error:', e && e.message);
  }
}

// Migrate any locally-stored favorites into the server-side account (called on login)
async function migrateLocalFavsToServer(){
  try{
    const local = loadFavs(); if(!local || !local.length) return;
    const me = await checkCurrentUser(); if(!me) return;
    for(const pid of local){
      try{ await apiFetch('/api/favorites', { method: 'POST', body: { productId: pid } }); }catch(e){}
    }
    // after migration, refresh server favorites into local cache
    await syncFavsFromServer();
  }catch(e){}
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
      if(!me){ 
        console.log('[Fav Toggle] Not logged in, local only');
        return; // no-op
      }
      console.log('[Fav Toggle] Syncing with server:', { action: adding ? 'add' : 'remove', productId: id, user: me.email });
      if(adding){ 
        const res = await apiFetch('/api/favorites', { method: 'POST', body: { productId: id } });
        console.log('[Fav Toggle] Add response:', res ? res.status : 'null');
      }
      else { 
        const res = await apiFetch(`/api/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' });
        console.log('[Fav Toggle] Delete response:', res ? res.status : 'null');
      }
    }catch(e){ console.error('[Fav Toggle] Sync failed:', e && e.message); }
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
      try{ const currentUser = await checkCurrentUser(); if(currentUser) { console.log('User after login:', currentUser.email); try{ await migrateLocalFavsToServer(); await syncFavsFromServer(); renderFavorites(productsCache); }catch(e){} } }catch(e){}
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
  <div class="image">
    ${p.images && p.images[0] ? `<img src="${p.images[0]}" alt="${p.title}">` : ''}
  </div>
  <div class="card-info">
    <div class="price">${formatPrice(p.price)}</div>
    <div class="title">${p.title}</div>
    <button class="buy">Купить</button>
  </div>
`;

    // Safely add image with error handling
    const favImgWrap = card.querySelector('.image');
    favImgWrap.classList.add('skeleton'); // Add skeleton loading state
    const favImg = document.createElement('img');
    favImg.alt = p.title || '';
    const favSrc = (Array.isArray(p.images) && p.images[0]) || p.image || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    favImg.src = favSrc;
    // Handle image load
    favImg.onload = () => {
      favImgWrap.classList.remove('skeleton');
      favImg.classList.add('loaded');
    };
    favImg.onerror = ()=>{ 
      favImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='; 
      favImg.style.opacity = '0.4';
      favImgWrap.classList.remove('skeleton');
      favImg.classList.add('loaded');
    };
    favImgWrap.appendChild(favImg);
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

// Render user profile
async function renderProfile(){
  const el = document.getElementById('profile-content');
  if(!el) return;
  
  try{
    const user = await checkCurrentUser();
    if(!user){
      el.innerHTML = '<p style="padding:16px;color:#666">Регистрация и вход в аккаунт сейчас недоступны! <br>Все избранные товары будут храниться только на вашем устройстве. <br>По всем интересующим вопросам вы можете обратиться в тех.поддержку. Контакты вы найдёте на странице <a href="/contacts">контактов.</a></p>';
      return;
    }
    
    // Display user info
    const nameEl = document.getElementById('profile-name');
    const emailEl = document.getElementById('profile-email');
    const roleEl = document.getElementById('profile-role');
    
    if(nameEl) nameEl.textContent = user.name || 'Не указано';
    if(emailEl) emailEl.textContent = user.email || 'Не указано';
    if(roleEl) roleEl.textContent = user.role === 'admin' ? 'Администратор' : 'Пользователь';
    
    // Setup logout button
    const logoutBtn = document.getElementById('profile-logout');
    if(logoutBtn){
      logoutBtn.onclick = async ()=>{
        if(confirm('Вы уверены что хотите выйти?')){
          // Call server logout endpoint to clear session cookie
          try{
            await apiFetch('/auth/logout', { method: 'POST' });
          }catch(e){
            console.warn('Logout API call failed:', e && e.message);
          }
          // Clear local user and favorites
          clearUser();
          try{ localStorage.removeItem('ismart_favs_v1'); }catch(e){}
          // Reload to show login screen
          location.reload();
        }
      };
    }
  }catch(e){
    el.innerHTML = '<p style="padding:16px;color:#f66">Ошибка загрузки профиля.</p>';
    console.error('Profile render error:', e);
  }
}

function initializeInfiniteScroll(products, searchQuery = ''){
  // Reset pagination state
  currentPage = 0;
  isLoadingMore = false;
  hasMoreProducts = true;
  
  allFilteredProducts = getFilteredProducts(products, searchQuery);
  
  // Clear products container
  const el = document.getElementById('products');
  el.innerHTML = '';
  
  // Load and render first page
  loadMoreProducts();
}

function getFilteredProducts(products, searchQuery = ''){
  let filtered = (products || []).filter(p => selectedCategory === 'all' ? true : p.category === selectedCategory);
  if(searchQuery.trim()){
    const query = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(p =>
      (p.title && p.title.toLowerCase().includes(query)) ||
      (p.description && p.description.toLowerCase().includes(query))
    );
  }
  if(selectedCategory !== 'all'){
    filtered.sort((a,b)=> (b.priceNum || Number(b.price || 0)) - (a.priceNum || Number(a.price || 0)) );
  }
  return filtered;
}

async function loadMoreProducts(){
  if(isLoadingMore || !hasMoreProducts) return;
  isLoadingMore = true;
  
  const el = document.getElementById('products');
  let startIdx = currentPage * PRODUCTS_PER_PAGE;
  let endIdx = startIdx + PRODUCTS_PER_PAGE;

  // If we reached the end of loaded products, fetch next page from server
  if(endIdx > allFilteredProducts.length && serverHasMore && !serverLoading){
    serverLoading = true;
    try{
      const nextPage = serverPage + 1;
      const resp = await fetchProductsPage(nextPage);
      if(resp && Array.isArray(resp.products) && resp.products.length){
        serverPage = nextPage;
        productsCache = normalizeProducts(productsCache.concat(resp.products));
        productsCacheTime = Date.now();
      }
      serverHasMore = !!(resp && resp.hasMore);
    }catch(e){
      serverHasMore = false;
    }
    serverLoading = false;
    allFilteredProducts = getFilteredProducts(productsCache, currentSearchQuery);
    startIdx = currentPage * PRODUCTS_PER_PAGE;
    endIdx = startIdx + PRODUCTS_PER_PAGE;
  }

  const pageProducts = allFilteredProducts.slice(startIdx, endIdx);
  // Check if there are more products after this page or on the server
  hasMoreProducts = endIdx < allFilteredProducts.length || serverHasMore;
  if(pageProducts.length === 0){
    isLoadingMore = false;
    return;
  }
  
  const fragment = document.createDocumentFragment();
  let adCount = 0;
  
  pageProducts.forEach((p, pageIdx) => {
    const globalIdx = startIdx + pageIdx;
    const wrap = document.createElement('div');
    wrap.className = 'card-wrap';
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = p.id;
    card.innerHTML = `
      <div class="image"></div>
      <div class="footer">
        <div class="price">${formatPrice(p.price)}</div>
        <div class="title">${p.title}</div>
        <button class="buy">Купить</button>
      </div>
    `;
    // create image element with lazy loading
    const imgWrap = card.querySelector('.image');
    imgWrap.classList.add('skeleton'); // Add skeleton loading state
    const imgEl = document.createElement('img');
    imgEl.alt = p.title || '';
    // sanitize image src on client-side as an extra layer
    const src = (((Array.isArray(p.images) && p.images[0]) || p.image) || '').trim();
    if(!src || src === 'po' || src === '/po' || src.endsWith('/po')){
      imgEl.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
      imgEl.dataset.blocked = src;
      // Still show the image immediately as it's transparent placeholder
      imgWrap.classList.remove('skeleton');
      imgEl.classList.add('loaded');
    } else {
      // Use data-src for lazy loading instead of immediate loading
      imgEl.dataset.src = src;
      imgEl.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='; // transparent placeholder
      
      // Set up intersection observer for lazy loading this image
      if('IntersectionObserver' in window){
        const imgObserver = new IntersectionObserver((entries, observer) => {
          entries.forEach(entry => {
            if(entry.isIntersecting){
              const img = entry.target;
              if(img.dataset.src){
                img.src = img.dataset.src;
                img.onload = () => {
                  imgWrap.classList.remove('skeleton');
                  img.classList.add('loaded');
                };
                img.onerror = () => {
                  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
                  img.style.opacity = '0.4';
                  imgWrap.classList.remove('skeleton');
                  img.classList.add('loaded');
                };
                img.removeAttribute('data-src');
                observer.unobserve(img);
              }
            }
          });
        }, { rootMargin: '100px' }); // Start loading 100px before entering viewport
        imgObserver.observe(imgEl);
      } else {
        // Fallback for browsers without IntersectionObserver
        imgEl.src = src;
        imgEl.onload = () => {
          imgWrap.classList.remove('skeleton');
          imgEl.classList.add('loaded');
        };
      }
    }
    // Add error handler for failed image loads
    imgEl.onerror = ()=>{ 
      imgEl.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='; 
      imgEl.style.opacity = '0.4';
      imgWrap.classList.remove('skeleton');
      imgEl.classList.add('loaded');
    };
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
    fragment.appendChild(wrap);
    // staggered entrance with adjusted delay
    setTimeout(()=> wrap.classList.add('entered'), 30 * pageIdx);

    // Ad insertion inside product list removed to avoid misleading placement.
  });
  
  // Add sentinel element at the end for intersection observer
  if(hasMoreProducts){
    const sentinel = document.createElement('div');
    sentinel.className = 'load-more-sentinel';
    sentinel.style.height = '100px';
    fragment.appendChild(sentinel);
  }
  
  // Single DOM append for entire fragment
  el.appendChild(fragment);
  
  // attach handlers after render
  attachBuyHandlers();
  attachFavoriteHandlers();
  attachCardHandlers();
  
  // Setup intersection observer for the sentinel
  if(hasMoreProducts){
    setupLoadMoreObserver();
  }
  
  currentPage++;
  isLoadingMore = false;
}

function setupLoadMoreObserver(){
  // Clean up old observer
  if(loadMoreObserver){
    loadMoreObserver.disconnect();
  }
  
  const sentinel = document.querySelector('.load-more-sentinel');
  if(!sentinel) return;
  
  loadMoreObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting && hasMoreProducts && !isLoadingMore){
        loadMoreProducts();
      }
    });
  }, {
    rootMargin: '200px',
    threshold: 0
  });
  
  loadMoreObserver.observe(sentinel);
}

function renderProducts(products, searchQuery = ''){
  initializeInfiniteScroll(products, searchQuery);
}

function renderCategories(categories){
  const el = document.getElementById('categories');
  el.innerHTML = '';
  
  const fragment = document.createDocumentFragment();
  categories.forEach(c =>{
    const b = document.createElement('button');
    b.className = 'pill' + (c.id===selectedCategory? ' active':'');
    b.textContent = c.name;
    b.dataset.id = c.id;
    b.addEventListener('click', async ()=>{
      // toggle category: clicking same category again resets to 'all'
      if(selectedCategory === c.id){
        selectedCategory = 'all';
        document.querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));
        // reshuffle products for homepage randomness
        productsCache = normalizeProducts(productsCache);
        (function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } })(productsCache);
      } else {
        selectedCategory = c.id;
        document.querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));
        b.classList.add('active');
      }
      // re-render products with current search
      renderProducts(productsCache, currentSearchQuery);
    });
    fragment.appendChild(b);
  });
  el.appendChild(fragment); // Single DOM append for entire fragment
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
  
  // Setup image lazy loading
  setupImageLazyLoading();
  
  // fetch app config (Telegram contact, etc)
  await fetchConfig();
  
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
    // User not logged in — mandatory registration is suppressed.
    // To re-enable forced registration, call `showAuthModal('register')` here.
    console.log('User not logged in: registration modal suppressed');
  } else {
    console.log('User already logged in:', currentUser.email);
    // sync server-side favorites into local cache so UI reflects account data
    try{ await migrateLocalFavsToServer(); }catch(e){}
    try{ await syncFavsFromServer(); }catch(e){}
  }

  const [products, categories] = await Promise.all([fetchProducts(), fetchCategories()]);
  // normalize products and shuffle for randomized homepage
  let normalized = normalizeProducts(products || []);
  (function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } })(normalized);
  productsCache = normalized;
  productsCacheTime = Date.now();
  categoriesCache = categories;
  renderCategories(categories);
  renderProducts(productsCache);
  setupCarousel();
  setupTabs(productsCache);
  attachBuyHandlers();

  // Setup search functionality
  const searchInput = document.getElementById('search');
  if(searchInput){
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimeout);
      searchDebounceTimeout = setTimeout(() => {
        currentSearchQuery = e.target.value;
        renderProducts(productsCache, currentSearchQuery);
      }, 300); // 300ms debounce
    });
  }

  // Collapse ad container if no ad is filled
  try{
    const adSlot = document.getElementById('ads-slot');
    if(adSlot){
      const checkAd = ()=>{
        const ins = adSlot.querySelector('ins.adsbygoogle');
        const status = ins ? ins.getAttribute('data-ad-status') : null;
        if(status === 'unfilled'){
          adSlot.style.display = 'none';
        } else {
          adSlot.style.display = '';
        }
      };
      setTimeout(checkAd, 1500);
      const obs = new MutationObserver(checkAd);
      obs.observe(adSlot, { attributes: true, childList: true, subtree: true });
    }
  }catch(e){}
});

