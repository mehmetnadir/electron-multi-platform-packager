'use strict';

/**
 * SF425 KABUK TAZELEME (Z2) — r2-kur zincirinin adımı (2026-10-05).
 * Sözleşme: `.claude/docs/sozlesme.md` "sf425 kabuk tazeleme (Z2)"; pilot raporu
 * `~/.empp-agent/arastirma/set-kabuk-0510/set-kaynak-yenileme-pilot.md` (45550).
 *
 * NEDEN (Nadir, 05.10): YDS'nin bütün setleri çevrimdışı pakette Web-Z set sayfasıyla AYNI
 * arayüzü (sf425 kabuğu: "sonraki satır" düğmesi, Devam Et / Üniteye Git) taşımalı. Paketleyici
 * kabuğa dokunmaz; kabuğun TEK üreticisi Üretim Masası'nın `WebZTemaUretici`'sidir. Bu adım onun
 * başsız ikilisini (`webz-kabuk-uret`) Mac'te çağırır.
 *
 * SIRA (runner): taban → merdiven → set eki → KABUK → panel → imKeys → yazma kapısı → R2.
 *
 * NE YAPAR (iş kopyası `build.zip`; arşiv/önbellek zip'ine DOKUNULMAZ):
 *   1. Uygunluk: kökte `bookN/index.html` düzeni VE kök index sf425 kabuğu ya da motor kopyası.
 *      Tek motorlu kök (11-12: bookN yok, kök `classlibraries/ImWin32.dll`) `a1` KİPİNE girer
 *      (bookN'e geçiş her kitapta ayrı aktivasyon kodu sorduruyordu, pilot §3b). A1 (05.10,
 *      ölçüm `arastirma/set-kabuk-0510/a1-deneme-sonuc.md`, arayüz `a1-arayuz.md`): kök motor
 *      `index.html` → `kapak/index.html` (`../packaging/a1-duzen` başlığıyla), kök `index.html`
 *      = ikilinin sf425 kabuğu (`--kip tek-motor`, kart `kapak/index.html?kapak=<ID>&defaultPageNo=N`).
 *      İkili kipi tanımazsa / kapı reddederse A1 ATLANIR, iş kopyası aynen kalır (fail-closed).
 *   2. Web-Z `go/<kisaKod>/web-stream/config/settings.json` + kapaklar (`images/<anahtar>.png`),
 *      tarayıcı UA ile (UA'sız 403).
 *   3. Kimlik eşlemesi: yazma kapısının kendi çözümü (a/a2/b/c — assetId dizini, ImWin32 kapak
 *      kimliği, menü assetId, ad) → Web-Z anahtarı DEĞİL, assetId'nin build klasörü. Klasörler
 *      YENİDEN ADLANDIRILMAZ (öğretmen notu WORK ad alanı klasör adına bağlı); sıra eşleme
 *      dosyasının dizi sırasıyla (`displayOrder`) taşınır. Link/games/videos korunur.
 *   4. Gölge kök (yalnız `bookN/index.html` taslakları) → ikili → üretilen kök dosyaları aday
 *      klona `zip` ile yazılır → kapı → GEÇTİ ise tek rename.
 *   5. Kapı: `language-set.js`'te `sonrakiSatirDugmesi`; kök index Web-Z kabuğu (paketleyici
 *      `set-menu` dokunmaz) ve yerel başvuruları zip'te (yazma kapısı 2c ölçüsü); bookN/** ve yazılmayan kök girdileri merkez dizinde aynı (crc + boyut +
 *      sıkışık boyut); menü assetId kümesi = Web-Z üyeleri, link adresleri = Web-Z, sıra = eşleme.
 *
 * BAŞARISIZLIK: her durum (ağ, ikili yok, eşleme, kapı) adımı ATLATIR, iş DÜŞMEZ; iş kopyası
 * aynen kalır. Sonuç `{durum, neden, ...}` döner; runner `job.kabukTazeleme`'ye yazar.
 *
 * ANAHTAR: `EMPP_SET_KABUK_TAZELE=1` (varsayılan KAPALI). İkili: `EMPP_WEBZ_KABUK_URET` ya da
 * `~/.empp-agent/araclar/webz-kabuk-uret` (kurulum: `tools/set-kabuk/kur-webz-kabuk-uret.sh`).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn } = require('child_process');
const M = require('./icerik-merdiven');
const K = require('./yazma-kapisi');
const setEk = require('./set-uyelik-ek');
const uretecKaynak = require('./uretec-kaynak');
const { webZKabukIndexiMi } = require('../packaging/set-menu-bicim');
const { motorKopyasiMi } = require('../packaging/set-menu');
const A1 = require('../packaging/a1-duzen');

const ISARET = '[set-kabuk]';
/** İkili sözleşmesi: tek motorlu sette `--kip tek-motor` (a1-arayuz.md). */
const KIP_TEK_MOTOR = 'tek-motor';
/** A1 kabuğunun kart bağlantısı imzası (language-set.js'te bulunmalı). */
const A1_KART_IMZASI = 'kapak=';
const kapakKlasoru = (id) => `kapak-${id}`;
const WEBZ_KOKU = 'https://webz.ydspublishing.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/126.0 Safari/537.36';
const IMZA = 'sonrakiSatirDugmesi';
const DIL_BETIGI = 'scripts/language-set.js';
const YAMA = 'scripts/cevrimdisi-yama.js';
const AYAR = 'config/settings.json';
const ARAC_SURESI_MS = 120000;
const KAPAK_ALT_SINIR = 1024; // 9 baytlık 404 gövdeleri kapak değildir (pilot)

function acik(env = process.env) {
  return String(env.EMPP_SET_KABUK_TAZELE || '') === '1';
}

function ikiliYolu(env = process.env) {
  return env.EMPP_WEBZ_KABUK_URET
    || path.join(os.homedir(), '.empp-agent', 'araclar', 'webz-kabuk-uret');
}

const bookNMi = (ad) => /^book\d+$/.test(ad);
const sayi = (ad) => Number(String(ad).replace(/\D/g, '')) || 0;

// ─── Saf kararlar ───────────────────────────────────────────────────────────────────────────

/**
 * Zip girdi adlarından kök öneki (tek sarmalayıcı klasör) — yazma kapısı ile aynı tolerans. SAF.
 * @param {string[]} adlar dosya girdileri (dizin girdileri hariç)
 */
function onEkBul(adlar) {
  const kokler = [...new Set(adlar.map((a) => a.split('/')[0]))];
  return kokler.length === 1 && adlar.length && adlar.every((a) => a.includes('/')) ? `${kokler[0]}/` : '';
}

/**
 * Build düzeni uygun mu. SAF.
 * @param {{adlar: Set<string>, kokIndexHtml: string|null}} o  adlar önek SIYRILMIŞ
 * A1 kipinde ek alanlar: `kip: 'a1'`, `motorKaynagi` (`index.html` = ilk dönüşüm,
 * `kapak/index.html` = zaten A1; motor sayfası yeniden yazılmaz).
 * @returns {{uygun: boolean, neden: string|null, bookNler: string[], kokTuru: string|null,
 *   kip?: 'a1', motorKaynagi?: string}}
 */
function uygunluk({ adlar, kokIndexHtml }) {
  const bookNler = [...new Set([...adlar].map((a) => a.split('/')[0]).filter(bookNMi))]
    .filter((d) => adlar.has(`${d}/index.html`))
    .sort((a, b) => sayi(a) - sayi(b));
  if (!bookNler.length) {
    if (adlar.has('classlibraries/ImWin32.dll')) {
      const html = kokIndexHtml == null ? null : String(kokIndexHtml);
      if (adlar.has(A1.A1_MOTOR_SAYFASI)) {
        if (html != null && webZKabukIndexiMi(html) && !motorKopyasiMi(html)) {
          return { uygun: true, neden: null, bookNler, kokTuru: 'a1', kip: 'a1', motorKaynagi: A1.A1_MOTOR_SAYFASI };
        }
        return { uygun: false, neden: `tek-motor: ${A1.A1_MOTOR_SAYFASI} var ama kök index sf425 kabuğu değil`, bookNler, kokTuru: 'tek-motor' };
      }
      if (html != null && motorKopyasiMi(html)) {
        return { uygun: true, neden: null, bookNler, kokTuru: 'tek-motor', kip: 'a1', motorKaynagi: 'index.html' };
      }
      return { uygun: false, neden: 'tek-motor: kök index motor sayfası değil (dokunulmaz)', bookNler, kokTuru: 'tek-motor' };
    }
    return { uygun: false, neden: 'bookN düzeni yok', bookNler, kokTuru: null };
  }
  if (kokIndexHtml == null) return { uygun: false, neden: 'kök index.html yok', bookNler, kokTuru: null };
  const html = String(kokIndexHtml);
  if (html.includes(DIL_BETIGI) && !html.includes('name="empp-webz-tema"')) {
    return { uygun: true, neden: null, bookNler, kokTuru: 'sf425' };
  }
  if (motorKopyasiMi(html)) return { uygun: true, neden: null, bookNler, kokTuru: 'motor-kopyasi' };
  return {
    uygun: false, neden: 'kök index sf425 kabuğu ya da motor kopyası değil (dokunulmaz)', bookNler, kokTuru: 'diger',
  };
}

/**
 * Web-Z `settings.json` → SIRALI üye listesi. SAF.
 * SIRA: bütün üyelerde sayısal `displayOrder` varsa ona göre (kararlı: eşitlikte JSON anahtar sırası) —
 * Swift `WebZKabukGirdisi.webZAyari` ile aynı kural; tema da yamada `displayOrder`'a göre dizer. Biri
 * bile eksikse JSON anahtar sırası (Web-Z `generateSettingsJson` sırası).
 * @returns {Array<{anahtar:string, assetId:string, title:string, contentType:string, link:boolean,
 *   url:string, group:string}>}
 */
function webzListesi(ayar) {
  const books = ayar && ayar.books && typeof ayar.books === 'object' ? ayar.books : {};
  const temiz = (s) => String(s == null ? '' : s).trim();
  const girdiler = Object.entries(books).filter(([, b]) => b && typeof b === 'object');
  const sirali = girdiler.length && girdiler.every(([, b]) => typeof b.displayOrder === 'number'
    && Number.isFinite(b.displayOrder));
  if (sirali) girdiler.sort((a, b) => a[1].displayOrder - b[1].displayOrder); // Array#sort kararlıdır
  return girdiler.map(([anahtar, b]) => {
    const link = b.type === 'link' || b.contentType === 'link';
    return {
      anahtar, assetId: link ? '' : temiz(b.assetId), title: temiz(b.title),
      contentType: link ? 'link' : (temiz(b.contentType) || 'book'), link, url: link ? temiz(b.url) : '',
      group: temiz(b.group),
    };
  });
}

/**
 * Web-Z listesi + yazma kapısı kimlik çözümü → Swift aracının eşleme dosyası. SAF.
 * @param {{liste: ReturnType<typeof webzListesi>, kapi: {kitaplar: Array<{n:number,id:string|null}>,
 *   webzVarliklari?: Array<{n:number,id:string}>}, setAdi: string, kip?: string}} o
 *   `kip: 'tek-motor'` (A1): klasör `bookN` değil `kapak-<id>` (menü anahtarı); her kitap `kapak`
 *   alanını (= kök ImWin32 kapak kimliği) taşır — ikili kart bağlantısını bununla kurar.
 * @returns {{girdi: {setTitle:string, kitaplar: object[]}|null, eksik: string[], notlar: string[]}}
 */
function eslemeKur({ liste, kapi, setAdi, kip = null }) {
  const tekMotor = kip === KIP_TEK_MOTOR;
  // assetId → klasör. Aynı kimlik İKİ klasörde ise hangisinin açılacağı belirsiz (Swift ilkini, sözlük
  // sonuncuyu alırdı) → eşleme kurulmaz, adım atlanır (kart yanlış kitabı açmasın).
  const sahipler = new Map();
  const ekle = (id, n) => {
    const k = tekMotor ? kapakKlasoru(id) : `book${n}`;
    if (!sahipler.has(id)) sahipler.set(id, new Set());
    sahipler.get(id).add(k);
  };
  for (const k of (kapi && kapi.kitaplar) || []) if (k.id != null) ekle(String(k.id), k.n);
  for (const w of (kapi && kapi.webzVarliklari) || []) ekle(String(w.id), w.n);
  const eksik = [];
  const notlar = [];
  const listeIdler = new Set(liste.filter((g) => !g.link).map((g) => g.assetId));
  for (const [id, kume] of sahipler) {
    if (kume.size > 1 && listeIdler.has(id)) {
      eksik.push(`çakışma: assetId ${id} birden çok klasörde (${[...kume].sort().join(', ')})`);
    }
  }
  if (eksik.length) return { girdi: null, eksik, notlar };
  const klasor = new Map([...sahipler].map(([id, kume]) => [id, [...kume][0]]));
  const kitaplar = [];
  const alinan = new Set();
  for (const g of liste) {
    if (g.link) {
      if (!/^https?:\/\/\S+$/i.test(g.url)) {
        notlar.push(`${g.anahtar}: link adresi http(s) değil — atlandı`);
        continue;
      }
      kitaplar.push({ klasor: g.anahtar, title: g.title || 'Kısayol', contentType: 'link', type: 'link', url: g.url });
      continue;
    }
    const k = klasor.get(g.assetId);
    if (!k) { eksik.push(`${g.anahtar} (${g.title}, assetId ${g.assetId || '-'})`); continue; }
    if (alinan.has(k)) { eksik.push(`${g.anahtar} (${g.title}): ${k} başka üyeye eşlendi`); continue; }
    alinan.add(k);
    if (k !== g.anahtar) notlar.push(`${g.anahtar} → ${k} (assetId ${g.assetId})`);
    kitaplar.push({
      klasor: k, ...(tekMotor ? { kapak: g.assetId } : {}), assetId: g.assetId, title: g.title,
      contentType: g.contentType, ...(g.group ? { group: g.group } : {}), anahtar: g.anahtar,
    });
  }
  if (eksik.length) return { girdi: null, eksik, notlar };
  return { girdi: { setTitle: setAdi, kitaplar }, eksik, notlar };
}

/** Kapak gövdesi gerçek görsel mi (PNG/JPEG imzası, ≥1 KB). SAF. */
function kapakGecerli(veri) {
  if (!Buffer.isBuffer(veri) || veri.length < KAPAK_ALT_SINIR) return false;
  const png = veri[0] === 0x89 && veri[1] === 0x50 && veri[2] === 0x4e && veri[3] === 0x47;
  const jpg = veri[0] === 0xff && veri[1] === 0xd8;
  return png || jpg;
}

/**
 * Üretim Masası `WebZTemaUretici.yaz`'ın yazabileceği kök dosyaları (beyaz liste). SAF.
 * Kaynak: `kopyalanacaklar` + settings/yama/yedek stil/index/set-menu + kapaklar (`images/<klasör>.png|jpg`).
 */
const KABUK_SABIT = new Set([
  'index.html', 'set-menu.json', AYAR, YAMA, 'styles/cevrimdisi.css',
  'styles/language-set.css', 'styles/language-animations.css',
  'scripts/language-loader.js', 'scripts/xmlParser.js', 'scripts/language-animations.js',
  'scripts/book-preloader.js', 'scripts/onboarding.js', DIL_BETIGI,
  'languages/tr.json', 'languages/en.json', 'images/logo.png', 'images/bg.jpg', 'images/arkaplan.png',
]);
function kabukDosyasiMi(yol, klasorler) {
  if (KABUK_SABIT.has(yol)) return true;
  if (/^features\/[a-z0-9-]+\.html$/.test(yol)) return true;
  const m = /^images\/([^/]+)\.(png|jpg)$/.exec(yol);
  return Boolean(m && klasorler.has(m[1]));
}

/**
 * Yazım sonrası kapı (merkez dizin önce/sonra + kabuk metinleri). SAF.
 * @param {{once: Map, sonra: Map, onEk: string, yazilan: string[], beklenen: {kitaplar: object[]},
 *   metin: {dil: string|null, yama: string|null, ayar: string|null, index: string|null,
 *   kapak?: string|null}, kip?: 'a1'|null, motorKaynagi?: string|null}} o
 *   A1 (`kip: 'a1'`): `kapak/index.html` yalnız paketleyici (bu adım) yazar; A1 başlığı doğru ve
 *   başlık çıkınca kaynak motor sayfasıyla (`motorKaynagi`, ilk dönüşümde) bayt-aynı olmalı;
 *   dil betiği kart imzası (`kapak=`) taşır; menüde her kitap `kapak` = assetId, `path` = `kapak`.
 * @returns {string[]} ihlal satırları
 */
function kapiDenetle({ once, sonra, onEk, yazilan, beklenen, metin, kip = null, motorKaynagi = null }) {
  const ihlal = [];
  const a1 = kip === 'a1';
  // Yazılan her kök dosyası kabuğun bilinen dosyası olmalı (electron.js, kök assets/** vb. → RED).
  const klasorler = new Set((beklenen.kitaplar || []).map((k) => k.klasor));
  for (const y of yazilan) {
    if (a1 && y === A1.A1_MOTOR_SAYFASI) continue;
    if (!kabukDosyasiMi(y, klasorler)) ihlal.push(`beklenmeyen kabuk dosyası: ${y}`);
  }
  if (a1) {
    const kapak = metin.kapak == null ? null : String(metin.kapak);
    for (const i of A1.kapakDenetle(kapak)) ihlal.push(`A1: ${i}`);
    if (kapak != null && motorKaynagi != null && A1.baslikCikar(kapak) !== String(motorKaynagi)) {
      ihlal.push(`A1: ${A1.A1_MOTOR_SAYFASI} başlık dışında kaynak motor sayfasından farklı`);
    }
    if (metin.dil && !metin.dil.includes(A1_KART_IMZASI)) {
      ihlal.push(`A1: ${DIL_BETIGI} kart imzası yok (${A1_KART_IMZASI}) — ikili tek-motor kipini uygulamadı`);
    }
  }
  const yazilanKume = new Set(yazilan.map((y) => `${onEk}${y}`));
  for (const [ad, g] of once) {
    if (g.dizin) continue;
    const s = sonra.get(ad);
    if (!s) { ihlal.push(`silindi: ${ad}`); continue; }
    if (yazilanKume.has(ad) && !bookNMi(ad.slice(onEk.length).split('/')[0])) continue;
    if (s.crc !== g.crc || s.boyut !== g.boyut || s.sikisik !== g.sikisik) ihlal.push(`değişti: ${ad}`);
  }
  for (const [ad, s] of sonra) {
    if (once.has(ad) || s.dizin) continue;
    const goreli = ad.slice(onEk.length);
    if (bookNMi(goreli.split('/')[0])) ihlal.push(`bookN altına eklendi: ${ad}`);
    else if (!yazilanKume.has(ad)) ihlal.push(`izin dışı eklendi: ${ad}`);
  }
  if (!metin.dil || !metin.dil.includes(IMZA)) ihlal.push(`${DIL_BETIGI}: ${IMZA} yok (yeni kabuk değil)`);
  if (!metin.index || !webZKabukIndexiMi(metin.index) || motorKopyasiMi(metin.index)) {
    ihlal.push('kök index.html Web-Z kabuğu değil');
  } else {
    // Yazma kapısı 2c ile aynı ölçü: kök index'in yerel başvuruları zip'te olmalı.
    const eksik = K.indexYerelReferanslari(metin.index).filter((y) => !sonra.has(`${onEk}${y}`));
    if (eksik.length) ihlal.push(`kök index yerel başvurusu zip'te yok: ${eksik.slice(0, 3).join(', ')}`);
  }
  let books = null;
  try {
    books = setEk.menuBooksOku(metin.yama, metin.ayar);
  } catch (e) {
    ihlal.push(`menü okunamadı: ${String(e && e.message || e).slice(0, 120)}`);
    return ihlal;
  }
  if (!books || typeof books !== 'object') {
    ihlal.push('menü (settings.books) yok');
    return ihlal;
  }
  const sirali = Object.entries(books).sort((a, b) => (a[1].displayOrder ?? 0) - (b[1].displayOrder ?? 0));
  const bekKitap = beklenen.kitaplar.filter((k) => k.contentType !== 'link');
  const bekId = [...new Set(bekKitap.map((k) => String(k.assetId)))].sort();
  const yeniId = [...new Set(sirali.filter(([, b]) => b.type !== 'link').map(([, b]) => String(b.assetId)))].sort();
  if (bekId.join(',') !== yeniId.join(',')) ihlal.push(`menü assetId kümesi ${yeniId.join(',')} ≠ Web-Z ${bekId.join(',')}`);
  const bekLink = beklenen.kitaplar.filter((k) => k.contentType === 'link').map((k) => k.url).sort();
  const yeniLink = sirali.filter(([, b]) => b.type === 'link').map(([, b]) => String(b.url)).sort();
  if (bekLink.join(' ') !== yeniLink.join(' ')) ihlal.push(`link adresleri ${yeniLink.length} ≠ Web-Z ${bekLink.length}`);
  const sira = sirali.map(([k]) => k).join(',');
  const bekSira = beklenen.kitaplar.map((k) => k.klasor).join(',');
  if (sira !== bekSira) ihlal.push(`menü sırası ${sira} ≠ Web-Z ${bekSira}`);
  for (const k of bekKitap) {
    const b = books[k.klasor];
    if (!b) { ihlal.push(`${k.klasor}: menüde yok`); continue; }
    if (String(b.assetId) !== String(k.assetId)) ihlal.push(`${k.klasor}: assetId ${b.assetId} ≠ Web-Z ${k.assetId}`);
    if (String(b.contentType || 'book') !== String(k.contentType || 'book')) {
      ihlal.push(`${k.klasor}: contentType ${b.contentType} ≠ Web-Z ${k.contentType}`);
    }
    if (a1) {
      if (String(b.kapak) !== String(k.assetId)) ihlal.push(`A1: ${k.klasor}: kapak ${b.kapak} ≠ assetId ${k.assetId}`);
      if (b.path !== 'kapak') ihlal.push(`A1: ${k.klasor}: path ${b.path} ≠ kapak`);
    }
  }
  return ihlal;
}

// ─── IO ─────────────────────────────────────────────────────────────────────────────────────

/** Varsayılan GET: tarayıcı UA, 20 sn. Döner {status, govde: Buffer}. */
async function varsayilanGetir(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  return { status: r.status, govde: Buffer.from(await r.arrayBuffer()) };
}

function metinAl(zipYolu, dizin, ad) {
  const g = dizin.get(ad);
  if (!g) return null;
  try { return M.zipGirdiOku(zipYolu, g).toString('utf8'); } catch (_) { return null; }
}

async function dosyalariTopla(kok, alt = '') {
  const out = [];
  for (const e of await fsp.readdir(path.join(kok, alt), { withFileTypes: true })) {
    const goreli = alt ? `${alt}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await dosyalariTopla(kok, goreli));
    else if (e.isFile()) out.push(goreli);
  }
  return out;
}

/**
 * İkiliyi süre sınırıyla koşturur; süre dolunca süreç SIGKILL ile ÖLDÜRÜLÜR (asılı araç ajan
 * ömrü boyunca kalmasın). Döner {code, pid, stdout, stderr}; zaman aşımında code -2.
 */
function ikiliKostur(cmd, args, { zamanAsimiMs = ARAC_SURESI_MS } = {}) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e && e.message) });
      return;
    }
    let out = '';
    let err = '';
    let doldu = false;
    const z = setTimeout(() => { doldu = true; p.kill('SIGKILL'); }, zamanAsimiMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(z); resolve({ code: -1, stdout: out, stderr: `${err}${e.message}` }); });
    p.on('close', (code) => {
      clearTimeout(z);
      resolve(doldu ? { code: -2, pid: p.pid, stdout: out, stderr: `zaman aşımı (${zamanAsimiMs} ms), süreç öldürüldü` }
        : { code, pid: p.pid, stdout: out, stderr: err });
    });
  });
}

/**
 * Adımı koşturur. Hiçbir hata FIRLATMAZ (runner işi düşürmez); iş kopyası ya kapıdan geçmiş yeni
 * hâli ya aynen eskisidir.
 * @param {{zip: string, calisma: string, job: object, log?: Function, warn?: Function, env?: object,
 *   getir?: Function, komut?: Function, ikili?: string, platform?: string, webzKoku?: string}} o
 * @returns {Promise<{durum: 'uygulandi'|'guncel'|'atlandi', neden: string|null, kisaKod?: string,
 *   kitaplar?: string[], notlar?: string[], dosyaSayisi?: number, sureMs: number}>}
 */
async function kabukTazele(o) {
  const log = o.log || (() => {});
  const warn = o.warn || log;
  const env = o.env || process.env;
  const getir = o.getir || varsayilanGetir;
  const komut = o.komut || M.komut;
  const platform = o.platform || process.platform;
  const webzKoku = o.webzKoku || WEBZ_KOKU;
  const basla = Date.now();
  const rapor = { durum: 'atlandi', neden: null };
  const bitir = (neden, ek = {}) => {
    Object.assign(rapor, ek, { neden, sureMs: Date.now() - basla });
    const etiket = { uygulandi: 'UYGULANDI', guncel: 'GÜNCEL' }[rapor.durum] || 'ATLANDI';
    const satir = `${ISARET} ${etiket}`
      + `${neden ? ` — ${neden}` : ''}${o.job && o.job.bookId ? ` (${o.job.bookId})` : ''}`;
    (rapor.durum === 'atlandi' ? warn : log)(satir);
    return rapor;
  };

  if (platform !== 'darwin') return bitir('yalnız Mac (darwin) — başsız Swift ikilisi');
  const ikili = o.ikili || ikiliYolu(env);
  try { fs.accessSync(ikili, fs.constants.X_OK); } catch (_) { return bitir(`ikili yok: ${ikili}`); }
  const kod = o.job && o.job.kisaKod ? String(o.job.kisaKod).trim() : '';
  if (!/^[a-z0-9]{3,12}$/i.test(kod)) return bitir('kisaKod yok (claim) — Web-Z adresi kurulamaz');
  rapor.kisaKod = kod;

  // 1. Uygunluk (merkez dizin; içerik açılmaz).
  let once;
  try { once = M.zipDizini(o.zip); } catch (e) { return bitir(`zip okunamadı: ${e.message}`); }
  const dosyalar = [...once.values()].filter((g) => !g.dizin).map((g) => g.ad)
    .filter((a) => !/(^|\/)(__MACOSX|\._)/.test(a));
  const onEk = onEkBul(dosyalar);
  const adlar = new Set(dosyalar.filter((a) => a.startsWith(onEk)).map((a) => a.slice(onEk.length)));
  const eskiIndex = metinAl(o.zip, once, `${onEk}index.html`);
  const u = uygunluk({ adlar, kokIndexHtml: eskiIndex });
  if (!u.uygun) return bitir(u.neden, { kokTuru: u.kokTuru });
  rapor.kokTuru = u.kokTuru;
  const a1 = u.kip === 'a1';
  if (a1) rapor.kip = 'a1';
  // A1 yolunda her ATLANDI nedeni "A1 atlandı" ile başlar (log'da eski davranışın korunduğu görünsün).
  const atla = (neden, ek) => bitir(a1 ? `A1 atlandı — ${neden} (eski düzen korundu)` : neden, ek);

  // 2. Web-Z ayarı.
  const taban = `${webzKoku}/go/${kod}/web-stream`;
  let ayar;
  try {
    const r = await getir(`${taban}/config/settings.json`);
    if (r.status !== 200) return atla(`Web-Z settings.json HTTP ${r.status}`);
    ayar = JSON.parse(r.govde.toString('utf8'));
  } catch (e) {
    return atla(`Web-Z settings.json alınamadı: ${String(e && e.message || e).slice(0, 120)}`);
  }
  const liste = webzListesi(ayar);
  if (!liste.some((g) => !g.link)) return bitir('Web-Z listesinde kitap yok');

  // 3. Kimlik eşlemesi (yazma kapısının çözümü; liste = Web-Z).
  let kapi;
  try {
    kapi = K.yazmaKapisi({ zipYolu: o.zip, setListesi: uretecKaynak.ayarlardanListe(ayar) || '' });
  } catch (e) {
    return atla(`kimlik çözümü: ${String(e && e.message || e).slice(0, 120)}`);
  }
  const es = eslemeKur({ liste, kapi, setAdi: String(ayar.setTitle || ''), kip: a1 ? KIP_TEK_MOTOR : null });
  if (!es.girdi) return atla(`eşlenemeyen Web-Z üyesi: ${es.eksik.join('; ')}`, { notlar: es.notlar });
  rapor.notlar = es.notlar;
  for (const n of es.notlar) log(`${ISARET} eşleme: ${n}`);

  const sahne = path.join(o.calisma, `set-kabuk-${crypto.randomBytes(4).toString('hex')}`);
  const aday = `${o.zip}.kabuk-aday`;
  try {
    const kok = path.join(sahne, 'kok');
    const kapakDizini = path.join(sahne, 'kapak');
    await fsp.mkdir(kapakDizini, { recursive: true });
    // 4a. Kapaklar (Web-Z anahtarıyla istenir, klasör adıyla verilir). Biri eksikse adım atlanır.
    for (const k of es.girdi.kitaplar.filter((x) => x.contentType !== 'link')) {
      let r;
      try {
        r = await getir(`${taban}/images/${encodeURIComponent(k.anahtar)}.png?a=${encodeURIComponent(k.assetId)}`);
      } catch (e) {
        return atla(`kapak alınamadı (${k.anahtar}): ${String(e && e.message || e).slice(0, 80)}`);
      }
      if (!r || r.status !== 200 || !kapakGecerli(r.govde)) {
        return atla(`kapak geçersiz (${k.anahtar}): HTTP ${r && r.status}, ${r && r.govde ? r.govde.length : 0} bayt`);
      }
      await fsp.writeFile(path.join(kapakDizini, `kapak-${k.klasor}.png`), r.govde);
    }
    // 4b. Gölge kök: yalnız bookN/index.html taslakları (ikili klasör varlığını bundan ölçer).
    //     A1: gölge kök BOŞ — kitaplar girdideki `kapak` kimlikleriyle verilir (bookN yok).
    await fsp.mkdir(kok, { recursive: true });
    for (const d of u.bookNler) {
      await fsp.mkdir(path.join(kok, d), { recursive: true });
      await fsp.writeFile(path.join(kok, d, 'index.html'), '');
    }
    const girdiYolu = path.join(sahne, 'girdi.json');
    const girdi = {
      ...(a1 ? { kip: KIP_TEK_MOTOR, motorSayfasi: A1.A1_MOTOR_SAYFASI } : {}),
      ...es.girdi, kitaplar: es.girdi.kitaplar.map(({ anahtar, ...k }) => k),
    };
    await fsp.writeFile(girdiYolu, JSON.stringify(girdi, null, 2));
    const argumanlar = a1 ? ['--kip', KIP_TEK_MOTOR, kok, girdiYolu, kapakDizini] : [kok, girdiYolu, kapakDizini];
    const r = await ikiliKostur(ikili, argumanlar, { zamanAsimiMs: o.aracSuresiMs || ARAC_SURESI_MS });
    if (r.code !== 0) {
      const ham = String(r.stderr || '').trim().slice(-200);
      // Eski ikili `--kip`i tanımaz (kullanım satırı / çıkış ≠ 0): A1 atlanır, iş kopyası aynen kalır.
      return atla(a1 ? `webz-kabuk-uret tek-motor kipini tanımıyor ya da başarısız (çıkış ${r.code}): ${ham}`
        : `webz-kabuk-uret çıkış ${r.code}: ${ham}`);
    }
    const hepsi = await dosyalariTopla(kok);
    // İkili bookN/ altına HİÇBİR şey yazmamalı (taslak index.html boş kalmalı): yazdıysa araç yanlış
    // köke yazıyordur — çıktı güvenilmez, adım atlanır (bookN içeriği zaten zip'e gitmez).
    const bookNYazilan = hepsi.filter((y) => bookNMi(y.split('/')[0])
      && !(y === `${y.split('/')[0]}/index.html` && fs.statSync(path.join(kok, y)).size === 0));
    if (bookNYazilan.length) return atla(`ikili bookN altına yazdı: ${bookNYazilan.slice(0, 3).join(', ')}`);
    // A1: motor sayfasını (kapak/**) YALNIZ bu adım yazar; ikili yazdıysa çıktı güvenilmez.
    const kapakYazilan = hepsi.filter((y) => y.split('/')[0] === 'kapak');
    if (kapakYazilan.length) return atla(`ikili kapak/ altına yazdı: ${kapakYazilan.slice(0, 3).join(', ')}`);
    const yazilan = hepsi.filter((y) => !bookNMi(y.split('/')[0]) && !y.startsWith('_eski/')).sort();
    if (!yazilan.includes('index.html') || !yazilan.includes(DIL_BETIGI)) {
      return atla(`ikili kabuk yazmadı (${yazilan.length} dosya)`);
    }
    // 4b'. A1 ilk dönüşüm: kökteki motor index.html → kapak/index.html (A1 başlığıyla). Zaten A1
    //      ise (motor kapak/index.html'de) motor sayfasına dokunulmaz.
    if (a1 && u.motorKaynagi === 'index.html') {
      let kapakHtml;
      try { kapakHtml = A1.baslikEkle(eskiIndex); } catch (e) { return atla(String(e.message)); }
      await fsp.mkdir(path.join(kok, 'kapak'), { recursive: true });
      await fsp.writeFile(path.join(kok, A1.A1_MOTOR_SAYFASI), kapakHtml);
      yazilan.push(A1.A1_MOTOR_SAYFASI);
      yazilan.sort();
    }

    // 4c. Değişmezlik: üretilen dosyalar zip'tekiyle aynıysa yazılmaz (aynı kabuk her r2-kur'da yeni
    // R2 sürümü açtırmasın). `set-menu.json` her üretimde yeni UUID taşır — kıyasa girmez.
    const degisen = yazilan.filter((y) => {
      if (y === 'set-menu.json') return false;
      const g = once.get(`${onEk}${y}`);
      if (!g) return true;
      const v = fs.readFileSync(path.join(kok, y));
      return g.boyut !== v.length || g.crc !== zlib.crc32(v);
    });
    if (!degisen.length) {
      rapor.durum = 'guncel';
      return bitir('kabuk zaten güncel (değişen dosya yok) — zip değişmedi');
    }

    // 5. Aday klona yaz → kapı → rename.
    await fsp.rm(aday, { force: true });
    await fsp.copyFile(o.zip, aday, fs.constants.COPYFILE_FICLONE);
    let girdiler = yazilan;
    let cwd = kok;
    if (onEk) {
      // Sarmalayıcı klasörlü zip: dosyalar aynı önekle yazılır.
      const sarma = path.join(sahne, 'sarma');
      await fsp.mkdir(sarma, { recursive: true });
      await fsp.rename(kok, path.join(sarma, onEk.replace(/\/$/, '')));
      cwd = sarma;
      girdiler = yazilan.map((y) => `${onEk}${y}`);
    }
    const z = await komut('zip', ['-q', '-D', '-X', '-n', M.SIKISIK_UZANTILAR, path.resolve(aday), ...girdiler], { cwd });
    if (z.code !== 0) return atla(`zip yazılamadı (${z.code}): ${String(z.stderr).slice(-200)}`);
    const sonra = M.zipDizini(aday);
    const ihlal = kapiDenetle({
      once, sonra, onEk, yazilan, beklenen: girdi,
      kip: a1 ? 'a1' : null,
      motorKaynagi: a1 && u.motorKaynagi === 'index.html' ? eskiIndex : null,
      metin: {
        dil: metinAl(aday, sonra, `${onEk}${DIL_BETIGI}`),
        yama: metinAl(aday, sonra, `${onEk}${YAMA}`),
        ayar: metinAl(aday, sonra, `${onEk}${AYAR}`),
        index: metinAl(aday, sonra, `${onEk}index.html`),
        ...(a1 ? { kapak: metinAl(aday, sonra, `${onEk}${A1.A1_MOTOR_SAYFASI}`) } : {}),
      },
    });
    if (ihlal.length) {
      return atla(`kapı RED (${ihlal.length}; ilk: ${ihlal[0]}) — iş kopyası DEĞİŞMEDİ`, { ihlal });
    }
    await fsp.rename(aday, o.zip);
    rapor.durum = 'uygulandi';
    return bitir(null, {
      kitaplar: girdi.kitaplar.map((k) => k.klasor), dosyaSayisi: yazilan.length, degisenSayisi: degisen.length,
      setAdi: girdi.setTitle,
    });
  } catch (e) {
    return atla(`beklenmeyen hata: ${String(e && e.message || e).slice(0, 200)} — iş kopyası DEĞİŞMEDİ`);
  } finally {
    await fsp.rm(aday, { force: true }).catch(() => {});
    await fsp.rm(sahne, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  ISARET, WEBZ_KOKU, IMZA, acik, ikiliYolu, onEkBul, uygunluk, webzListesi, eslemeKur, kapakGecerli,
  kapiDenetle, kabukDosyasiMi, ikiliKostur, kabukTazele, KIP_TEK_MOTOR, A1_KART_IMZASI,
};
