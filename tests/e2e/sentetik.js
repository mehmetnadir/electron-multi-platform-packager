'use strict';
/**
 * Testler için KÜÇÜK SENTETİK paketler (gerçek biçim imzaları, sahte gövde).
 * Hepsi `tests/e2e/.gecici/<ad>/` altına yazılır (gitignore); her koşuda üzerine yazılır, silme yok.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { asarYaz } = require('./adimlar/asar');

const KOK = process.env.E2E_TEST_GECICI || path.join(__dirname, '.gecici');

function geciciDizin(ad) {
  const d = path.join(KOK, ad);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** PE32 başlığı (512 bayt): MZ + e_lfanew=0x80 + 'PE\0\0' + COFF + opsiyonel başlık (16 veri dizini). */
function peBasligi() {
  const b = Buffer.alloc(512);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(0x80, 0x3c);
  b.writeUInt32LE(0x00004550, 0x80);
  const coff = 0x84;
  b.writeUInt16LE(0x14c, coff);
  b.writeUInt16LE(224, coff + 16);
  const opt = coff + 20;
  b.writeUInt16LE(0x10b, opt);
  b.writeUInt32LE(16, opt + 92);
  return b;
}

function guvenlikDiziniYaz(pe, ofset, boyut) {
  const dd = 0x84 + 20 + 96;
  pe.writeUInt32LE(ofset, dd + 32);
  pe.writeUInt32LE(boyut, dd + 36);
}

/** WIN_CERTIFICATE: dwLength + revizyon 0x0200 + tür (2 = PKCS#7) + sahte gövde. */
function sertifika(tur = 2, govde = 120) {
  const c = Buffer.alloc(8 + govde, 0x30);
  c.writeUInt32LE(8 + govde, 0);
  c.writeUInt16LE(0x0200, 4);
  c.writeUInt16LE(tur, 6);
  return c;
}

/**
 * Sentetik NSIS: PE + ofset 1024'te firstheader + veri; `imzali` ise sona WIN_CERTIFICATE eklenir.
 * `kes` > 0 ise dosyanın sonundan o kadar bayt kesilir (kesik yükleme benzetimi).
 */
function nsisYap(yol, { imzali = false, sertifikaTuru = 2, veri = 4096, kes = 0 } = {}) {
  const pe = peBasligi();
  const dolgu = Buffer.alloc(1024 - pe.length, 0x90);
  const fh = Buffer.alloc(28);
  fh.writeUInt32LE(4, 0); // FH_FLAGS_NO_CRC
  fh.writeUInt32LE(0xdeadbeef, 4);
  fh.write('NullsoftInst', 8, 'latin1');
  fh.writeUInt32LE(512, 20);
  fh.writeUInt32LE(28 + veri, 24);
  const govde = Buffer.alloc(veri, 0x5a);
  let parcalar = [pe, dolgu, fh, govde];
  if (imzali) {
    const c = sertifika(sertifikaTuru);
    guvenlikDiziniYaz(pe, 1024 + 28 + veri, c.length);
    parcalar = [...parcalar, c];
  }
  let b = Buffer.concat(parcalar);
  if (kes) b = b.subarray(0, b.length - kes);
  fs.writeFileSync(yol, b);
  return yol;
}

/** Sentetik Rar5 SFX: PE + 'WinRAR' dizgesi + RAR5 imzası. */
function sfxYap(yol, { winrar = true, imzali = true } = {}) {
  const pe = peBasligi();
  const stub = Buffer.alloc(2048, 0x90);
  if (winrar) stub.write('WinRAR SFX', 100, 'latin1');
  const rar = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
  const govde = Buffer.alloc(4096, 0x11);
  let parcalar = [pe, stub, rar, govde];
  if (imzali) {
    const c = sertifika(2);
    guvenlikDiziniYaz(pe, pe.length + stub.length + rar.length + govde.length, c.length);
    parcalar = [...parcalar, c];
  }
  fs.writeFileSync(yol, Buffer.concat(parcalar));
  return yol;
}

/** Sentetik AppImage: ELF + 'AI\x02' + ofset 193728'de squashfs süper bloğu (bytes_used). */
function appimageYap(yol, { bytesUsed = 8192, kes = 0 } = {}) {
  const b = Buffer.alloc(193728 + bytesUsed, 0);
  b[0] = 0x7f;
  b.write('ELF', 1, 'latin1');
  b.write('AI', 8, 'latin1');
  b[10] = 2;
  b.write('hsqs', 193728, 'latin1');
  b.writeBigUInt64LE(BigInt(bytesUsed), 193728 + 40);
  fs.writeFileSync(yol, kes ? b.subarray(0, b.length - kes) : b);
  return yol;
}

/** Sentetik UDIF: veri + XML + 'koly' trailer (big-endian alanlar). */
function dmgYap(yol, { bozuk = false } = {}) {
  const veri = Buffer.alloc(4096, 0x22);
  const xml = Buffer.from('<?xml version="1.0"?><plist></plist>');
  const koly = Buffer.alloc(512);
  koly.write('koly', 0, 'latin1');
  koly.writeUInt32BE(4, 4);
  koly.writeUInt32BE(512, 8);
  koly.writeBigUInt64BE(0n, 0x18);
  koly.writeBigUInt64BE(BigInt(veri.length), 0x20);
  koly.writeBigUInt64BE(BigInt(bozuk ? 999999 : veri.length), 0xd8);
  koly.writeBigUInt64BE(BigInt(xml.length), 0xe0);
  fs.writeFileSync(yol, Buffer.concat([veri, xml, koly]));
  return yol;
}

/** Saklı (method 0) zip yazar: {ad: Buffer|string}. */
function zipYaz(yol, dosyalar) {
  const yerel = [];
  const merkez = [];
  let ofset = 0;
  for (const [ad, icerik] of Object.entries(dosyalar)) {
    const veri = Buffer.isBuffer(icerik) ? icerik : Buffer.from(String(icerik));
    const adB = Buffer.from(ad, 'utf8');
    const crc = zlib.crc32(veri);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(veri.length, 18);
    lh.writeUInt32LE(veri.length, 22);
    lh.writeUInt16LE(adB.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(veri.length, 20);
    ch.writeUInt32LE(veri.length, 24);
    ch.writeUInt16LE(adB.length, 28);
    ch.writeUInt32LE(ofset, 42);
    yerel.push(lh, adB, veri);
    merkez.push(ch, adB);
    ofset += 30 + adB.length + veri.length;
  }
  const cd = Buffer.concat(merkez);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const n = Object.keys(dosyalar).length;
  eocd.writeUInt16LE(n, 8);
  eocd.writeUInt16LE(n, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(ofset, 16);
  fs.writeFileSync(yol, Buffer.concat([...yerel, cd, eocd]));
  return yol;
}

const MOTOR = '43e23fce2b7009474555a77.js';
const KANONIK = Buffer.from('/* kanonik motor */ var createKeyboardWriteActivity=1;');
const ESKI = Buffer.from('/* eski motor */ var x=0;');
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

/** Test ed25519 anahtarı → {acikB64, parmakIzi}. */
function testAnahtari() {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return {
    acikB64: der.toString('base64'),
    parmakIzi: crypto.createHash('sha256').update(der).digest('hex'),
  };
}

/**
 * Electron uygulama ağacı (uygulama köküne göreli). Varsayılan: G tam, 2 kitaplı SET, motorlar kanonik.
 */
function uygulamaAgaci({
  anahtar,
  taban = 'https://cdn.ydspublishing.com/guncelleme/',
  enjeksiyon = true,
  modul = true,
  setJson = true,
  setKimligi = 'yds-74390',
  kitap2Motor = KANONIK,
  kokMotor = ESKI,
  webKok = '',
} = {}) {
  const a = {
    'package.json': JSON.stringify({ name: 'kitap', main: 'main.js' }),
    'main.js':
      "const { app } = require('electron');\napp.whenReady().then(() => {});\n" +
      (enjeksiyon ? "/* EMPP_SET_GUNCELLEME */ require('./empp-set-guncelleyici.js');\n" : ''),
    [`${webKok}index.html`]: '<html><body>kok index v7</body></html>',
    [`${webKok}${MOTOR}`]: kokMotor,
    [`${webKok}book1/${MOTOR}`]: KANONIK,
    [`${webKok}book1/index.html`]: '<html>b1</html>',
    [`${webKok}book2/${MOTOR}`]: kitap2Motor,
    [`${webKok}book2/htmletk/u1/etk/${MOTOR}`]: ESKI, // kapsam dışı
  };
  if (modul)
    a['empp-set-guncelleyici.js'] = '/* EMPP_SET_GUNCELLEME çalışma anı */ module.exports={};';
  if (setJson) {
    a['empp-set.json'] = JSON.stringify({
      setKimligi,
      taban,
      imza: anahtar ? { alg: 'ed25519', acikAnahtar: anahtar.acikB64 } : undefined,
      kabukDosyalari: ['index.html'],
      kitapDizinleri: ['book1', 'book2'],
    });
  }
  return a;
}

/** Sentetik APK (gerçek zip): AndroidManifest.xml + classes.dex + assets/public/<ağaç>. */
function apkYap(yol, agac) {
  const d = { 'AndroidManifest.xml': Buffer.from([3, 0, 8, 0]), 'classes.dex': 'dex\n035' };
  for (const [k, v] of Object.entries(agac)) d[`assets/public/${k}`] = v;
  return zipYaz(yol, d);
}

function yedizVar() {
  for (const a of ['/usr/local/bin/7z', '/opt/homebrew/bin/7z', '/opt/homebrew/bin/7zz'])
    if (fs.existsSync(a)) return a;
  const r = spawnSync('/usr/bin/which', ['7z'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Dizinden dosya ağacı yazar. */
function agacYaz(kok, agac) {
  for (const [yol, icerik] of Object.entries(agac)) {
    const t = path.join(kok, ...yol.split('/'));
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, icerik);
  }
}

/**
 * Gerçek 7z ile NSIS benzeri iki katman: dış arşivde `$PLUGINSDIR/app-64.7z`, onun içinde
 * `resources/app.asar`. (Aile tespiti değil, içerik açıcı sınanır.)
 */
function nsisIcerikArsiviYap(dizin, agac) {
  const yediz = yedizVar();
  const ic = path.join(dizin, 'ic');
  agacYaz(ic, { 'resources/app.asar': asarYaz(agac) });
  const dis = path.join(dizin, 'dis');
  fs.mkdirSync(path.join(dis, '$PLUGINSDIR'), { recursive: true });
  const yuk = path.join(dis, '$PLUGINSDIR', 'app-64.7z');
  let r = spawnSync(yediz, ['a', '-y', yuk, 'resources'], { cwd: ic, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`7z a iç: ${r.stderr}`);
  const cikti = path.join(dizin, 'nsis-icerik.7z');
  r = spawnSync(yediz, ['a', '-y', cikti, '$PLUGINSDIR'], { cwd: dis, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`7z a dış: ${r.stderr}`);
  return cikti;
}

/** Çalıştırılabilir sahte araç betiği yazar. */
function betikYaz(yol, govde) {
  fs.writeFileSync(yol, `#!/bin/bash\n${govde}\n`);
  fs.chmodSync(yol, 0o755);
  return yol;
}

module.exports = {
  KOK,
  geciciDizin,
  nsisYap,
  sfxYap,
  appimageYap,
  dmgYap,
  zipYaz,
  apkYap,
  uygulamaAgaci,
  testAnahtari,
  nsisIcerikArsiviYap,
  agacYaz,
  betikYaz,
  yedizVar,
  MOTOR,
  KANONIK,
  ESKI,
  md5,
  asarYaz,
};
