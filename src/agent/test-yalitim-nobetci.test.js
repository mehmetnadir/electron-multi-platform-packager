'use strict';

/**
 * NÖBETÇİ TEST (2026-09-28, agent-test-borcu-20260928 — kök neden kapatma, madde 4).
 *
 * Amaç: `test-yalitim.js`'in varsayımına BAĞIMLI OLMAYAN, bağımsız bir güvenlik ağı.
 * `izoleOrtam()` doğru çağrılırsa env değişkenleri gerçek yolları zaten geçici dizine
 * yönlendirir — ama YARIN yeni bir test dosyası bu yardımcıyı çağırmayı UNUTURSA (ya da
 * runner.js'e env-override'ı OLMAYAN yeni bir CONFIG alanı eklenirse) o sessiz sızıntıyı
 * hiçbir mevcut test yakalamaz. Bu dosya, hangi test dosyasının neyi ne kadar doğru
 * yaptığından BAĞIMSIZ olarak, GERÇEK `~/.empp-agent` dosyalarının `src/agent` takımı
 * boyunca DEĞİŞMEDİĞİNİ doğrudan `os.homedir()` üzerinden ölçer.
 *
 * Node'un test çalıştırıcısı her `*.test.js` dosyasını AYRI bir alt süreçte izole eder
 * (`node --test` varsayılanı process-isolation) — bu yüzden bu dosya "takımın geri kalanı
 * bitince" durumu tek bir process içinden GÖZLEMLEYEMEZ. Bunun yerine, kendi kendine
 * yeten bir ölçüm yapar: takımın GERİ KALANINI (kendisi hariç) bir alt `node --test` süreci
 * olarak çalıştırır, gerçek yolların anlık görüntüsünü bu çalıştırmanın ÖNCESİNDE ve
 * SONRASINDA karşılaştırır. Bu, bu görevde elle yapılan doğrulama yönteminin
 * (önce/sonra mtime+boyut kıyası) kalıcı, otomatik bir tekrarıdır.
 *
 * Gelecekte bir test dosyası `izoleOrtam()`'ı unutup gerçek bir yola yazarsa/okursa,
 * bu test KIRMIZI olur ve TAM OLARAK hangi gerçek yolun değiştiğini raporlar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const { GERCEK_YOLLAR, gercekYolYakala, gercekYolFarki } = require('./test-yalitim');

// Bu dosyanın kendisi hariç, src/agent altındaki TÜM *.test.js dosyaları.
function digerTestDosyalari() {
  return fs.readdirSync(__dirname)
    .filter((ad) => ad.endsWith('.test.js') && ad !== path.basename(__filename))
    .sort();
}

test('NÖBETÇİ: src/agent takımı (bu dosya hariç) koşarken GERÇEK ~/.empp-agent dosyaları DEĞİŞMEZ', { timeout: 120000 }, () => {
  const dosyalar = digerTestDosyalari();
  assert.ok(dosyalar.length > 5, 'beklenenden az test dosyası bulundu — glob mu bozuldu?');

  const once = gercekYolYakala();

  // KRİTİK: bu dosyanın kendisi de bir `node --test` alt-süreci olarak koşar; Node bu tür
  // süreçlere NODE_TEST_CONTEXT=child-v8 / NODE_TEST_WORKER_ID env değişkenlerini basar.
  // execFileSync VARSAYILAN OLARAK process.env'i miras bırakır — bu iki değişken aşağıdaki
  // İÇ İÇE `node --test` çağrısına sızarsa, iç çağrı KENDİSİNİ ZATEN bir test-worker sanıp
  // dosya keşfini/çalıştırmayı SESSİZCE ATLAR ve anında exit 0 verir (SAHTE YEŞİL — bu hata
  // 2026-09-28'de tam olarak bu şekilde yakalandı: nöbetçi "geçti" ama 50ms'de, 48s'lik
  // gerçek takımı hiç koşturmadan). Bu yüzden temiz bir env ile çağrılır.
  const temizEnv = { ...process.env };
  delete temizEnv.NODE_TEST_CONTEXT;
  delete temizEnv.NODE_TEST_WORKER_ID;

  const cikti = execFileSync(process.execPath, ['--test', ...dosyalar], {
    cwd: __dirname,
    env: temizEnv,
    stdio: 'pipe',
    timeout: 110000,
  }).toString();

  // Sağlık kontrolü: iç çağrı SESSİZCE no-op olup sahte yeşil vermiş olmasın (bkz. yukarıdaki
  // NODE_TEST_CONTEXT notu — bu KESİN olay, 2026-09-28'de bir kez yaşandı). "ℹ tests N" satırı
  // beklenen aralıkta değilse bu, ölçümün kendisinin bozulduğu anlamına gelir.
  const testSayisiEslesme = cikti.match(/ℹ tests (\d+)/);
  const kosanTestSayisi = testSayisiEslesme ? Number(testSayisiEslesme[1]) : 0;
  assert.ok(
    kosanTestSayisi > 300,
    `iç çağrı beklenenden az test koşturdu (${kosanTestSayisi}) — sessiz no-op şüphesi (NODE_TEST_CONTEXT sızıntısı?)`,
  );

  const sonra = gercekYolYakala();
  const farklar = gercekYolFarki(once, sonra);

  if (farklar.length > 0) {
    const detay = farklar.map((ad) => {
      if (ad === 'kabulKanitGirisSayisi') {
        return `kabul-kanit/ giriş sayısı: ${once.kabulKanitGirisSayisi} → ${sonra.kabulKanitGirisSayisi}`;
      }
      const o = once[ad]; const s = sonra[ad];
      return `${ad} (${GERCEK_YOLLAR[ad]}): ${JSON.stringify(o)} → ${JSON.stringify(s)}`;
    }).join('\n  ');
    assert.fail(
      `SIZINTI: bir test dosyası izoleOrtam() olmadan GERÇEK ~/.empp-agent yoluna dokundu:\n  ${detay}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Dedektör kendisi çalışıyor mu? (bekçi tatbikatı — sentetik girdiler, GERÇEK dosyaya
// asla dokunmaz.) Yalnız yukarıdaki `gercekYolFarki` karşılaştırma mantığını sentetik
// önce/sonra nesneleriyle sınar — mutasyon testi olmadan bir dedektörün "her zaman farksız
// döner" şeklinde sessizce bozulması fark edilmez.
// ---------------------------------------------------------------------------

test('dedektör kendisi çalışıyor mu? (gercekYolFarki — sentetik girdiler)', () => {
  const taban = gercekYolYakala();

  assert.deepEqual(gercekYolFarki(taban, taban), [], 'aynı anlık görüntü farksız olmalı');

  const mtimeDegisti = { ...taban, tokenFile: { var: true, mtimeMs: 1, size: 1 } };
  assert.deepEqual(gercekYolFarki(taban, mtimeDegisti), ['tokenFile'],
    'mtime/boyut değişimi tek başına yakalanmalı');

  const yokKenVarOldu = { ...taban, restartFlag: { var: true, mtimeMs: 1, size: 1 } };
  if (!taban.restartFlag.var) {
    assert.deepEqual(gercekYolFarki(taban, yokKenVarOldu), ['restartFlag'],
      'yok → var geçişi (yeni dosya oluşturuldu) yakalanmalı');
  }

  const kanitArtti = { ...taban, kabulKanitGirisSayisi: taban.kabulKanitGirisSayisi + 1 };
  assert.deepEqual(gercekYolFarki(taban, kanitArtti), ['kabulKanitGirisSayisi'],
    'kabul-kanit/ dizinine yeni giriş eklenmesi yakalanmalı');

  const ikisiBirden = { ...mtimeDegisti, kabulKanitGirisSayisi: taban.kabulKanitGirisSayisi + 1 };
  assert.deepEqual(
    new Set(gercekYolFarki(taban, ikisiBirden)),
    new Set(['tokenFile', 'kabulKanitGirisSayisi']),
    'birden fazla fark aynı anda raporlanmalı',
  );
});
