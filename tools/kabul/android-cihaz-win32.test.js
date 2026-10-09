'use strict';
/**
 * android-cihaz-win32.test.js — Windows (win32) uyumluluk saf fonksiyon testleri.
 * sdkIkilileri, kanitDizini, sdkKoku yardımcı fonksiyonlarının win32/darwin davranışlarını sınar.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { sdkIkilileri, kanitDizini, sdkKoku, bootZamanAsimiSn, kurulumArgumanlari, kurulumSebebi, emuEkArgumanlari } = require('./android-cihaz');

test('sdkKoku: win32 env yokken null döndürür', () => {
  assert.equal(sdkKoku({}, 'win32'), null);
});

test('sdkKoku: win32 env varken ANDROID_HOME veya ANDROID_SDK_ROOT döndürür', () => {
  assert.equal(sdkKoku({ ANDROID_HOME: 'C:\\Android\\sdk' }, 'win32'), 'C:\\Android\\sdk');
  assert.equal(sdkKoku({ ANDROID_SDK_ROOT: 'C:\\Android\\sdk2' }, 'win32'), 'C:\\Android\\sdk2');
});

test('sdkKoku: darwin env yokken ~/Library/Android/sdk varsayılanını döndürür', () => {
  const varsayilan = path.join(os.homedir(), 'Library', 'Android', 'sdk');
  assert.equal(sdkKoku({}, 'darwin'), varsayilan);
});

test('sdkIkilileri: win32 için .exe uzantısı ve Homebrew adaysız aday listesi verir', () => {
  const sonuc = sdkIkilileri('C:\\Android\\sdk', 'win32');
  assert.deepEqual(sonuc.adbAday, ['C:\\Android\\sdk\\platform-tools\\adb.exe']);
  assert.deepEqual(sonuc.emulatorAday, ['C:\\Android\\sdk\\emulator\\emulator.exe']);
});

test('sdkIkilileri: darwin için varsayılan ikili aday listesini verir', () => {
  const sonuc = sdkIkilileri('/Users/test/Library/Android/sdk', 'darwin');
  assert.deepEqual(sonuc.adbAday, [
    '/Users/test/Library/Android/sdk/platform-tools/adb',
    '/usr/local/bin/adb',
    '/opt/homebrew/bin/adb',
  ]);
  assert.deepEqual(sonuc.emulatorAday, [
    '/Users/test/Library/Android/sdk/emulator/emulator',
  ]);
});

test('kanitDizini: win32 env yokken D:\\empp-kabul\\android\\<bookId> döndürür', () => {
  assert.equal(kanitDizini('45469', 'win32', {}), 'D:\\empp-kabul\\android\\45469');
});

test('kanitDizini: win32 EMPP_KABUL_KANIT_KOK ile ezilebilir', () => {
  const env = { EMPP_KABUL_KANIT_KOK: 'E:\\ozel-kanit' };
  assert.equal(kanitDizini('45469', 'win32', env), 'E:\\ozel-kanit\\android\\45469');
});

test('kanitDizini: darwin varsayılan ve EMPP_KABUL_KANIT_KOK ile ezilmiş dizini döndürür', () => {
  const envVarsayilan = { HOME: '/Users/test' };
  assert.equal(kanitDizini('45469', 'darwin', envVarsayilan), '/Users/test/.empp-agent/kabul-kanit/android/45469');

  const envOzel = { EMPP_KABUL_KANIT_KOK: '/tmp/kanit-dizini' };
  assert.equal(kanitDizini('45469', 'darwin', envOzel), '/tmp/kanit-dizini/android/45469');
});

test('bootZamanAsimiSn: win32 varsayılanı 600 (kasa soğuk açılış 259 sn ölçüldü), darwin 240', () => {
  assert.equal(bootZamanAsimiSn({}, {}, 'win32'), 600);
  assert.equal(bootZamanAsimiSn({}, {}, 'darwin'), 240);
});

test('bootZamanAsimiSn: çağıran bootSn > EMPP_KABUL_BOOT_SN > platform varsayılanı', () => {
  assert.equal(bootZamanAsimiSn({ bootSn: 90 }, { EMPP_KABUL_BOOT_SN: '700' }, 'win32'), 90);
  assert.equal(bootZamanAsimiSn({}, { EMPP_KABUL_BOOT_SN: '700' }, 'darwin'), 700);
  assert.equal(bootZamanAsimiSn({ bootSn: 0 }, { EMPP_KABUL_BOOT_SN: 'x' }, 'win32'), 600);
});

test('kurulumArgumanlari: win32 --no-streaming (akışlı kurulum kasada boş sebeple düştü), darwin akışlı', () => {
  assert.deepEqual(kurulumArgumanlari({}, 'win32'), ['--no-streaming']);
  assert.deepEqual(kurulumArgumanlari({}, 'darwin'), []);
  assert.deepEqual(kurulumArgumanlari({ EMPP_KABUL_ADB_AKISSIZ: '1' }, 'darwin'), ['--no-streaming']);
  assert.deepEqual(kurulumArgumanlari({ EMPP_KABUL_ADB_AKISSIZ: '0' }, 'win32'), []);
});

test('kurulumSebebi: uzun hatada BAŞ (istisna metni) ve SON (yığın) birlikte kalır', () => {
  const r = kurulumSebebi({ status: 1, stderr: 'Exception occurred while executing install: java.lang.SecurityException: SEBEP ' + 'x'.repeat(600) + ' SON-IZ' });
  assert.match(r, /^rc=1 Exception occurred while executing install: java.lang.SecurityException: SEBEP/);
  assert.match(r, /SON-IZ$/);
  assert.ok(r.length <= 420);
});

test('emuEkArgumanlari: win32 -cores 4 (system_server düşmesi), darwin boş, env ezer', () => {
  assert.deepEqual(emuEkArgumanlari({}, 'win32'), ['-cores', '4']);
  assert.deepEqual(emuEkArgumanlari({}, 'darwin'), []);
  assert.deepEqual(emuEkArgumanlari({ EMPP_KABUL_EMU_CORES: '2' }, 'win32'), ['-cores', '2']);
});
