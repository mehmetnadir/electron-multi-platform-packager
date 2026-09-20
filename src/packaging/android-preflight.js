'use strict';
// K14 (2026-09-09, Tudem 13 ISO batch dersi) — Android build başlamadan ÖNCE
// Gradle heap ayarını KONTROL EDER (değiştirmez, sadece uyarır).
//
// NEDEN: Bu Mac'te `~/.gradle/gradle.properties` YOKTU — Gradle varsayılan
// `org.gradle.jvmargs` heap'i (JVM varsayılanı, tipik olarak ~512MB-1GB'lık bir
// worker heap'i) ile başladı. Büyük bir kitabın (çok sayıda asset/derin dizin
// ağacı) Android build'i bu heap'le OOM (`OutOfMemoryError: Java heap space`
// veya sessiz gradle daemon crash) verdi.
// BELİRTİ: `./gradlew assembleRelease` build ortasında (genelde resource
// merge/dexing aşamasında) sebepsiz çöküyor, hata mesajı bazen JVM heap'ten
// bahsetmiyor bile (gradle daemon "Disconnected" gibi belirsiz bir hata verir).
// KANIT: 2026-09-09, Tudem 13 ISO batch — `~/.gradle/gradle.properties`
// EKLENDİKTEN (Xmx6g+) SONRA aynı kitap sorunsuz build oldu.
//
// KARAR (Nadir, 2026-09-09): paketleyici bu dosyayı KENDİSİ DEĞİŞTİRMEZ —
// geliştiricinin/operatörün genel Gradle ortam ayarına paketleyici müdahale
// etmemeli (başka projeler de aynı `~/.gradle/gradle.properties`'i kullanır,
// paketleyici onu sessizce büyütürse başka bir aracın davranışını da değiştirir).
// Bunun yerine build başlamadan ÖNCE AÇIK bir `log.warn` ile operatörü bilgilendirir
// — build devam eder (engellenmez), ama "neden OOM oldu" sorusuna cevap artık
// build başlamadan ÖNCE loglarda vardır.
//
// BOZARSAN: `android-preflight.test.js`'teki testler kırılır.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MIN_RECOMMENDED_XMX_GB = 6;

/**
 * `-Xmx<sayı><g|m|k>` biçimindeki bir JVM heap değerini GB'a çevirir.
 * @returns {number|null} GB olarak heap, ayrıştırılamazsa null.
 */
function parseXmxToGb(jvmargsValue) {
  if (!jvmargsValue) return null;
  const m = /-Xmx(\d+(?:\.\d+)?)([gGmMkK])/.exec(jvmargsValue);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'g') return num;
  if (unit === 'm') return num / 1024;
  return num / (1024 * 1024); // k
}

/**
 * `gradle.properties` içeriğinden `org.gradle.jvmargs` değerini okur.
 * (Basit satır bazlı ayrıştırma — Java `.properties` çok satırlı `\` devamını
 * destekler ama bu dosyada pratikte kullanılmıyor, gereksiz karmaşıklık eklenmedi.)
 */
function readJvmArgsLine(propsContent) {
  const lines = String(propsContent).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('!') || !trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key === 'org.gradle.jvmargs') {
      return trimmed.slice(eq + 1).trim();
    }
  }
  return null;
}

/**
 * Android build'inden ÖNCE çağrılır. `homeDir` verilmezse `os.homedir()`
 * kullanılır (test'te sahte HOME enjekte edilebilir). Dosyayı DEĞİŞTİRMEZ.
 * @param {{ homeDir?: string, logger?: { warn: Function, log?: Function } }} [opts]
 * @returns {{ propsPath: string, exists: boolean, xmxGb: number|null, ok: boolean, warned: boolean }}
 */
function checkAndroidGradleHeapPreflight(opts = {}) {
  const homeDir = opts.homeDir || os.homedir();
  const logger = opts.logger || console;
  const propsPath = path.join(homeDir, '.gradle', 'gradle.properties');

  let exists = false;
  let xmxGb = null;
  try {
    exists = fs.existsSync(propsPath);
    if (exists) {
      const content = fs.readFileSync(propsPath, 'utf8');
      xmxGb = parseXmxToGb(readJvmArgsLine(content));
    }
  } catch (readErr) {
    // Okuma başarısız olsa da (izin, bozuk dosya vb.) preflight build'i DURDURMAZ —
    // yalnız "kontrol edilemedi" olarak uyarır.
    logger.warn(`⚠️ Android ön-kontrol: ${propsPath} okunamadı (${readErr.message}) — Gradle heap doğrulanamadı, build devam ediyor.`);
    return { propsPath, exists, xmxGb: null, ok: false, warned: true };
  }

  const ok = typeof xmxGb === 'number' && xmxGb >= MIN_RECOMMENDED_XMX_GB;
  let warned = false;
  if (!exists) {
    logger.warn(
      `⚠️ Android ön-kontrol: ${propsPath} YOK — Gradle varsayılan heap ile çalışacak. ` +
      `Büyük kitaplarda OOM riski (2026-09-09 Tudem dersi). Önerilen: ` +
      `org.gradle.jvmargs=-Xmx${MIN_RECOMMENDED_XMX_GB}g satırını EKLE (paketleyici bu dosyayı OTOMATİK değiştirmez).`
    );
    warned = true;
  } else if (!ok) {
    logger.warn(
      `⚠️ Android ön-kontrol: ${propsPath} içinde org.gradle.jvmargs Xmx${xmxGb != null ? xmxGb + 'g' : '?'} — ` +
      `önerilen ≥${MIN_RECOMMENDED_XMX_GB}g'dan AZ. Büyük kitaplarda OOM riski. Paketleyici bu dosyayı DEĞİŞTİRMEZ, elle güncelle.`
    );
    warned = true;
  }

  return { propsPath, exists, xmxGb, ok, warned };
}

module.exports = { checkAndroidGradleHeapPreflight, parseXmxToGb, MIN_RECOMMENDED_XMX_GB };
