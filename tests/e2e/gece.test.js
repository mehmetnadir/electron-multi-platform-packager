'use strict';
/**
 * Gece koşusu sarmalayıcısı (tests/e2e/gece/e2e-gece.sh) — kuru koşu, sahte bildir.
 * Gerçek push ATILMAZ: bildir yerine argümanlarını kaydeden, gerçek sözleşmeyi (≥2 argüman)
 * zorlayan sahte betik verilir. launchd şablonu plutil ile doğrulanır; KURULMAZ.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const S = require('./sentetik');

const D = S.geciciDizin('gece');
const BETIK = path.join(__dirname, 'gece', 'e2e-gece.sh');
const SABLON = path.join(__dirname, 'gece', 'com.empp.e2e-saglik.plist.sablon');
const KAYIT = path.join(D, 'bildir-kayit.txt');
const KO = S.kesifOrtami(path.join(D, 'kesif'));
const AGIR_KAYIT = path.join(D, 'agir-kayit.txt');

// bildir sözleşmesi: bildir <kanal> <mesaj> [-p ...]; <2 argüman → kullanım + rc=2 (gerçeği gibi)
const BILDIR = S.betikYaz(
  path.join(D, 'bildir-sahte'),
  [
    '[ $# -ge 2 ] || { echo "kullanım: bildir <kanal> <mesaj>" >&2; exit 2; }',
    `printf '%s\\n' "$@" > "${KAYIT}"`,
    'exit "${STUB_BILDIR_RC:-0}"',
  ].join('\n'),
);
const AGIR = S.betikYaz(
  path.join(D, 'agir-sahte'),
  [
    `echo "$1" > "${AGIR_KAYIT}"`,
    'shift',
    '"$@"',
    'rc=$?',
    'echo "AGIR-EXIT=$rc etiket=sahte slot=1"',
    'exit $rc',
  ].join('\n'),
);
const KOSUCU = path.join(D, 'kosucu-sahte.js');
fs.writeFileSync(
  KOSUCU,
  [
    "const k = process.env.STUB_KOS || 'kaldi';",
    "if (k === 'gecti') { console.log('T1  GECTI\\nGENEL GECTI — /r/20260926-2200.md'); process.exit(0); }",
    "if (k === 'cokme') { console.log('Error: patladi'); process.exit(0); }",
    "console.log('T1  KALDI\\nT5  OLCULEMEDI\\nGENEL KALDI — /r/20260926-2200.md'); process.exit(1);",
  ].join('\n'),
);

function kos(kip, ek = {}) {
  fs.writeFileSync(KAYIT, '');
  fs.writeFileSync(AGIR_KAYIT, '');
  const env = {
    ...process.env,
    E2E_BILDIR: BILDIR,
    E2E_NODE: process.execPath,
    E2E_KOSUCU: KOSUCU,
    E2E_GECE_AGIR: '0',
    EMPP_E2E_DIZIN: path.join(D, 'rapor'),
    EMPP_E2E_CALISMA: path.join(D, 'calisma'),
    EMPP_E2E_AGIR: '0',
    ...KO.env,
    ...ek,
  };
  const r = spawnSync('/bin/bash', [BETIK, ...(kip ? [kip] : [])], {
    env,
    encoding: 'utf8',
    timeout: 60000,
  });
  const bildirim = fs.readFileSync(KAYIT, 'utf8').split('\n').filter(Boolean);
  return {
    rc: r.status,
    cikti: r.stdout + r.stderr,
    bildirim,
    agir: fs.readFileSync(AGIR_KAYIT, 'utf8').trim(),
  };
}

test('kuru koşu (gerçek koşucu, T5): rapor yazılır, özet bildir e2e ile iki+ argümanla, rc≠0 → yuksek', () => {
  const r = kos('aksam', {
    E2E_KOSUCU: path.join(__dirname, 'uctan-uca.js'),
    E2E_TESTLER_AKSAM: 'T5',
  });
  assert.equal(r.rc, 3, r.cikti);
  assert.equal(r.bildirim[0], 'e2e');
  assert.match(r.bildirim[1], /^e2e aksam OLCULEMEDI \(rc=3, \d+ sn\): T5 OLCULEMEDI — .+\.md$/);
  assert.deepEqual(r.bildirim.slice(2), ['-p', 'yuksek']);
  const md = r.bildirim[1].split(' — ').pop();
  const json = JSON.parse(fs.readFileSync(md.replace(/\.md$/, '.json'), 'utf8'));
  assert.equal(json.kuru, true, 'varsayılan kuru koşu');
  assert.equal(json.kitap, '74390');
  assert.match(json.sonuclar.find((s) => s.adim === 't5-tetik').kanit.olcum.kuru, /ATILMADI/);
});

test('GECTI → öncelik normal, rc 0; KALDI → yuksek, rc 1; test özetleri mesajda', () => {
  const g = kos('sabah', { STUB_KOS: 'gecti' });
  assert.equal(g.rc, 0);
  assert.match(
    g.bildirim[1],
    /^e2e sabah GECTI \(rc=0, \d+ sn\): T1 GECTI — \/r\/20260926-2200\.md$/,
  );
  assert.deepEqual(g.bildirim.slice(2), ['-p', 'normal']);
  const k = kos('aksam', { STUB_KOS: 'kaldi' });
  assert.equal(k.rc, 1);
  assert.match(k.bildirim[1], /KALDI .*T1 KALDI, T5 OLCULEMEDI/);
  assert.equal(k.bildirim[3], 'yuksek');
});

test('koşucu özet vermeden biterse ÇÖKTÜ yazılır ve rc≠0 (sessiz yeşil yok)', () => {
  const r = kos('aksam', { STUB_KOS: 'cokme' });
  assert.equal(r.rc, 3);
  assert.match(r.bildirim[1], /^e2e aksam ÇÖKTÜ .*Error: patladi/);
  assert.equal(r.bildirim[3], 'yuksek');
});

test('bildir gönderemezse sarmalayıcı rc=2 (alarm düşmedi); E2E_BILDIRME=0 bildirim atmaz', () => {
  assert.equal(kos('aksam', { STUB_BILDIR_RC: '1' }).rc, 2);
  const s = kos('aksam', { E2E_BILDIRME: '0' });
  assert.deepEqual(s.bildirim, []);
  assert.equal(s.rc, 1);
  assert.match(s.cikti, /ÖZET: e2e aksam KALDI/);
});

test('ağır iş semaforundan geçer (agir.sh etiketi e2e-gece-<kip>); geçersiz kip rc=2', () => {
  const r = kos('sabah', { E2E_GECE_AGIR: '1', E2E_AGIR_BETIK: AGIR, STUB_KOS: 'gecti' });
  assert.equal(r.agir, 'e2e-gece-sabah');
  assert.equal(r.rc, 0);
  assert.equal(kos('ogle').rc, 2);
});

test('bildir sözleşmesi: tek argüman rc=2 (sahte ve gerçek bildir — gerçek olan push atmadan döner)', () => {
  assert.equal(spawnSync(BILDIR, ['tek'], { encoding: 'utf8' }).status, 2);
  const gercek = [path.join(process.env.HOME || '', '.local', 'bin', 'bildir')].find((y) =>
    fs.existsSync(y),
  );
  if (gercek)
    assert.equal(spawnSync(gercek, ['tek'], { encoding: 'utf8', timeout: 10000 }).status, 2);
});

test('varsayılan --kuru --indir geçer (E2E_INDIR=0 kapatır); dış semafor varken iç denetim semaforsuz', () => {
  const kayit = path.join(D, 'kosucu-arg.json');
  const kosucu = path.join(D, 'kosucu-arg.js');
  fs.writeFileSync(
    kosucu,
    `require('fs').writeFileSync(${JSON.stringify(kayit)}, JSON.stringify({ argv: process.argv.slice(2), agir: process.env.EMPP_E2E_AGIR }));\n` +
      "console.log('T5  GECTI\\nGENEL GECTI — /r/20260926-0730.md');",
  );
  const r = kos('sabah', {
    E2E_KOSUCU: kosucu,
    E2E_GECE_AGIR: '1',
    E2E_AGIR_BETIK: AGIR,
    EMPP_E2E_AGIR: '1',
  });
  assert.equal(r.rc, 0, r.cikti);
  const k = JSON.parse(fs.readFileSync(kayit, 'utf8'));
  assert.ok(k.argv.includes('--kuru') && k.argv.includes('--indir'), k.argv.join(' '));
  assert.equal(k.agir, '0', 'agir.sh slotu tutulurken iç paket denetimi ikinci slot istememeli');
  kos('sabah', { E2E_KOSUCU: kosucu, E2E_INDIR: '0' });
  assert.ok(!JSON.parse(fs.readFileSync(kayit, 'utf8')).argv.includes('--indir'));
});

test(
  'launchd şablonu: plutil geçer, 22:00 + 07:30, ProcessType Standard (Background değil), PATH bildir dizinli',
  { skip: process.platform !== 'darwin' && 'yalnız macOS' },
  () => {
    const metin = fs
      .readFileSync(SABLON, 'utf8')
      .replace(/__DEPO__/g, '/depo')
      .replace(/__HOME__/g, '/Users/deneme')
      .replace(/__NODE_DIZIN__/g, '/node/bin');
    const hedef = path.join(D, 'com.empp.e2e-saglik.plist');
    fs.writeFileSync(hedef, metin);
    assert.equal(spawnSync('/usr/bin/plutil', ['-lint', hedef], { encoding: 'utf8' }).status, 0);
    const j = JSON.parse(
      spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', hedef], { encoding: 'utf8' })
        .stdout,
    );
    assert.deepEqual(j.StartCalendarInterval, [
      { Hour: 22, Minute: 0 },
      { Hour: 7, Minute: 30 },
    ]);
    assert.equal(j.ProcessType, 'Standard');
    assert.ok(j.EnvironmentVariables.PATH.split(':').includes('/Users/deneme/.local/bin'));
    assert.ok(j.EnvironmentVariables.PATH.split(':').includes('/node/bin'));
    assert.deepEqual(j.ProgramArguments, ['/bin/bash', '/depo/tests/e2e/gece/e2e-gece.sh']);
    assert.ok(!metin.includes('__'), 'doldurulmamış yer tutucu kalmamalı');
  },
);
