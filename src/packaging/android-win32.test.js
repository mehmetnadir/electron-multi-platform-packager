'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  gradleKomutu,
  javaIkiliYolu,
  androidSdkKoku,
  javaHomeAdaylari
} = require('./android-win32');

test('gradleKomutu win32 ve darwin durumları', () => {
  assert.deepStrictEqual(gradleKomutu('win32'), { komut: 'gradlew.bat', chmod: false });
  assert.deepStrictEqual(gradleKomutu('darwin'), { komut: './gradlew', chmod: true });
  assert.deepStrictEqual(gradleKomutu('linux'), { komut: './gradlew', chmod: true });
});

test('javaIkiliYolu win32 ve darwin durumları', () => {
  const home = '/fake/jdk/path';
  assert.strictEqual(javaIkiliYolu(home, 'win32'), path.join(home, 'bin', 'java.exe'));
  assert.strictEqual(javaIkiliYolu(home, 'darwin'), path.join(home, 'bin', 'java'));
  assert.strictEqual(javaIkiliYolu(home, 'linux'), path.join(home, 'bin', 'java'));
});

test('androidSdkKoku env tanımlı iken', () => {
  assert.strictEqual(
    androidSdkKoku({ ANDROID_HOME: '/custom/android/sdk' }, 'win32'),
    '/custom/android/sdk'
  );
  assert.strictEqual(
    androidSdkKoku({ ANDROID_SDK_ROOT: '/custom/sdk/root' }, 'linux'),
    '/custom/sdk/root'
  );
  assert.strictEqual(
    androidSdkKoku({ ANDROID_HOME: '/custom/android/sdk' }, 'darwin'),
    '/custom/android/sdk'
  );
});

test('androidSdkKoku ANDROID_HOME yokken win32 hata, darwin eski yol', () => {
  assert.throws(
    () => androidSdkKoku({}, 'win32'),
    { message: 'ANDROID_HOME tanımsız' }
  );
  assert.throws(
    () => androidSdkKoku({}, 'linux'),
    { message: 'ANDROID_HOME tanımsız' }
  );
  assert.strictEqual(
    androidSdkKoku({}, 'darwin'),
    '/Users/nadir/Library/Android/sdk'
  );
});

test('javaHomeAdaylari win32 ve darwin durumları', () => {
  const envWithJava = { JAVA_HOME: '/opt/java' };
  assert.deepStrictEqual(javaHomeAdaylari(envWithJava, 'win32'), ['/opt/java']);
  assert.deepStrictEqual(javaHomeAdaylari({}, 'win32'), []);

  assert.deepStrictEqual(javaHomeAdaylari(envWithJava, 'darwin'), [
    '/opt/java',
    '/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'
  ]);
  assert.deepStrictEqual(javaHomeAdaylari({}, 'darwin'), [
    '/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'
  ]);
});
