'use strict';
/**
 * konteyner-kabul.sh — SÜRELİ KONTEYNER YEDEK KABUL sarmalayıcısı (2026-09-27). GERÇEK
 * docker'ı ASLA çalıştırmaz: PATH'e sahte bir `docker` ikilisi konur, gerçek bash spawn ile
 * betiğin docker-sağlık kapısı (info/image) ve çıkış kodu eşlemesi (0/1/2, docker run'ın
 * beklenmeyen kodları dahil) sınanır. konteyner-kapi.sh (asıl ölçüm) BAŞKA bir dalda
 * (fix/konteyner-kapi-rosetta-20260927) değişiyor — bu dosya ONA DOKUNMAZ, yalnız
 * sarmalayıcıyı test eder.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const BETIK = path.join(__dirname, 'konteyner-kabul.sh');

/** Sahte `docker` ikilisini geçici bir dizine yazar, betiği o PATH ile koşturur. */
async function betikKostur(dockerGovdesi, { impark, kanit } = {}) {
  const binDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kkabul-bin-'));
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kkabul-work-'));
  const imparkYolu = impark || path.join(workDir, 'fake.impark');
  const kanitYolu = kanit || path.join(workDir, 'kanit');
  if (!impark) await fsp.writeFile(imparkYolu, 'sahte-impark-icerigi');
  await fsp.writeFile(path.join(binDir, 'docker'), dockerGovdesi, { mode: 0o755 });
  try {
    const r = spawnSync('bash', [BETIK, imparkYolu, kanitYolu], {
      encoding: 'utf8',
      env: { PATH: `${binDir}:${process.env.PATH}` },
      timeout: 15000,
    });
    return r;
  } finally {
    await fsp.rm(binDir, { recursive: true, force: true });
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

test('docker info başarısız (daemon kapalı) → exit 2, OLCULEMEDI', async () => {
  const r = await betikKostur('#!/bin/bash\nexit 1\n');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /OLCULEMEDI: docker erisilemiyor/);
});

test('docker info OK ama imaj yok (docker image inspect rc!=0) → exit 2, OLCULEMEDI', async () => {
  const r = await betikKostur([
    '#!/bin/bash',
    'if [ "$1" = "info" ]; then exit 0; fi',
    'if [ "$1" = "image" ]; then exit 1; fi',
    'exit 99',
  ].join('\n'));
  assert.equal(r.status, 2);
  assert.match(r.stdout, /OLCULEMEDI: imaj yok/);
});

test('docker run rc=0 (GEÇTİ) → aynen 0 döner', async () => {
  const r = await betikKostur([
    '#!/bin/bash',
    'if [ "$1" = "info" ]; then exit 0; fi',
    'if [ "$1" = "image" ]; then exit 0; fi',
    'if [ "$1" = "run" ]; then exit 0; fi',
    'exit 99',
  ].join('\n'));
  assert.equal(r.status, 0);
});

test('docker run rc=1 (RED) → aynen 1 döner (paket kusuru — kapı kusuru DEĞİL)', async () => {
  const r = await betikKostur([
    '#!/bin/bash',
    'if [ "$1" = "info" ]; then exit 0; fi',
    'if [ "$1" = "image" ]; then exit 0; fi',
    'if [ "$1" = "run" ]; then exit 1; fi',
    'exit 99',
  ].join('\n'));
  assert.equal(r.status, 1);
});

test('docker run rc=2 (konteyner-kapi.sh ÖLÇÜLEMEDİ) → aynen 2 döner', async () => {
  const r = await betikKostur([
    '#!/bin/bash',
    'if [ "$1" = "info" ]; then exit 0; fi',
    'if [ "$1" = "image" ]; then exit 0; fi',
    'if [ "$1" = "run" ]; then exit 2; fi',
    'exit 99',
  ].join('\n'));
  assert.equal(r.status, 2);
});

test('docker run beklenmeyen kod (125 — docker daemon hatası) → 2\'ye çevrilir, paket suçlanmaz', async () => {
  const r = await betikKostur([
    '#!/bin/bash',
    'if [ "$1" = "info" ]; then exit 0; fi',
    'if [ "$1" = "image" ]; then exit 0; fi',
    'if [ "$1" = "run" ]; then exit 125; fi',
    'exit 99',
  ].join('\n'));
  assert.equal(r.status, 2);
  assert.match(r.stdout, /OLCULEMEDI: docker run beklenmeyen kodla dustu \(rc=125\)/);
});

test('docker run sinyalle öldürülürse (>128) → 2\'ye çevrilir', async () => {
  const r = await betikKostur([
    '#!/bin/bash',
    'if [ "$1" = "info" ]; then exit 0; fi',
    'if [ "$1" = "image" ]; then exit 0; fi',
    'if [ "$1" = "run" ]; then kill -9 $$; fi',
    'exit 99',
  ].join('\n'));
  assert.equal(r.status, 2);
});

test('PARDUS_KAPI_IMAJ override edilebilir — docker image inspect doğru imajı sorar', async () => {
  const binDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kkabul-bin-'));
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kkabul-work-'));
  const soruYolu = path.join(workDir, 'sorulan-imaj.txt');
  await fsp.writeFile(path.join(binDir, 'docker'), [
    '#!/bin/bash',
    'if [ "$1" = "info" ]; then exit 0; fi',
    `if [ "$1" = "image" ]; then echo "$3" > "${soruYolu}"; exit 1; fi`,
    'exit 99',
  ].join('\n'), { mode: 0o755 });
  try {
    const imparkYolu = path.join(workDir, 'fake.impark');
    await fsp.writeFile(imparkYolu, 'x');
    spawnSync('bash', [BETIK, imparkYolu, path.join(workDir, 'kanit')], {
      encoding: 'utf8',
      env: { PATH: `${binDir}:${process.env.PATH}`, PARDUS_KAPI_IMAJ: 'ozel-imaj:9' },
      timeout: 15000,
    });
    const sorulan = await fsp.readFile(soruYolu, 'utf8');
    assert.equal(sorulan.trim(), 'ozel-imaj:9');
  } finally {
    await fsp.rm(binDir, { recursive: true, force: true });
    await fsp.rm(workDir, { recursive: true, force: true });
  }
});

test('kaynak sentinel: entegrasyonun kendi konteyner-kapi.sh\'ını bind-mount eder (imaj bayat kalsa bile güncel betik koşar)', () => {
  const src = fs.readFileSync(BETIK, 'utf8');
  assert.match(src, /konteyner-kapi\.sh:\/usr\/local\/bin\/konteyner-kapi:ro/);
  assert.match(src, /-e KAPI_AKTIVASYON/);
  assert.match(src, /-e KAPI_BEKLE/);
  assert.match(src, /--platform linux\/amd64/);
});
