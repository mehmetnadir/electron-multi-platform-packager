'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const kapi = require('./olu-yol-kapisi');

/**
 * ÖLÜ YOL KAPISI TESTLERİ (2026-09-21).
 *
 * Bugün gerçek zarar: bir ajana `WindowsPackagingService.js`'e `asar: false`
 * eklemesi söylendi — o dosya hiçbir yerden require EDİLMİYOR. Ajan ölçtü ve
 * yakaladı; yakalamasaydı 1,3 GB'lık paket yanlış yapılandırmayla çıkacaktı.
 *
 * Bu kapı ölü/canlı sınıfını BEYANDAN değil ÖLÇÜMDEN alır ve iki yönde de ateşler:
 *   ölü dosya canlıya bağlanırsa da, yeni yetim dosya uyarısız eklenirse de kırılır.
 * Hiç ateşlemeyen bekçi bekçi değildir — 3, 4 ve 7 numaralı testler dedektörü
 * KENDİ sentetik ihlaliyle sınar.
 */

// Ölçümün bugünkü beyanı. Değişirse test kırılır ve KARAR vermeye zorlar:
// ya dosya gerçekten canlıya bağlandı (beyanı güncelle), ya da yanlışlıkla koptu.
const BEYAN_CANLI = [
  'platforms/android/empp-android-shim.js',
  'platforms/common/ag-politikasi.js',
  'platforms/common/fs-shim.js',
  'platforms/macos/dmg-layout.js',
  'platforms/macos/mac-signing.js',
  'platforms/olu-yol-kapisi.js',
];

// KARANTİNA UYGULANDI (2026-09-21): önceki BEYAN_OLU'daki 12 dosya (+ onları
// test eden MacOSPackagingService.test.js) bu ölçümün ürettiği kanıtla
// `_graveyard/2026-09-21-platforms/` altına taşındı — artık `src/platforms`
// içinde DEĞİLLER, bu yüzden `siniflandir()` onları hiç görmez. Kanıt + envanter:
// `_graveyard/2026-09-21-platforms/OKU.md`. Beyan artık BOŞ: bundan sonra bu
// dizine eklenecek YENİ bir yetim dosya kapıyı kırar (test 5/7), sessizce
// birikemez.
const BEYAN_OLU = [];

function gecici() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'olu-yol-'));
}

test('1 · POZİTİF KONTROL: graf yürüyücüsü canlı zinciri gerçekten buluyor', () => {
  const graf = kapi.canliGraf();
  const bekle = [
    'packaging/packagingService.js',      // app.js → packagingService
    'platforms/macos/mac-signing.js',     // packagingService → mac-signing
    'platforms/macos/dmg-layout.js',      // packagingService → dmg-layout
    'packaging/windows-asarsiz.js',       // packagingService → asar kapısı
  ];
  for (const g of bekle) {
    assert.ok(graf.has(path.join(kapi.SRC, g)), g + ' canlı grafta yok — yürüyücü kör');
  }
  assert.ok(graf.size > 20, 'graf çok küçük (' + graf.size + ') — yürüyücü erken duruyor');
});

test('2 · POZİTİF KONTROL: yürüyücü sentetik zinciri izler, ilgisiz dosyayı ALMAZ', () => {
  const d = gecici();
  fs.writeFileSync(path.join(d, 'giris.js'), "const b = require('./orta');\n");
  fs.writeFileSync(path.join(d, 'orta.js'), "const c = require('./derin.js');\n");
  fs.writeFileSync(path.join(d, 'derin.js'), "module.exports = 1;\n");
  fs.writeFileSync(path.join(d, 'yetim.js'), "module.exports = 2;\n");
  // Yorumdaki ve dizedeki require ANMASI bağ değildir:
  fs.writeFileSync(path.join(d, 'tuzak.js'), "// require('./yetim')\nconst s = \"require('./yetim')\";\n");

  const graf = kapi.canliGraf([path.join(d, 'giris.js')]);
  assert.ok(graf.has(path.join(d, 'orta.js')), 'bir adım ötesi bulunamadı');
  assert.ok(graf.has(path.join(d, 'derin.js')), 'iki adım ötesi bulunamadı (geçişli kapanış yok)');
  assert.ok(!graf.has(path.join(d, 'yetim.js')), 'ilgisiz dosya canlı sayıldı — yanlış pozitif');
  assert.strictEqual(graf.size, 3);
  fs.rmSync(d, { recursive: true, force: true });
});

test('3 · SENTETİK İHLAL: dosya adının GEÇMESİ canlılık sayılmaz (yorum + izleme listesi)', () => {
  // Bu tam olarak ölçülmüş yanlış pozitifti: scripts/uretim-on-kontrol.js
  // KRITIK_DOSYALAR listesinde WindowsPackagingService.js'i ANIYOR (tazelik izleme),
  // ama onu asla açmıyor. Liste anması canlılık kanıtı sayılırsa kapı körleşir.
  const izlemeListesi = "const KRITIK = [\n  'src/platforms/windows/WindowsPackagingService.js',\n];\n";
  assert.deepStrictEqual(kapi.varlikYollari(izlemeListesi), [],
    'düz liste anması VARLIK sayıldı — kapı körleşir');

  const yorum = "// bkz. src/platforms/common/fs-shim.js sentineli\n/* path.join(__dirname, '../platforms/common/fs-shim.js') */\n";
  assert.deepStrictEqual(kapi.varlikYollari(yorum), [],
    'yorumdaki yol VARLIK sayıldı');

  const gercek = "await fs.copy(path.join(__dirname, '../platforms/common/fs-shim.js'), hedef);";
  assert.deepStrictEqual(kapi.varlikYollari(gercek), ['../platforms/common/fs-shim.js'],
    'gerçek kopyalama referansı KAÇIRILDI — kapı canlıyı ölü sanar');
});

test('4 · SENTETİK İHLAL: uyarısız ölü dosya dedektörü ATEŞLER', () => {
  const uyarili = "/**\n * ÖLÜ YOL UYARISI (ÖLÇÜLDÜ — 2026-09-21): BU DOSYA ÇALIŞMIYOR.\n */\nmodule.exports={};\n";
  const uyarisiz = "/**\n * İzole Windows Paketleme Servisi\n */\nmodule.exports={};\n";
  const gecUyari = Array(kapi.UYARI_SATIR + 5).fill('//').join('\n') + '\n// ÖLÜ YOL UYARISI\n';

  assert.strictEqual(kapi.uyariVarMi(uyarili), true, 'gerçek uyarı görülmedi');
  assert.strictEqual(kapi.uyariVarMi(uyarisiz), false, 'uyarısız dosya temiz sayıldı — bekçi ateşlemiyor');
  assert.strictEqual(kapi.uyariVarMi(gecUyari), false,
    'uyarı ilk ' + kapi.UYARI_SATIR + ' satırın DIŞINDA — dosyayı açan onu görmez');
});

test('5 · ÖLÇÜLEN ölü küme beyanla birebir aynı (yeni yetim dosya kapıyı kırar)', () => {
  const { olu } = kapi.siniflandir();
  assert.deepStrictEqual(olu, BEYAN_OLU,
    'src/platforms ölü kümesi değişti — ya dosya canlıya bağlandı ya yeni yetim eklendi. KARAR ver, beyanı güncelle.');
});

test('6 · ÖLÇÜLEN canlı küme beyanla birebir aynı (sessiz kopma kapıyı kırar)', () => {
  const { canli } = kapi.siniflandir();
  assert.deepStrictEqual(canli, BEYAN_CANLI,
    'canlı platform dosyaları değişti — bir yardımcı canlı yoldan KOPMUŞ olabilir (fs-shim/android-shim/ag-politikasi/mac-signing/dmg-layout).');
});

test('7 · Her ölü dosya ilk ' + kapi.UYARI_SATIR + ' satırında ÖLÜ YOL UYARISI taşır', () => {
  const { olu } = kapi.siniflandir();
  const eksik = [];
  for (const goreli of olu) {
    const src = fs.readFileSync(path.join(kapi.SRC, goreli), 'utf8');
    if (!kapi.uyariVarMi(src)) eksik.push(goreli);
  }
  assert.deepStrictEqual(eksik, [],
    'uyarısız ölü dosya(lar): okuyan onları canlı sanar ve boşa düzenler.');
});

test('8 · ZEHİRLİ KALIP: düz `desktop:` YALNIZ uyarılı ölü dosyada durabilir', () => {
  // electron-builder 26 düz `linux.desktop` nesnesini reddeder ve TÜM linux
  // derlemesini düşürür (2026-09-04 Tudem pardus). Canlı yol `entry:` ile
  // düzeltildi; ölü kopya düzeltilmedi. Zehir kalabilir — ama ETİKETSİZ kalamaz.
  const { olu, canli } = kapi.siniflandir();
  for (const goreli of canli) {
    const src = fs.readFileSync(path.join(kapi.SRC, goreli), 'utf8');
    assert.strictEqual(kapi.duzDesktopVarMi(src), false,
      goreli + ' CANLI dosyada düz desktop biçimi var — linux derlemesi düşer');
  }
  for (const goreli of olu) {
    const src = fs.readFileSync(path.join(kapi.SRC, goreli), 'utf8');
    if (!kapi.duzDesktopVarMi(src)) continue;
    assert.match(src.split('\n').slice(0, kapi.UYARI_SATIR).join('\n'), /ZEHİRLİ KALIP/,
      goreli + ': reddedilen düz desktop biçimi taşıyor ama başlığı bunu SÖYLEMİYOR');
  }
  // Dedektörün kendi sentetik sınaması: iki biçimi de ayırt etmeli.
  assert.strictEqual(kapi.duzDesktopVarMi("desktop: {\n  Name: appName,\n}"), true, 'düz biçim kaçtı');
  assert.strictEqual(kapi.duzDesktopVarMi("desktop: {\n  entry: {\n    Name: appName,\n  }\n}"), false,
    'düzeltilmiş entry biçimi yanlışlıkla zehir sayıldı');
});

test('9 · CANLI YOL SAĞLAM: giriş → packagingService → platform yardımcıları zinciri kopmamış', () => {
  const graf = kapi.canliGraf([path.join(kapi.SRC, 'server/app.js')]);
  assert.ok(graf.has(path.join(kapi.SRC, 'packaging/packagingService.js')),
    'app.js → packagingService zinciri KOPMUŞ — canlı paketleme yolu yok');
  const varliklar = kapi.varlikReferanslari(graf);
  for (const g of ['platforms/common/fs-shim.js', 'platforms/android/empp-android-shim.js']) {
    assert.ok(varliklar.has(path.join(kapi.SRC, g)),
      g + ' artık pakete kopyalanmıyor — shim enjeksiyonu kopmuş olabilir');
  }
});
