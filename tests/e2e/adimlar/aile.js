'use strict';
/**
 * Paket AİLESİ ve başlıktan ölçülebilen BÜTÜNLÜK — yalnız bayt okuması (yerel dosya ya da CDN Range).
 *
 *   nsis      PE 'MZ' + NSIS firstheader ('NullsoftInst' + 0xDEADBEEF; ofset+kalan ≤ boyut)
 *   sfx-rar5  PE + RAR5 imzası 'Rar!\x1a\x07\x01\x00' (+ 'WinRAR' dizgesi, İmpark SFX)
 *   appimage  ELF + squashfs 'hsqs' (ofset 193728, yoksa ilk 4 MB taranır) → bytes_used bütünlüğü
 *   dmg       UDIF 'koly' trailer (son 512 bayt) → veri çatalı + XML plist dosya içinde mi
 *   apk       zip (EOCD → merkez dizin) + AndroidManifest.xml
 * NSIS gövde bütünlüğü: imzasızda ofset+kalan = boyut; imzalıda ofset+kalan ≤ güvenlik dizini
 * ofseti ve güvenlik dizini dosyanın sonuna oturur (Authenticode imzası sona eklenir).
 */

const BAS_PENCERE = 4 * 1024 * 1024;
const SQUASHFS_OFSET = 193728; // src/agent/impark-butunluk.js ile aynı
const NSIS_IMZA = Buffer.from('NullsoftInst', 'latin1');
const NSIS_SIGINFO = 0xdeadbeef;
const RAR5 = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
const RAR4 = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
const WINRAR_L1 = Buffer.from('WinRAR', 'latin1');
const WINRAR_U16 = Buffer.from('WinRAR', 'utf16le');
const HSQS = Buffer.from('hsqs', 'latin1');
const ZIP_YEREL = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const ZIP_MERKEZ = 0x02014b50;
const MERKEZ_TAVANI = 64 * 1024 * 1024;

/** PE başlığı → makine, güvenlik dizini (Authenticode). Saf. */
function peCoz(bas) {
  if (!bas || bas.length < 64 || bas[0] !== 0x4d || bas[1] !== 0x5a) return null;
  const lfanew = bas.readUInt32LE(0x3c);
  if (lfanew + 24 > bas.length)
    return { ok: false, sebep: `PE başlığı pencere dışında (e_lfanew=${lfanew})` };
  if (bas.readUInt32LE(lfanew) !== 0x00004550) return { ok: false, sebep: "'PE\\0\\0' imzası yok" };
  const coff = lfanew + 4;
  const makine = bas.readUInt16LE(coff);
  const opt = coff + 20;
  const sihir = bas.readUInt16LE(opt);
  const pe64 = sihir === 0x20b;
  const rvaSayisi = bas.readUInt32LE(opt + (pe64 ? 108 : 92));
  const dd = opt + (pe64 ? 112 : 96);
  let guvenlik = { ofset: 0, boyut: 0 };
  if (rvaSayisi > 4 && dd + 40 <= bas.length) {
    guvenlik = { ofset: bas.readUInt32LE(dd + 32), boyut: bas.readUInt32LE(dd + 36) };
  }
  return { ok: true, makine: `0x${makine.toString(16)}`, pe64, guvenlik };
}

/** NSIS firstheader. Saf. */
function nsisBul(bas, boyut) {
  let i = -1;
  for (;;) {
    i = bas.indexOf(NSIS_IMZA, i + 1);
    if (i === -1) return null;
    if (i < 8) continue;
    const ofset = i - 8;
    if (ofset + 28 > bas.length) continue;
    if (bas.readUInt32LE(ofset + 4) !== NSIS_SIGINFO) continue;
    const kalan = bas.readUInt32LE(ofset + 24);
    if (Number.isFinite(boyut) && ofset + kalan > boyut) {
      return { ofset, kalan, flags: bas.readUInt32LE(ofset), kesik: true };
    }
    return { ofset, kalan, flags: bas.readUInt32LE(ofset), kesik: false };
  }
}

/** squashfs süper bloğu: bytes_used (8 bayt LE, +40). */
function squashfsCoz(sb, ofset, boyut) {
  if (!sb || sb.length < 48 || !sb.subarray(0, 4).equals(HSQS)) return null;
  const bytesUsed = Number(sb.readBigUInt64LE(40));
  const beklenen = ofset + bytesUsed;
  return { ofset, bytes_used: bytesUsed, beklenen, durum: boyut >= beklenen ? 'TAM' : 'KESIK' };
}

/** UDIF koly trailer (big-endian). Saf. */
function kolyCoz(son512, boyut) {
  if (!son512 || son512.length < 512 || son512.toString('latin1', 0, 4) !== 'koly') return null;
  const u64 = (o) => Number(son512.readBigUInt64BE(o));
  const veriOfset = u64(0x18);
  const veriBoyu = u64(0x20);
  const xmlOfset = u64(0xd8);
  const xmlBoyu = u64(0xe0);
  const sinir = boyut - 512;
  const tamam = veriOfset + veriBoyu <= sinir && xmlBoyu > 0 && xmlOfset + xmlBoyu <= sinir;
  return {
    surum: son512.readUInt32BE(4),
    veri_catali: { ofset: veriOfset, boyut: veriBoyu },
    xml: { ofset: xmlOfset, boyut: xmlBoyu },
    durum: tamam ? 'TAM' : 'BOZUK',
  };
}

/** zip merkez dizini → girdi adları. Saf (tampon verilir). */
function merkezDiziniCoz(cd) {
  const adlar = [];
  let i = 0;
  while (i + 46 <= cd.length && cd.readUInt32LE(i) === ZIP_MERKEZ) {
    const adU = cd.readUInt16LE(i + 28);
    const ekU = cd.readUInt16LE(i + 30);
    const yorumU = cd.readUInt16LE(i + 32);
    adlar.push(cd.toString('utf8', i + 46, i + 46 + adU));
    i += 46 + adU + ekU + yorumU;
  }
  return adlar;
}

/**
 * Aile + bütünlük. `okuyucu` = {boyut, oku(bas, uzunluk)}.
 * @returns {Promise<{aile:string, ayrinti:Object, butunluk:null|{durum:string}, pe:null|Object}>}
 */
async function aileTespit(okuyucu) {
  const bas = await okuyucu.oku(0, Math.min(okuyucu.boyut, BAS_PENCERE));
  // baş penceresi geri verilir: aralık md5'i (kısmi eşlik) aynı baytları yeniden indirmesin
  return { ...(await aileCoz(okuyucu, bas)), basTampon: bas };
}

async function aileCoz(okuyucu, bas) {
  const boyut = okuyucu.boyut;

  if (bas.length >= 2 && bas[0] === 0x4d && bas[1] === 0x5a) {
    const pe = peCoz(bas);
    const nsis = nsisBul(bas, boyut);
    const g = pe && pe.guvenlik ? pe.guvenlik : { ofset: 0, boyut: 0 };
    if (nsis) {
      const imzali = g.boyut > 0;
      let durum;
      let not;
      if (nsis.kesik) {
        durum = 'KESIK';
        not = `NSIS verisi ${nsis.ofset + nsis.kalan} B ister, dosya ${boyut} B`;
      } else if (!imzali) {
        durum = nsis.ofset + nsis.kalan === boyut ? 'TAM' : 'BOZUK';
        not =
          durum === 'TAM'
            ? 'ofset+kalan = boyut'
            : `ofset+kalan=${nsis.ofset + nsis.kalan} ≠ boyut=${boyut}`;
      } else {
        const sona = g.ofset + g.boyut === boyut;
        const once = nsis.ofset + nsis.kalan <= g.ofset;
        durum = sona && once ? 'TAM' : 'BOZUK';
        not = `NSIS sonu ${nsis.ofset + nsis.kalan} · imza [${g.ofset}, ${g.ofset + g.boyut}) · boyut ${boyut}`;
      }
      return {
        aile: 'nsis',
        ayrinti: {
          pe: pe && pe.ok ? { makine: pe.makine, pe64: pe.pe64 } : null,
          nsis_ofset: nsis.ofset,
          nsis_flags: `0x${nsis.flags.toString(16)}`,
        },
        butunluk: { durum, not },
        pe,
      };
    }
    const r5 = bas.indexOf(RAR5);
    const r4 = r5 === -1 ? bas.indexOf(RAR4) : -1;
    const winrar = bas.indexOf(WINRAR_L1) !== -1 || bas.indexOf(WINRAR_U16) !== -1;
    if (r5 !== -1 || r4 !== -1) {
      return {
        aile: r5 !== -1 ? 'sfx-rar5' : 'sfx-rar4',
        ayrinti: { rar_ofset: r5 !== -1 ? r5 : r4, winrar_dizgesi: winrar },
        butunluk: null,
        pe,
      };
    }
    return {
      aile: 'pe-bilinmeyen',
      ayrinti: { winrar_dizgesi: winrar, pe_ok: !!(pe && pe.ok) },
      butunluk: null,
      pe,
    };
  }

  if (bas.length >= 4 && bas[0] === 0x7f && bas.toString('latin1', 1, 4) === 'ELF') {
    const aiSihir = bas.length >= 11 && bas[8] === 0x41 && bas[9] === 0x49 ? bas[10] : null;
    let ofset = null;
    if (boyut >= SQUASHFS_OFSET + 4) {
      const d =
        SQUASHFS_OFSET + 4 <= bas.length
          ? bas.subarray(SQUASHFS_OFSET, SQUASHFS_OFSET + 4)
          : await okuyucu.oku(SQUASHFS_OFSET, 4);
      if (d.equals(HSQS)) ofset = SQUASHFS_OFSET;
    }
    if (ofset === null) {
      const y = bas.indexOf(HSQS, 1024);
      if (y !== -1) ofset = y;
    }
    if (ofset === null) {
      return {
        aile: 'elf-bilinmeyen',
        ayrinti: { appimage_sihri: aiSihir },
        butunluk: null,
        pe: null,
      };
    }
    const sb =
      ofset + 96 <= bas.length ? bas.subarray(ofset, ofset + 96) : await okuyucu.oku(ofset, 96);
    const sq = squashfsCoz(sb, ofset, boyut);
    return {
      aile: 'appimage',
      ayrinti: { appimage_sihri: aiSihir, squashfs_ofset: ofset },
      butunluk: sq
        ? { durum: sq.durum, bytes_used: sq.bytes_used, beklenen: sq.beklenen, boyut }
        : { durum: 'BOZUK', not: 'süper blok okunamadı' },
      pe: null,
    };
  }

  if (bas.length >= 4 && bas.subarray(0, 4).equals(ZIP_YEREL)) {
    const kuyrukU = Math.min(boyut, 65557);
    const kuyruk = await okuyucu.oku(boyut - kuyrukU, kuyrukU);
    const e = kuyruk.lastIndexOf(ZIP_EOCD);
    if (e === -1 || e + 22 > kuyruk.length) {
      return {
        aile: 'zip',
        ayrinti: {},
        butunluk: { durum: 'KESIK', not: 'EOCD yok (zip sonu kesik)' },
        pe: null,
      };
    }
    const girdi = kuyruk.readUInt16LE(e + 10);
    const cdBoyu = kuyruk.readUInt32LE(e + 12);
    const cdOfset = kuyruk.readUInt32LE(e + 16);
    if (cdOfset === 0xffffffff || cdBoyu === 0xffffffff || girdi === 0xffff) {
      return {
        aile: 'zip',
        ayrinti: { zip64: true },
        butunluk: { durum: 'OLCULEMEDI', not: 'zip64 okunmuyor' },
        pe: null,
      };
    }
    const eocdMutlak = boyut - kuyrukU + e;
    if (cdOfset + cdBoyu > eocdMutlak || cdBoyu > MERKEZ_TAVANI) {
      return {
        aile: 'zip',
        ayrinti: { girdi_sayisi: girdi },
        butunluk: { durum: 'BOZUK', not: `merkez dizin [${cdOfset}+${cdBoyu}] EOCD'yi aşıyor` },
        pe: null,
      };
    }
    const adlar = merkezDiziniCoz(await okuyucu.oku(cdOfset, cdBoyu));
    const apk = adlar.includes('AndroidManifest.xml');
    return {
      aile: apk ? 'apk' : 'zip',
      ayrinti: {
        girdi_sayisi: girdi,
        okunan_girdi: adlar.length,
        android_manifest: apk,
        dex: adlar.filter((a) => /^classes\d*\.dex$/.test(a)).length,
      },
      butunluk: {
        durum: adlar.length === girdi ? 'TAM' : 'BOZUK',
        not: `merkez dizin ${adlar.length}/${girdi} girdi`,
      },
      pe: null,
      adlar,
    };
  }

  if (boyut >= 512) {
    const son = await okuyucu.oku(boyut - 512, 512);
    const k = kolyCoz(son, boyut);
    if (k) {
      return {
        aile: 'dmg',
        ayrinti: { udif_surum: k.surum, veri_catali: k.veri_catali, xml: k.xml },
        butunluk: { durum: k.durum },
        pe: null,
      };
    }
  }
  return {
    aile: 'bilinmeyen',
    ayrinti: { ilk_bayt: bas.subarray(0, 8).toString('hex') },
    butunluk: null,
    pe: null,
  };
}

module.exports = {
  aileTespit,
  peCoz,
  nsisBul,
  squashfsCoz,
  kolyCoz,
  merkezDiziniCoz,
  SQUASHFS_OFSET,
  BAS_PENCERE,
};
