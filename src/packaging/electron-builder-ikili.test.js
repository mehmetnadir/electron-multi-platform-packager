'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { windowsIkili } = require('./electron-builder-ikili');

test('windows: yerel cli.js varsa node + cli.js döner (kabuk/.cmd YOK)', () => {
  const r = windowsIkili({
    kok: 'D:\\empp-ajan\\paketleyici', execPath: 'D:\\node\\node.exe',
    varMi: (p) => p === 'D:\\empp-ajan\\paketleyici\\node_modules\\electron-builder\\cli.js',
    cozumle: () => null,
  });
  assert.deepStrictEqual(r, {
    command: 'D:\\node\\node.exe',
    args: ['D:\\empp-ajan\\paketleyici\\node_modules\\electron-builder\\cli.js'],
  });
});

test('windows: yerel yoksa require.resolve sonucu kullanılır', () => {
  const r = windowsIkili({ kok: 'C:\\x', execPath: 'node.exe', varMi: () => false, cozumle: () => 'C:\\y\\cli.js' });
  assert.deepStrictEqual(r, { command: 'node.exe', args: ['C:\\y\\cli.js'] });
});

test('windows: hiçbiri yoksa açık hata (sessiz npx yedeği yok)', () => {
  assert.throws(() => windowsIkili({ kok: 'C:\\x', execPath: 'node.exe', varMi: () => false, cozumle: () => null }),
    /electron-builder bulunamadı/);
});

test('packagingService: win32 dalı uzantısız .bin betiğinden ÖNCE gelir; mac/linux dalı aynen', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const i = src.indexOf('resolveElectronBuilderBinary() {');
  const govde = src.slice(i, i + 1500);
  const win = govde.indexOf("process.platform === 'win32'");
  const yerel = govde.indexOf('fs.existsSync(localBin)');
  assert.ok(win > 0 && yerel > 0 && win < yerel, 'win32 kontrolü localBin kontrolünden önce olmalı');
  assert.match(govde, /windowsIkili\(/);
  assert.match(govde, /base = \{ command: localBin, args: \[\] \};/);
  assert.match(govde, /base = \{ command: 'npx', args: \['electron-builder'\] \};/);
});
