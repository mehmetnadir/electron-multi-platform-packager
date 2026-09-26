'use strict';

/**
 * KİTAP ARŞİVİ (ZIP) — G kanalında sete kitap EKLEMEK için.
 *
 * İstemci (`kitap-guncelleyici.js` → `arsivCozVarsayilan`) yalnız stored(0)/deflate(8)
 * açar, Zip64 AÇMAZ. Bu yüzden arşivi yine stdlib ile, istemcinin açabildiği biçimde
 * yazarız ve verilen hazır zip'i İSTEMCİNİN KENDİ okuyucusuyla sınarız (kopya kural yok).
 *
 * Arşiv kökü = kitap dizininin İÇİ (`index.html`, `assets/…`); `book4/…` sarmalı YOK —
 * istemci arşivi açıp açılan dizini doğrudan `bookN` adına taşır. Tek sarmal dizinli
 * arşiv (`book4/index.html`) `book4/book4/…` üretir; bu yüzden RED.
 *
 * Belirlenimci: girdi sıralı, tarih sabit (1980-01-01) → aynı içerik aynı bayt → aynı
 * sha256 → aynı içerik-adresli R2 anahtarı.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const kg = require('../../src/runtime/kitap-guncelleyici');

const ZIP32_TAVAN = 0xffffffff;
const GIRDI_TAVAN = 0xffff;
const DOS_SAAT = 0; // 00:00:00
const DOS_TARIH = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const UTF8_BAYRAGI = 0x0800;

const CRC_TABLO = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(veri) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(veri) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < veri.length; i++) c = CRC_TABLO[(c ^ veri[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Dizini tarar → sıralı `{yol, tam}` listesi (yalnız dosyalar). Sembolik bağ HATA
 * (kök dışına kaçabilir; sessiz atlama yerine açık ret).
 */
function dizindenGirdiler(dizin) {
  const kok = path.resolve(String(dizin));
  const cikti = [];
  const yigin = [''];
  while (yigin.length) {
    const on = yigin.pop();
    const mutlak = on ? path.join(kok, ...on.split('/')) : kok;
    for (const g of fs.readdirSync(mutlak, { withFileTypes: true })) {
      const gor = on ? `${on}/${g.name}` : g.name;
      if (g.isSymbolicLink()) throw new Error(`arşivlenecek dizinde sembolik bağ var: ${gor}`);
      if (g.isDirectory()) yigin.push(gor);
      else if (g.isFile()) cikti.push({ yol: gor, tam: path.join(kok, ...gor.split('/')) });
    }
  }
  cikti.sort((a, b) => (a.yol < b.yol ? -1 : a.yol > b.yol ? 1 : 0));
  return cikti;
}

/**
 * Düşük düzey yazıcı — YOL DENETİMİ YAPMAZ (denetim `kitapArsiviHazirla`'da). Uç-uca
 * sınamanın kötü niyetli arşiv fikstürü de bunu kullanır.
 * @param {string} hedef
 * @param {Array<{yol:string, veri?:Buffer, tam?:string}>} girdiler
 * @returns {{adet:number, boyut:number, sha256:string}}
 */
function zipYaz(hedef, girdiler) {
  const liste = Array.isArray(girdiler) ? girdiler : [];
  if (liste.length >= GIRDI_TAVAN)
    throw new Error(`arşivde ${liste.length} dosya — Zip64 gerekir, istemci açamaz`);
  const fd = fs.openSync(hedef, 'w');
  const ozetci = crypto.createHash('sha256');
  let konum = 0;
  const merkez = [];
  const yaz = (b) => {
    fs.writeSync(fd, b);
    ozetci.update(b);
    konum += b.length;
  };
  try {
    for (const g of liste) {
      const veri = Buffer.isBuffer(g.veri) ? g.veri : fs.readFileSync(g.tam);
      const ad = Buffer.from(String(g.yol), 'utf8');
      const sikisik = zlib.deflateRawSync(veri, { level: 9 });
      const yontem = sikisik.length < veri.length ? 8 : 0;
      const govde = yontem === 8 ? sikisik : veri;
      const crc = crc32(veri);
      if (veri.length >= ZIP32_TAVAN || govde.length >= ZIP32_TAVAN || konum >= ZIP32_TAVAN) {
        throw new Error(`arşiv 4 GB sınırını aşıyor (${g.yol}) — Zip64 gerekir, istemci açamaz`);
      }
      const yerel = Buffer.alloc(30);
      yerel.writeUInt32LE(0x04034b50, 0);
      yerel.writeUInt16LE(20, 4);
      yerel.writeUInt16LE(UTF8_BAYRAGI, 6);
      yerel.writeUInt16LE(yontem, 8);
      yerel.writeUInt16LE(DOS_SAAT, 10);
      yerel.writeUInt16LE(DOS_TARIH, 12);
      yerel.writeUInt32LE(crc, 14);
      yerel.writeUInt32LE(govde.length, 18);
      yerel.writeUInt32LE(veri.length, 22);
      yerel.writeUInt16LE(ad.length, 26);
      yerel.writeUInt16LE(0, 28);
      merkez.push({ ad, yontem, crc, sikisik: govde.length, acik: veri.length, yerelKonum: konum });
      yaz(yerel);
      yaz(ad);
      yaz(govde);
    }
    const merkezBas = konum;
    for (const m of merkez) {
      const b = Buffer.alloc(46);
      b.writeUInt32LE(0x02014b50, 0);
      b.writeUInt16LE(20, 4);
      b.writeUInt16LE(20, 6);
      b.writeUInt16LE(UTF8_BAYRAGI, 8);
      b.writeUInt16LE(m.yontem, 10);
      b.writeUInt16LE(DOS_SAAT, 12);
      b.writeUInt16LE(DOS_TARIH, 14);
      b.writeUInt32LE(m.crc, 16);
      b.writeUInt32LE(m.sikisik, 20);
      b.writeUInt32LE(m.acik, 24);
      b.writeUInt16LE(m.ad.length, 28);
      b.writeUInt16LE(0, 30);
      b.writeUInt16LE(0, 32);
      b.writeUInt16LE(0, 34);
      b.writeUInt16LE(0, 36);
      b.writeUInt32LE(0, 38);
      b.writeUInt32LE(m.yerelKonum, 42);
      yaz(b);
      yaz(m.ad);
    }
    const merkezBoy = konum - merkezBas;
    if (konum >= ZIP32_TAVAN)
      throw new Error('arşiv 4 GB sınırını aşıyor — Zip64 gerekir, istemci açamaz');
    const son = Buffer.alloc(22);
    son.writeUInt32LE(0x06054b50, 0);
    son.writeUInt16LE(0, 4);
    son.writeUInt16LE(0, 6);
    son.writeUInt16LE(merkez.length, 8);
    son.writeUInt16LE(merkez.length, 10);
    son.writeUInt32LE(merkezBoy, 12);
    son.writeUInt32LE(merkezBas, 16);
    son.writeUInt16LE(0, 20);
    yaz(son);
  } finally {
    fs.closeSync(fd);
  }
  return { adet: merkez.length, boyut: konum, sha256: ozetci.digest('hex') };
}

/**
 * Arşivi İSTEMCİNİN okuyucusuyla açıp denetler: açılabiliyor mu, her yol güvenli mi,
 * tek sarmal dizin var mı, en az bir dosya var mı.
 * @returns {{adet:number, yollar:string[]}}
 */
function zipDenetle(zipYolu) {
  let girdiler;
  try {
    girdiler = kg.arsivCozVarsayilan(fs.readFileSync(zipYolu));
  } catch (e) {
    throw new Error(`arşiv istemcinin okuyucusuyla açılamadı (${e.message}): ${zipYolu}`);
  }
  if (!girdiler.length) throw new Error(`arşiv boş: ${zipYolu}`);
  const yollar = [];
  for (const g of girdiler) {
    if (!kg.yolGuvenliMi(g.yol)) throw new Error(`arşivde güvensiz yol: ${JSON.stringify(g.yol)}`);
    yollar.push(g.yol.replace(/\\/g, '/'));
  }
  const kokDosyasi = yollar.some((y) => !y.includes('/'));
  const kokDallari = new Set(yollar.map((y) => y.split('/')[0]));
  if (!kokDosyasi && kokDallari.size === 1) {
    throw new Error(
      `arşiv tek sarmal dizin içeriyor (${[...kokDallari][0]}/…) — arşiv kökü kitap ` +
        'dizininin İÇİ olmalı; istemci onu bookN/bookN/… diye açar',
    );
  }
  return { adet: girdiler.length, yollar };
}

module.exports = {
  ZIP32_TAVAN,
  GIRDI_TAVAN,
  crc32,
  dizindenGirdiler,
  zipYaz,
  zipDenetle,
};
