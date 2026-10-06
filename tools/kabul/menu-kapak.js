#!/usr/bin/env node
'use strict';
/**
 * MENÜ KAPAK KAPISI — set menüsündeki her kartın kapak dosyası pakette var mı (2026-10-06).
 *
 * DOĞUŞ (Nadir 06.10 12:03, Super Monsters 2 Set 59835): Windows exe set menüsünde "Teacher's Pack"
 * ve "Worksheets" kartlarının kapağı kırık, alt metin görünüyor; Web-Z'de 5 kapak tam. Ölçüm:
 *   - kabuk (`scripts/language-set.js` loadLanguageSet) link kartında `coverUrl` yoksa
 *     `images/<ilk kitap anahtarı>.png` (book1.png) yükler;
 *   - üreteç (`src/agent/index-ureteci.js`) link girdisine `coverUrl` yazmaz ve kabuğu açarken
 *     `images/book*` dosyalarını BİLEREK dışarıda bırakır → `images/book1.png` pakette yok → kırık.
 * Hiçbir kapı bunu ölçmüyordu (kart SAYISI ölçülüyordu, kart GÖRSELİ değil).
 *
 * ÖLÇÜT: menüde çizilen her kart (link ya da assetId'li kitap) için kabuğun YÜKLEYECEĞİ kapak yolu
 * çözülür (kabuğun kendi kuralıyla, aşağıda `kapakYolu`); dosya pakette VAR ve > 1 KB değilse RED.
 * `data:` kapak gömülüdür (çözülmüş bayt > 1 KB şartı aynı). `http(s)://` kapak çevrimdışı kırıktır →
 * RED. Menü verisi iki yerde durur: `scripts/cevrimdisi-yama.js` (`window.__setSettings`, çevrimdışı
 * kabuğun gerçekten okuduğu) ve `config/settings.json` — ikisi de ölçülür.
 * Set olmayan paket (ikisi de yok) → ATLANDI (katman eklenmez).
 *
 * Sonuç: { durum: GECTI|RED|OLCULEMEDI|ATLANDI, kartlar:[{anahtar, kaynak, yol, bayt, sorun}],
 *          sebepler:[], uyarilar:[] }. Ölçülemeyen bir şey GEÇTİ'ye DÜŞMEZ.
 *
 * Kullanım (CLI): node tools/kabul/menu-kapak.js <paket-kökü | app.asar>
 *   Çıkış: 0 GEÇTİ/ATLANDI · 1 RED · 3 ÖLÇÜLEMEDİ · 2 kullanım hatası.
 *
 * BOZARSAN: `menu-kapak.test.js` (kırık fixture RED, tam fixture GEÇTİ, kabuk yedek kuralı) kırılır.
 */
const fs = require('fs');
const path = require('path');
const { atlananUyelerOku, notSatiri: atlananNotSatiri } = require('./atlanan-uyeler');

const DURUM = Object.freeze({
  GECTI: 'GECTI', RED: 'RED', OLCULEMEDI: 'OLCULEMEDI', ATLANDI: 'ATLANDI',
});
/** 9 baytlık 404 gövdeleri ve boş dosyalar kapak değildir (set-kabuk-tazele KAPAK_ALT_SINIR ile aynı). */
const KAPAK_ALT_SINIR = 1024;
const YAMA = 'scripts/cevrimdisi-yama.js';
const AYAR = 'config/settings.json';
/** Yer tutucu imzası (src/agent/menu-kapak-garanti.js yazar): kabul GEÇER ama uyarı verir. */
const YER_TUTUCU_IMZASI = 'data-empp-yer-tutucu';
const YAMA_ATAMASI = /window\.__setSettings\s*=\s*/g;

/** `window.__setSettings = {...};` gövdesini okur. Biçim tanınmazsa null. SAF. */
function yamaAyarlari(metin) {
  const s = String(metin == null ? '' : metin);
  const m = [...s.matchAll(YAMA_ATAMASI)];
  if (m.length !== 1) return null;
  const bas = m[0].index + m[0][0].length;
  if (s[bas] !== '{') return null;
  let derinlik = 0;
  let dizgi = false;
  let kacis = false;
  for (let i = bas; i < s.length; i++) {
    const c = s[i];
    if (dizgi) {
      if (kacis) kacis = false;
      else if (c === '\\') kacis = true;
      else if (c === '"') dizgi = false;
      continue;
    }
    if (c === '"') dizgi = true;
    else if (c === '{') derinlik++;
    else if (c === '}') {
      derinlik--;
      if (derinlik === 0) {
        try { return JSON.parse(s.slice(bas, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

const linkMi = (b) => !!(b && b.type === 'link');

/**
 * Kabuğun bir kart için YÜKLEYECEĞİ kapak adresi — `language-set.js` loadLanguageSet ile BİREBİR
 * (Web-Z ve paket kabuğu aynı kural, ölçüldü 06.10):
 *   coverUrl varsa o; link ise `images/<ilk link-olmayan anahtar>.png` (yoksa images/book1.png);
 *   kitap ise `images/<anahtar>.png`. SAF.
 */
function kapakYolu(anahtar, b, books) {
  if (b && b.coverUrl) return String(b.coverUrl);
  if (linkMi(b)) {
    const ilk = Object.keys(books || {}).find((k) => !books[k] || books[k].type !== 'link');
    return ilk ? `images/${ilk}.png` : 'images/book1.png';
  }
  return `images/${anahtar}.png`;
}

/** Kabuğun ÇİZDİĞİ kartlar: link ya da assetId'li kitap (kabuk "katı mod" süzgeci). SAF. */
function cizilenKartlar(books) {
  const b = books && typeof books === 'object' && !Array.isArray(books) ? books : {};
  return Object.keys(b).filter((k) => linkMi(b[k]) || !!(b[k] && b[k].assetId));
}

/** Kapak adresini sınıflar: {tur: 'data'|'uzak'|'yerel', yol?, bayt?}. SAF. */
function adresSinifi(adres) {
  const a = String(adres || '').trim();
  if (/^data:/i.test(a)) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/is.exec(a);
    if (!m) return { tur: 'data', bayt: 0 };
    let bayt = 0;
    try {
      bayt = m[2] ? Buffer.from(m[3], 'base64').length : Buffer.from(decodeURIComponent(m[3])).length;
    } catch (_) { bayt = 0; }
    return { tur: 'data', bayt };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(a) || a.startsWith('//')) return { tur: 'uzak' };
  let yol = a.split('#')[0].split('?')[0].replace(/^\.\//, '').replace(/^\/+/, '');
  try { yol = decodeURIComponent(yol); } catch (_) { /* olduğu gibi */ }
  return { tur: 'yerel', yol: path.posix.normalize(yol) };
}

/**
 * Bir menü kaynağını (books nesnesi) ölçer. `okuyucu.boyut(rel)` → bayt | null (yok),
 * `okuyucu.oku(rel)` → Buffer | null (yer tutucu imzası için). SAF (okuyucu dışında).
 */
function booksOlc(books, okuyucu, kaynak) {
  const kartlar = [];
  for (const anahtar of cizilenKartlar(books)) {
    const b = books[anahtar];
    const adres = kapakYolu(anahtar, b, books);
    const s = adresSinifi(adres);
    const kart = {
      anahtar, kaynak, link: linkMi(b), baslik: (b && b.title) || '', adres: adres.slice(0, 120),
      yol: s.yol || null, bayt: null, sorun: null, yerTutucu: false, yedekKapak: linkMi(b) && !b.coverUrl,
    };
    if (s.tur === 'uzak') kart.sorun = 'uzak kapak (çevrimdışı kırık)';
    else if (s.tur === 'data') {
      kart.bayt = s.bayt;
      if (s.bayt <= KAPAK_ALT_SINIR) kart.sorun = `gömülü kapak ${s.bayt} bayt (≤ ${KAPAK_ALT_SINIR})`;
    } else {
      const boyut = okuyucu.boyut(s.yol);
      kart.bayt = boyut;
      if (boyut == null) kart.sorun = `kapak dosyası pakette yok: ${s.yol}`;
      else if (boyut <= KAPAK_ALT_SINIR) kart.sorun = `kapak dosyası ${boyut} bayt (≤ ${KAPAK_ALT_SINIR}): ${s.yol}`;
      else if (/\.svg$/i.test(s.yol) && okuyucu.oku) {
        const v = okuyucu.oku(s.yol);
        kart.yerTutucu = !!(v && v.toString('utf8').includes(YER_TUTUCU_IMZASI));
      }
    }
    kartlar.push(kart);
  }
  return kartlar;
}

/**
 * Paket kökünü ölçer. `okuyucu` = {boyut(rel), oku(rel)}; `oku` metin dosyaları için de kullanılır.
 * @returns {{durum:string, kartlar:object[], sebepler:string[], uyarilar:string[]}}
 */
function menuKapakOlc(okuyucu) {
  const sonuc = { durum: DURUM.GECTI, kartlar: [], sebepler: [], uyarilar: [] };
  const metin = (rel) => {
    const v = okuyucu.oku(rel);
    return v == null ? null : v.toString('utf8');
  };
  const yamaMetni = metin(YAMA);
  const ayarMetni = metin(AYAR);
  if (yamaMetni == null && ayarMetni == null) {
    return { ...sonuc, durum: DURUM.ATLANDI, sebepler: ['menü verisi yok (settings.json / yama) — set değil'] };
  }
  const kaynaklar = [];
  if (yamaMetni != null) {
    const a = yamaAyarlari(yamaMetni);
    if (!a || !a.books || typeof a.books !== 'object') {
      sonuc.sebepler.push(`${YAMA}: window.__setSettings.books okunamadı`);
    } else kaynaklar.push([YAMA, a.books]);
  }
  if (ayarMetni != null) {
    let a = null;
    try { a = JSON.parse(ayarMetni); } catch (_) { a = null; }
    if (!a || !a.books || typeof a.books !== 'object') sonuc.sebepler.push(`${AYAR}: books okunamadı`);
    else kaynaklar.push([AYAR, a.books]);
  }
  if (!kaynaklar.length) return { ...sonuc, durum: DURUM.OLCULEMEDI };
  for (const [ad, books] of kaynaklar) sonuc.kartlar.push(...booksOlc(books, okuyucu, ad));
  const sorunlu = sonuc.kartlar.filter((k) => k.sorun);
  for (const k of sorunlu) sonuc.sebepler.push(`${k.anahtar} "${k.baslik}" (${k.kaynak}): ${k.sorun}`);
  for (const k of sonuc.kartlar.filter((x) => x.yerTutucu)) {
    sonuc.uyarilar.push(`${k.anahtar} "${k.baslik}": yer tutucu kapak (kaynakta kapak yoktu)`);
  }
  if (sorunlu.length) sonuc.durum = DURUM.RED;
  else if (sonuc.sebepler.length) sonuc.durum = DURUM.OLCULEMEDI;
  // ATLANAN ÜYE (Nadir 06.10): build manifesti (`empp-uretec.json` atlananUyeler) — kart beklenmez; rapora not.
  const atlanan = atlananUyelerOku(okuyucu);
  if (atlanan.length) {
    sonuc.atlananUyeler = atlanan;
    sonuc.notlar = [atlananNotSatiri(atlanan)];
  }
  return sonuc;
}

/** Açılmış dizin ya da app.asar için okuyucu. Saf değil (fs). */
function kokOkuyucu(kok, asarMi = /\.asar$/i.test(String(kok))) {
  if (asarMi) {
    // eslint-disable-next-line global-require
    const asar = require('@electron/asar');
    return {
      boyut: (rel) => {
        try {
          const st = asar.statFile(kok, rel);
          return st && typeof st.size === 'number' ? st.size : null;
        } catch (_) { return null; }
      },
      oku: (rel) => { try { return asar.extractFile(kok, rel); } catch (_) { return null; } },
    };
  }
  const taban = path.resolve(kok);
  const tam = (rel) => {
    const p = path.resolve(taban, rel);
    return p.startsWith(taban + path.sep) ? p : null;
  };
  return {
    boyut: (rel) => {
      const p = tam(rel);
      try { const st = p && fs.statSync(p); return st && st.isFile() ? st.size : null; } catch (_) { return null; }
    },
    oku: (rel) => {
      const p = tam(rel);
      try { return p ? fs.readFileSync(p) : null; } catch (_) { return null; }
    },
  };
}

/** Kabul kapısı katmanı: paket kökü (dizin | app.asar). */
function menuKapakOlcKok(kok, { asar } = {}) {
  return menuKapakOlc(asar == null ? kokOkuyucu(kok) : kokOkuyucu(kok, asar));
}

/** Tek satırlık özet (kabul günlüğü). SAF. */
function ozetSatiri(s) {
  const tr = { GECTI: 'GEÇTİ', RED: 'RED', OLCULEMEDI: 'ÖLÇÜLEMEDİ', ATLANDI: 'ATLANDI' };
  const kart = new Set(s.kartlar.map((k) => k.anahtar)).size;
  return `menü kapak: ${tr[s.durum] || s.durum} · ${kart} kart`
    + `${s.sebepler.length ? ` — ${s.sebepler.slice(0, 4).join(' | ')}` : ''}`
    + `${s.uyarilar.length ? ` · UYARI: ${s.uyarilar.join(' | ')}` : ''}`
    + `${s.notlar && s.notlar.length ? ` · NOT: ${s.notlar.join(' | ')}` : ''}`;
}

/** KABUL_MENU_KAPAK kipi: `uyar` (varsayılan) | `reddet` | `kapali`. Tanınmayan değer → uyar. Saf. */
function kip(env = process.env) {
  const v = String((env && env.KABUL_MENU_KAPAK) || '').trim().toLowerCase();
  return v === 'reddet' || v === 'kapali' ? v : 'uyar';
}

/**
 * Kasa/ProBook kabul kapısı kararı (tanım tek kaynak; kabuk betiği aynı kuralı çıkış koduyla uygular).
 *  - uyar (varsayılan): RED/ÖLÇÜLEMEDİ kabulü düşürmez, yalnız `[kabul] menu kapak UYARI: <ilk sebep>`.
 *  - reddet: RED kabulü düşürür; ÖLÇÜLEMEDİ yine yalnız uyarı (aracın paket düzenini tanımaması
 *    kabulü durdurmamalı).
 *  - kapali: ölçüm koşmaz (kapı çağıranda atlanır).
 * @returns {{dusur:boolean, log:string, sebep:string}}
 */
function kapiKarari(sonuc, kp = 'uyar') {
  const sebep = (sonuc.sebepler && sonuc.sebepler[0]) || 'sebep yok';
  if (sonuc.durum === DURUM.GECTI || sonuc.durum === DURUM.ATLANDI) {
    return { dusur: false, log: '[kabul] menu kapak GECTI', sebep: '' };
  }
  if (sonuc.durum === DURUM.RED && kp === 'reddet') {
    return { dusur: true, log: `[kabul] menu kapak RED: ${sebep}`, sebep };
  }
  return { dusur: false, log: `[kabul] menu kapak UYARI: ${sebep}`, sebep };
}

/**
 * Paket DOSYASINI (exe/dmg/apk/impark/zip) açıp ölçer. Pardus .impark asar akışından yalnız menü
 * dosyaları (yama, settings, images/) alınır; uzak girdide akış ProBook'ta koşar.
 * @param {{paket:string, platform?:string, calisma?:string, uzak?:{sshArgv:string[], node?:string|null}}} p
 */
async function paketMenuKapakOlc(p) {
  /* eslint-disable global-require */
  const os = require('os');
  const { paketiAc, platformTahmin, platformNormalize, yedizBul } = require('./paket-cikar');
  const dizinMi = !p.uzak && fs.statSync(p.paket).isDirectory();
  const platform = p.uzak ? 'pardus' : (platformNormalize(p.platform) || platformTahmin(p.paket, dizinMi));
  if (!platform) throw new Error(`platform belirlenemedi (--platform ver): ${p.paket}`);
  const kendi = !p.calisma;
  const calisma = p.calisma || fs.mkdtempSync(path.join(os.tmpdir(), 'menu-kapak-paket-'));
  let acilis = null;
  try {
    if (platform === 'pardus') {
      const IC = require('./impark-okuyucu-cikar');
      const hedef = path.join(calisma, 'impark-menu');
      const ortak = {
        paket: p.paket, hedef,
        gerekliMi: (rel) => rel === YAMA || rel === AYAR || rel === 'empp-uretec.json' || rel.startsWith('images/'),
      };
      const c = p.uzak
        ? await IC.uzakImparkAgaciCikar({ ...ortak, sshArgv: p.uzak.sshArgv, uzakNode: p.uzak.node })
        : await IC.imparkAgaciCikar({ ...ortak, yediz: yedizBul() });
      const s = menuKapakOlcKok(hedef, { asar: false });
      if (c.eksik && c.eksik.length) s.sebepler.push(`okunamayan dosya: ${c.eksik.slice(0, 3).join(', ')}`);
      return s;
    }
    acilis = paketiAc({ paket: p.paket, platform, calisma, log: p.log || (() => {}) });
    return menuKapakOlcKok(acilis.kok, { asar: acilis.asar });
  } finally {
    if (acilis && acilis.kapat) { try { acilis.kapat(); } catch (_) { /* log çağıranda */ } }
    if (kendi) { try { fs.rmSync(calisma, { recursive: true, force: true }); } catch (_) { /* kalsın */ } }
  }
}

module.exports = {
  DURUM, KAPAK_ALT_SINIR, YER_TUTUCU_IMZASI, YAMA, AYAR,
  yamaAyarlari, kapakYolu, cizilenKartlar, adresSinifi, booksOlc, menuKapakOlc, kokOkuyucu,
  menuKapakOlcKok, ozetSatiri, kip, kapiKarari, paketMenuKapakOlc,
};

if (require.main === module) {
  const a = process.argv.slice(2);
  const al = (ad) => { const i = a.indexOf(ad); return i >= 0 ? a[i + 1] : null; };
  const hedef = a.find((x, i) => !x.startsWith('-') && (i === 0 || !a[i - 1].startsWith('--')));
  if (!hedef) {
    process.stderr.write('Kullanım: node tools/kabul/menu-kapak.js <paket-kökü | app.asar | paket> '
      + '[--platform mac|android|windows|pardus|dizin|zip] [--uzak-konak k@h [--uzak-anahtar a] [--uzak-node n]]\n');
    process.exit(2);
  }
  const bitir = (s) => {
    process.stdout.write(`${ozetSatiri(s)}\n`);
    process.exit({ GECTI: 0, ATLANDI: 0, RED: 1, OLCULEMEDI: 3 }[s.durum]);
  };
  const kokMu = !al('--platform') && !al('--uzak-konak')
    && (/\.asar$/i.test(hedef) || (fs.existsSync(hedef) && fs.statSync(hedef).isDirectory()));
  if (kokMu) bitir(menuKapakOlcKok(hedef));
  else {
    // eslint-disable-next-line global-require
    const IC = require('./okuyucu-surumu-kapisi');
    const konak = al('--uzak-konak');
    const uzak = konak ? {
      sshArgv: IC.uzakSshArgv({ konak, anahtar: al('--uzak-anahtar') }), node: al('--uzak-node'),
    } : null;
    paketMenuKapakOlc({ paket: uzak ? hedef : path.resolve(hedef), platform: al('--platform'), uzak })
      .then(bitir)
      .catch((e) => bitir({
        durum: DURUM.OLCULEMEDI, kartlar: [], sebepler: [`paket açılamadı: ${e.message}`], uyarilar: [],
      }));
  }
}
