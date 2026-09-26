'use strict';
// G — Android paketleme adımı: www'ye istemci + set-kabuk sarmalı + tweetnacl; Java katmanı;
// MainActivity kaydı + rota; test CA güveni YALNIZ açıkça istenince ve YALNIZ 127.0.0.1 için.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const g = require('./g-katmani');
const setKabuk = require('../../packaging/set-kabuk');

const MA = `package com.dijitap.x;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EmppAgPlugin.class);
        super.onCreate(savedInstanceState);
        hideSystemBars();
    }
}
`;
const MANIFEST = '<manifest>\n    <application\n        android:allowBackup="true">\n    </application>\n</manifest>\n';

function sahteProje({ setJson = true } = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'emppg-pk-'));
  const www = path.join(kok, 'www');
  const main = path.join(kok, 'android', 'app', 'src', 'main');
  fs.mkdirSync(www, { recursive: true });
  fs.mkdirSync(path.join(main, 'java', 'com', 'dijitap', 'x'), { recursive: true });
  fs.writeFileSync(path.join(main, 'java', 'com', 'dijitap', 'x', 'MainActivity.java'), MA);
  fs.writeFileSync(path.join(main, 'AndroidManifest.xml'), MANIFEST);
  fs.writeFileSync(path.join(www, 'index.html'), '<head><script src="empp-android-shim.js"></script></head>');
  if (setJson) fs.writeFileSync(path.join(www, 'empp-set.json'), '{"setKimligi":"1"}');
  return { kok, www, main };
}

test('www dosyaları: istemci + set-kabuk sarmalı + tweetnacl (sha256 çivili)', () => {
  const w = g.wwwDosyalari();
  assert.deepStrictEqual(Object.keys(w).sort(), ['empp-g-istemci.js', 'empp-g-kabuk.js', 'empp-g-nacl.js']);
  assert.strictEqual(crypto.createHash('sha256').update(w['empp-g-nacl.js']).digest('hex'), g.NACL_SHA256);
  assert.strictEqual(g.NACL_SHA256, '973cc5733cc7432e30ee4682098f413094f494bccf76a567c23908c5035ddbbc');
});

test('SÖZLEŞME: tarayıcıdaki kabuk tanımı set-kabuk.js ile BİREBİR aynı karar verir (tek kaynak)', () => {
  const pencere = {};
  vm.runInNewContext(g.wwwDosyalari()['empp-g-kabuk.js'], { window: pencere });
  const t = pencere.__emppSetKabuk;
  assert.ok(t && typeof t.kabukYoluMu === 'function');
  assert.strictEqual(t.IMZA, setKabuk.IMZA);
  const yollar = ['index.html', 'config/settings.json', 'images/book1.png', 'core/a/b.png', 'book1/index.html',
    'assets/1/x', 'classlibraries/ImWin32.dll', '_eski/index.html', 'empp-set.json', '.empp-x', '../x', 'fonts/a.ttf',
    'node_modules/x.js', 'i18n/tr.js', 'features/a.html', 'scripts/a.js', 'styles/a.css', 'languages/en.json'];
  for (const y of yollar) assert.strictEqual(t.kabukYoluMu(y), setKabuk.kabukYoluMu(y), y);
  assert.strictEqual(String(t.KITAP_DIZIN_DESENI), String(setKabuk.KITAP_DIZIN_DESENI));
});

test('MainActivity: kayıt + rota super.onCreate\'ten ÖNCE, K9 kaydından sonra; idempotent', () => {
  const y = g.mainActivityYamasi(MA);
  const iAg = y.indexOf('registerPlugin(EmppAgPlugin.class);');
  const iK = y.indexOf(g.KAYIT);
  const iR = y.indexOf(g.ROTA);
  const iS = y.indexOf('super.onCreate(savedInstanceState);');
  assert.ok(iAg < iK && iK < iR && iR < iS, 'sıra: EmppAg → EmppG kayıt → rota → super.onCreate');
  assert.strictEqual(g.mainActivityYamasi(y), y);
  assert.throws(() => g.mainActivityYamasi('class X {}'), /super\.onCreate bulunamadı/);
});

test('test ağ yapılandırması: YALNIZ 127.0.0.1, sistem CA\'ları korunur; başka NSC varsa dokunmaz', () => {
  const x = g.testAgYapilandirmasi();
  assert.match(x, /<domain includeSubdomains="false">127\.0\.0\.1<\/domain>/);
  assert.strictEqual((x.match(/<domain /g) || []).length, 1);
  assert.doesNotMatch(x, /base-config|cleartextTrafficPermitted="true"/);
  assert.match(x, /src="system"/);
  const m = g.manifestTestYamasi(MANIFEST);
  assert.match(m, /<application android:networkSecurityConfig="@xml\/empp_g_test_ag"/);
  assert.strictEqual(g.manifestTestYamasi(m), m);
  assert.throws(() => g.manifestTestYamasi('<application android:networkSecurityConfig="@xml/baska">'), /başka networkSecurityConfig/);
});

test('kur: empp-set.json varsa her şey yazılır; test CA verilmediyse ağ yapılandırmasına DOKUNULMAZ', async () => {
  const p = sahteProje();
  const r = await g.kur(p.kok, p.www);
  assert.deepStrictEqual(r, { kuruldu: true, sebep: 'kuruldu', test: false });
  for (const ad of Object.values(g.WWW)) assert.ok(fs.existsSync(path.join(p.www, ad)), ad);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(p.www, g.WWW.paket), 'utf8')), { surum: null });
  for (const ad of g.JAVA_DOSYALARI) assert.ok(fs.existsSync(path.join(p.main, 'java', 'com', 'empp', 'g', ad)), ad);
  assert.ok(fs.readFileSync(path.join(p.main, 'java', 'com', 'dijitap', 'x', 'MainActivity.java'), 'utf8').includes(g.ROTA));
  assert.strictEqual(fs.readFileSync(path.join(p.main, 'AndroidManifest.xml'), 'utf8'), MANIFEST, 'üretimde manifest değişmez');
  assert.ok(!fs.existsSync(path.join(p.main, 'res', 'xml', `${g.TEST_AG}.xml`)));
  assert.ok(!fs.existsSync(path.join(p.main, 'res', 'raw')));
});

test('kur: empp-set.json yoksa HİÇBİR şey yazılmaz (kapı kapalı)', async () => {
  const p = sahteProje({ setJson: false });
  const r = await g.kur(p.kok, p.www);
  assert.strictEqual(r.kuruldu, false);
  assert.match(r.sebep, /empp-set\.json yok/);
  assert.ok(!fs.existsSync(path.join(p.www, 'empp-g-istemci.js')));
  assert.ok(!fs.existsSync(path.join(p.main, 'java', 'com', 'empp')));
  assert.strictEqual(fs.readFileSync(path.join(p.main, 'java', 'com', 'dijitap', 'x', 'MainActivity.java'), 'utf8'), MA);
});

test('kur: test CA yolu verilirse NSC + raw sertifika + manifest; PEM değilse hiçbir şey yazılmaz', async () => {
  const p = sahteProje();
  const ca = path.join(p.kok, 'ca.pem');
  fs.writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
  const r = await g.kur(p.kok, p.www, { testCaYolu: ca });
  assert.strictEqual(r.test, true);
  assert.ok(fs.existsSync(path.join(p.main, 'res', 'xml', `${g.TEST_AG}.xml`)));
  assert.ok(fs.existsSync(path.join(p.main, 'res', 'raw', `${g.TEST_CA}.pem`)));
  assert.match(fs.readFileSync(path.join(p.main, 'AndroidManifest.xml'), 'utf8'), /networkSecurityConfig="@xml\/empp_g_test_ag"/);
  const q = sahteProje();
  const kotu = path.join(q.kok, 'kotu.pem');
  fs.writeFileSync(kotu, 'anahtar değil');
  await assert.rejects(() => g.kur(q.kok, q.www, { testCaYolu: kotu }), /PEM sertifikası değil/);
  assert.ok(!fs.existsSync(path.join(q.www, 'empp-g-istemci.js')), 'hata öncesi hiçbir şey yazılmamalı');
  assert.ok(!fs.existsSync(path.join(q.main, 'java', 'com', 'empp')));
});

test('packagingService: G adımı K9\'dan SONRA, tek yerden; test CA yalnız EMPP_G_TEST_GUVEN_CA\'dan', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'packaging', 'packagingService.js'), 'utf8');
  const CAGRI = 'await this.configureAndroidG(webAppPath, wwwPath, appVersion);';
  assert.strictEqual(src.split(CAGRI).length - 1, 1);
  assert.ok(src.indexOf('await this.configureAndroidAgBilgisi(webAppPath);') < src.indexOf(CAGRI));
  assert.ok(src.indexOf('await this.configureAndroidFullscreen(webAppPath);') < src.indexOf(CAGRI));
  assert.match(src, /async initializeCapacitorProject\(webAppPath, appName, appVersion,/, 'appVersion kapsamda');
  assert.match(src, /\n {8}paketSurumu,\n/, 'paket sürümü G adımına geçer');
  assert.match(src, /testCaYolu: process\.env\.EMPP_G_TEST_GUVEN_CA \|\| null/);
  assert.strictEqual((src.match(/EMPP_G_TEST_GUVEN_CA/g) || []).length, 2, 'test CA başka yoldan girmemeli');
});

test('paket sürümü (monoton taban): kur yazar, eklenti AYNI adı APK varlığından okur, G değiştiremez', async () => {
  const p = sahteProje();
  await g.kur(p.kok, p.www, { paketSurumu: ' 2.51.3 ' });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(p.www, g.WWW.paket), 'utf8')), { surum: '2.51.3' });
  assert.strictEqual(g.paketDosyasi(''), '{"surum":null}\n');
  assert.strictEqual(g.paketDosyasi(42), '{"surum":null}\n');
  const eklenti = fs.readFileSync(path.join(__dirname, 'g-java', 'com', 'empp', 'g', 'EmppGPlugin.java'), 'utf8');
  assert.ok(eklenti.includes(`varlikMetni("public/${g.WWW.paket}")`), 'eklenti paket dosyasını APK varlığından okur');
  const G = require('./empp-g-istemci.js');
  assert.strictEqual(G.kapsamSinifi(g.WWW.paket, require('../../packaging/set-kabuk')), 'platform',
    'kök empp-* → G manifesti onu asla değiştiremez');
  assert.strictEqual(G.paketSurumuCoz(g.paketDosyasi('2.51.3')), '2.51.3', 'yazan ve okuyan aynı biçimde');
});
