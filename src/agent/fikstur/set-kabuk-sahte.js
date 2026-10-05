'use strict';

/**
 * sf425 kabuk tazeleme testlerinin ortak sahteleri (birim + runner bütünleşme).
 * - `sahteIkili(dizin)`: Üretim Masası `webz-kabuk-uret` sözleşmesini taklit eden node betiği:
 *   <kök> <girdi.json> <kapak-dizini> alır, kökte sf425 dosyalarını yazar (yama `window.__setSettings`
 *   + `displayOrder`). `SAHTE_MOD` ile bilerek bozuk/asılı çıktı üretir (kapı/zaman aşımı kanıtı).
 *   Her çağrıyı `<girdi dizini>/../cagri.log`'a yazar; `uyu` kipinde PID'i `<girdi dizini>/../ikili.pid`'e.
 *   A1 (05.10, Swift 49bf319f taklidi): `--kip tek-motor` ilk iki argümansa kökte
 *   `kapak/index.html`, `classlibraries/ImWin32.dll` ve her kitap için `assets/<kapak>/` İSTER (yoksa
 *   çıkış 1); kitaplara `kapak` + `path: '.'` yazar, `language-set.js`'e `kitapAcmaAdresi`
 *   (`kapak/index.html?kapak=`) koyar. Gerçek araç gibi kökte `index.html` varsa `_eski/`e taşır.
 *   Kip modları: `kipsiz` (eski ikili: bayrağı tanımaz, çıkış 2), `kipi-yoksay` (bayrağı yutar,
 *   bookN kabuğu yazar), `a1-imzasiz`, `a1-yolsuz`, `a1-kapak` (yanlış kapak), `a1-kapak-yaz`
 *   (girdi motor sayfasını değiştirir), `a1-menu-yaz` (girdi menüsünü değiştirir), `a1-kapak-ek`
 *   (kapak/ altına yeni dosya), `a1-eski-yaz` (`_eski/` altına yazar).
 * - `sahteGetir({ayar, kapakYok, status})`: Web-Z settings.json + kapaklar (ağ yok).
 * - `tekMotorMenu(idler)`: kök `classlibraries/ImWin32.dll` (127/17 biçimi, gerçek menü XML'i).
 */

const fs = require('node:fs');
const path = require('node:path');
const { imwinYaz } = require('../../platforms/common/fs-shim');

function tekMotorMenu(idler, { key = '' } = {}) {
  const kapaklar = idler.map((id) => `<cover guId="" ID="${id}" etkID="${id}" actName="Kitap ${id}" version="1" `
    + `xmlSource="assets/${id}/data/BookContent.xml" tabID="1"></cover>`).join('');
  const xml = `<?xml version="1.0"?><main activation="true" key="${key}" label="Set" ID="45485">`
    + `<Group ID="45485" label="Set"><Tab ID="1" label="">${kapaklar}</Tab></Group></main>`;
  return imwinYaz(xml, 127, 17);
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(2000, 7)]);
const ESKI_INDEX = '<html><head><title>Akıllı Tahta</title></head><body>\n'
  + '    <script src="scripts/xmlParser.js"></script>\n'
  + '    <script src="scripts/cevrimdisi-yama.js"></script>\n'
  + '    <script src="scripts/language-set.js"></script>\n</body></html>';

function sahteIkili(dizin) {
  const yol = path.join(dizin, 'webz-kabuk-uret');
  fs.writeFileSync(yol, `#!${process.execPath}
const fs = require('fs'); const path = require('path');
let argv = process.argv.slice(2);
const mod = process.env.SAHTE_MOD || '';
// A1 sözleşmesi (a1-arayuz.md): '--kip tek-motor' konumsal argümanlardan ÖNCE gelir.
let kip = null;
if (argv[0] === '--kip') {
  // Eski ikili taklidi: bayrağı tanımaz, kullanım satırı + çıkış 2.
  if (mod === 'kipsiz') { process.stderr.write('kullanım: webz-kabuk-uret <kök> <girdi.json> <kapak-dizini>'); process.exit(2); }
  kip = argv[1]; argv = argv.slice(2);
  if (kip !== 'tek-motor') { process.stderr.write('bilinmeyen kip: ' + kip); process.exit(2); }
}
const tekMotor = kip === 'tek-motor' && mod !== 'kipi-yoksay';
const [kok, girdiYolu, kapak] = argv;
const g = JSON.parse(fs.readFileSync(girdiYolu, 'utf8'));
const ust = path.join(path.dirname(girdiYolu), '..');
fs.appendFileSync(path.join(ust, 'cagri.log'), JSON.stringify({ kok, g, kip }) + '\\n');
if (mod === 'uyu') { fs.writeFileSync(path.join(ust, 'ikili.pid'), String(process.pid)); setTimeout(() => {}, 60000); return; }
if (mod === 'cikis1') { process.stderr.write('tema şartları eksik'); process.exit(1); }
if (tekMotor) {
  for (const y of ['kapak/index.html', 'classlibraries/ImWin32.dll']) {
    if (!fs.existsSync(path.join(kok, y))) { process.stderr.write('tek motor: ' + y + ' kökte YOK — durduruldu'); process.exit(1); }
  }
  for (const k of g.kitaplar) {
    if (k.contentType === 'link') continue;
    const id = k.kapak || k.assetId;
    if (!fs.existsSync(path.join(kok, 'assets', String(id)))) { process.stderr.write('kapak eşleşmedi: ' + id); process.exit(1); }
  }
}
const yaz = (ad, v) => { fs.mkdirSync(path.dirname(path.join(kok, ad)), { recursive: true }); fs.writeFileSync(path.join(kok, ad), v); };
const books = {};
let kitaplar = g.kitaplar;
if (mod === 'sira') kitaplar = [...kitaplar].reverse();
kitaplar.forEach((k, i) => {
  if (k.contentType === 'link') books[k.klasor] = { assetId: '', title: k.title, contentType: 'link', type: 'link', url: k.url, displayOrder: i };
  else books[k.klasor] = { assetId: mod === 'id' && i === 0 ? '999' : k.assetId, title: k.title, coverUrl: 'images/' + k.klasor + '.jpg',
    contentType: mod === 'tur' ? 'book' : (k.contentType || 'book'), displayOrder: i,
    ...(tekMotor ? { kapak: mod === 'a1-kapak' && i === 0 ? '1' : k.kapak, ...(mod === 'a1-yolsuz' ? {} : { path: '.' }) } : {}) };
  if (k.contentType !== 'link') {
    const aday = ['kapak-' + k.klasor + '.png', ...(tekMotor ? ['kapak-' + k.kapak + '.png'] : [])]
      .map((a) => path.join(kapak, a)).find((a) => fs.existsSync(a));
    yaz('images/' + k.klasor + '.png', fs.readFileSync(aday));
  }
});
const ayar = { setTitle: g.setTitle, books };
yaz('config/settings.json', JSON.stringify(ayar, null, 2));
yaz('scripts/cevrimdisi-yama.js', 'window.__setSettings = ' + JSON.stringify(ayar) + ';\\n/* set-ek:link-tikla */\\n');
const kartUrl = tekMotor && mod !== 'a1-imzasiz'
  ? "function kitapAcmaAdresi(b,s){return b.kapak?'kapak/index.html?kapak='+b.kapak+'&defaultPageNo='+s:b.path+'/index.html?defaultPageNo='+s}"
  : '';
yaz('scripts/language-set.js', mod === 'imzasiz' ? '/* eski */' : '(function sonrakiSatirDugmesi() {})();' + kartUrl);
if (mod === 'a1-kapak-yaz') yaz('kapak/index.html', '<html>ikili yazdı</html>');
if (mod === 'a1-menu-yaz') yaz('classlibraries/ImWin32.dll', 'bozuk menü');
if (mod === 'a1-kapak-ek') yaz('kapak/ek.js', 'x');
if (mod === 'a1-eski-yaz') yaz('_eski/index-sahte.html', '<html>eski</html>');
// Gerçek araç: kökteki index.html SİLİNMEZ, _eski/ altına taşınır.
if (fs.existsSync(path.join(kok, 'index.html'))) {
  fs.mkdirSync(path.join(kok, '_eski'), { recursive: true });
  fs.renameSync(path.join(kok, 'index.html'), path.join(kok, '_eski', 'index-tasinan.html'));
}
yaz('scripts/xmlParser.js', '/* yeni */');
yaz('styles/cevrimdisi.css', '/* css */');
yaz('index.html', ${JSON.stringify(ESKI_INDEX)}.replace('xmlParser.js', mod === 'ref' ? 'yok.js' : 'xmlParser.js'));
yaz('set-menu.json', '{}');
if (mod === 'bookn') yaz('book1/sizinti.js', 'x');
if (mod === 'electron') yaz('electron.js', 'bozuk');
if (mod === 'assets') yaz('assets/111/data/BookContent.xml', 'bozuk');
`);
  fs.chmodSync(yol, 0o755);
  return yol;
}

function sahteGetir({ ayar, kapakYok = null, status = 200 } = {}) {
  const istekler = [];
  const getir = async (url) => {
    istekler.push(url);
    if (url.endsWith('/config/settings.json')) return { status, govde: Buffer.from(JSON.stringify(ayar)) };
    const m = /\/images\/([^/?]+)\.png/.exec(url);
    if (m && decodeURIComponent(m[1]) !== kapakYok) return { status: 200, govde: PNG };
    return { status: 404, govde: Buffer.from('not found') };
  };
  return { getir, istekler };
}

module.exports = { PNG, ESKI_INDEX, sahteIkili, sahteGetir, tekMotorMenu };
