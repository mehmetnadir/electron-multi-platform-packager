'use strict';

const path = require('path');

/**
 * Platforma göre Gradle komutunu ve chmod gereksinimini döner.
 * @param {string} platform - İşletim sistemi platformu (ör. 'win32', 'darwin')
 * @returns {{ komut: string, chmod: boolean }}
 */
function gradleKomutu(platform) {
  if (platform === 'win32') {
    return { komut: 'gradlew.bat', chmod: false };
  }
  return { komut: './gradlew', chmod: true };
}

/**
 * JDK dizini altındaki java çalıştırılabilir dosyasının yolunu döner.
 * @param {string} home - JDK kök dizin yolu
 * @param {string} platform - İşletim sistemi platformu
 * @returns {string} java ikili dosya yolu
 */
function javaIkiliYolu(home, platform) {
  const javaBin = platform === 'win32' ? 'java.exe' : 'java';
  return path.join(home, 'bin', javaBin);
}

/**
 * Android SDK kök dizinini çevre değişkenlerinden çözer veya varsayılanı döner.
 * ANDROID_HOME veya ANDROID_SDK_ROOT tanımsız ise ve platform darwin değilse hata fırlatır.
 * @param {Object} env - Çevre değişkenleri nesnesi
 * @param {string} platform - İşletim sistemi platformu
 * @returns {string} Android SDK kök yolu
 */
function androidSdkKoku(env, platform) {
  const sdk = env && (env.ANDROID_HOME || env.ANDROID_SDK_ROOT);
  if (sdk) return sdk;

  if (platform === 'darwin') {
    return '/Users/nadir/Library/Android/sdk';
  }

  throw new Error('ANDROID_HOME tanımsız');
}

/**
 * Platforma özel JAVA_HOME aday yollarının listesini döner.
 * @param {Object} env - Çevre değişkenleri nesnesi
 * @param {string} platform - İşletim sistemi platformu
 * @returns {string[]} JAVA_HOME aday yolları
 */
function javaHomeAdaylari(env, platform) {
  const candidates = [];
  if (env && env.JAVA_HOME) {
    candidates.push(env.JAVA_HOME);
  }
  if (platform === 'darwin') {
    candidates.push('/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home');
    candidates.push('/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home');
  }
  return candidates;
}

module.exports = {
  gradleKomutu,
  javaIkiliYolu,
  androidSdkKoku,
  javaHomeAdaylari
};
