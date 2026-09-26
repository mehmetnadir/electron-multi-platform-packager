#!/usr/bin/env node
'use strict';
/**
 * G Android canlı uçtan uca — YEREL test HTTPS sunucusu (yalnız 127.0.0.1; cihaza `adb reverse`).
 * Üretimde KULLANILMAZ: sertifikası test CA'sıdır (APK'ya yalnız `EMPP_G_TEST_GUVEN_CA` ile girer).
 *
 * Senaryo dosyası (her istekte yeniden okunur — sunucu yeniden başlamadan senaryo değişir):
 *   { "ad": "kabul",
 *     "esleme": [ { "onek": "/guncelleme/set/73768/android/", "dizin": "<mutlak>" }, … ],
 *     "surumJson": null | { …surum.json yerine verilecek nesne (imzasız tetik yalanı) } }
 * Her istek `--jsonl` dosyasına yazılır: { zaman, senaryo, yol, durum, boyut }.
 *
 *   node tools/g-android/g-test-sunucu.js --port 8443 --sertifika <dizin> --senaryo <json> --jsonl <dosya>
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

function arg(ad, v = null) {
  const i = process.argv.indexOf(`--${ad}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : v;
}

const port = Number(arg('port', '8443'));
const sertifika = arg('sertifika');
const senaryoYolu = arg('senaryo');
const gunlukYolu = arg('jsonl');
if (!sertifika || !senaryoYolu || !gunlukYolu) {
  console.error('kullanım: --port --sertifika <dizin> --senaryo <json> --jsonl <dosya>');
  process.exit(2);
}

function senaryo() {
  try { return JSON.parse(fs.readFileSync(senaryoYolu, 'utf8')); } catch (e) { return { ad: 'yok', esleme: [] }; }
}

/** İstek yolu → diskteki dosya (eşleme dışı / kaçan yol → null). Saf. */
function dosyaBul(s, yol) {
  for (const e of s.esleme || []) {
    if (!yol.startsWith(e.onek)) continue;
    const kalan = yol.slice(e.onek.length).split('/').map((p) => decodeURIComponent(p));
    if (kalan.some((p) => !p || p === '.' || p === '..' || p.includes('\\'))) return null;
    const hedef = path.resolve(e.dizin, ...kalan);
    if (!hedef.startsWith(path.resolve(e.dizin) + path.sep)) return null;
    return hedef;
  }
  return null;
}

const sunucu = https.createServer({
  key: fs.readFileSync(path.join(sertifika, 'sunucu.key')),
  cert: fs.readFileSync(path.join(sertifika, 'sunucu.pem')),
}, (istek, yanit) => {
  const s = senaryo();
  const yol = new URL(istek.url, 'https://127.0.0.1').pathname;
  let durum = 404;
  let govde = Buffer.from('yok');
  if (s.surumJson && /\/android\/surum\.json$/.test(yol)) {
    durum = 200;
    govde = Buffer.from(JSON.stringify(s.surumJson));
  } else {
    const d = dosyaBul(s, yol);
    if (d && fs.existsSync(d) && fs.statSync(d).isFile()) {
      durum = 200;
      govde = fs.readFileSync(d);
    }
  }
  fs.appendFileSync(gunlukYolu, `${JSON.stringify({
    zaman: new Date().toISOString(), senaryo: s.ad, yol, durum, boyut: durum === 200 ? govde.length : 0,
  })}\n`);
  yanit.writeHead(durum, { 'Content-Length': govde.length, 'Cache-Control': 'no-store' });
  yanit.end(istek.method === 'HEAD' ? undefined : govde);
});
sunucu.listen(port, '127.0.0.1', () => console.log(`G-TEST-SUNUCU hazır https://127.0.0.1:${port} (senaryo ${senaryoYolu})`));
