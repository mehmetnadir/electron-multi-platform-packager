'use strict';

/**
 * G örtü testlerinin ORTAK yardımcıları (birim + https uçtan uca). Pakete KOPYALANMAZ
 * (enjeksiyon yalnız `kitap-guncelleyici.js`'i kopyalar); `*.test.js` olmadığı için test
 * globuna da girmez. Sunucu tarafını (manifest + imza + dosya + arşiv uçları) taklit eder —
 * gerçek sunucu tarafı kararı SONRA (Nadir 26.09).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const sha = (b) => crypto.createHash('sha256').update(Buffer.from(b)).digest('hex');

let CRC = null;
function crc32(b) {
  if (!CRC) {
    CRC = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Asgari ZIP yazıcı (store; `sikistir` ile deflate). @param {{yol, veri, sikistir?}[]} girdiler */
function zipYap(girdiler) {
  const yerel = [];
  const merkez = [];
  let ofset = 0;
  for (const g of girdiler) {
    const ad = Buffer.from(g.yol, 'utf8');
    const ham = Buffer.from(g.veri);
    const yontem = g.sikistir ? 8 : 0;
    const govde = g.sikistir ? zlib.deflateRawSync(ham) : ham;
    const crc = crc32(ham);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(yontem, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(govde.length, 18);
    lh.writeUInt32LE(ham.length, 22); lh.writeUInt16LE(ad.length, 26);
    yerel.push(lh, ad, govde);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(yontem, 10); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(govde.length, 20); ch.writeUInt32LE(ham.length, 24);
    ch.writeUInt16LE(ad.length, 28); ch.writeUInt32LE(ofset, 42);
    merkez.push(ch, ad);
    ofset += lh.length + ad.length + govde.length;
  }
  const yb = Buffer.concat(yerel);
  const mb = Buffer.concat(merkez);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(girdiler.length, 8); e.writeUInt16LE(girdiler.length, 10);
  e.writeUInt32LE(mb.length, 12); e.writeUInt32LE(yb.length, 16);
  return Buffer.concat([yb, mb, e]);
}

/**
 * Yayın rota tablosu. `kabuk`: {yol: içerik}; `kitaplar`: [{dizin, durum, dosyalar:{yol: içerik}}].
 * Bozma seçenekleri: `imzaBoz`, `dosyalarSil:<dizin>`, `arsivBoz:{<dizin>:'fazla'|'icerik'}`,
 * `dosyaSil:[kabuk yolu]` (manifestte var, uçta 404).
 */
function yayinRotalari(o) {
  const kimlik = String(o.setKimligi);
  const kok = `/set/${kimlik}`;
  const r = {};
  const kabuk = [];
  for (const [yol, icerik] of Object.entries(o.kabuk || {})) {
    const b = Buffer.from(icerik);
    kabuk.push({ yol, sha256: sha(b), boyut: b.length });
    if (!(o.dosyaSil || []).includes(yol)) r[`${kok}/dosya/${yol}`] = b;
  }
  const kitaplar = [];
  for (const k of o.kitaplar || []) {
    if (k.durum !== 'ekle') { kitaplar.push({ dizin: k.dizin, durum: k.durum }); continue; }
    const girdiler = Object.entries(k.dosyalar).map(([yol, v]) => ({ yol, veri: Buffer.from(v), sikistir: true }));
    const dosyalar = girdiler.map((g) => ({ yol: g.yol, sha256: sha(g.veri), boyut: g.veri.length }));
    const bozma = (o.arsivBoz || {})[k.dizin];
    let arsivGirdileri = girdiler;
    if (bozma === 'fazla') arsivGirdileri = [...girdiler, { yol: 'fazla.js', veri: Buffer.from('kötü()') }];
    if (bozma === 'icerik') arsivGirdileri = girdiler.map((g, i) => (i === 0 ? { ...g, veri: Buffer.from('DEGISMIS') } : g));
    const zip = k.zip || zipYap(arsivGirdileri);
    const adres = `/arsiv/${k.dizin}.zip`;
    r[adres] = zip;
    const giris = { dizin: k.dizin, durum: 'ekle', kaynak: `${o.tabanUrl}${adres}`, sha256: sha(zip), boyut: zip.length };
    // `listesiz`: G yayın aracının bugünkü biçimi — `ekle` girdisinde `dosyalar[]` YOK.
    if (o.dosyalarSil !== k.dizin && !o.listesiz) giris.dosyalar = k.dosyaListesi || dosyalar;
    kitaplar.push(giris);
  }
  // Kimlik alanları (2026-09-26): `kanal`/`manifestSet` ile bozulabilir (ret testleri).
  const govde = {
    sema: 1,
    kanal: o.kanal === undefined ? 'G' : o.kanal,
    setKimligi: o.manifestSet === undefined ? kimlik : o.manifestSet,
    surum: o.surum,
    kabuk,
    kitaplar,
  };
  const manifest = Buffer.from(JSON.stringify(govde));
  // surum.json imzasız TETİKTİR: `surumTetik` ile "yalan söyleyen" tetik sınanır.
  r[`${kok}/surum.json`] = JSON.stringify({
    surum: o.surumTetik || o.surum, uretim: '2026-09-26T00:00:00Z', setKimligi: kimlik,
  });
  r[`${kok}/manifest.json`] = manifest;
  r[`${kok}/manifest.json.sig`] = o.imzala(o.imzaBoz ? Buffer.concat([manifest, Buffer.from(' ')]) : manifest);
  return r;
}

/** Bir dizindeki dosyaları {yol: Buffer} olarak okur (arşive konacak kitap). */
function dizinOku(kok, on = '') {
  const cikti = {};
  for (const g of fs.readdirSync(on ? path.join(kok, on) : kok, { withFileTypes: true })) {
    const gor = on ? `${on}/${g.name}` : g.name;
    if (g.isDirectory()) Object.assign(cikti, dizinOku(kok, gor));
    else if (g.isFile()) cikti[gor] = fs.readFileSync(path.join(kok, gor));
  }
  return cikti;
}

/** Ağaç parmak izi: göreli yol → sha256 (gövdeye yazılmadığının kanıtı). */
function agacOzeti(kok) {
  const o = {};
  for (const [y, b] of Object.entries(dizinOku(kok))) o[y] = sha(b);
  return o;
}

/** `sunucuFn(rotaNesnesi)` ile sunucu kurar, adresini öğrenince rotaları üretip bağlar. */
async function sunucuKurVeYayinla(sunucuFn, rotalarFn) {
  const rot = {};
  const s = await sunucuFn(rot);
  Object.assign(rot, rotalarFn(s.taban));
  return s;
}

module.exports = { sha, zipYap, yayinRotalari, dizinOku, agacOzeti, sunucuKurVeYayinla };
