'use strict';
/**
 * KÜÇÜK GÖRSEL (THUMBS) ONARIMI — paketleyiciye gitmeden önceki son build zip'inde (06.10).
 *
 * Olay: 11845 Super Monsters 3 Windows kabulde KALDI — "book4: thumb=1 sayfa=1/10". R2 build'inde
 * book4/assets/11840/pages/ 10 sayfa, thumbs/ 1 dosya; o tek dosya da şifreli (mod1) sayfanın
 * kopyasıydı. Üreteçteki thumbs-uret.js mod1'i dosya ADINDAN arıyor (sayfalar .png adlı ama mod1),
 * Windows kasada sips yok, kasada `zip` komutu da yok. Bu modül platformdan bağımsızdır:
 *   - sayfa sayısı > geçerli thumb sayısı olan her `assets/<id>/` için eksik/geçersiz thumb'ları
 *     sayfadan üretir (mod1 ise ilk 100 bayt çözülür; sharp ile küçültülür, düz JPEG),
 *   - zip'e saf JS ile EKLER (yerel başlık + merkez dizin yeniden yazılır; eski aynı adlı kayıt
 *     merkez dizinden düşer), aday kopyada doğrular, sonra yerine koyar.
 * Thumbs İmpark kuralına göre DÜZ kalır (şifrelenmez). Zip64 zip'e dokunulmaz (uyarı).
 */
const fs = require('fs');
const fsp = require('fs/promises');
const M = require('./icerik-merdiven');

const ISARET = '[thumbs-onar]';
const MOD1_N = 100; // .png/.jpg için yayincilikadm impark_crypto DEFAULT_N
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = Buffer.from([0xff, 0xd8, 0xff]);
const THUMB_GENISLIK = 360;
const SAYFA_RE = /^(.*\/)?(book\d+\/assets\/[^/]+\/)pages\/(\d+)\.(png|jpe?g)$/i;

/** mod1 (ilk n bayt 256-x) — involütif. Saf. */
function mod1Cevir(buf, n = MOD1_N) {
  const out = Buffer.from(buf);
  const sinir = Math.min(n, out.length);
  for (let i = 0; i < sinir; i++) out[i] = (256 - out[i]) & 0xff;
  return out;
}

/** Görsel imzası var mı (png/jpg/webp/gif). Saf. */
function gorselMi(buf) {
  if (!buf || buf.length < 12) return false;
  return buf.subarray(0, 8).equals(PNG) || buf.subarray(0, 3).equals(JPG)
    || (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP')
    || buf.toString('latin1', 0, 3) === 'GIF';
}

/** Sayfa baytlarını görsel olarak döndürür: düzse aynen, mod1 ise çözülmüş; ikisi de değilse null. Saf. */
function sayfaGorseli(buf) {
  if (gorselMi(buf)) return buf;
  const coz = mod1Cevir(buf);
  return gorselMi(coz) ? coz : null;
}

/**
 * Onarılacak thumb'ları planlar. Saf (girdi: zip dizini Map'i).
 * Grup = `<önek>bookN/assets/<id>/`. Thumb sayısı sayfa sayısından azsa o grubun sayfası olup
 * thumb'ı olmayan ya da thumb'ı aday (geçerliliği okunarak denetlenecek) olanlar döner.
 * @returns {Array<{grup, n, sayfa, thumb, mevcut}>}
 */
function onarimPlani(dizin) {
  const gruplar = new Map();
  for (const g of dizin.values()) {
    if (g.dizin) continue;
    const m = SAYFA_RE.exec(g.ad);
    if (!m) continue;
    const grup = `${m[1] || ''}${m[2]}`;
    if (!gruplar.has(grup)) gruplar.set(grup, []);
    gruplar.get(grup).push({ n: m[3], sayfa: g.ad });
  }
  const plan = [];
  for (const [grup, sayfalar] of gruplar) {
    const thumbSay = sayfalar.filter((s) => dizin.has(`${grup}thumbs/${s.n}.jpg`)).length;
    // Sayılar eşitse thumbs'a güvenilir (okuma maliyeti yok). Eksikse grubun tamamı denetlenir.
    if (thumbSay >= sayfalar.length) continue;
    for (const s of sayfalar) {
      const thumb = `${grup}thumbs/${s.n}.jpg`;
      plan.push({ grup, n: s.n, sayfa: s.sayfa, thumb, mevcut: dizin.has(thumb) });
    }
  }
  return plan;
}

function dosTarih(d = new Date()) {
  const zaman = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const tarih = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { zaman, tarih };
}

/** EOCD + ham merkez dizin. Zip64 ise null. */
function merkezDiziniOku(fd, boyut) {
  const kuyrukBoy = Math.min(boyut, 22 + 65535);
  const kuyruk = Buffer.alloc(kuyrukBoy);
  fs.readSync(fd, kuyruk, 0, kuyrukBoy, boyut - kuyrukBoy);
  let e = -1;
  for (let i = kuyrukBoy - 22; i >= 0; i--) {
    if (kuyruk.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  }
  if (e < 0) throw new Error('merkez dizin sonu yok');
  const adet = kuyruk.readUInt16LE(e + 10);
  const cdBoy = kuyruk.readUInt32LE(e + 12);
  const cdOfs = kuyruk.readUInt32LE(e + 16);
  if (adet === 0xffff || cdBoy === 0xffffffff || cdOfs === 0xffffffff) return null;
  if (e >= 20 && kuyruk.readUInt32LE(e - 20) === 0x07064b50) return null;
  const cd = Buffer.alloc(cdBoy);
  fs.readSync(fd, cd, 0, cdBoy, cdOfs);
  return { adet, cdOfs, cd };
}

/**
 * Zip'e STORED girdiler ekler; aynı adlı eski kayıtlar merkez dizinden düşer (veri yetim kalır).
 * Dosyayı yerinde değiştirir — çağıran aday kopya üzerinde çalışmalı.
 * @param {string} zipYolu @param {Array<{ad:string, veri:Buffer}>} ekler
 */
function zipeEkle(zipYolu, ekler) {
  const fd = fs.openSync(zipYolu, 'r+');
  try {
    const boyut = fs.fstatSync(fd).size;
    const md = merkezDiziniOku(fd, boyut);
    if (!md) throw new Error('zip64 zip — ekleme desteklenmiyor');
    const ekAdlar = new Set(ekler.map((x) => x.ad));
    const eskiKayitlar = [];
    let p = 0;
    for (let k = 0; k < md.adet; k++) {
      if (md.cd.readUInt32LE(p) !== 0x02014b50) throw new Error('merkez dizin bozuk');
      const adBoy = md.cd.readUInt16LE(p + 28);
      const uz = 46 + adBoy + md.cd.readUInt16LE(p + 30) + md.cd.readUInt16LE(p + 32);
      const ad = md.cd.subarray(p + 46, p + 46 + adBoy).toString('utf8');
      if (!ekAdlar.has(ad)) eskiKayitlar.push(md.cd.subarray(p, p + uz));
      p += uz;
    }
    const { zaman, tarih } = dosTarih();
    let konum = md.cdOfs;
    const yeniKayitlar = [];
    for (const { ad, veri } of ekler) {
      const adB = Buffer.from(ad, 'utf8');
      const crc = M.crc32(veri);
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
      lh.writeUInt16LE(0, 8); lh.writeUInt16LE(zaman, 10); lh.writeUInt16LE(tarih, 12);
      lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(veri.length, 18); lh.writeUInt32LE(veri.length, 22);
      lh.writeUInt16LE(adB.length, 26); lh.writeUInt16LE(0, 28);
      if (konum + 30 + adB.length + veri.length > 0xfffffffe) throw new Error('zip 4 GB sınırını aşar');
      const yerelOfs = konum;
      for (const parca of [lh, adB, veri]) { fs.writeSync(fd, parca, 0, parca.length, konum); konum += parca.length; }
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
      ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(zaman, 12); ch.writeUInt16LE(tarih, 14);
      ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(veri.length, 20); ch.writeUInt32LE(veri.length, 24);
      ch.writeUInt16LE(adB.length, 28); ch.writeUInt32LE(yerelOfs, 42);
      yeniKayitlar.push(Buffer.concat([ch, adB]));
    }
    const yeniCd = Buffer.concat([...eskiKayitlar, ...yeniKayitlar]);
    const adet = eskiKayitlar.length + yeniKayitlar.length;
    if (adet >= 0xffff) throw new Error('girdi sayısı zip64 gerektirir');
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(adet, 8); eocd.writeUInt16LE(adet, 10);
    eocd.writeUInt32LE(yeniCd.length, 12); eocd.writeUInt32LE(konum, 16);
    fs.writeSync(fd, yeniCd, 0, yeniCd.length, konum);
    fs.writeSync(fd, eocd, 0, eocd.length, konum + yeniCd.length);
    fs.ftruncateSync(fd, konum + yeniCd.length + eocd.length);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Ana adım. FIRLATMAZ değil: zip yazımı/doğrulama düşerse fırlatır (iş kopyası değişmemiş olur).
 * @returns {Promise<{durum:'atlandi'|'uygulandi', onarilan:number, gruplar:string[], uyari?:string}>}
 */
async function thumbsOnar({ zip, log = () => {}, warn = log, sharpFn = null }) {
  const dizin = M.zipDizini(zip);
  const plan = onarimPlani(dizin);
  if (!plan.length) return { durum: 'atlandi', onarilan: 0, gruplar: [] };
  const sharp = sharpFn || require('sharp');
  const ekler = [];
  const uyarilar = [];
  for (const x of plan) {
    if (x.mevcut) {
      try { if (gorselMi(M.zipGirdiOku(zip, dizin.get(x.thumb)))) continue; } catch (_) { /* yeniden üret */ }
    }
    let gorsel = null;
    try { gorsel = sayfaGorseli(M.zipGirdiOku(zip, dizin.get(x.sayfa))); } catch (e) { uyarilar.push(`${x.sayfa}: ${e.message}`); }
    if (!gorsel) { uyarilar.push(`${x.sayfa}: görsel çözülemedi`); continue; }
    const veri = await sharp(gorsel).resize({ width: THUMB_GENISLIK, withoutEnlargement: true })
      .jpeg({ quality: 72 }).toBuffer();
    ekler.push({ ad: x.thumb, veri });
  }
  const gruplar = [...new Set(plan.map((x) => x.grup))];
  if (!ekler.length) {
    if (uyarilar.length) warn(`${ISARET} UYARI ${uyarilar.length} sayfa çözülemedi: ${uyarilar.slice(0, 3).join(' | ')}`);
    return { durum: 'atlandi', onarilan: 0, gruplar, ...(uyarilar.length ? { uyari: uyarilar[0] } : {}) };
  }
  const aday = `${zip}.thumbs-aday`;
  try {
    await fsp.rm(aday, { force: true });
    await fsp.copyFile(zip, aday, fs.constants.COPYFILE_FICLONE);
    zipeEkle(aday, ekler);
    const sonra = M.zipDizini(aday);
    for (const { ad, veri } of ekler) {
      const g = sonra.get(ad);
      if (!g || g.boyut !== veri.length || !M.zipGirdiOku(aday, g).equals(veri)) throw new Error(`doğrulanamadı: ${ad}`);
    }
    for (const [ad, g] of dizin) {
      if (ekler.some((x) => x.ad === ad)) continue;
      const s = sonra.get(ad);
      if (!s || s.crc !== g.crc || s.boyut !== g.boyut) throw new Error(`değişti/silindi: ${ad}`);
    }
    await fsp.rename(aday, zip);
  } finally {
    await fsp.rm(aday, { force: true }).catch(() => {});
  }
  log(`${ISARET} ${ekler.length} küçük görsel üretildi (${gruplar.join(', ')})`
    + (uyarilar.length ? ` — ${uyarilar.length} sayfa çözülemedi` : ''));
  return { durum: 'uygulandi', onarilan: ekler.length, gruplar };
}

module.exports = { ISARET, mod1Cevir, gorselMi, sayfaGorseli, onarimPlani, zipeEkle, thumbsOnar };
