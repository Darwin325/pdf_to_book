'use strict';

const DB_NAME = 'pdf-reader-db';
const STORE = 'pdfs';
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
  welcome: document.getElementById('welcome'),
  fontDown: document.getElementById('btn-font-down'),
  fontUp: document.getElementById('btn-font-up'),
  theme: document.getElementById('btn-theme'),
  mark: document.getElementById('btn-mark'),
  bookmarks: document.getElementById('btn-bookmarks'),
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

function loadPrefs() {
  try {
    return Object.assign({ theme: 'light', fontSize: 19, position: null, bookmarks: [] },
      JSON.parse(localStorage.getItem(PREFS_KEY)) || {});
  } catch (e) {
    return { theme: 'light', fontSize: 19, position: null, bookmarks: [] };
  }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
}

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function savePdf(buf, meta) {
  try {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ buf, meta }, 'current');
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) { console.warn('IndexedDB no disponible, el PDF no se guardará.', e); }
}
async function loadPdf() {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get('current');
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });
  } catch (e) { return null; }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    els.welcome.classList.remove('show');
    if (restore && prefs.position) {
      requestAnimationFrame(() => restorePosition(prefs.position, 'auto'));
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
    if (pageBlocks.length) {
      prefs.position = getPosition();
      savePrefs();
    }
  }, 400);
}
window.addEventListener('scroll', onScroll, { passive: true });
function persistNow() {
  if (pageBlocks.length) { prefs.position = getPosition(); savePrefs(); }
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
  const list = els.bookmarkList;
  list.innerHTML = '';
  if (!prefs.bookmarks.length) {
    list.innerHTML = '<li class="empty">Aún no hay marcadores. Toca “Marcar” para guardar esta página.</li>';
  } else {
    const sorted = [...prefs.bookmarks].sort((a, b) => a.page - b.page || a.ratio - b.ratio);
    sorted.forEach(bm => {
      const li = document.createElement('li');
      li.className = 'bm-item';
      const jump = document.createElement('button');
      jump.className = 'bm-jump';
      jump.innerHTML = `<span class="bm-page">Página ${bm.page}</span>` +
        (bm.note ? `<span class="bm-note">${escapeHtml(bm.note)}</span>` : '');
      jump.addEventListener('click', () => {
        restorePosition({ page: bm.page, ratio: bm.ratio }, 'smooth');
        closeDrawer();
      });
      const del = document.createElement('button');
      del.className = 'bm-del';
      del.innerHTML = TRASH;
      del.title = 'Eliminar marcador';
      del.addEventListener('click', e => {
        e.stopPropagation();
        prefs.bookmarks = prefs.bookmarks.filter(x => x.id !== bm.id);
        savePrefs();
        renderBookmarks();
      });
      li.appendChild(jump);
      li.appendChild(del);
      list.appendChild(li);
    });
  }
  const n = prefs.bookmarks.length;
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
  if (!pageBlocks.length) return;
  const pos = getPosition();
  const note = prompt('Nota para el marcador (opcional):', '');
  if (note === null) return;
  prefs.bookmarks.push({
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    page: pos.page,
    ratio: pos.ratio,
    note: note.trim(),
    createdAt: Date.now(),
  });
  savePrefs();
  renderBookmarks();
});

els.fileInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  currentFileName = file.name;
  els.bookTitle.textContent = file.name;
  els.bookTitle.title = file.name;
  const buf = await file.arrayBuffer();
  await savePdf(buf, { name: file.name, size: file.size, savedAt: Date.now() });
  prefs.position = null;
  savePrefs();
  await renderPdf(buf, false);
});

async function init() {
  applyTheme();
  applyFont();
  renderBookmarks();
  const saved = await loadPdf();
  if (saved && saved.buf) {
    currentFileName = (saved.meta && saved.meta.name) || 'Documento';
    els.bookTitle.textContent = currentFileName;
    els.bookTitle.title = currentFileName;
    await renderPdf(saved.buf, true);
  } else {
    els.welcome.classList.add('show');
  }
  updateProgress();
}

init();
