#!/usr/bin/env node
'use strict';

/**
 * WINDOWS PAKET KAPISI — üretilen .exe'yi TESLİMDEN ÖNCE ölçer.
 *
 * NEDEN (2026-09-21): "Windows exe için aldığımız kararlar" listesi her teslimde ELLE
 * kontrol ediliyordu; elle kontrol unutuluyor. Kanon: `~/Desktop/SM4-Windows-Test/OKU.md`.
 *
 * MUTLAK KURAL — ÖLÇEMEDİĞİNİ PASS SAYMA:
 *   Bu betikte üç değil DÖRT durum var: PASS · FAIL · ÖLÇÜLEMEDİ · RAPOR.
 *   Bir madde ölçülemiyorsa (7z yok, asar okunamadı, NSIS başlığı sıkıştırılmış)
 *   sessizce PASS'a düşmez — ÖLÇÜLEMEDİ der ve NEDENİNİ yazar.
 *
 * İKİ TUZAK, bilerek koda gömüldü:
 *
 *  1) YOKLUK ÖLÇÜMÜ KANIT PENCERESİ İSTER (maddeYokluk).
 *     "Sahte [10%] satırları yok" demek için önce o metni GÖREBİLDİĞİMİZİ kanıtlamak
 *     gerekir. NSIS `/SOLID lzma` ile derlendiğinde betik metni sıkıştırılmış başlıkta
 *     kalır; ham taramada hiçbir şey bulunmaz. O zaman "yasaklı metin yok" bulgusu
 *     ölçüm DEĞİL, körlüktür. Bu yüzden her yokluk ölçümü bir POZİTİF KONTROL ister:
 *     aynı korpusta bulunması ZORUNLU bir çapa (DetailPrint, customInit…). Çapa yoksa
 *     sonuç ÖLÇÜLEMEDİ'dir.
 *
 *  2) NSIS YÜKLEYİCİSİNİN KENDİ PE'Sİ HER ZAMAN 0x014c'DİR (mimariKarar).
 *     NSIS yükleyicileri daima 32-bit derlenir. Dış exe'nin PE Machine'ine bakıp
 *     "ia32 ✓" demek sahte PASS üretir — x64 bir paket de aynı değeri gösterir.
 *     Ölçülecek olan İÇERİDEKİ uygulama exe'sidir (ya da en azından yük adı:
 *     `app-32.7z` / `app-64.7z`). Dış PE tek başına asla PASS vermez.
 *
 *  3) BOYUT TEK BAŞINA KAPI DEĞİL (boyutIcerikKapisi).
 *     SM4'te CSS 71 KB'ydi ama içerik yoktu. Her varlık kapısı boyut VE içerik ölçer.
 *
 *  4) CONFIG'İN BEYAN ETMESİ ≠ ÇIKTININ TAŞIMASI (maddeSetGuncelleme, madde 13).
 *     Karar 6'da (`electronLanguages`) config doğruydu ama kapı yine de çıktıdan
 *     ölçmek zorundaydı. Hiçbir madde kaynak koda, paketleyici config'ine ya da
 *     `EMPP_*` ortam değişkenine BAKMAZ — tek kaynak üretilmiş .exe'dir.
 *
 * MADDE NUMARALARI ≠ KARAR NUMARALARI: 1-10 kararlar 1-10; 11 (version.txt) ve
 * 12 (uygulama içeriği boyut+içerik — kap: app.asar YA DA asar'sız düzende
 * resources/app/) ek kapılardır; 13 KARAR #11'dir (SET güncelleme kanalı).
 *
 * Kullanım:
 *   node scripts/windows-paket-kapisi.js <paket.exe> [seçenekler]
 *     --cikarim <dizin>  7z ile açmak yerine ÖNCEDEN açılmış uygulama ağacını kullan
 *     --tut              geçici çıkarım dizinini silme (teşhis için)
 *     --gevsek           ÖLÇÜLEMEDİ çıkış kodunu 0 yapar (varsayılan: 3)
 *     --json             makine okunur çıktı
 *     --ornek <n>        WebP sınıflaması için örneklenecek sayfa sayısı (varsayılan 12)
 *
 * Çıkış kodu: FAIL varsa 1 · FAIL yok ama ÖLÇÜLEMEDİ varsa 3 (--gevsek ile 0) · temizse 0.
 *
 * Bağımlılık eklenmedi: yalnız Node stdlib. NSIS gövdesini açmak için sistemdeki
 * 7z/7za/7zz/7zr kullanılır; yoksa ilgili maddeler ÖLÇÜLEMEDİ raporlanır.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
/**
 * KABUK TANIMI — TEK KAYNAK (2026-09-21). Bu betik daha önce `set-kimligi.js`'teki
 * tanımın KOPYASINI taşıyordu; kopya, üreticinin hatasını göremeyen bir kapı üretti
 * (ölçüldü: eski tanım gerçek SET ağacında `index.html`in yüklediği 12 varlığın
 * 0'ını kapsıyordu — kapı "sızma yok, GEÇTİ" diyordu). Artık üretici ile AYNI
 * modül ithal edilir; ayrışma `src/packaging/set-kabuk.test.js` SÖZLEŞME testini
 * düşürür. Modül Node stdlib dışında hiçbir şey çekmez — betiğin "yalnız stdlib"
 * sözü korunur.
 */
const SET_KABUK = require('../src/packaging/set-kabuk');
// Kanal Ş işaretinin/tehlike ölçütünün TEK kaynağı — kapı kendi kopyasını tutmaz.
const ICERIK = require('../src/packaging/icerik-guncelleme');
// Kök menü (ImWin32.dll) çözümü — çalışma anı modülü, yalnız stdlib (tembel require).
const IG_RUNTIME = require('../src/runtime/icerik-guncelleme');

// ---------------------------------------------------------------------------
// 0. Sonuç modeli
// ---------------------------------------------------------------------------

const PASS = 'PASS';
const FAIL = 'FAIL';
const OLCULEMEDI = 'ÖLÇÜLEMEDİ';
const RAPOR = 'RAPOR';

/** @returns {{no:number, ad:string, durum:string, detay:string}} */
function madde(no, ad, durum, detay) {
  return { no, ad, durum, detay: String(detay == null ? '' : detay) };
}

/**
 * Çıkış kodu. FAIL mutlak; ÖLÇÜLEMEDİ varsayılan olarak da sıfır-dışıdır — "ölçemedim"
 * bir başarı değildir ve CI'da sessizce yeşile dönmemelidir.
 */
function cikisKodu(maddeler, secenek = {}) {
  const liste = Array.isArray(maddeler) ? maddeler : [];
  if (liste.some((m) => m && m.durum === FAIL)) return 1;
  if (liste.some((m) => m && m.durum === OLCULEMEDI)) return secenek.gevsek ? 0 : 3;
  return 0;
}

/** Özet satırı — tek satır, sayılarla. */
function ozetSatiri(maddeler, kod) {
  const say = (d) => maddeler.filter((m) => m.durum === d).length;
  const karar = kod === 0
    ? 'KAPI AÇIK'
    : (kod === 1 ? 'KAPI KAPALI (FAIL)' : 'KAPI KAPALI (ölçülemedi)');
  return `ÖZET: ${say(PASS)} PASS · ${say(FAIL)} FAIL · ${say(OLCULEMEDI)} ÖLÇÜLEMEDİ · ` +
    `${say(RAPOR)} RAPOR → ${karar} (çıkış ${kod})`;
}

// ---------------------------------------------------------------------------
// 1. PE başlığı ve hedef mimari (karar #1)
// ---------------------------------------------------------------------------

const MAKINE_IA32 = 0x014c;
const MAKINE_X64 = 0x8664;
const MAKINE_ARM64 = 0xaa64;

const MAKINE_ADI = {
  [MAKINE_IA32]: 'ia32',
  [MAKINE_X64]: 'x64',
  [MAKINE_ARM64]: 'arm64'
};

/**
 * PE COFF başlığından Machine alanını okur. Saf fonksiyon.
 * @param {Buffer} buf exe'nin en azından ilk ~1 KB'ı
 */
function peMakineOku(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 0x40) {
    return { ok: false, sebep: 'tampon çok kısa (DOS başlığı yok)' };
  }
  if (buf[0] !== 0x4d || buf[1] !== 0x5a) {
    return { ok: false, sebep: 'MZ imzası yok — PE dosyası değil' };
  }
  const peOfset = buf.readUInt32LE(0x3c);
  if (peOfset <= 0 || peOfset + 6 > buf.length) {
    return { ok: false, sebep: `e_lfanew=${peOfset} tampon dışında` };
  }
  if (buf.toString('latin1', peOfset, peOfset + 4) !== 'PE\u0000\u0000') {
    return { ok: false, sebep: 'PE\\0\\0 imzası yok' };
  }
  const makine = buf.readUInt16LE(peOfset + 4);
  return { ok: true, makine, ad: MAKINE_ADI[makine] || `bilinmiyor(0x${makine.toString(16)})` };
}

/** `app-32.7z` / `app-64.7z` gibi electron-builder yük adından mimari çıkarır. */
function yukAdindanMimari(ad) {
  if (typeof ad !== 'string') return null;
  const m = ad.match(/app-(32|64|arm64)\.7z$/i);
  if (!m) return null;
  if (m[1] === '32') return 'ia32';
  if (m[1] === '64') return 'x64';
  return 'arm64';
}

/**
 * Karar #1 — ia32.
 *
 * DIŞ PE TEK BAŞINA KANIT DEĞİLDİR: NSIS yükleyicisi her zaman 32-bit derlenir,
 * yani x64 bir paketin yükleyicisi de 0x014c gösterir. Kanıt sırası:
 *   1) içerideki uygulama exe'sinin PE Machine'i (ASIL)
 *   2) yük adı (app-32.7z) — dolaylı ama geçerli
 *   3) hiçbiri yoksa ÖLÇÜLEMEDİ
 *
 * @param {{icPe?:object|null, yukAdi?:string|null, disPe?:object|null}} kanit
 */
function mimariKarar(kanit = {}) {
  const ad = 'Üretim mimarisi ia32 (PE Machine 0x014c)';
  const icPe = kanit.icPe;
  if (icPe && icPe.ok) {
    const onalti = `0x${icPe.makine.toString(16).padStart(4, '0')}`;
    if (icPe.makine === MAKINE_IA32) {
      return madde(1, ad, PASS, `iç uygulama exe'si PE Machine ${onalti} (ia32)`);
    }
    return madde(1, ad, FAIL, `iç uygulama exe'si PE Machine ${onalti} (${icPe.ad}) — ia32 değil`);
  }

  const yuk = yukAdindanMimari(kanit.yukAdi);
  if (yuk) {
    const durum = yuk === 'ia32' ? PASS : FAIL;
    return madde(1, ad, durum, `dolaylı kanıt: yük adı "${kanit.yukAdi}" → ${yuk} ` +
      '(iç exe okunamadı; yük adı electron-builder tarafından mimariye göre yazılır)');
  }

  const disNot = kanit.disPe && kanit.disPe.ok
    ? ` (dış yükleyici PE 0x${kanit.disPe.makine.toString(16)} — NSIS daima 32-bit ` +
      'derlenir, kanıt DEĞİL)'
    : '';
  return madde(1, ad, OLCULEMEDI, `iç uygulama exe'si de yük adı da okunamadı${disNot}`);
}

// ---------------------------------------------------------------------------
// 2. İkon köşe saydamlığı (karar #2)
// ---------------------------------------------------------------------------

const PNG_IMZA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 8-bit PNG'yi RGBA'ya çözer (palet ve interlace desteklenmez → null). Saf. */
function pngCoz(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_IMZA)) {
    return { ok: false, sebep: 'PNG imzası yok' };
  }
  let o = 8;
  let genislik = 0;
  let yukseklik = 0;
  let derinlik = 0;
  let renkTipi = -1;
  let interlace = 0;
  const idat = [];
  while (o + 8 <= buf.length) {
    const uzunluk = buf.readUInt32BE(o);
    const tip = buf.toString('latin1', o + 4, o + 8);
    const govde = buf.subarray(o + 8, o + 8 + uzunluk);
    if (tip === 'IHDR') {
      genislik = govde.readUInt32BE(0);
      yukseklik = govde.readUInt32BE(4);
      derinlik = govde[8];
      renkTipi = govde[9];
      interlace = govde[12];
    } else if (tip === 'IDAT') {
      idat.push(Buffer.from(govde));
    } else if (tip === 'IEND') {
      break;
    }
    o += 12 + uzunluk;
  }
  if (derinlik !== 8) return { ok: false, sebep: `bit derinliği ${derinlik} desteklenmiyor` };
  if (interlace !== 0) return { ok: false, sebep: 'interlace PNG desteklenmiyor' };
  const kanalSayisi = { 0: 1, 2: 3, 4: 2, 6: 4 }[renkTipi];
  if (!kanalSayisi) return { ok: false, sebep: `renk tipi ${renkTipi} desteklenmiyor` };
  if (!idat.length) return { ok: false, sebep: 'IDAT yok' };

  let ham;
  try {
    ham = zlib.inflateSync(Buffer.concat(idat));
  } catch (e) {
    return { ok: false, sebep: `IDAT açılamadı: ${e.message}` };
  }

  const satirBayt = genislik * kanalSayisi;
  if (ham.length < yukseklik * (satirBayt + 1)) {
    return { ok: false, sebep: 'açılmış veri eksik (kesik PNG)' };
  }
  const piksel = Buffer.alloc(yukseklik * satirBayt);
  let onceki = Buffer.alloc(satirBayt);
  for (let y = 0; y < yukseklik; y++) {
    const filtre = ham[y * (satirBayt + 1)];
    const satir = ham.subarray(y * (satirBayt + 1) + 1, (y + 1) * (satirBayt + 1));
    const cikti = piksel.subarray(y * satirBayt, (y + 1) * satirBayt);
    for (let i = 0; i < satirBayt; i++) {
      const x = satir[i];
      const a = i >= kanalSayisi ? cikti[i - kanalSayisi] : 0;
      const b = onceki[i];
      const c = i >= kanalSayisi ? onceki[i - kanalSayisi] : 0;
      let d;
      if (filtre === 0) d = x;
      else if (filtre === 1) d = x + a;
      else if (filtre === 2) d = x + b;
      else if (filtre === 3) d = x + ((a + b) >> 1);
      else if (filtre === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        d = x + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c));
      } else return { ok: false, sebep: `bilinmeyen filtre ${filtre}` };
      cikti[i] = d & 0xff;
    }
    onceki = cikti;
  }
  return { ok: true, genislik, yukseklik, kanalSayisi, renkTipi, piksel };
}

/** PNG karesinin dört köşe alfası. Alfa kanalı yoksa 255 (opak) sayılır — doğru davranış. */
function pngKoseAlfa(buf) {
  const c = pngCoz(buf);
  if (!c.ok) return { ok: false, sebep: c.sebep };
  const { genislik: w, yukseklik: h, kanalSayisi: k, piksel } = c;
  if (w < 1 || h < 1) return { ok: false, sebep: 'boyut 0' };
  const alfaVar = k === 2 || k === 4;
  const al = (x, y) => (alfaVar ? piksel[(y * w + x) * k + (k - 1)] : 255);
  return {
    ok: true,
    bicim: 'png',
    genislik: w,
    yukseklik: h,
    alfaKanali: alfaVar,
    alfalar: [al(0, 0), al(w - 1, 0), al(0, h - 1), al(w - 1, h - 1)]
  };
}

/**
 * ICO içindeki BMP (BITMAPINFOHEADER) karesinin köşe alfası.
 * DIB satırları ALTTAN ÜSTE dizilir; yükseklik alanı XOR+AND maskesi için iki katıdır.
 */
function dibKoseAlfa(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 40) return { ok: false, sebep: 'DIB başlığı kısa' };
  const basSize = buf.readUInt32LE(0);
  if (basSize !== 40) return { ok: false, sebep: `BITMAPINFOHEADER değil (biSize=${basSize})` };
  const w = buf.readInt32LE(4);
  const h2 = buf.readInt32LE(8);
  const bit = buf.readUInt16LE(14);
  const h = Math.floor(h2 / 2);
  if (w < 1 || h < 1) return { ok: false, sebep: `geçersiz boyut ${w}x${h}` };
  if (bit !== 32) return { ok: false, sebep: `${bit} bpp ikon — alfa kanalı yok, ölçülemez` };
  const veri = 40;
  const satirBayt = w * 4;
  if (veri + satirBayt * h > buf.length) return { ok: false, sebep: 'piksel verisi eksik' };
  // y=0 üst satır; DIB alttan üste olduğu için satır indeksi (h-1-y).
  const al = (x, y) => buf[veri + (h - 1 - y) * satirBayt + x * 4 + 3];
  return {
    ok: true,
    bicim: 'dib',
    genislik: w,
    yukseklik: h,
    alfaKanali: true,
    alfalar: [al(0, 0), al(w - 1, 0), al(0, h - 1), al(w - 1, h - 1)]
  };
}

/** Kare PNG mi DIB mi — imzadan seçer. */
function kareKoseAlfa(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return { ok: false, sebep: 'kare boş' };
  if (buf.subarray(0, 8).equals(PNG_IMZA)) return pngKoseAlfa(buf);
  return dibKoseAlfa(buf);
}

/** .ico dosyasını karelere ayırır (ICONDIR). Saf. */
function icoKareleri(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 6) return [];
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return [];
  const adet = buf.readUInt16LE(4);
  const kareler = [];
  for (let i = 0; i < adet; i++) {
    const g = 6 + i * 16;
    if (g + 16 > buf.length) break;
    const boyut = buf.readUInt32LE(g + 8);
    const ofset = buf.readUInt32LE(g + 12);
    if (ofset + boyut > buf.length || boyut === 0) continue;
    kareler.push(buf.subarray(ofset, ofset + boyut));
  }
  return kareler;
}

/**
 * PE `.rsrc` bölümünden RT_ICON (tip 3) kayıtlarını toplar — exe'nin gerçek
 * masaüstü ikonu buradadır. Saf fonksiyon (tüm exe tamponunu ister).
 */
function peKaynakIkonlari(buf) {
  const pe = peMakineOku(buf);
  if (!pe.ok) return { ok: false, sebep: pe.sebep, kareler: [] };
  const peOfset = buf.readUInt32LE(0x3c);
  const bolumAdet = buf.readUInt16LE(peOfset + 6);
  const optBoy = buf.readUInt16LE(peOfset + 20);
  const bolumTablo = peOfset + 24 + optBoy;
  let rsrcRVA = 0;
  let rsrcOfset = 0;
  let rsrcBoy = 0;
  for (let i = 0; i < bolumAdet; i++) {
    const s = bolumTablo + i * 40;
    if (s + 40 > buf.length) break;
    const adi = buf.toString('latin1', s, s + 8).replace(/\u0000+$/, '');
    if (adi === '.rsrc') {
      rsrcRVA = buf.readUInt32LE(s + 12);
      rsrcBoy = buf.readUInt32LE(s + 16);
      rsrcOfset = buf.readUInt32LE(s + 20);
      break;
    }
  }
  if (!rsrcOfset) return { ok: false, sebep: '.rsrc bölümü yok', kareler: [] };
  if (rsrcOfset + rsrcBoy > buf.length) {
    return { ok: false, sebep: '.rsrc bölümü tampon dışında (kısmi okuma)', kareler: [] };
  }

  const kareler = [];
  const dizinOku = (bagil, seviye, tip) => {
    const p = rsrcOfset + bagil;
    if (p + 16 > buf.length || seviye > 3) return;
    const adli = buf.readUInt16LE(p + 12);
    const idli = buf.readUInt16LE(p + 14);
    for (let i = 0; i < adli + idli; i++) {
      const g = p + 16 + i * 8;
      if (g + 8 > buf.length) return;
      const ad = buf.readUInt32LE(g);
      const ofs = buf.readUInt32LE(g + 4);
      const altDizin = (ofs & 0x80000000) !== 0;
      const yeniTip = seviye === 1 ? (ad & 0x80000000 ? -1 : ad) : tip;
      if (seviye === 1 && yeniTip !== 3) continue; // yalnız RT_ICON
      if (altDizin) {
        dizinOku(ofs & 0x7fffffff, seviye + 1, yeniTip);
      } else {
        const y = rsrcOfset + ofs;
        if (y + 16 > buf.length) continue;
        const veriRVA = buf.readUInt32LE(y);
        const veriBoy = buf.readUInt32LE(y + 4);
        const veriOfset = veriRVA - rsrcRVA + rsrcOfset;
        if (veriOfset < 0 || veriOfset + veriBoy > buf.length || veriBoy === 0) continue;
        kareler.push(buf.subarray(veriOfset, veriOfset + veriBoy));
      }
    }
  };
  dizinOku(0, 1, -1);
  if (!kareler.length) return { ok: false, sebep: '.rsrc içinde RT_ICON yok', kareler: [] };
  return { ok: true, kareler };
}

/**
 * PE bölüm tablosundan `.rsrc`nin HAM dosya ofseti ve boyu. Saf.
 * Yalnız başlıklar gerekir (ilk birkaç KB) — 140 MB'lık exe'yi baştan sona
 * okumadan ikon penceresini hedeflemek için.
 */
function peRsrcAralik(buf) {
  const pe = peMakineOku(buf);
  if (!pe.ok) return { ok: false, sebep: pe.sebep };
  const peOfset = buf.readUInt32LE(0x3c);
  if (peOfset + 24 > buf.length) return { ok: false, sebep: 'PE başlığı tampon dışında' };
  const bolumAdet = buf.readUInt16LE(peOfset + 6);
  const optBoy = buf.readUInt16LE(peOfset + 20);
  const tablo = peOfset + 24 + optBoy;
  for (let i = 0; i < bolumAdet; i++) {
    const g = tablo + i * 40;
    if (g + 40 > buf.length) break;
    const adi = buf.toString('latin1', g, g + 8).replace(/\u0000+$/, '');
    if (adi === '.rsrc') {
      return {
        ok: true,
        rva: buf.readUInt32LE(g + 12),
        boy: buf.readUInt32LE(g + 16),
        ofset: buf.readUInt32LE(g + 20)
      };
    }
  }
  return { ok: false, sebep: '.rsrc bölümü bölüm tablosunda yok' };
}

/**
 * Karar #2 — logonun etrafındaki beyaz kutu temizlenmiş mi.
 * Kanon: her karenin DÖRT köşesinde alfa 0. Tek kare bile opak köşe taşıyorsa FAIL.
 * Kare yoksa / hiçbiri çözülemediyse ÖLÇÜLEMEDİ — "kutu yok" DEMEK DEĞİLDİR.
 */
function maddeIkon(kareler, kaynak = 'bilinmiyor') {
  const ad = 'Logo beyaz kutu temizliği (ICO köşe alfası)';
  const liste = Array.isArray(kareler) ? kareler : [];
  if (!liste.length) {
    return madde(2, ad, OLCULEMEDI, `ikon karesi bulunamadı (kaynak: ${kaynak})`);
  }
  const olculen = [];
  const olculemeyen = [];
  const kirli = [];
  for (let i = 0; i < liste.length; i++) {
    const r = kareKoseAlfa(liste[i]);
    if (!r.ok) {
      olculemeyen.push(`#${i + 1}: ${r.sebep}`);
      continue;
    }
    const enBuyuk = Math.max.apply(null, r.alfalar);
    olculen.push(r);
    if (enBuyuk !== 0) {
      kirli.push(`#${i + 1} ${r.genislik}x${r.yukseklik} alfa=[${r.alfalar.join(',')}]`);
    }
  }
  if (!olculen.length) {
    return madde(2, ad, OLCULEMEDI,
      `${liste.length} kare bulundu, hiçbiri çözülemedi — ${olculemeyen.join(' · ')}`);
  }
  const ek = olculemeyen.length
    ? ` · çözülemeyen ${olculemeyen.length} kare: ${olculemeyen.join(' · ')}`
    : '';
  if (kirli.length) {
    return madde(2, ad, FAIL,
      `${olculen.length} karenin ${kirli.length} tanesinde köşe opak: ${kirli.join(' · ')}${ek}`);
  }
  return madde(2, ad, PASS,
    `${olculen.length}/${olculen.length} karede dört köşe alfası [0,0,0,0] ` +
    `(kaynak: ${kaynak})${ek}`);
}

// ---------------------------------------------------------------------------
// 3. NSIS korpusu, kanıt penceresi (kararlar #3 #4 #5)
// ---------------------------------------------------------------------------

/** Bir kelimenin ham baytlarda aranacak ASCII ve UTF-16LE desenleri. */
function aramaDesenleri(kelime) {
  return [Buffer.from(kelime, 'utf8'), Buffer.from(kelime, 'utf16le')];
}

/**
 * Bir bayt parçasında kelimeleri arar. Saf fonksiyon — akış taramasının çekirdeği.
 * @returns {Set<string>} bulunan kelimeler
 */
function parcadaAra(parca, kelimeler) {
  const bulunan = new Set();
  if (!Buffer.isBuffer(parca)) return bulunan;
  for (const k of kelimeler) {
    for (const desen of aramaDesenleri(k)) {
      if (parca.indexOf(desen) !== -1) {
        bulunan.add(k);
        break;
      }
    }
  }
  return bulunan;
}

/**
 * Büyük dosyayı belleğe almadan parça parça tarar (1,3 GB exe için şart).
 * Parçalar arasında kesilen eşleşmeleri kaçırmamak için örtüşme bırakılır.
 */
function dosyadaAra(yol, kelimeler, secenek = {}) {
  const parcaBoyu = secenek.parcaBoyu || 8 * 1024 * 1024;
  const enUzun = kelimeler.reduce((m, k) => Math.max(m, Buffer.byteLength(k, 'utf16le')), 0);
  const ortusme = Math.max(enUzun * 2, 64);
  const bulunan = new Set();
  let fd;
  try {
    fd = fs.openSync(yol, 'r');
  } catch (e) {
    return { ok: false, sebep: `açılamadı: ${e.message}`, bulunan };
  }
  try {
    const tampon = Buffer.alloc(parcaBoyu + ortusme);
    let konum = 0;
    let kuyruk = 0;
    for (;;) {
      const okunan = fs.readSync(fd, tampon, kuyruk, parcaBoyu, konum);
      if (okunan <= 0) break;
      const gecerli = tampon.subarray(0, kuyruk + okunan);
      for (const k of parcadaAra(gecerli, kelimeler)) bulunan.add(k);
      konum += okunan;
      kuyruk = Math.min(ortusme, gecerli.length);
      gecerli.subarray(gecerli.length - kuyruk).copy(tampon, 0);
    }
  } finally {
    fs.closeSync(fd);
  }
  return { ok: true, bulunan };
}

/**
 * YOKLUK ÖLÇÜMÜ — kanıt penceresi şartıyla.
 *
 * `pozitif` listesinden HİÇBİRİ bulunamadıysa korpus okunabilir değildir; yasaklı
 * metnin görünmemesi ölçüm değil körlüktür → ÖLÇÜLEMEDİ.
 *
 * @param {{no:number, ad:string, bulunan:Set<string>, yasakli:string[],
 *          pozitif:string[], gerekli?:string[], korYorum?:string}} p
 */
function maddeYokluk(p) {
  const bulunan = p.bulunan instanceof Set ? p.bulunan : new Set(p.bulunan || []);
  const pozitifBulunan = (p.pozitif || []).filter((k) => bulunan.has(k));
  if (!pozitifBulunan.length) {
    const kor = p.korYorum || 'korpusta çapa metin bulunamadı — NSIS betiği sıkıştırılmış ' +
      'başlıkta olabilir; yasaklı metnin görünmemesi kanıt DEĞİL';
    return madde(p.no, p.ad, OLCULEMEDI, kor);
  }
  const yasakliBulunan = (p.yasakli || []).filter((k) => bulunan.has(k));
  if (yasakliBulunan.length) {
    return madde(p.no, p.ad, FAIL,
      'kaldırılmış olması gereken metin hâlâ pakette: ' +
      `${yasakliBulunan.map((k) => `"${k}"`).join(', ')} ` +
      `(çapa: ${pozitifBulunan.join(', ')})`);
  }
  const eksikGerekli = (p.gerekli || []).filter((k) => !bulunan.has(k));
  if (eksikGerekli.length) {
    return madde(p.no, p.ad, FAIL,
      `olması gereken metin yok: ${eksikGerekli.map((k) => `"${k}"`).join(', ')} ` +
      `(çapa görüldüğü için korpus okunabilir — gerçek eksiklik)`);
  }
  const gerekliNot = (p.gerekli || []).length
    ? ` · gerekli metinler yerinde: ${p.gerekli.join(', ')}`
    : '';
  return madde(p.no, p.ad, PASS, `çapa görüldü (${pozitifBulunan.join(', ')}), ` +
    `yasaklı metin yok${gerekliNot}`);
}

// NSIS korpusunda aranacak tüm kelimeler (tek tarama, tek geçiş).
//
// YALNIZ DİZE SABİTLERİ ARANIR (2026-09-21, SM4'te ölçüldü). Eski liste
// `customInit`, `CRCCheck`, `SetOutPath`, `Exec`, `IfSilent`, `INSTALL_REGISTRY_KEY`
// de arıyordu; bunlar derlenmiş bir NSIS exe'sinde METİN OLARAK HİÇ BULUNMAZ —
// ilki/sonuncusu derleme-zamanı makro ve define ADI, ortadakiler opcode. Yani
// "bulamadım" sonucu sıkıştırmadan DEĞİL, yanlış yerde aramaktan geliyordu ve
// `gerekli` listesindeki bu tokenlar bir gün çapa eşleşirse SAHTE FAIL üretecekti.
// (`Exec` ayrıca 4 harflik bir alt dize — 1,3 GB içinde rastgele eşleşir.)
// Geriye kalanlar DetailPrint'in gerçek dize sabitleridir; onlar da sıkıştırılmış
// başlıktaysa madde 5 dürüstçe ÖLÇÜLEMEDİ der.
const NSIS_CAPALAR = ['Yayınevi:'];
const NSIS_KELIMELER = [
  ...NSIS_CAPALAR,
  '[10%]', '[95%]', '[25%]', '[50%]',
  'Dosyalar isleniye basliyor', 'Kurulum dizini:'
];

// --- NSIS firstheader: ön taramanın (CRCCheck) DOĞRUDAN ÖLÇÜMÜ -------------
// exehead/fileform.h:
//   +0  flags (FH_FLAGS_*)          +4  siginfo = 0xDEADBEEF
//   +8  "NullsoftInst" (12 bayt)    +20 length_of_header
//   +24 length_of_all_following_data
// Bu yapı SIKIŞTIRILMAZ; betik metni sıkıştırılmış başlıkta kalsa bile buradan
// okunur. SM4 paketinde ölçüldü: ofset 397312, flags=0x4, siginfo=0xdeadbeef,
// length_of_all_following_data = dosyaBoyu − ofset (birebir).
const NSIS_IMZA = Buffer.from('NullsoftInst', 'latin1');
const NSIS_SIGINFO = 0xdeadbeef;
const FH_FLAGS_NO_CRC = 4;
const FH_FLAGS_FORCE_CRC = 8;

/**
 * NSIS firstheader'ı bulur ve KENDİ İÇİNDE DOĞRULAR. Saf fonksiyon.
 *
 * İki katmanlı doğrulama şart: yalnız imzaya bakmak 1,3 GB'lık bir gövdede
 * rastgele eşleşmeye açıktır. İkinci katman `length_of_all_following_data`nın
 * dosya boyuyla tutarlılığıdır — tutmuyorsa aday ATLANIR, tahmin ÜRETİLMEZ.
 *
 * @param {Buffer} buf dosyanın başından yeterince büyük bir pencere
 * @param {number} dosyaBoyu tam dosya boyu (tutarlılık denetimi için)
 */
function nsisIlkBaslik(buf, dosyaBoyu) {
  if (!Buffer.isBuffer(buf)) return { ok: false, sebep: 'tampon yok' };
  let i = -1;
  for (;;) {
    i = buf.indexOf(NSIS_IMZA, i + 1);
    if (i === -1) break;
    if (i < 8) continue;
    const ofset = i - 8;
    if (ofset + 28 > buf.length) continue;
    if (buf.readUInt32LE(ofset + 4) !== NSIS_SIGINFO) continue;
    const kalan = buf.readUInt32LE(ofset + 24);
    if (Number.isFinite(dosyaBoyu) && dosyaBoyu - ofset !== kalan) continue;
    const flags = buf.readUInt32LE(ofset);
    return {
      ok: true,
      ofset,
      flags,
      noCrc: (flags & FH_FLAGS_NO_CRC) !== 0,
      forceCrc: (flags & FH_FLAGS_FORCE_CRC) !== 0,
      baslikBoyu: buf.readUInt32LE(ofset + 20),
      kalanBoyut: kalan
    };
  }
  return {
    ok: false,
    sebep: 'doğrulanmış NSIS firstheader bulunamadı ' +
      '(NullsoftInst + 0xDEADBEEF + boyut tutarlılığı üçü birden aranır)'
  };
}

/**
 * Karar #3 ve #4'ün betik yarısı — KALICI OLARAK ÖLÇÜLEMEZ, sebebi sıkıştırma DEĞİL.
 *
 * Bu kararın tüm izi NSIS betiğindeki `customInit` makrosudur: `customInit`
 * derleme-zamanı makro ADI, `SetOutPath`/`Exec`/`IfSilent` ise opcode'dur. makensis
 * bunların hiçbirini çıktı dosyasına METİN olarak yazmaz — sıkıştırma açılsa bile
 * bulunamazlar. Eski sürüm onları korpusta arayıp "sıkıştırılmış başlık" diye
 * açıklıyordu: teşhis YANLIŞTI ve operatörü olmayan bir yolu açmaya yönlendiriyordu.
 * Tek geçerli kanıt kurulumda gözle bakmaktır (OKU.md "Testte bakılacaklar" §3).
 */
function maddeKuruluysaAc() {
  return madde(3, 'Kuruluysa sormadan aç + Exec cwd tuzağı (customInit/SetOutPath/Exec)',
    OLCULEMEDI,
    'derlenmiş NSIS exe\'sinde bu kararın METİN izi YOKTUR — customInit derleme-zamanı ' +
    'makro adı, SetOutPath/Exec/IfSilent opcode\'dur; ham bayt taramasıyla (sıkıştırma ' +
    'açılsa bile) ölçülemez, kurulumda gözle doğrulanmalı');
}

/**
 * Karar #4'ün ölçülebilir yarısı — ön tarama (CRCCheck) kaldırıldı mı.
 *
 * `CRCCheck off` metin olarak exe'de yoktur ama SONUCU firstheader'daki
 * FH_FLAGS_NO_CRC bayrağındadır ve o bayrak SIKIŞTIRILMAZ. Yani bu madde
 * ölçülebilir; ÖLÇÜLEMEDİ demek burada körlüktür.
 */
function maddeOnTarama(ilkBaslik) {
  const ad = 'Ön tarama (NSIS CRCCheck) kaldırıldı — ilk ekranda boş bekleme yok';
  if (!ilkBaslik || !ilkBaslik.ok) {
    return madde(4, ad, OLCULEMEDI, (ilkBaslik && ilkBaslik.sebep) ||
      'NSIS firstheader okunmadı');
  }
  const onalti = `0x${ilkBaslik.flags.toString(16)}`;
  const yer = `firstheader ofset ${ilkBaslik.ofset}, flags=${onalti}`;
  if (ilkBaslik.noCrc) {
    return madde(4, ad, PASS,
      `${yer} → FH_FLAGS_NO_CRC kurulu; "CRCCheck off" derlenmiş pakette doğrulandı`);
  }
  return madde(4, ad, FAIL,
    `${yer} → FH_FLAGS_NO_CRC YOK (${ilkBaslik.forceCrc ? 'CRCCheck force' : 'CRCCheck on'}) ` +
    '— yükleyici hiçbir pencere açmadan gövdenin tamamını tarar, kullanıcı boş ekranda bekler');
}

function maddeSahteIlerleme(bulunan) {
  return maddeYokluk({
    no: 5,
    ad: 'Sahte [10%]…[95%] satırları ve Sleep kaldırıldı, Türkçe metin',
    bulunan,
    pozitif: ['Yayınevi:'],
    yasakli: ['[10%]', '[25%]', '[50%]', '[95%]', 'Dosyalar isleniye basliyor'],
    gerekli: ['Kurulum dizini:'],
    korYorum: 'DetailPrint dize sabitleri ("Yayınevi:") korpusta görünmüyor — NSIS ' +
      'dize tablosu sıkıştırılmış başlıkta; sahte yüzde satırlarının YOKLUĞU ' +
      'doğrulanamaz, "bulamadım" ile "yok" aynı şey değildir'
  });
}

// ---------------------------------------------------------------------------
// 4. Boyut + içerik kapısı (SM4 CSS 71 KB dersi)
// ---------------------------------------------------------------------------

/**
 * Bir varlık hem YETERİNCE BÜYÜK hem de BEKLENEN İÇERİĞE sahip olmalı.
 * SM4'te CSS 71 KB'ydi ama içerik yoktu — boyut tek başına kapı değildir.
 */
function boyutIcerikKapisi(p) {
  const { ad, boyut, asgariBoyut, icerikVar, icerikAciklama } = p;
  if (boyut == null) return { durum: OLCULEMEDI, detay: `${ad}: bulunamadı` };
  if (boyut < asgariBoyut) {
    return { durum: FAIL, detay: `${ad}: ${boyut} bayt < asgari ${asgariBoyut}` };
  }
  if (icerikVar === null || icerikVar === undefined) {
    return { durum: OLCULEMEDI, detay: `${ad}: ${boyut} bayt ama içerik okunamadı — ` +
      'boyut tek başına kapı değildir' };
  }
  if (!icerikVar) {
    return { durum: FAIL, detay: `${ad}: ${boyut} bayt ama ${icerikAciklama} yok ` +
      '(boyut yeterli, içerik boş)' };
  }
  return { durum: PASS, detay: `${ad}: ${boyut} bayt ve ${icerikAciklama} yerinde` };
}

// ---------------------------------------------------------------------------
// 5. asar okuma
// ---------------------------------------------------------------------------

/**
 * asar başlığını çözer. Saf.
 *
 * GERÇEK DÜZEN (node `asar`/Pickle — 2026-09-21'de SM4 app.asar'ının baytlarıyla
 * doğrulandı, eski sürüm bunu YANLIŞ okuyup HİÇBİR gerçek asar'ı açamıyordu):
 *   +0  4                       (boy-pickle'ının yük boyu)
 *   +4  headerBoy               (başlık pickle'ının tamamı)
 *   +8  yukBoy = headerBoy − 4  (dize pickle'ının yük boyu)
 *   +12 jsonBoy                 (JSON dizesinin UZUNLUĞU)
 *   +16 JSON                    ← gövde burada başlar, 12'de DEĞİL
 * Veri bölgesi: 8 + headerBoy.
 *
 * Eski kod jsonBoy'u +8'den (yani yük boyundan) okuyup dizeyi +12'den kesiyordu;
 * JSON'un başına 4 baytlık uzunluk öneki karışıyor ve `JSON.parse` her gerçek
 * pakette düşüyordu. Sentetik fixture aynı yanlış düzeni ürettiği için testler
 * yeşildi — mock, taşıma katmanını gizlemişti.
 */
function asarBaslikCoz(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 20) return { ok: false, sebep: 'tampon kısa' };
  const headerBoy = buf.readUInt32LE(4);
  const jsonBoy = buf.readUInt32LE(12);
  if (jsonBoy <= 0 || 16 + jsonBoy > buf.length) {
    return { ok: false, sebep: `başlık JSON'u tamponda yok (jsonBoy=${jsonBoy})` };
  }
  let baslik;
  try {
    baslik = JSON.parse(buf.toString('utf8', 16, 16 + jsonBoy));
  } catch (e) {
    return { ok: false, sebep: `başlık JSON çözülemedi: ${e.message}` };
  }
  return { ok: true, baslik, veriOfseti: 8 + headerBoy };
}

/** asar başlık ağacını düz listeye çevirir. Saf. */
function asarYollariniDuzle(baslik) {
  const cikti = [];
  const gez = (dugum, onek) => {
    if (!dugum || !dugum.files) return;
    for (const ad of Object.keys(dugum.files)) {
      const c = dugum.files[ad];
      const yol = onek ? `${onek}/${ad}` : ad;
      if (c && c.files) gez(c, yol);
      else if (c) {
        cikti.push({
          yol,
          boyut: Number(c.size || 0),
          ofset: c.offset === undefined ? null : Number(c.offset),
          unpacked: !!c.unpacked
        });
      }
    }
  };
  gez(baslik, '');
  return cikti;
}

/** Listede bir dosyayı arar; kök seviyesindekini tercih eder. Saf. */
function asarYolBul(girdiler, dosyaAdi) {
  const eslesen = girdiler.filter((g) => g.yol === dosyaAdi || g.yol.endsWith(`/${dosyaAdi}`));
  if (!eslesen.length) return null;
  eslesen.sort((a, b) => a.yol.split('/').length - b.yol.split('/').length);
  return eslesen[0];
}

/** asar'dan bir girdinin baytlarını okur (I/O). */
function asarGirdiOku(fd, veriOfseti, girdi, azami = 4 * 1024 * 1024) {
  if (!girdi || girdi.ofset === null) return null;
  const n = Math.min(girdi.boyut, azami);
  if (n <= 0) return Buffer.alloc(0);
  const tampon = Buffer.alloc(n);
  fs.readSync(fd, tampon, 0, n, veriOfseti + girdi.ofset);
  return tampon;
}

// ---------------------------------------------------------------------------
// 6. version.txt — BİLİNEN AÇIK ARIZA (350 MB yeniden indirme)
// ---------------------------------------------------------------------------

const SURUM_GEREKLI_PARCA = 3;

/** Saf: sürüm metninin parça sayısı ve hepsinin sayısal olup olmadığı. */
function surumParcalari(metin) {
  const temiz = String(metin == null ? '' : metin).trim();
  if (!temiz) return { parcalar: [], sayisal: false, ham: temiz };
  const parcalar = temiz.split('.');
  return { parcalar, sayisal: parcalar.every((p) => /^\d+$/.test(p)), ham: temiz };
}

/**
 * Yayıncının `checkVersion()` fonksiyonu 3 parça OLMAYAN her şeyi koşulsuz "eski"
 * sayar → her açılışta ~350 MB zip yeniden iner. Bu maddenin FAIL'i kullanıcıya
 * doğrudan fatura çıkarır; sessizce geçilemez.
 *
 * @param {{asarOkundu:boolean, bulundu:boolean, metin?:string, nerede?:string}} p
 */
function maddeSurum(p) {
  const ad = 'Ş kapalı işareti var ya da version.txt 3 parçalı (350 MB tuzağı)';
  // 2026-09-26 (sözleşme kural 6 düzeltmesi, G5): 350 MB indirme version.txt'ten değil
  // yayıncının kabuk kanalından (Ş, checkForUpdates) gelir. Ş pakette KAPALIYSA
  // checkVersion hiç çağrılmaz → madde geçer; version.txt yine de bilgi olarak yazılır.
  if (p.asarOkundu && typeof p.anaJs === 'string' && p.anaJs.includes(ICERIK.KANAL_S_ISARET)
    && !ICERIK.kanalSTehlikeli(p.anaJs)) {
    const s0 = surumParcalari(p.metin);
    return madde(11, ad, PASS, `kanal Ş kapalı (${ICERIK.KANAL_S_ISARET} ana süreçte, açık ` +
      `checkForUpdates yok) — checkVersion çağrılmıyor; version.txt = ` +
      `${p.bulundu ? `"${s0.ham}" (${s0.parcalar.length} parça)` : 'yok'}`);
  }
  if (!p.asarOkundu) {
    return madde(11, ad, OLCULEMEDI,
      'uygulama içeriği okunamadı (asar/ağaç açılamadı) — version.txt ölçülemedi');
  }
  if (!p.bulundu) {
    return madde(11, ad, FAIL,
      'uygulama içeriği okundu ama version.txt YOK → checkVersion varsayılan "1" ' +
      '(tek parça) ile çalışır, her açılışta ~350 MB yeniden indirir');
  }
  const nerede = p.nerede ? ` (${p.nerede})` : '';
  if (p.metin === null || p.metin === undefined) {
    // "asar'da unpacked" ile "dosya boş" aynı şey DEĞİLDİR: okuyamadığımızı
    // FAIL diye raporlamak, ölçemediğini PASS saymanın ayna görüntüsüdür.
    return madde(11, ad, OLCULEMEDI,
      `version.txt bulundu ama içeriği OKUNAMADI${nerede} — asar'da "unpacked" ` +
      'olabilir; boş olduğu SÖYLENEMEZ');
  }
  const s = surumParcalari(p.metin);
  if (s.parcalar.length === SURUM_GEREKLI_PARCA && s.sayisal) {
    return madde(11, ad, PASS,
      `version.txt = "${s.ham}" — ${SURUM_GEREKLI_PARCA} sayısal parça${nerede}`);
  }
  if (!s.ham) {
    return madde(11, ad, FAIL,
      `version.txt BOŞ${nerede} → checkVersion "eski" sayar, her açılışta indirir`);
  }
  return madde(11, ad, FAIL,
    `version.txt = "${s.ham}" → ${s.parcalar.length} parça` +
    `${s.sayisal ? '' : ' (sayısal değil)'}${nerede}; yayıncının checkVersion() ` +
    `${SURUM_GEREKLI_PARCA} parça olmayanı KOŞULSUZ eski sayar → her açılışta ~350 MB indirir`);
}

// ---------------------------------------------------------------------------
// 7. Dil paketleri (karar #6)
// ---------------------------------------------------------------------------

const BEKLENEN_DILLER = ['en-US.pak', 'tr.pak'];

function maddeDiller(pakAdlari) {
  const ad = 'electronLanguages ["tr","en-US"] (dil paketleri budandı)';
  if (!Array.isArray(pakAdlari)) {
    return madde(6, ad, OLCULEMEDI, 'locales/ dizini okunamadı');
  }
  if (!pakAdlari.length) {
    return madde(6, ad, FAIL, 'locales/ dizini BOŞ — hiç .pak yok');
  }
  const var_ = pakAdlari.slice().sort();
  const eksik = BEKLENEN_DILLER.filter((d) => !var_.includes(d));
  const fazla = var_.filter((d) => !BEKLENEN_DILLER.includes(d));
  if (eksik.length || fazla.length) {
    const p = [];
    if (eksik.length) p.push(`eksik: ${eksik.join(', ')}`);
    if (fazla.length) {
      const ilk = fazla.slice(0, 6).join(', ') + (fazla.length > 6 ? '…' : '');
      p.push(`budanmamış: ${fazla.length} adet (${ilk})`);
    }
    return madde(6, ad, FAIL, `${var_.length} .pak bulundu — ${p.join(' · ')}`);
  }
  return madde(6, ad, PASS, `tam olarak ${BEKLENEN_DILLER.join(' + ')} (${var_.length} dosya)`);
}

// ---------------------------------------------------------------------------
// 8. Ana süreç yamaları (kararlar #7 #8 #10)
// ---------------------------------------------------------------------------

const ISARET_ACILIS = 'EMPP_READY_TO_SHOW';
const ISARET_OTELEME = 'EMPP_GUNCELLEME_OTELEME';
const ISARET_ON_GETIRME = 'EMPP_ON_GETIRME';

/**
 * GİRİŞ ADAYLARI — sabit düşme listesi. `package.json.main` yoksa, okunamazsa
 * ya da gösterdiği dosya pakette yoksa buraya düşülür. Sıra `guncelleyici-enjekte.js`
 * / `acilis-guncelleme-oteleme.js`'teki üretim listesiyle AYNIDIR (kopya, ayrı karar
 * DEĞİL — üretici de aynı iki adı bu sırayla dener).
 */
const GIRIS_ADAYLARI_VARSAYILAN = ['electron.js', 'main.js'];

/**
 * PAKETİN ANA SÜREÇ GİRİŞ DOSYASI — TEK KAYNAK (2026-09-21 onarımı).
 *
 * ÖLÇÜLMÜŞ KUSUR: bu betik giriş dosyası kararını İKİ AYRI YERDE veriyordu.
 * asar dalı önce `package.json.main`'e bakıyor, bulamazsa sabit listeye
 * düşüyordu; açık ağaç dalı (`asar: false`) `package.json.main`i HİÇ OKUMUYOR,
 * doğrudan sabit listeyi `['electron.js','main.js']` sırasıyla deniyordu.
 * Gerçek bir SET paketinde (Super Monsters 4, asar:false) `package.json.main`
 * = "main.js" idi ve dört parçalı açılış yaması (EMPP_READY_TO_SHOW/show:false/
 * ready-to-show/8000) YALNIZ main.js'teydi (`electron.js` yayıncının orijinal,
 * yamasız kaynağı olarak pakette de duruyordu) — açık ağaç dalı sabit listede
 * `electron.js`'i `main.js`'ten ÖNCE deneyip YANLIŞ dosyayı seçti, madde 7
 * "yama HİÇ uygulanmamış" diye YALAN FAIL üretti (ölçüldü, 2026-09-21).
 *
 * ÇÖZÜM: `girisDosyasiCoz` — asar dalı da açık ağaç dalı da AYNI fonksiyonu
 * çağırır, ayrı mantık YOK. Sıra: 1) `package.json.main` (varsa VE pakette o
 * ad gerçekten mevcutsa) 2) sabit `GIRIS_ADAYLARI_VARSAYILAN`. Hangisinin
 * kazandığı `kaynak` alanında GÖRÜNÜR kılınır — sessiz düşme yasak (dosya başı
 * MUTLAK KURAL: ölçemediğini/düştüğünü sessizce geçme, buraya da uygulanır).
 *
 * @param {string|null|undefined} mainAlani package.json.main değeri (yoksa/
 *   okunamadıysa null — hangi sebepten null olduğu çağırana kalır)
 * @param {(ad:string) => boolean} varMi bir aday ADIN (basename) pakette var
 *   olup olmadığını sorar — asar dalı `asarYolBul`, açık ağaç dalı
 *   `fs.existsSync` ile cevaplar; TANIM burada tek, SORGULAMA dala özgü
 * @returns {{ad:string|null, kaynak:'package.json'|'varsayilan-liste'|null,
 *            mainAlani:string|null, not?:string}}
 */
function girisDosyasiCoz(mainAlani, varMi) {
  const temiz = typeof mainAlani === 'string' ? mainAlani.trim() : '';
  if (temiz) {
    const ad = path.basename(temiz);
    if (ad && varMi(ad)) return { ad, kaynak: 'package.json', mainAlani: temiz };
  }
  for (const aday of GIRIS_ADAYLARI_VARSAYILAN) {
    if (varMi(aday)) {
      return {
        ad: aday,
        kaynak: 'varsayilan-liste',
        mainAlani: temiz || null,
        not: temiz
          ? `package.json.main="${temiz}" pakette bulunamadı — sabit listeye düşüldü`
          : 'package.json.main yok/okunamadı — sabit listeye düşüldü'
      };
    }
  }
  return {
    ad: null,
    kaynak: null,
    mainAlani: temiz || null,
    not: 'ne package.json.main ne de sabit liste adaylarından biri pakette bulundu'
  };
}

/**
 * Karar #7 — açılış yaması ATOMİK: işaret + show:false + ready-to-show + 8 sn emniyet.
 * Kısmî uygulama KATASTROFİKTİR (`show:false` tek başına = pencere hiç açılmaz),
 * bu yüzden eksik parça FAIL'dir, "kısmen tamam" diye bir şey yok.
 */
function maddeAcilisYamasi(anaJs) {
  const ad = 'Açılış yaması show:false + ready-to-show + 8 sn emniyet (atomik)';
  if (typeof anaJs !== 'string') {
    return madde(7, ad, OLCULEMEDI, 'ana süreç betiği (electron.js/main.js) okunamadı');
  }
  const parcalar = {
    işaret: anaJs.includes(ISARET_ACILIS),
    'show:false': /show\s*:\s*false/.test(anaJs),
    'ready-to-show': anaJs.includes('ready-to-show'),
    '8 sn emniyet': /\b8000\b/.test(anaJs)
  };
  const eksik = Object.keys(parcalar).filter((k) => !parcalar[k]);
  const duran = Object.keys(parcalar).filter((k) => parcalar[k]);
  if (!eksik.length) return madde(7, ad, PASS, 'dört parçanın dördü de yerinde');
  if (eksik.length === Object.keys(parcalar).length) {
    return madde(7, ad, FAIL, 'yama HİÇ uygulanmamış — dört parçanın dördü de yok');
  }
  return madde(7, ad, FAIL,
    `ATOMİKLİK BOZUK — eksik: ${eksik.join(', ')} (var: ${duran.join(', ')}). ` +
    'show:false varken ready-to-show yoksa pencere HİÇ açılmaz');
}

function maddeGuncellemeOteleme(anaJs) {
  const ad = 'Güncelleme ötelemesi (EMPP_GUNCELLEME_OTELEME, varsayılan AÇIK)';
  if (typeof anaJs !== 'string') {
    return madde(8, ad, OLCULEMEDI, 'ana süreç betiği okunamadı');
  }
  if (!anaJs.includes(ISARET_OTELEME)) {
    return madde(8, ad, FAIL,
      `"${ISARET_OTELEME}" işareti pakette yok → checkForUpdates pencereyi bloklar, ` +
      'ağ yanıt vermezse süresiz boş ekran');
  }
  const zamanAsimi = /\b15000\b/.test(anaJs);
  return madde(8, ad, PASS,
    `işaret yerinde${zamanAsimi
      ? ' · 15 sn zaman aşımı görüldü'
      : ' (15 sn zaman aşımı sabiti görülmedi)'}`);
}

/**
 * Kitap kökleri = `index.html` VE `app.config.js` birlikte duran dizinler. Saf.
 *
 * Motor imzasıyla bulunur, AD DESENİYLE DEĞİL (proje kanonu K17). SET'te bu
 * book1..bookN'i verir; SET menü kökünü ve `htmletk/` alt sayfalarını dışarıda
 * bırakır — SM4'te ölçüldü: 5 kitap kökü, 22 htmletk sayfası elendi.
 */
function kitapKokleri(yollar) {
  const kume = new Set(Array.isArray(yollar) ? yollar : []);
  const dizin = (y) => (y.includes('/') ? y.slice(0, y.lastIndexOf('/')) : '');
  const kokler = [];
  for (const y of kume) {
    if (!/(^|\/)index\.html$/i.test(y)) continue;
    const d = dizin(y);
    if (kume.has(d ? `${d}/app.config.js` : 'app.config.js')) kokler.push(d);
  }
  return kokler.sort();
}

/**
 * Karar #10 — sayfa ön-ısıtma.
 *
 * ÖLÇÜM YERİ DÜZELTİLDİ (2026-09-21, SM4'te ölçüldü). İşaret ana süreç betiğine
 * DEĞİL, her KİTAP KÖKÜNÜN `index.html`ine `</body>` öncesine enjekte edilir
 * (`src/packaging/sayfa-on-getirme.js` → `icerigeEnjekteEt`). Eski sürüm main.js'te
 * arıyordu ve yaması DOĞRU UYGULANMIŞ pakete FAIL veriyordu: kapının sağlam paketi
 * suçlaması, ölçememekten daha tehlikelidir — operatör olmayan bir arızayı kovalar.
 *
 * @param {{kokler:string[], isaretli:string[]}|null} p
 */
function maddeOnIsitma(p) {
  const ad = 'Sayfa ön-ısıtma (EMPP_ON_GETIRME — kitap köklerinin index.html\'i)';
  if (!p || !Array.isArray(p.kokler) || !Array.isArray(p.isaretli)) {
    return madde(10, ad, OLCULEMEDI, 'uygulama içeriği okunamadı');
  }
  if (!p.kokler.length) {
    return madde(10, ad, OLCULEMEDI,
      'kitap kökü bulunamadı (index.html + app.config.js taşıyan dizin yok) — ' +
      'işaretin YOKLUĞU buradan ölçülemez');
  }
  const eksik = p.kokler.filter((k) => p.isaretli.indexOf(k) === -1);
  const adlar = (l) => l.map((k) => k || '<kök>').join(', ');
  if (!eksik.length) {
    return madde(10, ad, PASS,
      `${p.kokler.length}/${p.kokler.length} kitap kökünde işaret var (${adlar(p.kokler)})`);
  }
  if (eksik.length === p.kokler.length) {
    return madde(10, ad, FAIL,
      `${p.kokler.length} kitap kökünün HİÇBİRİNDE "${ISARET_ON_GETIRME}" yok — ` +
      'ön-ısıtma uygulanmamış');
  }
  return madde(10, ad, FAIL,
    `KARDEŞ KÖR NOKTASI: ${p.kokler.length} kitap kökünün ${eksik.length} tanesinde ` +
    `işaret YOK (${adlar(eksik)}) — SET'te alt kitap atlanmış`);
}

// ---------------------------------------------------------------------------
// 9. Sayfa WebP kapısı (karar #9) — YALNIZ RAPOR, karar verilmez
// ---------------------------------------------------------------------------

/** mod1: ilk n baytı (256 − x) & 0xFF ile çevirir. İnvolutif. */
function mod1(buf, n = 100) {
  const out = Buffer.from(buf);
  const sinir = Math.min(n, out.length);
  for (let i = 0; i < sinir; i++) out[i] = (256 - out[i]) & 0xff;
  return out;
}

function imzaSinifi(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 4).equals(PNG_IMZA.subarray(0, 4))) return 'png';
  const riff = buf.toString('latin1', 0, 4) === 'RIFF';
  if (riff && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Saf: bir sayfa dosyasının gerçek içerik sınıfı (mod1 şifresi hesaba katılır). */
function sayfaSinifi(buf) {
  const duz = imzaSinifi(buf);
  if (duz) return duz;
  const cozulmus = imzaSinifi(mod1(buf));
  if (cozulmus) return `${cozulmus}-sifreli`;
  return 'bilinmiyor';
}

/**
 * Karar #9 — kapının AÇIK mı KAPALI mı olduğunu RAPORLAR. Karar vermez, FAIL üretmez
 * (OKU.md: "hangisi olduğunu RAPORLA, karar verme").
 */
function maddeWebp(siniflar) {
  const ad = 'Sayfa WebP kapısı — pakette açık mı kapalı mı (yalnız rapor)';
  if (!Array.isArray(siniflar) || !siniflar.length) {
    return madde(9, ad, OLCULEMEDI, 'pages/ altında örneklenebilir sayfa bulunamadı');
  }
  const say = siniflar.reduce((a, s) => {
    const k = s.replace(/-sifreli$/, '');
    a[k] = (a[k] || 0) + 1;
    return a;
  }, {});
  const webp = say.webp || 0;
  const png = say.png || 0;
  const durum = webp > 0 ? 'AÇIK' : 'KAPALI';
  const dokum = Object.keys(say).map((k) => `${k}: ${say[k]}`).join(' · ');
  return madde(9, ad, RAPOR,
    `kapı ${durum} — ${siniflar.length} örnek → ${dokum}` +
    (webp > 0 ? ' (dosya adları .png, içerik WebP)' : ''));
}

// ---------------------------------------------------------------------------
// 9b. SET güncelleme kanalı (karar #11) — madde 13
//
// NUMARA NOTU: bu KARAR #11'dir ama madde numarası 13'tür. 11 ve 12 slotları
// zaten version.txt ve app.asar boyut+içerik kapılarına ait; onları kaydırmak
// mevcut 45 testin numara sözleşmesini kırardı.
//
// ÖLÇÜM KAYNAĞI YALNIZ ÜRETİLEN PAKETTİR. Kaynak koda, paketleyici config'ine
// ya da `EMPP_SET_GUNCELLEME` ortam değişkenine BAKILMAZ: "config'in beyan
// etmesi ≠ çıktının taşıması" (karar 6'da tam bu hata yapıldı — `electronLanguages`
// config'de doğruydu, kapı yine de çıktıdan ölçmek zorundaydı).
//
// TUZAK — ENJEKSİYON HEDEFİ KODDAN DOĞRULANDI, VARSAYILMADI:
//   `src/packaging/sayfa-on-getirme.js` işaretini KİTAP KÖKÜNÜN `index.html`ine
//   koyar; kapının 10. maddesi bir zamanlar main.js'e bakıp sağlam pakete FAIL
//   veriyordu. Burada aynı hataya düşmemek için `guncelleyici-enjekte.js` okundu:
//     · `GIRIS_ADLARI = ['electron.js','main.js']` + `girisAdaylari()` →
//       hedef ANA SÜREÇ GİRİŞ DOSYASIDIR, index.html DEĞİL.
//     · çapa `app.whenReady()`, işaret `EMPP_SET_GUNCELLEME`.
//     · yama tuttuysa `kitap-guncelleyici.js` girişin YANINA
//       `empp-set-guncelleyici.js` adıyla kopyalanır ve `require('./…')` edilir.
//   Bu yüzden işaret ANA SÜREÇ BETİĞİNDE aranır; ağacın herhangi bir yerinde
//   DEĞİL — çünkü `empp-set-guncelleyici.js`'in KENDİSİ de aynı dizgeyi taşır ve
//   "ağaçta var mı" sorusu yetim modülü sahte GEÇTİ'ye çevirirdi.
// ---------------------------------------------------------------------------

/** `src/packaging/set-kimligi.js` → DOSYA_ADI. */
const SET_DOSYA_ADI = 'empp-set.json';
/** `src/packaging/guncelleyici-enjekte.js` → MODUL_ADI. */
const SET_MODUL_ADI = 'empp-set-guncelleyici.js';
/** `src/packaging/guncelleyici-enjekte.js` → ISARET. */
const ISARET_SET_GUNCELLEME = 'EMPP_SET_GUNCELLEME';
/** Kabuk tanımı — KOPYA DEĞİL, `src/packaging/set-kabuk.js`'ten yeniden yayım. */
const SET_KABUK_DIZINLERI = SET_KABUK.KABUK_DIZINLERI;
const SET_KABUK_IMZASI = SET_KABUK.IMZA;

/** Göreli bir yolun dizin parçası ('' = kök). Saf. */
function yolDizini(yol) {
  const y = String(yol == null ? '' : yol);
  return y.includes('/') ? y.slice(0, y.lastIndexOf('/')) : '';
}

/**
 * `empp-set.json` metnini çözer. Saf.
 * "okunamadı" ile "bozuk" AYRI döner: ilki ÖLÇÜLEMEDİ, ikincisi FAIL üretir.
 */
function setHaritasiCoz(metin) {
  if (metin === null || metin === undefined) {
    return { ok: false, okunamadi: true, sebep: 'içerik okunamadı' };
  }
  const ham = String(metin).trim();
  if (!ham) return { ok: false, sebep: `${SET_DOSYA_ADI} BOŞ` };
  let harita;
  try {
    harita = JSON.parse(ham);
  } catch (e) {
    return { ok: false, sebep: `${SET_DOSYA_ADI} JSON çözülemedi: ${e.message}` };
  }
  if (!harita || typeof harita !== 'object' || Array.isArray(harita)) {
    return { ok: false, sebep: `${SET_DOSYA_ADI} bir JSON nesnesi değil` };
  }
  return { ok: true, harita };
}

/**
 * KABUK listesine sızmış, kabuk OLMAYAN girdileri döner. Saf.
 * TANIM BURADA DEĞİL — üreticiyle AYNI fonksiyon çağrılır (`set-kabuk.js`).
 * `book1/index.html` gibi KİTAP İÇİ dosya buraya girerse set kanalı kitabın
 * içeriğini ezer — bu bir sızmadır.
 */
const kabukSizintilari = SET_KABUK.kabukSizintilari;

// --- TEK-MOTOR düzeni (index üreteci, 02.10) -------------------------------
// Aktivasyonlu setler TEK kitap motoruyla kurulur: kökte `bookN/` YOK; kitaplar
// `assets/<kapak ID>/` altında, kök menü (`classlibraries/ImWin32.dll`) her kapağı
// listeler. Üyelik `bookN` ile değil MENÜ ile tanımlıdır → `kitapDizinleri[]` boş
// OLMAK ZORUNDA. Bu düzende `assets/` kitap içeriğidir: bookN gibi set kanalının
// KAPSAMI DIŞINDA kalır (kitabın kendi kanalı günceller), "bilinmeyen dal" değildir.
// Aynı şekilde kök `classlibraries/` (menü) K kanalının malıdır.
const TEK_MOTOR_ISARET_ADI = 'empp-uretec.json';
const TEK_MOTOR_MENU = 'classlibraries/ImWin32.dll';
const TEK_MOTOR_ICERIK_DIZINI = 'assets';
// Tek-motorda set kanalı DIŞINDA kalan, K (kitap içerik) kanalının sahibi olduğu kök dizinler:
// kitaplar (`assets/`) + kök menü (`classlibraries/ImWin32.dll`, kapak listesi/sürümler).
const TEK_MOTOR_K_DIZINLERI = Object.freeze(['assets', 'classlibraries']);
const TEK_MOTOR_ICERIK_SONEKI = 'data/BookContent.xml';
const TEK_MOTOR_IMKEYS_ADI = 'imKeys.dll';

/** Etiketten öznitelik. Saf. */
function etiketOznitelik(etiket, ad) {
  const m = new RegExp(`\\s${ad}="([^"]*)"`).exec(String(etiket || ''));
  return m ? m[1] : null;
}

/**
 * Tek-motor kanıtını TOPLAR. Saf (I/O yok): ağaç yolları + menü baytları + işaret metni.
 * Okunamayan her şey `null`/`false` kalır — tahmin yok.
 * @param {{yollar:string[]|null, menuHam?:Buffer|string|null, isaretMetin?:string|null}} g
 */
function tekMotorKanitiTopla(g = {}) {
  const yollar = Array.isArray(g.yollar) ? g.yollar.map((y) => String(y).replace(/\\/g, '/')) : [];
  const var_ = new Set(yollar);
  const bookDizinleri = [...new Set(yollar.map((y) => y.split('/'))
    .filter((p) => p.length > 1 && SET_KABUK.KITAP_DIZIN_DESENI.test(p[0])).map((p) => p[0]))].sort();
  let isaret = null;
  if (typeof g.isaretMetin === 'string') {
    try { isaret = JSON.parse(g.isaretMetin); } catch (e) { isaret = { cozulemedi: true }; }
  }
  const k = {
    bookDizinleri, isaret, menuVar: var_.has(TEK_MOTOR_MENU), menuCozuldu: false,
    ana: null, kapaklar: [],
  };
  if (g.menuHam == null) return k;
  let xml = null;
  try { xml = IG_RUNTIME.menuCoz(g.menuHam); } catch (e) { xml = null; }
  if (!xml) return k;
  k.menuCozuldu = true;
  const ana = (String(xml).match(/<main\b[^>]*>/) || [''])[0];
  k.ana = { activation: etiketOznitelik(ana, 'activation'), key: etiketOznitelik(ana, 'key') };
  for (const c of IG_RUNTIME.kapaklar(xml)) {
    const id = c.ID == null ? '' : String(c.ID);
    const xs = etiketOznitelik(c.etiket, 'xmlSource');
    const icerikYolu = xs ? xs.replace(/^\/+/, '')
      : `${TEK_MOTOR_ICERIK_DIZINI}/${id}/${TEK_MOTOR_ICERIK_SONEKI}`;
    const imKeysYolu = icerikYolu.endsWith(TEK_MOTOR_ICERIK_SONEKI)
      ? icerikYolu.slice(0, -TEK_MOTOR_ICERIK_SONEKI.length) + TEK_MOTOR_IMKEYS_ADI : null;
    k.kapaklar.push({
      id, icerikYolu, icerikVar: var_.has(icerikYolu),
      imKeysYolu, imKeysVar: imKeysYolu ? var_.has(imKeysYolu) : false,
    });
  }
  return k;
}

/**
 * Bu ağaç TEK-MOTOR mu? Üretecin yazdığı işaret (`empp-uretec.json` → `duzen`) VARSA o
 * karar verir; yoksa (işaret pakete girmemiş) YAPISAL: kökte bookN yok + çözülmüş kök menüde
 * ≥2 kapak. Saf.
 */
function tekMotorMu(k) {
  if (!k) return false;
  const d = k.isaret && typeof k.isaret.duzen === 'string' ? k.isaret.duzen : null;
  if (d === 'tek-motor') return true;
  if (d) return false;
  return !k.bookDizinleri.length && k.menuCozuldu && k.kapaklar.length >= 2;
}

/**
 * Tek-motor sözleşmesi kusurları. Saf. `{kusur, olculemedi}`.
 *   · kökte bookN YOK · tek kitap motoru kökte (menü çözülmüş)
 *   · her kapağın içeriği üretecin koyduğu yerde (`xmlSource`, yoksa assets/<ID>/data/BookContent.xml)
 *   · activation="true" ⇒ main.key boş (kod ilk açılışta sorulur) VE ilk kapağın imKeys.dll'i yazılı
 *   · activation true/false dışı bir değer = tutarsız
 */
function tekMotorKusurlari(k) {
  const kusur = [];
  const olculemedi = [];
  if (k.bookDizinleri.length) {
    kusur.push(`tek-motor ama kökte bookN dizini var (${k.bookDizinleri.join(', ')}) — iki düzen karışmış`);
  }
  if (!k.menuVar && !k.menuCozuldu) {
    kusur.push(`kitap motoru menüsü YOK (${TEK_MOTOR_MENU}) — kapak listesi/üyelik tanımsız`);
    return { kusur, olculemedi };
  }
  if (!k.menuCozuldu) {
    olculemedi.push(`kök menü (${TEK_MOTOR_MENU}) çözülemedi — kapak/aktivasyon ÖLÇÜLEMEDİ`);
    return { kusur, olculemedi };
  }
  if (!k.kapaklar.length) kusur.push('kök menüde hiç kapak yok — tek-motor setinde kitap yok');
  const eksik = k.kapaklar.filter((c) => !c.icerikVar);
  if (eksik.length) {
    const ilk = eksik.slice(0, 6).map((c) => `${c.id} (${c.icerikYolu})`).join(', ');
    kusur.push(`kitap içeriği EKSİK: ${eksik.length}/${k.kapaklar.length} kapağın ` +
      `BookContent.xml'i pakette yok — ${ilk}${eksik.length > 6 ? ' …' : ''}`);
  }
  const act = k.ana ? k.ana.activation : null;
  if (act !== 'true' && act !== 'false') {
    kusur.push(`main.activation "${act}" — true/false değil`);
  } else if (act === 'true') {
    if (k.ana.key) kusur.push('main.activation="true" ama main.key dolu — kod sorulmaz, anahtar menüye gömülmüş');
    const ilk = k.kapaklar[0];
    if (ilk && !ilk.imKeysVar) {
      kusur.push(`main.activation="true" ama ilk kapağın ${ilk.imKeysYolu || TEK_MOTOR_IMKEYS_ADI} ` +
        'yazılı değil — aktivasyon diyaloğu açılışta düşer');
    }
  }
  return { kusur, olculemedi };
}

/** `empp-set.json` gövdesinin tutarlılık kusurları. Saf. Boş dizi = tutarlı. */
function setHaritasiKusurlari(harita, secenek = {}) {
  const kusur = [];
  const h = harita && typeof harita === 'object' ? harita : {};

  const kimlik = h.setKimligi;
  if (typeof kimlik !== 'string' || !kimlik.trim()) {
    kusur.push(`setKimligi boş/null (${JSON.stringify(kimlik === undefined ? null : kimlik)})` +
      ' → kanal KAPALI, paket hiçbir güncelleme almaz' +
      (typeof h.sebep === 'string' && h.sebep ? ` · pakete yazılan sebep: "${h.sebep}"` : ''));
  }

  const taban = typeof h.taban === 'string' ? h.taban.trim() : '';
  if (!/^https?:\/\//i.test(taban)) {
    kusur.push('taban http(s) ile başlamıyor ' +
      `(${JSON.stringify(h.taban === undefined ? null : h.taban)})`);
  }

  if (!Array.isArray(h.kabukDosyalari) || !h.kabukDosyalari.length) {
    kusur.push('kabukDosyalari[] boş — güncellenecek kabuk envanteri yok');
  }
  if (secenek.tekMotor) {
    // Tek-motor: üyelik bookN değil MENÜ — dizin listesi boş OLMALI (dolu = iki düzen karışmış).
    if (Array.isArray(h.kitapDizinleri) && h.kitapDizinleri.length) {
      kusur.push(`tek-motor düzeninde kitapDizinleri[] dolu (${h.kitapDizinleri.join(', ')}) — ` +
        'üyelik menüyle tanımlı, bookN dizini olmamalı');
    }
  } else if (!Array.isArray(h.kitapDizinleri) || !h.kitapDizinleri.length) {
    kusur.push('kitapDizinleri[] boş — üyelik listesi yok');
  }
  return kusur;
}

/**
 * Karar #11 — SET güncelleme kanalı paketin İÇİNDE mi.
 *
 * Üç ölçüm, tek karar:
 *   A) `empp-set.json` var mı ve gövdesi tutarlı mı
 *   B) güncelleyici çalışma-anı kodu ANA SÜREÇ GİRİŞİNE enjekte edilmiş mi
 *      (+ modül girişin YANINDA mı — yetim yama / yetim modül ayrı ayrı yakalanır)
 *   C) kabuk envanteri tanıma uyuyor mu — C1 sızma · C2 kapsam · C3 tanım imzası
 *
 * BİRLEŞTİRME KURALI: bir FAIL kanıttır, ölçülemeyen başka bir yarım onu
 * silemez → FAIL baskındır. FAIL yoksa ve ölçülemeyen yarım varsa ÖLÇÜLEMEDİ.
 * GEÇTİ yalnız ÜÇÜ DE ölçülüp üçü de temizse verilir.
 *
 * @param {{asarOkundu:boolean, setBulundu:boolean, setMetin?:string|null,
 *          setNerede?:string|null, anaJs?:string|null, anaJsYolu?:string|null,
 *          anaJsDizini?:string|null, setModulYollari?:string[]|null}} p
 */
function maddeSetGuncelleme(p = {}) {
  const NO = 13;
  const ad = 'SET güncelleme kanalı paket içinde (empp-set.json + güncelleyici ' +
    'enjeksiyonu — karar #11)';

  if (!p.asarOkundu) {
    return madde(NO, ad, OLCULEMEDI,
      'uygulama içeriği okunamadı (asar/ağaç açılamadı) — SET güncelleme kanalı ölçülemedi');
  }

  const fail = [];
  const olculemedi = [];
  const gecen = [];
  const nerede = p.setNerede ? ` (${p.setNerede})` : '';
  const tekMotor = tekMotorMu(p.tekMotor);

  // --- A) empp-set.json -----------------------------------------------------
  let harita = null;
  if (!p.setBulundu) {
    fail.push(`A) ${SET_DOSYA_ADI} pakette YOK — güncelleme kanalı paketin içinde değil`);
  } else {
    const c = setHaritasiCoz(p.setMetin);
    if (c.okunamadi) {
      // "asar'da unpacked" ile "dosya boş" aynı şey DEĞİLDİR (madde 11 dersi).
      olculemedi.push(`A) ${SET_DOSYA_ADI} bulundu ama içeriği OKUNAMADI${nerede} — ` +
        'asar\'da "unpacked" olabilir; boş/bozuk olduğu SÖYLENEMEZ');
    } else if (!c.ok) {
      fail.push(`A) ${c.sebep}${nerede}`);
    } else {
      harita = c.harita;
      const kusur = setHaritasiKusurlari(harita, { tekMotor });
      if (kusur.length) fail.push(`A) ${SET_DOSYA_ADI} tutarsız${nerede}: ${kusur.join(' · ')}`);
      else {
        gecen.push(`A) ${SET_DOSYA_ADI} tutarlı${nerede}: setKimligi="${harita.setKimligi}", ` +
          `taban=${harita.taban}, ${harita.kabukDosyalari.length} kabuk dosyası, ` +
          (tekMotor ? `tek-motor (üyelik menüde, ${p.tekMotor.kapaklar.length} kapak)`
            : `${harita.kitapDizinleri.length} kitap üye`));
      }
    }
  }

  // --- B) enjeksiyon --------------------------------------------------------
  const modulYollari = Array.isArray(p.setModulYollari) ? p.setModulYollari : null;
  if (typeof p.anaJs !== 'string') {
    olculemedi.push('B) ana süreç giriş betiği (electron.js/main.js) okunamadı — ' +
      'enjeksiyon ölçülemedi');
  } else if (!modulYollari) {
    olculemedi.push('B) uygulama ağacının dosya listesi alınamadı — ' +
      `${SET_MODUL_ADI} varlığı ölçülemedi`);
  } else {
    const girisDizini = String(p.anaJsDizini == null ? '' : p.anaJsDizini);
    const isaret = p.anaJs.includes(ISARET_SET_GUNCELLEME);
    const cagri = p.anaJs.includes(SET_MODUL_ADI);
    const yaninda = modulYollari.filter((y) => yolDizini(y) === girisDizini);
    const giris = p.anaJsYolu || '(giriş)';

    if (!isaret && !cagri && !modulYollari.length) {
      fail.push(`B) enjeksiyon HİÇ uygulanmamış — ${giris} içinde ` +
        `"${ISARET_SET_GUNCELLEME}" yok ve pakette ${SET_MODUL_ADI} yok`);
    } else if (!isaret || !cagri) {
      fail.push(`B) YETİM MODÜL — ${SET_MODUL_ADI} pakette var ` +
        `(${modulYollari.join(', ') || 'yol yok'}) ama ${giris} onu çağırmıyor ` +
        `(işaret: ${isaret ? 'var' : 'YOK'}, require: ${cagri ? 'var' : 'YOK'}) → ` +
        'çalışma anında hiç koşmaz');
    } else if (!yaninda.length) {
      fail.push(`B) YETİM YAMA — ${giris} ${SET_MODUL_ADI}'yi çağırıyor ama modül ` +
        `girişin yanında (dizin: "${girisDizini || '<kök>'}") YOK` +
        (modulYollari.length ? ` · bulunduğu yerler: ${modulYollari.join(', ')}` : '') +
        ' → require açılışta düşer, güncelleme hiç çalışmaz');
    } else {
      gecen.push(`B) ${giris} işaret + require taşıyor, ${SET_MODUL_ADI} girişin yanında ` +
        `(${yaninda.join(', ')})`);
    }
  }

  // --- C) kabuk envanterinin tanıma uygunluğu -------------------------------
  // Üç ayrı soru, üçü de ÖLÇÜLÜR:
  //   C1 sızma  — envanterde kabuk OLMAYAN girdi var mı (kitap içeriği, artefakt)
  //   C2 kapsam — kabuk tanımının kapsamadığı kök dizin var mı (beyaz listenin
  //               kör noktası; sessiz eksik yerine gürültülü eksik)
  //   C3 tanım  — paketi üreten paketleyicinin kabuk tanımı BU kapının tanımıyla
  //               aynı mı (imza karşılaştırması — sürüm sapması sessizce geçmesin)
  if (!harita) {
    olculemedi.push(`C) kabuk envanteri okunamadı — sızma/kapsam/tanım ölçülemedi`);
  } else if (!Array.isArray(harita.kabukDosyalari)) {
    fail.push('C) kabukDosyalari bir dizi değil — sızma denetimi yapılamaz, envanter bozuk');
  } else {
    // A1 (tek motorlu set, `kapak/index.html` motor sayfası): üretici `duzen: 'a1'` yazar; kabuk
    // tanımı A1 seçeneğiyle uygulanır (`kapak/` kabuk). Tek-motor kanıtı yoksa iddia geçersiz.
    const a1 = harita.duzen === 'a1';
    if (a1 && !tekMotor) fail.push('C) empp-set.json duzen=a1 ama paket tek-motor düzeninde değil');
    const kabukSecenek = { a1: a1 && tekMotor };
    const sizan = kabukSizintilari(harita.kabukDosyalari, kabukSecenek);
    if (sizan.length) {
      const ilk = sizan.slice(0, 8).map((y) => {
        const sebep = SET_KABUK.kabukDisiSebep(y, kabukSecenek);
        return `${JSON.stringify(y)} → ${sebep}`;
      }).join(' · ') + (sizan.length > 8 ? ' …' : '');
      fail.push(`C1) KABUK DIŞI GİRDİ SIZMIŞ — kabukDosyalari[] içinde ` +
        `${sizan.length} girdi kabuk değil (${ilk}); set kanalı kapsamı dışını ezer`);
    } else {
      gecen.push(`C1) sızma yok — ${harita.kabukDosyalari.length} kabuk girdisinin tamamı ` +
        `kök dosyası ya da ${SET_KABUK_DIZINLERI.map((d) => d + '/').join(' / ')} altında`);
    }

    // C2 — şema 2 ile geldi. Alan yoksa "temiz" DEĞİL, ÖLÇÜLEMEDİ'dir (eski paket).
    if (!Array.isArray(harita.kapsamDisiDallar)) {
      olculemedi.push('C2) kapsamDisiDallar[] alanı yok (şema < 2) — kabuk tanımının ' +
        'bu ağacı kapsayıp kapsamadığı ÖLÇÜLEMEDİ');
    } else {
      // Tek-motor'da `assets/` kitap içeriğidir (bookN gibi kanal kapsamı DIŞI, bilerek);
      // geri kalan her bilinmeyen kök dizin yine FAIL — gevşetme yalnız bu tek ad için.
      const dis = harita.kapsamDisiDallar.filter((d) => !(tekMotor && TEK_MOTOR_K_DIZINLERI.includes(d)));
      if (dis.length) {
        fail.push(`C2) KABUK TANIMI BU AĞACI KAPSAMIYOR — beyaz listede olmayan kök ` +
          `dizin(ler): ${dis.join(', ')}. O dizinlerdeki dosyalar ` +
          `güncelleme kanalına HİÇ girmez; tanım (set-kabuk.js) güncellenmeli`);
      } else if (tekMotor && harita.kapsamDisiDallar.length) {
        gecen.push(`C2) kapsam tam — tek-motor: ${harita.kapsamDisiDallar.join(', ')} K kanalının ` +
          '(kitap içeriği + kök menü; set kanalı kapsamı dışı, bilerek); başka bilinmeyen kök dizin yok');
      } else {
        gecen.push('C2) kapsam tam — kabuk tanımı dışında kalan kök dizin yok');
      }
    }

    // C3 — üreticinin tanımı ile kapının tanımı aynı mı?
    if (typeof harita.kabukTanimi !== 'string' || !harita.kabukTanimi) {
      olculemedi.push('C3) kabukTanimi imzası pakette yok (şema < 2) — üreticinin ' +
        'kabuk tanımı bu kapınınkiyle aynı mı ÖLÇÜLEMEDİ');
    } else if (harita.kabukTanimi !== (kabukSecenek.a1 ? SET_KABUK.IMZA_A1 : SET_KABUK_IMZASI)) {
      const beklenen = kabukSecenek.a1 ? SET_KABUK.IMZA_A1 : SET_KABUK_IMZASI;
      fail.push(`C3) TANIM SAPMASI — paketi üreten paketleyicinin kabuk tanımı ` +
        `"${harita.kabukTanimi}", kapınınki "${beklenen}". İki taraf aynı ` +
        `kabuğu ölçmüyor; kapının GEÇTİ'si bu paket için geçersizdir`);
    } else {
      gecen.push(`C3) tanım aynı (${harita.kabukTanimi})`);
    }
  }

  // --- E) tek-motor sözleşmesi (yalnız tek-motor düzeninde) -----------------
  if (p.tekMotor && p.tekMotor.isaret && p.tekMotor.isaret.duzen === 'tek-motor' &&
      !tekMotor) {
    fail.push('E) işaret tek-motor diyor ama ağaç tek-motor değil');
  }
  if (tekMotor) {
    const e = tekMotorKusurlari(p.tekMotor);
    for (const x of e.kusur) fail.push(`E) ${x}`);
    for (const x of e.olculemedi) olculemedi.push(`E) ${x}`);
    if (!e.kusur.length && !e.olculemedi.length) {
      const imk = p.tekMotor.kapaklar.filter((c) => c.imKeysVar).length;
      gecen.push(`E) tek-motor sözleşmesi tamam: bookN yok, ${p.tekMotor.kapaklar.length}/` +
        `${p.tekMotor.kapaklar.length} kapağın içeriği yerinde, main.activation=` +
        `"${p.tekMotor.ana.activation}" key="${p.tekMotor.ana.key || ''}", imKeys ${imk} kapakta`);
    }
  }

  // --- D) manifest imzası (sözleşme G4, 2026-09-26) -------------------------
  // Güncelleyici imzasız manifesti REDDEDER; doğrulayacağı açık anahtar pakette
  // yoksa kanal çalışma anında KAPALI kalır — paket "kanallı" görünür ama ölüdür.
  if (harita) {
    const im = harita.imza;
    if (!im || typeof im !== 'object') {
      fail.push(`D) ${SET_DOSYA_ADI}'da imza alanı YOK — güncelleyici imzasız manifesti ` +
        'reddeder, açık anahtar olmadan kanal çalışma anında KAPALI');
    } else if (im.alg !== 'ed25519' || !ed25519AcikAnahtarMi(im.acikAnahtar)) {
      fail.push(`D) imza alanı geçersiz (alg=${im.alg}, anahtar ` +
        `${ed25519AcikAnahtarMi(im.acikAnahtar) ? 'geçerli' : 'ed25519 SPKI değil'})`);
    } else if (typeof p.setModulIcerik !== 'string') {
      olculemedi.push('D) güncelleyici modülünün içeriği okunamadı — imza doğrulaması ölçülemedi');
    } else if (!p.setModulIcerik.includes('manifestImzasiGecerliMi')) {
      fail.push(`D) ${SET_MODUL_ADI} imza DOĞRULAMASI taşımıyor — anahtar gömülü ama kullanılmıyor`);
    } else {
      gecen.push(`D) manifest imzası zorunlu: ed25519 açık anahtar gömülü (kaynak ${im.kaynak || '?'}), ` +
        `${SET_MODUL_ADI} doğruluyor`);
    }
  }

  // --- karar ---------------------------------------------------------------
  const kuyruk = olculemedi.length ? ` · ÖLÇÜLEMEYEN: ${olculemedi.join(' · ')}` : '';
  if (fail.length) return madde(NO, ad, FAIL, `${fail.join(' · ')}${kuyruk}`);
  if (olculemedi.length) return madde(NO, ad, OLCULEMEDI, olculemedi.join(' · '));
  return madde(NO, ad, PASS, gecen.join(' · '));
}

/** ed25519 SPKI DER base64 mi? (kapı kendi ölçer; üreticiye güvenmez) */
function ed25519AcikAnahtarMi(b64) {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(b64)) return false;
  try {
    const k = require('crypto').createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
    return k.asymmetricKeyType === 'ed25519';
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 9b. Windows sözleşmesi G1 (K kanalı açılabilir mi) + G2 (kurulum dizinine yazma yok)
// ---------------------------------------------------------------------------

const FS_SHIM_ADI = 'empp-fs-shim.js';
const FS_SHIM_WINDOWS_ISARETI = 'EMPP_FS_SHIM_WINDOWS_ETKIN';
const WORK_ISARETI = 'EMPP_WORK_DIR';

/** Açık ağaçtan G1/G2 kanıtı — okunamayan her şey null (ÖLÇÜLEMEDİ'ye gider, tahmin yok). */
function sozlesmeKanitiTopla(kok, yollar) {
  const oku = (g) => {
    try { return fs.readFileSync(path.join(kok, ...g.split('/')), 'utf8'); } catch (e) { return null; }
  };
  let admZip = null;
  const admPj = oku(`${ICERIK.ADM_ZIP_GORELI}/package.json`);
  if (admPj != null) {
    try {
      const pj = JSON.parse(admPj);
      const ana = pj.main || 'adm-zip.js';
      admZip = { surum: pj.version || '?', ana, anaVar: fs.existsSync(path.join(kok, ...ICERIK.ADM_ZIP_GORELI.split('/'), ana)) };
    } catch (e) {
      admZip = { surum: null, ana: null, anaVar: false };
    }
  }
  const modul = oku(ICERIK.MODUL_ADI);
  const shim = oku(FS_SHIM_ADI);
  const durumMetni = oku(ICERIK.DURUM_ADI);
  let durum = null;
  if (durumMetni != null) {
    try { durum = JSON.parse(durumMetni); } catch (e) { durum = { bozuk: true }; }
  }
  return {
    admZip,
    icerikModul: modul == null ? null : { win32Kapsamdisi: modul.includes('windows-kapsam-disi') },
    fsShim: shim == null ? null : {
      windowsEtkin: shim.includes(FS_SHIM_WINDOWS_ISARETI),
      win32Pasif: /platform\s*===\s*['"]win32['"]\s*\)\s*return null/.test(shim),
    },
    durum,
    storageIm: (yollar || []).filter((y) => /(^|\/)temp\/data\/storage\.im$/.test(y)),
  };
}

/**
 * Madde 14 (G1): K içerik kanalı Windows'ta AÇILABİLİR mi — adm-zip pakette ve
 * açma hedefi userData WORK (fs-shim Windows'ta etkin) mi?
 */
function maddeIcerikKanali(p = {}) {
  const NO = 14;
  const ad = 'K içerik kanalı açılabilir (adm-zip pakette + userData WORK yolu — G1)';
  const k = p.sozlesme;
  if (!p.asarOkundu || !k) return madde(NO, ad, OLCULEMEDI, 'uygulama ağacı okunamadı — K kanalı ölçülemedi');
  const fail = [];
  const gecen = [];
  if (!k.admZip) fail.push(`adm-zip YOK (${ICERIK.ADM_ZIP_GORELI}/package.json) — motorun window.require("adm-zip") çağrısı düşer`);
  else if (!k.admZip.anaVar) fail.push(`adm-zip paketi eksik: ${ICERIK.ADM_ZIP_GORELI}/${k.admZip.ana} yok`);
  else gecen.push(`adm-zip ${k.admZip.surum} (${ICERIK.ADM_ZIP_GORELI})`);
  if (!k.icerikModul) fail.push(`${ICERIK.MODUL_ADI} yok`);
  else if (k.icerikModul.win32Kapsamdisi) fail.push(`${ICERIK.MODUL_ADI} Windows'u hâlâ "kapsam dışı" sayıyor`);
  else gecen.push(`${ICERIK.MODUL_ADI} Windows'ta etkin`);
  if (typeof p.anaJs !== 'string' || !p.anaJs.includes(ICERIK.ISARET)) fail.push(`ana süreçte ${ICERIK.ISARET} bloğu yok`);
  else gecen.push(`ana süreçte ${ICERIK.ISARET}`);
  if (!k.fsShim) fail.push(`${FS_SHIM_ADI} yok — açma hedefi kurulum dizini olur`);
  else if (!k.fsShim.windowsEtkin || k.fsShim.win32Pasif) fail.push(`${FS_SHIM_ADI} Windows'ta PASİF — WORK yolu yok`);
  else gecen.push(`${FS_SHIM_ADI} Windows'ta etkin (${FS_SHIM_WINDOWS_ISARETI})`);
  if (!k.durum || k.durum.bozuk) fail.push(`${ICERIK.DURUM_ADI} okunamadı`);
  else if (!(k.durum.etkin && k.durum.etkin.windows === true)) fail.push(`${ICERIK.DURUM_ADI}: etkin.windows ≠ true`);
  else gecen.push(`${ICERIK.DURUM_ADI}: etkin.windows=true`);
  if (fail.length) return madde(NO, ad, FAIL, fail.join(' · ') + (gecen.length ? ` · (geçen: ${gecen.join(' · ')})` : ''));
  return madde(NO, ad, PASS, gecen.join(' · '));
}

/**
 * Madde 15 (G2): kullanıcı verisi kurulum dizinine GİTMEZ — kaynak storage.im pakette
 * yok, yazmalar userData/work'e (fs-shim Windows'ta etkin + ana süreç EMPP_WORK_DIR).
 */
function maddeKurulumDiziniYazma(p = {}) {
  const NO = 15;
  const ad = 'Kurulum dizinine kullanıcı verisi yazılmaz (storage.im pakette yok, WORK = userData — G2)';
  const k = p.sozlesme;
  if (!p.asarOkundu || !k) return madde(NO, ad, OLCULEMEDI, 'uygulama ağacı okunamadı — G2 ölçülemedi');
  const fail = [];
  const gecen = [];
  if (k.storageIm.length) fail.push(`kaynak kullanıcı verisi pakette: ${k.storageIm.slice(0, 6).join(', ')}`);
  else gecen.push('bookN/temp/data/storage.im pakette yok');
  if (!k.fsShim || !k.fsShim.windowsEtkin || k.fsShim.win32Pasif) fail.push(`${FS_SHIM_ADI} Windows'ta etkin değil — motor kurulum dizinine yazar`);
  else gecen.push(`${FS_SHIM_ADI} Windows'ta etkin`);
  if (typeof p.anaJs !== 'string' || !p.anaJs.includes(WORK_ISARETI)) fail.push(`ana süreç ${WORK_ISARETI} tanımlamıyor`);
  else gecen.push(`ana süreç ${WORK_ISARETI} = userData/work`);
  if (fail.length) return madde(NO, ad, FAIL, fail.join(' · '));
  return madde(NO, ad, PASS, gecen.join(' · '));
}

// ---------------------------------------------------------------------------
// 10. 7z ve çıkarım katmanı (I/O)
// ---------------------------------------------------------------------------

/**
 * NSIS yükünden çıkarılacak yollar.
 *
 * `resources/app` HEM asar'lı düzende (yoktur, eşleşmez) HEM `asar: false` düzeninde
 * (tüm uygulama ağacı) doğru davranır: `-r` ile 7z bu adı bir DİZİN girdisi olarak
 * eşleştirip ALTINDAKİ HER ŞEYİ açar. ÖLÇÜLDÜ (2026-09-21, 7z 17.05, sentetik yük):
 * `resources/app/{package.json,electron.js,version.txt,assets/book1/pages/1.png,
 * node_modules/x/i.js}` — 7 dosyanın 7'si çıktı. Bu yüzden `asar: false` kararı
 * çıkarım tarafında DEĞİŞİKLİK GEREKTİRMEDİ; sözleşme test 62'de çivilendi.
 */
const CIKARIM_DESENLERI = ['locales', 'resources/app.asar', 'resources/app', '*.exe'];

/**
 * 7z ikilisini PATH'te arar. Windows'ta `where` (yerel yol; birden çok satır → ilki). `which`
 * Windows'ta YOK ya da PortableGit'in msys `which`'i `/d/...` biçiminde yol döndürür — spawnSync
 * onu açamaz (windows-kasa ajanı, 2026-10-02). macOS/Linux davranışı aynen. `kos` testte sahtelenir.
 */
function yedizBul({ platform = process.platform, kos = spawnSync } = {}) {
  const arayici = platform === 'win32' ? 'where' : 'which';
  for (const ad of ['7z', '7zz', '7za', '7zr']) {
    const r = kos(arayici, [ad], { encoding: 'utf8' });
    const ilk = r && r.status === 0 ? String(r.stdout || '').split(/\r?\n/).map((x) => x.trim()).find(Boolean) : '';
    if (ilk) return ilk;
  }
  return null;
}

/** `7z l -slt` çıktısından girdi adlarını ayıklar. Saf. */
function yedizListeCoz(stdout) {
  const adlar = [];
  for (const satir of String(stdout || '').split('\n')) {
    const m = satir.match(/^Path\s*=\s*(.+?)\s*$/);
    if (m) adlar.push(m[1]);
  }
  // İlk "Path =" arşivin kendi yolu olur; onu düşürmek çağırana bırakılmaz.
  return adlar.length > 1 ? adlar.slice(1) : adlar;
}

/**
 * NSIS yükünü (app-32.7z / app-64.7z) girdi listesinden seçer. Saf.
 *
 * TAM ARŞİV YOLU döner, basename DEĞİL. electron-builder yükü `$PLUGINSDIR/app-32.7z`
 * altına koyar; basename'e kırpmak 7z'ye kök seviyesinde eşleşmeyen bir desen verir,
 * `7z x` hiçbir şey çıkarmadan ÇIKIŞ 0 döner ve ağaç ölçümlerinin tamamı sessizce
 * ÖLÇÜLEMEDİ'ye düşer (2026-09-21, SM4 1,24 GB paketinde ölçüldü).
 */
function yukSec(adlar) {
  const aday = (adlar || []).filter((a) => /(^|[\\/])app-(32|64|arm64)\.7z$/i.test(a));
  if (!aday.length) return null;
  return aday[0];
}

/** Arşiv içi yolu yerel dosya sistemi yoluna çevirir (ters bölü → path.sep). Saf. */
function arsivYolunuYerelYap(kok, arsivYolu) {
  const parcalar = String(arsivYolu || '').split(/[\\/]/).filter((p) => p && p !== '.');
  return path.join(kok, ...parcalar);
}

function calistir(komut, argumanlar, secenek = {}) {
  return spawnSync(komut, argumanlar, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...secenek
  });
}

// ---------------------------------------------------------------------------
// 11. Ağaç okuma → ölçüm girdileri
// ---------------------------------------------------------------------------

function guvenliListe(dizin) {
  try {
    return fs.readdirSync(dizin);
  } catch (e) {
    return null;
  }
}

/** Bir dizin ağacını göreli yol listesine çevirir (derinlik sınırlı). */
function agacYollari(kok, azamiDerinlik = 6) {
  const cikti = [];
  const gez = (dizin, onek, derinlik) => {
    if (derinlik > azamiDerinlik) return;
    let girdiler;
    try {
      girdiler = fs.readdirSync(dizin, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const g of girdiler) {
      const yol = onek ? `${onek}/${g.name}` : g.name;
      if (g.isDirectory()) gez(path.join(dizin, g.name), yol, derinlik + 1);
      else cikti.push(yol);
    }
  };
  gez(kok, '', 0);
  return cikti;
}

/**
 * Açık bir uygulama ağacının BOYUT + DOSYA SAYISI + sayfa görselleri ölçümü.
 *
 * NEDEN (2026-09-21): `asar: false` düzeninde uygulama içeriği tek bir `app.asar`
 * DOSYASI değil, `resources/app/` altında düz bir AĞAÇ. Madde 12'nin sorusu
 * ("paket gerçek içerik taşıyor mu") her iki düzende de aynıdır; yalnız ölçülecek
 * KAP değişir. Bu fonksiyon o kabı asar başlığıyla AYNI iki sayıya indirger:
 * toplam bayt + girdi sayısı. Ölçmeden PASS üretmemek için stat edilemeyen dosya
 * sayıma GİRMEZ (şüphede eksik say, asla fazla).
 *
 * Derinlik tavanı asar tarafıyla simetri için geniş (16) tutuldu; `agacYollari`'nın
 * 6'lık tavanı yalnız yol listeleri içindir ve DEĞİŞTİRİLMEDİ.
 */
function agacOlcusu(kok, azamiDerinlik = 16) {
  const olcum = { baytlar: 0, dosyaSayisi: 0, sayfalar: [], okunamayan: 0 };
  const gez = (dizin, onek, derinlik) => {
    if (derinlik > azamiDerinlik) return;
    let girdiler;
    try {
      girdiler = fs.readdirSync(dizin, { withFileTypes: true });
    } catch (e) {
      olcum.okunamayan++;
      return;
    }
    for (const g of girdiler) {
      const yol = onek ? `${onek}/${g.name}` : g.name;
      const tam = path.join(dizin, g.name);
      if (g.isDirectory()) {
        gez(tam, yol, derinlik + 1);
        continue;
      }
      if (g.isSymbolicLink()) continue; // bağ hedefi zaten ayrıca sayılır/sayılmaz
      let st;
      try {
        st = fs.statSync(tam);
      } catch (e) {
        olcum.okunamayan++;
        continue;
      }
      if (!st.isFile()) continue;
      olcum.baytlar += st.size;
      olcum.dosyaSayisi++;
      if (/(^|\/)pages\/[^/]+\.(png|webp|jpg)$/i.test(yol)) olcum.sayfalar.push(yol);
    }
  };
  gez(kok, '', 0);
  return olcum;
}

function enBuyukExe(dizin) {
  const adlar = guvenliListe(dizin);
  if (!adlar) return null;
  let en = null;
  for (const a of adlar) {
    if (!/\.exe$/i.test(a)) continue;
    const tam = path.join(dizin, a);
    let st;
    try {
      st = fs.statSync(tam);
    } catch (e) {
      continue;
    }
    if (!st.isFile()) continue;
    if (!en || st.size > en.boyut) en = { yol: tam, boyut: st.size };
  }
  return en;
}

/** Uygulama ağacından ölçüm girdilerini toplar. */
function agactanTopla(kok, secenek = {}) {
  const ornekAdet = secenek.ornekAdet || 12;
  const sonuc = {
    kok,
    icPe: null,
    ikonKareleri: [],
    ikonKaynak: 'yok',
    pakAdlari: null,
    anaJs: null,
    anaJsYolu: null,
    anaJsDizini: null,
    // Giriş dosyası kararının kaynağı — TEK KAYNAK (girisDosyasiCoz). Görünür
    // kılınması ŞART: "package.json" mı sabit listeye mi düşüldü.
    girisKaynagi: null,
    girisDusmeNotu: null,
    setBulundu: false,
    setMetin: null,
    setNerede: null,
    setModulYollari: null,
    setModulIcerik: null,
    tekMotor: null,
    sozlesme: null,
    asarOkundu: false,
    // Uygulama içeriğinin KABI: 'app.asar' (asar açık) | 'resources/app' (asar kapalı)
    // | null (hiçbiri bulunamadı). Madde 12 ölçümünü hangi kaptan aldığını söyler.
    icerikKabi: null,
    asarBoyut: null,
    asarGirdiSayisi: null,
    surumBulundu: false,
    surumMetni: null,
    surumNerede: null,
    sayfaSiniflari: [],
    onGetirme: null,
    notlar: []
  };

  // İç uygulama exe'si — mimari ve ikon kaynağı.
  const exe = enBuyukExe(kok);
  if (exe) {
    // SEYREK TAMPON. Eski sürüm sabit 64 MB tavan okuyor ve yorumda "64 MB tavan
    // yeterli" yazıyordu; SM4'ün 139,6 MB'lık uygulama exe'sinde `.rsrc` HAM OFSETİ
    // 141.445.120 çıktı — tamponun tamamen dışında. Madde 2 bu yüzden gerçek her
    // pakette kalıcı olarak kör kalıyordu. Artık .rsrc bölüm tablosundan bulunur ve
    // yalnız başlıklar + o pencere doldurulur; aradaki .text/.rdata diskten OKUNMAZ.
    const fd = fs.openSync(exe.yol, 'r');
    let buf;
    try {
      const bas = Buffer.alloc(Math.min(exe.boyut, 64 * 1024));
      fs.readSync(fd, bas, 0, bas.length, 0);
      sonuc.icPe = peMakineOku(bas);
      const aralik = peRsrcAralik(bas);
      if (!aralik.ok) {
        sonuc.notlar.push(`exe .rsrc aralığı bulunamadı: ${aralik.sebep}`);
        buf = bas;
      } else {
        const son = Math.min(exe.boyut, aralik.ofset + aralik.boy);
        buf = Buffer.alloc(son);
        bas.copy(buf, 0);
        if (aralik.ofset < son) {
          fs.readSync(fd, buf, aralik.ofset, son - aralik.ofset, aralik.ofset);
        }
      }
    } finally {
      fs.closeSync(fd);
    }
    const ikon = peKaynakIkonlari(buf);
    if (ikon.ok) {
      sonuc.ikonKareleri = ikon.kareler;
      sonuc.ikonKaynak = `${path.basename(exe.yol)} (.rsrc RT_ICON)`;
    } else {
      sonuc.notlar.push(`exe ikon kaynağı okunamadı: ${ikon.sebep}`);
    }
  } else {
    sonuc.notlar.push('uygulama ağacında .exe bulunamadı');
  }

  // Yedek ikon kaynağı: ağaçta duran bir .ico.
  if (!sonuc.ikonKareleri.length) {
    for (const aday of ['icon.ico', 'app.ico', path.join('resources', 'icon.ico')]) {
      const tam = path.join(kok, aday);
      if (fs.existsSync(tam)) {
        const kareler = icoKareleri(fs.readFileSync(tam));
        if (kareler.length) {
          sonuc.ikonKareleri = kareler;
          sonuc.ikonKaynak = aday;
          break;
        }
      }
    }
  }

  // Dil paketleri.
  const locales = guvenliListe(path.join(kok, 'locales'));
  if (locales) sonuc.pakAdlari = locales.filter((a) => /\.pak$/i.test(a));

  // Uygulama içeriği: app.asar ya da açılmış resources/app dizini.
  const asarYolu = path.join(kok, 'resources', 'app.asar');
  const acikApp = path.join(kok, 'resources', 'app');
  if (fs.existsSync(asarYolu)) {
    const st = fs.statSync(asarYolu);
    sonuc.icerikKabi = 'app.asar';
    sonuc.asarBoyut = st.size;
    const fd = fs.openSync(asarYolu, 'r');
    try {
      const bas = Buffer.alloc(Math.min(st.size, 16 * 1024 * 1024));
      fs.readSync(fd, bas, 0, bas.length, 0);
      const coz = asarBaslikCoz(bas);
      if (!coz.ok) {
        sonuc.notlar.push(`app.asar başlığı çözülemedi: ${coz.sebep}`);
      } else {
        const girdiler = asarYollariniDuzle(coz.baslik);
        sonuc.asarOkundu = true;
        sonuc.asarGirdiSayisi = girdiler.length;

        const surum = asarYolBul(girdiler, 'version.txt');
        if (surum) {
          sonuc.surumBulundu = true;
          const b = asarGirdiOku(fd, coz.veriOfseti, surum, 4096);
          sonuc.surumMetni = b ? b.toString('utf8') : null;
          sonuc.surumNerede = `app.asar:${surum.yol}`;
        }

        let anaAd = null;
        const pj = asarYolBul(girdiler, 'package.json');
        if (pj) {
          try {
            const b = asarGirdiOku(fd, coz.veriOfseti, pj, 256 * 1024);
            anaAd = JSON.parse(b.toString('utf8')).main;
          } catch (e) { /* main alanı yoksa girisDosyasiCoz sabit listeye düşer */ }
        }
        const girisSecim = girisDosyasiCoz(anaAd, (ad) => !!asarYolBul(girdiler, ad));
        sonuc.girisKaynagi = girisSecim.kaynak;
        sonuc.girisDusmeNotu = girisSecim.not || null;
        if (girisSecim.ad) {
          const g = asarYolBul(girdiler, girisSecim.ad);
          if (g) {
            const b = asarGirdiOku(fd, coz.veriOfseti, g, 8 * 1024 * 1024);
            sonuc.anaJs = b ? b.toString('utf8') : null;
            sonuc.anaJsYolu = `app.asar:${g.yol}`;
            sonuc.anaJsDizini = yolDizini(g.yol);
          }
        }
        if (girisSecim.not) sonuc.notlar.push(`giriş dosyası: ${girisSecim.not}`);

        // SET güncelleme kanalı (karar #11) — yalnız pakette duranı ölçer.
        const setG = asarYolBul(girdiler, SET_DOSYA_ADI);
        if (setG) {
          sonuc.setBulundu = true;
          const b = asarGirdiOku(fd, coz.veriOfseti, setG, 4 * 1024 * 1024);
          // b === null → girdi "unpacked" (ofset yok): okunamadı, BOŞ DEĞİL.
          sonuc.setMetin = b ? b.toString('utf8') : null;
          sonuc.setNerede = `app.asar:${setG.yol}`;
        }
        sonuc.setModulYollari = girdiler
          .filter((g) => g.yol === SET_MODUL_ADI || g.yol.endsWith(`/${SET_MODUL_ADI}`))
          .map((g) => g.yol);
        const modulG = asarYolBul(girdiler, SET_MODUL_ADI);
        if (modulG) {
          const mb = asarGirdiOku(fd, coz.veriOfseti, modulG, 8 * 1024 * 1024);
          sonuc.setModulIcerik = mb ? mb.toString('utf8') : null;
        }

        {
          const menuG = girdiler.find((g) => g.yol === TEK_MOTOR_MENU);
          const isaretG = girdiler.find((g) => g.yol === TEK_MOTOR_ISARET_ADI);
          const mb = menuG ? asarGirdiOku(fd, coz.veriOfseti, menuG, 8 * 1024 * 1024) : null;
          const ib = isaretG ? asarGirdiOku(fd, coz.veriOfseti, isaretG, 64 * 1024) : null;
          sonuc.tekMotor = tekMotorKanitiTopla({
            yollar: girdiler.map((g) => g.yol), menuHam: mb,
            isaretMetin: ib ? ib.toString('utf8') : null,
          });
        }
        const kokler = kitapKokleri(girdiler.map((g) => g.yol));
        const isaretli = [];
        for (const k of kokler) {
          const hedef = k ? `${k}/index.html` : 'index.html';
          const g = girdiler.find((x) => x.yol === hedef);
          const b = g ? asarGirdiOku(fd, coz.veriOfseti, g, 4 * 1024 * 1024) : null;
          if (b && b.toString('utf8').includes(ISARET_ON_GETIRME)) isaretli.push(k);
        }
        sonuc.onGetirme = { kokler, isaretli };

        const sayfalar = girdiler.filter((g) => /(^|\/)pages\/[^/]+\.(png|webp|jpg)$/i.test(g.yol));
        const adim = Math.max(1, Math.floor(sayfalar.length / ornekAdet));
        for (let i = 0; i < sayfalar.length && sonuc.sayfaSiniflari.length < ornekAdet; i += adim) {
          const b = asarGirdiOku(fd, coz.veriOfseti, sayfalar[i], 64);
          if (b) sonuc.sayfaSiniflari.push(sayfaSinifi(b));
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } else if (fs.existsSync(acikApp)) {
    sonuc.asarOkundu = true;
    sonuc.icerikKabi = 'resources/app';
    sonuc.notlar.push('app.asar yok, açık resources/app dizini okundu (asar: false düzeni)');

    // MADDE 12'NİN KABI (2026-09-21): `asar: false` düzeninde uygulama içeriği
    // `resources/app/` ağacıdır. Boyut + girdi sayısı asar başlığıyla AYNI iki sayıya
    // indirgenir ki madde 12 bu düzende körleşmesin. "app.asar yok → ÖLÇÜLEMEDİ"
    // demek, BOŞ bir resources/app ağacını da ölçülemez sayardı — sahte-yeşilin
    // diğer yüzü. Sayfa görselleri de burada örneklenir; yoksa madde 9 (WebP kapısı)
    // bu düzende sessizce körleşirdi.
    const olcum = agacOlcusu(acikApp);
    sonuc.asarBoyut = olcum.baytlar;
    sonuc.asarGirdiSayisi = olcum.dosyaSayisi;
    if (olcum.okunamayan) {
      sonuc.notlar.push(`resources/app altında ${olcum.okunamayan} girdi okunamadı — sayım EKSİK olabilir`);
    }
    {
      const adim = Math.max(1, Math.floor(olcum.sayfalar.length / ornekAdet));
      for (let i = 0; i < olcum.sayfalar.length && sonuc.sayfaSiniflari.length < ornekAdet; i += adim) {
        try {
          const fd2 = fs.openSync(path.join(acikApp, olcum.sayfalar[i]), 'r');
          try {
            const b = Buffer.alloc(64);
            const okunan = fs.readSync(fd2, b, 0, 64, 0);
            if (okunan > 0) sonuc.sayfaSiniflari.push(sayfaSinifi(b.subarray(0, okunan)));
          } finally {
            fs.closeSync(fd2);
          }
        } catch (e) { /* okunamayan örnek atlanır, tahmin üretilmez */ }
      }
    }
    const surumYolu = path.join(acikApp, 'version.txt');
    if (fs.existsSync(surumYolu)) {
      sonuc.surumBulundu = true;
      sonuc.surumMetni = fs.readFileSync(surumYolu, 'utf8');
      sonuc.surumNerede = 'resources/app/version.txt';
    }
    // GİRİŞ DOSYASI — TEK KAYNAK (girisDosyasiCoz). Eskiden burada doğrudan
    // sabit ['electron.js','main.js'] listesi denenirdi ve package.json.main
    // HİÇ okunmazdı — asar dalıyla aynı fonksiyonu paylaşarak bu ayrışma kapatıldı.
    let acikAnaAd = null;
    const acikPjYolu = path.join(acikApp, 'package.json');
    if (fs.existsSync(acikPjYolu)) {
      try {
        acikAnaAd = JSON.parse(fs.readFileSync(acikPjYolu, 'utf8')).main;
      } catch (e) { /* main alanı yoksa/bozuksa girisDosyasiCoz sabit listeye düşer */ }
    }
    const acikGirisSecim = girisDosyasiCoz(acikAnaAd,
      (ad) => fs.existsSync(path.join(acikApp, ad)));
    sonuc.girisKaynagi = acikGirisSecim.kaynak;
    sonuc.girisDusmeNotu = acikGirisSecim.not || null;
    if (acikGirisSecim.ad) {
      const t = path.join(acikApp, acikGirisSecim.ad);
      try {
        sonuc.anaJs = fs.readFileSync(t, 'utf8');
        sonuc.anaJsYolu = `resources/app/${acikGirisSecim.ad}`;
        sonuc.anaJsDizini = '';
      } catch (e) {
        sonuc.notlar.push(
          `giriş dosyası "${acikGirisSecim.ad}" bulundu ama okunamadı: ${e.message}`);
      }
    }
    if (acikGirisSecim.not) sonuc.notlar.push(`giriş dosyası: ${acikGirisSecim.not}`);
    const yollar = agacYollari(acikApp);

    // SET güncelleme kanalı (karar #11) — açık ağaç yolu.
    const setYolu = path.join(acikApp, SET_DOSYA_ADI);
    if (fs.existsSync(setYolu)) {
      sonuc.setBulundu = true;
      try {
        sonuc.setMetin = fs.readFileSync(setYolu, 'utf8');
      } catch (e) {
        sonuc.setMetin = null; // okunamadı — boş DEĞİL
      }
      sonuc.setNerede = `resources/app/${SET_DOSYA_ADI}`;
    }
    sonuc.setModulYollari = yollar
      .filter((y) => y === SET_MODUL_ADI || y.endsWith(`/${SET_MODUL_ADI}`));
    if (sonuc.setModulYollari.includes(SET_MODUL_ADI)) {
      try {
        sonuc.setModulIcerik = fs.readFileSync(path.join(acikApp, SET_MODUL_ADI), 'utf8');
      } catch (e) { sonuc.setModulIcerik = null; }
    }
    sonuc.sozlesme = sozlesmeKanitiTopla(acikApp, yollar);
    {
      const oku = (g) => { try { return fs.readFileSync(path.join(acikApp, ...g.split('/'))); } catch (e) { return null; } };
      const ib = yollar.includes(TEK_MOTOR_ISARET_ADI) ? oku(TEK_MOTOR_ISARET_ADI) : null;
      sonuc.tekMotor = tekMotorKanitiTopla({
        yollar, menuHam: yollar.includes(TEK_MOTOR_MENU) ? oku(TEK_MOTOR_MENU) : null,
        isaretMetin: ib ? ib.toString('utf8') : null,
      });
    }
    const kokler = kitapKokleri(yollar);
    const isaretli = [];
    for (const k of kokler) {
      const hedef = path.join(acikApp, ...(k ? k.split('/') : []), 'index.html');
      try {
        if (fs.readFileSync(hedef, 'utf8').includes(ISARET_ON_GETIRME)) isaretli.push(k);
      } catch (e) { /* okunamayan index.html işaretsiz sayılır, tahmin üretilmez */ }
    }
    sonuc.onGetirme = { kokler, isaretli };
  } else {
    sonuc.notlar.push('resources/app.asar da resources/app da yok');
  }

  return sonuc;
}

/**
 * Madde 12 — uygulama içeriği boyut+içerik kapısı.
 *
 * KARAR (2026-09-21, `asar: false` düzeni için): bu madde GEÇERLİDİR ve GEÇMELİDİR.
 * Maddenin adı "Uygulama içeriği", "app.asar var mı" DEĞİL. Sorduğu soru — "paket
 * gerçek içerik taşıyor mu" — her iki düzende de aynıdır; değişen yalnız KAP:
 *   · asar açık  → `resources/app.asar` (boyut = dosya boyu, girdi = asar başlığı)
 *   · asar kapalı→ `resources/app/`     (boyut = ağaç toplamı, girdi = dosya sayısı)
 * Üçüncü bir seçenek yok: iki kap da yoksa ÖLÇÜLEMEDİ (yokluk, PASS değil).
 *
 * NEDEN "ÖLÇÜLEMEDİ" DEĞİL: `asar: false` düzeninde maddeyi ÖLÇÜLEMEDİ'ye bağlamak,
 * BOŞ bir `resources/app` ağacını da ölçülemez sayardı — yani kapı, tam da yakalaması
 * gereken arızaya (içeriksiz paket) kör olurdu. Kabın adı detayda AÇIKÇA yazılır ki
 * rapora bakan hangi düzeni ölçtüğümüzü görsün.
 */
function maddeAsar(toplam) {
  const kap = toplam.icerikKabi;
  if (!kap) {
    return madde(12, 'Uygulama içeriği (boyut VE içerik birlikte)', OLCULEMEDI,
      'ne resources/app.asar ne de resources/app bulundu — içerik kabı yok');
  }
  const ad = kap === 'app.asar' ? 'resources/app.asar' : 'resources/app/ (asar: false)';
  const birim = kap === 'app.asar' ? 'girdi' : 'dosya';
  const k = boyutIcerikKapisi({
    ad,
    boyut: toplam.asarBoyut,
    asgariBoyut: 64 * 1024,
    icerikVar: toplam.asarGirdiSayisi === null ? null : toplam.asarGirdiSayisi > 0,
    icerikAciklama: `${toplam.asarGirdiSayisi} ${birim}`
  });
  return madde(12, 'Uygulama içeriği (boyut VE içerik birlikte)', k.durum, k.detay);
}

// ---------------------------------------------------------------------------
// 12. Ana akış
// ---------------------------------------------------------------------------

function argumanCoz(argv) {
  const s = { exe: null, cikarim: null, tut: false, gevsek: false, json: false, ornekAdet: 12 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cikarim') s.cikarim = argv[++i];
    else if (a === '--tut') s.tut = true;
    else if (a === '--gevsek') s.gevsek = true;
    else if (a === '--json') s.json = true;
    else if (a === '--ornek') s.ornekAdet = parseInt(argv[++i], 10) || 12;
    else if (!a.startsWith('-') && !s.exe) s.exe = a;
  }
  return s;
}

function cikar(exeYolu, gecici, yaz) {
  const yediz = yedizBul();
  if (!yediz) {
    return { ok: false, sebep: '7z/7za/7zz/7zr sistemde yok — NSIS gövdesi açılamadı' };
  }
  yaz(`  7z: ${yediz}`);
  const liste = calistir(yediz, ['l', '-slt', exeYolu]);
  if (liste.status !== 0) {
    return { ok: false, sebep: `7z listeleyemedi: ${(liste.stderr || '').slice(-200)}` };
  }
  const adlar = yedizListeCoz(liste.stdout);
  const yuk = yukSec(adlar);
  if (!yuk) {
    const s2 = `NSIS içinde app-*.7z yükü bulunamadı (${adlar.length} girdi)`;
    return { ok: false, sebep: s2, adlar };
  }
  yaz(`  yük: ${yuk} — açılıyor (büyük dosya, sürebilir)`);
  const d1 = path.join(gecici, 'nsis');
  const r1 = calistir(yediz, ['x', '-y', `-o${d1}`, exeYolu, yuk]);
  if (r1.status !== 0) {
    return { ok: false, sebep: `yük açılamadı: ${(r1.stderr || '').slice(-200)}`, adlar };
  }
  const yukYolu = arsivYolunuYerelYap(d1, yuk);
  // 7z, eşleşmeyen bir desende HİÇBİR ŞEY ÇIKARMADAN çıkış 0 döner. Bu yüzden
  // "status 0" başarı kanıtı değildir; dosyanın gerçekten üretildiği ölçülür.
  if (!fs.existsSync(yukYolu)) {
    return {
      ok: false,
      sebep: `7z çıkış 0 verdi ama yük ÜRETİLMEDİ: arşivdeki "${yuk}" deseni hiçbir ` +
        `girdiyle eşleşmemiş olabilir (beklenen dosya: ${yukYolu})`,
      adlar,
      yuk
    };
  }
  const d2 = path.join(gecici, 'app');
  const r2 = calistir(yediz, ['x', '-y', `-o${d2}`, yukYolu, ...CIKARIM_DESENLERI, '-r']);
  if (r2.status !== 0) {
    const s2 = `uygulama ağacı açılamadı: ${(r2.stderr || '').slice(-200)}`;
    return { ok: false, sebep: s2, adlar, yuk };
  }
  return { ok: true, kok: d2, adlar, yuk };
}

function calis(argv, yazici) {
  const yaz = yazici || ((s) => process.stdout.write(`${s}\n`));
  const s = argumanCoz(argv);
  if (!s.exe) {
    yaz('Kullanım: node scripts/windows-paket-kapisi.js <paket.exe> ' +
      '[--cikarim <dizin>] [--tut] [--gevsek] [--json] [--ornek <n>]');
    return { kod: 2, maddeler: [] };
  }
  if (!fs.existsSync(s.exe)) {
    yaz(`HATA: dosya yok — ${s.exe}`);
    return { kod: 2, maddeler: [] };
  }

  const st = fs.statSync(s.exe);
  yaz(`Paket: ${s.exe}`);
  yaz(`Boyut: ${st.size.toLocaleString('tr-TR')} bayt`);

  const maddeler = [];

  // Dış PE — kanıt DEĞİL, yalnız bağlam. NSIS firstheader ise GERÇEK bir ölçümdür
  // ve PE imajının hemen ardında durur (SM4'te ofset 397.312) — 16 MB pencere bol.
  const basTavan = Math.min(st.size, 16 * 1024 * 1024);
  const basBuf = Buffer.alloc(basTavan);
  const fd0 = fs.openSync(s.exe, 'r');
  fs.readSync(fd0, basBuf, 0, basTavan, 0);
  fs.closeSync(fd0);
  const disPe = peMakineOku(basBuf);
  const ilkBaslik = nsisIlkBaslik(basBuf, st.size);

  // NSIS korpusu — ham bayt taraması (ASCII + UTF-16LE).
  yaz('NSIS korpusu taranıyor…');
  const tarama = dosyadaAra(s.exe, NSIS_KELIMELER);
  const bulunan = tarama.bulunan;
  yaz(`  korpus bulgusu: ${bulunan.size}/${NSIS_KELIMELER.length} kelime`);

  // Çıkarım.
  let gecici = null;
  let cikarimSonuc = { ok: false, sebep: 'çıkarım denenmedi' };
  if (s.cikarim) {
    if (fs.existsSync(s.cikarim)) cikarimSonuc = { ok: true, kok: s.cikarim };
    else cikarimSonuc = { ok: false, sebep: `--cikarim dizini yok: ${s.cikarim}` };
  } else {
    gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-kapi-'));
    yaz(`Çıkarım: ${gecici}`);
    cikarimSonuc = cikar(s.exe, gecici, yaz);
  }

  let toplam = null;
  if (cikarimSonuc.ok) {
    toplam = agactanTopla(cikarimSonuc.kok, { ornekAdet: s.ornekAdet });
    for (const n of toplam.notlar) yaz(`  not: ${n}`);
  } else {
    yaz(`  ÇIKARIM YAPILAMADI: ${cikarimSonuc.sebep}`);
  }

  maddeler.push(mimariKarar({
    icPe: toplam ? toplam.icPe : null,
    yukAdi: cikarimSonuc.yuk || null,
    disPe
  }));
  maddeler.push(maddeIkon(
    toplam ? toplam.ikonKareleri : [],
    toplam ? toplam.ikonKaynak : 'çıkarım yok'));
  maddeler.push(maddeKuruluysaAc());
  maddeler.push(maddeOnTarama(ilkBaslik));
  maddeler.push(maddeSahteIlerleme(bulunan));
  maddeler.push(maddeDiller(toplam ? toplam.pakAdlari : null));
  maddeler.push(maddeAcilisYamasi(toplam ? toplam.anaJs : null));
  maddeler.push(maddeGuncellemeOteleme(toplam ? toplam.anaJs : null));
  maddeler.push(maddeWebp(toplam ? toplam.sayfaSiniflari : []));
  maddeler.push(maddeOnIsitma(toplam ? toplam.onGetirme : null));
  maddeler.push(maddeSurum({
    asarOkundu: !!(toplam && toplam.asarOkundu),
    bulundu: !!(toplam && toplam.surumBulundu),
    metin: toplam ? toplam.surumMetni : null,
    nerede: toplam ? toplam.surumNerede : null,
    anaJs: toplam ? toplam.anaJs : null
  }));
  maddeler.push(maddeAsar(toplam || { icerikKabi: null, asarBoyut: null, asarGirdiSayisi: null }));
  maddeler.push(maddeSetGuncelleme({
    asarOkundu: !!(toplam && toplam.asarOkundu),
    setBulundu: !!(toplam && toplam.setBulundu),
    setMetin: toplam ? toplam.setMetin : null,
    setNerede: toplam ? toplam.setNerede : null,
    anaJs: toplam ? toplam.anaJs : null,
    anaJsYolu: toplam ? toplam.anaJsYolu : null,
    anaJsDizini: toplam ? toplam.anaJsDizini : null,
    setModulYollari: toplam ? toplam.setModulYollari : null,
    setModulIcerik: toplam ? toplam.setModulIcerik : null,
    tekMotor: toplam ? toplam.tekMotor : null
  }));
  const sozlesmeGirdi = {
    asarOkundu: !!(toplam && toplam.asarOkundu),
    sozlesme: toplam ? toplam.sozlesme : null,
    anaJs: toplam ? toplam.anaJs : null
  };
  maddeler.push(maddeIcerikKanali(sozlesmeGirdi));
  maddeler.push(maddeKurulumDiziniYazma(sozlesmeGirdi));

  maddeler.sort((a, b) => a.no - b.no);
  const kod = cikisKodu(maddeler, { gevsek: s.gevsek });

  if (s.json) {
    yaz(JSON.stringify({ paket: s.exe, boyut: st.size, maddeler, kod }, null, 2));
  } else {
    yaz('');
    for (const m of maddeler) {
      yaz(`[${String(m.no).padStart(2, ' ')}] ${m.durum.padEnd(11, ' ')} ${m.ad}`);
      yaz(`                 ${m.detay}`);
    }
    yaz('');
    yaz(ozetSatiri(maddeler, kod));
  }

  if (gecici && !s.tut) {
    try {
      fs.rmSync(gecici, { recursive: true, force: true });
    } catch (e) { /* geçici dizin temizliği kapıyı düşürmez */ }
  } else if (gecici) {
    yaz(`(geçici dizin tutuldu: ${gecici})`);
  }

  return { kod, maddeler };
}

module.exports = {
  PASS, FAIL, OLCULEMEDI, RAPOR, madde, cikisKodu, ozetSatiri,
  MAKINE_IA32, MAKINE_X64, MAKINE_ARM64,
  peMakineOku, yukAdindanMimari, mimariKarar,
  pngCoz, pngKoseAlfa, dibKoseAlfa, kareKoseAlfa, icoKareleri, peRsrcAralik,
  peKaynakIkonlari, maddeIkon,
  aramaDesenleri, parcadaAra, dosyadaAra, maddeYokluk,
  NSIS_KELIMELER, NSIS_CAPALAR, nsisIlkBaslik, FH_FLAGS_NO_CRC, FH_FLAGS_FORCE_CRC,
  maddeKuruluysaAc, maddeOnTarama, maddeSahteIlerleme,
  boyutIcerikKapisi,
  asarBaslikCoz, asarYollariniDuzle, asarYolBul,
  SURUM_GEREKLI_PARCA, surumParcalari, maddeSurum,
  BEKLENEN_DILLER, maddeDiller,
  maddeAcilisYamasi, maddeGuncellemeOteleme, maddeOnIsitma,
  GIRIS_ADAYLARI_VARSAYILAN, girisDosyasiCoz,
  mod1, sayfaSinifi, maddeWebp, kitapKokleri, agacYollari, agacOlcusu,
  SET_DOSYA_ADI, SET_MODUL_ADI, ISARET_SET_GUNCELLEME,
  SET_KABUK, SET_KABUK_DIZINLERI, SET_KABUK_IMZASI,
  yolDizini, setHaritasiCoz, kabukSizintilari, setHaritasiKusurlari, maddeSetGuncelleme,
  tekMotorKanitiTopla, tekMotorMu, tekMotorKusurlari,
  ed25519AcikAnahtarMi, sozlesmeKanitiTopla, maddeIcerikKanali, maddeKurulumDiziniYazma,
  yedizBul, yedizListeCoz, yukSec, arsivYolunuYerelYap, CIKARIM_DESENLERI, cikar, argumanCoz,
  agactanTopla, maddeAsar, calis
};

if (require.main === module) {
  const { kod } = calis(process.argv.slice(2));
  process.exit(kod);
}
