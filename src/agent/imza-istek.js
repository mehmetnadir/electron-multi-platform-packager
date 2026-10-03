'use strict';
/**
 * İMZA TETİK İSTEĞİ — kasa (windows-kasa) yayincilikadm koşamaz: `book exe-create` / `exe-remove`
 * panel oturumu ister ve o oturum Mac'te (ya da srv21'de) durur. Kasa yalnız yuvaya yazar/okur ve
 * tetik gerektiğinde bir İSTEK DOSYASI bırakır; tetiği Mac'teki köprü
 * (tools/windows/imza-tetik-koprusu.js) mevcut Mac→kasa SSH'ı ile çeker.
 *
 * Güvenlik: istek dosyası KOMUT TAŞIMAZ, yalnız beyaz listedeki bir ADI taşır. Köprü komutu kendi
 * sabit tablosundan kurar (`istekKomutu`); kasadan gelen hiçbir metin argv'ye girmez.
 *
 * Dosya: <dizin>/<zamanMs>-<komut>-<pid>.json  {komut, zaman, ajan, exe?, sebep?}
 * Köprü işledikten sonra <dizin>/islendi/<aynı ad> (sonuç alanlarıyla) olarak taşır — silme yok.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const YUVA_ID = '66902';
const KOMUTLAR = Object.freeze({
  'exe-create': Object.freeze(['yayincilikadm', 'book', 'exe-create', YUVA_ID, '--wait', '0']),
  'exe-remove': Object.freeze(['yayincilikadm', 'book', 'exe-remove', '--windows', '--yes', YUVA_ID]),
});
const AD_DESENI = /^(\d{13})-(exe-create|exe-remove)-(\d{1,10})\.json$/;

function varsayilanIstekDizini(env = process.env) {
  return env.EMPP_IMZA_ISTEK_DIZINI || path.join(os.homedir(), '.empp-agent', 'imza-istek');
}

/** İstek dosyası bırakır (.part → rename, yarım dosya okunmaz). @returns {Promise<string>} yol */
async function istekYaz(dizin, komut, meta = {}, { simdi = Date.now } = {}) {
  if (!Object.prototype.hasOwnProperty.call(KOMUTLAR, komut)) throw new Error(`imza isteği: bilinmeyen komut ${komut}`);
  await fsp.mkdir(dizin, { recursive: true });
  const zaman = simdi();
  const ad = `${zaman}-${komut}-${process.pid}.json`;
  const yol = path.join(dizin, ad);
  const govde = {
    komut, zaman: new Date(zaman).toISOString(), ajan: os.hostname(),
    ...(meta.exe ? { exe: path.win32.basename(String(meta.exe)) } : {}),
    ...(meta.sebep ? { sebep: String(meta.sebep).slice(0, 200) } : {}),
  };
  await fsp.writeFile(`${yol}.part`, `${JSON.stringify(govde)}\n`);
  await fsp.rename(`${yol}.part`, yol);
  return yol;
}

/** Senkron sürüm (tetik satır geri çağrısından). */
function istekYazSenkron(dizin, komut, meta = {}) {
  if (!Object.prototype.hasOwnProperty.call(KOMUTLAR, komut)) throw new Error(`imza isteği: bilinmeyen komut ${komut}`);
  fs.mkdirSync(dizin, { recursive: true });
  const zaman = Date.now();
  const yol = path.join(dizin, `${zaman}-${komut}-${process.pid}.json`);
  const govde = { komut, zaman: new Date(zaman).toISOString(), ajan: os.hostname(), ...(meta.exe ? { exe: path.win32.basename(String(meta.exe)) } : {}) };
  fs.writeFileSync(`${yol}.part`, `${JSON.stringify(govde)}\n`);
  fs.renameSync(`${yol}.part`, yol);
  return yol;
}

/**
 * Köprü tarafı hüküm (saf): dosya adı + içerik → çalıştırılacak SABİT argv ya da ret sebebi.
 * @returns {{argv:string[]|null, komut:string|null, sebep:string}}
 */
function istekKomutu(ad, icerik, { simdiMs = Date.now(), azamiYasMs = 6 * 3600 * 1000 } = {}) {
  const m = AD_DESENI.exec(String(ad || ''));
  if (!m) return { argv: null, komut: null, sebep: `ad deseni tutmadı: ${String(ad).slice(0, 80)}` };
  const komut = m[2];
  let o = null;
  try { o = JSON.parse(String(icerik || '')); } catch (_) { o = null; }
  if (!o || o.komut !== komut) return { argv: null, komut, sebep: 'içerik komutu adla aynı değil ya da çözülemedi' };
  const yas = simdiMs - Number(m[1]);
  if (!(yas >= -5 * 60000 && yas <= azamiYasMs)) return { argv: null, komut, sebep: `istek bayat (${Math.round(yas / 60000)} dk)` };
  return { argv: [...KOMUTLAR[komut]], komut, sebep: 'ok' };
}

module.exports = { YUVA_ID, KOMUTLAR, AD_DESENI, varsayilanIstekDizini, istekYaz, istekYazSenkron, istekKomutu };
