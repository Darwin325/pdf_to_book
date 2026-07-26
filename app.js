'use strict';

const DB_NAME = 'pdf-reader-db';
const PREFS_KEY = 'reader:prefs';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS;

const els = {
  fileInput: document.getElementById('pdf-input'),
  toolbar: document.getElementById('toolbar'),
  reader: document.getElementById('reader'),
  loading: document.getElementById('loading'),
  progress: document.getElementById('progress-bar'),
  bookTitle: document.getElementById('book-title'),
  library: document.getElementById('library'),
  bookList: document.getElementById('book-list'),
  libEmpty: document.getElementById('lib-empty'),
  fontDown: document.getElementById('btn-font-down'),
  fontUp: document.getElementById('btn-font-up'),
  theme: document.getElementById('btn-theme'),
  mark: document.getElementById('btn-mark'),
  bookmarks: document.getElementById('btn-bookmarks'),
  libraryBtn: document.getElementById('btn-library'),
  badge: document.getElementById('bookmark-badge'),
  drawer: document.getElementById('drawer'),
  overlay: document.getElementById('drawer-overlay'),
  drawerClose: document.getElementById('drawer-close'),
  bookmarkList: document.getElementById('bookmark-list'),
};

const THEMES = ['light', 'sepia', 'dark'];
const ICONS = {
  light: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
  sepia: '<svg viewBox="0 0 24 24" class="ic"><path d="M5 3h9l5 5v11a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z"/><path d="M13 3v6h6"/><path d="M8 13h8M8 16h8"/></svg>',
  dark: '<svg viewBox="0 0 24 24" class="ic"><path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z"/></svg>',
};
const TRASH = '<svg viewBox="0 0 24 24" class="ic"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>';

let prefs = loadPrefs();
let pageBlocks = [];
let currentFileName = '';
let storageOk = true;

function loadPrefs() {
  const def = { theme: 'light', fontSize: 19, currentBookId: null, books: {} };
  try {
    return Object.assign(def, JSON.parse(localStorage.getItem(PREFS_KEY)) || {});
  } catch (e) {
    return def;
  }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
}
function bookState(id) {
  if (!prefs.books[id]) prefs.books[id] = { position: null, bookmarks: [] };
  return prefs.books[id];
}

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      const tx = r.transaction;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
      if (db.objectStoreNames.contains('pdfs')) {
        const old = tx.objectStore('pdfs').get('current');
        old.onsuccess = () => {
          const rec = old.result;
          if (rec && rec.buf) {
            const id = 'legacy-' + ((rec.meta && rec.meta.savedAt) || Date.now());
            tx.objectStore('meta').put({ id, name: (rec.meta && rec.meta.name) || 'Documento', addedAt: (rec.meta && rec.meta.savedAt) || Date.now() });
            tx.objectStore('blobs').put({ id, buf: rec.buf });
          }
        };
        db.deleteObjectStore('pdfs');
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { storageOk = false; rej(r.error); };
  });
}
async function saveBook(id, name, buf) {
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(['meta', 'blobs'], 'readwrite');
      tx.objectStore('meta').put({ id, name, addedAt: Date.now() });
      tx.objectStore('blobs').put({ id, buf });
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) { console.warn('IndexedDB no disponible, el libro no se guardará.', e); }
}
async function listBooks() {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const tx = db.transaction('meta', 'readonly');
      const req = tx.objectStore('meta').getAll();
      req.onsuccess = () => res((req.result || []).sort((a, b) => b.addedAt - a.addedAt));
      req.onerror = () => rej(req.error);
    });
  } catch (e) { return []; }
}
async function getMeta(id) {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const tx = db.transaction('meta', 'readonly');
      const req = tx.objectStore('meta').get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });
  } catch (e) { return null; }
}
async function getBlob(id) {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const tx = db.transaction('blobs', 'readonly');
      const req = tx.objectStore('blobs').get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });
  } catch (e) { return null; }
}
async function deleteBook(id) {
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(['meta', 'blobs'], 'readwrite');
      tx.objectStore('meta').delete(id);
      tx.objectStore('blobs').delete(id);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {}
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showStorageWarning() {
  els.libEmpty.textContent = 'No se pudo acceder al almacenamiento del navegador. Abre la página por http:// (no file://) para que los libros se guarden.';
}

let toastEl = null, toastTimer = null;
function showToast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

function applyTheme() {
  document.body.className = prefs.theme !== 'light' ? 'theme-' + prefs.theme : 'theme-light';
  els.theme.innerHTML = ICONS[prefs.theme] + '<span class="lbl">Tema</span>';
  els.theme.title = 'Tema: ' + prefs.theme;
}
function applyFont() {
  document.documentElement.style.setProperty('--font-size', prefs.fontSize + 'px');
}

function buildParagraphs(t) {
  let chunks = t.split(/\n\n+/).map(s => s.trim()).filter(Boolean);
  if (chunks.length <= 1) {
    const lines = t.split(/\n+/).map(s => s.trim()).filter(Boolean);
    return lines.length ? [lines.join(' ')] : [];
  }
  return chunks;
}

async function renderPdf(arrayBuffer, restore) {
  els.loading.style.display = 'block';
  els.reader.innerHTML = '';
  pageBlocks = [];
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      let lastY = null, text = '';
      tc.items.forEach(it => {
        if (lastY !== null && Math.abs(it.transform[5] - lastY) > 8) text += '\n';
        text += it.str + ' ';
        lastY = it.transform[5];
      });
      const block = document.createElement('div');
      block.className = 'page-block';
      block.id = 'page-' + i;
      block.dataset.page = i;
      const paras = buildParagraphs(text);
      block.innerHTML = paras.length
        ? paras.map(p => `<p>${escapeHtml(p)}</p>`).join('')
        : '<p></p>';
      const num = document.createElement('div');
      num.className = 'page-number';
      num.textContent = '— Página ' + i + ' —';
      block.appendChild(num);
      els.reader.appendChild(block);
      pageBlocks.push(block);
    }
    if (restore && prefs.currentBookId) {
      const st = bookState(prefs.currentBookId);
      if (st.position) requestAnimationFrame(() => restorePosition(st.position, 'auto'));
    }
    updateProgress();
  } catch (e) {
    console.error(e);
    alert('Ocurrió un error al leer el PDF.');
  } finally {
    els.loading.style.display = 'none';
  }
}

function getPosition() {
  const y = window.scrollY || document.documentElement.scrollTop;
  let page = pageBlocks.length ? +pageBlocks[0].dataset.page : 0;
  let ratio = 0;
  for (const b of pageBlocks) {
    const top = b.offsetTop, h = b.offsetHeight || 1;
    if (y + 4 >= top) {
      page = +b.dataset.page;
      ratio = (y - top) / h;
    } else break;
  }
  return { page, ratio: Math.max(0, Math.min(1, ratio)) };
}
function restorePosition(pos, behavior) {
  if (!pos) return;
  const b = pageBlocks.find(x => +x.dataset.page === pos.page) || pageBlocks[0];
  if (!b) return;
  window.scrollTo({ top: b.offsetTop + (pos.ratio || 0) * b.offsetHeight, behavior: behavior || 'auto' });
}

function updateProgress() {
  if (els.reader.style.display === 'none') { els.progress.style.width = '0'; return; }
  const h = document.documentElement.scrollHeight - window.innerHeight;
  const p = h > 0 ? (window.scrollY / h) * 100 : 0;
  els.progress.style.width = Math.min(100, Math.max(0, p)) + '%';
}

let scrollTimer = null;
function onScroll() {
  updateProgress();
  if (scrollTimer) return;
  scrollTimer = setTimeout(() => {
    scrollTimer = null;
    persistNow();
  }, 400);
}
window.addEventListener('scroll', onScroll, { passive: true });
function persistNow() {
  if (els.reader.style.display === 'none' || !pageBlocks.length || !prefs.currentBookId) return;
  bookState(prefs.currentBookId).position = getPosition();
  savePrefs();
}
window.addEventListener('beforeunload', persistNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) persistNow(); });

function changeFont(delta) {
  const pos = pageBlocks.length ? getPosition() : null;
  prefs.fontSize = Math.max(12, Math.min(32, prefs.fontSize + delta));
  applyFont();
  savePrefs();
  if (pos) requestAnimationFrame(() => restorePosition(pos, 'auto'));
}
els.fontUp.addEventListener('click', () => changeFont(2));
els.fontDown.addEventListener('click', () => changeFont(-2));

els.theme.addEventListener('click', () => {
  prefs.theme = THEMES[(THEMES.indexOf(prefs.theme) + 1) % THEMES.length];
  applyTheme();
  savePrefs();
});

function renderBookmarks() {
  const st = prefs.currentBookId ? (prefs.books[prefs.currentBookId] || { bookmarks: [] }) : { bookmarks: [] };
  const bms = st.bookmarks || [];
  const list = els.bookmarkList;
  list.innerHTML = '';
  if (!bms.length) {
    list.innerHTML = '<li class="empty">Aún no hay marcadores. Toca “Marcar” para guardar esta página.</li>';
  } else {
    const sorted = [...bms].sort((a, b) => a.page - b.page || a.ratio - b.ratio);
    sorted.forEach(bm => {
      const li = document.createElement('li');
      li.className = 'bm-item';
      const jump = document.createElement('button');
      jump.className = 'bm-jump';
      jump.innerHTML = `<span class="bm-page">Página ${bm.page}</span>` +
        (bm.note ? `<span class="bm-note">${escapeHtml(bm.note)}</span>` : '');
      jump.addEventListener('click', () => {
        const go = () => restorePosition({ page: bm.page, ratio: bm.ratio }, 'smooth');
        if (els.reader.style.display === 'none') openBook(prefs.currentBookId).then(go);
        else go();
        closeDrawer();
      });
      const del = document.createElement('button');
      del.className = 'bm-del';
      del.innerHTML = TRASH;
      del.title = 'Eliminar marcador';
      del.addEventListener('click', e => {
        e.stopPropagation();
        const s = bookState(prefs.currentBookId);
        s.bookmarks = s.bookmarks.filter(x => x.id !== bm.id);
        savePrefs();
        renderBookmarks();
      });
      li.appendChild(jump);
      li.appendChild(del);
      list.appendChild(li);
    });
  }
  const n = bms.length;
  els.badge.textContent = n;
  els.badge.style.display = n ? 'flex' : 'none';
}

function openDrawer() {
  renderBookmarks();
  els.drawer.classList.add('open');
  els.overlay.classList.add('show');
}
function closeDrawer() {
  els.drawer.classList.remove('open');
  els.overlay.classList.remove('show');
}
els.bookmarks.addEventListener('click', openDrawer);
els.drawerClose.addEventListener('click', closeDrawer);
els.overlay.addEventListener('click', closeDrawer);

els.mark.addEventListener('click', () => {
  if (els.reader.style.display === 'none' || !prefs.currentBookId) return;
  const pos = getPosition();
  const note = prompt('Nota para el marcador (opcional):', '');
  if (note === null) return;
  const st = bookState(prefs.currentBookId);
  st.bookmarks = st.bookmarks || [];
  st.bookmarks.push({
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    page: pos.page,
    ratio: pos.ratio,
    note: note.trim(),
    createdAt: Date.now(),
  });
  savePrefs();
  renderBookmarks();
});

async function openBook(id) {
  const rec = await getBlob(id);
  if (!rec) { alert('No se encontró el libro.'); return; }
  const meta = await getMeta(id);
  currentFileName = meta ? meta.name : 'Documento';
  els.bookTitle.textContent = currentFileName;
  els.bookTitle.title = currentFileName;
  prefs.currentBookId = id;
  savePrefs();
  els.library.classList.remove('show');
  els.reader.style.display = 'block';
  await renderPdf(rec.buf, true);
  renderBookmarks();
}

async function showLibrary() {
  persistNow();
  const books = await listBooks();
  els.reader.style.display = 'none';
  window.scrollTo(0, 0);
  els.progress.style.width = '0';
  els.library.classList.add('show');
  renderLibrary(books);
}
function renderLibrary(books) {
  const list = els.bookList;
  list.innerHTML = '';
  els.libEmpty.style.display = books.length ? 'none' : 'block';
  books.forEach(b => {
    const st = prefs.books[b.id] || { position: null, bookmarks: [] };
    const page = st.position ? st.position.page : null;
    const bmCount = (st.bookmarks || []).length;
    const meta = page
      ? `Pág. ${page}${bmCount ? ` · ${bmCount} marcador${bmCount > 1 ? 'es' : ''}` : ''}`
      : 'Sin empezar';
    const li = document.createElement('li');
    li.className = 'book-item';
    const open = document.createElement('button');
    open.className = 'book-open';
    open.innerHTML = `<span class="book-name">${escapeHtml(b.name)}</span><span class="book-meta">${meta}</span>`;
    open.addEventListener('click', () => openBook(b.id));
    const del = document.createElement('button');
    del.className = 'book-del';
    del.innerHTML = TRASH;
    del.title = 'Eliminar libro';
    del.addEventListener('click', async e => {
      e.stopPropagation();
      if (confirm(`¿Eliminar “${b.name}” de tu biblioteca?`)) {
        await deleteBook(b.id);
        if (prefs.books[b.id]) delete prefs.books[b.id];
        if (prefs.currentBookId === b.id) prefs.currentBookId = null;
        savePrefs();
        showLibrary();
      }
    });
    li.appendChild(open);
    li.appendChild(del);
    list.appendChild(li);
  });
}
els.libraryBtn.addEventListener('click', showLibrary);

els.fileInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const id = (crypto.randomUUID ? crypto.randomUUID() : 'b-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
  const buf = await file.arrayBuffer();
  await saveBook(id, file.name, buf);
  showToast(storageOk ? 'Libro guardado' : 'No se pudo guardar');
  prefs.currentBookId = id;
  if (!prefs.books[id]) prefs.books[id] = { position: null, bookmarks: [] };
  savePrefs();
  currentFileName = file.name;
  els.bookTitle.textContent = file.name;
  els.bookTitle.title = file.name;
  els.library.classList.remove('show');
  els.reader.style.display = 'block';
  await renderPdf(buf, true);
  renderBookmarks();
  e.target.value = '';
});

async function init() {
  applyTheme();
  applyFont();
  renderBookmarks();
  if (!storageOk) showStorageWarning();
  const books = await listBooks();
  if (prefs.position && !Object.keys(prefs.books).length) {
    const leg = books.find(b => b.id.startsWith('legacy-'));
    if (leg) {
      prefs.books[leg.id] = { position: prefs.position, bookmarks: prefs.bookmarks || [] };
      prefs.currentBookId = leg.id;
      delete prefs.position;
      delete prefs.bookmarks;
      savePrefs();
    }
  }
  await showLibrary();
}

init();
