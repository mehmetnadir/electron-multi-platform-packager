'use strict';
// K9: yerel "ağ bilgisi" eklentisi Capacitor şablonuna doğru yerleşmeli; yanlış yerleşirse
// gradle düşer ya da eklenti JS'e hiç görünmez (otomatik güncelleme sessizce ölür).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('fs-extra');
const ag = require('./ag-bilgisi');

const MA = `package com.dijitap.yabancdilpaketibeseitim;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideSystemBars();
    }
}
`;
const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="@string/app_name">
        <activity android:name=".MainActivity" />
    </application>
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;

test('eklenti kaydı super.onCreate ÖNCESİNE, aynı girintiyle girer (Capacitor 3+ kuralı)', () => {
  const y = ag.mainActivityYamasi(MA);
  const i = y.indexOf(ag.KAYIT), j = y.indexOf('super.onCreate(savedInstanceState);');
  assert.ok(i > 0 && i < j, 'kayıt super.onCreate öncesinde değil');
  assert.match(y, /\n {8}registerPlugin\(EmppAgPlugin\.class\);\n {8}super\.onCreate/);
  assert.strictEqual(ag.mainActivityYamasi(y), y, 'ikinci uygulamada çift kayıt');
});

test('super.onCreate yoksa sessiz geçmez, HATA verir', () => {
  assert.throws(() => ag.mainActivityYamasi('class X {}'), /super\.onCreate/);
});

test('manifest: ACCESS_NETWORK_STATE bir kez eklenir (normal izin — ekran çıkmaz)', () => {
  const y = ag.manifestYamasi(MANIFEST);
  assert.strictEqual(y.split(ag.IZIN).length - 1, 1);
  assert.ok(y.indexOf(ag.IZIN) < y.indexOf('<application'));
  assert.strictEqual(ag.manifestYamasi(y), y);
});

test('eklenti Java: doğru paket, @CapacitorPlugin adı EmppAg, bilinmiyorsa ÖLÇÜLEN varsayılır', () => {
  const j = ag.eklentiJava('com.dijitap.x');
  assert.match(j, /^package com\.dijitap\.x;/);
  assert.match(j, /@CapacitorPlugin\(name = "EmppAg"\)/);
  assert.match(j, /isActiveNetworkMetered\(\)/);
  assert.match(j, /catch \(Exception e\) \{\s*olculen = true;/);
  // Süslü parantez dengesi (yarım Java gradle'ı düşürür)
  assert.strictEqual((j.match(/\{/g) || []).length, (j.match(/\}/g) || []).length);
});

test('packagingService.configureAndroidAgBilgisi dosyaları doğru yere yazar', async () => {
  const svc = require('../../packaging/packagingService');
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-ag-'));
  try {
    const javaDir = path.join(kok, 'android/app/src/main/java/com/dijitap/yabancdilpaketibeseitim');
    await fs.ensureDir(javaDir);
    await fs.writeFile(path.join(javaDir, 'MainActivity.java'), MA);
    await fs.writeFile(path.join(kok, 'android/app/src/main/AndroidManifest.xml'), MANIFEST);
    assert.strictEqual(await svc.configureAndroidAgBilgisi(kok), true);
    const pl = await fs.readFile(path.join(javaDir, 'EmppAgPlugin.java'), 'utf8');
    assert.match(pl, /^package com\.dijitap\.yabancdilpaketibeseitim;/);
    assert.ok((await fs.readFile(path.join(javaDir, 'MainActivity.java'), 'utf8')).includes(ag.KAYIT));
    assert.ok((await fs.readFile(path.join(kok, 'android/app/src/main/AndroidManifest.xml'), 'utf8')).includes(ag.IZIN));
  } finally { await fs.remove(kok); }
});

test('MainActivity yoksa build DÜŞMEZ, false döner ve hiçbir dosya yazılmaz', async () => {
  const svc = require('../../packaging/packagingService');
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-ag-'));
  try {
    assert.strictEqual(await svc.configureAndroidAgBilgisi(kok), false);
  } finally { await fs.remove(kok); }
});
