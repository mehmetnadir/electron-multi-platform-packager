'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ikiliKomutu } = require('./bildir-ikili');

const PS = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'];

test('düz ikili aynen döner', () => {
  assert.deepEqual(ikiliKomutu('/u/bin/bildir', ['paket', 'm']), ['/u/bin/bildir', ['paket', 'm']]);
});

test('.ps1 → powershell -File', () => {
  assert.deepEqual(ikiliKomutu('C:\\b\\bildir.ps1', ['paket', 'm']), ['powershell', [...PS, 'C:\\b\\bildir.ps1', 'paket', 'm']]);
});

test('.cmd + kardeş .ps1 → doğrudan ps1 (cmd.exe kaçışı yok)', () => {
  const [k, a] = ikiliKomutu('C:\\b\\bildir.cmd', ['paket', 'Çalışma'], { varMi: (y) => y === 'C:\\b\\bildir.ps1' });
  assert.equal(k, 'powershell');
  assert.deepEqual(a, [...PS, 'C:\\b\\bildir.ps1', 'paket', 'Çalışma']);
});

test('.cmd kardeşsiz → cmd /c; .BAT büyük harf tanınır', () => {
  assert.deepEqual(ikiliKomutu('x.CMD', ['a'], { varMi: () => false }), ['cmd', ['/c', 'x.CMD', 'a']]);
});

test('bildir.cmd + bildir.ps1 şablonu repoda ve ntfy yapılandırma yollarını kullanır', () => {
  const d = path.join(__dirname, '..', '..', 'tools', 'windows', 'kasa-ajan');
  const cmd = fs.readFileSync(path.join(d, 'bildir.cmd'), 'utf8');
  assert.match(cmd, /powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bildir\.ps1" %\*/);
  const ps = fs.readFileSync(path.join(d, 'bildir.ps1'), 'utf8');
  assert.match(ps, /\.config\\ntfy/);
  assert.doesNotMatch(ps, /Write-(Host|Output)[^\n]*\$token/);
});
