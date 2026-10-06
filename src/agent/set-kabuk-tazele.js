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
 *
 * KABUK KAYNAĞI (06.10, `arastirma/set-kabuk-0510/kabuk-eki-tasarim.md`): `o.kabukKaynagi` ??
 * `EMPP_SET_KABUK_KAYNAGI` ?? (darwin ? 'ikili' : 'yok').
 *   'ikili' = Swift ikilisi (bugünkü yol, değişmez)
 *   'yok'   = adım atlanır (bugünkü Linux davranışı)
 *   'ek'    = ProBook: aynı JS ile girdi parmak izi (`girdiSha`) → CDN'deki kabuk eki
 *             (`kabuk-ek.js`; Mac `tools/set-kabuk/ek-uret.js` üretir) → dosyalar gölge köke
 *             (Swift'in yerine) → aşağıdaki BÜTÜN kapılar aynen. Ek yok/bayat/bozuk/ret, ağ hatası
 *             ya da kapı RED → `durum: 'ertele'` (runner kilit + kira bırakır, failed YAZMAZ): eski
 *             kabukla kaynak ÇIKMAZ (45551 2.51.3 dersi). Set uygun değilse (bookN yok, tek kitap)
 *             bugünkü gibi 'atlandi'.
 * `o.ekCikti` (yalnız 'ikili'): kapı GEÇTİ'den sonra, rename'den önce üretilen kabuk dosyaları
 * dışarı verilir (Mac ek paketleyicisi). Kabuk zaten güncelse mevcut zip kapıdan geçerse yine.
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
const ig = require('../runtime/icerik-guncelleme');

const ISARET = '[set-kabuk]';
/** İkili sözleşmesi: tek motorlu sette `--kip tek-motor` (a1-arayuz.md). */
const KIP_TEK_MOTOR = 'tek-motor';
/** A1 kabuğunun kart bağlantısı imzası (language-set.js `kitapAcmaAdresi`, Swift 199bac1b). */
const A1_KART_IMZASI = 'kapak/index.html?kapak=';
/** A1 ikilisinin gölge kökte okuduğu girdiler (Swift 49bf319f): menü + motor sayfası + assets/<id>. */
const A1_MENU = 'classlibraries/ImWin32.dll';
const kapakKlasoru = (id) => `kapak-${id}`;
const WEBZ_KOKU = 'https://webz.ydspublishing.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/126.0 Safari/537.36';
const IMZA = 'sonrakiSatirDugmesi';
const DIL_BETIGI = 'scripts/language-set.js';
const YAMA = 'scripts/cevrimdisi-yama.js';
const AYAR = 'config/settings.json';
const ARAC_SURESI_MS = 120000;
const KABUK_KAYNAKLARI = new Set(['ikili', 'ek', 'yok']);
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const KAPAK_ALT_SINIR = 1024; // 9 baytlık 404 gövdeleri kapak değildir (pilot)

function acik(env = process.env) {
  return String(env.EMPP_SET_KABUK_TAZELE || '') === '1';
}

/**
 * Kabuk kaynağı seçimi. SAF. Boş dize "verilmedi" sayılır (ProBook acil geri dönüşü: boşalt).
 * @param {{kabukKaynagi?: string|null, env?: object, platform?: string}} [o]
 * @returns {string} 'ikili' | 'ek' | 'yok' | (bilinmeyen değer aynen — kabukTazele atlar)
 */
function kabukKaynagiSec({
  kabukKaynagi = null, env = process.env, platform = process.platform,
} = {}) {
  const dolu = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
  return dolu(kabukKaynagi) ?? dolu(env.EMPP_SET_KABUK_KAYNAGI)
    ?? (platform === 'darwin' ? 'ikili' : 'yok');
}

/** Kabuk eki modülü (Parça A) — TEMBEL: modül yokken dosya yüklenebilsin; testler `o.kabukEk` verir. */
function kabukEkModulu(o = {}) {
  return o.kabukEk || require('./kabuk-ek');
}

/** Ek içindeki yol güvenli mi (göreli; `..`/mutlak/`_` önekli değil). SAF. Beyaz liste ayrı. */
function ekYoluGuvenli(yol) {
  const y = String(yol || '');
  if (!y || y.startsWith('/') || y.includes('\\') || /^[a-z]:/i.test(y)) return false;
  const parca = y.split('/');
  return !parca.some((p) => p === '' || p === '.' || p === '..') && !parca[0].startsWith('_');
}

/** Kabuk eki imza açık anahtarının (PEM) yolu. */
function ekAcikAnahtarYolu(env = process.env) {
  return env.EMPP_KABUK_EK_ACIK_ANAHTAR
    || path.join(os.homedir(), '.empp-agent', 'kabuk-ek-acik.pem');
}

/**
 * `kaynak-kur` DEĞİŞMEZİ (06.10, birleşik inceleme K1): Mac (darwin) Swift ikilisiyle kabuğu kurar.
 * Başka platform build'i ancak kabuk tazeleme AÇIK + kabuk kaynağı 'ek' + GEÇERLİ ed25519 açık
 * anahtarı varken kurar; yoksa kabuk ESKİ kalıp yeni build.zip geçerli olur (45551 2.51.3).
 * Anahtarın yalnız varlığı yetmez: boş/bozuk/RSA dosya her eki `ek-imza` ile ertelerdi.
 * Heartbeat (yetenek ilanı) ve r2-kur iş anı aynı karardan geçer. SAF (oku enjekte).
 * @returns {{uygun: boolean, neden: string|null}}
 */
function kaynakKurKabukKarari({
  platform = process.platform, env = process.env, oku = fs.readFileSync,
} = {}) {
  if (platform === 'darwin') return { uygun: true, neden: null };
  const red = (neden) => ({ uygun: false, neden: `${platform}: ${neden}` });
  if (!acik(env)) return red('kabuk tazeleme kapalı (EMPP_SET_KABUK_TAZELE)');
  const k = kabukKaynagiSec({ env, platform });
  if (k !== 'ek') return red(`kabuk kaynağı '${k}' (yalnız 'ek' kurabilir)`);
  const anahtar = ekAcikAnahtarYolu(env);
  let pem;
  try { pem = oku(anahtar, 'utf8'); } catch (_) {
    return red(`kabuk eki açık anahtarı yok (${anahtar})`);
  }
  let tur = null;
  try { tur = crypto.createPublicKey(String(pem)).asymmetricKeyType; } catch (_) { tur = null; }
  if (tur !== 'ed25519') {
    return red(`kabuk eki açık anahtarı geçersiz (${anahtar}: ${tur || 'okunamadı'}, ed25519 değil)`);
  }
  return { uygun: true, neden: null };
}

/**
 * A1 girdi ÖZETİ (girdi parmak izi için; birleşik inceleme D9). Swift yalnız şu alanları okur:
 * menüde kapak kimliği + `actName`, `BookContent.xml`'de İLK `<Unit name>`, motor sayfasının
 * varlığı (içeriği değil — üreteç tabanıyla R2 tabanı burada ayrışır, 06.10 ölçümü). Dosyanın tamamı yerine bu alanların sha'sı girer: merdiven iki makinede farklı içerik
 * (sürüm özniteliği, ünite gövdesi) üretse de aynı kabuk girdisi aynı parmak izini verir. SAF.
 * @param {Map<string, Buffer>} a1Girdi
 * @returns {Object<string, string>} yol → sha256 hex
 */
function a1GirdiOzeti(a1Girdi) {
  const out = {};
  for (const [y, v] of a1Girdi) {
    if (/^assets\/[^/]+\/data\/BookContent\.xml$/.test(y)) {
      const m = /<Unit\b[^>]*?\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(v.toString('utf8'));
      const ad = m ? String(m[1] ?? m[2] ?? '').trim() : '';
      out[y] = sha256(`ilk-unite:${ad}`);
    } else if (y === A1_MENU) {
      let liste = null;
      try {
        const xml = ig.menuCoz(v);
        if (xml) {
          liste = ig.kapaklar(xml).map((c) => {
            const a = /\bactName\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(c.etiket || '');
            return [String(c.ID || ''), a ? String(a[1] ?? a[2] ?? '').trim() : ''];
          });
        }
      } catch (_) { liste = null; }
      out[y] = liste ? sha256(`menu-kapaklar:${JSON.stringify(liste)}`) : sha256(v);
    } else if (y === A1.A1_MOTOR_SAYFASI) {
      // Swift motor sayfasının yalnız VARLIĞINA bakar (webz-kabuk-uret tek-motor: fileExists).
      // İçerik motor kalıbına bağlıdır: ölçüm 06.10 45485 — R2 2.51.5 (bundle bd0c1a…) ile üreteç
      // tabanı (kalıp 45549, bundle ab436b…) yalnız bu dosyada ayrıştı; diğer bütün girdiler aynı.
      // Motor sayfası ekte yok; ProBook kendi tabanından üretir ve A1 kapıları onu yerelde denetler.
      out[y] = sha256('motor-sayfasi:var');
    } else {
      out[y] = sha256(v);
    }
  }
  return out;
}

/**
 * r2-kur ön kontrolü (runner, taban indirilmeden): Mac bu kitap için ek yayınlamış mı. Fırlatmaz.
 * @returns {Promise<{var: boolean, neden: string|null, son?: object}>}
 */
async function ekSonKontrol({ bookId, getir = null, kabukEk = null } = {}) {
  let son;
  try {
    // getir verilmezse modülün kendi CDN getiricisi ({status, buffer} biçimi) kullanılır.
    const EK = kabukEkModulu({ kabukEk });
    son = await EK.sonOku({ bookId: String(bookId), ...(getir ? { getir } : {}) });
  } catch (e) {
    const m = String(e && e.message || e).slice(0, 120);
    return { var: false, neden: `son.json okunamadı: ${m}` };
  }
  if (!son || typeof son !== 'object') {
    return { var: false, neden: 'son.json yok (Mac bu kitap için ek üretmedi)' };
  }
  if (son.bookId != null && String(son.bookId) !== String(bookId)) {
    return { var: false, neden: `son.json başka kitabın (${son.bookId})` };
  }
  return { var: true, neden: null, son };
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
 *   dil betiği kart imzası (`kapak/index.html?kapak=`) taşır; menüde her kitap `kapak` = assetId,
 *   `path` = `.` (BookContent.xml kökteki `assets/<id>/data/`'da aranır).
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
      if (b.path !== '.') ihlal.push(`A1: ${k.klasor}: path ${b.path} ≠ .`);
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
 *   getir?: Function, komut?: Function, ikili?: string, platform?: string, webzKoku?: string,
 *   kabukKaynagi?: string, kabukEk?: object, cdnGetir?: Function, ekCikti?: Function}} o
 * @returns {Promise<{durum: 'uygulandi'|'guncel'|'atlandi'|'ertele', neden: string|null,
 *   kod?: string, kisaKod?: string, kitaplar?: string[], notlar?: string[], dosyaSayisi?: number,
 *   girdiSha?: string|null, girdi?: object, yazilanDosyalar?: string[], bookId?: string,
 *   sureMs: number}>}
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
  const bookId = o.job && o.job.bookId != null ? String(o.job.bookId) : '';
  const kaynagi = kabukKaynagiSec({ kabukKaynagi: o.kabukKaynagi, env, platform });
  const ekKipi = kaynagi === 'ek';
  const rapor = { durum: 'atlandi', neden: null, kabukKaynagi: kaynagi };
  const bitir = (neden, ek = {}) => {
    Object.assign(rapor, ek, { neden, sureMs: Date.now() - basla });
    const etiket = { uygulandi: 'UYGULANDI', guncel: 'GÜNCEL', ertele: 'ERTELE' }[rapor.durum]
      || 'ATLANDI';
    const satir = `${ISARET} ${etiket}`
      + `${neden ? ` — ${neden}` : ''}${bookId ? ` (${bookId})` : ''}`;
    (rapor.durum === 'atlandi' || rapor.durum === 'ertele' ? warn : log)(satir);
    return rapor;
  };
  // 'ek' kipinde set uygunsa her başarısızlık ERTELE: eski kabukla kaynak çıkmaz (§3 tablosu).
  const ertele = (kodu, neden, ek = {}) => {
    rapor.durum = 'ertele';
    return bitir(`kabuk eki (${kodu}): ${neden} — iş ertelenmeli, iş kopyası DEĞİŞMEDİ`,
      { kod: kodu, bookId, girdiSha: rapor.girdiSha ?? null, ...ek });
  };

  if (!KABUK_KAYNAKLARI.has(kaynagi)) return bitir(`bilinmeyen kabuk kaynağı: ${kaynagi}`);
  if (kaynagi === 'yok') {
    return bitir('yalnız Mac (darwin) — başsız Swift ikilisi (kabuk kaynağı yok)');
  }
  let ikili = null;
  if (!ekKipi) {
    if (platform !== 'darwin') return bitir('yalnız Mac (darwin) — başsız Swift ikilisi');
    ikili = o.ikili || ikiliYolu(env);
    try { fs.accessSync(ikili, fs.constants.X_OK); } catch (_) { return bitir(`ikili yok: ${ikili}`); }
  }

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
  // Uygun sette başarısızlık: 'ikili' → ATLANDI (bugünkü), 'ek' → ERTELE.
  const dur = (kodu, neden, ek) => (ekKipi ? ertele(kodu, neden, ek) : atla(neden, ek));
  // kisaKod denetimi uygunluktan SONRA: set olmayan iş 'ek' kipinde de ertelenmez (atlandi).
  const kod = o.job && o.job.kisaKod ? String(o.job.kisaKod).trim() : '';
  if (!/^[a-z0-9]{3,12}$/i.test(kod)) return dur('claim', 'kisaKod yok (claim) — Web-Z adresi kurulamaz');
  rapor.kisaKod = kod;

  // 2. Web-Z ayarı.
  const taban = `${webzKoku}/go/${kod}/web-stream`;
  let ayar;
  let webzSettingsSha = null;
  try {
    const r = await getir(`${taban}/config/settings.json`);
    if (r.status !== 200) return dur('ag', `Web-Z settings.json HTTP ${r.status}`);
    ayar = JSON.parse(r.govde.toString('utf8'));
    webzSettingsSha = sha256(r.govde);
  } catch (e) {
    return dur('ag', `Web-Z settings.json alınamadı: ${String(e && e.message || e).slice(0, 120)}`);
  }
  const liste = webzListesi(ayar);
  // 'ek' kipinde uygun sette boş Web-Z listesi ERTELE (eski kabukla kaynak çıkmaz); ikili: atlandi.
  if (!liste.some((g) => !g.link)) return dur('esleme', 'Web-Z listesinde kitap yok');

  // 3. Kimlik eşlemesi (yazma kapısının çözümü; liste = Web-Z).
  let kapi;
  try {
    kapi = K.yazmaKapisi({ zipYolu: o.zip, setListesi: uretecKaynak.ayarlardanListe(ayar) || '' });
  } catch (e) {
    return dur('esleme', `kimlik çözümü: ${String(e && e.message || e).slice(0, 120)}`);
  }
  // K1 (inceleme 05.10): tek kitaplı İmpark paketi de kök ImWin32 + motor index taşır; A1 yalnız
  // ≥2 kapaklı tek motorlu settir (yazma kapısı `kokMenuKapaklari` ve Windows kapısı `tekMotorMu`
  // ile aynı eşik). Altında A1'e çevirmek tek kartlı kabuk üretir → atla.
  if (a1) {
    const idli = (kapi.kitaplar || []).filter((k) => k && k.id != null && /^\d+$/.test(String(k.id)));
    if (idli.length < 2) return atla(`tek kitaplı paket (${idli.length} kapak) — A1 yalnız ≥2 kapaklı tek motorlu set`);
  }
  const es = eslemeKur({ liste, kapi, setAdi: String(ayar.setTitle || ''), kip: a1 ? KIP_TEK_MOTOR : null });
  if (!es.girdi) return dur('esleme', `eşlenemeyen Web-Z üyesi: ${es.eksik.join('; ')}`, { notlar: es.notlar });
  rapor.notlar = es.notlar;
  for (const n of es.notlar) log(`${ISARET} eşleme: ${n}`);

  const sahne = path.join(o.calisma, `set-kabuk-${crypto.randomBytes(4).toString('hex')}`);
  const aday = `${o.zip}.kabuk-aday`;
  try {
    const kok = path.join(sahne, 'kok');
    const kapakDizini = path.join(sahne, 'kapak');
    await fsp.mkdir(kapakDizini, { recursive: true });
    /** Kapak dosyası adı → sha256 (girdi parmak izinin parçası; ek bu kapaklara bağlı). */
    const kapakSha = {};
    /** Kapak dosyası adı → bayt (kabuk eki v2: referanslı `images/<klasör>.png` bundan dolar). */
    const kapakVeri = new Map();
    // 4a. Kapaklar (Web-Z anahtarıyla istenir, klasör adıyla verilir). Biri eksikse adım atlanır.
    for (const k of es.girdi.kitaplar.filter((x) => x.contentType !== 'link')) {
      let r;
      try {
        r = await getir(`${taban}/images/${encodeURIComponent(k.anahtar)}.png?a=${encodeURIComponent(k.assetId)}`);
      } catch (e) {
        return dur('ag', `kapak alınamadı (${k.anahtar}): ${String(e && e.message || e).slice(0, 80)}`);
      }
      if (!r || r.status !== 200 || !kapakGecerli(r.govde)) {
        return dur('ag', `kapak geçersiz (${k.anahtar}): HTTP ${r && r.status}, ${r && r.govde ? r.govde.length : 0} bayt`);
      }
      await fsp.writeFile(path.join(kapakDizini, `kapak-${k.klasor}.png`), r.govde);
      kapakSha[`kapak-${k.klasor}.png`] = sha256(r.govde);
      kapakVeri.set(`kapak-${k.klasor}.png`, r.govde);
    }
    // 4b. Gölge kök: yalnız bookN/index.html taslakları (ikili klasör varlığını bundan ölçer).
    //     A1 (Swift 49bf319f arayüzü): ikili kökte motor menüsünü (`classlibraries/ImWin32.dll`),
    //     motor sayfasını (`kapak/index.html` — araç yoksa DURUR, bu yüzden ikiliden ÖNCE konur) ve
    //     kitap başına `assets/<id>/` (+ başlık için `data/BookContent.xml`) okur. Kök `index.html`
    //     gölgeye KONMAZ: araç onu `_eski/`'ye taşırdı; `_` önekli kök dizin paket dışıdır
    //     (`kok-yedek-dizin-disla.js`) ve zip'e de yazılmaz (aşağıdaki süzgeç).
    await fsp.mkdir(kok, { recursive: true });
    for (const d of u.bookNler) {
      await fsp.mkdir(path.join(kok, d), { recursive: true });
      await fsp.writeFile(path.join(kok, d, 'index.html'), '');
    }
    /** A1 girdileri: göreli yol → konulan bayt (ikili DEĞİŞTİRMEMELİ; zip'e yazılmaz). */
    const a1Girdi = new Map();
    if (a1) {
      const zipGirdi = (y) => {
        const g = once.get(`${onEk}${y}`);
        return g && !g.dizin ? M.zipGirdiOku(o.zip, g) : null;
      };
      let motorHtml;
      if (u.motorKaynagi === 'index.html') {
        try { motorHtml = Buffer.from(A1.baslikEkle(eskiIndex)); } catch (e) { return dur('girdi', String(e.message)); }
      } else {
        motorHtml = zipGirdi(A1.A1_MOTOR_SAYFASI);
      }
      const menu = zipGirdi(A1_MENU);
      if (!motorHtml || !menu) return dur('girdi', `A1 girdisi okunamadı (${!menu ? A1_MENU : A1.A1_MOTOR_SAYFASI})`);
      a1Girdi.set(A1.A1_MOTOR_SAYFASI, motorHtml);
      a1Girdi.set(A1_MENU, menu);
      for (const k of es.girdi.kitaplar.filter((x) => x.contentType !== 'link')) {
        const id = String(k.kapak || k.assetId);
        await fsp.mkdir(path.join(kok, 'assets', id), { recursive: true });
        const bc = zipGirdi(`assets/${id}/data/BookContent.xml`);
        if (bc) a1Girdi.set(`assets/${id}/data/BookContent.xml`, bc);
      }
      for (const [y, v] of a1Girdi) {
        await fsp.mkdir(path.dirname(path.join(kok, y)), { recursive: true });
        await fsp.writeFile(path.join(kok, y), v);
      }
    }
    const girdiYolu = path.join(sahne, 'girdi.json');
    const girdi = {
      ...(a1 ? { kip: KIP_TEK_MOTOR, motorSayfasi: A1.A1_MOTOR_SAYFASI } : {}),
      ...es.girdi, kitaplar: es.girdi.kitaplar.map(({ anahtar, ...k }) => k),
    };
    await fsp.writeFile(girdiYolu, JSON.stringify(girdi, null, 2));
    rapor.girdi = girdi;
    // Girdi parmak izi (kabuk eki anahtarı): Swift'e giden girdi + kapak sha'ları + A1 girdi
    // sha'ları. Mac ('ikili') ve ProBook ('ek') AYNI JS ile hesaplar; ikili kipte modül yoksa null.
    const ekKipAdi = a1 ? 'a1' : 'bookN';
    const a1Sha = a1 ? a1GirdiOzeti(a1Girdi) : null;
    const izGirdisi = { kip: ekKipAdi, girdi, kapaklar: kapakSha, a1Girdi: a1Sha };
    if (ekKipi) {
      let EK;
      try {
        EK = kabukEkModulu(o);
        rapor.girdiSha = EK.girdiParmakIzi(izGirdisi);
      } catch (e) {
        const m = String(e && e.message || e).slice(0, 120);
        return ertele('hata', `parmak izi hesaplanamadı: ${m}`);
      }
      // Kapak yolları (`images/<klasör>.png|jpg`) yalnız bu setin klasörleriyle sınırlanır.
      const klasorler = new Set(girdi.kitaplar.map((k) => k.klasor));
      // İmza açık anahtarı (PEM metni): `o.acikAnahtar` ya da EMPP_KABUK_EK_ACIK_ANAHTAR dosyası.
      // Okunamazsa eke HİÇ gidilmez (imzasız ek uygulanmaz).
      let acikAnahtar = o.acikAnahtar != null ? String(o.acikAnahtar) : null;
      if (acikAnahtar == null) {
        try {
          acikAnahtar = fs.readFileSync(ekAcikAnahtarYolu(env), 'utf8');
        } catch (_) { acikAnahtar = null; }
      }
      if (!acikAnahtar || !acikAnahtar.trim()) {
        return ertele('ek-imza-anahtari-yok', `açık anahtar okunamadı (${ekAcikAnahtarYolu(env)})`);
      }
      let g;
      try {
        // CDN getiricisi modülündür ({status, buffer}); Web-Z `getir`'i ({status, govde}) VERİLMEZ.
        // A: imza yok/geçersiz → {durum:'hata', kod:'imza'} → ertele 'ek-imza'.
        // `kapaklar`: v2 ekte zip dışı bırakılan kapaklar bu girdi baytlarından doldurulur (sha
        // denetimli; sha'lar zaten girdiSha'nın içinde). v1 ek bunu yok sayar.
        g = await EK.ekGetir({
          bookId, girdiSha: rapor.girdiSha, kip: ekKipAdi, klasorler, acikAnahtar,
          kapaklar: kapakVeri,
          ...(o.cdnGetir ? { getir: o.cdnGetir } : {}),
        });
      } catch (e) {
        g = { durum: 'hata', kod: 'ag', mesaj: String(e && e.message || e) };
      }
      const sha12 = String(rapor.girdiSha || '').slice(0, 12);
      if (!g || g.durum === 'yok') {
        // Teşhis (Önemli-3b): Mac son.json'u başka girdiSha'yı gösteriyorsa iki makine aynı seti
        // farklı tabandan kuruyor (merdiven/set eki ayrışması) — kod `ek-sapma`, iki sha raporda.
        let son = o.ekSon;
        if (son === undefined) {
          try {
            son = await EK.sonOku({ bookId, ...(o.cdnGetir ? { getir: o.cdnGetir } : {}) });
          } catch (_) { son = null; }
        }
        const mac = son && son.girdiSha ? String(son.girdiSha) : null;
        if (mac && mac !== String(rapor.girdiSha)) {
          return ertele('ek-sapma', `Mac ${mac.slice(0, 12)} ≠ ProBook ${sha12} (taban ayrışması)`,
            { macGirdiSha: mac });
        }
        return ertele('ek-yok', `ek yok (girdiSha ${sha12})`);
      }
      if (g.durum === 'ret') {
        return ertele('ek-ret', `Mac ek üretemedi (ret işareti): ${String(g.neden || '-').slice(0, 160)}`);
      }
      if (g.durum !== 'var') {
        const m = String(g.mesaj || g.kod || g.durum).slice(0, 160);
        return ertele(`ek-${g.kod || 'hata'}`, `ek alınamadı: ${m}`);
      }
      const mSha = g.manifest && g.manifest.girdiSha != null ? String(g.manifest.girdiSha) : null;
      if (mSha != null && mSha !== String(rapor.girdiSha)) {
        return ertele('ek-bayat', `manifest girdiSha ${mSha.slice(0, 12)} ≠ yerel ${sha12}`);
      }
      const ekDosyalari = g.dosyalar instanceof Map ? g.dosyalar : new Map();
      const yasak = [...ekDosyalari.keys()].filter((y) => !ekYoluGuvenli(y)
        || !kabukDosyasiMi(y, klasorler) || !Buffer.isBuffer(ekDosyalari.get(y)));
      if (!ekDosyalari.size) return ertele('ek-bozuk', 'ek boş');
      if (yasak.length) {
        return ertele('ek-yol', `ekte izin dışı yol: ${yasak.slice(0, 3).join(', ')}`);
      }
      // Swift'in yerine: dosyalar gölge köke (aşağıdaki kapılar ikili çıktısıyla AYNI ölçer).
      for (const [y, v] of ekDosyalari) {
        await fsp.mkdir(path.dirname(path.join(kok, y)), { recursive: true });
        await fsp.writeFile(path.join(kok, y), v);
      }
      log(`${ISARET} kabuk eki gölge köke yazıldı: ${ekDosyalari.size} dosya, girdiSha ${sha12}`);
    } else {
      try {
        rapor.girdiSha = kabukEkModulu(o).girdiParmakIzi(izGirdisi);
      } catch (_) {
        rapor.girdiSha = null; // modül yok (A birleşmeden) — ikili yolu etkilenmez
      }
      const argumanlar = a1 ? ['--kip', KIP_TEK_MOTOR, kok, girdiYolu, kapakDizini] : [kok, girdiYolu, kapakDizini];
      const r = await ikiliKostur(ikili, argumanlar, { zamanAsimiMs: o.aracSuresiMs || ARAC_SURESI_MS });
      if (r.code !== 0) {
        const ham = String(r.stderr || '').trim().slice(-200);
        // Eski ikili `--kip`i tanımaz (kullanım satırı / çıkış ≠ 0): A1 atlanır, iş kopyası aynen kalır.
        return atla(a1 ? `webz-kabuk-uret tek-motor kipini tanımıyor ya da başarısız (çıkış ${r.code}): ${ham}`
          : `webz-kabuk-uret çıkış ${r.code}: ${ham}`);
      }
    }
    const hepsi = await dosyalariTopla(kok);
    // İkili bookN/ altına HİÇBİR şey yazmamalı (taslak index.html boş kalmalı): yazdıysa araç yanlış
    // köke yazıyordur — çıktı güvenilmez, adım atlanır (bookN içeriği zaten zip'e gitmez).
    const bookNYazilan = hepsi.filter((y) => bookNMi(y.split('/')[0])
      && !(y === `${y.split('/')[0]}/index.html` && fs.statSync(path.join(kok, y)).size === 0));
    if (bookNYazilan.length) return dur('ek-bozuk', `ikili bookN altına yazdı: ${bookNYazilan.slice(0, 3).join(', ')}`);
    // A1: motor sayfasını (kapak/**) ve diğer girdileri YALNIZ bu adım yazar; ikili değiştirdiyse ya da
    // kapak/ altına yeni dosya koyduysa çıktı güvenilmez.
    if (a1) {
      const bozulan = [...a1Girdi].filter(([y, v]) => {
        try { return !fs.readFileSync(path.join(kok, y)).equals(v); } catch (_) { return true; }
      }).map(([y]) => y);
      if (bozulan.length) return dur('ek-bozuk', `ikili girdi dosyasını değiştirdi: ${bozulan.slice(0, 3).join(', ')}`);
    }
    const kapakYazilan = hepsi.filter((y) => y.split('/')[0] === 'kapak' && !a1Girdi.has(y));
    if (kapakYazilan.length) return dur('ek-bozuk', `ikili kapak/ altına yazdı: ${kapakYazilan.slice(0, 3).join(', ')}`);
    // `_` önekli kök dizin (araç `_eski/`'ye arşivler) ve A1 girdileri zip'e YAZILMAZ.
    const yazilan = hepsi.filter((y) => !bookNMi(y.split('/')[0]) && !/^_/.test(y.split('/')[0])
      && !a1Girdi.has(y)).sort();
    if (!yazilan.includes('index.html') || !yazilan.includes(DIL_BETIGI)) {
      return dur('ek-bozuk', `ikili kabuk yazmadı (${yazilan.length} dosya)`);
    }
    rapor.yazilanDosyalar = [...yazilan];
    // Ek çıktısı (yalnız 'ikili' + kanca): ikilinin yazdığı kök dosyaları, değişmezlik
    // süzgecinden ÖNCE (spec §2). Gölge kök önekle taşınmadan önce okunur. A1 motor sayfası YOK.
    const ekCiktiDosyalari = o.ekCikti && !ekKipi
      ? new Map(yazilan.map((y) => [y, fs.readFileSync(path.join(kok, y))])) : null;
    const ekCiktiVer = async (ek = {}) => {
      if (!ekCiktiDosyalari) return;
      try {
        await o.ekCikti({
          girdiSha: rapor.girdiSha ?? null, kip: ekKipAdi, girdi, dosyalar: ekCiktiDosyalari,
          kapaklar: kapakSha, a1Girdi: a1Sha, webzSettingsSha, ...ek,
        });
      } catch (e) {
        rapor.ekCiktiHata = String(e && e.message || e).slice(0, 200);
        warn(`${ISARET} ek çıktısı kancası hata verdi (adım etkilenmez): ${rapor.ekCiktiHata}`);
      }
    };
    // 4b'. A1 ilk dönüşüm: kökteki motor index.html → kapak/index.html (A1 başlığıyla). Zaten A1
    //      ise (motor kapak/index.html'de) motor sayfasına dokunulmaz.
    //      Dosya gölgede ikiliden önce kondu (4b); burada yalnız zip'e yazılacaklara eklenir.
    // Çakışma kapısı (her A1 koşusu): ikili yalnız gölge kökü görür, motor kökünü GÖRMEZ.
    //   · ilk dönüşüm: kökte zaten bulunan dosyayı kabuk dosyası ezecekse (index.html hariç — o
    //     kapak/'a taşındı);
    //   · her koşu (k3, "zaten A1" dahil): motor sayfasının (`kapak/index.html`, `<base href="../">`
    //     ile kök-göreli) yerel başvurusunu kabuk dosyası ezecekse
    //   motor bozulur → atla, iş kopyası aynen kalır.
    if (a1) {
      const ilk = u.motorKaynagi === 'index.html';
      const motorRef = new Set(K.indexYerelReferanslari(a1Girdi.get(A1.A1_MOTOR_SAYFASI).toString('utf8')));
      const cakisan = yazilan.filter((y) => y !== 'index.html'
        && ((ilk && once.has(`${onEk}${y}`)) || motorRef.has(y)));
      if (cakisan.length) return dur('ek-bozuk', `kabuk dosyası motor dosyasıyla çakışıyor: ${cakisan.slice(0, 3).join(', ')}`);
    }
    if (a1 && u.motorKaynagi === 'index.html') {
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
      if (ekCiktiDosyalari) {
        // Zip'teki kabuk = üretilen kabuk: mevcut zip kapıdan geçerse ek yine verilir (Mac'in
        // kurduğu build'den sonra ProBook aynı girdiyle eki bulsun). RED → ek yok, durum aynı.
        const m = (y) => metinAl(o.zip, once, `${onEk}${y}`);
        const ihlalG = kapiDenetle({
          once, sonra: once, onEk, yazilan, beklenen: girdi, kip: a1 ? 'a1' : null,
          motorKaynagi: null,
          metin: {
            dil: m(DIL_BETIGI), yama: m(YAMA), ayar: m(AYAR), index: m('index.html'),
            ...(a1 ? { kapak: m(A1.A1_MOTOR_SAYFASI) } : {}),
          },
        });
        if (ihlalG.length) {
          rapor.ekCiktiHata = `güncel zip kapıdan geçmedi (${ihlalG[0]}) — ek verilmedi`;
          warn(`${ISARET} ${rapor.ekCiktiHata}`);
        } else {
          await ekCiktiVer({ guncel: true });
        }
      }
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
    if (z.code !== 0) return dur('hata', `zip yazılamadı (${z.code}): ${String(z.stderr).slice(-200)}`);
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
      return dur('kapi-red', `kapı RED (${ihlal.length}; ilk: ${ihlal[0]}) — iş kopyası DEĞİŞMEDİ`, { ihlal });
    }
    await ekCiktiVer();
    await fsp.rename(aday, o.zip);
    rapor.durum = 'uygulandi';
    return bitir(null, {
      kitaplar: girdi.kitaplar.map((k) => k.klasor), dosyaSayisi: yazilan.length, degisenSayisi: degisen.length,
      setAdi: girdi.setTitle,
    });
  } catch (e) {
    return dur('hata', `beklenmeyen hata: ${String(e && e.message || e).slice(0, 200)} — iş kopyası DEĞİŞMEDİ`);
  } finally {
    await fsp.rm(aday, { force: true }).catch(() => {});
    await fsp.rm(sahne, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  ISARET, WEBZ_KOKU, IMZA, acik, ikiliYolu, onEkBul, uygunluk, webzListesi, eslemeKur, kapakGecerli,
  kapiDenetle, kabukDosyasiMi, ikiliKostur, kabukTazele, KIP_TEK_MOTOR, A1_KART_IMZASI,
  kabukKaynagiSec, kabukEkModulu, ekYoluGuvenli, ekSonKontrol, ekAcikAnahtarYolu,
  kaynakKurKabukKarari, a1GirdiOzeti,
};
