'use strict';

/** Açılış zamanlama + İmpark devralma enjeksiyonu testleri — gerçek dosya sistemi. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const az = require('./acilis-zamanlama');

const ANA = `const { app, BrowserWindow } = require("electron");\napp.whenReady().then(() => {});\n`;

function paket(ana = ANA, pj = { name: 'super-monsters-2-set', main: 'main.js' }) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-az-'));
  fs.writeFileSync(path.join(kok, 'package.json'), JSON.stringify(pj));
  fs.writeFileSync(path.join(kok, pj.main || 'main.js'), ana);
  return kok;
}

test('icerigeEnjekteEt: blok EN BAŞA, use strict/shebang altına; idempotent; electron yoksa atomik ret', () => {
  const r = az.icerigeEnjekteEt(ANA);
  assert.ok(r.uygulandi);
  assert.ok(r.icerik.startsWith(`/* ${az.ISARET}`));
  assert.ok(r.icerik.endsWith(ANA));
  assert.ok(r.icerik.includes(`require('./${az.IMPARK_MODUL}')`));
  const s = az.icerigeEnjekteEt(`'use strict';\n${ANA}`);
  assert.ok(s.icerik.startsWith(`'use strict';\n/* ${az.ISARET}`));
  assert.deepStrictEqual(az.icerigeEnjekteEt(r.icerik), { icerik: r.icerik, uygulandi: false, sebep: 'zaten-yamali' });
  assert.strictEqual(az.icerigeEnjekteEt('console.log(1)').sebep, 'electron-ana-sureci-degil');
  assert.ok(!az.icerigeEnjekteEt(ANA, { impark: false }).icerik.includes(az.IMPARK_MODUL));
});

test('blokUret: modüller yoksa bile blok hatasız koşar (açılışı düşürmez)', () => {
  const ctx = { require: () => { throw new Error('Cannot find module'); }, __dirname: '/x' };
  assert.doesNotThrow(() => vm.runInNewContext(az.blokUret(), ctx));
});

test('paketeUygula: package.json main\'i yamalar, iki modülü yanına kopyalar (kaynakla birebir)', async () => {
  const kok = paket();
  const satir = [];
  const r = await az.paketeUygula(kok, { log: (x) => satir.push(x), env: {} });
  assert.deepStrictEqual(r, { dosya: 'main.js', uygulandi: true, sebep: 'enjekte-edildi', impark: true });
  assert.ok(fs.readFileSync(path.join(kok, 'main.js'), 'utf8').includes(az.ISARET));
  assert.ok(fs.readFileSync(path.join(kok, az.ZAMANLAMA_MODUL)).equals(fs.readFileSync(az.KAYNAK_ZAMANLAMA)));
  assert.ok(fs.readFileSync(path.join(kok, az.IMPARK_MODUL)).equals(fs.readFileSync(az.KAYNAK_IMPARK)));
  const r2 = await az.paketeUygula(kok, { env: {} });
  assert.strictEqual(r2.sebep, 'zaten-yamali');
  assert.ok(satir[0].includes('enjekte-edildi'));
});

test('paketeUygula: EMPP_IMPARK_KALDIR=0 → yalnız zamanlama; main alanı farklı dosyayı gösterirse o yamalanır', async () => {
  const kok = paket(ANA, { name: 'x', main: 'giris.js' });
  const r = await az.paketeUygula(kok, { env: { EMPP_IMPARK_KALDIR: '0' } });
  assert.strictEqual(r.dosya, 'giris.js');
  assert.strictEqual(r.impark, false);
  assert.strictEqual(fs.existsSync(path.join(kok, az.IMPARK_MODUL)), false);
  assert.ok(!fs.readFileSync(path.join(kok, 'giris.js'), 'utf8').includes(az.IMPARK_MODUL));
});

test('acikMi / imparkAcikMi: varsayılan AÇIK, "0" kapatır', () => {
  assert.strictEqual(az.acikMi({}), true);
  assert.strictEqual(az.acikMi({ EMPP_ACILIS_ZAMANLAMA: '0' }), false);
  assert.strictEqual(az.imparkAcikMi({}), true);
  assert.strictEqual(az.imparkAcikMi({ EMPP_IMPARK_KALDIR: '0' }), false);
});
