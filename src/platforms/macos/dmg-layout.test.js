'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dmgBackgroundSvg, writeDmgBackground, dmgLayoutConfig, WINDOW, APP_POS, APPS_POS } = require('./dmg-layout');

test('SVG uygulama adını kaçırarak taşır ve yönerge + ok içerir', () => {
  const svg = dmgBackgroundSvg('Marvel <Grade> 11');
  assert.ok(svg.includes('Marvel &lt;Grade&gt; 11'));
  assert.ok(svg.includes('Applications klasörüne sürükleyin'));
  assert.ok(svg.includes('<polyline'));
});

test('arka plan PNG üretilir (sharp) ve pencere ölçüsünde', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-bg-'));
  const out = await writeDmgBackground(path.relative(process.cwd(), dir) || dir, 'Test App');
  assert.ok(path.isAbsolute(out), 'arka plan yolu mutlak olmalı (electron-builder app dizinine göre çözer)');
  const sharp = require('sharp');
  const meta = await sharp(out).metadata();
  assert.strictEqual(meta.width, WINDOW.width);
  assert.strictEqual(meta.height, WINDOW.height);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('layout: uygulama solda, Applications linki sağda, ok arada', () => {
  const c = dmgLayoutConfig('/x/bg.png');
  assert.strictEqual(c.background, '/x/bg.png');
  assert.strictEqual(c.contents[0].type, 'file');
  assert.strictEqual(c.contents[1].path, '/Applications');
  assert.ok(APP_POS.x < APPS_POS.x);
  assert.deepStrictEqual(c.window, { width: WINDOW.width, height: WINDOW.height });
});
