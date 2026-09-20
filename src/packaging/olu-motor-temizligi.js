'use strict';

/**
 * ÖLÜ MOTOR TEMİZLİĞİ — index.html'den ULAŞILAMAYAN webpack çıktılarını atar.
 *
 * NEDEN (2026-09-19, sm4 ölçümü): yayıncı kabuğunda her alt-kitabın kökünde
 * 39–43 MB js/css var ama index.html'den ulaşılabilen yalnız ~2,5 MB. Webpack
 * içerik-hash'li çıktı yıllarca AYNI klasöre üst üste yazılmış; her kitapta
 * 13 ayrı `*.main.js` duruyor, index yalnız birini yüklüyor. Beş alt-kitapta
 * toplam 191,6 MB ölü ağırlık ölçüldü (book4: 61,1 MB → 23,9 MB).
 *
 * KANIT: book4'ün ulaşılmayan 125 dosyası karantinaya alındı, kitap Electron'da
 * AÇILDI — başlık, #root dolu, "UNIT 1 … 1/10", 5 görsel + 4 canvas, 70 istek.
 *
 * GÜVENLİK (üç katman, hepsi ATOMİK):
 *  1. Yalnız `<20-hex>.…` içerik-hash'li dosyalar adaydır. `app.config.js`,
 *     `icons.js`, `images.js`, `tour.js`, `index.html`, `electron.js`, `Main.xml`
 *     ve `core/ i18n/ assets/ classlibraries/` dizinleri ASLA aday olmaz.
 *  2. Kapanış index.html'in TÜM src/href tohumlarından başlar ve ulaşılan her
 *     js/css içindeki 20-hex hash'leri izler (geçişli).
 *  3. Giriş bulunamazsa ya da ulaşılan küme boşsa → NO-OP. "Hepsini sil" imkânsız.
 */

const path = require('path');
const fs = require('fs-extra');

const HASH_RE = /[0-9a-f]{20}/g;
const ADAY_RE = /^[0-9a-f]{20}\./;
// NOT (2026-09-19): burada bir "dokunma listesi" (index.html, app.config.js,
// icons.js, electron.js…) VARDI ve KALDIRILDI — `ADAY_RE` zaten yalnız
// `<20-hex>.…` adlarını aday yaptığı için o liste hiçbir koşulda ateşlenemiyordu
// (mutasyon testi: listeyi silmek HİÇBİR testi kırmadı = ölü dal). Tek gerçek
// koruma ADAY_RE'dir ve mutasyonla çivilenmiştir.

/** index.html'deki her src/href tohumunu çıkarır (sorgu ve ./ önekleri atılır). */
function tohumlariCikar(html) {
  const out = [];
  const re = /(?:src|href)\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const ham = m[1].split('?')[0].split('#')[0];
    if (/^(https?:|data:|#)/i.test(ham)) continue;
    out.push(ham.replace(/^\.\//, ''));
  }
  return out;
}

/**
 * Bir kitap dizini için ulaşılan/ölü ayrımını hesaplar. Diske DOKUNMAZ.
 * @returns {{ulasilan:Set<string>, olu:string[], sebep:string}}
 */
function kapanisHesapla(dizinListesi, htmlIcerik, icerikOku) {
  const dosyalar = new Set(dizinListesi);
  const tohumlar = tohumlariCikar(htmlIcerik).filter((t) => dosyalar.has(t));
  if (tohumlar.length === 0) return { ulasilan: new Set(), olu: [], sebep: 'tohum-yok' };

  // hash öneki -> o hash ile başlayan dosyalar
  const hashHarita = new Map();
  for (const f of dosyalar) {
    const m = f.match(/^([0-9a-f]{20})\./);
    if (m) {
      if (!hashHarita.has(m[1])) hashHarita.set(m[1], []);
      hashHarita.get(m[1]).push(f);
    }
  }

  const ulasilan = new Set(tohumlar);
  const kuyruk = tohumlar.slice();
  while (kuyruk.length) {
    const f = kuyruk.pop();
    if (!/\.(js|css)$/i.test(f)) continue;
    let s;
    try { s = icerikOku(f); } catch (e) { continue; }
    if (typeof s !== 'string') continue;
    const bulunan = s.match(HASH_RE);
    if (!bulunan) continue;
    for (const h of new Set(bulunan)) {
      for (const g of hashHarita.get(h) || []) {
        if (!ulasilan.has(g)) { ulasilan.add(g); kuyruk.push(g); }
      }
    }
  }

  // Giriş bulunamadıysa (hiç js tohumu yoksa) dokunma.
  const jsTohum = tohumlar.some((t) => /\.js$/i.test(t));
  if (!jsTohum) return { ulasilan, olu: [], sebep: 'js-girisi-yok' };

  const olu = [];
  for (const f of dosyalar) {
    if (ulasilan.has(f)) continue;
    if (!ADAY_RE.test(f)) continue;          // yalnız içerik-hash'li çıktı
    olu.push(f);
  }
  return { ulasilan, olu: olu.sort(), sebep: 'hesaplandi' };
}

/** Bir kitap dizinini temizler. */
async function dizeniTemizle(dizin) {
  const indexYolu = path.join(dizin, 'index.html');
  if (!await fs.pathExists(indexYolu)) return { atlandi: 'index-yok', silinen: 0, bayt: 0 };
  const html = await fs.readFile(indexYolu, 'utf8');

  const girdiler = await fs.readdir(dizin, { withFileTypes: true });
  const dosyalar = girdiler.filter((d) => d.isFile()).map((d) => d.name);

  const { olu, sebep } = kapanisHesapla(
    dosyalar, html, (f) => fs.readFileSync(path.join(dizin, f), 'utf8'),
  );
  if (sebep !== 'hesaplandi' || olu.length === 0) {
    return { atlandi: sebep === 'hesaplandi' ? 'olu-yok' : sebep, silinen: 0, bayt: 0 };
  }

  let bayt = 0;
  for (const f of olu) {
    const p = path.join(dizin, f);
    // Sınır denetimi: çalışma dizininin DIŞINA çıkan hiçbir yol silinmez.
    if (!path.resolve(p).startsWith(path.resolve(dizin) + path.sep)) continue;
    try { bayt += (await fs.stat(p)).size; await fs.remove(p); } catch (e) { /* atla */ }
  }
  return { atlandi: null, silinen: olu.length, bayt };
}

/** Paket kökünü ve tüm alt-kitapları tarar. */
async function paketiTemizle(kokDizin, opts = {}) {
  const log = opts.log || (() => {});
  const adaylar = [kokDizin];
  for (const ad of await fs.readdir(kokDizin)) {
    const p = path.join(kokDizin, ad);
    if (/^book\d+$/i.test(ad) && (await fs.stat(p)).isDirectory()) adaylar.push(p);
  }
  let toplamDosya = 0; let toplamBayt = 0; const ayrinti = [];
  for (const d of adaylar) {
    const r = await dizeniTemizle(d);
    ayrinti.push({ dizin: path.relative(kokDizin, d) || '.', ...r });
    toplamDosya += r.silinen; toplamBayt += r.bayt;
  }
  log(`🧹 ölü motor temizliği: ${toplamDosya} dosya, ${(toplamBayt / 1e6).toFixed(1)} MB`);
  for (const a of ayrinti) {
    if (a.silinen) log(`   ${a.dizin}: ${a.silinen} dosya ${(a.bayt / 1e6).toFixed(1)} MB`);
    else log(`   ${a.dizin}: atlandı (${a.atlandi})`);
  }
  return { toplamDosya, toplamBayt, ayrinti };
}

/** Kapı: varsayılan AÇIK. Kapatmak için EMPP_OLU_TEMIZLIK=0. */
function acikMi(env = process.env) { return env.EMPP_OLU_TEMIZLIK !== '0'; }

module.exports = { paketiTemizle, dizeniTemizle, kapanisHesapla, tohumlariCikar, acikMi, ADAY_RE };
