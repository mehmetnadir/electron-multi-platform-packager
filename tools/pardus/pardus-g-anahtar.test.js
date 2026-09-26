'use strict';

/**
 * G AÇIK ANAHTARI Pardus Docker yoluna geçer mi? (2026-09-26)
 *
 * Ölçülen arıza: `EMPP_GUNCELLEME_ACIK_ANAHTAR` konteynere `-e` ile geçmiyordu → paketin
 * `empp-set.json`'una imza anahtarı gömülmüyor, Pardus'ta G kanalı sessizce KAPALI kalıyordu.
 * Bu test betiği GERÇEKTEN koşturur (sahte `docker` PATH'te, argümanlarını kaydeder) ve paketleyici
 * konteynerinin komut satırında (1) açık anahtarın geçtiğini, (2) özel anahtar / .pem / .key /
 * anahtar dizini adının GEÇMEDİĞİNİ doğrular. Runner tarafı: `pardusBetikEnv` (runner-helpers).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pardusBetikEnv } = require('../../src/agent/runner-helpers');

const BETIK = path.join(__dirname, 'pardus-packager-build.sh');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const ACIK = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const OZEL_DER = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const OZEL_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

/** Betiği sahte docker ile koşturur; paketleyici `docker run`ının argümanlarını döner. */
function kos(ekEnv) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pardus-g-'));
  const bin = path.join(d, 'bin');
  fs.mkdirSync(bin);
  const kayit = path.join(d, 'docker-args');
  // Sahte docker: her çağrıyı NUL ayrımlı kaydeder; paketleyici run'ı (--name pardus-pack-*) rc=7.
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/bash
{ printf '%s\\0' "$@"; printf '\\n--CAGRI--\\n'; } >> ${JSON.stringify(kayit)}
for a in "$@"; do case "$a" in pardus-pack-*) exit 7;; debian:12-slim) echo binfmt-ok;; esac; done
exit 0
`, { mode: 0o755 });
  const girdi = path.join(d, 'build');
  fs.mkdirSync(girdi);
  fs.writeFileSync(path.join(girdi, 'index.html'), '<html></html>');
  const r = spawnSync('bash', [BETIK, girdi, 'GTest', path.join(d, 'cikti'), '2.5.3'], {
    encoding: 'utf8',
    timeout: 60000,
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: d,
      PARDUS_PARALEL: '1',
      PARDUS_MIN_FREE_GB: '0',
      ...ekEnv,
    },
  });
  const cagrilar = fs.existsSync(kayit)
    ? fs.readFileSync(kayit, 'utf8').split('\n--CAGRI--\n').filter(Boolean).map((c) => c.split('\0').filter(Boolean))
    : [];
  const paket = cagrilar.find((c) => c.some((a) => a.startsWith('pardus-pack-')));
  return { r, paket, d };
}

test('pardus Docker: G açık anahtarı paketleyici konteynerine -e ile GEÇER', () => {
  const { r, paket } = kos({ EMPP_GUNCELLEME_ACIK_ANAHTAR: ACIK });
  assert.ok(paket, `paketleyici docker run çağrılmadı: ${r.stdout}\n${r.stderr}`);
  const i = paket.indexOf(`EMPP_GUNCELLEME_ACIK_ANAHTAR=${ACIK}`);
  assert.ok(i > 0 && paket[i - 1] === '-e', 'açık anahtar -e ile geçmeli');
});

test('pardus Docker: özel anahtar / .pem / .key / anahtar dizini komut satırına GİRMEZ', () => {
  const { paket } = kos({
    EMPP_GUNCELLEME_ACIK_ANAHTAR: ACIK,
    // Tuzak: ortamda özel anahtar ve anahtar dosyası yolları olsa bile konteynere geçmemeli.
    EMPP_GUNCELLEME_OZEL_ANAHTAR: OZEL_DER,
    EMPP_G_ANAHTAR_PEM: OZEL_PEM,
    EMPP_G_ANAHTAR_DOSYASI: '/Users/x/.empp-agent/test-guncelleme-ed25519.key',
    SSL_KEY_FILE: '/etc/ssl/ozel.pem',
  });
  assert.ok(paket, 'paketleyici docker run çağrılmalı');
  const hepsi = paket.join(' ');
  assert.ok(!hepsi.includes(OZEL_DER), 'özel anahtar DER geçmemeli');
  assert.ok(!/PRIVATE KEY/.test(hepsi), 'PEM geçmemeli');
  assert.ok(!/\.pem\b|\.key\b/.test(hepsi), '.pem/.key adı geçmemeli');
  assert.ok(!/\.empp-agent/.test(hepsi), 'anahtar dizini bağlanmamalı');
  const eAdlari = paket.filter((a, j) => paket[j - 1] === '-e').map((a) => a.split('=')[0]);
  for (const ad of eAdlari) assert.doesNotMatch(ad, /OZEL|PRIVATE|SECRET|GIZLI|PEM|DOSYA/i, `şüpheli -e: ${ad}`);
});

test('pardus Docker: anahtar yoksa boş geçer (paketleyici G\'yi sebebiyle kapatır), betik düşmez', () => {
  const { paket } = kos({});
  assert.ok(paket);
  assert.ok(paket.includes('EMPP_GUNCELLEME_ACIK_ANAHTAR='), 'boş değer açıkça geçmeli (host sızıntısı yok)');
});

test('pardusBetikEnv: geçerli ed25519 AÇIK anahtar geçer (kırpılır), diğerleri geçer', () => {
  const r = pardusBetikEnv({ EMPP_GUNCELLEME_ACIK_ANAHTAR: `  ${ACIK}\n`, PATH: '/bin' });
  assert.equal(r.sebep, '');
  assert.equal(r.gAnahtari, ACIK);
  assert.equal(r.env.EMPP_GUNCELLEME_ACIK_ANAHTAR, ACIK);
  assert.equal(r.env.PATH, '/bin');
});

test('pardusBetikEnv: özel anahtar (DER/PEM), RSA, bozuk ve boş değer DÜŞÜRÜLÜR — sebep döner', () => {
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey
    .export({ type: 'spki', format: 'der' }).toString('base64');
  const vakalar = [
    [OZEL_DER, 'gecersiz'],
    [OZEL_PEM, 'ozel-anahtar-ya-da-pem'],
    [rsa, 'ed25519-degil'],
    ['bozuk!!', 'gecersiz'],
    ['   ', 'yok'],
    [undefined, 'yok'],
  ];
  for (const [deger, sebep] of vakalar) {
    const r = pardusBetikEnv(deger === undefined ? {} : { EMPP_GUNCELLEME_ACIK_ANAHTAR: deger });
    assert.equal(r.sebep, sebep, String(deger).slice(0, 20));
    assert.equal(r.gAnahtari, null);
    assert.ok(!('EMPP_GUNCELLEME_ACIK_ANAHTAR' in r.env), 'geçersiz değer ortamdan çıkarılmalı');
  }
});

test('runner: pardus betiği pardusBetikEnv ortamıyla koşar (kaynak sentineli)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'agent', 'runner.js'), 'utf8');
  const fn = src.slice(src.indexOf('function runPardusScript'), src.indexOf('function runKabulBetigi'));
  assert.match(fn, /const pe = pardusBetikEnv\(process\.env\);/);
  assert.match(fn, /spawn\('nice', \['-n', '10', CONFIG\.pardusBuildScript, \.\.\.args\], \{ env: pe\.env \}\)/);
});
