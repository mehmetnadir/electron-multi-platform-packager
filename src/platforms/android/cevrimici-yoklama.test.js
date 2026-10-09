'use strict';
// KAPI (2026-09-26): EMPP_ANDROID_CEVRIMICI — varsayılan KAPALI → shim birebir; '1' → kapı satırı true.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Y = require('./cevrimici-yoklama');

const KAYNAK = fs.readFileSync(Y.SHIM_YOLU, 'utf8');

test('acikMi: yalnız tam "1" açar', () => {
  assert.strictEqual(Y.acikMi({}), false);
  assert.strictEqual(Y.acikMi({ EMPP_ANDROID_CEVRIMICI: '0' }), false);
  assert.strictEqual(Y.acikMi({ EMPP_ANDROID_CEVRIMICI: 'true' }), false);
  assert.strictEqual(Y.acikMi({ EMPP_ANDROID_CEVRIMICI: '1' }), true);
  assert.strictEqual(Y.acikMi(null), false);
});

test('shim kaynağında kapı satırı TAM bir kez ve KAPALI', () => {
  assert.strictEqual(KAYNAK.split(Y.KAPI_SATIRI).length - 1, 1);
  assert.ok(!KAYNAK.includes(Y.ACIK_SATIRI));
});

test('shimMetni: kapalı → birebir; açık → satır true; satır yok/çift → fırlatır', () => {
  assert.strictEqual(Y.shimMetni(KAYNAK, false), KAYNAK);
  const a = Y.shimMetni(KAYNAK, true);
  assert.strictEqual(a.split(Y.ACIK_SATIRI).length - 1, 1);
  assert.ok(!a.includes(Y.KAPI_SATIRI));
  assert.strictEqual(a.length - KAYNAK.length, Y.ACIK_SATIRI.length - Y.KAPI_SATIRI.length, 'başka hiçbir şey değişmez');
  assert.throws(() => Y.shimMetni('var x = 1;', true), /0 kez/);
  assert.throws(() => Y.shimMetni(`${Y.KAPI_SATIRI}\n${Y.KAPI_SATIRI}`, true), /2 kez/);
});

test('shimKopyala: kapalı bayt bayt aynı; açık kapı true; satırsız kaynakta shim DÜŞMEZ (kapalı konur)', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cevrimici-'));
  const h1 = path.join(d, 'a.js');
  assert.deepStrictEqual(await Y.shimKopyala(h1, { env: {} }), { acik: false });
  assert.ok(fs.readFileSync(h1).equals(fs.readFileSync(Y.SHIM_YOLU)));
  const h2 = path.join(d, 'b.js');
  const log = [];
  assert.deepStrictEqual(await Y.shimKopyala(h2, { env: { EMPP_ANDROID_CEVRIMICI: '1' }, log: (s) => log.push(s) }), { acik: true });
  assert.ok(fs.readFileSync(h2, 'utf8').includes(Y.ACIK_SATIRI));
  assert.ok(log.some((s) => /EMPP_ANDROID_CEVRIMICI=1/.test(s)));
  const bozuk = path.join(d, 'bozuk.js');
  fs.writeFileSync(bozuk, '/* kapı satırı yok */');
  const h3 = path.join(d, 'c.js');
  const hataLog = console.error;
  console.error = () => {};
  try {
    const r = await Y.shimKopyala(h3, { env: { EMPP_ANDROID_CEVRIMICI: '1' }, kaynakYolu: bozuk });
    assert.strictEqual(r.acik, false);
    assert.match(r.hata, /0 kez/);
  } finally { console.error = hataLog; }
  assert.strictEqual(fs.readFileSync(h3, 'utf8'), '/* kapı satırı yok */');
});

test('packagingService: iki shim kopyalama noktası da kapıdan geçer; CapacitorHttp AÇIK kalır', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../packaging/packagingService.js'), 'utf8');
  // 09.10: alt-kitap kopyası ortak modüle taşındı (android-arsiv-uretec.js); iki nokta = kök (packagingService)
  // + alt kitap (modül). İkisi de kapıdan (shimKopyala) geçer, hiçbiri ham fs.copy kullanmaz.
  const mod = fs.readFileSync(path.join(__dirname, '../../packaging/android-arsiv-uretec.js'), 'utf8');
  assert.ok(!/fs\.copy\([^)]*empp-android-shim\.js/.test(src), 'ham fs.copy ile shim kopyalanmamalı');
  assert.ok(!/fs\.copy\(/.test(mod), 'modülde ham fs.copy ile shim kopyalanmamalı');
  assert.strictEqual(src.split('await androidShimKopyala(').length - 1, 1, 'kök (packagingService)');
  assert.strictEqual(mod.split('await androidShimKopyala(').length - 1, 1, 'alt kitap (android-arsiv-uretec)');
  assert.ok(/require\('\.\.\/platforms\/android\/cevrimici-yoklama'\)/.test(src));
  assert.ok(/require\('\.\.\/platforms\/android\/cevrimici-yoklama'\)/.test(mod));
  assert.match(src, /kitapDizininiAndroidIcinUyarla\(bookDir,/, 'alt kitap kopyası modül üstünden gider');
  assert.ok(/plugins: \{ CapacitorHttp: \{ enabled: true \} \}/.test(src), 'aktivasyon CORS için CapacitorHttp şart');
});
