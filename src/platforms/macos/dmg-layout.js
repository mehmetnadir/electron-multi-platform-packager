'use strict';
const path = require('path');
const fs = require('fs-extra');

/**
 * dmg penceresi "sürükle → Applications" düzeni (2026-08-27).
 * Finder'da açılınca: solda uygulama, sağda Applications kısayolu, arada ok ve
 * Türkçe yönerge. Arka plan PNG'si sharp ile SVG'den üretilir (dmg-builder
 * `background` + `contents` konumları bu ölçülere göre).
 */
const WINDOW = { width: 660, height: 400 };
const ICON_SIZE = 128;
const APP_POS = { x: 165, y: 200 };
const APPS_POS = { x: 495, y: 200 };

function dmgBackgroundSvg(appName) {
  const esc = String(appName || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WINDOW.width}" height="${WINDOW.height}" viewBox="0 0 ${WINDOW.width} ${WINDOW.height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7f7f9"/><stop offset="1" stop-color="#e9e9ee"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="${WINDOW.width / 2}" y="58" text-anchor="middle" font-family="-apple-system, Helvetica Neue, Arial, sans-serif" font-size="22" font-weight="600" fill="#1d1d1f">${esc}</text>
  <text x="${WINDOW.width / 2}" y="86" text-anchor="middle" font-family="-apple-system, Helvetica Neue, Arial, sans-serif" font-size="15" fill="#6e6e73">Yüklemek için simgeyi Applications klasörüne sürükleyin</text>
  <g stroke="#8e8e93" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <line x1="262" y1="200" x2="392" y2="200"/>
    <polyline points="366,174 392,200 366,226"/>
  </g>
  <text x="${WINDOW.width / 2}" y="352" text-anchor="middle" font-family="-apple-system, Helvetica Neue, Arial, sans-serif" font-size="12" fill="#a1a1a6">Kurulumdan sonra bu pencereyi kapatıp diski çıkarabilirsiniz</text>
</svg>`;
}

/** Arka planı PNG olarak yazar; dönüş: dosya yolu. */
async function writeDmgBackground(dir, appName) {
  const sharp = require('sharp');
  await fs.ensureDir(dir);
  const out = path.join(dir, 'dmg-background.png');
  await sharp(Buffer.from(dmgBackgroundSvg(appName))).png().toFile(out);
  return out;
}

/** electron-builder `dmg` bloğu — title/icon çağıran tarafta eklenir. */
function dmgLayoutConfig(backgroundPath) {
  return {
    background: backgroundPath,
    window: { width: WINDOW.width, height: WINDOW.height },
    iconSize: ICON_SIZE,
    iconTextSize: 13,
    contents: [
      { x: APP_POS.x, y: APP_POS.y, type: 'file' },
      { x: APPS_POS.x, y: APPS_POS.y, type: 'link', path: '/Applications' },
    ],
  };
}

module.exports = { dmgBackgroundSvg, writeDmgBackground, dmgLayoutConfig, WINDOW, APP_POS, APPS_POS };
