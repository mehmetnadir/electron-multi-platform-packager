'use strict';
/**
 * .impark / AppImage bütünlük denetimi — SAF NODE.
 *
 * Neden Node: eskiden `/usr/bin/python3 impark-butunluk.py` çağrılıyordu. macOS'ta
 * `/usr/bin/python3` bir Xcode shim'idir; Xcode güncellemesi lisans onayını
 * sıfırladığında tek satır Python çalıştırmadan **rc=69** ("You have not agreed to
 * the Xcode license agreements", stderr'e) döner. Betiğin kendisi yalnız 0/1/2
 * döndürebilir, dolayısıyla 69 paketle ilgili DEĞİLDİ — ama ajan bunu
 * "paket bütünlük denetiminden geçemedi" diye raporlayıp sapasağlam bir paketi
 * düşürdü (2026-09-16 04:45, 45480 Marvel Grade 11; doğrulama raporunda zenity
 * kapısı GEÇTİ, tüm asar denetimleri EVET'ti).
 *
 * Ders: üretim kapısı, iş ile ilgisi olmayan bir dış araç zincirine (yorumlayıcı,
 * lisans, TCC izni) bağlanmaz. Denetim 20 satırlık bayt okuması — bağımlılık
 * gerektirmez.
 *
 * Yöntem (python sürümüyle birebir): squashfs superblock offset 193728'de aranır
 * (yoksa ilk 4 MB taranır), superblock+40'taki `bytes_used` (8 bayt LE) okunur.
 * Dosya boyutu `offset + bytes_used`'dan küçükse paket KESİK'tir.
 */
const fs = require('fs');

const VARSAYILAN_OFFSET = 193728;
const IMZA = Buffer.from('hsqs', 'latin1');
const TARAMA_TAVANI = 4 * 1024 * 1024;

function offsetBul(fd, boyut) {
  const dort = Buffer.alloc(4);
  if (boyut >= VARSAYILAN_OFFSET + 4) {
    fs.readSync(fd, dort, 0, 4, VARSAYILAN_OFFSET);
    if (dort.equals(IMZA)) return VARSAYILAN_OFFSET;
  }
  const uzunluk = Math.min(boyut, TARAMA_TAVANI);
  const bas = Buffer.alloc(uzunluk);
  fs.readSync(fd, bas, 0, uzunluk, 0);
  // python sürümü gibi ilk 1024 baytı atlar (ELF başlığındaki rastlantısal eşleşme).
  const yer = bas.indexOf(IMZA, 1024);
  return yer === -1 ? null : yer;
}

/**
 * @returns {{durum:'TAM'|'KESIK'|'BOZUK', boyut:number, beklenen:number|null, not:string}}
 */
function denetle(yol) {
  const boyut = fs.statSync(yol).size;
  const fd = fs.openSync(yol, 'r');
  let offset;
  let superblock;
  try {
    offset = offsetBul(fd, boyut);
    if (offset === null) return { durum: 'BOZUK', boyut, beklenen: null, not: 'squashfs imzası yok' };
    superblock = Buffer.alloc(96);
    const okunan = fs.readSync(fd, superblock, 0, 96, offset);
    if (okunan < 48) return { durum: 'BOZUK', boyut, beklenen: null, not: 'superblock okunamadı' };
  } finally {
    fs.closeSync(fd);
  }
  const bytesUsed = Number(superblock.readBigUInt64LE(40));
  const beklenen = offset + bytesUsed;
  if (boyut >= beklenen) return { durum: 'TAM', boyut, beklenen, not: '' };
  return { durum: 'KESIK', boyut, beklenen, not: `%${Math.floor((boyut * 100) / beklenen)}` };
}

const mb = (n) => (n / 1048576).toFixed(1);

/** İnsan okunur tek satır — ajan günlüğüne bu düşer. */
function ozet(yol, r) {
  const ad = require('path').basename(yol);
  return `${ad} — ${mb(r.boyut)} MB / gereken ${r.beklenen ? `${mb(r.beklenen)} MB` : '-'} → ${r.durum}${r.not ? ` ${r.not}` : ''}`;
}

module.exports = { denetle, ozet, VARSAYILAN_OFFSET };
