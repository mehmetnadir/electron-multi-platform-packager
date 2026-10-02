'use strict';

/**
 * NSIS kurulum görünürlüğü + zamanlama testleri (`nsis-kurulum.js`).
 *
 * İki katman:
 *  1) Metin sözleşmesi — üretilen NSIS'in değişmezleri (sahte yüzde yok, kaldırıcı
 *     derlemesinde şablon davranışı birebir, yalnız $EXEPATH kopyası atlanır…).
 *  2) GERÇEK makensis derlemesi (-WX, uyarı = hata) — electron-builder'ın kendi
 *     makensis'i ve şablon include/eklenti dizinleriyle, yükleyici VE kaldırıcı
 *     derlemesi ayrı ayrı. makensis yoksa (CI) atlanır.
 *     Uçtan uca (gerçek electron-builder + Wine'da sessiz kurulum) 2026-09-26'da
 *     scratchpad'de koşuldu: günlük satırları UTF-8, "paket açma bitti | 184 MB".
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const nk = require('./nsis-kurulum');

const NSIS_KOK = path.join(os.homedir(), 'Library', 'Caches', 'electron-builder', 'nsis');
const MAKENSIS = path.join(NSIS_KOK, 'nsis-3.0.4.1', 'mac', 'makensis');
const EKLENTI = path.join(NSIS_KOK, 'nsis-resources-3.4.1', 'plugins', 'x86-unicode');
const SABLON_INCLUDE = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates', 'nsis', 'include');

test('userDataAdi: productName > name; geçersiz karakter → null', () => {
  assert.strictEqual(nk.userDataAdi({ name: 'super-monsters-2-set' }), 'super-monsters-2-set');
  assert.strictEqual(nk.userDataAdi({ name: 'a', productName: 'Güzel Kitap' }), 'Güzel Kitap');
  assert.strictEqual(nk.userDataAdi({ name: 'a/b' }), null);
  assert.strictEqual(nk.userDataAdi(null), null);
});

test('nsisKacis: $ ikilenir, çift tırnak kaçar, satır sonu düşer', () => {
  assert.strictEqual(nk.nsisKacis('a$b"c\nd'), 'a$$b$\\"c d');
});

test('ortakBaslik: günlük yolu userData adıyla; bizim değişken/fonksiyonlar YALNIZ yükleyicide; pid her ikisinde', () => {
  const b = nk.ortakBaslik({ userData: 'super-monsters-2-set' });
  assert.match(b, /!define \/ifndef EMPP_USERDATA_ADI "super-monsters-2-set"/);
  assert.match(b, /!define \/ifndef EMPP_GUNLUK_ADI "acilis-zamanlama\.log"/);
  const ifndef = b.indexOf('!ifndef BUILD_UNINSTALLER');
  assert.ok(ifndef > b.indexOf('Var pid'), 'Var pid kaldırıcıda da gerekli (şablon _CHECK_APP_RUNNING)');
  for (const f of ['emppGunlukYaz', 'emppMetin', 'emppAcmaGeriCagrisi', 'emppAcmaOncesi']) {
    assert.ok(b.indexOf(`Function ${f}`) > ifndef, `${f} kaldırıcı derlemesine sızıyor (-WX: kullanılmayan fonksiyon)`);
  }
  // şablon tanımlarına bağımlı değil (başlık şablondan ÖNCE derleniyor)
  assert.ok(!/\$\{UNINSTALL_REGISTRY_KEY\}|\$\{APP_EXECUTABLE_FILENAME\}/.test(b));
  // Nsis7z çağrısı başlıkta YOK (eklenti dizini henüz eklenmemiş olabilir)
  assert.ok(!/Nsis7z::/.test(b));
  // UTF-8'e çevrilerek yazılır, hata bayrağı korunur
  assert.match(b, /WideCharToMultiByte\(i 65001/);
  assert.match(b, /IfErrors 0 \+2\n\s+StrCpy \$R8 1/);
});

test('sahte ilerleme YOK: yüzde ya da Sleep üretilmez; sayaç gerçek bayttan', () => {
  const hepsi = nk.ortakBaslik({ userData: 'x' }) + nk.ovrIcerigi() + nk.customInitBasi()
    + nk.customInstallSonu() + nk.customCheckAppRunningMakro('/a/b.nsh');
  assert.ok(!/\bSleep\b/.test(hepsi));
  assert.ok(!/%\s*"|\[\d+%\]/.test(hepsi));
  assert.match(hepsi, /Dosyalar açılıyor: \$emppAcilanMb \/ \$emppToplamMb MB/);
  assert.match(hepsi, /System::Int64Op \$emppAcilan \/ 1048576/);
});

test('customCheckAppRunning: kaldırıcıda yalnız şablon davranışı; yükleyicide ovr include + evre', () => {
  const m = nk.customCheckAppRunningMakro('C:\\x\\empp-kurulum-ovr.nsh');
  assert.match(m, /!ifdef BUILD_UNINSTALLER\n\s+!insertmacro _CHECK_APP_RUNNING\n\s+!else/);
  assert.match(m, /!include "C:\/x\/empp-kurulum-ovr\.nsh"/);
  const yuk = m.slice(m.indexOf('!else'));
  assert.ok(yuk.indexOf('emppPencereHazir') < yuk.indexOf('_CHECK_APP_RUNNING'));
  assert.ok(yuk.indexOf('_CHECK_APP_RUNNING') < yuk.indexOf('emppEskiSurum'));
});

test('customCheckAppRunning: Windows derlemesinde ters bölü KORUNUR (makensis win ileri bölüyü bulamaz)', () => {
  // Ölçüm 2026-10-02 windows-kasa, makensis 3.0.4.1: "D:/…/inc.nsh" → could not find, "D:\…\inc.nsh" → OK.
  const m = nk.customCheckAppRunningMakro('D:\\empp\\temp\\j\\app\\build\\empp-kurulum-ovr.nsh', 'win32');
  assert.match(m, /!include "D:\\empp\\temp\\j\\app\\build\\empp-kurulum-ovr\.nsh"/);
  assert.ok(!m.includes('D:/empp'), 'Windows yolunda ileri bölü kalmamalı');
  // macOS/Linux: ileri bölü (değişmedi)
  assert.match(nk.customCheckAppRunningMakro('C:\\x\\y.nsh', 'darwin'), /!include "C:\/x\/y\.nsh"/);
  assert.match(nk.customCheckAppRunningMakro('/a/b.nsh', 'linux'), /!include "\/a\/b\.nsh"/);
});

test('ovr: doğrudan açma (ara dizin/CopyFiles YOK), yalnız $EXEPATH kopyası atlanır, üç mimari', () => {
  const o = nk.ovrIcerigi();
  const ac = o.slice(o.indexOf('!macro extractUsing7za'), o.indexOf('!macroend', o.indexOf('!macro extractUsing7za')));
  assert.match(ac, /Nsis7z::ExtractWithCallback "\$\{FILE\}" \$emppGeriCagri/);
  assert.ok(!/7z-out|CopyFiles/.test(ac), 'ara dizin/kopya geri gelmiş (çift yazma)');
  assert.match(o, /!if "\$\{FROM\}" == "\$EXEPATH"/);
  assert.match(o, /CopyFiles \/SILENT `\$\{FROM\}` `\$\{TO\}`/, 'diğer copyFile çağrıları şablonla aynı kalmalı');
  for (const m of ['ia32_app_files', 'x64_app_files', 'arm64_app_files', 'extractUsing7za', 'copyFile']) {
    assert.match(o, new RegExp(`!macroundef ${m}\\n!macro ${m}`));
  }
});

function makensisVarMi() {
  return fs.existsSync(MAKENSIS) && fs.existsSync(path.join(EKLENTI, 'nsis7z.dll')) && fs.existsSync(SABLON_INCLUDE);
}

/** Şablonun sırasını taklit eden en küçük betik: başlık → şablon makroları → Section. */
function betikYaz(dizin) {
  const ovr = path.join(dizin, nk.OVR_ADI);
  fs.writeFileSync(ovr, nk.ovrIcerigi());
  const inc = path.join(dizin, 'installer.nsh');
  fs.writeFileSync(inc, [
    'CRCCheck off',
    nk.ortakBaslik({ userData: 'super-monsters-2-set' }),
    `!macro customInit\n${nk.customInitBasi()}\n!macroend`,
    `!macro customInstall\n${nk.customInstallSonu()}\n!macroend`,
    nk.customCheckAppRunningMakro(ovr),
  ].join('\n'));
  const nsi = path.join(dizin, 'deneme.nsi');
  fs.writeFileSync(nsi, `Unicode true
!addincludedir "${SABLON_INCLUDE}"
!include "StdUtils.nsh"
!include "${inc}"
!addplugindir /x86-unicode "${EKLENTI}"
!include "LogicLib.nsh"
!include "WinMessages.nsh"
OutFile "${path.join(dizin, 'o.exe')}"
RequestExecutionLevel user
!macro _CHECK_APP_RUNNING
  \${GetProcessInfo} 0 $pid $1 $2 $3 $4
!macroend
!macro ia32_app_files
  DetailPrint "sablon"
!macroend
!macro x64_app_files
!macroend
!macro arm64_app_files
!macroend
!macro extractUsing7za FILE
!macroend
!macro copyFile FROM TO
!macroend
!ifdef BUILD_UNINSTALLER
Function .onInit
  WriteUninstaller "$TEMP\\u.exe"
FunctionEnd
Function un.onInit
  !insertmacro customCheckAppRunning
FunctionEnd
Section
SectionEnd
Section "un.install"
SectionEnd
!else
Function .onInit
  !insertmacro customInit
FunctionEnd
Section
  !insertmacro customCheckAppRunning
  !insertmacro ia32_app_files
  !insertmacro extractUsing7za "$PLUGINSDIR\\app-32.7z"
  !insertmacro copyFile "$EXEPATH" "$LOCALAPPDATA\\x\\installer.exe"
  !insertmacro copyFile "$R1" "$R2"
  !insertmacro customInstall
SectionEnd
!endif
`);
  return nsi;
}

function derle(nsi, ekler) {
  return spawnSync(MAKENSIS, ['-V4', '-WX', '-INPUTCHARSET', 'UTF8', '-DVERSION=2.51.0', '-DPRODUCT_NAME=Super Monsters 2 Set',
    '-DPRODUCT_FILENAME=Super Monsters 2 Set', '-DUNINSTALL_APP_KEY=abc', '-DAPP_32=' + nsi,
    '-DCOMPRESSION_METHOD=7z', ...ekler, nsi], {
    encoding: 'utf8', env: { ...process.env, NSISDIR: path.join(NSIS_KOK, 'nsis-3.0.4.1') }, timeout: 60000,
  });
}

test('GERÇEK makensis -WX: yükleyici derlemesi temiz, geçersiz kılmalar uygulanır', { skip: !makensisVarMi() && 'makensis yok' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-nsisk-'));
  const r = derle(betikYaz(d), []);
  assert.strictEqual(r.status, 0, (r.stdout || '').split('\n').slice(-25).join('\n') + r.stderr);
  // şablonun ia32_app_files'ı değil bizimki: File + emppDosyaHazirlandi
  assert.ok(!/DetailPrint: "sablon"/.test(r.stdout), 'ia32_app_files geçersiz kılınmadı');
  assert.match(r.stdout, /Plugin command: ExtractWithCallback \$PLUGINSDIR\\app-32\.7z \$emppGeriCagri/);
  assert.match(r.stdout, /File: "deneme\.nsi"->"\$PLUGINSDIR\\app-32\.7z"/);
  // $EXEPATH kopyası derlenmedi; öteki copyFile şablon gövdesiyle derlendi
  const kopyalar = r.stdout.split('\n').filter((l) => /^CopyFiles:/.test(l));
  assert.deepStrictEqual(kopyalar, ['CopyFiles: (silent) "$R1" -> "$R2", size=0KB']);
  assert.ok(fs.existsSync(path.join(d, 'o.exe')));
});

test('GERÇEK makensis -WX: kaldırıcı derlemesi (BUILD_UNINSTALLER) temiz — bizim fonksiyonlar sızmıyor', { skip: !makensisVarMi() && 'makensis yok' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-nsisk-'));
  const r = derle(betikYaz(d), ['-DBUILD_UNINSTALLER']);
  assert.strictEqual(r.status, 0, (r.stdout || '').split('\n').slice(-25).join('\n') + r.stderr);
  assert.ok(!/emppGunlukYaz/.test(r.stdout.split('Processed')[1] || ''), 'kaldırıcıya günlük fonksiyonu girmiş');
});
