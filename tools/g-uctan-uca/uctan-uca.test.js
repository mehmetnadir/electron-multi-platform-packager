'use strict';

/**
 * Uçtan uca koşumun kendisini sınar: hazirla (geçici anahtar, geçici dizin, boş port) →
 * gerçek HTTPS sunucusu → bugünkü Windows istemcisi dokuz senaryoda. openssl yoksa atlanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { execFileSync } = require('child_process');
const { hazirla } = require('./hazirla');
const { kos } = require('./kos');
const { sunucuBaslat, tlsOku, istekHedefi } = require('./sunucu');
const { agaciDogrula, beklenenOku } = require('./dogrula');
const o = require('./ortak');

function opensslVarMi() {
  try {
    execFileSync(process.env.OPENSSL || 'openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function bosPort() {
  return new Promise((coz) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => coz(p));
    });
  });
}

function getir(port, yol, ca) {
  return new Promise((coz, red) => {
    https
      .get({ host: '127.0.0.1', port, path: yol, ca }, (y) => {
        const p = [];
        y.on('data', (d) => p.push(d));
        y.on('end', () => coz({ durum: y.statusCode, govde: Buffer.concat(p) }));
      })
      .on('error', red);
  });
}

test('istekHedefi: yalnız /<senaryo>/guncelleme/set/…; kaçış 400', () => {
  const kok = '/k';
  assert.equal(
    istekHedefi(kok, '/gecerli/guncelleme/set/99901/surum.json').hedef,
    '/k/gecerli/set/99901/surum.json',
  );
  assert.equal(istekHedefi(kok, '/saglik').saglik, true);
  // URL ayrıştırıcı `..` ve `%2e%2e`'yi önceden çözer; kodlanmış `/` ile gelen `..` 400 alır.
  assert.equal(istekHedefi(kok, '/gecerli/guncelleme/set/99901/..%2F..%2F..%2Fx').durum, 400);
  for (const u of [
    '/gecerli/guncelleme/set/99901/../../x',
    '/gecerli/guncelleme/set/99901/%2e%2e/%2e%2e/x',
    '/gecerli/guncelleme/set/%2e%2e/%2e%2e/%2e%2e/etc/hosts',
  ]) {
    const h = istekHedefi(kok, u);
    assert.ok(!h.hedef || h.hedef.startsWith('/k/gecerli/set/'), `${u} → ${JSON.stringify(h)}`);
  }
  assert.equal(istekHedefi(kok, '/gecerli/guncelleme/yayin/x').durum, 404);
  assert.equal(istekHedefi(kok, '/_gizli/guncelleme/set/1/a').durum, 404);
  assert.equal(istekHedefi(kok, '/%E0%A4%A').durum, 400);
});

test(
  'hazirla + kos: zorunlu senaryolar geçer, bilinen açıklar AÇIK raporlanır',
  { skip: !opensslVarMi() && 'openssl yok', timeout: 180000 },
  async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'g-uu-'));
    const anahtarYolu = path.join(d, 'test.key');
    fs.writeFileSync(
      anahtarYolu,
      crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
    );
    const port = await bosPort();
    const h = await hazirla({ dizin: path.join(d, 'k'), port, anahtarDosya: anahtarYolu });
    assert.equal(h.sonSurum, '2.90.3');
    assert.equal(h.senaryolar.length, o.SENARYOLAR.length);
    const set = JSON.parse(fs.readFileSync(path.join(h.kurulu, 'empp-set.json'), 'utf8'));
    assert.equal(set.imza.acikAnahtar, h.acikAnahtar);

    // TLS: ca.pem ile güvenilen gerçek https; ca'sız istek reddedilir.
    const s = await sunucuBaslat({
      dizin: h.dizin,
      port: 0,
      tls: tlsOku(h.dizin),
      gunluk: () => {},
    });
    try {
      const ca = fs.readFileSync(h.tls.ca);
      const r = await getir(s.port, `/gecerli/guncelleme/set/${o.SET_KIMLIGI}/surum.json`, ca);
      assert.equal(r.durum, 200);
      assert.equal(JSON.parse(r.govde).surum, '2.90.3');
      await assert.rejects(
        getir(s.port, '/saglik', undefined),
        /self.signed|unable to verify|certificate/i,
      );
    } finally {
      await s.kapat();
    }

    // İki kip: Windows (yerinde) ve mac/Pardus (örtü, EMPP_G_ORTU_KOKU). Açıklar 26.09'da kapandı:
    // her senaryo her kipte zorunlu ve GEÇMELİ.
    for (const kip of ['yerinde', 'ortu']) {
      const k = await kos({ dizin: h.dizin, kip });
      const bul = (ad) => k.sonuclar.find((x) => x.senaryo === ad);
      assert.equal(k.gecti, true, kip + ': ' + JSON.stringify(k.sonuclar, null, 1));
      assert.equal(k.sonuclar.length, o.SENARYOLAR.length);
      for (const x of k.sonuclar) assert.equal(x.sonuc, 'GEÇTİ', kip + ':' + x.senaryo);
      assert.equal(bul('gecerli').ikinci, 'guncel (1 istek)');
      assert.match(bul('geri-alma-tetik').sebep, /^manifest-reddedildi:surum-eski$/);
      assert.match(bul('baska-set-tetik').sebep, /^manifest-reddedildi:baska-set$/);
    }

    // dogrula.js: kurulu ağaç 'degismez' kipinde geçer, 'tam' kipinde kalır.
    const b = beklenenOku(h.dizin);
    assert.equal(agaciDogrula(h.kurulu, b, 'degismez').gecti, true);
    const tam = agaciDogrula(h.kurulu, b, 'tam');
    assert.equal(tam.gecti, false);
    assert.deepEqual(tam.olmamaliVar, ['book3']);
  },
);
