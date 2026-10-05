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

/* ------------------------------------------------------------------------
 * Kapak rafı "sonraki satır" düğmesi (2026-10-05, Nadir) — Flashy teması.
 * KAYNAK: sf425/scripts/language-set.js sonundaki aynı blok; yalnız üç seçici farklı.
 * Öğretmen tahtada parmakla kaydıramayabilir. Düğme her basışta rafı bir
 * sonraki kapak SATIRINA kaydırır. Son satırdan sonraki basış başa döner.
 *  - Satır: .books-row içindeki görünür .book-item'ların aynı üst konumu.
 *  - Düğme yalnız kapaklar 2+ satırdaysa VE sayfa kaydırılabiliyorsa görünür.
 *  - Pencere boyutu ya da raf içeriği değişince yeniden hesaplanır.
 *  - Konum: sağ alt. Sarı indirme düğmesi (#bk-dl) varsa onun ÜSTÜNDE.
 *  - Çevrimdışı pakette de aynı davranış (indirme düğmesi orada yok).
 * ---------------------------------------------------------------------- */
(function sonrakiSatirDugmesi() {
    if (window.__sonrakiSatirKuruldu) return;
    window.__sonrakiSatirKuruldu = true;

    var OK_ASAGI = '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">'
        + '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" '
        + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var OK_YUKARI = '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">'
        + '<path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.6" '
        + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    // Temaya göre değişen iki seçici. Flashy teması (web-proxy-modern/theme.js) aynı
    // kodun kopyasını kendi seçicileriyle taşır — davranış iki temada aynıdır.
    var KART_SECICI = '#bookGrid > .flashy-card';
    var UST_SECICI = '.topbar, header';
    var RAF_ID = 'bookGrid';
    var KENAR = 16;          // düğme ile ekran kenarı / indirme düğmesi arası
    var UST_PAY = 16;        // hedef satırın üstünde bırakılan boşluk
    var ESIK = 6;            // aynı satır sayılan üst konum farkı (px)

    var dugme = null;
    var sondaMi = false;
    var bekleyen = 0;

    function azHareket() {
        try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
    }

    /** Kaydırılan öğe: belge (html) ya da taşan bir iç kapsayıcı. */
    function kaydirici() {
        var adaylar = [document.querySelector('.app-container'), document.getElementById(RAF_ID)];
        for (var i = 0; i < adaylar.length; i++) {
            var el = adaylar[i];
            if (!el) continue;
            var oy = getComputedStyle(el).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 4) return el;
        }
        return document.scrollingElement || document.documentElement;
    }

    function belgeMi(el) {
        return el === document.scrollingElement || el === document.documentElement || el === document.body;
    }

    function konum(el) { return belgeMi(el) ? (window.scrollY || el.scrollTop || 0) : el.scrollTop; }
    function enFazla(el) {
        return belgeMi(el)
            ? Math.max(0, el.scrollHeight - window.innerHeight)
            : Math.max(0, el.scrollHeight - el.clientHeight);
    }

    /** Sabit/yapışkan üst çubuk varsa yüksekliği; yoksa 0. */
    function ustCubukPayi() {
        var pay = 0;
        var adaylar = document.querySelectorAll(UST_SECICI);
        for (var i = 0; i < adaylar.length; i++) {
            var s = getComputedStyle(adaylar[i]);
            if (s.position !== 'fixed' && s.position !== 'sticky') continue;
            var r = adaylar[i].getBoundingClientRect();
            if (r.top <= 1 && r.bottom > pay && r.height < window.innerHeight / 3) pay = r.bottom;
        }
        return pay;
    }

    /** Satırların kaydırıcı içindeki üst konumları (artan, tekil). */
    function satirlar(el) {
        var ogeler = document.querySelectorAll(KART_SECICI);
        var taban = belgeMi(el) ? 0 : el.getBoundingClientRect().top;
        var ust = konum(el);
        var liste = [];
        for (var i = 0; i < ogeler.length; i++) {
            var o = ogeler[i];
            if (o.offsetParent === null) continue;          // gizli kart
            var y = Math.round(o.getBoundingClientRect().top - taban + ust);
            var ayni = false;
            for (var j = 0; j < liste.length; j++) {
                if (Math.abs(liste[j] - y) <= ESIK) { ayni = true; break; }
            }
            if (!ayni) liste.push(y);
        }
        liste.sort(function (a, b) { return a - b; });
        return liste;
    }

    /**
     * Sonraki satırın kaydırma hedefi; yoksa null (başa dönülecek).
     * Kural: üstü görünen İLK satırı bul, hedef ondan SONRAKİ satırın üstüdür
     * (üst çubuk payı düşülür). Son satıra ya da kaydırma sonuna gelindiyse null.
     */
    function sonrakiHedef(el) {
        var simdi = konum(el);
        var tavan = enFazla(el);
        if (simdi >= tavan - 2) return null;
        var pay = ustCubukPayi() + UST_PAY;
        var s = satirlar(el);
        var ilkGorunen = -1;
        for (var i = 0; i < s.length; i++) {
            if (s[i] - pay >= simdi - 8) { ilkGorunen = i; break; }
        }
        if (ilkGorunen === -1 || ilkGorunen + 1 >= s.length) return null;
        return Math.min(Math.max(0, s[ilkGorunen + 1] - pay), tavan);
    }

    function konumla() {
        if (!dugme) return;
        var alt = KENAR + 8;
        // offsetParent position:fixed öğede hep null — görünürlük kutudan ölçülür.
        var indir = document.getElementById('bk-dl');
        if (indir) {
            var r = indir.getBoundingClientRect();
            if (r.height > 0 && r.width > 0 && getComputedStyle(indir).display !== 'none') {
                alt = Math.round(window.innerHeight - r.top + KENAR);
            }
        }
        dugme.style.bottom = alt + 'px';
    }

    function guncelle() {
        bekleyen = 0;
        if (!dugme) return;
        var el = kaydirici();
        var gorunur = satirlar(el).length >= 2 && enFazla(el) > 4;
        dugme.hidden = !gorunur;
        if (!gorunur) return;
        konumla();
        var son = sonrakiHedef(el) === null;
        if (son !== sondaMi || !dugme.firstChild) {
            sondaMi = son;
            dugme.innerHTML = son ? OK_YUKARI : OK_ASAGI;
            dugme.setAttribute('aria-label', son ? 'Başa dön' : 'Sonraki satır');
            dugme.title = son ? 'Başa dön' : 'Sonraki satır';
            dugme.classList.toggle('basa-don', son);
        }
    }

    function planla() {
        if (bekleyen) return;
        bekleyen = (window.requestAnimationFrame || setTimeout)(guncelle);
    }

    function kaydir() {
        var el = kaydirici();
        var hedef = sonrakiHedef(el);
        var top = hedef === null ? 0 : hedef;
        var davranis = azHareket() ? 'auto' : 'smooth';
        if (belgeMi(el)) window.scrollTo({ top: top, behavior: davranis });
        else el.scrollTo({ top: top, behavior: davranis });
        if (davranis === 'auto') planla();
    }

    function kur() {
        if (dugme || !document.body) return;
        dugme = document.createElement('button');
        dugme.type = 'button';
        dugme.id = 'sonrakiSatirBtn';
        dugme.className = 'sonraki-satir-btn';
        dugme.hidden = true;
        dugme.addEventListener('click', kaydir);   // Enter/Space: <button> yerel davranışı
        document.body.appendChild(dugme);

        window.addEventListener('scroll', planla, { passive: true });
        window.addEventListener('resize', planla);
        document.addEventListener('scroll', planla, { passive: true, capture: true });
        if (window.ResizeObserver) {
            var ro = new ResizeObserver(planla);
            ro.observe(document.documentElement);
            var raf = document.getElementById(RAF_ID);
            if (raf) ro.observe(raf);
        }
        if (window.MutationObserver) {
            var raf2 = document.getElementById(RAF_ID);
            if (raf2) new MutationObserver(planla).observe(raf2, { childList: true, subtree: true });
            // İndirme düğmesi (#bk-dl) sonradan eklenir; konumu ona göre kayar.
            new MutationObserver(planla).observe(document.body, { childList: true });
        }
        planla();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kur);
    else kur();
})();
