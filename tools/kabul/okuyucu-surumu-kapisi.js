#!/usr/bin/env node
'use strict';
/**
 * OKUYUCU SÜRÜMÜ KAPISI — paketteki okuyucu kabuğunun sürümü kanonikle EŞİT mi? (06.10)
 *
 * NEDEN: A1 düzenli setlerde (45477, 45478, 45480, 45485, 45487, 45496) paketleyici kök
 * `index.html`'i (sf425 set kabuğu, main.js çağırmaz) ölçtü → rozet okunamadı → 'bilinmiyor' →
 * okuyucu 1.13.3'te kaldı (kanonik 1.13.14). Kasa işçisi manifestteki `karisik` damgasını bayat
 * sayıp RED verdi; Pardus ve Mac/Android kabulü okuyucu sürümünü ÖLÇMEDİĞİ için 5 pardus + 1 mac
 * paket eski okuyucuyla yayınlandı. Ders: damga/alan kanıt değildir — kapı ÖLÇÜLEN sürümü kanıtlar.
 *
 * TANIM TEK KAYNAK (kopya YASAK): ölçüm birimi `okuyucu-kabugu.js kabukBirimleri` (A1: kök dosyalar
 * + sayfa `kapak/index.html`; bookN: her kitap; okuyucusuz bookN 'kabuksuz'), rozet
 * `motor-surumu.js rozetSurumuOku`. Paketleyicinin değiştirdiği birimle kapının ölçtüğü birim aynı.
 *
 * KARAR (fail-closed): her okuyuculu birimin sürümü kanonikle EŞİT → GECTI. Eski ya da yeni → RED
 * (kasa `bayatKarari` da eşitlik ister). Ölçülemeyen birim / okuyucu yok / kanonik yok → OLCULEMEDI;
 * kapı OLCULEMEDI'yi GEÇİRMEZ. `KABUL_OKUYUCU_SURUM=uyar` → GEÇTİ olmayan sonuç yalnız uyarı olur.
 *
 * asar (mac / pardus / windows): yalnız gereken dosyalar (index.html, kapak/index.html, app.config.js,
 * classlibraries/ImWin32.dll, paket.json, kök ve bookN düzeyindeki `<h20>*.js`) geçici dizine
 * çıkarılır; ölçüm o dizinde aynı fonksiyonlarla yapılır.
 *
 * Komut satırı:
 *   node tools/kabul/okuyucu-surumu-kapisi.js <paket-kökü | app.asar | paket dosyası>
 *        [--platform mac|android|windows|pardus|dizin|zip] [--kanonik 1.13.14] [--json] [--calisma <dizin>]
 *   Çıkış: 0 GEÇTİ · 1 RED ya da ÖLÇÜLEMEDİ (fail-closed) · 2 kullanım hatası.
 *   stdout (--json yoksa): OKUYUCU_KARAR= · OKUYUCU_HAM_KARAR= · OKUYUCU_OLCULEN= · OKUYUCU_KANONIK= ·
 *   OKUYUCU_SEBEP= satırları + birim başına bir satır.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  KANONIK_YOLU_VARSAYILAN, kabukBirimleri, okuyucusuzMu, kabukKarari,
} = require('../../src/packaging/okuyucu-kabugu');
const { rozetSurumuOku, surumParcala } = require('../../src/packaging/motor-surumu');
const A1 = require('../../src/packaging/a1-duzen');

const KARAR = Object.freeze({ GECTI: 'GECTI', RED: 'RED', OLCULEMEDI: 'OLCULEMEDI' });

/** `KABUL_OKUYUCU_SURUM` kipi: 'uyar' → yalnız uyarı; diğer her değer → zorunlu. Saf. */
function kip(env = process.env) {
  return String((env && env.KABUL_OKUYUCU_SURUM) || '').trim().toLowerCase() === 'uyar' ? 'uyar' : 'zorunlu';
}

/**
 * Kanonik sürüm: önce açık parametre, sonra kanonik.json `surum`. Biçim dışı → null + sebep.
 * @returns {{surum:string|null, kaynak:string, hata?:string}}
 */
function kanonikSurumCoz(acik, yol = KANONIK_YOLU_VARSAYILAN) {
  if (acik != null && acik !== '') {
    const s = String(acik).trim();
    return surumParcala(s) ? { surum: s, kaynak: 'parametre' }
      : { surum: null, kaynak: 'parametre', hata: `biçim dışı kanonik "${s}"` };
  }
  try {
    const k = JSON.parse(fs.readFileSync(yol, 'utf8'));
    if (k && surumParcala(k.surum)) return { surum: String(k.surum), kaynak: yol };
    return { surum: null, kaynak: yol, hata: 'kanonik.json surum alanı biçim dışı' };
  } catch (e) {
    return { surum: null, kaynak: yol, hata: `kanonik.json okunamadı (${e.code || e.message})` };
  }
}

/** Birimin ölçülemeyiş sebebi (rozet sonucundan). I/O (küçük). */
function olculemedSebebi(dir, sayfa, r) {
  if (!fs.existsSync(path.join(dir, sayfa))) return `${sayfa} yok`;
  if (!r.main) return `${sayfa} okuyucu ana girişini (*.main.js) çağırmıyor`;
  if (!fs.existsSync(path.join(dir, r.main))) return `${r.main} yok`;
  return `${r.main} ve parçalarında sürüm rozeti (i8) yok`;
}

/**
 * Açılmış ağaçtaki her okuyucu birimini ölçer. I/O.
 * @returns {Promise<Array<{dizin:string, sayfa:string, duzen?:string, surum:string|null,
 *   main:string|null, parca:string|null, karar:string, sebep?:string}>>}
 */
async function birimleriOlc(kokDizin, kanonikSurum) {
  const birimler = [];
  for (const b of await kabukBirimleri(kokDizin)) {
    const dizin = b.rel || '.';
    const sayfa = b.rel ? `${b.rel}/${b.index}` : b.index;
    const kayit = { dizin, sayfa, surum: null, main: null, parca: null };
    if (b.duzen) kayit.duzen = b.duzen;
    if (await okuyucusuzMu(kokDizin, b.rel)) {
      birimler.push({ ...kayit, karar: 'kabuksuz', sebep: 'index.html yok (okuyucusuz kitap)' });
      continue;
    }
    if (b.a1Bozuk) {
      birimler.push({ ...kayit, karar: 'olculemedi', sebep: `A1 düzeni bozuk: ${b.a1Bozuk}` });
      continue;
    }
    const dir = path.join(kokDizin, b.rel);
    const r = await rozetSurumuOku(dir, b.index);
    Object.assign(kayit, { surum: r.surum, main: r.main, parca: r.parca });
    const k = kabukKarari(r.surum, kanonikSurum ? { surum: kanonikSurum } : null);
    if (k === 'ayni') kayit.karar = 'ayni';
    else if (k === 'eski' || k === 'yeni') {
      kayit.karar = k;
      kayit.sebep = `okuyucu ${r.surum} ${k === 'eski' ? '<' : '>'} kanonik ${kanonikSurum}`;
    } else {
      kayit.karar = 'olculemedi';
      kayit.sebep = kanonikSurum ? olculemedSebebi(dir, b.index, r) : 'kanonik bilinmiyor';
    }
    birimler.push(kayit);
  }
  return birimler;
}

/**
 * SAF karar: birimler + kanonik → {hamKarar, karar, sebepler, uyari?}.
 * Öncelik: RED (eski/yeni kanıtı) > OLCULEMEDI > GECTI.
 */
function kararVer(birimler, kanonikSurum, { kipi = 'zorunlu', kanonikHata = null } = {}) {
  const sebepler = [];
  let ham;
  const okuyuculu = (birimler || []).filter((b) => b.karar !== 'kabuksuz');
  if (!kanonikSurum) {
    ham = KARAR.OLCULEMEDI;
    sebepler.push(`kanonik okuyucu sürümü bilinmiyor${kanonikHata ? ` (${kanonikHata})` : ''}`);
  } else if (!okuyuculu.length) {
    ham = KARAR.OLCULEMEDI;
    sebepler.push('pakette ölçülebilir okuyucu birimi yok');
  } else {
    const farkli = okuyuculu.filter((b) => b.karar === 'eski' || b.karar === 'yeni');
    const olcmeyen = okuyuculu.filter((b) => b.karar === 'olculemedi');
    for (const b of [...farkli, ...olcmeyen]) sebepler.push(`${b.sayfa}: ${b.sebep}`);
    if (farkli.length) ham = KARAR.RED;
    else if (olcmeyen.length) ham = KARAR.OLCULEMEDI;
    else ham = KARAR.GECTI;
  }
  const sonuc = { hamKarar: ham, karar: ham, sebepler };
  if (ham !== KARAR.GECTI && kipi === 'uyar') {
    sonuc.karar = KARAR.GECTI;
    sonuc.uyari = `KABUL_OKUYUCU_SURUM=uyar: okuyucu sürümü ${ham} (${sebepler.join('; ')}) — yalnız uyarı, kapı geçirdi`;
  }
  return sonuc;
}

/** Benzersiz ölçülen sürümler; tek ise o, birden çoksa virgüllü, hiç yoksa null. Saf. */
function olculenOzeti(birimler) {
  const s = [...new Set((birimler || []).map((b) => b.surum).filter(Boolean))];
  return s.length ? s.join(',') : null;
}

/** paket.json `kabukSurumu` damgası (YALNIZ bilgi — karar ölçümden). I/O. */
function damgaOku(kokDizin) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(kokDizin, 'paket.json'), 'utf8')).kabukSurumu;
    return d && typeof d === 'object' ? { durum: d.durum || null, kanonikSurum: d.kanonikSurum || null } : null;
  } catch (_) {
    return null;
  }
}

const H20_JS = /^[0-9a-f]{20}(?:\.[^/]+)?\.js$/;
const KITAP_DIZINI = /^book\d+$/;

/** asar girdisi ölçüm için gerekli mi (kök-göreli POSIX yol). Saf. */
function asarGerekliMi(rel) {
  if (rel === A1.A1_MOTOR_SAYFASI || rel === 'classlibraries/ImWin32.dll' || rel === 'paket.json') return true;
  const p = rel.split('/');
  const ad = p[p.length - 1];
  const duzeyUygun = p.length === 1 || (p.length === 2 && KITAP_DIZINI.test(p[0]));
  return duzeyUygun && (ad === 'index.html' || ad === 'app.config.js' || H20_JS.test(ad));
}

/**
 * asar'dan ölçüm için gereken dosyaları `hedef`e çıkarır (bookN dizinleri boş da olsa açılır:
 * okuyucusuz kitap ayrımı korunur). I/O.
 * @returns {{dosya:number}}
 */
function asarCikar(asarYolu, hedef) {
  // eslint-disable-next-line global-require
  const asar = require('@electron/asar');
  const liste = asar.listPackage(asarYolu).map((p) => p.replace(/^[\\/]+/, '').replace(/\\/g, '/'));
  fs.mkdirSync(hedef, { recursive: true });
  let dosya = 0;
  for (const rel of liste) {
    const p = rel.split('/');
    if (p.length === 1 && KITAP_DIZINI.test(p[0])) fs.mkdirSync(path.join(hedef, p[0]), { recursive: true });
    if (!asarGerekliMi(rel)) continue;
    let buf;
    try { buf = asar.extractFile(asarYolu, rel); } catch (_) { continue; } // dizin ya da okunamayan
    const yol = path.join(hedef, ...p);
    fs.mkdirSync(path.dirname(yol), { recursive: true });
    fs.writeFileSync(yol, buf);
    dosya += 1;
  }
  return { dosya };
}

/**
 * Açılmış paket kökünü (dizin ya da app.asar) ölçer ve karar verir.
 * @param {string} kok
 * @param {{asar?:boolean, kanonik?:string, kanonikYol?:string, calisma?:string, env?:object}} [o]
 * @returns {Promise<{karar:string, hamKarar:string, olculen:string|null, kanonik:string|null,
 *   kanonikKaynagi:string, kip:string, birimler:Array, sebepler:string[], uyari?:string,
 *   damga:object|null, zaman:string}>}
 */
async function okuyucuSurumuOlc(kok, o = {}) {
  const env = o.env || process.env;
  const kanonikCoz = kanonikSurumCoz(o.kanonik, o.kanonikYol || KANONIK_YOLU_VARSAYILAN);
  const asarMi = o.asar != null ? Boolean(o.asar) : /\.asar$/i.test(String(kok));
  let olcumKoku = kok;
  let gecici = null;
  const ek = {};
  try {
    let birimler = [];
    let olcumHatasi = null;
    try {
      if (asarMi) {
        olcumKoku = o.calisma
          ? path.join(o.calisma, 'okuyucu-surumu')
          : fs.mkdtempSync(path.join(os.tmpdir(), 'okuyucu-surumu-'));
        if (!o.calisma) gecici = olcumKoku;
        ek.asarCikarilan = asarCikar(kok, olcumKoku).dosya;
      }
      birimler = await birimleriOlc(olcumKoku, kanonikCoz.surum);
    } catch (e) {
      olcumHatasi = e.message;
    }
    const kipi = kip(env);
    const k = kararVer(birimler, kanonikCoz.surum, { kipi, kanonikHata: kanonikCoz.hata });
    if (olcumHatasi) {
      k.sebepler.unshift(`ölçüm hatası: ${olcumHatasi}`);
      if (k.hamKarar !== KARAR.RED) {
        k.hamKarar = KARAR.OLCULEMEDI;
        k.karar = kipi === 'uyar' ? KARAR.GECTI : KARAR.OLCULEMEDI;
      }
    }
    const damga = damgaOku(olcumKoku);
    const sonuc = {
      karar: k.karar,
      hamKarar: k.hamKarar,
      olculen: olculenOzeti(birimler),
      kanonik: kanonikCoz.surum,
      kanonikKaynagi: kanonikCoz.kaynak,
      kip: kipi,
      birimler,
      sebepler: k.sebepler,
      damga,
      ...ek,
      zaman: new Date().toISOString(),
    };
    if (k.uyari) sonuc.uyari = k.uyari;
    if (damga && damga.durum === 'guncel' && k.hamKarar !== KARAR.GECTI) {
      sonuc.sebepler.push(`paket.json damgası "guncel" diyor ama ölçüm ${k.hamKarar} — damga kanıt değildir`);
    }
    return sonuc;
  } finally {
    if (gecici && path.basename(gecici).startsWith('okuyucu-surumu-') && path.dirname(gecici) === os.tmpdir()) {
      try { fs.rmSync(gecici, { recursive: true, force: true }); } catch (_) { /* kalsın */ }
    }
  }
}

/** Kapıdan geçer mi (fail-closed: yalnız GECTI). Saf. */
function gecerMi(sonuc) {
  return Boolean(sonuc) && sonuc.karar === KARAR.GECTI;
}

/** Tek satır özet (log/stdout). Saf. */
function ozetSatiri(sonuc) {
  const tr = { GECTI: 'GEÇTİ', RED: 'RED', OLCULEMEDI: 'ÖLÇÜLEMEDİ' };
  const n = (sonuc.birimler || []).filter((b) => b.karar !== 'kabuksuz').length;
  const s = `okuyucu sürümü: ${tr[sonuc.karar] || sonuc.karar} — ölçülen ${sonuc.olculen || '—'},`
    + ` kanonik ${sonuc.kanonik || '—'} (${n} birim)`;
  const ayr = sonuc.uyari || (sonuc.sebepler || []).slice(0, 3).join(' | ');
  return ayr ? `${s} · ${ayr}` : s;
}

/**
 * Paket DOSYASINI (dmg/impark/exe/apk/zip) ya da dizini açıp ölçer (`paket-cikar.js` ile).
 * @param {{paket:string, platform?:string, calisma?:string, kanonik?:string, env?:object, log?:Function}} p
 */
async function paketOlc(p) {
  // eslint-disable-next-line global-require
  const { paketiAc, platformTahmin, platformNormalize } = require('./paket-cikar');
  const dizinMi = fs.statSync(p.paket).isDirectory();
  const platform = platformNormalize(p.platform) || platformTahmin(p.paket, dizinMi);
  if (!platform) throw new Error(`platform belirlenemedi (--platform ver): ${p.paket}`);
  const kendi = !p.calisma;
  const calisma = p.calisma || fs.mkdtempSync(path.join(os.tmpdir(), 'okuyucu-surumu-paket-'));
  let acilis = null;
  try {
    acilis = paketiAc({ paket: p.paket, platform, calisma, log: p.log || (() => {}) });
    return await okuyucuSurumuOlc(acilis.kok, { asar: acilis.asar, kanonik: p.kanonik, calisma, env: p.env });
  } finally {
    if (acilis && acilis.kapat) { try { acilis.kapat(); } catch (_) { /* log çağıranda */ } }
    if (kendi && path.basename(calisma).startsWith('okuyucu-surumu-paket-') && path.dirname(calisma) === os.tmpdir()) {
      try { fs.rmSync(calisma, { recursive: true, force: true }); } catch (_) { /* kalsın */ }
    }
  }
}

function argumanCoz(argv) {
  const s = { yol: null, kanonik: null, json: false, platform: null, calisma: null, yardim: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--kanonik') s.kanonik = argv[++i];
    else if (a === '--json') s.json = true;
    else if (a === '--platform') s.platform = argv[++i];
    else if (a === '--calisma') s.calisma = argv[++i];
    else if (a === '-h' || a === '--help' || a === '--yardim') s.yardim = true;
    else if (!a.startsWith('-') && !s.yol) s.yol = a;
  }
  return s;
}

/** CLI gövdesi (test edilebilir). @returns {Promise<{kod:number, sonuc?:object}>} */
async function calis(argv, yaz = (x) => process.stdout.write(`${x}\n`), env = process.env) {
  const s = argumanCoz(argv);
  if (s.yardim || !s.yol) {
    yaz('Kullanım: node tools/kabul/okuyucu-surumu-kapisi.js <paket-kökü|app.asar|paket> '
      + '[--platform mac|android|windows|pardus|dizin|zip] [--kanonik X.Y.Z] [--json] [--calisma <dizin>]');
    return { kod: 2 };
  }
  const yol = path.resolve(s.yol);
  if (!fs.existsSync(yol)) { yaz(`HATA: yol yok — ${yol}`); return { kod: 2 }; }
  let sonuc;
  try {
    const dizinMi = fs.statSync(yol).isDirectory();
    if (dizinMi || /\.asar$/i.test(yol)) {
      sonuc = await okuyucuSurumuOlc(yol, { kanonik: s.kanonik, calisma: s.calisma, env });
    } else {
      sonuc = await paketOlc({ paket: yol, platform: s.platform, calisma: s.calisma, kanonik: s.kanonik, env });
    }
  } catch (e) {
    const kp = kip(env);
    sonuc = {
      karar: kp === 'uyar' ? KARAR.GECTI : KARAR.OLCULEMEDI, hamKarar: KARAR.OLCULEMEDI, olculen: null,
      kanonik: s.kanonik || null, kip: kp, birimler: [], sebepler: [`paket açılamadı: ${e.message}`],
    };
    if (kp === 'uyar') sonuc.uyari = `KABUL_OKUYUCU_SURUM=uyar: paket açılamadı (${e.message}) — yalnız uyarı`;
  }
  if (s.json) yaz(JSON.stringify(sonuc, null, 2));
  else {
    yaz(`OKUYUCU_KARAR=${sonuc.karar}`);
    yaz(`OKUYUCU_HAM_KARAR=${sonuc.hamKarar}`);
    yaz(`OKUYUCU_OLCULEN=${sonuc.olculen || ''}`);
    yaz(`OKUYUCU_KANONIK=${sonuc.kanonik || ''}`);
    yaz(`OKUYUCU_SEBEP=${(sonuc.uyari || sonuc.sebepler.join('; ') || 'tümü kanonikle eşit').replace(/\n/g, ' ')}`);
    for (const b of sonuc.birimler) yaz(`  ${b.sayfa}: ${b.surum || '—'} (${b.karar})`);
  }
  return { kod: gecerMi(sonuc) ? 0 : 1, sonuc };
}

module.exports = {
  KARAR,
  kip,
  kanonikSurumCoz,
  birimleriOlc,
  kararVer,
  olculenOzeti,
  asarGerekliMi,
  asarCikar,
  okuyucuSurumuOlc,
  paketOlc,
  gecerMi,
  ozetSatiri,
  argumanCoz,
  calis,
};

if (require.main === module) {
  calis(process.argv.slice(2)).then(({ kod }) => process.exit(kod)).catch((e) => {
    process.stderr.write(`[okuyucu-surumu] BEKLENMEYEN HATA: ${(e && e.stack) || e}\n`);
    process.exit(1);
  });
}
