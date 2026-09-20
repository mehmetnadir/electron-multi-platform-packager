'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs-extra');
const svc = require('./packagingService');

// ---------------------------------------------------------------------------
// KURULUM BİLGİLENDİRMESİ (2026-09-19, Nadir: "yayınevi logosu ve daha anlaşılır
// bilgilendirmeler istiyorum").
//
// Üç kusur ölçülerek düzeltildi ve bu testlerle çivilendi:
//  1) Metinler ASCII yazılmıştı ("Dosyalar isleniye basliyor"). KODLAMA SORUNU
//     DEĞİLDİ — makensis (NSIS 3 Unicode) UTF-8 kaynağı BOM'suz doğru okuyor ve
//     Türkçe karakterler derlenmiş exe'ye UTF-16 olarak birebir giriyor
//     (2026-09-19'da makensis ile derlenip bayt düzeyinde doğrulandı).
//  2) "[10%]…[95%]" satırları sahte ilerlemeydi; aralarındaki `Sleep` çağrıları
//     kurulumu boşuna 3,6-5,6 sn uzatıyordu.
//  3) Metinler ayrı bir `Section` içindeydi. Tek tıkla kurulumda doğru uç
//     `customInstall` makrosudur (installSection.nsh onu insert eder);
//     `customFinishPageAction` ise şablonda HİÇ referansı olmayan ölü makroydu.
// ---------------------------------------------------------------------------

// createCustomInstallationFiles paketleyici günlüğünü STDOUT'a basıyor. `node --test`
// çocuk süreçle V8-serileştirilmiş mesajları FD 1 üzerinden konuştuğu için bu satırlar
// çerçevenin ortasına girip "Unable to deserialize cloned data" ile DOSYANIN TAMAMINI
// düşürüyor (tam pakette 1/667 hata; dosya tek başına koşarken 3/3 geçiyordu — yarış).
// Ölçüm 2026-09-20. Kütüphane günlüğü susturulur; çıktı zaten test edilmiyor.
async function sessizce(fn) {
  const yedek = { log: console.log, info: console.info, warn: console.warn };
  console.log = console.info = console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, yedek); }
}

async function uret(updateInfo) {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-nsh-'));
  await fs.ensureDir(path.join(kok, 'build'));
  await sessizce(() => svc.createCustomInstallationFiles(kok, 'Super Monsters 4', 'YDS Publishing', null, updateInfo));
  const metin = await fs.readFile(path.join(kok, 'build', 'installer.nsh'), 'utf8');
  await fs.remove(kok);
  return metin;
}

const GUNCELLEME = {
  hasExistingInstallation: true,
  updateType: 'incremental',
  previousVersion: '1.13.7',
  currentVersion: '1.13.8',
  changedFiles: ['a', 'b'],
  newFiles: ['c'],
  unchangedFiles: new Array(120).fill('x'),
  deletedFiles: ['d'],
};

test('GERİLEME: kurulum betiğinde SAHTE ilerleme ve Sleep YOK', async () => {
  for (const bilgi of [null, GUNCELLEME]) {
    const s = await uret(bilgi);
    assert.ok(!/\bSleep\b/i.test(s), 'Sleep kaldı — kurulum boşuna uzuyor');
    assert.ok(!/\[\d+%\]/.test(s), 'sahte yüzde satırı kaldı ([10%] gibi)');
  }
});

test('GERİLEME: doğru bağlanma noktası — customInstall, ayrı Section DEĞİL', async () => {
  const s = await uret(GUNCELLEME);
  assert.match(s, /!macro customInstall/, 'customInstall makrosu yok');
  assert.match(s, /!macroend/, 'makro kapanışı yok');
  assert.ok(!/^\s*Section\b/m.test(s), 'ayrı Section geri gelmiş');
  assert.ok(!/SectionEnd/.test(s), 'ayrı Section geri gelmiş');
  assert.ok(!/customFinishPageAction/.test(s), 'ölü makro geri gelmiş (şablonda referansı yok)');
});

test('GERİLEME: metinler GERÇEK Türkçe — ASCII kırpması yasak', async () => {
  const s = await uret(GUNCELLEME);
  assert.match(s, /[çğıöşüÇĞİÖŞÜ]/, 'hiç Türkçe karakter yok — ASCII kırpması geri gelmiş');
  // Eski bozuk metinlerin birebir imzaları (yazım hatası dahil).
  for (const bozuk of ['isleniye', 'basliyor', 'kopyalaniyor', 'hazirliklari',
    'guncelleniyor', 'olusturuluyor', 'basariyla', 'Onceki', 'Degisen', 'Artimsal']) {
    assert.ok(!s.includes(bozuk), `ASCII kırpılmış metin geri gelmiş: ${bozuk}`);
  }
});

test('güncelleme bilgisi gerçek sayılarla yazılır', async () => {
  const s = await uret(GUNCELLEME);
  assert.match(s, /1\.13\.7 → 1\.13\.8/, 'sürüm geçişi yok');
  assert.match(s, /123 dosyanın 3 tanesi/, 'değişen dosya sayısı yanlış/yok');
  assert.match(s, /120 dosya yeniden kopyalanmayacak/, 'atlanan dosya sayısı yok');
});

test('ilk kurulumda güncelleme satırları GÖRÜNMEZ', async () => {
  const s = await uret(null);
  assert.ok(!/Sürüm .* → /.test(s), 'ilk kurulumda sürüm geçişi yazılmamalı');
  assert.match(s, /ilk kez kuruluyor/, 'ilk kurulum metni yok');
});

test('yayınevi adı bilgilendirmeye girer', async () => {
  const s = await uret(null);
  assert.match(s, /Yayınevi: YDS Publishing/, 'yayınevi satırı yok');
});

// ---------------------------------------------------------------------------
// ZATEN KURULU İSE YENİDEN KURMA (2026-09-20, Nadir: "öğretmenler o kadar acemi
// ki her seferinde kurulum dosyasına tekrar tıklayıp açmaya çalışanlar çok fazla").
//
// Ölçüm (Windows-Kasa x64): kurulu bir kitabı yeniden kurmak 87 saniye sürüyor ve
// sonunda hiçbir şey değişmiyor. `customInit` kurulum bölümünden ÖNCE koşar; oradan
// Quit etmek 1,3 GB'lık kurulumu hiç başlatmaz.
// Makro gerçek makensis ile derlendi (rc=0) ve Türkçe metin derlenmiş exe'de
// UTF-16 olarak birebir bulundu.
// ---------------------------------------------------------------------------

test('zaten kurulu: customInit makrosu üretilir', async () => {
  for (const bilgi of [null, GUNCELLEME]) {
    const s = await uret(bilgi);
    assert.match(s, /!macro customInit/, 'customInit makrosu yok');
    assert.match(s, /!macroend/, 'makro kapanışı yok');
  }
});

test('GERİLEME: sessiz kurulumda (/S) SORU SORULMAZ', async () => {
  // Bu kapı olmazsa MessageBox insansız koşuda süreci sonsuza kadar bekletir:
  // ProBook/Windows kabul kapısı ve toplu kurulum donar.
  const s = await uret(null);
  const init = s.slice(s.indexOf('!macro customInit'), s.indexOf('!macro customInstall'));
  assert.match(init, /IfSilent\s+\w+/, 'IfSilent kapısı yok — sessiz kurulum donar');
  const ifSilentIdx = init.indexOf('IfSilent');
  const mesajIdx = init.indexOf('MessageBox');
  assert.ok(ifSilentIdx > -1 && mesajIdx > ifSilentIdx, 'IfSilent MessageBox\'tan ÖNCE gelmeli');
});

test('zaten kurulu: yalnız sürüm AYNI ise sorulur (eski sürüm sessizce güncellenir)', async () => {
  const s = await uret(null);
  const init = s.slice(s.indexOf('!macro customInit'), s.indexOf('!macro customInstall'));
  assert.match(init, /ReadRegStr \$\w+ SHELL_CONTEXT "\$\{UNINSTALL_REGISTRY_KEY\}" DisplayVersion/,
    'kurulu sürüm okunmuyor');
  assert.match(init, /StrCmp \$\w+ "\$\{VERSION\}" 0 \w+/,
    'sürüm karşılaştırması yok — eski kurulum da soru sorardı');
});

test('zaten kurulu: kitabı açıp kurulumdan ÇIKAR', async () => {
  const s = await uret(null);
  const init = s.slice(s.indexOf('!macro customInit'), s.indexOf('!macro customInstall'));
  assert.match(init, /Exec '"\$\w+\\\$\{APP_EXECUTABLE_FILENAME\}"'/, 'kurulu uygulama çalıştırılmıyor');
  assert.match(init, /\bQuit\b/, 'Quit yok — kurulum yine de koşar (87 sn boşa gider)');
  assert.ok(init.indexOf('Exec') < init.indexOf('Quit'), 'önce çalıştır, sonra çık');
});

test('zaten kurulu: kurulum yolu kayıt defterinden okunur, sabit yol YOK', async () => {
  const s = await uret(null);
  const init = s.slice(s.indexOf('!macro customInit'), s.indexOf('!macro customInstall'));
  assert.match(init, /ReadRegStr \$\w+ SHELL_CONTEXT "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation/);
  assert.ok(!/C:\\/i.test(init), 'sabit disk yolu gömülmüş');
  assert.match(init, /IfFileExists/, 'dosya varlığı doğrulanmıyor — silinmiş kurulumda kitap açılamaz');
});

test('zaten kurulu: yazmaçlar dengeli push/pop edilir', async () => {
  const s = await uret(null);
  const init = s.slice(s.indexOf('!macro customInit'), s.indexOf('!macro customInstall'));
  const push = (init.match(/^\s*Push /gm) || []).length;
  const pop = (init.match(/^\s*Pop /gm) || []).length;
  assert.ok(push > 0, 'yazmaç korunmuyor — .onInit içindeki başka değerleri ezebilir');
  assert.strictEqual(pop % push, 0, `push=${push} pop=${pop} dengesiz`);
});

test('zaten kurulu: metin gerçek Türkçe karakterlerle yazılır', async () => {
  const s = await uret(null);
  const init = s.slice(s.indexOf('!macro customInit'), s.indexOf('!macro customInstall'));
  assert.match(init, /zaten kurulu/, 'bilgilendirme metni yok');
  assert.match(init, /[çğıöşüÇĞİÖŞÜ]/, 'ASCII fallback kullanılmış');
});
