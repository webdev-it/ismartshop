// admin.js — Admin panel UI + local fallback + API-sync helpers
(function(){
  const PRODUCTS_KEY = 'admin_products_v1';
  const CATS_KEY = 'admin_cats_v1';
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
    // Получаем пользователей из API (как в разделе БД)
    let users = [];
    try {
      const res = await apiFetch('/admin/db/users?limit=500');
      if(res.ok) users = await res.json();
    } catch(e) {}
    if(!users || !users.length) {
      // fallback на старый способ
      try { users = await loadUsers(); } catch(e) { users = []; }
    }
    const products = await loadProducts();
    $('#stat-users').textContent = users.length;
    $('#stat-products').textContent = products.length;
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
    await renderDashboard();
    await renderProducts();
    await renderCategories();
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
    const product = id ? products.find(x=>x.id===id) : { id: Date.now().toString(), title:'', price:'', images:[], category:'', description:'', colors:[] };
    const cats = await loadCategories();
    
    // Helper: Image uploader and cropper (multi-image)
    let selectedImages = Array.isArray(product.images) && product.images.length ? product.images.slice() : [];

    // Basic cropper modal: src (dataURL or URL), cb receives cropped dataURL or null
    function openCropperModal(src, cb){
      const modal = document.createElement('div');
      modal.style.position = 'fixed'; modal.style.left = 0; modal.style.top = 0; modal.style.right = 0; modal.style.bottom = 0; modal.style.zIndex = 2000; modal.style.background = 'rgba(0,0,0,0.6)'; modal.style.display='flex'; modal.style.alignItems='center'; modal.style.justifyContent='center';
      const card = document.createElement('div'); card.style.background='#fff'; card.style.padding='12px'; card.style.borderRadius='8px'; card.style.maxWidth='90vw'; card.style.maxHeight='90vh'; card.style.overflow='auto'; card.style.display='flex'; card.style.flexDirection='column'; card.style.gap='8px';
      const canvas = document.createElement('canvas'); canvas.style.maxWidth='80vw'; canvas.style.maxHeight='70vh'; canvas.style.border='1px solid #ddd'; canvas.style.cursor='crosshair';
      const info = document.createElement('div'); info.style.fontSize='12px'; info.style.color='#333'; info.textContent='Нарисуйте прямоугольник мышью, затем нажмите "Обрезать".';
      const btnRow = document.createElement('div'); btnRow.style.display = 'flex'; btnRow.style.gap = '8px'; btnRow.style.justifyContent = 'flex-end';
      const cancelBtn = document.createElement('button'); cancelBtn.textContent='Отмена';
      const cropBtn = document.createElement('button'); cropBtn.textContent='Обрезать';
      btnRow.appendChild(cancelBtn); btnRow.appendChild(cropBtn);
      card.appendChild(canvas); card.appendChild(info); card.appendChild(btnRow); modal.appendChild(card); document.body.appendChild(modal);

      const ctx = canvas.getContext('2d');
      const img = new Image(); img.crossOrigin = 'anonymous';
      let scale = 1;
      img.onload = ()=>{
        const maxW = Math.min(window.innerWidth * 0.8, img.width);
        const maxH = Math.min(window.innerHeight * 0.7, img.height);
        const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        scale = img.width / canvas.width;
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img, 0,0, canvas.width, canvas.height);
      };
      img.onerror = ()=>{ alert('Не удалось загрузить изображение для обрезки.'); closeModal(null); };
      img.src = src;

      // selection
      let sel = null; let dragging = false; let startX=0, startY=0;
      function redraw(){
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img, 0,0, canvas.width, canvas.height);
        if(sel){
          ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0,0,canvas.width,canvas.height);
          ctx.clearRect(sel.x, sel.y, sel.w, sel.h);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(sel.x+1, sel.y+1, sel.w-2, sel.h-2);
        }
      }
      function onMouseMove(e){ if(!dragging) return; const r = canvas.getBoundingClientRect(); const mx = e.clientX - r.left; const my = e.clientY - r.top; sel.x = Math.min(startX, mx); sel.y = Math.min(startY, my); sel.w = Math.abs(mx - startX); sel.h = Math.abs(my - startY); redraw(); }
      function onMouseUp(e){ if(!dragging) return; dragging = false; if(sel && sel.w>2 && sel.h>2) info.textContent = 'Выделено: ' + Math.round(sel.w*scale) + '×' + Math.round(sel.h*scale) + ' px'; else info.textContent='Нарисуйте прямоугольник мышью, затем нажмите "Обрезать".'; }
      canvas.addEventListener('mousedown', (e)=>{ const r = canvas.getBoundingClientRect(); startX = e.clientX - r.left; startY = e.clientY - r.top; dragging = true; sel = { x:startX, y:startY, w:1, h:1 }; redraw(); });
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);

      function closeModal(result){ try{ window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); }catch(e){} modal.remove(); cb && cb(result); }

      cancelBtn.addEventListener('click', ()=> closeModal(null));
      cropBtn.addEventListener('click', ()=>{
        if(!sel || sel.w<2 || sel.h<2){ return alert('Пожалуйста, выберите область обрезки.'); }
        const sx = Math.max(0, Math.round(sel.x * scale));
        const sy = Math.max(0, Math.round(sel.y * scale));
        const sw = Math.min(img.width - sx, Math.round(sel.w * scale));
        const sh = Math.min(img.height - sy, Math.round(sel.h * scale));
        const out = document.createElement('canvas'); out.width = sw; out.height = sh; const octx = out.getContext('2d');
        octx.drawImage(img, sx, sy, sw, sh, 0,0, sw, sh);
        const data = out.toDataURL('image/png');
        closeModal(data);
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

          leftBtn.addEventListener('click', ()=>{ if(idx>0){ const a=selectedImages[idx-1]; selectedImages[idx-1]=selectedImages[idx]; selectedImages[idx]=a; refreshList(); } });
          rightBtn.addEventListener('click', ()=>{ if(idx<selectedImages.length-1){ const a=selectedImages[idx+1]; selectedImages[idx+1]=selectedImages[idx]; selectedImages[idx]=a; refreshList(); } });
          delBtn.addEventListener('click', ()=>{ if(confirm('Удалить изображение?')){ selectedImages.splice(idx,1); refreshList(); } });
          cropBtn.addEventListener('click', ()=> openCropperModal(src, (cropped)=>{ if(cropped){ selectedImages[idx]=cropped; refreshList(); } }));

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
              selectedImages.splice(to,0,item);
              refreshList();
            }
          });
        });
        hiddenInput.value = JSON.stringify(selectedImages.slice(0,10));
      }

      uploadInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        if(!files.length) return;
        files.forEach(file=>{
          const reader = new FileReader();
          reader.onload = (evt) => {
            // preserve original file dataURL unless user crops it
            selectedImages.push(evt.target.result);
            refreshList();
          };
          reader.readAsDataURL(file);
        });
      });

      // Add from URL
      section.querySelector('#add-from-url').addEventListener('click', ()=>{
        const url = prompt('Вставьте ссылку на изображение');
        if(url) { selectedImages.push(url); refreshList(); }
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
    
    $('#cancel-product').addEventListener('click', ()=>{ wrap.innerHTML=''; });
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const fd = new FormData(form);
      let priceValue = fd.get('price').replace(/[^\d]/g, '');
      let imagesVal = [];
      try{ imagesVal = JSON.parse(fd.get('images') || '[]'); }catch(e){ imagesVal = []; }
      const updated = { id: product.id, title: fd.get('title'), price: priceValue, images: imagesVal, image: imagesVal[0] || '', category: fd.get('category'), description: fd.get('description'), colors: [] };
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
    $('#btn-refresh').addEventListener('click', ()=>{ renderDashboard(); renderProducts(); renderCategories(); loadAdminDBInfo(); loadAdminUsers(); });
    $('#btn-new-product').addEventListener('click', ()=> openProductForm());
    $('#btn-new-category').addEventListener('click', ()=> openCategoryForm());
    $('#admin-logout')?.addEventListener('click', ()=> doLogout());

    // DB action bindings
    $('#db-refresh-users')?.addEventListener('click', ()=> loadAdminUsers());
    $('#db-truncate-users')?.addEventListener('click', ()=> doDbTruncate());
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
