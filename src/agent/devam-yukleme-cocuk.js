'use strict';

/**
 * devam-yukleme.test.js'in "ayrı süreç" yardımcısı: gerçek runner.parcalariYukle + devam-yukleme ile
 * sahte S3/API'ye (üst süreç) yükler. Test bu süreci SIGKILL ile öldürüp yeniden başlatır.
 * Argümanlar: <dosya> <apiPort>; env: EMPP_YUKLEME_DIZIN, AGENT_UPLOAD_PART_ATTEMPTS...
 */
const fs = require('fs');
const crypto = require('crypto');
const runner = require('./runner');
const devam = require('./devam-yukleme');

const [dosya, port] = process.argv.slice(2);
const API = `http://127.0.0.1:${port}`;
const post = async (yol, govde) => {
  const r = await fetch(`${API}${yol}`, { method: 'POST', body: JSON.stringify(govde), headers: { 'content-type': 'application/json' } });
  if (r.status === 404) return { status: 404 };
  if (!r.ok) throw new Error(`${yol}: HTTP ${r.status}`);
  return { status: r.status, ...(await r.json()) };
};

(async () => {
  const size = fs.statSync(dosya).size;
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(dosya)).digest('hex');
  const y = await devam.cokParcaYukle({
    dosya, size, sha256, partSize: 1024 * 1024, kimlik: { bookId: '9001', platform: 'android' },
    istemci: {
      baslat: async (partCount) => post('/baslat', { partCount }),
      durum: async (g) => {
        const r = await post('/durum', g);
        return r.status === 404 ? { durum: 'yok' } : { durum: 'var', parcalar: r.parcalar, urls: r.urls };
      },
      iptal: async (g) => { await post('/iptal', g); },
    },
    parcaYukleyici: runner.parcalariYukle,
    log: (...a) => console.log(...a),
    warn: (...a) => console.error(...a),
  });
  console.log('SONUC', JSON.stringify({ devamEdildi: y.devamEdildi, atlanan: y.atlanan, parts: y.parts.length }));
  await post('/birlestir', { uploadId: y.uploadId, parts: y.parts });
  await devam.durumSil(y.durumYolu);
  process.exit(0);
})().catch((e) => { console.error('COCUK-HATA', e.message); process.exit(3); });
