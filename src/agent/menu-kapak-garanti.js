'use strict';

/**
 * MENÜ KAPAK GARANTİSİ — set menüsündeki her kartın kapak dosyası build.zip'te VAR (2026-10-06).
 *
 * KÖK NEDEN (ölçüldü 06.10, Super Monsters 2 Set 59835, Windows exe 2.51.2):
 *   - Üreteç (`index-ureteci.js` menü yazımı) link girdisine `coverUrl` YAZMAZ; kitaplara
 *     `bookN/assets/<id>/thumbs/1.jpg` yazar. Kabuğu açarken `images/book*`'u BİLEREK dışlar
 *     (`kabukAc`).
 *   - Kabuk (`scripts/language-set.js` loadLanguageSet) `coverUrl`'süz link kartına
 *     `images/<ilk kitap anahtarı>.png` = `images/book1.png` yükler → pakette yok → kırık görsel,
 *     alt metin görünür. Teacher's Pack + Worksheets (iki link) kapaksız; üç kitap kapaklı.
 *   - Panel listesinde (web-stream `proxy_asset_id`, satır `link:<url> | ad | <kapak>`) Teacher's
 *     Pack'in kapağı `data:image/jpeg;base64,…` olarak VAR; üreteç ve Z2 kabuk (`webzListesi`) link
 *     satırının kapak alanını hiç okumuyor. Web-Z aynı listeden `coverUrl` alır → web'de tam.
 *
 * NE YAPAR (iş kopyası zip; yalnız `images/kapak-<anahtar>.<uzantı>` EKLER ve iki menü dosyasında
 * yalnız o anahtarın `coverUrl`'ünü yazar — başka hiçbir girdiye dokunmaz):
 *   1. Menü verisi: `scripts/cevrimdisi-yama.js` (`window.__setSettings`) + `config/settings.json`.
 *      İkisi de yoksa ATLANDI (set değil).
 *   2. Her çizilen kart için kabuğun YÜKLEYECEĞİ kapak çözülür (`tools/kabul/menu-kapak.js`, kabul
 *      kapısıyla AYNI kural). Kapak pakette yok / ≤ 1 KB / uzak adres → ONARILIR. Link kartı kapaksız
 *      (kabuk yedeği: ilk kitabın kapağı) ama listede ya da Web-Z'de kendi kapağı varsa → o konur.
 *   3. Kaynak sırası (sessiz düşme YOK; her yedek UYARI yazar):
 *        link : panel listesi kapak alanı (data: ya da https) → Web-Z settings.json `coverUrl`
 *               → ilk kitabın kapağı (Web-Z'nin kendi yedeği, UYARI) → yer tutucu SVG (UYARI)
 *        kitap: uzak `coverUrl` indirilir → `<klasör>/assets/<id>/thumbs/1.jpg` → ilk sayfa
 *               `pages/1.(jpg|jpeg|png|webp)` (UYARI) → yer tutucu SVG (UYARI)
 *   4. Aday kopyaya `zip` ile yaz → KAPI: kabul ölçütü GEÇTİ + yazılmayan her girdi aynı (crc+boyut)
 *      → tek rename. Kapı düşerse iş kopyası DEĞİŞMEZ ve hata FIRLATILIR (görünür).
 *
 * Sonuç: { durum: 'uygulandi'|'gerek-yok'|'atlandi'|'olculemedi', kartlar:[{anahtar, kaynak, yol,
 * bayt}], uyarilar:[] }.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const M = require('./icerik-merdiven');
const K = require('../../tools/kabul/menu-kapak');

const ISARET = '[menu-kapak]';
const WEBZ_KOKU = 'https://webz.ydspublishing.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/126.0 Safari/537.36';
const INDIRME_TAVANI = 20 * 1024 * 1024;
const INDIRME_MS = 30000;
const ILK_SAYFA = Object.freeze(['pages/1.jpg', 'pages/1.jpeg', 'pages/1.png', 'pages/1.webp']);

class MenuKapakHatasi extends Error {
  constructor(mesaj) { super(`${ISARET} ${mesaj}`); }
}

/** Bayttan görsel uzantısı; görsel değilse null. SAF. */
function gorselUzantisi(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (b.slice(0, 4).toString('latin1') === 'GIF8') return 'gif';
  const bas = b.slice(0, 512).toString('utf8').trimStart();
  if (/^(<\?xml[^>]*>\s*)?<svg\b/i.test(bas)) return 'svg';
  return null;
}

/** Kapak olarak kullanılabilir mi: görsel imzası + > 1 KB. SAF. */
const kapakGecerli = (b) => !!(b && b.length > K.KAPAK_ALT_SINIR && gorselUzantisi(b));

/** `data:` adresini çözer; çözülemezse null. SAF. */
function dataCoz(adres) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/is.exec(String(adres || '').trim());
  if (!m) return null;
  try { return m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3])); } catch (_) { return null; }
}

const adNorm = (s) => String(s == null ? '' : s).trim().toLocaleLowerCase('tr');

/**
 * Panel listesinde (DB `proxy_asset_id` biçimi: `link:<url> | ad | <kapak>`) link satırının kapak
 * alanı. Önce adres, sonra ad eşleşir. Kapak yoksa null. SAF.
 */
function listedenLinkKapagi(listeHam, { url, baslik }) {
  const satirlar = String(listeHam == null ? '' : listeHam).replace(/\\n/g, '\n').split(/\r?\n/)
    .map((s) => s.trim()).filter((s) => /^link:/i.test(s));
  const alanlar = satirlar.map((s) => s.split('|').map((x) => x.trim()));
  const u = String(url || '').trim();
  const bul = alanlar.find((a) => u && a[0].slice(5).trim() === u)
    || alanlar.find((a) => baslik && adNorm(a[1]) === adNorm(baslik));
  const kapak = bul && bul[2] ? bul[2] : '';
  return /^(data:image\/|https?:\/\/)/i.test(kapak) ? kapak : null;
}

/** Web-Z ayarındaki aynı link kartının `coverUrl`'ü (adres, sonra ad eşleşmesi). SAF. */
function webzLinkKapagi(ayar, { url, baslik }) {
  const books = ayar && ayar.books && typeof ayar.books === 'object' ? ayar.books : {};
  const linkler = Object.values(books).filter((b) => b && (b.type === 'link' || b.contentType === 'link'));
  const u = String(url || '').trim();
  const bul = linkler.find((b) => u && String(b.url || '').trim() === u)
    || linkler.find((b) => baslik && adNorm(b.title) === adNorm(baslik));
  return bul && bul.coverUrl ? String(bul.coverUrl) : null;
}

const xmlKacis = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Yer tutucu kapak (SVG, 400×560): başlık + set adı. Kabul GEÇER, imzasıyla UYARI verir. SAF. */
function yerTutucuSvg(baslik, setAdi) {
  const satirlar = [];
  let s = '';
  for (const k of String(baslik || 'Kısayol').split(/\s+/)) {
    if ((`${s} ${k}`).trim().length > 16 && s) { satirlar.push(s); s = k; } else s = `${s} ${k}`.trim();
  }
  if (s) satirlar.push(s);
  const metin = satirlar.slice(0, 4).map((x, i) => `<tspan x="200" dy="${i ? 44 : 0}">${xmlKacis(x)}</tspan>`).join('');
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="560" viewBox="0 0 400 560" ${K.YER_TUTUCU_IMZASI}="1">
  <defs>
    <linearGradient id="z" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2f6fb5"/>
      <stop offset="1" stop-color="#173a63"/>
    </linearGradient>
  </defs>
  <rect width="400" height="560" rx="18" fill="url(#z)"/>
  <rect x="24" y="24" width="352" height="512" rx="12" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>
  <g fill="none" stroke="#ffffff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity="0.9">
    <path d="M170 150h-40a30 30 0 0 0 0 60h40"/>
    <path d="M230 150h40a30 30 0 0 1 0 60h-40"/>
    <path d="M160 180h80"/>
  </g>
  <text x="200" y="300" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    font-size="34" font-weight="700" fill="#ffffff">${metin}</text>
  <text x="200" y="505" text-anchor="middle" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    font-size="18" fill="#ffffff" fill-opacity="0.75">${xmlKacis(String(setAdi || '').slice(0, 40))}</text>
</svg>
`);
}

/** Varsayılan HTTPS GET (tarayıcı UA; Web-Z UA'sız 403). `{status, govde}` döner, hata fırlatabilir. */
async function varsayilanGetir(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(INDIRME_MS),
  });
  const govde = Buffer.from(await r.arrayBuffer());
  if (govde.length > INDIRME_TAVANI) return { status: 413, govde: Buffer.alloc(0) };
  return { status: r.status, govde };
}

/** Sarmalayıcı klasörlü zip öneki ('' ya da 'kök/'). SAF. */
function onEkBul(adlar) {
  const kokler = [...new Set(adlar.map((a) => a.split('/')[0]))];
  return kokler.length === 1 && adlar.length && adlar.every((a) => a.includes('/')) ? `${kokler[0]}/` : '';
}

/** Zip dizini üstünde kabul okuyucusu (önek siyrılmış yollar). */
function zipOkuyucu(zip, dizin, onEk) {
  const g = (rel) => {
    const x = dizin.get(`${onEk}${rel}`);
    return x && !x.dizin ? x : null;
  };
  return {
    boyut: (rel) => { const x = g(rel); return x ? x.boyut : null; },
    oku: (rel) => { const x = g(rel); return x ? M.zipGirdiOku(zip, x) : null; },
  };
}

/**
 * Kart için kapak baytlarını kaynak sırasıyla bulur. Dönüş {bayt, kaynak, uyari?}. Her zaman döner
 * (son çare yer tutucu). Saf değil (getir).
 */
async function kapakBul({ anahtar, b, books, okuyucu, listeHam, webzAyar, getir, setAdi, log }) {
  const dene = async (etiket, f) => {
    try {
      const v = await f();
      if (kapakGecerli(v)) return v;
      if (v) log(`${ISARET} ${anahtar}: ${etiket} kapak değil (${v.length} bayt)`);
    } catch (e) {
      log(`${ISARET} ${anahtar}: ${etiket} alınamadı: ${String(e && e.message || e).slice(0, 100)}`);
    }
    return null;
  };
  const adresten = (adres) => async () => {
    if (/^data:/i.test(adres)) return dataCoz(adres);
    const r = await getir(adres);
    return r && r.status === 200 ? r.govde : null;
  };
  if (b.type === 'link') {
    const kimlik = { url: b.url, baslik: b.title };
    const listeK = listedenLinkKapagi(listeHam, kimlik);
    if (listeK) {
      const v = await dene('panel listesi', adresten(listeK));
      if (v) return { bayt: v, kaynak: 'panel-listesi' };
    }
    const webzK = webzLinkKapagi(webzAyar, kimlik);
    if (webzK) {
      const v = await dene('Web-Z', adresten(webzK));
      if (v) return { bayt: v, kaynak: 'webz' };
    }
    // Web-Z'nin kendi yedeği: ilk kitabın kapağı (kabuk kuralıyla aynı kart).
    const ilk = Object.keys(books).find((k) => books[k] && books[k].type !== 'link' && books[k].assetId);
    if (ilk) {
      const s = K.adresSinifi(K.kapakYolu(ilk, books[ilk], books));
      const v = s.tur === 'yerel' ? await dene('ilk kitap kapağı', async () => okuyucu.oku(s.yol)) : null;
      if (v) {
        return {
          bayt: v, kaynak: 'ilk-kitap-kapagi',
          uyari: `${anahtar} "${b.title || ''}": listede/Web-Z'de kapak yok — ilk kitabın kapağı konuldu (Web-Z ile aynı)`,
        };
      }
    }
  } else {
    if (b.coverUrl && /^(https?:|data:)/i.test(String(b.coverUrl))) {
      const v = await dene('uzak coverUrl', adresten(String(b.coverUrl)));
      if (v) return { bayt: v, kaynak: 'uzak-indirildi' };
    }
    const id = String(b.assetId || '');
    const onekler = [`${anahtar}/assets/${id}/`, `assets/${id}/`];
    for (const o of onekler) {
      const v = await dene('thumbs/1.jpg', async () => okuyucu.oku(`${o}thumbs/1.jpg`));
      if (v) return { bayt: v, kaynak: 'thumbs' };
    }
    for (const o of onekler) {
      for (const p of ILK_SAYFA) {
        const v = await dene(p, async () => okuyucu.oku(`${o}${p}`));
        if (v) {
          return { bayt: v, kaynak: 'ilk-sayfa', uyari: `${anahtar} "${b.title || ''}": thumbs/1.jpg yok — ilk sayfa (${p}) kapak yapıldı` };
        }
      }
    }
  }
  return {
    bayt: yerTutucuSvg(b.title, setAdi), kaynak: 'yer-tutucu',
    uyari: `${anahtar} "${b.title || ''}": hiçbir kaynakta kapak yok — YER TUTUCU kondu`,
  };
}

/**
 * Ana adım. `zip` = iş kopyası build.zip (yerinde değişir), `calisma` = geçici dizin kökü.
 * @param {{zip:string, calisma:string, setListesi?:string|null, kisaKod?:string|null, log?:Function,
 *   warn?:Function, getir?:Function, komut?:Function, webzKoku?:string}} o
 */
async function menuKapakGaranti(o) {
  const log = o.log || (() => {});
  const warn = o.warn || log;
  const getir = o.getir || varsayilanGetir;
  const komut = o.komut || M.komut;
  const rapor = { durum: 'atlandi', kartlar: [], uyarilar: [], neden: null };

  const once = M.zipDizini(o.zip);
  const adlar = [...once.values()].filter((g) => !g.dizin).map((g) => g.ad)
    .filter((a) => !/(^|\/)(__MACOSX|\._)/.test(a));
  const onEk = onEkBul(adlar);
  const okuyucu = zipOkuyucu(o.zip, once, onEk);
  const yamaMetni = okuyucu.oku(K.YAMA);
  const ayarMetni = okuyucu.oku(K.AYAR);
  if (!yamaMetni && !ayarMetni) {
    rapor.neden = 'menü verisi yok (set değil)';
    return rapor;
  }
  // Kaynaklar: [ad, parça {once, ayarlar, sonra} | {json}]. Biçim tanınmazsa ölçülemedi (kabul RED eder).
  const kaynaklar = [];
  if (yamaMetni) {
    const s = yamaMetni.toString('utf8');
    const ayarlar = K.yamaAyarlari(s);
    if (!ayarlar || !ayarlar.books) {
      rapor.durum = 'olculemedi';
      rapor.neden = `${K.YAMA}: window.__setSettings okunamadı`;
      warn(`${ISARET} UYARI ${rapor.neden} — kapaklar onarılmadı (kabul kapısı ölçer)`);
      return rapor;
    }
    kaynaklar.push({ ad: K.YAMA, tur: 'yama', metin: s, ayarlar });
  }
  if (ayarMetni) {
    let a = null;
    try { a = JSON.parse(ayarMetni.toString('utf8')); } catch (_) { a = null; }
    if (!a || !a.books) {
      rapor.durum = 'olculemedi';
      rapor.neden = `${K.AYAR}: books okunamadı`;
      warn(`${ISARET} UYARI ${rapor.neden} — kapaklar onarılmadı (kabul kapısı ölçer)`);
      return rapor;
    }
    kaynaklar.push({ ad: K.AYAR, tur: 'json', ayarlar: a });
  }

  // Onarılacak anahtarlar: kabul ölçütünde sorunlu ya da yedek kapaklı link (kendi kapağı aranır).
  const onarim = new Map(); // anahtar → {b, books, zorunlu}
  for (const k of kaynaklar) {
    const books = k.ayarlar.books;
    for (const kart of K.booksOlc(books, okuyucu, k.ad)) {
      const mevcut = onarim.get(kart.anahtar);
      const zorunlu = !!kart.sorun;
      if (zorunlu || kart.yedekKapak) {
        onarim.set(kart.anahtar, { b: books[kart.anahtar], books, zorunlu: zorunlu || !!(mevcut && mevcut.zorunlu) });
      }
    }
  }
  if (!onarim.size) {
    rapor.durum = 'gerek-yok';
    log(`${ISARET} her kartın kapağı pakette — değişiklik yok`);
    return rapor;
  }

  const setAdi = (kaynaklar[0].ayarlar.setTitle || kaynaklar[0].ayarlar.setAdi || '');
  let webzAyar = null;
  const linkVar = [...onarim.values()].some((x) => x.b && x.b.type === 'link');
  const kod = String(o.kisaKod || '').trim();
  if (linkVar && /^[a-z0-9]{3,12}$/i.test(kod)) {
    try {
      const r = await getir(`${o.webzKoku || WEBZ_KOKU}/go/${kod}/web-stream/config/settings.json`);
      if (r && r.status === 200) webzAyar = JSON.parse(r.govde.toString('utf8'));
      else log(`${ISARET} Web-Z settings.json HTTP ${r && r.status} — Web-Z kaynağı yok`);
    } catch (e) {
      log(`${ISARET} Web-Z settings.json alınamadı: ${String(e && e.message || e).slice(0, 100)}`);
    }
  }

  // Kapakları bul (anahtar başına bir kez); yedek kapaklı linkte kendi kapağı yoksa DOKUNMA.
  const yazilacak = new Map(); // yol → bayt
  const yeniKapak = new Map(); // anahtar → yol
  for (const [anahtar, { b, books, zorunlu }] of onarim) {
    const r = await kapakBul({
      anahtar, b, books, okuyucu, listeHam: o.setListesi, webzAyar, getir, setAdi, log,
    });
    if (!zorunlu && r.kaynak !== 'panel-listesi' && r.kaynak !== 'webz') continue; // yedek zaten çalışıyor
    const yol = `images/kapak-${anahtar}.${gorselUzantisi(r.bayt)}`;
    yazilacak.set(yol, r.bayt);
    yeniKapak.set(anahtar, yol);
    rapor.kartlar.push({ anahtar, baslik: b.title || '', kaynak: r.kaynak, yol, bayt: r.bayt.length });
    if (r.uyari) {
      rapor.uyarilar.push(r.uyari);
      warn(`${ISARET} UYARI ${r.uyari}`);
    }
    log(`${ISARET} ${anahtar} "${b.title || ''}": kapak ${yol} (${r.bayt.length} bayt, kaynak ${r.kaynak})`);
  }
  if (!yeniKapak.size) {
    rapor.durum = 'gerek-yok';
    log(`${ISARET} link kartları için ayrı kapak bulunamadı; kabuk yedeği (ilk kitap kapağı) pakette — değişiklik yok`);
    return rapor;
  }

  // Menü dosyaları: yalnız ilgili anahtarların coverUrl'ü değişir.
  for (const k of kaynaklar) {
    const books = k.ayarlar.books;
    for (const [anahtar, yol] of yeniKapak) if (books[anahtar]) books[anahtar].coverUrl = yol;
    if (k.tur === 'json') {
      yazilacak.set(k.ad, Buffer.from(`${JSON.stringify(k.ayarlar, null, 2)}\n`));
    } else {
      // Gömülü nesnenin sınırını kabul modülünün ayrıştırıcısıyla aynı yoldan bul (tek atama şartlı).
      const s = k.metin;
      const m = /window\.__setSettings\s*=\s*/.exec(s);
      const bas = m.index + m[0].length;
      let derinlik = 0; let dizgi = false; let kacis = false; let son = -1;
      for (let i = bas; i < s.length; i++) {
        const c = s[i];
        if (dizgi) {
          if (kacis) kacis = false; else if (c === '\\') kacis = true; else if (c === '"') dizgi = false;
          continue;
        }
        if (c === '"') dizgi = true;
        else if (c === '{') derinlik++;
        else if (c === '}' && --derinlik === 0) { son = i + 1; break; }
      }
      if (son < 0) throw new MenuKapakHatasi(`${k.ad}: gömülü ayar sonu bulunamadı`);
      yazilacak.set(k.ad, Buffer.from(s.slice(0, bas) + JSON.stringify(k.ayarlar, null, 2) + s.slice(son)));
    }
  }

  // Aday kopyaya yaz → kapı → rename.
  const sahne = path.join(o.calisma, `menu-kapak-${crypto.randomBytes(4).toString('hex')}`);
  const aday = `${o.zip}.menu-kapak-aday`;
  try {
    for (const [yol, v] of yazilacak) {
      const p = path.join(sahne, onEk, yol);
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, v);
    }
    await fsp.rm(aday, { force: true });
    await fsp.copyFile(o.zip, aday, fs.constants.COPYFILE_FICLONE);
    const girdiler = [...yazilacak.keys()].map((y) => `${onEk}${y}`);
    const z = await komut('zip', ['-q', '-D', '-X', '-n', M.SIKISIK_UZANTILAR, path.resolve(aday), ...girdiler], { cwd: sahne });
    if (z.code !== 0) throw new MenuKapakHatasi(`zip yazılamadı (${z.code}): ${String(z.stderr).slice(-200)}`);
    const sonra = M.zipDizini(aday);
    const yazilan = new Set(girdiler);
    const ihlal = [];
    for (const [ad, g] of once) {
      if (yazilan.has(ad)) continue;
      const s2 = sonra.get(ad);
      if (!s2 || s2.crc !== g.crc || s2.boyut !== g.boyut) ihlal.push(`değişti/silindi: ${ad}`);
    }
    for (const ad of sonra.keys()) if (!once.has(ad) && !yazilan.has(ad)) ihlal.push(`beklenmeyen girdi: ${ad}`);
    const olc = K.menuKapakOlc(zipOkuyucu(aday, sonra, onEk));
    if (olc.durum !== K.DURUM.GECTI) ihlal.push(`kabul ölçütü ${olc.durum}: ${olc.sebepler.slice(0, 3).join(' | ')}`);
    if (ihlal.length) {
      throw new MenuKapakHatasi(`kapı RED (${ihlal.length}; ilk: ${ihlal[0]}) — iş kopyası DEĞİŞMEDİ`);
    }
    await fsp.rename(aday, o.zip);
  } finally {
    await fsp.rm(aday, { force: true }).catch(() => {});
    await fsp.rm(sahne, { recursive: true, force: true }).catch(() => {});
  }
  rapor.durum = 'uygulandi';
  log(`${ISARET} ${yeniKapak.size} kart kapağı yazıldı: ${[...yeniKapak.keys()].join(', ')}`);
  return rapor;
}

module.exports = {
  ISARET, MenuKapakHatasi, gorselUzantisi, kapakGecerli, dataCoz, listedenLinkKapagi, webzLinkKapagi,
  yerTutucuSvg, onEkBul, zipOkuyucu, kapakBul, menuKapakGaranti, varsayilanGetir,
};
