'use strict';

/**
 * G UÇTAN UCA — Electron istemcileri için ikinci TLS zinciri (26.09 canlı kanıt:
 * ~/.empp-agent/arastirma/g-istemci-canli-kanit-20260926.md). İki bulgu:
 *   1) Fikstürün ad-kısıtlı (IP nameConstraints) CA'sı Electron/BoringSSL'de
 *      "unsupported name constraint type" ile reddediliyor.
 *   2) Electron'un node kipinde `NODE_EXTRA_CA_CERTS` uygulanmıyor.
 * Bu dosya `tlsHazirlaElectron`in ürettiği KISITSIZ, KISA ÖMÜRLÜ (≤7 gün) ikinci zincirin
 * (a) gerçek TLS ile doğrulandığını, (b) doğrulamayı GENEL olarak KAPATMADIĞINI (ca'sız istek
 * hâlâ reddedilir — `NODE_TLS_REJECT_UNAUTHORIZED=0` / `--ignore-certificate-errors` YOK) ve
 * (c) asıl kök nedenin (nameConstraints) bu zincirde GERÇEKTEN kaldırıldığını sınar.
 * Gerçek bir Electron süreci başlatmaz: bu paket Electron'a bağımlı değil (repo `package.json`
 * `electron`u yalnız betik olarak çağırır, bağımlı DEĞİL — `require.resolve('electron')` başarısız
 * olabilir) ve GUI/offscreen bir Electron koşumu `~/.empp-agent/agir.sh` + odak-güvenli kabul
 * altyapısı ister (bkz. tools/kabul); bu, bir fikstür-üretici birim testinin kapsamı DIŞINDA.
 * Bunun yerine Node düzeyinde zincir doğrulaması yapılır — Electron'un node kipi (ELECTRON_RUN_AS_NODE=1)
 * zaten Node'un kendi `https`/`tls` modülünü kullanıyor (canlı kanıtta `https.globalAgent.options.ca`
 * ile doğrulandı); burada aynı doğrulama yolunu (açık `ca` seçeneğiyle `https.get`) sınıyoruz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const { tlsHazirla, tlsHazirlaElectron, ELECTRON_CA_GUN } = require('./hazirla');
const { sunucuBaslat } = require('./sunucu');

function opensslVarMi() {
  try {
    execFileSync(process.env.OPENSSL || 'openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function opensslMetni(args) {
  return execFileSync(process.env.OPENSSL || 'openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    .toString('utf8');
}

function getir(port, yol, ca) {
  return new Promise((coz, red) => {
    https
      .get({ host: '127.0.0.1', port, path: yol, ca, timeout: 5000 }, (y) => {
        const p = [];
        y.on('data', (d) => p.push(d));
        y.on('end', () => coz({ durum: y.statusCode, govde: Buffer.concat(p) }));
      })
      .on('error', red);
  });
}

test(
  'tlsHazirlaElectron: nameConstraints YOK, ad-kısıtlı zincir DEĞİŞMEDEN kalır, ≤7 gün ömür',
  { skip: !opensslVarMi() && 'openssl yok' },
  () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'g-uu-tls-'));
    const tls = tlsHazirla(d);
    const tlsE = tlsHazirlaElectron(d);

    // Kök neden: ad-kısıtlı (birincil) zincir nameConstraints TAŞIR — dokunulmadı.
    const metinAsil = opensslMetni(['x509', '-in', path.join(tls.dizin, 'ca.pem'), '-text', '-noout']);
    assert.match(metinAsil, /X509v3 Name Constraints/, 'birincil CA nameConstraints kaybetmiş');
    assert.match(metinAsil, /IP:127\.0\.0\.1\/255\.255\.255\.255/);

    // Electron zinciri: AYNI uzantı Electron'un reddettiği türden YOK.
    const metinE = opensslMetni(['x509', '-in', path.join(tlsE.dizin, 'ca.pem'), '-text', '-noout']);
    assert.doesNotMatch(
      metinE,
      /X509v3 Name Constraints/,
      'Electron CA hâlâ nameConstraints taşıyor — Electron/BoringSSL yine reddeder',
    );

    // Kısa ömür: notAfter şimdiden ELECTRON_CA_GUN gün + birkaç dakika toleransın ötesine geçmemeli.
    const bitis = opensslMetni(['x509', '-in', path.join(tlsE.dizin, 'ca.pem'), '-enddate', '-noout']);
    const tarih = new Date(bitis.trim().replace(/^notAfter=/, ''));
    const kalanGun = (tarih.getTime() - Date.now()) / 86400000;
    assert.ok(kalanGun > 0, `Electron CA zaten süresi dolmuş: ${bitis.trim()}`);
    assert.ok(
      kalanGun <= ELECTRON_CA_GUN + 0.01,
      `Electron CA ömrü ${ELECTRON_CA_GUN} günü aşıyor: ${kalanGun.toFixed(3)} gün`,
    );

    // Sunucu sertifikası aynı SAN kısıtına sahip (nameConstraints'ten bağımsız, leaf'in kendi SAN'ı).
    const sunucuMetni = opensslMetni(['x509', '-in', path.join(tlsE.dizin, 'sunucu.pem'), '-text', '-noout']);
    assert.match(sunucuMetni, /IP Address:127\.0\.0\.1, IP Address:10\.0\.2\.2, DNS:localhost/);

    // İdempotent: yeniden çağırınca (süresi dolmadan) aynı dosyaları KORUR.
    const oncekiPem = fs.readFileSync(path.join(tlsE.dizin, 'ca.pem'), 'utf8');
    const tekrar = tlsHazirlaElectron(d);
    assert.equal(tekrar.yeni, false);
    assert.equal(fs.readFileSync(path.join(tlsE.dizin, 'ca.pem'), 'utf8'), oncekiPem);

    fs.rmSync(d, { recursive: true, force: true });
  },
);

test(
  'tlsHazirlaElectron: gerçek https, açık `ca` ile doğrulanır — GENEL doğrulama kapatılmadan ' +
    '(Electron node kipinin `https.globalAgent.options.ca` yoluyla yapacağı doğrulamanın eşdeğeri)',
  { skip: !opensslVarMi() && 'openssl yok' },
  async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'g-uu-tls-e-'));
    fs.mkdirSync(path.join(d, 'senaryolar', 'gecerli', 'set', '1'), { recursive: true });
    const tlsE = tlsHazirlaElectron(d);
    const s = await sunucuBaslat({
      dizin: d,
      port: 0,
      tls: {
        key: fs.readFileSync(path.join(tlsE.dizin, 'sunucu.key')),
        cert: fs.readFileSync(path.join(tlsE.dizin, 'sunucu.pem')),
      },
      gunluk: () => {},
    });
    try {
      const ca = fs.readFileSync(path.join(tlsE.dizin, 'ca.pem'));
      // (a) CA açıkça verilirse GEÇERLİ — bağlantı kuruluyor, sertifika reddedilmiyor.
      const r = await getir(s.port, '/saglik', ca);
      assert.equal(r.durum, 200);
      assert.equal(JSON.parse(r.govde).gUctanUca, true);
      // (b) CA verilmezse hâlâ REDDEDİLİR — mekanizma doğrulamayı GENEL olarak KAPATMIYOR
      //     (NODE_TLS_REJECT_UNAUTHORIZED=0 / --ignore-certificate-errors yerine geçmiyor).
      await assert.rejects(getir(s.port, '/saglik', undefined), /self.signed|unable to verify|certificate/i);
    } finally {
      await s.kapat();
      fs.rmSync(d, { recursive: true, force: true });
    }
  },
);

test('TLS bypass izi yok: NODE_TLS_REJECT_UNAUTHORIZED / --ignore-certificate-errors test-dışı kodda yok', () => {
  const kok = path.resolve(__dirname, '..', '..');
  const yasakli = [/NODE_TLS_REJECT_UNAUTHORIZED/, /ignore-certificate-errors/, /rejectUnauthorized\s*:\s*false/];
  const dizinler = ['src', 'tools'];
  const bulgular = [];
  const tara = (d) => {
    let girdiler;
    try {
      girdiler = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const g of girdiler) {
      if (g.name === 'node_modules' || g.name.startsWith('.')) continue;
      const tam = path.join(d, g.name);
      if (g.isDirectory()) tara(tam);
      else if (g.isFile() && g.name.endsWith('.js') && !g.name.endsWith('.test.js')) {
        const icerik = fs.readFileSync(tam, 'utf8');
        for (const r of yasakli) if (r.test(icerik)) bulgular.push(`${path.relative(kok, tam)}: ${r}`);
      }
    }
  };
  for (const d of dizinler) tara(path.join(kok, d));
  assert.deepEqual(bulgular, [], bulgular.join('\n'));
});
