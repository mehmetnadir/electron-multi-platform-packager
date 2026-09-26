'use strict';
/**
 * Sayfanın İÇİNDE koşan DOM yoklaması — `executeJavaScript` ile metin olarak enjekte
 * edilir, bu yüzden KENDİ KENDİNE YETER (dış değişken, require YOK).
 *
 * Döndürdüğü şey ham ölçümdür; karar `../olcutler.js` içindedir.
 *
 * Kart tanıma (menü türünden bağımsız, üç biçim ölçüldü):
 *   • Web-Z kabuğu (sf425 teması, `scripts/language-set.js`): `.book-item[data-book-id]`
 *     ve gruplar için `.book-item.book-group` (geri düğmesi `.book-group-back` sayılmaz).
 *   • Yayıncı / sade menü (`set-menu.js`): `a[href]`, `[data-url]`, `[onclick]` içinde
 *     `bookN/` yolu → kitap başına TEK kart (buton + kapak aynı kitabı gösterir).
 * Motor kitaplığı: tek kitap paketinde okuyucu yerine kitap rafı açılırsa dikey kapak
 * görselleri (<img> ya da arka plan görselli kutu) `kapaklar` olarak döner (ileri adım
 * bunlardan birine tıklar).
 * Yükleniyor göstergesi: okuyucunun `#loader-root.loading` / `.lds-ellipsis` "…"
 * ekranı, Web-Z `#loadingOverlay`, ve görünür "yükleniyor / açılıyor / güncelleniyor"
 * metni. Görünürlük `checkVisibility` (opaklık + visibility) + ekranda alan ile ölçülür.
 */
function domYokla() {
  const gorunur = (el) => {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    if (typeof el.checkVisibility === 'function') {
      const secenek = {
        checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true,
      };
      if (!el.checkVisibility(secenek)) return false;
    } else {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
    return true;
  };
  const merkez = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(Math.max(1, Math.min(innerWidth - 2, r.left + r.width / 2))),
      y: Math.round(Math.max(1, Math.min(innerHeight - 2, r.top + r.height / 2))),
    };
  };

  // --- Kartlar -------------------------------------------------------------
  const webz = [];
  document.querySelectorAll('.book-item').forEach((el, i) => {
    if (el.classList.contains('book-group-back')) return;
    const id = el.getAttribute('data-book-id');
    const grup = el.classList.contains('book-group');
    if (!id && !grup) return;
    if (!gorunur(el)) return;
    const hedef = el.querySelector('.book-cover') || el;
    webz.push({
      anahtar: id ? `webz:${id}` : `grup:${i}`,
      tip: grup ? 'webz-grup' : 'webz',
      metin: (el.innerText || '').trim().slice(0, 80),
      secici: id ? `.book-item[data-book-id="${id}"]` : null,
      ...merkez(hedef),
    });
  });
  const yolDeseni = /(?:^|[/'"(\s])(book\d+)\/(?:index\.html)?/i;
  const yolKartlari = new Map();
  document.querySelectorAll('a[href], [data-url], [onclick]').forEach((el) => {
    const deger = [el.getAttribute('href'), el.getAttribute('data-url'), el.getAttribute('onclick')]
      .filter(Boolean).join(' ');
    const m = yolDeseni.exec(deger);
    if (!m) return;
    const kitap = m[1].toLowerCase();
    if (yolKartlari.has(kitap) || !gorunur(el)) return;
    yolKartlari.set(kitap, {
      anahtar: `yol:${kitap}`,
      tip: 'yol',
      kitap,
      metin: (el.innerText || el.getAttribute('alt') || '').trim().slice(0, 80),
      ...merkez(el),
    });
  });
  const yol = [...yolKartlari.values()];
  const kartlar = webz.length >= yol.length ? webz : yol;

  // --- Yükleniyor göstergeleri ---------------------------------------------
  const yukleniyor = [];
  const seciciler = ['#loader-root.loading .lds-ellipsis', '.lds-ellipsis', '#loadingOverlay',
    '.loading-overlay.active', '.loading-overlay.show'];
  for (const s of seciciler) {
    for (const el of document.querySelectorAll(s)) {
      if (gorunur(el)) { yukleniyor.push(`seçici:${s}`); break; }
    }
  }
  const metinDeseni = /(yükleniyor|loading\b|kitap açılıyor|açılıyor\s*\.|güncelleniyor)/i;
  if (document.body) {
    const yurutucu = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let dugum;
    let sayac = 0;
    while ((dugum = yurutucu.nextNode()) && sayac < 20000) {
      sayac += 1;
      const t = (dugum.nodeValue || '').trim();
      if (t.length > 60 || !metinDeseni.test(t)) continue;
      const ebeveyn = dugum.parentElement;
      if (ebeveyn && gorunur(ebeveyn)) { yukleniyor.push(`metin:${t}`); break; }
    }
  }

  // --- Okuyucu sayfa izi (bilgi + kitap aşaması kararı) --------------------
  let sayfaGorseli = 0;
  document.querySelectorAll('img').forEach((img) => {
    const src = img.currentSrc || img.src || '';
    if (/\/(pages|pages2x)\/[^/]+\.(png|jpe?g|webp)/i.test(src) && img.complete
      && img.naturalWidth > 0 && gorunur(img)) sayfaGorseli += 1;
  });
  let tuval = 0;
  document.querySelectorAll('canvas').forEach((c) => {
    if (c.width >= 200 && c.height >= 200 && gorunur(c)) tuval += 1;
  });
  let arkaPlanSayfa = 0;
  document.querySelectorAll('[style*="pages/"]').forEach((el) => { if (gorunur(el)) arkaPlanSayfa += 1; });

  // --- Motor kitaplığı kapakları (tek kitap paketinde okuyucu yerine raf) ---
  // MEÇ çok kitaplı motor paketi (73714) kökte sınıf/ders rafı gösterir; sayfa ancak bir
  // kapağa dokununca çizilir. Aday: görünür, yüklenmiş, dikey (kitap oranlı) görsel.
  // Tıklanabilsin diye aday işaretlenir (data-empp-kapak) — sayfaya başka dokunulmaz.
  // İki biçim ölçüldü: <img> kapak ve arka plan görselli kutu (BES 74451 motor rafı:
  // `<div style="background-image:url(assets/72858/kapak.jpg)">`, <img> yok).
  const kapakAdaylari = [];
  const kitapOranli = (r) => {
    const oran = r.height / Math.max(1, r.width);
    return r.width >= 80 && r.height >= 110 && oran >= 1.05 && oran <= 1.9;
  };
  document.querySelectorAll('[data-empp-kapak]').forEach((el) => el.removeAttribute('data-empp-kapak'));
  document.querySelectorAll('img').forEach((img) => {
    if (!img.complete || !img.naturalWidth || !gorunur(img)) return;
    const r = img.getBoundingClientRect();
    if (!kitapOranli(r)) return;
    kapakAdaylari.push({ el: img, x: r.left, y: r.top, w: r.width, h: r.height });
  });
  let taranan = 0;
  for (const el of document.querySelectorAll('div,span,a,button,li,figure')) {
    if ((taranan += 1) > 5000) break;
    const bg = getComputedStyle(el).backgroundImage || '';
    // İlk katman görsel olmalı (salt gradyan zemin kapak değildir). URL'nin İÇİNDE
    // "gradient" geçebilir (SVG linearGradient) — yalnız baştaki katman denetlenir.
    if (!/^url\(/i.test(bg) || !gorunur(el)) continue;
    const r = el.getBoundingClientRect();
    if (!kitapOranli(r)) continue;
    kapakAdaylari.push({ el, x: r.left, y: r.top, w: r.width, h: r.height });
  }
  kapakAdaylari.sort((a, b) => (Math.round(a.y / 40) - Math.round(b.y / 40)) || (a.x - b.x));
  const kapaklar = kapakAdaylari.slice(0, 20).map((k, i) => {
    k.el.setAttribute('data-empp-kapak', String(i));
    return {
      anahtar: `kapak:${i}`,
      tip: 'kapak',
      secici: `[data-empp-kapak="${i}"]`,
      metin: (k.el.getAttribute('alt') || k.el.getAttribute('title')
        || (k.el.closest('[title]') && k.el.closest('[title]').getAttribute('title')) || '').slice(0, 80),
      x: Math.round(k.x + k.w / 2),
      y: Math.round(k.y + k.h / 2),
    };
  });

  return {
    url: location.href,
    kapaklar,
    baslik: document.title,
    readyState: document.readyState,
    kartSayisi: kartlar.length,
    kartlar,
    kartBicimleri: { webz: webz.length, yol: yol.length },
    yukleniyor,
    sayfaGorseli,
    tuval,
    arkaPlanSayfa,
    gorunurMetin: document.body ? (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400) : '',
    genislik: innerWidth,
    yukseklik: innerHeight,
  };
}

module.exports = { domYokla };
