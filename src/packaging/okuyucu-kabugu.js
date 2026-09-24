'use strict';

/**
 * OKUYUCU KABUĞU "ESKİYSE DEĞİŞTİR" (Faz 3c, 2026-09-24, Nadir: "Web-Z kabuğu pakete girsin").
 *
 * NEDEN: sağ alttaki sürüm rozeti motordan değil okuyucu KABUĞUNDAN gelir — bookN'in
 * `<h>.main.js` + parçasındaki `e.exports={i8:"X"}` (webpack'in package.json sürümü).
 * Ölçüm 73768: paket 1.11.5 (yayıncının 13.09 exe'si), Web-Z 1.13.3 (YDS `WebZKitap/`).
 *
 * KANONİK: `~/.empp-agent/kabuk/kanonik.json` → `{surum, dizin}`; `dizin/manifest.json`
 * dosya listesi + sha12'leri. Dolduran: `scripts/kabuk-kanonik-doldur.js` (salt okuma).
 * Her dosyanın sha'sı yüklemede doğrulanır; tek uyuşmazlık = kanonik YOK (sahte yeşil yok).
 *
 * NE DEĞİŞİR (yalnız kitap dizininin KÖK düzeyi + i18n/tr.js):
 *   - kanonik kabuk dosyaları eklenir (hash adlı dosyalar çakışmaz; aynı adlı ama farklı
 *     içerikli dosya varsa eskisi `.empp-eski/`'ye taşınır — silme yok),
 *   - index.html: paketteki ŞABLON korunur, yalnız `*.main.js` / `*.main.css` referansları
 *     yeniden yazılır (Web-Z index'i base href/polyfill/PWA taşıdığı için alınmaz),
 *   - version.txt: kanonik sürüm (yalnız 3 parçalıysa — memory: surum-formatini-biz-bozduk).
 *   - çekirdek varlıklar (`manifest.cekirdek`, core/…): YALNIZ EKSİKSE eklenir (büyük/küçük
 *     harf DUYARLI yoklanır — Pardus ext4); var olan core dosyası asla ezilmez.
 * DOKUNULMAZ: assets/ data/ pages/ thumbs/ htmletk/ core/ app.config.js motor.
 * Kapsam: `bookN/` dizinleri; bookN yoksa (tek kitap) kök. SET kökü (menü/set kabuğu) atlanır.
 */

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs-extra');
const { surumKiyasla, surumParcala, rozetSurumuOku } = require('./motor-surumu');

const KANONIK_YOLU_VARSAYILAN = process.env.EMPP_KABUK_KANONIK
  || path.join(os.homedir(), '.empp-agent', 'kabuk', 'kanonik.json');

/** Kapı: varsayılan AÇIK. `EMPP_OKUYUCU_KABUGU=0` kapatır. */
function acikMi(env = process.env) {
  return (env && env.EMPP_OKUYUCU_KABUGU) !== '0';
}

function sha12(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
}

/**
 * Kanonik kabuğu DOĞRULAYARAK yükler. Şüphede null.
 * @returns {Promise<{surum:string, dizin:string, main:string, mainCss:string|null,
 *   dosyalar:Array<{ad:string, sha12:string}>}|null>}
 */
async function kanonikKabukYukle(yol = KANONIK_YOLU_VARSAYILAN) {
  try {
    const k = JSON.parse(await fs.readFile(yol, 'utf8'));
    if (!k || !surumParcala(k.surum) || typeof k.dizin !== 'string') return null;
    const m = JSON.parse(await fs.readFile(path.join(k.dizin, 'manifest.json'), 'utf8'));
    if (m.surum !== k.surum || !/^[0-9a-f]{20}\.main\.js$/.test(m.main || '')) return null;
    if (!Array.isArray(m.dosyalar) || !m.dosyalar.some((d) => d.ad === m.main)) return null;
    for (const d of m.dosyalar) {
      if (d.ad.includes('..') || path.isAbsolute(d.ad)) return null;
      const buf = await fs.readFile(path.join(k.dizin, d.ad));
      if (sha12(buf) !== d.sha12) return null;
    }
    const cekirdek = Array.isArray(m.cekirdek) ? m.cekirdek : [];
    for (const d of cekirdek) {
      if (!/^core\//.test(d.ad) || d.ad.includes('..')) return null;
      if (sha12(await fs.readFile(path.join(k.dizin, d.ad))) !== d.sha12) return null;
    }
    return { surum: k.surum, dizin: k.dizin, main: m.main, mainCss: m.mainCss || null,
      dosyalar: m.dosyalar, cekirdek };
  } catch {
    return null;
  }
}

/** Büyük/küçük harf DUYARLI varlık yoklaması (macOS APFS duyarsız, Pardus ext4 duyarlı). */
async function tamAdlaVarMi(kok, goreli) {
  let dir = kok;
  for (const parca of goreli.split('/')) {
    let adlar;
    try { adlar = await fs.readdir(dir); } catch { return false; }
    if (!adlar.includes(parca)) return false;
    dir = path.join(dir, parca);
  }
  return true;
}

/** Kabuk taşıyan kitap dizinleri (kök-göreli; '' = kök). */
async function kitapDizinleri(kokDizin) {
  let girisler = [];
  try { girisler = await fs.readdir(kokDizin, { withFileTypes: true }); } catch { return []; }
  const kitaplar = girisler.filter((g) => g.isDirectory() && /^book\d+$/.test(g.name))
    .map((g) => g.name).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  return kitaplar.length ? kitaplar : [''];
}

/** index.html'de main.js/main.css referanslarını yeniden yazar. SAF. */
function indexYenidenYaz(html, main, mainCss) {
  let yeni = html.replace(/(src=")\.?\/?[0-9a-f]{20}\.main\.js(")/, `$1./${main}$2`);
  if (mainCss) {
    if (/href="\.?\/?[0-9a-f]{20}\.main\.css"/.test(yeni)) {
      yeni = yeni.replace(/(href=")\.?\/?[0-9a-f]{20}\.main\.css(")/, `$1./${mainCss}$2`);
    } else {
      yeni = yeni.replace('</head>', `<link href="./${mainCss}" rel="stylesheet"></head>`);
    }
  }
  return yeni;
}

/** Tek kitap kararı. SAF. */
function kabukKarari(kopyaSurum, kanonik) {
  if (!kanonik || !surumParcala(kanonik.surum)) return 'bilinmiyor';
  if (!surumParcala(kopyaSurum)) return 'bilinmiyor'; // rozet okunamadı → soyu bilinmiyor, dokunma
  const k = surumKiyasla(kopyaSurum, kanonik.surum);
  if (k === 0) return 'ayni';
  return k < 0 ? 'eski' : 'yeni';
}

/**
 * @param {string} kokDizin paket kökü
 * @param {string} [kanonikYol]
 * @param {{kanonik?:object|null, yedekKok?:string, paketJsonYaz?:boolean, log?:Function}} [opts]
 * @returns {Promise<object>} damga (paket.json.kabukSurumu)
 */
async function okuyucuKabuguDegistir(kokDizin, kanonikYol = KANONIK_YOLU_VARSAYILAN, opts = {}) {
  const log = opts.log || (() => {});
  const kanonik = opts.kanonik !== undefined ? opts.kanonik : await kanonikKabukYukle(kanonikYol);
  const yedekKok = opts.yedekKok
    || path.join(path.dirname(path.resolve(kokDizin)), '.empp-eski', path.basename(kokDizin));
  const kitaplar = [];

  for (const rel of await kitapDizinleri(kokDizin)) {
    const dir = path.join(kokDizin, rel);
    const once = await rozetSurumuOku(dir);
    const karar = kabukKarari(once.surum, kanonik);
    const kayit = { dizin: rel || '.', onceSurum: once.surum, karar, sonraSurum: once.surum };
    if (karar === 'ayni') {
      // Aynı kabuk sürümü ama çekirdek varlık eksik olabilir (yayıncı kabuğu core'suz gelmiş) —
      // yalnız EKLE, hiçbir şey ezme/taşıma.
      let eklenen = 0;
      for (const d of kanonik.cekirdek || []) {
        const hedef = path.join(dir, d.ad);
        if (await tamAdlaVarMi(dir, d.ad) || await fs.pathExists(hedef)) continue;
        await fs.copy(path.join(kanonik.dizin, d.ad), hedef);
        eklenen += 1;
      }
      if (eklenen) { kayit.eklenenCekirdek = eklenen; log(`   kabuk ${kayit.dizin}: ${eklenen} çekirdek varlık eklendi`); }
    }
    if (karar === 'eski') {
      const tasinan = []; // [hedef, yedek] — hata olursa geri almak için
      const eklenen = [];
      const yedekle = async (hedef) => {
        const yedek = path.join(yedekKok, rel, path.relative(dir, hedef));
        await fs.ensureDir(path.dirname(yedek));
        await fs.move(hedef, yedek, { overwrite: true });
        tasinan.push([hedef, yedek]);
      };
      try {
        for (const d of kanonik.dosyalar) {
          const hedef = path.join(dir, d.ad);
          const kaynak = path.join(kanonik.dizin, d.ad);
          if (await fs.pathExists(hedef)) {
            if (sha12(await fs.readFile(hedef)) === d.sha12) continue;
            await yedekle(hedef);
          } else {
            eklenen.push(hedef);
          }
          await fs.copy(kaynak, hedef);
        }
        for (const d of kanonik.cekirdek || []) {
          if (await tamAdlaVarMi(dir, d.ad)) continue; // var olan core dosyası EZİLMEZ
          const hedef = path.join(dir, d.ad);
          if (await fs.pathExists(hedef)) continue; // harf farkıyla var (macOS) — ezme
          eklenen.push(hedef);
          await fs.copy(path.join(kanonik.dizin, d.ad), hedef);
        }
        const idx = path.join(dir, 'index.html');
        const html = await fs.readFile(idx, 'utf8');
        const yeniHtml = indexYenidenYaz(html, kanonik.main, kanonik.mainCss);
        await yedekle(idx);
        await fs.writeFile(idx, yeniHtml, 'utf8');
        const vt = path.join(dir, 'version.txt');
        if (/^\d+\.\d+\.\d+$/.test(kanonik.surum) && await fs.pathExists(vt)) {
          await yedekle(vt);
          await fs.writeFile(vt, kanonik.surum, 'utf8');
        }
        const sonra = await rozetSurumuOku(dir);
        if (sonra.surum !== kanonik.surum) throw new Error(`rozet ${sonra.surum} ≠ ${kanonik.surum}`);
        kayit.karar = 'degisti';
        kayit.sonraSurum = sonra.surum;
        kayit.tasinan = tasinan.length;
        kayit.eklenen = eklenen.length;
      } catch (e) {
        // geri al: eklenenleri yedeğe taşı (silme yok), taşınanları geri koy
        for (const h of eklenen) {
          if (await fs.pathExists(h)) {
            const y = path.join(yedekKok, '_geri-alinan', rel, path.relative(dir, h));
            await fs.ensureDir(path.dirname(y));
            await fs.move(h, y, { overwrite: true });
          }
        }
        for (const [h, y] of tasinan.reverse()) await fs.move(y, h, { overwrite: true });
        kayit.karar = 'hata';
        kayit.hata = e.message;
      }
      log(`   kabuk ${kayit.dizin}: ${kayit.onceSurum} → ${kayit.sonraSurum} (${kayit.karar})`);
    }
    kitaplar.push(kayit);
  }

  let durum;
  if (!kanonik) durum = 'bilinmiyor';
  else if (kitaplar.some((k) => k.karar === 'hata' || k.karar === 'bilinmiyor')) durum = 'karisik';
  else durum = 'guncel';
  const damga = {
    durum,
    kanonikSurum: kanonik ? kanonik.surum : null,
    kanonikMain: kanonik ? kanonik.main : null,
    degisen: kitaplar.filter((k) => k.karar === 'degisti').length,
    kitaplar,
    zaman: new Date().toISOString(),
  };
  if (opts.paketJsonYaz !== false) {
    const hedef = path.join(kokDizin, 'paket.json');
    let govde = {};
    try { govde = JSON.parse(await fs.readFile(hedef, 'utf8')); } catch { govde = {}; }
    await fs.writeFile(hedef, `${JSON.stringify({ ...govde, kabukSurumu: damga }, null, 2)}\n`, 'utf8');
  }
  return damga;
}

/** Kapı: her kitap dizininin rozeti ≥ kanonik mi? gecti=null → kanonik bilinmiyor. */
async function kabukKapisi(kokDizin, kanonik) {
  if (!kanonik || !surumParcala(kanonik.surum)) return { gecti: null, kitaplar: [], sebep: 'kanonik bilinmiyor' };
  const kitaplar = [];
  for (const rel of await kitapDizinleri(kokDizin)) {
    const r = await rozetSurumuOku(path.join(kokDizin, rel));
    const eksikCekirdek = [];
    for (const d of kanonik.cekirdek || []) {
      if (!(await tamAdlaVarMi(path.join(kokDizin, rel), d.ad))) eksikCekirdek.push(d.ad);
    }
    let karar = kabukKarari(r.surum, kanonik);
    if ((karar === 'ayni' || karar === 'yeni') && eksikCekirdek.length) karar = 'eksik-cekirdek';
    kitaplar.push({ dizin: rel || '.', surum: r.surum, karar, eksikCekirdek });
  }
  const kotu = kitaplar.filter((k) => k.karar !== 'ayni' && k.karar !== 'yeni');
  return { gecti: kitaplar.length > 0 && kotu.length === 0, kitaplar,
    sebep: kotu.length ? `${kotu.length} kitap kabuğu kanonikten eski/bilinmiyor ya da çekirdek varlığı eksik` : 'tümü ≥ kanonik' };
}

module.exports = {
  KANONIK_YOLU_VARSAYILAN,
  acikMi,
  kanonikKabukYukle,
  kitapDizinleri,
  tamAdlaVarMi,
  indexYenidenYaz,
  kabukKarari,
  okuyucuKabuguDegistir,
  kabukKapisi,
};
