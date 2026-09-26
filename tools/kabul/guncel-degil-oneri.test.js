'use strict';
/**
 * GÜNCEL-DEĞİL "yeniden kuyruk önerisi" metni — tek kaynak testi (Nadir 26.09).
 *
 * Mutasyon kanıtı: bir çağıran (cdp-kitap-ac.js / set-guncellik.js / k4-guncellik.js) bu ortak
 * fonksiyonu bırakıp eski sabit metni doğrudan yazarsa "sentinel: eski metin test dışı kodda
 * geçmemeli" testi kırılır — bkz. altta `grep` testi.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { guncelDegilOneri } = require('./guncel-degil-oneri');

test('guncelDegilOneri: merdiven KAPALI → eski metin birebir (davranış değişmez)', () => {
  const o = guncelDegilOneri(['ZKitapZipH/44187-36.zip'], {});
  assert.match(o, /^kaynak S1 ile yenilenmeli \(ZKitapZipH\/44187-36\.zip\); /);
  assert.match(o, /yeni build zip arşive girince yeniden kuyruğa al/);
  assert.match(o, /aynı kaynakla yeniden üretim aynı sonucu verir/);
  // Merdiven açık metniyle KARIŞMAMALI.
  assert.doesNotMatch(o, /merdiven açık/);
});

test('guncelDegilOneri: EMPP_ARSIV_MERDIVEN=1 → yeni metin (S1 yeni sürüm getirir)', () => {
  const o = guncelDegilOneri(['ZKitapZipH/44187-36.zip'], { EMPP_ARSIV_MERDIVEN: '1' });
  assert.match(o, /^kaynak S1 ile yenilenmeli \(ZKitapZipH\/44187-36\.zip\); /);
  assert.match(o, /merdiven açık: ≥10 dk sonra yeniden kuyruğa almak yeter/);
  assert.match(o, /İmpark'ın yeni sürümünü getirir/);
  assert.match(o, /ikinci RED → insan kararı/);
  // Kapalı-metnin bayat iddiası ("aynı sonucu verir") artık YOK.
  assert.doesNotMatch(o, /aynı kaynakla yeniden üretim aynı sonucu verir/);
});

test('guncelDegilOneri: EMPP_ARSIV_MERDIVEN başka bir değerse KAPALI sayılır (yalnız "1" açar)', () => {
  const o = guncelDegilOneri(['x.zip'], { EMPP_ARSIV_MERDIVEN: 'true' });
  assert.match(o, /aynı kaynakla yeniden üretim aynı sonucu verir/);
});

test('guncelDegilOneri: boş zip listesi de çökmez (parantez boş kalır)', () => {
  const o = guncelDegilOneri([], {});
  assert.match(o, /^kaynak S1 ile yenilenmeli \(\); /);
});

// --- Sentinel: eski bayat metin, test dışı kodda TEK kaynak (bu dosya) dışında geçmemeli ------
test('sentinel: "aynı kaynakla yeniden üretim aynı sonucu verir" yalnız guncel-degil-oneri.js\'de tanımlı', () => {
  const kok = path.join(__dirname, '..', '..');
  const hedefler = [
    'tools/pardus/cdp-kitap-ac.js',
    'tools/kabul/set-guncellik.js',
    'tools/kabul/k4-guncellik.js',
    'tools/pardus/kabul-karar.sh',
    'src/agent/runner.js',
    'src/agent/runner-helpers.js',
    'tools/kabul/basliksiz-kabul.js',
    'src/agent/basliksiz-kabul-kapisi.js',
  ];
  const desen = /aynı kaynakla yeniden üretim aynı (sonucu|RED'i) verir/;
  for (const rel of hedefler) {
    const tam = path.join(kok, rel);
    if (!fs.existsSync(tam)) continue; // dosya taşınmışsa test kırılmasın, kapsam genişlese de sorun değil
    const icerik = fs.readFileSync(tam, 'utf8');
    assert.ok(!desen.test(icerik), `${rel} hâlâ eski bayat metni doğrudan yazıyor — guncelDegilOneri() kullanmalı`);
  }
});

test('sentinel: guncel-degil-oneri.js gerçekten TEK tanım yeri (grep ile bağımsız doğrulama)', () => {
  const kok = path.join(__dirname, '..', '..');
  let cikti = '';
  try {
    cikti = execFileSync('grep', ['-rl', '-e', "aynı kaynakla yeniden üretim aynı sonucu verir",
      '--include=*.js', '--include=*.sh', 'tools', 'src'], { cwd: kok, encoding: 'utf8' });
  } catch (e) {
    // grep exit 1 = eşleşme yok (kabul edilebilir, ama beklenen: en az guncel-degil-oneri.js eşleşir)
    cikti = e.stdout || '';
  }
  const dosyalar = cikti.split('\n').map((s) => s.trim()).filter(Boolean);
  const testDisi = dosyalar.filter((d) => !d.endsWith('.test.js'));
  assert.deepEqual(testDisi, ['tools/kabul/guncel-degil-oneri.js'],
    `tanım tek yerde olmalı, bulunanlar: ${testDisi.join(', ')}`);
});
