'use strict';

/**
 * sf425 kabuk tazeleme testlerinin ortak sahteleri (birim + runner bütünleşme).
 * - `sahteIkili(dizin)`: Üretim Masası `webz-kabuk-uret` sözleşmesini taklit eden node betiği:
 *   <kök> <girdi.json> <kapak-dizini> alır, kökte sf425 dosyalarını yazar (yama `window.__setSettings`
 *   + `displayOrder`). `SAHTE_MOD` ile bilerek bozuk/asılı çıktı üretir (kapı/zaman aşımı kanıtı).
 *   Her çağrıyı `<girdi dizini>/../cagri.log`'a yazar; `uyu` kipinde PID'i `<girdi dizini>/../ikili.pid`'e.
 * - `sahteGetir({ayar, kapakYok, status})`: Web-Z settings.json + kapaklar (ağ yok).
 */

const fs = require('node:fs');
const path = require('node:path');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(2000, 7)]);
const ESKI_INDEX = '<html><head><title>Akıllı Tahta</title></head><body>\n'
  + '    <script src="scripts/xmlParser.js"></script>\n'
  + '    <script src="scripts/cevrimdisi-yama.js"></script>\n'
  + '    <script src="scripts/language-set.js"></script>\n</body></html>';

function sahteIkili(dizin) {
  const yol = path.join(dizin, 'webz-kabuk-uret');
  fs.writeFileSync(yol, `#!${process.execPath}
const fs = require('fs'); const path = require('path');
const [kok, girdiYolu, kapak] = process.argv.slice(2);
const mod = process.env.SAHTE_MOD || '';
const g = JSON.parse(fs.readFileSync(girdiYolu, 'utf8'));
const ust = path.join(path.dirname(girdiYolu), '..');
fs.appendFileSync(path.join(ust, 'cagri.log'), JSON.stringify({ kok, g }) + '\\n');
if (mod === 'uyu') { fs.writeFileSync(path.join(ust, 'ikili.pid'), String(process.pid)); setTimeout(() => {}, 60000); return; }
if (mod === 'cikis1') { process.stderr.write('tema şartları eksik'); process.exit(1); }
const yaz = (ad, v) => { fs.mkdirSync(path.dirname(path.join(kok, ad)), { recursive: true }); fs.writeFileSync(path.join(kok, ad), v); };
const books = {};
let kitaplar = g.kitaplar;
if (mod === 'sira') kitaplar = [...kitaplar].reverse();
kitaplar.forEach((k, i) => {
  if (k.contentType === 'link') books[k.klasor] = { assetId: '', title: k.title, contentType: 'link', type: 'link', url: k.url, displayOrder: i };
  else books[k.klasor] = { assetId: mod === 'id' && i === 0 ? '999' : k.assetId, title: k.title, coverUrl: 'images/' + k.klasor + '.jpg',
    contentType: mod === 'tur' ? 'book' : (k.contentType || 'book'), displayOrder: i };
  if (k.contentType !== 'link') yaz('images/' + k.klasor + '.png', fs.readFileSync(path.join(kapak, 'kapak-' + k.klasor + '.png')));
});
const ayar = { setTitle: g.setTitle, books };
yaz('config/settings.json', JSON.stringify(ayar, null, 2));
yaz('scripts/cevrimdisi-yama.js', 'window.__setSettings = ' + JSON.stringify(ayar) + ';\\n/* set-ek:link-tikla */\\n');
yaz('scripts/language-set.js', mod === 'imzasiz' ? '/* eski */' : '(function sonrakiSatirDugmesi() {})();');
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

module.exports = { PNG, ESKI_INDEX, sahteIkili, sahteGetir };
