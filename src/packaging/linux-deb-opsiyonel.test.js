// EMPP_LINUX_DEB=0 → linux hedefi yalnız AppImage.
// Neden (ölçüm 2026-09-17, srv21/45695): .impark customizeAppImage ile AppImage'dan
// türetilir; deb hiç kullanılmaz ama 1,5 GB gövdede tek çekirdekli xz ile 30+ dk yer
// (AppImage 3 dk'da bitmişti, fpm/xz 11+ dk sürüyordu ve devam ediyordu).
// Bu test kaynak yorumlarına kanmasın diye yorumlar SİLİNEREK ölçer.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('deb hedefi EMPP_LINUX_DEB=0 ile kapatılabilir (kod, yorum değil)', () => {
  assert.match(SRC, /process\.env\.EMPP_LINUX_DEB === '0'\s*\n?\s*\?\s*\[\{ target: "AppImage", arch: \["x64"\] \}\]/);
});

test('varsayılan davranış korunur: bayrak yokken deb hâlâ üretilir', () => {
  const dal = (SRC.split("process.env.EMPP_LINUX_DEB === '0'")[1] || '').slice(0, 400);
  assert.match(dal, /target: "deb"/);
});
