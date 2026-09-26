'use strict';

/**
 * G KANALI ÖRTÜ — ÜÇ DURUMLU UÇTAN UCA TEST (https + dosyadaki TEST anahtarı), 2026-09-26.
 *
 * Yerel bir HTTPS sunucusu (bu koşuda üretilen tek kullanımlık sertifika, SAN IP:127.0.0.1)
 * manifesti `~/.empp-agent/test-guncelleme-ed25519.key` TEST anahtarıyla imzalayıp yayınlar.
 * İstemci AYRI bir Node sürecinde, güncelleyicinin GERÇEK taşımasıyla (https.get, sertifika
 * doğrulaması AÇIK; test sertifikası yalnız NODE_EXTRA_CA_CERTS ile güvenilir) koşar.
 *   (1) imzalı manifest → index + bookN/43e23 güncellenir, bir kitap eklenir, bir kitap çıkarılır
 *   (2) manifest yok → hiçbir şey olmaz (örtü dizini bile oluşmaz, hata yok)
 *   (3) imza bozuk → reddedilir
 * mac düzeni (userData örtüsü) ve Pardus düzeni (kurulum/resources örtüsü) ayrı ayrı koşar.
 * Anahtar dosyasının İÇERİĞİ hiçbir yere basılmaz; yoksa test atlanır (üretim anahtarı ASLA).
 */

const test = require('node:test');
const assert = require('node:assert');
const https = require('node:https');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const kg = require('./kitap-guncelleyici');
const Y = require('./kitap-guncelleyici-ortu.yardimci');

const ANAHTAR_YOLU = process.env.EMPP_TEST_GUNCELLEME_ANAHTARI
  || path.join(os.homedir(), '.empp-agent', 'test-guncelleme-ed25519.key');

function hazirlik() {
  if (!fs.existsSync(ANAHTAR_YOLU)) return { atla: `TEST anahtarı yok (${ANAHTAR_YOLU})` };
  let ozel;
  try { ozel = crypto.createPrivateKey(fs.readFileSync(ANAHTAR_YOLU)); } catch (e) { return { atla: 'TEST anahtarı okunamadı' }; }
  if (ozel.asymmetricKeyType !== 'ed25519') return { atla: 'TEST anahtarı ed25519 değil' };
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'g-ortu-tls-'));
  const anahtar = path.join(dizin, 'tls-anahtar.pem');
  const sertifika = path.join(dizin, 'tls-sertifika.pem');
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
      '-nodes', '-keyout', anahtar, '-out', sertifika, '-days', '1', '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  } catch (e) { return { atla: 'openssl yok — test sertifikası üretilemedi' }; }
  return {
    acik: crypto.createPublicKey(ozel).export({ type: 'spki', format: 'der' }).toString('base64'),
    imzala: (b) => crypto.sign(null, Buffer.from(b), ozel).toString('base64'),
    tls: { key: fs.readFileSync(anahtar), cert: fs.readFileSync(sertifika) },
    sertifika,
  };
}
const H = hazirlik();

async function httpsSunucu(rotalar) {
  const sayac = { yollar: [] };
  const s = https.createServer(H.tls, (istek, yanit) => {
    const yol = decodeURIComponent(istek.url.split('?')[0]);
    sayac.yollar.push(yol);
    const r = rotalar[yol];
    if (r == null) { yanit.statusCode = 404; yanit.end('yok'); return; }
    const g = Buffer.isBuffer(r) ? r : Buffer.from(typeof r === 'string' ? r : JSON.stringify(r));
    yanit.setHeader('content-length', String(g.length));
    yanit.end(g);
  });
  await new Promise((c) => s.listen(0, '127.0.0.1', c));
  return { taban: 'https://127.0.0.1:' + s.address().port, sayac, kapat: () => new Promise((c) => s.close(c)) };
}

/** Taban paket: mac → düz paket kökü; pardus → <kurulum>/resources/app (asar'ın yerine). */
function duzenKur(duzen) {
  const kurulum = fs.mkdtempSync(path.join(os.tmpdir(), `g-ortu-e2e-${duzen}-`));
  const kok = duzen === 'pardus' ? path.join(kurulum, 'resources', 'app') : path.join(kurulum, 'SM2.app-app');
  const ortuKoku = duzen === 'pardus'
    ? path.join(kurulum, 'resources', kg.ORTU_DIZIN_ADI)
    : path.join(kurulum, 'Library', 'Application Support', 'SM2 Set', kg.ORTU_DIZIN_ADI);
  const dosyalar = {
    'index.html': '<html>ESKI MENU</html>',
    'config/settings.json': '{"books":{"book1":{},"book2":{}}}',
    'book1/index.html': '<html>kitap1</html>',
    'book1/43e23fce2b7009474555a77.js': '/* motor v1 */',
    'book2/index.html': '<html>kitap2</html>',
    'book2/43e23fce2b7009474555a77.js': '/* motor v1 */',
  };
  for (const [y, v] of Object.entries(dosyalar)) {
    fs.mkdirSync(path.dirname(path.join(kok, y)), { recursive: true });
    fs.writeFileSync(path.join(kok, y), v);
  }
  fs.writeFileSync(path.join(kok, 'empp-set.json'), JSON.stringify({
    sema: 2, setKimligi: '74390', taban: 'https://panel-yok.invalid/set-guncelleme',
    imza: { alg: 'ed25519', acikAnahtar: H.acik },
  }));
  return { kurulum, kok, ortuKoku };
}

/** İstemci AYRI süreçte; ASENKRON (spawnSync bu sürecin olay döngüsünü — yani https sunucusunu —
 *  kilitler, istemci zaman aşımına düşer; 26.09 ilk koşuda tam bu oldu). */
function istemci(d, taban, { guvenilirSertifika = true } = {}) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  if (guvenilirSertifika) env.NODE_EXTRA_CA_CERTS = H.sertifika; else delete env.NODE_EXTRA_CA_CERTS;
  return new Promise((coz) => {
    const c = spawn(process.execPath, [path.join(__dirname, 'kitap-guncelleyici-ortu.e2e-istemci.js'),
      JSON.stringify({ kok: d.kok, ortuKoku: d.ortuKoku, taban })], { env });
    let out = ''; let err = '';
    const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch (e) {} }, 90000);
    c.stdout.on('data', (b) => { out += b; });
    c.stderr.on('data', (b) => { err += b; });
    c.on('close', (kod) => {
      clearTimeout(t);
      let rapor = {};
      try { rapor = JSON.parse(out || '{}'); } catch (e) { rapor = { ham: out }; }
      coz({ kod, stderr: err, rapor });
    });
  });
}

const YENI_INDEX = '<html>YENI MENU v2 — G</html>';
const YENI_MOTOR = '/* 43e23 motor v2 (kanonik) */';
function yayin(taban, ek = {}) {
  return Y.yayinRotalari(Object.assign({
    tabanUrl: taban, imzala: H.imzala, setKimligi: '74390', surum: '2.90.2',
    kabuk: {
      'index.html': YENI_INDEX,
      'config/settings.json': '{"books":{"book1":{},"book3":{}}}',
      'book1/43e23fce2b7009474555a77.js': YENI_MOTOR,
    },
    kitaplar: [
      { dizin: 'book2', durum: 'cikar' },
      { dizin: 'book3', durum: 'ekle', dosyalar: { 'index.html': '<html>kitap3</html>', 'assets/9/pages/1.png': 'PNG9' } },
    ],
  }, ek));
}

for (const duzen of ['mac', 'pardus']) {
  test(`E2E-${duzen} (1): imzalı manifest → index + book1/43e23 örtüde, book3 eklendi, book2 çıkarıldı; gövde aynı`,
    { skip: H.atla || false }, async () => {
      const d = duzenKur(duzen);
      const once = Y.agacOzeti(d.kok);
      const s = await Y.sunucuKurVeYayinla(httpsSunucu, (t) => yayin(t));
      let c;
      try { c = await istemci(d, s.taban); } finally { await s.kapat(); }
      assert.strictEqual(c.kod, 0, c.stderr);
      assert.strictEqual(c.rapor.durum, 'guncellendi', JSON.stringify(c.rapor));
      assert.strictEqual(c.rapor.mod, 'ortu');
      assert.ok(c.rapor.taban.startsWith('https://'), 'taşıma https olmalı');
      assert.deepStrictEqual(c.rapor.eklenen, ['book3']);
      assert.deepStrictEqual(c.rapor.cikarilan, ['book2']);
      assert.deepStrictEqual(Y.agacOzeti(d.kok), once, 'kurulu paket gövdesi değişmemeli');
      if (duzen === 'pardus') {
        assert.strictEqual(path.dirname(d.ortuKoku), path.dirname(d.kok), 'örtü kurulum dizininde (resources/)');
      }
      const dur = kg.ortuDurumuYukle({ kok: d.kok, ortuKoku: d.ortuKoku });
      assert.strictEqual(dur.gecerli, true, dur.sebep);
      const oku = (rel) => { const r = kg.ortuCoz(dur, rel); return r ? (r.tur === 'yok' ? 'YOK' : fs.readFileSync(r.yol, 'utf8')) : 'TABAN'; };
      assert.strictEqual(oku('index.html'), YENI_INDEX);
      assert.strictEqual(oku('book1/43e23fce2b7009474555a77.js'), YENI_MOTOR);
      assert.strictEqual(oku('book1/index.html'), 'TABAN');
      assert.strictEqual(oku('book2/index.html'), 'YOK');
      assert.strictEqual(oku('book2/43e23fce2b7009474555a77.js'), 'YOK');
      assert.strictEqual(oku('book3/index.html'), '<html>kitap3</html>');
      assert.strictEqual(oku('book3/assets/9/pages/1.png'), 'PNG9');
    });

  test(`E2E-${duzen} (2): manifest yok → hiçbir şey olmaz (hata yok, örtü dizini yok)`,
    { skip: H.atla || false }, async () => {
      const d = duzenKur(duzen);
      const once = Y.agacOzeti(d.kok);
      const s = await Y.sunucuKurVeYayinla(httpsSunucu, () => ({}));
      let c;
      try { c = await istemci(d, s.taban); } finally { await s.kapat(); }
      assert.strictEqual(c.kod, 0);
      assert.strictEqual(c.stderr, '', 'hata çıktısı olmamalı');
      assert.strictEqual(c.rapor.durum, 'atlandi');
      assert.match(c.rapor.sebep, /^surum-alinamadi:durum-404/);
      assert.strictEqual(c.rapor.hata, '');
      assert.deepStrictEqual(s.sayac.yollar, ['/set/74390/surum.json'], 'yalnız tek tetik isteği');
      assert.strictEqual(fs.existsSync(d.ortuKoku), false);
      assert.deepStrictEqual(Y.agacOzeti(d.kok), once);
    });

  test(`E2E-${duzen} (3): imza bozuk → reddedilir, örtüye hiçbir şey yazılmaz`,
    { skip: H.atla || false }, async () => {
      const d = duzenKur(duzen);
      const s = await Y.sunucuKurVeYayinla(httpsSunucu, (t) => yayin(t, { imzaBoz: true }));
      let c;
      try { c = await istemci(d, s.taban); } finally { await s.kapat(); }
      assert.strictEqual(c.rapor.sebep, 'manifest-alinamadi:manifest-imzasi-gecersiz');
      assert.ok(!s.sayac.yollar.some((y) => y.includes('/dosya/') || y.includes('/arsiv/')), 'dosya indirilmemeli');
      assert.strictEqual(fs.existsSync(d.ortuKoku), false);
      assert.strictEqual(kg.ortuDurumuYukle({ kok: d.kok, ortuKoku: d.ortuKoku }).gecerli, false);
    });
}

test('E2E: sertifika doğrulaması AÇIK — güvenilmeyen sertifikalı sunucudan hiçbir şey alınmaz',
  { skip: H.atla || false }, async () => {
    const d = duzenKur('mac');
    const s = await Y.sunucuKurVeYayinla(httpsSunucu, (t) => yayin(t));
    let c;
    try { c = await istemci(d, s.taban, { guvenilirSertifika: false }); } finally { await s.kapat(); }
    assert.strictEqual(c.rapor.durum, 'atlandi');
    assert.match(c.rapor.sebep, /^surum-alinamadi:/);
    assert.strictEqual(fs.existsSync(d.ortuKoku), false);
  });
