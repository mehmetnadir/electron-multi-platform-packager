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

test('cihazKabulu: yük hep yüksek (140, 45482 aralığı) ve düşmüyor → ÖLÇÜLEMEDİ, emülatör seçimine/adb\'ye HİÇ gidilmedi', async () => {
  const kanit = gecistKanitDizin();
  const gunluk = [];
  const r = await O.cihazKabulu({
    apk: '/yok/boyle-bir-apk.apk',
    kanit,
    beklenenKart: 0,
    setMi: false,
    onKapiEsigi: 120,
    yukAraSn: 0,
    yukAzamiSn: 0.05,
    yukOlc: () => [140],
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
  assert.ok(kosum.yukOrnekleri.some((o) => o.asama === 'baslangic'), 'kosum.json etiketli örnek taşımalı (başlangıç)');
  assert.equal(kosum.ozet.enYuksek, 140);
});

test('cihazKabulu: yük 100 (normal-yoğun, gerçek GEÇTİ aralığı 100-130) → ön kapı VARSAYILAN eşikte (çekirdek×12) HEMEN geçer', async () => {
  // onKapiEsigi enjekte EDİLMEDİ — gerçek varsayılan (os.cpus().length×12) kullanılıyor.
  // Bu makinede (10 çekirdek → eşik 120) 100 hemen geçmeli; koordinatörün ölçtüğü 10 android
  // kabulünün GEÇTİ olduğu aralığın (100-130) altında/ortasında kalan bir değer.
  const kanit = gecistKanitDizin();
  let bekleCagrisi = 0;
  const r = await O.cihazKabulu({
    apk: '/yok/boyle-bir-apk.apk',
    kanit,
    beklenenKart: 0,
    setMi: false,
    avd: O.YASAK_AVD, // gate geçtikten sonra emülatör spawn edilmesin
    yukOlc: () => [100],
    yukBekle: () => { bekleCagrisi += 1; return Promise.resolve(); },
  });
  assert.equal(r.yukKapisi.gecti, true);
  assert.equal(bekleCagrisi, 0); // hiç beklemeden geçti
  assert.ok(!r.sebepler.some((s) => /emülatör açılmadı/.test(s)));
});

test('cihazKabulu (mutasyon): yük başından beri düşük → ön kapı GEÇER, karar gate\'ten SONRAKİ bir sebepten gelir', async () => {
  // Bu makinede Android SDK kurulu olabilir/olmayabilir — iddia kasıtlı olarak ortamdan
  // bağımsız: yalnız "gate geçti" ve "emülatör açılmadı sebebi YOK" doğrulanır. Eşik dalı
  // (onKapiEsigi/yukAzamiSn kontrolü) kaldırılırsa bu test hep OLCULEMEDI+"emülatör açılmadı"
  // ile düşer çünkü ön kapı hiç geçmez.
  const kanit = gecistKanitDizin();
  const r = await O.cihazKabulu({
    apk: '/yok/boyle-bir-apk.apk',
    kanit,
    beklenenKart: 0,
    setMi: false,
    avd: O.YASAK_AVD, // adb/emulator var olsa bile AVD listesi boşalır → emülatör spawn edilmez
    onKapiEsigi: 48,
    yukOlc: () => [1],
    yukBekle: () => Promise.resolve(),
  });
  assert.equal(r.yukKapisi.gecti, true);
  assert.ok(!r.sebepler.some((s) => /emülatör açılmadı/.test(s)));
  assert.equal(r.durum, 'OLCULEMEDI'); // TCDD_MITM dışında AVD yok / adb yoksa — ikisi de emülatörsüz sonuç
});

// --- SİSTEM ÖLDÜ (DeadSystemException) — 28.09 45482 --------------------------------------
// Kanıt dizininden BİREBİR: /Users/nadir/.empp-agent/kabul-kanit/45482-android-20260928-032454/
//   android/logcat.txt — 21 "DeadSystemException: The system died" satırı, 14 farklı süreçte
//   (systemui, gms, vending, launcher, bizim com.dijitap.shallwe8set dahil), tek bir
//   "beginning of main" (reboot) ile kapanıyor. karar.json → cihaz.baslat:
//   "cmd: Failure calling service activity: Broken pipe (32)".

// logcat.txt'ten BİREBİR (satır 1-9, 30-35, 53-56, 63-65) — çoklu süreç, systemui dahil.
const KANIT_45482_LOGCAT = [
  '--------- beginning of crash',
  '09-28 03:27:42.280 E/AndroidRuntime( 3185): FATAL EXCEPTION: GoogleApiHandler',
  '09-28 03:27:42.280 E/AndroidRuntime( 3185): Process: com.google.android.gms.ui, PID: 3185',
  '09-28 03:27:42.280 E/AndroidRuntime( 3185): DeadSystemException: The system died; earlier logs will point to the root cause',
  '09-28 03:27:42.537 E/AndroidRuntime( 1042): FATAL EXCEPTION: main',
  '09-28 03:27:42.537 E/AndroidRuntime( 1042): Process: com.google.android.gms.persistent, PID: 1042',
  '09-28 03:27:42.537 E/AndroidRuntime( 1042): DeadSystemException: The system died; earlier logs will point to the root cause',
  '09-28 03:27:43.531 E/AndroidRuntime( 2446): Process: com.google.android.deskclock, PID: 2446',
  '09-28 03:27:43.531 E/AndroidRuntime( 2446): DeadSystemException: The system died; earlier logs will point to the root cause',
  '09-28 03:27:43.541 E/AndroidRuntime( 3718): FATAL EXCEPTION: main',
  '09-28 03:27:43.541 E/AndroidRuntime( 3718): Process: com.dijitap.shallwe8set, PID: 3718',
  '09-28 03:27:43.541 E/AndroidRuntime( 3718): DeadSystemException: The system died; earlier logs will point to the root cause',
  '09-28 03:27:43.623 E/AndroidRuntime(  818): FATAL EXCEPTION: main',
  '09-28 03:27:43.623 E/AndroidRuntime(  818): Process: com.android.systemui, PID: 818',
  '09-28 03:27:43.623 E/AndroidRuntime(  818): DeadSystemException: The system died; earlier logs will point to the root cause',
  '09-28 03:27:43.677 E/AndroidRuntime( 2549): Process: com.android.vending:background, PID: 2549',
  '09-28 03:27:43.677 E/AndroidRuntime( 2549): DeadSystemException: The system died; earlier logs will point to the root cause',
  '--------- beginning of main',
].join('\n');
// karar.json cihaz.baslat alanından BİREBİR.
const KANIT_45482_BASLAT = 'Starting: Intent { cmp=com.dijitap.shallwe8set/.MainActivity } | '
  + 'cmd: Failure calling service activity: Broken pipe (32)';

test('sistemOlduMu: 45482 kanıtı (14 sistem sürecinde DeadSystemException, systemui dahil) → true', () => {
  assert.equal(O.sistemOlduMu(KANIT_45482_LOGCAT), true);
});

test('sistemAnrMi: 45482 kanıtı — dump BAŞARILI olsa bile (döküm başarısız değil) sistem ölümünü yakalar', () => {
  // 72379'un aksine burada uiXml gerçek bir hiyerarşi (reboot sonrası launcher, döküm başarılı) —
  // eski `dokumBasarisiz && logcatSistemAnr` dalı BURADA false döner, yeni `sistemOlduMu` dalı yakalar.
  const gercekXml = '<hierarchy rotation="0"><node index="0" class="android.widget.FrameLayout"/></hierarchy>';
  assert.equal(O.sistemAnrMi({ uiXml: gercekXml, logcat: KANIT_45482_LOGCAT }), true);
});

test('amBaslatSistemOlduMu: 45482 kanıtı ("Failure calling service activity: Broken pipe") → true', () => {
  assert.equal(O.amBaslatSistemOlduMu(KANIT_45482_BASLAT), true);
});

test('amBaslatSistemOlduMu: "Can\'t find service: activity" de aynı köktendir → true', () => {
  assert.equal(O.amBaslatSistemOlduMu('Starting: Intent { ... } | cmd: Can\'t find service: activity'), true);
});

test('webViewYokKarari: 45482 kanıtıyla ÖRTÜLEN sayılır — uiXmlHata YOK (dump başarılı) olsa bile', () => {
  // 45482'de gerçek uiXmlHata null'dı (dump başarılıydı) — webViewYokKarari'nin eski davranışı
  // (satır ~232 testi: "uiXmlHata yoksa her zaman RED") artık sistemOlduMu ile GEÇERSİZ kılınır
  // çünkü sistemAnrMi artık dump durumundan bağımsız da true dönebiliyor.
  const o = { uiXmlHata: null };
  const k = O.webViewYokKarari('cihaz menü', o, KANIT_45482_LOGCAT);
  assert.equal(k.ortulen, true);
  assert.match(k.mesaj, /DeadSystemException|The system died/);
});

test('sistemOlduMu (mutasyon — yanlış pozitif freni): YALNIZ bizim uygulamamızda TEK bir DeadSystemException → false', () => {
  // Ölçüt: en az 2 farklı süreç YA DA system_server/systemui bizzat listede. Tek başımıza,
  // tek seferlik bir DeadSystemException (ör. flaky bir ölçüm) sistem ölümü SAYILMAMALI.
  const tekSurec = [
    '09-28 04:05:00.000 E/AndroidRuntime( 6000): FATAL EXCEPTION: main',
    '09-28 04:05:00.000 E/AndroidRuntime( 6000): Process: com.dijitap.shallwe8set, PID: 6000',
    '09-28 04:05:00.000 E/AndroidRuntime( 6000): DeadSystemException: The system died; earlier logs will point to the root cause',
  ].join('\n');
  assert.equal(O.sistemOlduMu(tekSurec), false);
  assert.equal(O.sistemAnrMi({ logcat: tekSurec }), false);
});

test('sistemOlduMu (mutasyon): tek süreç ama system_server/systemui BİZZAT o ise yine true', () => {
  const sistemSureci = [
    '09-28 04:05:00.000 E/AndroidRuntime(  818): FATAL EXCEPTION: main',
    '09-28 04:05:00.000 E/AndroidRuntime(  818): Process: com.android.systemui, PID: 818',
    '09-28 04:05:00.000 E/AndroidRuntime(  818): DeadSystemException: The system died; earlier logs will point to the root cause',
  ].join('\n');
  assert.equal(O.sistemOlduMu(sistemSureci), true);
});

test('sistemOlduMu (negatif — olumsuz vaka): yalnız bizim uygulamamızda TEK bir FATAL EXCEPTION (TypeError), sistem ayakta → false (RED kalmalı)', () => {
  // DeadSystemException/"The system died" imzası HİÇ yok — normal bir uygulama çökmesi.
  const normalCokme = [
    '09-28 04:10:00.000 E/AndroidRuntime( 7000): FATAL EXCEPTION: main',
    '09-28 04:10:00.000 E/AndroidRuntime( 7000): Process: com.dijitap.shallwe8set, PID: 7000',
    "09-28 04:10:00.000 E/AndroidRuntime( 7000): java.lang.TypeError: Cannot read properties of undefined (reading 'foo')",
    '09-28 04:10:00.000 E/AndroidRuntime( 7000): \tat com.dijitap.shallwe8set.MainActivity.onCreate(MainActivity.java:42)',
  ].join('\n');
  assert.equal(O.sistemOlduMu(normalCokme), false);
  assert.equal(O.sistemAnrMi({ logcat: normalCokme }), false);
  assert.equal(O.amBaslatSistemOlduMu('Starting: Intent { cmp=com.dijitap.shallwe8set/.MainActivity } | Status: ok | Activity: com.dijitap.shallwe8set/.MainActivity | TotalTime: 812 | WaitTime: 820 | Complete'), false);
});

test('sistemOlduMu (negatif — 45478 türü): süreç canlı, beyaz ekran/yükleniyor kapanmıyor, logcat temiz → false (RED kalmalı)', () => {
  // Kanıt dizininden BİREBİR: /Users/nadir/.empp-agent/kabul-kanit/45478-android-20260927-113551/
  //   karar.json cihaz.baslat = "TotalTime: 11803 | WaitTime: 11812 | Complete" (normal am start,
  //   Broken pipe YOK), logcat.txt'te DeadSystemException/"The system died" HİÇ yok (grep -c 0),
  //   surecCanli:true, webView dolu, ama piksel "beyaz/yükleniyor ekranı" ile RED aldı.
  const kanit45478Baslat = 'TotalTime: 11803 | WaitTime: 11812 | Complete';
  const kanit45478LogcatTemiz = '09-27 11:36:40.123 I/chromium( 4021): [normal log satırı, ANR/DeadSystem yok]';
  assert.equal(O.amBaslatSistemOlduMu(kanit45478Baslat), false);
  assert.equal(O.sistemOlduMu(kanit45478LogcatTemiz), false);
  assert.equal(O.sistemAnrMi({ logcat: kanit45478LogcatTemiz }), false);
});

// --- CİHAZ KARTLARI / İMPARK YOL ŞABLONU (30.09) -------------------------------------------

test('cihazKartlari: 74430 İmpark yol şablonu fikstürü (74430-yol-menu-ui.xml) → tam 2 kart (book1, book2)', () => {
  const xml = fs.readFileSync(path.join(__dirname, 'fikstur', '74430-yol-menu-ui.xml'), 'utf8');
  const dugumler = O.uiDugumleri(xml);
  const kartlar = O.cihazKartlari(dugumler);
  assert.equal(kartlar.length, 2);
  assert.equal(kartlar[0].anahtar, 'book1');
  assert.equal(typeof kartlar[0].x, 'number');
  assert.equal(typeof kartlar[0].y, 'number');
  assert.equal(kartlar[1].anahtar, 'book2');
  assert.equal(typeof kartlar[1].x, 'number');
  assert.equal(typeof kartlar[1].y, 'number');
});

test('cihazKartlari: yalnız düğmesiz "book3" kapak görseli → 0 kart', () => {
  const dugumler = [
    { sinif: 'android.widget.Image', metin: 'book3', aciklama: '', sinir: { x1: 992, y1: 1099, x2: 992, y2: 1144 } },
  ];
  const kartlar = O.cihazKartlari(dugumler);
  assert.equal(kartlar.length, 0);
});

test('cihazKartlari: aynı "book1-button" iki düğümde → 1 kart (tekil anahtar)', () => {
  const dugumler = [
    { sinif: 'android.widget.Image', metin: 'book1-button', aciklama: '', sinir: { x1: 86, y1: 987, x2: 798, y2: 1107 } },
    { sinif: 'android.widget.Image', metin: 'book1-button', aciklama: '', sinir: { x1: 86, y1: 1141, x2: 798, y2: 1265 } },
  ];
  const kartlar = O.cihazKartlari(dugumler);
  assert.equal(kartlar.length, 1);
  assert.equal(kartlar[0].anahtar, 'book1');
});

test('cihazKartlari: Web-Z "<ad> kitabını aç" ve kitap adı eşleşmesi mevcut desenleri korur', () => {
  const dugumler = [
    { sinif: 'android.view.View', metin: 'Matematik 4 kitabını aç', aciklama: '', sinir: { x1: 10, y1: 10, x2: 100, y2: 100 } },
    { sinif: 'android.view.View', metin: 'Türkçe 4', aciklama: '', sinir: { x1: 10, y1: 110, x2: 100, y2: 200 } },
  ];
  const kartlar = O.cihazKartlari(dugumler, ['Türkçe 4']);
  assert.equal(kartlar.length, 2);
  assert.equal(kartlar[0].anahtar, 'matematik 4');
  assert.equal(kartlar[1].anahtar, 'türkçe 4');
});

// --- PENCERE ÖRTÜŞMESİ (30.09 73768) --------------------------------------------------------
// Kanıt: ~/.empp-agent/kabul-kanit/73768-android-20260930-075433/ — "menu" aşamasında
// 28/38/45/51/59. saniyelerde 5 kez yabancı "System UI isn't responding" (aerr_close ile
// kapatıldı), son ölçüm turu diyalogsuz bitti (kosum.json: menu.beklenenSn=73,
// karar.json cihaz.menu.diyalog=null, kartSayisi=0, yukSiniflandirma.enYuksekYuk=37.6<eşik 60)
// → eski kod bunu RED ("menü kartı 0 ≠ beklenen 3") sayıyordu; host yükü normaldi, CPU tabanlı
// yük kapısı bu sınıfı yakalayamaz. `yabanciAnrOrtusmesi` / `asamaKarari` bu dersi kapatır.

test("yabanciAnrOrtusmesi: 73768 kanıtı BİREBİR (5 kez 28-59. sn, pencere 73 sn) → ortuldu=true (~%42)", () => {
  const diyaloglar = [28, 38, 45, 51, 59].map((sn) => ({ asama: 'menu', sn, kendi: false }));
  const r = O.yabanciAnrOrtusmesi(diyaloglar, 'menu', 73);
  assert.equal(r.sayi, 5);
  assert.equal(r.kapaliSn, 31);
  assert.ok(Math.abs(r.oran - 31 / 73) < 1e-9);
  assert.ok(r.oran >= O.YABANCI_ANR_ORTULME_ORAN_ESIGI);
  assert.equal(r.ortuldu, true);
});

test('yabanciAnrOrtusmesi (mutasyon): TEK yabancı ANR (72379 sınıfı) → MIN_SAYI eşiğinde ortuldu=false', () => {
  // 72379'da tek bir yabancı sistem ANR'si vardı ve o dosya HİÇ dump veremedi — o vaka zaten
  // ayrı bir mekanizmadan (sistemAnrMi/webViewYokKarari) örtülen sayılıyor; bu fonksiyon SADECE
  // dump başarılı + ANR aralıklarla tekrarlanan sınıfı hedefler, tek diyalog paketi ÖRTMEMELİ.
  const r = O.yabanciAnrOrtusmesi([{ asama: 'menu', sn: 30, kendi: false }], 'menu', 60);
  assert.equal(r.sayi, 1);
  assert.equal(r.ortuldu, false);
});

test('yabanciAnrOrtusmesi (mutasyon): 2 yabancı ANR ama pencerenin küçük dilimi (%3) → ortuldu=false', () => {
  const r = O.yabanciAnrOrtusmesi([
    { asama: 'menu', sn: 10, kendi: false },
    { asama: 'menu', sn: 13, kendi: false },
  ], 'menu', 100);
  assert.ok(r.oran < O.YABANCI_ANR_ORTULME_ORAN_ESIGI);
  assert.equal(r.ortuldu, false);
});

test('yabanciAnrOrtusmesi: yalnız hedef aşamanın (icAd) diyalogları sayılır, diğer aşama karışmaz', () => {
  const diyaloglar = [
    { asama: 'kitap', sn: 5, kendi: false },
    { asama: 'kitap', sn: 50, kendi: false },
    { asama: 'menu', sn: 10, kendi: false },
  ];
  const r = O.yabanciAnrOrtusmesi(diyaloglar, 'menu', 60);
  assert.equal(r.sayi, 1); // yalnız 'menu' olan tek diyalog
  assert.equal(r.ortuldu, false);
});

test('yabanciAnrOrtusmesi: KENDİ (kendi:true) diyaloglar hiç sayılmaz — RED sınıfı bununla örtülmez', () => {
  const diyaloglar = [
    { asama: 'menu', sn: 5, kendi: true },
    { asama: 'menu', sn: 55, kendi: true },
  ];
  const r = O.yabanciAnrOrtusmesi(diyaloglar, 'menu', 60);
  assert.equal(r.sayi, 0);
  assert.equal(r.ortuldu, false);
});

test('yabanciAnrOrtusmesi: beklenenSn=0/eksik → bölme hatası yok, ortuldu=false', () => {
  const diyaloglar = [{ asama: 'menu', sn: 1, kendi: false }, { asama: 'menu', sn: 2, kendi: false }];
  assert.equal(O.yabanciAnrOrtusmesi(diyaloglar, 'menu', 0).ortuldu, false);
  assert.equal(O.yabanciAnrOrtusmesi(diyaloglar, 'menu', undefined).ortuldu, false);
});

// piksel: 73768 "menu" ölçümünden (sapma/koyu/renk hepsi eşiği geçer — pk.gecti=true, tek
// sebep kart sayısı olsun diye başka bir piksel sebebi karışmasın).
const GECERLI_PIKSEL = { sapma: 0.23, koyu: 0.96, renk: 179306 };

test('asamaKarari (a): 6/15 döngüde yabancı ANR + son tur temiz + 0 kart → ÖLÇÜLEMEDİ (73768 dersi)', () => {
  // 15 döngü × 3 sn ≈ 45 sn'lik bir pencerede 6 döngüde ("her 3 turda bir" yaklaşık) yabancı
  // ANR çıktı, son ölçüm turu diyalogsuz (o.diyalog=null) ama içerik hâlâ 0 kart.
  const diyaloglar = [3, 9, 15, 21, 27, 33].map((sn) => ({ asama: 'menu', sn, kendi: false }));
  const o = {
    diyalog: null, surecCanli: true, webView: { x1: 0, y1: 0, x2: 100, y2: 100 },
    kartSayisi: 0, yukleniyor: [], piksel: GECERLI_PIKSEL, uiXmlHata: null, beklenenSn: 45,
  };
  const r = O.asamaKarari({
    ad: 'cihaz menü', icAd: 'menu', o, setMenu: true, beklenenKart: 3, diyaloglar, logcat: '', baslatCiktisi: '',
  });
  assert.deepEqual(r.sebepler, []);
  assert.equal(r.ortulen.length, 1);
  assert.match(r.ortulen[0], /menü kartı 0 ≠ beklenen 3/);
  assert.match(r.ortulen[0], /yabancı sistem ANR/);
});

test("asamaKarari (b) (mutasyon): AYNI 0 kart ama yabancı ANR YOK → RED kalır (sahte ÖLÇÜLEMEDİ'ye kaçış yasak)", () => {
  // (a) testinin `diyaloglar: []` mutasyonu — bu, `ortusme.ortuldu` dalı kaldırılırsa (a) ile
  // AYNI sonucu (ÖLÇÜLEMEDİ) üretecek bir düzenlemeyi de yakalar: gerçek RED'in hâlâ
  // üretilebildiğini kanıtlıyoruz.
  const o = {
    diyalog: null, surecCanli: true, webView: { x1: 0, y1: 0, x2: 100, y2: 100 },
    kartSayisi: 0, yukleniyor: [], piksel: GECERLI_PIKSEL, uiXmlHata: null, beklenenSn: 45,
  };
  const r = O.asamaKarari({
    ad: 'cihaz menü', icAd: 'menu', o, setMenu: true, beklenenKart: 3, diyaloglar: [], logcat: '', baslatCiktisi: '',
  });
  assert.equal(r.ortulen.length, 0);
  assert.equal(r.sebepler.length, 1);
  assert.match(r.sebepler[0], /menü kartı 0 ≠ beklenen 3/);
});

test('asamaKarari (c): KENDİ uygulamanın ANR\'si (o.diyalog.kendi=true) → RED, pencere örtüşmesi ne olursa olsun bozulmaz', () => {
  const diyaloglar = [3, 9, 15, 21, 27, 33].map((sn) => ({ asama: 'menu', sn, kendi: false })); // yüksek örtüşme de olsa
  const o = {
    diyalog: { baslik: "Lingoland Grade 3 isn't responding", kendi: true }, beklenenSn: 60,
  };
  const r = O.asamaKarari({
    ad: 'cihaz menü', icAd: 'menu', o, setMenu: true, beklenenKart: 3, diyaloglar, logcat: '', baslatCiktisi: '',
  });
  assert.equal(r.ortulen.length, 0);
  assert.equal(r.sebepler.length, 1);
  assert.match(r.sebepler[0], /uygulama yanıt vermiyor/);
});

test('asamaKarari: yabancı diyalog (kendi:false) SON ölçüm anında hâlâ ekranda ise (kapatılamadı) → ÖRTÜLEN, örtüşme oranı hesaplanmaz', () => {
  const o = { diyalog: { baslik: "System UI isn't responding", kendi: false }, beklenenSn: 60 };
  const r = O.asamaKarari({
    ad: 'cihaz menü', icAd: 'menu', o, setMenu: true, beklenenKart: 3, diyaloglar: [], logcat: '', baslatCiktisi: '',
  });
  assert.equal(r.sebepler.length, 0);
  assert.equal(r.ortulen.length, 1);
  assert.match(r.ortulen[0], /kapatılamadı/);
});

