'use strict';

/**
 * SET ÜYELİĞİ → YENİ KURULUM (bookN eki) — 2026-09-30.
 * Sözleşme: `.claude/docs/kitap-guncelleme-sozlesmesi.md` "Yeni kurulumda eksik set kitabı".
 *
 * NEDEN (ölçüldü 29.09): 45482 "Shall We 8 Set"e panelden 45352 "Test Book" ve 49436 "LGS Deneme
 * Sınavları" eklendi (web-stream `proxy_asset_id`, 10:06). İmpark set exe'si 4 kitap taşıyor;
 * offline paketler (mac/pardus/android) bu yüzden eklenenleri hiç göstermiyordu. Nadir 29.09:
 * "yeni indiren tam seti alır"; "hiçbir koşulda kitapların açılmasını engellemez".
 *
 * NE YAPAR (iş kopyası `build.zip` üstünde; arşiv/önbellek zip'ine DOKUNULMAZ):
 *   1. Panel listesi (sıra dahil) ↔ exe kitapları eşlenir: önce assetId (menü + ImWin32 kapak ID),
 *      tutmazsa aynı adlı eşlenmemiş TEK kitap (`ad`). `link:` satırı çevrimdışına girmez.
 *   2. Eşlenmeyen her kitap için İmpark'a motorun kendi sorusu (versiyon=0) sorulur → ZKitapZipH
 *      adresi; içerik merdiveninin önbellek + indirme yolu (`icerikZipiGetir`) kullanılır.
 *   3. Yeni `bookN` = kalıp kitabın okuyucu kabuğu (assets/ ve classlibraries/ hariç) +
 *      tek kapaklı `classlibraries/ImWin32.dll` (kalıbın biçimi) + `assets/<ID>/` (arşiv aynen).
 *   4. Web-Z menüsü (yama + settings + set-menu.json) listenin sırası ve adlarıyla yazılır; tema
 *      kartları `settings.books` ANAHTAR SIRASIYLA çizer (language-set.js), displayOrder değil.
 *   5. Kapılar (zip'e yazdıktan SONRA merkez dizinden): eski bookN/** ve menü dışı kök bayt-aynı;
 *      yeni kitapta BookContent + ilk sayfa + kapak; menü sırası/adları = liste; bookN sayısı.
 *
 * BAŞARISIZLIK: kitap başına hata → o kitap eklenmez, menüye girmez, `eksikSetKitabi[]` + görünür
 * log satırı; paket YİNE üretilir. Yazım aday kopyada (klon) yapılır, kapıdan geçerse tek rename;
 * düşerse aday atılır, iş kopyası HİÇ değişmemiş olur — eski kitapları bozuk paket üretilmez.
 *
 * ANAHTAR: `EMPP_SET_UYELIK_EK=1` (varsayılan KAPALI).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const M = require('./icerik-merdiven');
const ig = require('../runtime/icerik-guncelleme');
const gMenu = require('../../tools/g-yayin/menu');
const bicim = require('../packaging/set-menu-bicim');

const ISARET = '[set-ek]';
const MENU = ig.MENU_GORELI; // 'classlibraries/ImWin32.dll'
const YAMA = 'scripts/cevrimdisi-yama.js';
const AYAR = 'config/settings.json';
const TANIM = 'set-menu.json';
const MENU_YOLLARI = Object.freeze([YAMA, AYAR, TANIM]);
const ILK_SAYFA = Object.freeze(['pages/1.png', 'pages/1.jpg', 'pages/1.jpeg', 'pages/1.webp']);
const KAPAK = 'thumbs/1.jpg';

function ekAcik(env = process.env) {
  return String(env.EMPP_SET_UYELIK_EK || '') === '1';
}

// ─── Saf kararlar ───────────────────────────────────────────────────────────────────────────

/**
 * Panel listesi — book-update `parseProxyBookList` (services/api/src/lib/kv-sync.ts) ile BİREBİR:
 * satır ya da (tek satırsa) virgül ayraçlı; `assetId | başlık | kapak | contentType | grup`;
 * kitap ve link AYNI sayaçtan numaralanır. SAF.
 * @returns {Array<{sira:number, anahtar:string, assetId:string, ad:string, link:boolean,
 *   contentType:string|null, url:string|null}>}
 */
function setListesiAyristir(ham) {
  const raw = String(ham == null ? '' : ham).trim();
  if (!raw) return [];
  const satirlar = raw.includes('\n')
    ? raw.split('\n').map((s) => s.trim()).filter(Boolean)
    : raw.split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  satirlar.forEach((satir, i) => {
    const p = satir.split('|').map((s) => s.trim());
    if (p[0].startsWith('link:')) {
      out.push({
        sira: i + 1, anahtar: `link${i + 1}`, assetId: '', ad: p[1] || 'Kısayol', link: true,
        contentType: null, url: p[0].slice(5).trim(),
      });
      return;
    }
    if (!p[0]) return;
    out.push({
      sira: i + 1, anahtar: `book${i + 1}`, assetId: p[0], ad: p[1] || '', link: false,
      contentType: p[3] || null, url: null,
    });
  });
  return out;
}

/**
 * Listenin kaynağı: claim `setListesi` (API alanı — henüz yok) >
 * `EMPP_SET_LISTESI_DIZINI/<id>.txt`.
 * @returns {{ham: string, kaynak: string}|null}
 */
function setListesiCoz({ job = {}, env = process.env } = {}) {
  const c = job.setListesi;
  if (Array.isArray(c) && c.length) return { ham: c.join('\n'), kaynak: 'claim' };
  if (typeof c === 'string' && c.trim()) return { ham: c, kaynak: 'claim' };
  const dizin = env.EMPP_SET_LISTESI_DIZINI;
  if (dizin && job.bookId != null && /^\d+$/.test(String(job.bookId))) {
    const dosya = path.join(dizin, `${job.bookId}.txt`);
    try {
      const ham = fs.readFileSync(dosya, 'utf8');
      if (ham.trim()) return { ham, kaynak: dosya };
    } catch (_) { /* yok */ }
  }
  return null;
}

const adNorm = (s) => String(s == null ? '' : s).trim().toLocaleLowerCase('tr');
const kitapNo = (d) => Number(String(d).replace(/^book/, ''));

/**
 * Liste ↔ exe eşlemesi. SAF.
 * @param {Array<object>} liste  `setListesiAyristir` çıktısı
 * @param {Array<{dizin:string, id:string|null, menuAssetId:string|null, ad:string|null}>} exe
 * @returns {{eslesen: Array<{liste, dizin, yol}>, eksik: Array<object>, listedeYok: string[],
 *   linkler: Array<object>}}
 */
function eslestir(liste, exe) {
  const kalan = new Map(exe.map((k) => [k.dizin, k]));
  const eslesen = [];
  const bekleyen = [];
  const linkler = [];
  for (const g of liste) {
    if (g.link) { linkler.push(g); continue; }
    const k = [...kalan.values()].find((e) => String(e.menuAssetId) === g.assetId
      || String(e.id) === g.assetId);
    if (k) {
      kalan.delete(k.dizin);
      eslesen.push({ liste: g, dizin: k.dizin, yol: 'assetId' });
    } else bekleyen.push(g);
  }
  const eksik = [];
  for (const g of bekleyen) {
    const adaylar = g.ad
      ? [...kalan.values()].filter((e) => e.ad && adNorm(e.ad) === adNorm(g.ad)) : [];
    if (adaylar.length === 1) {
      kalan.delete(adaylar[0].dizin);
      eslesen.push({ liste: g, dizin: adaylar[0].dizin, yol: 'ad' });
    } else eksik.push(g);
  }
  return { eslesen, eksik, listedeYok: [...kalan.keys()], linkler };
}

function xmlKacis(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attrYaz(etiket, ad, deger) {
  const re = new RegExp(`(\\s${ad}=")[^"]*(")`);
  if (re.test(etiket)) return etiket.replace(re, (_, a, b) => `${a}${deger}${b}`);
  return etiket.replace(/\s*\/?>$/, (son) => ` ${ad}="${deger}"${son}`);
}

/**
 * Kalıp kitabın menüsünden yeni kitabın menüsü (tek kapak). SAF.
 * @param {string} kalipXml çözülmüş menü
 * @param {{id:string, vs:number, url:string, ad:string}} y
 */
function menuXmlUret(kalipXml, y) {
  const kapaklar = String(kalipXml).match(/<cover\b[^>]*>/g) || [];
  if (kapaklar.length !== 1) {
    throw new Error(`kalıp menüde ${kapaklar.length} kapak var (tam 1 olmalı)`);
  }
  const id = String(y.id);
  const a = `assets/${id}`;
  let e = kapaklar[0];
  const alanlar = {
    ID: id, etkID: id, etkAdi: id, ustBar: `${a}/skins/ustBar.swf`,
    arkaPlan: `${a}/skins/arkaplan.swf`, source: `${a}/cover.png`, actName: xmlKacis(y.ad),
    URL: xmlKacis(y.url), imageURL: `${a}/${KAPAK}`, version: String(y.vs),
    xmlSource: `${a}/data/BookContent.xml`, guId: '',
  };
  for (const [k, v] of Object.entries(alanlar)) e = attrYaz(e, k, v);
  const xml = String(kalipXml).replace(kapaklar[0], () => e);
  const c = ig.kapaklar(xml);
  if (c.length !== 1 || c[0].ID !== id || c[0].version !== Number(y.vs)) {
    throw new Error('yeni menü doğrulanamadı');
  }
  return xml;
}

/** sha256 tohumlu deterministik 0..1 üreteci (aynı girdi → aynı ImWin32.dll baytı). */
function tohumluRastgele(tohum) {
  let blok = crypto.createHash('sha256').update(String(tohum)).digest();
  let i = 0;
  return () => {
    if (i >= blok.length) {
      blok = crypto.createHash('sha256').update(blok).digest();
      i = 0;
    }
    const v = blok[i] / 256;
    i += 1;
    return v;
  };
}

const kanonik = (v) => {
  if (Array.isArray(v)) return `[${v.map(kanonik).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).map((k) => `${JSON.stringify(k)}:${kanonik(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
};
/** Anahtar sırasından bağımsız JSON (ayrışma kıyası için). */
const sirasizKanonik = (v) => {
  if (Array.isArray(v)) return `[${v.map(sirasizKanonik).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort()
      .map((k) => `${JSON.stringify(k)}:${sirasizKanonik(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
};

/**
 * Menünün yeni `books` nesnesi — ANAHTAR SIRASI = liste sırası (tema bu sırayla çizer), sonra
 * listede olmayan mevcut girdiler. SAF.
 * @param {object} books mevcut `settings.books`
 * @param {Array<{dizin:string, liste:object|null, yeni?:object}>} sirali
 */
function yeniBooks(books, sirali) {
  const out = {};
  sirali.forEach((s, i) => {
    const mevcut = books[s.dizin] && typeof books[s.dizin] === 'object' ? books[s.dizin] : null;
    let kayit;
    if (s.yeni) {
      kayit = {
        assetId: String(s.yeni.id), contentType: s.yeni.contentType || 'book',
        coverUrl: `${s.dizin}/assets/${s.yeni.id}/${KAPAK}`, displayOrder: i,
        title: s.yeni.ad,
      };
    } else {
      kayit = { ...(mevcut || {}), displayOrder: i };
      if (s.liste && s.liste.ad) kayit.title = s.liste.ad;
    }
    out[s.dizin] = kayit;
  });
  return out;
}

/**
 * Web-Z menü dosyalarının yeni hâli. Değişmeyen dosya çıktıya girmez. SAF.
 * @param {{yama:string|null, ayar:string|null, tanim:string|null}} t
 * @returns {Map<string, Buffer>}
 */
function webzYaz(t, sirali) {
  const dosyalar = new Map();
  const yp = t.yama != null ? gMenu.yamaAyir(t.yama) : null;
  const ap = t.ayar != null ? JSON.parse(t.ayar) : null;
  const kaynak = yp ? yp.ayarlar : ap;
  if (!kaynak || !kaynak.books || typeof kaynak.books !== 'object') {
    throw new Error('Web-Z menüsü: books nesnesi yok');
  }
  // İki kaynak ayrışmışsa hangisinin doğru olduğu bilinmez (içerik kıyası; anahtar sırası hariç).
  if (yp && ap && sirasizKanonik(yp.ayarlar.books) !== sirasizKanonik(ap.books)) {
    throw new Error(`Web-Z menüsü ayrışmış: ${YAMA} ile ${AYAR} farklı kitaplar listeliyor`);
  }
  const books = yeniBooks(kaynak.books, sirali);
  const uygula = (a) => {
    const c = { ...a, books };
    if (typeof a.bookCount === 'number') c.bookCount = Object.keys(books).length;
    return c;
  };
  if (yp) {
    const y2 = uygula(yp.ayarlar);
    if (kanonik(y2) !== kanonik(yp.ayarlar)) {
      dosyalar.set(YAMA, Buffer.from(yp.once + JSON.stringify(y2, null, 2) + yp.sonra));
    }
  }
  if (ap) {
    const a2 = uygula(ap);
    if (kanonik(a2) !== kanonik(ap)) {
      dosyalar.set(AYAR, Buffer.from(`${JSON.stringify(a2, null, 2)}\n`));
    }
  }
  if (t.tanim != null) {
    const tn = JSON.parse(t.tanim);
    if (!Array.isArray(tn.kitaplar)) throw new Error(`${TANIM}: kitaplar dizisi yok`);
    const eski = new Map(tn.kitaplar.filter(Boolean).map((k) => [k.klasor, k]));
    const kitaplar = Object.entries(books).map(([d, b]) => {
      const e = eski.get(d);
      if (e) return { ...e, ad: b.title };
      return {
        ad: b.title, assetId: b.assetId, dugmeGorseliVarMi: false, grup: '',
        id: gMenu.kararliKimlik(d, b.assetId), kapakVarMi: false, klasor: d,
        klasorElleYazildi: false,
      };
    });
    const t2 = { ...tn, kitaplar };
    if (kanonik(t2) !== kanonik(tn)) {
      dosyalar.set(TANIM, Buffer.from(`${JSON.stringify(t2, null, 2)}\n`));
    }
  }
  return dosyalar;
}

/** Menü dosyasından (yama öncelikli) `books` — kapı okuması. */
function menuBooksOku(yamaMetni, ayarMetni) {
  if (yamaMetni != null) return gMenu.yamaAyir(yamaMetni).ayarlar.books;
  if (ayarMetni != null) return JSON.parse(ayarMetni).books;
  return null;
}

/**
 * Yazım sonrası kapılar (merkez dizin önce/sonra). SAF.
 * @returns {string[]} ihlal satırları
 */
function kapiDenetle({ once, sonra, eklenen, beklenenSira, beklenenAd, menuMetinleri }) {
  const ihlal = [];
  const yeniOnek = eklenen.map((e) => `${e.dizin}/`);
  const yeniMi = (ad) => yeniOnek.some((o) => ad.startsWith(o));
  for (const [ad, g] of once) {
    const s = sonra.get(ad);
    if (!s) { ihlal.push(`silindi: ${ad}`); continue; }
    if (MENU_YOLLARI.includes(ad)) continue;
    if (s.crc !== g.crc || s.boyut !== g.boyut) ihlal.push(`değişti: ${ad}`);
  }
  for (const ad of sonra.keys()) {
    if (once.has(ad)) continue;
    if (yeniMi(ad)) continue;
    if (MENU_YOLLARI.includes(ad)) continue;
    ihlal.push(`izin dışı eklendi: ${ad}`);
  }
  for (const e of eklenen) {
    const a = `${e.dizin}/assets/${e.id}/`;
    if (!sonra.has(`${a}data/BookContent.xml`)) ihlal.push(`${e.dizin}: BookContent.xml yok`);
    if (!ILK_SAYFA.some((p) => sonra.has(`${a}${p}`))) ihlal.push(`${e.dizin}: ilk sayfa yok`);
    if (!sonra.has(`${a}${KAPAK}`)) ihlal.push(`${e.dizin}: ${KAPAK} yok`);
    if (!sonra.has(`${e.dizin}/${MENU}`)) ihlal.push(`${e.dizin}: menü (${MENU}) yok`);
    if (!sonra.has(`${e.dizin}/index.html`)) ihlal.push(`${e.dizin}: index.html yok`);
    const say = [...sonra.keys()].filter((k) => k.startsWith(`${e.dizin}/`)).length;
    if (say !== e.girdi) ihlal.push(`${e.dizin}: ${say} girdi (beklenen ${e.girdi})`);
  }
  const bookDizinleri = (m) => new Set([...m.keys()].map((k) => k.split('/')[0])
    .filter((d) => /^book\d+$/.test(d)));
  const bOnce = bookDizinleri(once).size;
  const bSonra = bookDizinleri(sonra).size;
  if (bSonra !== bOnce + eklenen.length) {
    ihlal.push(`bookN sayısı ${bSonra} ≠ ${bOnce} + ${eklenen.length} eklenen`);
  }
  let books = null;
  try {
    books = menuBooksOku(menuMetinleri.yama, menuMetinleri.ayar);
  } catch (e) {
    ihlal.push(`menü okunamadı: ${e.message}`);
  }
  if (books) {
    const sira = Object.keys(books);
    if (sira.join(',') !== beklenenSira.join(',')) {
      ihlal.push(`menü sırası ${sira.join(',')} ≠ beklenen ${beklenenSira.join(',')}`);
    }
    for (const [d, ad] of Object.entries(beklenenAd)) {
      if (!books[d] || books[d].title !== ad) {
        ihlal.push(`menü adı ${d}: ${books[d] ? books[d].title : '(yok)'} ≠ ${ad}`);
      }
    }
    const dizinler = new Set([...sonra.keys()].map((k) => k.split('/')[0]));
    for (const d of sira) {
      if (/^book\d+$/.test(d) && !dizinler.has(d)) ihlal.push(`menüde ${d} var, zip'te yok`);
    }
    if (menuMetinleri.ayar != null) {
      const a = JSON.parse(menuMetinleri.ayar);
      if (typeof a.bookCount === 'number' && a.bookCount !== sira.length) {
        ihlal.push(`bookCount ${a.bookCount} ≠ ${sira.length}`);
      }
    }
  }
  return ihlal;
}

// ─── IO ─────────────────────────────────────────────────────────────────────────────────────

/** Zip'teki kitaplar: menüsü olan her bookN + kapak ID'si + menüdeki assetId/ad. */
function exeKitaplari(zip, dizin, books) {
  const { set, konumlar } = M.menuKonumlari(dizin.keys());
  if (!set) return { set: false, kitaplar: [] };
  const kitaplar = konumlar.filter((k) => /^book\d+$/.test(k.kitap)).map((k) => {
    let id = null;
    let xml = null;
    try {
      xml = ig.menuCoz(M.zipGirdiOku(zip, dizin.get(`${k.kok}${MENU}`)));
      const c = xml ? ig.kapaklar(xml) : [];
      id = c.length === 1 ? c[0].ID : null;
    } catch (_) { id = null; }
    const m = books && books[k.kitap];
    return {
      dizin: k.kitap, id, xml, menuAssetId: m && m.assetId != null ? String(m.assetId) : null,
      ad: m && m.title ? String(m.title) : null,
    };
  });
  // Menüde olup ImWin32'si olmayan bookN de (Web-Z) kitap sayılır.
  for (const [d, b] of Object.entries(books || {})) {
    if (/^book\d+$/.test(d) && !kitaplar.some((k) => k.dizin === d)
      && [...dizin.keys()].some((a) => a.startsWith(`${d}/`))) {
      kitaplar.push({
        dizin: d, id: null, xml: null,
        menuAssetId: b && b.assetId != null ? String(b.assetId) : null,
        ad: b && b.title ? String(b.title) : null,
      });
    }
  }
  kitaplar.sort((a, b) => kitapNo(a.dizin) - kitapNo(b.dizin));
  return { set: true, kitaplar };
}

function arsivDenetle(gDizin) {
  const eksik = [];
  if (!gDizin.has('data/BookContent.xml')) eksik.push('data/BookContent.xml');
  if (!gDizin.has(KAPAK)) eksik.push(KAPAK);
  if (!ILK_SAYFA.some((p) => gDizin.has(p))) eksik.push('pages/1.*');
  if (eksik.length) throw new Error(`arşiv düzeni: ${eksik.join(', ')} yok`);
  for (const ad of gDizin.keys()) {
    const rel = ig.girdiGoreli(path, ad);
    if (rel == null || rel !== ad.replace(/\/+$/, '')) {
      throw new Error(`arşivde güvensiz girdi adı ${JSON.stringify(ad)}`);
    }
  }
}

async function dosyalariSay(kok) {
  let n = 0;
  async function yuru(d) {
    for (const e of await fsp.readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) await yuru(path.join(d, e.name));
      else n += 1;
    }
  }
  await yuru(kok);
  return n;
}

/** Kalıp kitabın kabuğu (assets/ + classlibraries/ hariç) sahneye bir kez açılır. */
async function kalipAc(zip, kalip, hedef) {
  const r = await M.komut('unzip', ['-q', '-o', zip, `${kalip}/*`, '-x', `${kalip}/assets/*`,
    `${kalip}/classlibraries/*`, '-d', hedef]);
  if (r.code !== 0) throw new Error(`kalıp açılamadı (unzip ${r.code}): ${r.stderr.slice(-200)}`);
  return path.join(hedef, kalip);
}

/** Tek kitabı sahneye kurar; hata → sahnedeki kısmi dizin kaldırılır, hata fırlar. */
async function kitapKur({ sahne, kalipKok, kalipXml, kalipBicim, y, arsiv, gDizin }) {
  const kok = path.join(sahne, y.dizin);
  try {
    await fsp.cp(kalipKok, kok, { recursive: true, errorOnExist: true, force: false });
    const xml = menuXmlUret(kalipXml, y);
    const menuYol = path.join(kok, MENU);
    await fsp.mkdir(path.dirname(menuYol), { recursive: true });
    await fsp.writeFile(menuYol, ig.menuKodla(xml, tohumluRastgele(`${y.id}:${y.vs}`), kalipBicim));
    const hedef = path.join(kok, 'assets', String(y.id));
    await fsp.mkdir(hedef, { recursive: true });
    const r = await M.komut('unzip', ['-q', '-o', arsiv, '-d', hedef]);
    if (r.code !== 0) throw new Error(`arşiv açılamadı (unzip ${r.code})`);
    const bozuk = [...gDizin.values()].filter((g) => !g.dizin).find((g) => {
      try {
        return fs.statSync(path.join(hedef, g.ad)).size !== g.boyut;
      } catch (_) { return true; }
    });
    if (bozuk) throw new Error(`açma eksik: ${bozuk.ad}`);
    return await dosyalariSay(kok);
  } catch (e) {
    await fsp.rm(kok, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

async function kanitYaz(dosya, veri) {
  try {
    await fsp.mkdir(path.dirname(dosya), { recursive: true });
    await fsp.writeFile(dosya, `${JSON.stringify(veri, null, 2)}\n`);
    return dosya;
  } catch (_) { return null; }
}

const metinAl = (zip, dizin, yol) => (dizin.has(yol)
  ? M.zipGirdiOku(zip, dizin.get(yol)).toString('utf8') : null);

/**
 * Giriş noktası. Kitap/menü/yazım hataları rapora yazılır; iş kopyası ya tam yeni ya aynen eski.
 * @param {{zip:string, calisma:string, liste:string, listeKaynagi?:string, bookId?:string,
 *   platform?:string, getir?:Function, indir?:Function, onbellek?:string, kanitDizini?:string,
 *   log?:Function, warn?:Function, zipKomutu?:Function}} o
 * @returns {Promise<object>} rapor
 */
async function setUyelikEki(o) {
  const log = o.log || (() => {});
  const warn = o.warn || log;
  const rapor = {
    bookId: o.bookId || null, platform: o.platform || null, zaman: new Date().toISOString(),
    listeKaynagi: o.listeKaynagi || null, sonuc: null, eslesme: [], eklenen: [],
    eksikSetKitabi: [], listedeYok: [], linkler: [],
  };
  const eksikYaz = (g, sebep) => {
    rapor.eksikSetKitabi.push({ assetId: g.assetId, ad: g.ad, sira: g.sira, sebep });
    warn(`${ISARET} EKSİK SET KİTABI ${g.assetId} (${g.ad || '-'}): ${sebep} — `
      + 'menüye girmedi, paket mevcut kitaplarla üretiliyor');
  };
  const bitir = async (sonuc) => {
    rapor.sonuc = sonuc;
    const damga = rapor.zaman.replace(/[:.]/g, '-');
    rapor.kanit = await kanitYaz(path.join(o.kanitDizini || M.kanitKoku(),
      `${o.bookId || 'kitap'}-${o.platform || 'x'}-set-ek-${damga}.json`), rapor);
    log(`${ISARET} ${sonuc} — eklenen ${rapor.eklenen.map((e) => `${e.dizin}=${e.id}`).join(' ')
      || '-'}; eksik ${rapor.eksikSetKitabi.length}; kanıt ${rapor.kanit || '-'}`);
    return rapor;
  };

  const liste = setListesiAyristir(o.liste);
  if (!liste.length) return bitir('liste boş — ek yapılmadı');
  const dizin = M.zipDizini(o.zip);
  const yama = metinAl(o.zip, dizin, YAMA);
  const ayar = metinAl(o.zip, dizin, AYAR);
  const tanim = metinAl(o.zip, dizin, TANIM);
  const index = metinAl(o.zip, dizin, 'index.html');
  let books = null;
  try { books = menuBooksOku(yama, ayar); } catch (_) { books = null; }
  const exe = exeKitaplari(o.zip, dizin, books);
  if (!exe.set) return bitir('set değil (bookN menüsü yok) — ek yapılmadı');

  const es = eslestir(liste, exe.kitaplar);
  rapor.eslesme = es.eslesen.map((e) => ({ assetId: e.liste.assetId, dizin: e.dizin, yol: e.yol }));
  rapor.listedeYok = es.listedeYok;
  rapor.linkler = es.linkler.map((g) => ({ ad: g.ad, url: g.url, sebep: 'çevrimdışına girmez' }));
  for (const e of es.eslesen.filter((x) => x.yol === 'ad')) {
    log(`${ISARET} ad eşleşmesi: liste ${e.liste.assetId} "${e.liste.ad}" ↔ ${e.dizin}`);
  }
  for (const d of es.listedeYok) log(`${ISARET} listede yok (korundu): ${d}`);

  const menuVar = !!(index && bicim.webZKabukIndexiMi(index) && books);
  if (!menuVar) {
    for (const g of es.eksik) eksikYaz(g, 'menü biçimi Web-Z değil — eklenemez');
    return bitir('menü biçimi desteklenmiyor — değişiklik yok');
  }
  const kalip = exe.kitaplar.find((k) => k.xml && M.imparkKimligiMi(k.id)
    && dizin.has(`${k.dizin}/index.html`) && dizin.has(`${k.dizin}/app.config.js`));
  if (es.eksik.length && !kalip) {
    for (const g of es.eksik) eksikYaz(g, 'kalıp kitap (İmpark menülü bookN) yok');
  }

  const sahne = await fsp.mkdtemp(path.join(o.calisma, 'set-ek-sahne-'));
  const aday = `${o.zip}.set-ek-aday`;
  try {
    const eklenen = [];
    if (es.eksik.length && kalip) {
      const sablon = M.ucSablonu(metinAl(o.zip, dizin, `${kalip.dizin}/app.config.js`));
      const kalipBicim = ig.menuBicimi(M.zipGirdiOku(o.zip, dizin.get(`${kalip.dizin}/${MENU}`)));
      let kalipKok = null;
      let sonNo = Math.max(0, ...[...new Set([...dizin.keys()].map((a) => a.split('/')[0]))]
        .filter((d) => /^book\d+$/.test(d)).map(kitapNo));
      for (const g of es.eksik) {
        try {
          if (!sablon) throw new Error('kalıp app.config.js updateBookEndPoint yok');
          if (!M.imparkKimligiMi(g.assetId)) throw new Error('İmpark kitap kimliği değil');
          const soru = M.teklifUrl(sablon, g.assetId, 0);
          const cevap = await (o.getir || M.varsayilanGetir)(soru, {});
          const t = M.teklifYorumla({ id: g.assetId, surum: 0 }, cevap);
          if (t.durum === M.DURUM.GUNCEL) throw new Error("İmpark'ta içerik yok (Data boş)");
          if (t.durum !== M.DURUM.GERIDE) throw new Error(`İmpark ölçülemedi: ${t.not}`);
          const arsiv = await M.icerikZipiGetir({
            id: g.assetId, vs: t.vs, url: t.data, onbellek: o.onbellek || M.icerikOnbellekKoku(),
            indir: o.indir || M.varsayilanIndir,
            log: (s) => log(s.replace('[merdiven] S1', ISARET)),
          });
          const gDizin = M.zipDizini(arsiv);
          arsivDenetle(gDizin);
          if (!kalipKok) kalipKok = await kalipAc(o.zip, kalip.dizin, path.join(sahne, '.kalip'));
          const d = `book${sonNo + 1}`;
          let ad = g.ad;
          if (!ad) {
            const bc = M.zipGirdiOku(arsiv, gDizin.get('data/BookContent.xml'))
              .subarray(0, 8192).toString('utf8');
            ad = bicim.kitapAdiBookContenttan(bc) || `Kitap ${g.sira}`;
          }
          const y = {
            dizin: d, id: g.assetId, vs: t.vs, url: t.data, ad, contentType: g.contentType,
          };
          const girdi = await kitapKur({
            sahne, kalipKok, kalipXml: kalip.xml, kalipBicim, y, arsiv, gDizin,
          });
          sonNo += 1;
          eklenen.push({ ...y, liste: g, girdi, arsiv: path.basename(arsiv) });
          log(`${ISARET} ${d} ← ${g.assetId} v${t.vs} "${ad}" sahnede (${girdi} dosya)`);
        } catch (e) {
          eksikYaz(g, e.message);
        }
      }
      if (kalipKok) await fsp.rm(path.dirname(kalipKok), { recursive: true, force: true });
    }

    // Son sıra: liste sırası (eşlenen + eklenen), sonra listede olmayanlar (numara sırası).
    const sirali = [];
    for (const g of liste) {
      const e = es.eslesen.find((x) => x.liste === g);
      if (e) sirali.push({ dizin: e.dizin, liste: g });
      const y = eklenen.find((x) => x.liste === g);
      if (y) sirali.push({ dizin: y.dizin, liste: g, yeni: y });
    }
    const listeDisi = Object.keys(books).filter((k) => !sirali.some((s) => s.dizin === k));
    for (const d of listeDisi) sirali.push({ dizin: d, liste: null });

    let menuDosyalari;
    try {
      menuDosyalari = webzYaz({ yama, ayar, tanim }, sirali);
    } catch (e) {
      for (const y of eklenen) eksikYaz(y.liste, `menü yazılamadı: ${e.message}`);
      return await bitir('menü yazılamadı — değişiklik yok');
    }
    if (!eklenen.length && !menuDosyalari.size) {
      return await bitir(es.eksik.length ? 'eklenebilen yok — değişiklik yok'
        : 'eksik yok, menü güncel — değişiklik yok');
    }
    for (const [yol, veri] of menuDosyalari) {
      await fsp.mkdir(path.dirname(path.join(sahne, yol)), { recursive: true });
      await fsp.writeFile(path.join(sahne, yol), veri);
    }

    // YAZIM: iş kopyası hiç yerinde değişmez. Aday = klon (APFS/reflink; yoksa tam kopya) →
    // zip adaya yazar → kapı adayı ölçer → GEÇTİ ise tek rename. NEDEN klon, sert bağ değil
    // (ölçüldü 30.09): Info-ZIP arşivin bağ sayısı >1 ise geçici dosyayı rename ETMEZ, içeriği
    // yerinde kopyalar — sert bağlı "yedek" de değişir, geri dönüş imkânsız olur.
    await fsp.rm(aday, { force: true });
    await fsp.copyFile(o.zip, aday, fs.constants.COPYFILE_FICLONE);
    const girdiler = [...eklenen.map((y) => y.dizin), ...menuDosyalari.keys()];
    let hata = null;
    try {
      const z = await (o.zipKomutu || M.komut)('zip', ['-q', '-r', '-D', '-X', '-n',
        M.SIKISIK_UZANTILAR, path.resolve(aday), ...girdiler], { cwd: sahne });
      if (z.code !== 0) {
        throw new Error(`zip yazılamadı (${z.code}): ${String(z.stderr).slice(-200)}`);
      }
      const sonra = M.zipDizini(aday);
      const beklenenAd = {};
      for (const s of sirali) if (s.liste && s.liste.ad) beklenenAd[s.dizin] = s.liste.ad;
      const ihlal = kapiDenetle({
        once: dizin, sonra, eklenen, beklenenSira: sirali.map((s) => s.dizin), beklenenAd,
        menuMetinleri: { yama: metinAl(aday, sonra, YAMA), ayar: metinAl(aday, sonra, AYAR) },
      });
      if (ihlal.length) throw new Error(`kapı RED (${ihlal.length}; ilk: ${ihlal[0]})`);
      await fsp.rename(aday, o.zip);
    } catch (e) {
      hata = e;
    }
    if (hata) {
      await fsp.rm(aday, { force: true }).catch(() => {});
      for (const y of eklenen) eksikYaz(y.liste, `yazım/kapı: ${hata.message}`);
      return await bitir('yazım/kapı düştü — iş kopyası DEĞİŞMEDİ');
    }
    rapor.eklenen = eklenen.map((y) => ({
      dizin: y.dizin, id: y.id, vs: y.vs, ad: y.ad, girdi: y.girdi, arsiv: y.arsiv,
    }));
    rapor.menu = { dosyalar: [...menuDosyalari.keys()], sira: sirali.map((s) => s.dizin) };
    return await bitir('UYGULANDI');
  } finally {
    await fsp.rm(sahne, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  ISARET, ekAcik, setListesiAyristir, setListesiCoz, eslestir, menuXmlUret, yeniBooks, webzYaz,
  kapiDenetle, exeKitaplari, tohumluRastgele, setUyelikEki, MENU_YOLLARI,
};
