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
const { pardusBetikEnv, pardusGKimligi, PARDUS_G_ENV } = require('../../src/agent/runner-helpers');
const { jobInfoKur } = require('./packager-run-linux');

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
      EMPP_KANONIK_SART: '0', // bu test G kimliğini sınar; kabuk fail-closed ayrı testte
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
  assert.match(fn, /const pe = pardusBetikEnv\(process\.env, job\);/);
  assert.match(fn, /spawn\('nice', \['-n', '10', CONFIG\.pardusBuildScript, \.\.\.args\], \{ env: pe\.env \}\)/);
});

// ─── CLAIM G KİMLİĞİ (2026-09-26): setKimligi + guncellemeTabani + surum konteynere ───
// Ölçülen: Docker pardus yolunda paketleyiciye giden jobInfo'da (packager-run-linux.js) bu alanlar
// YOKTU, appVersion hep '1.0.0' → Pardus empp-set.json'unda setKimligi null, taban yer tutucu.
const KIMLIK = { setKimligi: '74390', guncellemeTabani: 'https://g.example.org/set-guncelleme', surum: '2.90.3' };
const eEnv = (paket) => {
  const o = {};
  paket.forEach((a, j) => { if (paket[j - 1] === '-e') { const i = a.indexOf('='); o[a.slice(0, i)] = a.slice(i + 1); } });
  return o;
};

test('pardus Docker: claim G kimliği (set/taban/sürüm) paketleyici konteynerine -e ile GEÇER', () => {
  const pe = pardusBetikEnv({ EMPP_GUNCELLEME_ACIK_ANAHTAR: ACIK }, KIMLIK);
  assert.deepEqual(pe.gSebepler, []);
  const { r, paket } = kos(pe.env);
  assert.ok(paket, `paketleyici docker run çağrılmadı: ${r.stdout}\n${r.stderr}`);
  const e = eEnv(paket);
  assert.equal(e.EMPP_G_SET_KIMLIGI, '74390');
  assert.equal(e.EMPP_G_GUNCELLEME_TABANI, 'https://g.example.org/set-guncelleme');
  assert.equal(e.EMPP_G_SURUM, '2.90.3');
  assert.equal(e.EMPP_GUNCELLEME_ACIK_ANAHTAR, ACIK);
});

test('ZİNCİR: runner → betik -e → konteyner jobInfo → empp-set.json → enjeksiyon kararı "hazir"', async () => {
  const pe = pardusBetikEnv({ EMPP_GUNCELLEME_ACIK_ANAHTAR: ACIK }, KIMLIK);
  const { paket } = kos(pe.env);
  const konteynerEnv = eEnv(paket);
  const argv = paket.slice(paket.indexOf('packager-linux:2') + 1); // "$APP_NAME" "$VER" "$JOB"
  assert.deepEqual(argv.slice(0, 2), ['GTest', '2.5.3']);
  const ji = jobInfoKur(['s-1', argv[0], argv[1]], konteynerEnv);
  assert.equal(ji.setKimligi, '74390');
  assert.equal(ji.guncellemeTabani, 'https://g.example.org/set-guncelleme');
  assert.equal(ji.surum, '2.90.3');
  // packagingService'in paketeYaz çağrısıyla aynı alanlar (konteynerin env'i ile).
  const sk = require('../../src/packaging/set-kimligi');
  const ge = require('../../src/packaging/guncelleyici-enjekte');
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'pardus-g-zincir-'));
  fs.writeFileSync(path.join(kok, 'index.html'), '<html></html>');
  const { harita } = await sk.paketeYaz(kok, {
    setKimligi: ji.setKimligi, guncellemeTabani: ji.guncellemeTabani, surum: ji.surum,
    env: konteynerEnv, damga: 0,
  });
  assert.equal(harita.setKimligi, '74390');
  assert.equal(harita.tabanKaynagi, 'istek');
  assert.equal(harita.surum, '2.90.3');
  assert.equal(harita.imza && harita.imza.acikAnahtar, ACIK, 'açık anahtar konteyner env\'inden gömülmeli');
  assert.deepEqual(ge.enjeksiyonKarari(harita), { enjekte: true, sebep: 'hazir' });
});

test('ZİNCİR: claim taban taşımıyorsa konteynerde yer tutucu yazılır ve G ENJEKTE EDİLMEZ', async () => {
  const pe = pardusBetikEnv({ EMPP_GUNCELLEME_ACIK_ANAHTAR: ACIK }, { setKimligi: '74390', surum: '2.90.3' });
  assert.deepEqual(pe.gSebepler, ['taban-yok']);
  const { paket } = kos(pe.env);
  const konteynerEnv = eEnv(paket);
  assert.equal(konteynerEnv.EMPP_G_GUNCELLEME_TABANI, '', 'boş geçer — host sızıntısı yok');
  const ji = jobInfoKur(['s-1', 'GTest', '1.0.0'], konteynerEnv);
  assert.equal(ji.guncellemeTabani, null);
  const sk = require('../../src/packaging/set-kimligi');
  const ge = require('../../src/packaging/guncelleyici-enjekte');
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'pardus-g-zincir-'));
  const { harita } = await sk.paketeYaz(kok, { ...ji, env: konteynerEnv, damga: 0 });
  assert.equal(harita.taban, sk.VARSAYILAN_TABAN);
  assert.deepEqual(ge.enjeksiyonKarari(harita), { enjekte: false, sebep: 'taban-yok' });
});

test('pardusGKimligi: geçersiz alanlar düşer + sebep; yer tutucu / kimlik bilgili / uzak http taban reddedilir', () => {
  const v = (job) => pardusGKimligi(job);
  assert.deepEqual(v(KIMLIK), { kimlik: { ...KIMLIK }, sebepler: [] });
  assert.equal(v({ ...KIMLIK, guncellemeTabani: 'https://g.example.org/x///' }).kimlik.guncellemeTabani, 'https://g.example.org/x');
  assert.deepEqual(v({}).sebepler, ['set-kimligi-yok', 'taban-yok', 'surum-yok']);
  assert.deepEqual(v({ ...KIMLIK, setKimligi: '../etc' }).sebepler, ['set-kimligi-gecersiz']);
  assert.deepEqual(v({ ...KIMLIK, guncellemeTabani: 'https://panel-yok.invalid/set-guncelleme' }).sebepler, ['taban-yer-tutucu']);
  assert.deepEqual(v({ ...KIMLIK, guncellemeTabani: 'https://u:p@g.example.org/s' }).sebepler, ['taban-kimlik-bilgisi-tasiyor']);
  assert.deepEqual(v({ ...KIMLIK, guncellemeTabani: 'http://g.example.org/s' }).sebepler, ['taban-gecersiz']);
  assert.deepEqual(v({ ...KIMLIK, guncellemeTabani: 'ftp://g.example.org/s' }).sebepler, ['taban-gecersiz']);
  assert.deepEqual(v({ ...KIMLIK, surum: '1.0.0' }).sebepler, ['surum-gecersiz']);
  assert.equal(v({ ...KIMLIK, guncellemeTabani: 'http://127.0.0.1:8453/s' }).kimlik.guncellemeTabani, 'http://127.0.0.1:8453/s');
});

test('pardusBetikEnv: G kimliği YALNIZ claim\'den — ajan ortamındaki eski EMPP_G_* değerleri silinir', () => {
  const kirli = { EMPP_G_SET_KIMLIGI: '11111', EMPP_G_GUNCELLEME_TABANI: 'https://eski.example/x', EMPP_G_SURUM: '2.1.1' };
  const r = pardusBetikEnv(kirli, { setKimligi: '74390' });
  assert.equal(r.env.EMPP_G_SET_KIMLIGI, '74390');
  assert.ok(!('EMPP_G_GUNCELLEME_TABANI' in r.env));
  assert.ok(!('EMPP_G_SURUM' in r.env));
  assert.deepEqual(Object.values(PARDUS_G_ENV).sort(), ['EMPP_G_GUNCELLEME_TABANI', 'EMPP_G_SET_KIMLIGI', 'EMPP_G_SURUM']);
});

test('pardusGKimligi deseni set-kimligi KIMLIK_DESENI ile AYNI; betik -e adları PARDUS_G_ENV ile AYNI', () => {
  const sk = require('../../src/packaging/set-kimligi');
  for (const d of ['74390', 'SET-x_1.2:3', 'a'.repeat(64), 'a'.repeat(65), '', '../x', 'a b', 'ş']) {
    assert.equal(pardusGKimligi({ setKimligi: d }).kimlik.setKimligi !== null, d.trim() !== '' && sk.KIMLIK_DESENI.test(d), d);
  }
  const betik = fs.readFileSync(BETIK, 'utf8');
  for (const ad of Object.values(PARDUS_G_ENV)) assert.match(betik, new RegExp(`-e ${ad}="\\$\\{${ad}:-\\}"`));
  const pr = fs.readFileSync(path.join(__dirname, 'packager-run-linux.js'), 'utf8');
  for (const ad of Object.values(PARDUS_G_ENV)) assert.ok(pr.includes(`'${ad}'`), `packager-run-linux ${ad} okumuyor`);
});

test('runner: pardus dalı claim kimliğini buildPardusArtifact → runPardusScript\'e taşır (kaynak sentineli)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'agent', 'runner.js'), 'utf8');
  const b = src.slice(src.indexOf('async function buildPardusArtifact'), src.indexOf('async function pardusKabulKapisi'));
  assert.match(b, /runPardusScript\(\[zipPath, appName, outDir, appVersion\], kimlik\)/);
  const d = src.slice(src.indexOf("if (packagerPlatform === 'pardus')"), src.indexOf("log('uploading build to packager...')"));
  assert.match(d, /setKimligi: job\.setKimligi, guncellemeTabani: job\.guncellemeTabani, surum: job\.surum/);
});
