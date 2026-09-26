'use strict';

/**
 * Sentinel testleri için TEK okuyucu: `packagingService.js` kaynağındaki platform
 * config'lerinin `files` dizisini METİN olarak bulur ve electron-builder'a gidecek
 * GERÇEK desen dizisine çözer (string literal'ler + `...paketDisiListe.
 * elektronBuilderDesenleri('<platform>')` yayılımları, kaynaktaki sırayla).
 *
 * NEDEN AYRI DOSYA: dört test dosyası (windows-asarsiz, windows-sozlesme-baglanti,
 * icerik-guncelleme, paket-disi-liste) aynı diziyi okuyor. Her biri kendi regex'ini
 * yazarsa liste modüle taşındığında biri sessizce yalnız literal'leri görür ve
 * "dışlama yok" sanar (fan-out sapması — bu kez testlerde).
 *
 * TANIMADIĞI bir yayılım (`...baskaBirSey`) görürse FIRLATIR: okuyucu kör kalıp
 * eksik dizi döndürmesin. Yalnız test kodu kullanır; paketleme yolunda require
 * edilmez (`.test.js` ile bitmediği için test koşucusu da onu test saymaz).
 */

const fs = require('fs');
const path = require('path');
const paketDisiListe = require('./paket-disi-liste');

const CANLI = path.join(__dirname, 'packagingService.js');
const ISARETLER = Object.freeze({
  windows: 'async packageWindows(',
  macos: 'async packageMacOS(',
  linux: 'async packageLinux(',
  android: 'async packageAndroid(',
});

/** Yalnız TAM satır `//` yorumlarını atar (blok-yorum regex'i `"**\/*"`i yutuyordu). */
function yorumsuz(src) {
  return src.replace(/^\s*\/\/.*$/gm, '');
}

/** Kaynağı platform gövdelerine böler; işaret bulunamazsa FIRLATIR. */
function platformBloklari(src = fs.readFileSync(CANLI, 'utf8')) {
  const sirali = Object.entries(ISARETLER).map(([ad, im]) => {
    const i = src.indexOf(im);
    if (i === -1) throw new Error(`sentinel köreldi: ${im} bulunamadı`);
    return [ad, i];
  }).sort((a, b) => a[1] - b[1]);
  const out = {};
  sirali.forEach(([ad, i], k) => {
    const son = k + 1 < sirali.length ? sirali[k + 1][1] : src.indexOf('\n  async ', i + 10);
    out[ad] = src.slice(i, son > i ? son : undefined);
  });
  return out;
}

/** Bir gövdedeki `files: [ … ]` bloğunun HAM metni (yorumlar dahil) ya da null. */
function filesBlokMetni(govde) {
  const m = govde.match(/files:\s*\[([\s\S]*?)\n\s*\]/);
  return m ? m[1] : null;
}

/** Blok metnini electron-builder desen dizisine çözer (sıra korunur). */
function filesDesenleriniCoz(blokMetni) {
  const kod = yorumsuz(blokMetni);
  const desenler = [];
  const re = /"([^"]+)"|\.\.\.([A-Za-z_$][\w$.]*)\(([^)]*)\)|\.\.\.([A-Za-z_$][\w$.]*)/g;
  for (const m of kod.matchAll(re)) {
    if (m[1] !== undefined) { desenler.push(m[1]); continue; }
    const cagri = m[2];
    if (cagri !== 'paketDisiListe.elektronBuilderDesenleri') {
      throw new Error(`files dizisinde tanınmayan yayılım: ...${cagri || m[4]}`
        + ' — okuyucuyu güncelle');
    }
    const arg = /^\s*['"](\w+)['"]\s*$/.exec(m[3]);
    if (!arg) throw new Error(`elektronBuilderDesenleri argümanı okunamadı: (${m[3]})`);
    desenler.push(...paketDisiListe.elektronBuilderDesenleri(arg[1]));
  }
  return desenler;
}

/**
 * Canlı `packagingService.js`'te bir platformun electron-builder `files` dizisi.
 * @param {'windows'|'macos'|'linux'} platform
 * @param {string} [src] kaynak metni (mutasyon testleri için)
 */
function canliFilesDesenleri(platform, src) {
  const govde = platformBloklari(src)[platform];
  const blok = filesBlokMetni(govde);
  if (blok == null) throw new Error(`${platform} files dizisi bulunamadı (sentinel köreldi)`);
  return filesDesenleriniCoz(blok);
}

module.exports = {
  CANLI,
  yorumsuz,
  platformBloklari,
  filesBlokMetni,
  filesDesenleriniCoz,
  canliFilesDesenleri,
};
