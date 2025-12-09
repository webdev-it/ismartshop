// script.js — inject products and handle carousel

const sampleProducts = [
  { id: '1', title: 'iPhone 17 Pro Max', price: '109 000 $', image: 'https://picsum.photos/600/400?random=1', category: 'phones', description: 'iPhone 17 Pro Max на 256ГБ, 512ГБ и 1ТБ', colors: ['Белый','Синий','Красный','Оранжевый'] },
  { id: '2', title: 'iPhone 15 Pro', price: '94 000 $', image: 'https://picsum.photos/600/400?random=2', category: 'phones', description: 'Мощный смартфон с отличной камерой', colors: ['Белый','Черный'] },
  { id: '3', title: 'iPhone 14', price: '79 000 $', image: 'https://picsum.photos/600/400?random=3', category: 'phones', description: 'Сбалансированная модель для повседневного использования', colors: ['Черный','Серый'] },
  { id: '4', title: 'iPhone SE', price: '49 000 $', image: 'https://picsum.photos/600/400?random=4', category: 'phones', description: 'Компактный и доступный вариант', colors: ['Белый','Черный'] },
  { id: '5', title: 'Airpods Pro', price: '30 000 $', image: 'https://picsum.photos/600/400?random=5', category: 'audio', description: 'Шумоподавляющие наушники', colors: ['Белый'] }
];

const sampleCategories = [
  { id: 'all', name: 'Все' },
  { id: 'phones', name: 'Смартфоны' },
  { id: 'audio', name: 'Аксессуары' }
];

let selectedCategory = 'all';

async function fetchProducts(){
  try{
    const res = await fetch('/api/products');
    if(!res.ok) throw new Error('no api');
    const data = await res.json();
    return data;
  }catch(e){
    // fallback to sample
    return sampleProducts;
  }
}

async function fetchCategories(){
  try{
    const res = await fetch('/api/categories');
    if(!res.ok) throw new Error('no api');
    const data = await res.json();
    return data;
  }catch(e){
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
    const msg = {from:'user', text, at: Date.now()};
    appendMessage(productId, msg);
    // render
    const d = document.createElement('div'); d.className = 'msg user'; d.textContent = text; messagesEl.appendChild(d);
    input.value = '';
    messagesEl.scrollTop = messagesEl.scrollHeight;
    // update chat list preview
    const lastEl = document.getElementById(`last-${productId}`); if(lastEl) lastEl.textContent = text.slice(0,60);
    // optional: simulate admin reply after delay (demo only)
    setTimeout(()=>{
      const reply = {from:'admin', text: 'Спасибо! Мы свяжемся с вами в ближайшее время.', at: Date.now()};
      appendMessage(productId, reply);
      const rd = document.createElement('div'); rd.className = 'msg admin'; rd.textContent = reply.text; messagesEl.appendChild(rd);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      const lastEl2 = document.getElementById(`last-${productId}`); if(lastEl2) lastEl2.textContent = reply.text.slice(0,60);
    }, 1200);
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
  // buy button binds to open chat with prefilled message
  const pbuy = document.getElementById('product-buy'); if(pbuy){ pbuy.onclick = ()=> openChat(productId, `Здравствуйте! Я бы хотел купить ${p.title} .`); }
}

// bind product detail controls (close, fav)
document.getElementById('product-close')?.addEventListener('click', ()=>{ showView('view-home'); });
document.getElementById('product-fav')?.addEventListener('click', (e)=>{
  e.stopPropagation();
  const id = e.currentTarget.dataset.id; if(!id) return;
  // reuse toggleFav so behavior matches star overlay
  toggleFav(id);
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

function attachFavoriteHandlers(){
  document.querySelectorAll('.fav-btn').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      const id = btn.dataset.id;
      toggleFav(id);
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

// --- Simple client-side auth (no backend yet) ---
const USER_KEY = 'ismart_user_v1';
function loadUser(){ try{ return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }catch(e){return null} }
function saveUser(u){ localStorage.setItem(USER_KEY, JSON.stringify(u)); }
function clearUser(){ localStorage.removeItem(USER_KEY); }
function isLoggedIn(){ return !!loadUser(); }

function showAuthModal(mode){
  const modal = document.getElementById('auth-modal');
  if(!modal) return;
  modal.style.display = '';
  modal.setAttribute('aria-hidden','false');
  modal.classList.add('open');
  // blur background app content while modal is open
  document.querySelector('.app')?.classList.add('blurred');
  // switch tabs
  switchAuthTab(mode);
}

function hideAuthModal(){ const modal = document.getElementById('auth-modal'); if(!modal) return; modal.style.display = 'none'; modal.setAttribute('aria-hidden','true'); modal.classList.remove('open'); document.querySelector('.app')?.classList.remove('blurred'); }

// bind auth UI controls
// Tabs: if modal already open just switch tabs, otherwise open modal + select tab
document.getElementById('tab-login')?.addEventListener('click', (e)=>{
  e.preventDefault(); const modal = document.getElementById('auth-modal');
  if(modal && modal.getAttribute('aria-hidden') === 'false') { switchAuthTab('login'); }
  else { showAuthModal('login'); }
});
document.getElementById('tab-register')?.addEventListener('click', (e)=>{
  e.preventDefault(); const modal = document.getElementById('auth-modal');
  if(modal && modal.getAttribute('aria-hidden') === 'false') { switchAuthTab('register'); }
  else { showAuthModal('register'); }
});

// helper to switch tabs/forms without toggling modal visibility
function switchAuthTab(mode){
  document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f=> f.style.display = 'none');
  if(mode === 'register'){
    document.getElementById('tab-register')?.classList.add('active');
    document.getElementById('form-register').style.display = '';
    // focus first input in register
    setTimeout(()=> document.getElementById('reg-name')?.focus(), 10);
  } else {
    document.getElementById('tab-login')?.classList.add('active');
    document.getElementById('form-login').style.display = '';
    setTimeout(()=> document.getElementById('login-email')?.focus(), 10);
  }
}

document.getElementById('reg-submit')?.addEventListener('click', ()=>{
  const name = document.getElementById('reg-name')?.value?.trim();
  const email = document.getElementById('reg-email')?.value?.trim();
  const pass = document.getElementById('reg-password')?.value || '';
  if(!name || !email || !pass){ alert('Пожалуйста, заполните все поля'); return; }
  // save simple user object
  saveUser({name, email});
  hideAuthModal();
});

document.getElementById('login-submit')?.addEventListener('click', ()=>{
  const email = document.getElementById('login-email')?.value?.trim();
  const pass = document.getElementById('login-password')?.value || '';
  if(!email || !pass){ alert('Пожалуйста, заполните поля'); return; }
  const user = loadUser();
  if(user && user.email === email){ hideAuthModal(); } else { alert('Аккаунт не найден. Пожалуйста зарегистрируйтесь.'); showAuthModal('register'); }
});

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
    // favorite button
    const favBtn = document.createElement('button'); favBtn.className = 'fav-btn active'; favBtn.dataset.id = p.id; favBtn.innerHTML='★'; card.querySelector('.image').appendChild(favBtn);
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
        <div class="image"><img src="${p.image}" alt="${p.title}"/></div>
        <div class="footer">
          <div class="price">${p.price}</div>
          <div class="title">${p.title}</div>
          <button class="buy">Купить</button>
        </div>
      </div>
    `;
    // add favorite button overlay
    const favBtn = document.createElement('button');
    favBtn.className = 'fav-btn';
    favBtn.title = 'Добавить в избранное';
    favBtn.dataset.id = p.id;
    favBtn.innerHTML = '★';
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

// Init
(async function(){
  const [products, categories] = await Promise.all([fetchProducts(), fetchCategories()]);
  productsCache = products;
  categoriesCache = categories;
  renderCategories(categories);
  renderProducts(products);
  setupCarousel();
  setupTabs(products);
  renderChatList(products);
  attachBuyHandlers();
  // Note: do NOT auto-open auth modal on load. Modal remains hidden by default.
  // If needed, server-side logic can call `showAuthModal('login')` later.
})();
