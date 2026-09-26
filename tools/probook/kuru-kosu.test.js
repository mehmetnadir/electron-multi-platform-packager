'use strict';
// kuru-kosu: canlı ortamla runner'ın pardus yolunu koşar ama SUNUCUYA/R2'ye HİÇ YAZMAZ.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { argumanlar, envanter } = require('./kuru-kosu');

const SRC = fs.readFileSync(path.join(__dirname, 'kuru-kosu.js'), 'utf8');

test('kiralama/yükleme/sonuç çağrısı YOK (yalnız derleme + kabul fonksiyonları)', () => {
  for (const yasak of ['processJob', 'fetchNextJob', 'next-job', 'presign', 'postResult', 'uploadMultipart', 'heartbeat']) {
    assert.equal(SRC.includes(yasak), false, `kuru koşu ${yasak} kullanmamalı`);
  }
  for (const f of ['injectPardusIcon', 'buildPardusArtifact', 'pardusKabulKapisi', 'arsivKaynagi']) assert.ok(SRC.includes(f), f);
});

test('kuru koşu canlı ajanla AYNI ortam dosyasını kullanır; ajan koşarken durur', () => {
  const sh = fs.readFileSync(path.join(__dirname, 'kuru-kosu.sh'), 'utf8');
  const ajan = fs.readFileSync(path.join(__dirname, 'serit-ajan.sh'), 'utf8');
  assert.match(sh, /\/serit-ortam\.sh"/);
  assert.match(ajan, /\/serit-ortam\.sh"/);
  assert.match(sh, /is-active --quiet empp-serit-agent/);
  assert.equal(spawnSync('bash', ['-n', path.join(__dirname, 'kuru-kosu.sh')]).status, 0);
});

test('argüman ayrıştırma ve DijiTap envanteri (iki kök)', () => {
  assert.deepEqual(argumanlar(['derle', '--kitap', '73581', '--yayinci', 'YDS Publishing']),
    { asama: 'derle', kitap: '73581', yayinci: 'YDS Publishing' });
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'kuru-env-'));
  fs.mkdirSync(path.join(h, 'DijiTap', 'DijiTap', 'Set A'), { recursive: true });
  fs.mkdirSync(path.join(h, 'DijiTap', 'alan.com', 'Kitap'), { recursive: true });
  assert.deepEqual(envanter(h), ['DijiTap', 'DijiTap/Set A', 'alan.com', 'alan.com/Kitap']);
  assert.deepEqual(envanter(path.join(h, 'yok')), []);
});
