#!/usr/bin/env node
'use strict';

/**
 * G UÇTAN UCA — yerel HTTPS statik sunucu (yalnız okuma).
 *
 *   https://127.0.0.1:<port>/<senaryo>/guncelleme/set/<id>/<yol>
 *     → <dizin>/senaryolar/<senaryo>/set/<id>/<yol>
 *   https://127.0.0.1:<port>/saglik → {"gUctanUca":true, ...}
 *
 * Yalnız GET/HEAD; dizin listesi yok; `..`/NUL kaçışı 400; `set/` dışı 404.
 * Her istek stdout'a bir satır: `<ISO> <yöntem> <yol> <durum> <bayt>`.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');
const { icerikTuru } = require('../g-yayin/yayinla');

const VARSAYILAN_DIZIN = path.join(os.homedir(), '.empp-agent', 'g-uctan-uca');
const SENARYO_DESENI = /^[a-z0-9-]{1,40}$/;

function istekHedefi(senaryoKoku, ham) {
  let p;
  try {
    p = decodeURIComponent(new URL(ham, 'http://yerel').pathname);
  } catch (e) {
    return { durum: 400 };
  }
  if (p.includes('\0')) return { durum: 400 };
  if (p === '/saglik') return { saglik: true };
  const parca = p.split('/');
  // ['', senaryo, 'guncelleme', 'set', ...]
  if (
    parca.length < 5 ||
    parca[2] !== 'guncelleme' ||
    parca[3] !== 'set' ||
    !SENARYO_DESENI.test(parca[1])
  ) {
    return { durum: 404 };
  }
  if (parca.slice(4).some((s) => s === '..' || s === '.' || s === '')) return { durum: 400 };
  const kok = path.resolve(senaryoKoku, parca[1], 'set');
  const hedef = path.resolve(kok, ...parca.slice(4));
  if (!hedef.startsWith(kok + path.sep)) return { durum: 400 };
  return { hedef };
}

/**
 * @param {{dizin:string, port?:number, host?:string, tls?:{key:Buffer, cert:Buffer}|null,
 *   gunluk?:Function}} s
 * @returns {Promise<{port:number, sunucu:import('http').Server, kapat:()=>Promise<void>}>}
 */
function sunucuBaslat(s) {
  const dizin = path.resolve(s.dizin || VARSAYILAN_DIZIN);
  const senaryoKoku = path.join(dizin, 'senaryolar');
  const gunluk = typeof s.gunluk === 'function' ? s.gunluk : (m) => console.log(m);
  const isleyici = (istek, yanit) => {
    const yaz = (durum, bayt) =>
      gunluk(`${new Date().toISOString()} ${istek.method} ${istek.url} ${durum} ${bayt}`);
    if (istek.method !== 'GET' && istek.method !== 'HEAD') {
      yanit.writeHead(405, { Allow: 'GET, HEAD' });
      yanit.end();
      yaz(405, 0);
      return;
    }
    const h = istekHedefi(senaryoKoku, istek.url);
    if (h.saglik) {
      const g = Buffer.from(JSON.stringify({ gUctanUca: true, dizin }));
      yanit.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': g.length });
      yanit.end(istek.method === 'HEAD' ? undefined : g);
      yaz(200, g.length);
      return;
    }
    if (!h.hedef) {
      yanit.writeHead(h.durum);
      yanit.end();
      yaz(h.durum, 0);
      return;
    }
    fs.stat(h.hedef, (hata, st) => {
      if (hata || !st.isFile()) {
        yanit.writeHead(404);
        yanit.end();
        yaz(404, 0);
        return;
      }
      yanit.writeHead(200, {
        'Content-Type': icerikTuru(h.hedef),
        'Content-Length': st.size,
        'Cache-Control': 'no-store',
      });
      if (istek.method === 'HEAD') {
        yanit.end();
        yaz(200, 0);
        return;
      }
      const akis = fs.createReadStream(h.hedef);
      akis.on('error', () => yanit.destroy());
      akis.on('end', () => yaz(200, st.size));
      akis.pipe(yanit);
    });
  };
  const sunucu = s.tls
    ? https.createServer({ key: s.tls.key, cert: s.tls.cert }, isleyici)
    : http.createServer(isleyici);
  return new Promise((coz, red) => {
    sunucu.once('error', red);
    sunucu.listen(s.port == null ? 8443 : s.port, s.host || '127.0.0.1', () => {
      sunucu.removeListener('error', red);
      coz({
        port: sunucu.address().port,
        sunucu,
        kapat: () =>
          new Promise((k) => {
            sunucu.closeAllConnections && sunucu.closeAllConnections();
            sunucu.close(() => k());
          }),
      });
    });
  });
}

/**
 * `<dizin>/<altDizin>/sunucu.{key,pem}` okunur; yoksa HATA (önce hazirla.js). `altDizin`
 * varsayılan `tls` (ad-kısıtlı, referans/Windows istemcisi); `tls-electron` verilirse
 * Electron istemcileri için kısıtsız, kısa ömürlü zincir okunur (`--electron` bayrağı, aşağıda).
 */
function tlsOku(dizin, altDizin = 'tls') {
  const t = path.join(path.resolve(dizin), altDizin);
  try {
    return {
      key: fs.readFileSync(path.join(t, 'sunucu.key')),
      cert: fs.readFileSync(path.join(t, 'sunucu.pem')),
    };
  } catch (e) {
    throw new Error(
      `TLS dosyaları yok (${t}) — önce: node tools/g-uctan-uca/hazirla.js --dizin ${dizin}`,
    );
  }
}

function hazirlikOku(dizin) {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.resolve(dizin), 'hazirlik.json'), 'utf8'));
  } catch (e) {
    return null;
  }
}

async function main(argv) {
  const a = { dizin: VARSAYILAN_DIZIN, port: null, host: '127.0.0.1', http: false, electron: false };
  for (let i = 0; i < argv.length; i++) {
    const b = argv[i];
    if (b === '--dizin') a.dizin = argv[++i];
    else if (b === '--port') a.port = Number(argv[++i]);
    else if (b === '--host') a.host = argv[++i];
    else if (b === '--http') a.http = true;
    else if (b === '--electron') a.electron = true;
    else throw new Error(`bilinmeyen argüman: ${b}`);
  }
  const hz = hazirlikOku(a.dizin);
  const port = a.port != null ? a.port : (hz && hz.port) || 8443;
  const tls = a.http ? null : tlsOku(a.dizin, a.electron ? 'tls-electron' : 'tls');
  const s = await sunucuBaslat({ dizin: a.dizin, port, host: a.host, tls });
  const sema = tls ? 'https' : 'http';
  if (a.electron) console.log('  (Electron-uyumlu, kısıtsız test CA — tls-electron/)');
  console.log(
    `G uçtan uca sunucusu: ${sema}://${a.host}:${s.port}/<senaryo>/guncelleme  ` +
      `(kök ${path.resolve(a.dizin)}/senaryolar)`,
  );
  if (hz && hz.port && hz.port !== s.port)
    console.log(
      `UYARI: hazirlik.json portu ${hz.port}; manifestteki kitap adresleri o portu gösterir`,
    );
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(
      'HATA: ' +
        (e && e.code === 'EADDRINUSE'
          ? `port dolu (${e.port}) — --port ile başka port ya da çalışan sunucuyu kullanın`
          : e.message),
    );
    process.exitCode = 1;
  });
}

module.exports = { VARSAYILAN_DIZIN, istekHedefi, sunucuBaslat, tlsOku, hazirlikOku };
