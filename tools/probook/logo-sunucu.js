'use strict';
/**
 * ProBook şeridi SALT-OKUNUR logo ucu (127.0.0.1). runner.js pardus ikonunu
 * PACKAGER_API'deki `/api/logos` + `/api/logos/:id/file` uçlarından alır
 * (`injectPardusIcon`); ProBook'ta HTTP paketleyici yok. Bu uç olmadan her paket
 * SESSİZCE Electron varsayılan ikonuyla çıkardı (logo kuralı ihlali).
 * Veri: kur.sh'ın Mac paketleyicisinden eşlediği `<dizin>/logos.json` + `<dizin>/<id>.png`.
 * Mac'e çalışma anında BAĞIMLI DEĞİL (Mac kapalıyken de ikon doğru).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ID_DESENI = /^[0-9a-f-]{8,64}$/i;

function istekIsle(dizin, req, res) {
  const url = (req.url || '').split('?')[0];
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  if (url === '/api/logos') {
    let liste = [];
    try { liste = JSON.parse(fs.readFileSync(path.join(dizin, 'logos.json'), 'utf8')); } catch (_) { liste = []; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(Array.isArray(liste) ? liste : []));
  }
  const m = url.match(/^\/api\/logos\/([^/]+)\/file$/);
  if (m && ID_DESENI.test(m[1])) {
    const dosya = path.join(dizin, `${m[1]}.png`);
    if (fs.existsSync(dosya)) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return fs.createReadStream(dosya).pipe(res);
    }
  }
  if (url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true,"tur":"empp-serit-logo"}');
  }
  res.writeHead(404); return res.end();
}

function baslat({ dizin, port = 3095, host = '127.0.0.1' } = {}) {
  const sunucu = http.createServer((req, res) => istekIsle(dizin, req, res));
  return new Promise((resolve) => sunucu.listen(port, host, () => resolve(sunucu)));
}

if (require.main === module) {
  const dizin = process.env.EMPP_LOGO_DIZIN || path.join(require('os').homedir(), 'empp-serit', 'logolar');
  const port = Number(process.env.EMPP_LOGO_PORT || 3095);
  baslat({ dizin, port }).then(() => console.log(`logo-sunucu: 127.0.0.1:${port} (${dizin})`));
}

module.exports = { baslat, istekIsle };
