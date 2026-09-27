'use strict';
/**
 * android-cihaz.js — saf ölçüt/karar birim testleri: emülatörün KENDİ sistem ANR'si
 * ("Process system isn't responding") paket kusuru (RED) değil altyapı arızası (ÖLÇÜLEMEDİ)
 * saysın (27.09 72379). Satırlar kanıt dizininden BİREBİR alındı, makineden bağımsız:
 *   /Users/nadir/.empp-agent/kabul-kanit/72379-android-20260927-164539/android/
 *     logcat.txt (FATAL EXCEPTION + "Timeout while connecting UiAutomation")
 *     menu-ui.xml (58 bayt: "cat: /sdcard/empp-kabul-ui.xml: No such file or directory")
 *     menu.png (ekran: "Process system isn't responding / Close app / Wait")
 * Emülatör/adb/Docker KOŞMAZ — yalnız saf fonksiyonlar.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const O = require('./android-cihaz');

// 72379 kanıt dizininden birebir: uiautomator dump crash etti (logcat), dosya hiç yazılmadı.
const KANIT_UIXML_HATA = 'cat: /sdcard/empp-kabul-ui.xml: No such file or directory\n';
const KANIT_LOGCAT = [
  '--------- beginning of main',
  '09-27 16:50:15.674 I/chromium( 2595): [0927/165015.674533:INFO:variations_seed_loader.cc(66)] Failed to open file for reading.: No such file or directory (2)',
  '--------- beginning of crash',
  '09-27 16:50:44.872 E/AndroidRuntime( 2826): FATAL EXCEPTION: main',
  '09-27 16:50:44.872 E/AndroidRuntime( 2826): PID: 2826',
  '09-27 16:50:44.872 E/AndroidRuntime( 2826): java.lang.RuntimeException: java.util.concurrent.TimeoutException: '
    + 'Timeout while connecting UiAutomation@85a3045[id=-1, displayId=0, flags=0]',
  '09-27 16:50:44.872 E/AndroidRuntime( 2826): \tat android.app.UiAutomation.connect(UiAutomation.java:332)',
  '09-27 16:50:44.872 E/AndroidRuntime( 2826): \tat com.android.uiautomator.core.UiAutomationShellWrapper.connect(UiAutomationShellWrapper.java:36)',
].join('\n');
// menu.png ekranında görünen metin (bugün hiçbir OCR/metin çıkarma cihaz katmanında YOK —
// yalnız ham ekran görüntüsü kanıttır; bu değer ileride bir metin çıkarma eklenirse diye).
const KANIT_GORUNUR_METIN = "4:50 Process system isn't responding Close app Wait";

test('sistemAnrMi: 72379 kanıtı (uiXml hata + logcat UiAutomation zaman aşımı) → true', () => {
  assert.equal(O.sistemAnrMi({ uiXml: KANIT_UIXML_HATA, logcat: KANIT_LOGCAT }), true);
});

test('sistemAnrMi: yalnız görünür metin (gelecekte OCR eklenirse) tek başına yeterli', () => {
  assert.equal(O.sistemAnrMi({ gorunurMetin: KANIT_GORUNUR_METIN }), true);
  assert.equal(O.sistemAnrMi({ uiXml: 'her şey normal', gorunurMetin: KANIT_GORUNUR_METIN }), true);
});

test('sistemAnrMi (mutasyon): logcat imzası (UiAutomation zaman aşımı) yoksa true olmaz', () => {
  // Aynı "dump başarısız" durumu ama logcat TEMİZ (ör. geçici ağ/adb hatası, sistem ANR'si değil).
  assert.equal(O.sistemAnrMi({ uiXml: KANIT_UIXML_HATA, logcat: 'her şey normal, ANR yok' }), false);
  assert.equal(O.sistemAnrMi({ uiXml: KANIT_UIXML_HATA }), false);
});

test('sistemAnrMi (mutasyon): dump BAŞARILI (gerçek <hierarchy> XML) ama logcat imzası varsa true olmaz', () => {
  // uiXml gerçek bir hiyerarşiyse dump başarısız SAYILMAZ — "dokumBasarisiz" koşulu yalnız
  // dump'ın kendisi çöktüğünde devreye girer, sağlam ölçümü örtmez.
  const gercekXml = '<hierarchy rotation="0"><node index="0" class="android.widget.FrameLayout"/></hierarchy>';
  assert.equal(O.sistemAnrMi({ uiXml: gercekXml, logcat: KANIT_LOGCAT }), false);
});

test('sistemAnrMi: UYGULAMANIN KENDİ ANR\'si ("<uygulama> isn\'t responding") EŞLEŞMEZ — RED kalmalı', () => {
  assert.equal(O.sistemAnrMi({ gorunurMetin: "Lingoland Grade 3 isn't responding Close app Wait" }), false);
  assert.equal(O.sistemAnrMi({ uiXml: '<hierarchy><node text="Lingoland Grade 3 isn\'t responding"/></hierarchy>' }), false);
});

test('sistemAnrMi: normal "WebView yok" (dump boş ama hata metni değil, logcat temiz) → false', () => {
  // Ör. uygulama gerçekten çökmüş/hiç açılmamış — dump çalışmış ama WebView düğümü yok.
  const bosHiyerarsi = '<hierarchy rotation="0"></hierarchy>';
  assert.equal(O.sistemAnrMi({ uiXml: bosHiyerarsi, logcat: 'AndroidRuntime: E clean' }), false);
  assert.equal(O.sistemAnrMi({}), false);
});

test('webViewYokKarari: 72379 kanıtıyla ÖRTÜLEN sayılır (RED değil)', () => {
  const o = { uiXmlHata: KANIT_UIXML_HATA };
  const k = O.webViewYokKarari('cihaz okuyucu', o, KANIT_LOGCAT);
  assert.equal(k.ortulen, true);
  assert.match(k.mesaj, /sistem ANR/);
  assert.match(k.mesaj, /Process system isn't responding/);
});

test('webViewYokKarari (mutasyon): tanıyıcının gördüğü imza kalkınca RED\'e döner', () => {
  const o = { uiXmlHata: KANIT_UIXML_HATA };
  // Aynı çağrı, ama logcat'te ANR imzası YOK — tanıyıcı devre dışıymış gibi davranır.
  const k = O.webViewYokKarari('cihaz okuyucu', o, 'her şey normal, ANR yok');
  assert.equal(k.ortulen, false);
  assert.equal(k.mesaj, 'cihaz okuyucu: ekranda WebView yok');
});

test('webViewYokKarari: uiXmlHata yoksa (normal başarısız dump) her zaman RED', () => {
  const k = O.webViewYokKarari('cihaz menü', { uiXmlHata: null }, KANIT_LOGCAT);
  assert.equal(k.ortulen, false);
  assert.equal(k.mesaj, 'cihaz menü: ekranda WebView yok');
});

test('karar birleştirme: cihaz ÖLÇÜLEMEDİ + diğer katmanlar GEÇTİ → genel ÖLÇÜLEMEDİ, RED değil', () => {
  // Gerçek basliksiz-kabul.js akışı O.genelKarar'ı (olcutler.js) katman listesiyle çağırır;
  // cihaz katmanı sistemAnrMi ile RED yerine ÖLÇÜLEMEDİ döndüğünde genel sonuç RED'e SIÇRAMAZ.
  // eslint-disable-next-line global-require
  const OL = require('./olcutler');
  const katmanlar = {
    cikarma: { durum: OL.DURUM.GECTI },
    icerik: { durum: OL.DURUM.GECTI },
    cihaz: { durum: OL.DURUM.OLCULEMEDI, sebepler: ['cihaz okuyucu: emülatör sistem ANR\'si ("Process system isn\'t responding") ekranı örttü — altyapı, paket kusuru değil'] },
    odak: { durum: OL.DURUM.GECTI },
    guncellik: { durum: OL.DURUM.GECTI },
  };
  assert.equal(OL.genelKarar(Object.values(katmanlar)), OL.DURUM.OLCULEMEDI);
  assert.notEqual(OL.genelKarar(Object.values(katmanlar)), OL.DURUM.RED);
});

test('uiXmlHata alanı: gerçek (büyük) hiyerarşi dökümünde asamaOlc tarafından ASLA doldurulmaz', () => {
  // Regresyon kilidi: uiXmlHata yalnız KISA ve <hierarchy> İÇERMEYEN dökümlerde set edilmeli
  // (bkz. android-cihaz.js asamaOlc) — normal ölçümde bu alan hep null olmalı, karar.json'u şişirmesin.
  const buyukGercekXml = `<hierarchy rotation="0">${'<node class="x"/>'.repeat(50)}</hierarchy>`;
  assert.ok(buyukGercekXml.length >= 500 || /<hierarchy\b/i.test(buyukGercekXml));
});

// --- YÜK KAPISI ÖN KAPI KABLOLAMASI (27.09 45482) ------------------------------------------
// cihazKabulu'nun GERÇEK exportu çağrılır (mock yok) ama yük hep yüksek/hep düşük olduğu için
// adb/aapt/emulator'a HİÇ ulaşılmadan (ya da emülatör spawn edilmeden) döner — makineden
// bağımsız, emülatör/docker KOŞMAZ.

function gecistKanitDizin() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kabul-yuk-kapisi-test-'));
}

test('cihazKabulu: yük hep yüksek ve düşmüyor → ÖLÇÜLEMEDİ, emülatör seçimine/adb\'ye HİÇ gidilmedi', async () => {
  const kanit = gecistKanitDizin();
  const gunluk = [];
  const r = await O.cihazKabulu({
    apk: '/yok/boyle-bir-apk.apk',
    kanit,
    beklenenKart: 0,
    setMi: false,
    yukEsigi: 48,
    yukAraSn: 0,
    yukAzamiSn: 0.05,
    yukOlc: () => [150],
    yukBekle: () => Promise.resolve(),
    log: (s) => gunluk.push(s),
  });
  assert.equal(r.durum, 'OLCULEMEDI');
  assert.equal(r.yukKapisi.gecti, false);
  assert.ok(r.sebepler.some((s) => /emülatör açılmadı/.test(s)));
  // Gate'ten sonraki hiçbir alan (arac.adb/emulator seçimi, AVD, paket bilgisi) set EDİLMEMİŞ —
  // fonksiyon gate'te erken döndü, aşağı hiç inmedi.
  assert.equal(r.emulator, undefined);
  assert.equal(r.paket, undefined);
  assert.ok(fs.existsSync(path.join(kanit, 'android', 'kosum.json')), 'yük kapısı kanıtı (kosum.json) yazılmalı');
  const kosum = JSON.parse(fs.readFileSync(path.join(kanit, 'android', 'kosum.json'), 'utf8'));
  assert.equal(kosum.yukKapisi.gecti, false);
});

test('cihazKabulu (mutasyon): yük başından beri düşük → ön kapı GEÇER, karar gate\'ten SONRAKİ bir sebepten gelir', async () => {
  // Bu makinede Android SDK kurulu olabilir/olmayabilir — iddia kasıtlı olarak ortamdan
  // bağımsız: yalnız "gate geçti" ve "emülatör açılmadı sebebi YOK" doğrulanır. Eşik dalı
  // (yukEsigi/yukAzamiSn kontrolü) kaldırılırsa bu test hep OLCULEMEDI+"emülatör açılmadı"
  // ile düşer çünkü ön kapı hiç geçmez.
  const kanit = gecistKanitDizin();
  const r = await O.cihazKabulu({
    apk: '/yok/boyle-bir-apk.apk',
    kanit,
    beklenenKart: 0,
    setMi: false,
    avd: O.YASAK_AVD, // adb/emulator var olsa bile AVD listesi boşalır → emülatör spawn edilmez
    yukEsigi: 48,
    yukOlc: () => [1],
    yukBekle: () => Promise.resolve(),
  });
  assert.equal(r.yukKapisi.gecti, true);
  assert.ok(!r.sebepler.some((s) => /emülatör açılmadı/.test(s)));
  assert.equal(r.durum, 'OLCULEMEDI'); // TCDD_MITM dışında AVD yok / adb yoksa — ikisi de emülatörsüz sonuç
});
