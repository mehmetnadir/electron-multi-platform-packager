'use strict';

/**
 * PAKET TEMİZLİĞİ — zamana bağlı, deterministik artık toplayıcı.
 *
 * NEDEN (2026-09-19, srv21 ölçümü): mevcut `checkAndCleanIfQueueEmpty` YALNIZ bir iş
 * bitip kuyruk boşaldığı an tetikleniyor ve `completed` işleri SÜRESİZ koruyor
 * (`delete-job` çağrılana kadar). İş akmayan günlerde hiç çalışmıyor. Sonuç:
 * srv21'de `/opt/electron-packager/temp` 11 GB + `uploads` 8,5 GB, hepsi 4+ gün
 * eski, disk %99. Elle silmek deterministik değildir — bu modül onu kurala çevirir.
 *
 * KARAR SIRASI (ilk eşleşen kazanır):
 *   1. aktif iş            → KORU
 *   2. taze (< 10 dk)      → KORU   (yeni gelen build.zip'i silme kazası, 2026-09-17)
 *   3. artefakt YOK + eski → SİL    (saf ara dosya; kaybedilecek çıktı yok)
 *   4. artefakt VAR + çok eski → SİL (teslim penceresi doldu)
 *   5. aksi                → KORU   (teslim penceresi sürüyor)
 *
 * Artefakt = exe/impark/apk/dmg/AppImage/zip. "Artefakt var" demek "teslim edildi"
 * demek DEĞİLDİR — bu yüzden ona çok daha uzun bir pencere tanınır (varsayılan 48 s).
 */

const path = require('path');
const fs = require('fs-extra');

const TAZE_MS = 10 * 60 * 1000;              // dokunulmuşluk emniyeti
const ARTEFAKTSIZ_SAAT = 6;                  // saf ara dosya
const ARTEFAKTLI_SAAT = 48;                  // çıktı taşıyan iş
const ARTEFAKT_UZANTI = new Set(['.exe', '.impark', '.apk', '.dmg', '.appimage', '.zip', '.deb']);

function artefaktMi(dosyaAdi) {
  return ARTEFAKT_UZANTI.has(path.extname(String(dosyaAdi)).toLowerCase());
}

/**
 * SAF KARAR — diske dokunmaz, saat okumaz. Tek doğruluk noktası burasıdır.
 * @param {Array<{ad:string, mtimeMs:number, bayt:number, artefaktVar:boolean, aktif:boolean}>} girdiler
 * @param {number} simdi
 * @param {{artefaktsizSaat?:number, artefaktliSaat?:number, tazeMs?:number}} opts
 */
function kararVer(girdiler, simdi, opts = {}) {
  const artefaktsiz = (opts.artefaktsizSaat ?? ARTEFAKTSIZ_SAAT) * 3600 * 1000;
  const artefaktli = (opts.artefaktliSaat ?? ARTEFAKTLI_SAAT) * 3600 * 1000;
  const taze = opts.tazeMs ?? TAZE_MS;

  const sil = []; const koru = [];
  for (const g of girdiler) {
    const yas = simdi - g.mtimeMs;
    if (g.aktif) { koru.push({ ...g, sebep: 'aktif-is' }); continue; }
    if (yas < taze) { koru.push({ ...g, sebep: 'taze' }); continue; }
    if (!g.artefaktVar) {
      if (yas > artefaktsiz) sil.push({ ...g, sebep: 'artefaktsiz-eski' });
      else koru.push({ ...g, sebep: 'artefaktsiz-bekleme' });
      continue;
    }
    if (yas > artefaktli) sil.push({ ...g, sebep: 'teslim-penceresi-doldu' });
    else koru.push({ ...g, sebep: 'teslim-penceresinde' });
  }
  return { sil, koru };
}

/** Bir dizin ağacında artefakt var mı (derinlik sınırlı). */
async function artefaktAra(kok, derinlik = 4) {
  const yigin = [[kok, 0]];
  while (yigin.length) {
    const [d, k] = yigin.pop();
    let girdiler;
    try { girdiler = await fs.readdir(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of girdiler) {
      if (e.isFile() && artefaktMi(e.name)) return true;
      if (e.isDirectory() && k < derinlik) yigin.push([path.join(d, e.name), k + 1]);
    }
  }
  return false;
}

/** Bir kök dizini (temp/ ya da uploads/) tarar ve karar üretir — SİLMEZ. */
async function tara(kokDizin, aktifIdler = new Set(), opts = {}) {
  if (!await fs.pathExists(kokDizin)) return { sil: [], koru: [], yok: true };
  const adlar = await fs.readdir(kokDizin);
  const girdiler = [];
  for (const ad of adlar) {
    const yol = path.join(kokDizin, ad);
    let st;
    try { st = await fs.stat(yol); } catch (e) { continue; }
    girdiler.push({
      ad,
      yol,
      mtimeMs: st.mtimeMs,
      bayt: st.isDirectory() ? await dizinBoyutu(yol) : st.size,
      artefaktVar: st.isDirectory() ? await artefaktAra(yol) : artefaktMi(ad),
      aktif: aktifIdler.has(ad),
    });
  }
  return kararVer(girdiler, opts.simdi ?? Date.now(), opts);
}

async function dizinBoyutu(d) {
  let t = 0; const yigin = [d];
  while (yigin.length) {
    const p = yigin.pop();
    let g;
    try { g = await fs.readdir(p, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of g) {
      const q = path.join(p, e.name);
      if (e.isDirectory()) yigin.push(q);
      else { try { t += (await fs.stat(q)).size; } catch (err) { /* atla */ } }
    }
  }
  return t;
}

/** Kararı uygular. `kuru:true` ise hiçbir şey silmez (varsayılan GÜVENLİ taraf). */
async function uygula(kokDizin, aktifIdler, opts = {}) {
  const kuru = opts.kuru !== false;
  const log = opts.log || (() => {});
  const sonuc = await tara(kokDizin, aktifIdler, opts);
  if (sonuc.yok) { log(`   ${kokDizin}: yok`); return { silinen: 0, bayt: 0, korunan: 0, kuru }; }

  let bayt = 0; let silinen = 0;
  for (const s of sonuc.sil) {
    // Sınır denetimi: kökün DIŞINA çıkan hiçbir yol silinmez.
    if (!path.resolve(s.yol).startsWith(path.resolve(kokDizin) + path.sep)) continue;
    if (!kuru) { try { await fs.remove(s.yol); } catch (e) { continue; } }
    bayt += s.bayt; silinen += 1;
    log(`   ${kuru ? '[kuru] ' : ''}sil  ${s.ad}  ${(s.bayt / 1e6).toFixed(0)} MB  (${s.sebep})`);
  }
  for (const k of sonuc.koru) log(`   koru ${k.ad}  ${(k.bayt / 1e6).toFixed(0)} MB  (${k.sebep})`);
  return { silinen, bayt, korunan: sonuc.koru.length, kuru };
}

module.exports = {
  kararVer, tara, uygula, artefaktMi, artefaktAra, dizinBoyutu,
  TAZE_MS, ARTEFAKTSIZ_SAAT, ARTEFAKTLI_SAAT, ARTEFAKT_UZANTI,
};
