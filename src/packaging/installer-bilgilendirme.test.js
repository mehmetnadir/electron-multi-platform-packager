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

async function uret(updateInfo) {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'empp-nsh-'));
  await fs.ensureDir(path.join(kok, 'build'));
  await svc.createCustomInstallationFiles(kok, 'Super Monsters 4', 'YDS Publishing', null, updateInfo);
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
