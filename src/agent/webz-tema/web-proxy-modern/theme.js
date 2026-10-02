// Web-proxy modern — set-based library + per-publisher PWA + preloader
let CFG = null;
const SHORT_CODE = (location.pathname.match(/\/go\/([^\/]+)/)?.[1]) || '';
let PWA_PROMPT = null;
let PRELOADER = null;

const PALETTE = [
  { c1: '#14b8a6', c2: '#06b6d4', emoji: '📘' },
  { c1: '#a855f7', c2: '#ec4899', emoji: '✏️' },
  { c1: '#f97316', c2: '#ef4444', emoji: '🎯' },
  { c1: '#6366f1', c2: '#14b8a6', emoji: '🏆' },
  { c1: '#0ea5e9', c2: '#a855f7', emoji: '🌊' },
  { c1: '#10b981', c2: '#f59e0b', emoji: '🌟' },
];

const I18N = {
  TR: { eyebrow: 'FLASHY' },
  EN: { eyebrow: 'FLASHY' },
};

// ── Config load ─────────────────────────────────
async function loadConfig() {
  try {
    const res = await fetch('config/settings.json?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    CFG = await res.json();
  } catch (e) {
    console.warn('[theme] config load failed:', e.message);
    CFG = { publisherName: 'Flashy', setTitle: 'Set', books: {} };
  }
  applyConfig();
  startPreloader();
  // Kütüphaneye eklendiyse "Ekli" göster
  reflectAddSetState();
}

function applyConfig() {
  const pubName = CFG.publisherName || 'Flashy';
  const setTitle = CFG.setTitle || pubName;

  const bt = document.getElementById('brandText');
  if (bt) bt.innerHTML = `<strong>${pubName}</strong>`;
  const fn = document.getElementById('footerName');
  if (fn) fn.textContent = `© ${pubName}`;
  const se = document.getElementById('setEyebrow');
  if (se) se.textContent = (pubName || 'FLASHY').toUpperCase();
  const sn = document.getElementById('setName');
  if (sn) sn.textContent = setTitle;

  const booksObj = CFG.books || {};
  const entries = Object.entries(booksObj);
  if (entries.length === 0) {
    const grid = document.getElementById('bookGrid');
    if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--ink-soft)">
      <i class="fa-solid fa-book fa-2x" style="opacity:.3;margin-bottom:12px"></i>
      <p>Kitaplar hazırlanıyor…</p></div>`;
    return;
  }

  const items = entries.map(([id, b], i) => {
    const p = PALETTE[i % PALETTE.length];
    return {
      id, title: b.title || id, sub: b.contentType || 'Kitap',
      c1: p.c1, c2: p.c2, emoji: p.emoji,
      cover: `images/${id}.png`,
      badge: 'KİTAP',
      _assetId: b.assetId,
    };
  });
  FlashyUI.renderCardGrid('bookGrid', items, (id, item) => openBook(id, item));
}

// ── Book open flow ─────────────────────────────
async function openBook(id, item) {
  FlashyUI.Loader.show(`${item.title} açılıyor…`);
  FlashyUI.Loader.set(30, 'Üniteler yükleniyor…');

  let units = [];
  try { units = await window.xmlParser.parseBookContent(item._assetId); }
  catch (e) { console.warn('[xmlParser]', e); }

  FlashyUI.Loader.set(100, `${units.length} ünite`);
  setTimeout(() => {
    FlashyUI.Loader.hide();
    if (units.length === 0) { openPage(id, item, null); return; }
    FlashyUI.Modal.open({
      title: item.title,
      subtitle: `${units.length} ünite`,
      cover: item.emoji,
      c1: item.c1, c2: item.c2,
      units,
      onUnit: (u) => { FlashyUI.Modal.close(); openPage(id, item, u); },
    });
  }, 300);
}

function openPage(bookId, item, unit) {
  const page = unit?.page || 1;
  showAcilisOrtusu(item && item.title);
  // Worker web-stream platform'u handleWebZSet içinde /book{n}/ → publisher origin'e proxy'ler
  location.href = `/go/${SHORT_CODE}/web-stream/${bookId}/index.html?page=${page}`;
}

// ── Açılış örtüsü ─────────────────────────
// Kitaba tıklayınca sayfa geçişi tamamlanana kadar görsel geri bildirim verir.
// Emniyet: 20 sn'de kendini kaldırır; geri tuşuyla bfcache'ten dönüşte
// (pageshow + persisted) de kaldırılır ki takılı kalmasın.
function showAcilisOrtusu(title) {
  try {
    if (document.getElementById('bk-acilis')) return;
    var reduceMotion = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduceMotion && !document.getElementById('bk-acilis-style')) {
      var st = document.createElement('style');
      st.id = 'bk-acilis-style';
      st.textContent = '@keyframes bkAcilisDon { to { transform: rotate(360deg); } }';
      document.head.appendChild(st);
    }
    var ov = document.createElement('div');
    ov.id = 'bk-acilis';
    ov.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:99999',
      'background:rgba(0,0,0,.85)', 'display:flex',
      'flex-direction:column', 'align-items:center', 'justify-content:center',
      'gap:16px', 'color:#fff', 'text-align:center', 'padding:24px',
    ].join(';'));
    var ring = document.createElement('div');
    ring.setAttribute('style', [
      'width:56px', 'height:56px', 'border-radius:50%',
      'border:4px solid rgba(255,255,255,.25)', 'border-top-color:#fff',
      reduceMotion ? '' : 'animation:bkAcilisDon .9s linear infinite',
    ].filter(Boolean).join(';'));
    ov.appendChild(ring);
    var label = document.createElement('div');
    label.textContent = 'Kitap açılıyor…';
    label.setAttribute('style', 'font-size:16px;font-weight:600');
    ov.appendChild(label);
    if (title) {
      var sub = document.createElement('div');
      sub.textContent = title;
      sub.setAttribute('style', 'font-size:13px;opacity:.75;max-width:280px');
      ov.appendChild(sub);
    }
    document.body.appendChild(ov);
    setTimeout(function () {
      var el = document.getElementById('bk-acilis');
      if (el) el.remove();
    }, 20000);
  } catch (e) { /* örtü gösterilemedi, akışı bozma */ }
}

window.addEventListener('pageshow', function (event) {
  if (!event.persisted) return;
  var ov = document.getElementById('bk-acilis');
  if (ov) ov.remove();
});

// ── Preloader ─────────────────────────────
function startPreloader() {
  if (!window.BookPreloader) return;
  PRELOADER = new BookPreloader();
  const books = Object.entries(CFG.books || {}).map(([dir, info]) => ({
    path: dir, assetId: info.assetId, title: info.title,
  }));
  PRELOADER.init(books).catch(e => console.warn('[preloader]', e));
}

// ── Library (set-based) ────────────────────
function getSetSnapshot() {
  const booksList = Object.entries(CFG.books || {}).map(([id, info], i) => {
    const p = PALETTE[i % PALETTE.length];
    return {
      id, title: info.title || id, sub: info.contentType || 'Kitap',
      c1: p.c1, c2: p.c2, emoji: p.emoji,
      cover: `images/${id}.png`,
      assetId: info.assetId,
    };
  });
  const firstBookCover = booksList[0]?.cover;
  return {
    setCode: SHORT_CODE,
    publisherName: CFG.publisherName || 'Flashy',
    setTitle: CFG.setTitle || 'Set',
    url: location.origin + `/go/${SHORT_CODE}/web-stream/`,
    cover: firstBookCover,
    c1: booksList[0]?.c1 || '#14b8a6',
    c2: booksList[0]?.c2 || '#06b6d4',
    books: booksList,
  };
}

function reflectAddSetState() {
  const btn = document.getElementById('addSetBtn');
  if (!btn) return;
  if (FlashyLibrary.hasSet(SHORT_CODE)) {
    btn.innerHTML = '<i class="fa-solid fa-check"></i> <span>Kütüphanede</span>';
    btn.classList.add('added');
  } else {
    btn.innerHTML = '<i class="fa-solid fa-heart-circle-plus"></i> <span>Kütüphaneme Ekle</span>';
    btn.classList.remove('added');
  }
}

function refreshLibraryUI() {
  const list = FlashyLibrary.read();
  const cnt = document.getElementById('libraryCount');
  if (cnt) { cnt.textContent = list.length; cnt.hidden = list.length === 0; }

  const body = document.getElementById('libraryBody');
  if (!body) return;
  if (list.length === 0) {
    body.innerHTML = `<div class="lib-empty">
      <i class="fa-regular fa-folder-open"></i>
      <p>Kütüphanen boş.</p>
      <small>"Kütüphaneme Ekle" butonuna basarak set ekle.</small>
    </div>`;
    return;
  }
  body.innerHTML = list.map(s => renderSetRow(s)).join('');
  body.querySelectorAll('.lib-set').forEach(row => {
    const setCode = row.dataset.set;
    const toggle = row.querySelector('.lib-set-header');
    const expand = row.querySelector('.lib-set-books');
    const openBtn = row.querySelector('[data-open]');
    const removeBtn = row.querySelector('[data-remove]');

    toggle.onclick = (e) => {
      if (e.target.closest('[data-open],[data-remove]')) return;
      row.classList.toggle('open');
    };
    openBtn.onclick = (e) => {
      e.stopPropagation();
      const url = openBtn.dataset.open;
      location.href = url;
    };
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      FlashyLibrary.removeSet(setCode);
      refreshLibraryUI();
      reflectAddSetState();
    };
    expand.querySelectorAll('[data-book]').forEach(bi => {
      bi.onclick = (e) => {
        e.stopPropagation();
        const [code, bookId] = bi.dataset.book.split('__');
        if (code === SHORT_CODE) {
          const it = findItemById(bookId);
          if (it) openBook(bookId, it);
        } else {
          location.href = bi.dataset.url;
        }
      };
    });
  });
}

function renderSetRow(s) {
  return `
    <div class="lib-set" data-set="${s.setCode}">
      <div class="lib-set-header">
        <div class="lib-thumb" style="--c1:${s.c1};--c2:${s.c2}">
          ${s.cover ? `<img src="${s.cover}" onerror="this.outerHTML='<span>📚</span>'"/>` : '<span>📚</span>'}
        </div>
        <div class="lib-meta">
          <p class="lib-title">${s.setTitle}</p>
          <p class="lib-sub">${s.publisherName} · ${s.books.length} kitap</p>
        </div>
        <button class="lib-caret" title="Aç/Kapat"><i class="fa-solid fa-chevron-down"></i></button>
        <button class="lib-open" data-open="${s.url}" title="Seti aç"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>
        <button class="lib-remove" data-remove="${s.setCode}" title="Kaldır"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="lib-set-books">
        ${s.books.map(b => `
          <div class="lib-book" data-book="${s.setCode}__${b.id}" data-url="${s.url}">
            <div class="lib-book-thumb" style="--c1:${b.c1};--c2:${b.c2}">
              ${b.cover ? `<img src="${s.setCode === SHORT_CODE ? b.cover : '#'}" onerror="this.outerHTML='<span>${b.emoji}</span>'"/>` : `<span>${b.emoji}</span>`}
            </div>
            <div class="lib-book-meta">
              <p>${b.title}</p>
              <small>${b.sub}</small>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function findItemById(id) {
  const info = (CFG.books || {})[id];
  if (!info) return null;
  const idx = Object.keys(CFG.books).indexOf(id);
  const p = PALETTE[idx % PALETTE.length];
  return {
    id, title: info.title || id, sub: info.contentType || 'Kitap',
    c1: p.c1, c2: p.c2, emoji: p.emoji, cover: `images/${id}.png`,
    _assetId: info.assetId,
  };
}

// ── Bindings ───────────────────────────────────
function bindUI() {
  document.getElementById('libraryBtn')?.addEventListener('click', () => {
    refreshLibraryUI();
    document.getElementById('libraryDrawer').hidden = false;
  });
  document.getElementById('libraryClose')?.addEventListener('click', () => {
    document.getElementById('libraryDrawer').hidden = true;
  });
  document.getElementById('libraryDrawer')?.addEventListener('click', (e) => {
    if (e.target.id === 'libraryDrawer') e.currentTarget.hidden = true;
  });

  // Kütüphaneme Ekle (set)
  document.getElementById('addSetBtn')?.addEventListener('click', async () => {
    const snap = getSetSnapshot();
    if (FlashyLibrary.hasSet(SHORT_CODE)) {
      // Zaten ekli — drawer'ı aç
      document.getElementById('libraryBtn')?.click();
      return;
    }
    FlashyLibrary.addSet(snap);
    reflectAddSetState();
    refreshLibraryUI();

    // PWA install hazırsa hemen tetikle (masaüstü kısayolu — yayıncı adı ile)
    if (PWA_PROMPT) {
      try {
        PWA_PROMPT.prompt();
        await PWA_PROMPT.userChoice;
        PWA_PROMPT = null;
        document.getElementById('pwaInstallBanner').hidden = true;
      } catch {}
    } else {
      // Prompt yoksa banner'ı göster
      const b = document.getElementById('pwaInstallBanner');
      if (b && !sessionStorage.getItem('pwa_dismissed')) b.hidden = false;
    }
  });

  // PWA install
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    PWA_PROMPT = e;
    if (!sessionStorage.getItem('pwa_dismissed')) {
      const banner = document.getElementById('pwaInstallBanner');
      if (banner) banner.hidden = false;
    }
  });
  const doInstall = async () => {
    if (PWA_PROMPT) {
      try {
        PWA_PROMPT.prompt();
        await PWA_PROMPT.userChoice;
        PWA_PROMPT = null;
        document.getElementById('pwaInstallBanner').hidden = true;
      } catch {}
      return;
    }
    // Prompt yok — manuel talimat modal'ı
    const modal = document.getElementById('installHelpModal');
    if (modal) modal.hidden = false;
  };
  document.getElementById('pwaInstallBtn')?.addEventListener('click', doInstall);
  document.getElementById('pwaInstallInline')?.addEventListener('click', doInstall);
  document.getElementById('installHelpClose')?.addEventListener('click', () => {
    document.getElementById('installHelpModal').hidden = true;
  });
  document.getElementById('installHelpModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'installHelpModal') e.currentTarget.hidden = true;
  });
  document.getElementById('pwaInstallDismiss')?.addEventListener('click', () => {
    document.getElementById('pwaInstallBanner').hidden = true;
    sessionStorage.setItem('pwa_dismissed', '1');
  });

  addEventListener('flashy-library-change', () => {
    refreshLibraryUI();
    reflectAddSetState();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  bindUI();
  refreshLibraryUI();
  await loadConfig();
  FlashyUI.initReveal();
  FlashyUI.initLang(I18N);
});
