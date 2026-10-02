'use strict';

/**
 * electron-builder İKİLİSİ — Windows çözümü (2026-10-02, windows-kasa ajanı).
 *
 * Sorun: npm Windows'ta `node_modules/.bin/` altına ÜÇ kabuk yazar — uzantısız `electron-builder`
 * (sh betiği), `.cmd` ve `.ps1`. Eski çözümleyici önce uzantısız adı arıyordu; Windows'ta o dosya
 * VAR ama bir sh betiği olduğundan `spawn(..., {shell:false})` ENOENT / "geçerli Win32 uygulaması
 * değil" verir. `.cmd` dalına hiç gelinmezdi; gelinse de Node 18.20.2/20.12.2 sonrası `.cmd`'yi
 * `shell:false` ile başlatmak EINVAL'dir (CVE-2024-27980 düzeltmesi).
 *
 * Çözüm: Windows'ta electron-builder'ın KENDİ JS girişi (`electron-builder/cli.js`, package.json
 * `bin`) Node ile koşturulur: `node cli.js ...`. Kabuk yok, `.cmd` yok, tırnak sorunu yok.
 * macOS/Linux davranışı DEĞİŞMEZ (çağıran yalnız win32'de bu modüle gelir).
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {object} o
 * @param {string} o.kok          paketleyici kökü (process.cwd())
 * @param {string} o.execPath     node ikilisi (process.execPath)
 * @param {(p:string)=>boolean} [o.varMi]
 * @param {(ad:string)=>string|null} [o.cozumle]  require.resolve sarmalayıcısı (bulunamazsa null)
 * @returns {{command:string, args:string[]}}
 */
function windowsIkili({ kok, execPath, varMi = fs.existsSync, cozumle = varsayilanCozumle }) {
  const yerel = path.win32.join(kok, 'node_modules', 'electron-builder', 'cli.js');
  if (varMi(yerel)) return { command: execPath, args: [yerel] };
  const cozulen = cozumle('electron-builder/cli.js');
  if (cozulen) return { command: execPath, args: [cozulen] };
  throw new Error('electron-builder bulunamadı (node_modules/electron-builder/cli.js yok) — '
    + 'paketleyici kökünde `npm ci` koşturulmamış');
}

function varsayilanCozumle(ad) {
  try { return require.resolve(ad); } catch (_) { return null; }
}

module.exports = { windowsIkili };
