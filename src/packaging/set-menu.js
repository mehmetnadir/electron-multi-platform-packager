'use strict';
/**
 * K17 — SET kökünde "set menüsü" sayfası (yayıncı kaynağında YOKSA üretilir).
 *
 * NEDEN (2026-09-17, Pardus/ProBook'ta ÖLÇÜLDÜ — sf425 "Shall We 5 Set - Maarif Model"):
 * Yayıncının otomatik `KitapTekExe` exe'sinden çıkan SET build'inin KÖKÜNDE set menüsü
 * yok; kök `index.html` motorun kendi tek-kitap sayfasının kopyası (`<bundle>.main.js`).
 * Kökte `assets/` ve `classlibraries/` de yok (içerik `book1..bookN` altında) →
 * motor kökte kitap açmaya çalışıyor, konsol:
 *   "Error: ENOENT, assets not found in .../app.asar"
 *   "Uncaught (in promise) Error: ImWin32.dll dosyası okunamadı."
 * ve ekran sonsuz "…" (beyaz) kalıyor. Aynı hata Super Monsters 2 Set'te de üretildi;
 * motor bundle'ında set modu diye bir şey YOK (`set_app.config`/`setBook` geçmiyor) —
 * yani kök sayfanın menü olması ZORUNLU. Çalışan tek örnek (Flashy Grade 8, kaynak
 * Nadir'in kendi build'i) kökünde elle yazılmış menü + `assets2/` görselleri taşıyor.
 *
 * Bu modül K1 kararının ("paketleyici set menüsü/konfig ÜRETMEZ", 2026-09-09) ölçümle
 * gözden geçirilmiş hâlidir: menü YOKSA paket zaten açılmıyor. Bu yüzden:
 *   • Kökte ÖZEL menü varsa (motor imzası taşımayan index.html) → DOKUNULMAZ.
 *   • Yalnız motor kopyası olan kökte menü üretilir; orijinal sayfa SİLİNMEZ,
 *     `index-motor.yedek.html` olarak saklanır.
 *   • `app.config.js` ÜRETİLMEZ (K1'in asıl yasağı) — yalnız kök sayfası yazılır.
 *   • Kapı çevre değişkeniyle açılır (`EMPP_SET_MENU=1`); varsayılan KAPALI, çünkü
 *     üretim davranışını değiştirmek Nadir'in kararıdır.
 *
 * Görsel kaynağı iki katmanlı:
 *   1. Yayıncı `assets2/` ile geliyorsa (bookN-button.png / bookN.png / styles.css)
 *      onun kendi tasarımı kullanılır — Flashy'deki çalışan sayfanın iskeleti birebir.
 *   2. Gelmiyorsa (sf425 böyle) kendi kendine yeten sade menü: kapak = kitabın kendi
 *      `assets/<id>/thumbs/1.jpg`'i, başlık = verilen ad ya da "Kitap N".
 *
 * BOZARSAN: `set-menu.test.js` içindeki "özel menü korunur", "motor kopyası menüye
 * dönüşür", "assets2 varsa yayıncı tasarımı", "idempotent", "tek kitapta no-op"
 * testleri kırılır.
 */
const fs = require('fs-extra');
const path = require('path');
const { findSubBookDirs } = require('./sub-book-dirs');

// Üretilen sayfanın imzası — idempotentlik ve testler bunu arar.
const MENU_ISARETI = '<!-- empp-set-menu v1 -->';
const YEDEK_AD = 'index-motor.yedek.html';

/** Kök index.html motorun tek-kitap sayfasının kopyası mı? */
function motorKopyasiMi(html) {
  if (typeof html !== 'string' || !html) return false;
  if (html.includes(MENU_ISARETI)) return false;
  // Motor sayfası hash'li bundle çağırır: ./a8f43f74c72b65a3dd05.main.js
  return /src="\.?\/?[0-9a-f]{16,}\.main\.js"/i.test(html);
}

/** Kitabın kendi kapak küçük görselini bul (assets/<id>/thumbs/1.jpg). */
async function kapakYolu(rootPath, bookDir) {
  const assetsDir = path.join(rootPath, bookDir, 'assets');
  let ids = [];
  try {
    ids = (await fs.readdir(assetsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (e) {
    return null;
  }
  for (const id of ids) {
    for (const aday of [path.join('thumbs', '1.jpg'), path.join('thumbs', '1.png'),
      path.join('pages', '1.png'), path.join('pages', '1.jpg')]) {
      if (await fs.pathExists(path.join(assetsDir, id, aday))) {
        return [bookDir, 'assets', id, aday].join('/').replace(/\\/g, '/');
      }
    }
  }
  return null;
}

/**
 * Kitabın adını KAYNAKTAN çıkarır — paket dışında hiçbir veri kaynağı gerekmez.
 *
 * NEDEN: menüde "Kitap 1/2/3" yazmak öğretmene bir şey söylemiyor; kitap adı ise
 * yayıncının kendi `BookContent.xml`'inde `pdfUrl="pdf/SHALL-WE-5-REFERENCE-BOOK-2025.pdf"`
 * biçiminde duruyor (2026-09-17, sf425'te ölçüldü: book1 REFERENCE BOOK, book2 WORKBOOK).
 * Dosyanın yalnız ilk 8 KB'ı okunur — BookContent.xml 70 KB'a çıkabiliyor.
 */
async function kitapAdiCikar(rootPath, bookDir) {
  const assetsDir = path.join(rootPath, bookDir, 'assets');
  let ids = [];
  try {
    ids = (await fs.readdir(assetsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (e) {
    return null;
  }
  for (const id of ids) {
    const xml = path.join(assetsDir, id, 'data', 'BookContent.xml');
    let bas = '';
    try {
      const fd = await fs.open(xml, 'r');
      const tampon = Buffer.alloc(8192);
      const { bytesRead } = await fs.read(fd, tampon, 0, 8192, 0);
      await fs.close(fd);
      bas = tampon.slice(0, bytesRead).toString('utf8');
    } catch (e) {
      continue;
    }
    const m = /pdfUrl="[^"]*?\/?([^"/]+)\.pdf"/i.exec(bas);
    if (!m) continue;
    const ad = m[1].replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!ad) continue;
    return ad.split(' ')
      .map((k) => (/^\d+$/.test(k) ? k : k.charAt(0) + k.slice(1).toLowerCase()))
      .join(' ');
  }
  return null;
}

/** Yayıncının assets2 tasarımı bu kitap için tam mı? */
async function assets2Varligi(rootPath, bookDir) {
  const a2 = path.join(rootPath, 'assets2');
  const buton = path.join(a2, `${bookDir}-button.png`);
  const kapak = path.join(a2, `${bookDir}.png`);
  return {
    buton: (await fs.pathExists(buton)) ? `assets2/${bookDir}-button.png` : null,
    kapak: (await fs.pathExists(kapak)) ? `assets2/${bookDir}.png` : null,
  };
}

function kacis(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Yayıncı tasarımlı menü (assets2 mevcut) — Flashy'deki çalışan iskeletin aynısı. */
function yayinciMenusu(kitaplar, opts) {
  const logo = opts.logo ? `<div id="logo"><img src="${kacis(opts.logo)}" alt="Logo"></div>` : '';
  const butonlar = kitaplar.map((k) => (
    `        <div class="buttons"><img class="icon">\n` +
    `          <a href="${kacis(k.dir)}/index.html"><img id="${kacis(k.dir)}" ` +
    `src="${kacis(k.buton)}" class="button" alt="${kacis(k.ad)}"></a>\n` +
    '        </div>'
  )).join('\n');
  const kapaklar = kitaplar.filter((k) => k.kapak).map((k) => (
    `        <div class="covers"><img src="${kacis(k.kapak)}" class="cover" ` +
    `data-url="${kacis(k.dir)}/index.html"></div>`
  )).join('\n');
  return `${MENU_ISARETI}
<!DOCTYPE html>
<html lang="tr">
<head><script src="empp-fs-shim.js"></script>
  <meta charset="utf-8">
  <link rel="stylesheet" type="text/css" href="assets2/styles.css">
</head>
<body>
  <div id="container">
    <div id="left">
      ${logo}
      <div class="book-buttons">
${butonlar}
      </div>
    </div>
    <div id="right">
      <div class="book-covers">
${kapaklar}
      </div>
    </div>
    <div id="right2"></div>
  </div>
</body>
</html>
`;
}

/** Kendi kendine yeten sade menü (assets2 yok) — kapaklar kitabın kendi thumbs'ından. */
function sadeMenu(kitaplar, opts) {
  const baslik = kacis(opts.appName || 'Akıllı Tahta');
  const kartlar = kitaplar.map((k, i) => {
    const gorsel = k.kapak
      ? `<img src="${kacis(k.kapak)}" alt="${kacis(k.ad)}">`
      : `<div class="yok">${i + 1}</div>`;
    return `      <a class="kart" href="${kacis(k.dir)}/index.html">${gorsel}` +
      `<span>${kacis(k.ad)}</span></a>`;
  }).join('\n');
  return `${MENU_ISARETI}
<!DOCTYPE html>
<html lang="tr">
<head><script src="empp-fs-shim.js"></script>
  <meta charset="utf-8">
  <title>${baslik}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 16px/1.4 system-ui, "Segoe UI", Roboto, sans-serif;
      background: #f4f5f7; color: #1d2330; display: flex; flex-direction: column;
      min-height: 100vh; }
    header { padding: 28px 32px 8px; }
    header h1 { margin: 0; font-size: 26px; font-weight: 650; }
    main { flex: 1; display: flex; flex-wrap: wrap; gap: 28px; align-content: flex-start;
      padding: 24px 32px 40px; }
    .kart { width: 220px; text-decoration: none; color: inherit; background: #fff;
      border: 1px solid #dfe3ea; border-radius: 10px; overflow: hidden;
      display: flex; flex-direction: column; transition: transform .12s, box-shadow .12s; }
    .kart:hover { transform: translateY(-3px); box-shadow: 0 8px 22px rgba(20,30,60,.14); }
    .kart img { width: 100%; aspect-ratio: 3/4; object-fit: cover; display: block;
      background: #e9edf3; }
    .kart .yok { width: 100%; aspect-ratio: 3/4; display: flex; align-items: center;
      justify-content: center; font-size: 48px; color: #93a0b5; background: #e9edf3; }
    .kart span { padding: 12px 14px; font-weight: 600; }
  </style>
</head>
<body>
  <header><h1>${baslik}</h1></header>
  <main>
${kartlar}
  </main>
</body>
</html>
`;
}

/**
 * SET kökünde menü sayfasını garantiler.
 *
 * @param {string} rootPath  Çalışma kopyasının kökü (build içeriği)
 * @param {{ appName?: string, titles?: Record<string,string>, force?: boolean }} [opts]
 * @returns {Promise<{action: string, books: string[], mode?: string}>}
 *   action: 'disabled' | 'not-a-set' | 'custom-menu-kept' | 'already-generated'
 *         | 'generated' | 'no-root-index'
 */
async function ensureSetMenu(rootPath, opts = {}) {
  const acik = opts.force === true || process.env.EMPP_SET_MENU === '1';
  if (!acik) return { action: 'disabled', books: [] };

  const bookDirs = await findSubBookDirs(rootPath, { maxDepth: 2 });
  if (bookDirs.length === 0) return { action: 'not-a-set', books: [] };

  const kokIndex = path.join(rootPath, 'index.html');
  let mevcut = null;
  try {
    mevcut = await fs.readFile(kokIndex, 'utf8');
  } catch (e) {
    mevcut = null;
  }
  if (mevcut && mevcut.includes(MENU_ISARETI)) {
    return { action: 'already-generated', books: bookDirs };
  }
  if (mevcut && !motorKopyasiMi(mevcut)) {
    // Yayıncının/Nadir'in kendi set menüsü — dokunulmaz (Flashy 59480 vakası).
    return { action: 'custom-menu-kept', books: bookDirs };
  }

  const kitaplar = [];
  let hepsindeAssets2 = true;
  for (let i = 0; i < bookDirs.length; i += 1) {
    const dir = bookDirs[i];
    const a2 = await assets2Varligi(rootPath, dir);
    if (!a2.buton) hepsindeAssets2 = false;
    kitaplar.push({
      dir,
      ad: (opts.titles && opts.titles[dir])
        || (await kitapAdiCikar(rootPath, dir))
        || `Kitap ${i + 1}`,
      buton: a2.buton,
      kapak: a2.kapak || (await kapakYolu(rootPath, dir)),
    });
  }

  const styles2 = await fs.pathExists(path.join(rootPath, 'assets2', 'styles.css'));
  const mode = hepsindeAssets2 && styles2 ? 'assets2' : 'sade';
  const logo = (await fs.pathExists(path.join(rootPath, 'assets2', 'logo.png')))
    ? 'assets2/logo.png' : null;
  const html = mode === 'assets2'
    ? yayinciMenusu(kitaplar, { logo })
    : sadeMenu(kitaplar, { appName: opts.appName });

  // Orijinal motor sayfası SİLİNMEZ — yedeklenir (geri alma + kanıt).
  if (mevcut != null) {
    const yedek = path.join(rootPath, YEDEK_AD);
    if (!await fs.pathExists(yedek)) await fs.writeFile(yedek, mevcut, 'utf8');
  }
  await fs.writeFile(kokIndex, html, 'utf8');
  return { action: mevcut == null ? 'no-root-index' : 'generated', books: bookDirs, mode };
}

module.exports = { ensureSetMenu, motorKopyasiMi, kitapAdiCikar, MENU_ISARETI, YEDEK_AD };
