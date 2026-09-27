'use strict';
// KÖK INDEX DENETİMİ — üretim anında "kaynağın kök index.html'i sadakatle mi
// taşındı" ölçümü (2026-09-26, bkz. kok-index-denetimi.js dosya başlığı).
//
// Vaka: ProBook kabul kapısı (K18) yalnız "bir menü açıldı mı" ölçüyordu, "DOĞRU
// menü mü" değil — 45482 (25.09) ve 45551 (17.09) pardus paketleri yayıncının
// kendi menüsü yerine bizim `empp-set-menu` menümüzle GEÇTİ.
//
// Dört GERİLEME senaryosu (görev tanımındaki dört zorunlu test):
//   (1) yayıncı menülü kaynak + dokunulmamış kök           → GEÇER  (sadik)
//   (2) yayıncı menülü kaynak + kök empp-set-menu ile değişmiş → HATA (ezilmis)
//   (3) motor-sayfa kökü + K17 menüsü                       → GEÇER  (uretilen-menu-beklenir)
//   (4) yalnız shim satırı eklenmiş kök                      → GEÇER  (sadik)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  enjekteSatirlariCikar, normalle, karsilastir, modOku, acikMi, denetle,
  kokIndexOku, paketeUygula, anaDosyaReferanslariniNormallestir,
  androidYamalariniCikar,
  KAYNAK_KOK_INDEX_MARKER, kaynakSnapshotAl,
} = require('./kok-index-denetimi');
const { MENU_ISARETI } = require('./set-menu');

/** Yayıncının kendi tasarımı — motor imzası TAŞIMAZ (K17 buna dokunmaz). */
const YAYINCI_MENUSU = '<!doctype html><html><head>'
  + '<link rel="stylesheet" href="assets2/styles.css"></head><body>'
  + '<div id="left"><a href="book1/index.html"><img src="assets2/book1-button.png"></a></div>'
  + '</body></html>';

/** Motorun tek-kitap sayfasının kopyası — K17'nin "beyaz ekran" tespit ettiği imza. */
const MOTOR_KOPYASI = '<!doctype html><html><head></head><body>'
  + '<script defer="defer" src="./a8f43f74c72b65a3dd05.main.js"></script></body></html>';

/** K17'nin ürettiği sade menü (gerçek `set-menu.js` şablonunun sadeleştirilmiş biçimi). */
const URETILEN_MENU = `${MENU_ISARETI}\n<!doctype html><html><head>`
  + '<script src="empp-fs-shim.js"></script></head><body>'
  + '<a class="kart" href="book1/index.html">Kitap 1</a></body></html>';

/**
 * Üretim Masası'nın (WebZTemaUretici) Web-Z kabuğu — panel tarzı SET menüsü. K17 imzası
 * (`MENU_ISARETI`) TAŞIMAZ; kendi imzası `scripts/language-set.js` referansıdır
 * (2026-09-27, 60015 pardus — konteyner kabulünden GEÇTİ, ekranda geçerli SET menüsü
 * vardı: YABANCI DİL / 3.SINIF sekmeleri + kitap kapakları).
 */
const WEB_Z_KABUK = '<!doctype html><html><head>'
  + '<script src="empp-fs-shim.js"></script>'
  + '<script src="scripts/language-set.js"></script>'
  + '<link rel="stylesheet" href="config/settings.json"></head><body>'
  + '<div class="sekme">YABANCI DİL / 3.SINIF</div>'
  + '<div class="kapak"><a href="book1/index.html">Sonic and Monic Reader 2-1</a></div>'
  + '</body></html>';

function paketleyiciEnjekteEt(html) {
  return html.replace('<head>', '<head><script src="empp-fs-shim.js"></script>'
    + '<script src="empp-ag-politikasi.js"></script>');
}

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kok-index-denetimi-test-'));
}

// ─────────────────────────── enjekteSatirlariCikar / normalle ───────────────────────────

test('enjekteSatirlariCikar: fs-shim ve ağ politikası etiketlerini çıkarır, geri kalanı korur', () => {
  const enjekteli = paketleyiciEnjekteEt(YAYINCI_MENUSU);
  assert.notStrictEqual(enjekteli, YAYINCI_MENUSU); // enjeksiyon gerçekten oldu
  assert.strictEqual(enjekteSatirlariCikar(enjekteli), YAYINCI_MENUSU);
});

test('enjekteSatirlariCikar: bilinmeyen empp-*.js dışındaki script etiketlerine dokunmaz', () => {
  const html = '<head><script src="motor-bundle.js"></script></head>';
  assert.strictEqual(enjekteSatirlariCikar(html), html);
});

test('normalle: null/undefined için null döner', () => {
  assert.strictEqual(normalle(null), null);
  assert.strictEqual(normalle(undefined), null);
});

test('normalle: CRLF/LF ve baş-son boşluk farkını yutar', () => {
  const a = normalle('  <html>\r\n<body>x</body>\r\n</html>  ');
  const b = normalle('<html>\n<body>x</body>\n</html>');
  assert.strictEqual(a, b);
});

// ─────────────────────────── karsilastir — dört zorunlu senaryo ───────────────────────────

test('GERİLEME (1): yayıncı menülü kaynak + dokunulmamış kök → sadik', () => {
  const r = karsilastir(YAYINCI_MENUSU, YAYINCI_MENUSU);
  assert.strictEqual(r.sonuc, 'sadik');
});

test('GERİLEME (1b): yayıncı menülü kaynak + yalnız paketleyici enjeksiyonu → sadik', () => {
  const guncel = paketleyiciEnjekteEt(YAYINCI_MENUSU);
  const r = karsilastir(YAYINCI_MENUSU, guncel);
  assert.strictEqual(r.sonuc, 'sadik');
});

test('GERİLEME (2): yayıncı menülü kaynak + kök empp-set-menu ile değişmiş → ezilmis', () => {
  const r = karsilastir(YAYINCI_MENUSU, URETILEN_MENU);
  assert.strictEqual(r.sonuc, 'ezilmis');
  assert.match(r.detay, /özel \(yayıncı\) kök menüsü/);
});

test('GERİLEME (3): motor-sayfa kökü + K17 menüsü → uretilen-menu-beklenir', () => {
  const r = karsilastir(MOTOR_KOPYASI, URETILEN_MENU);
  assert.strictEqual(r.sonuc, 'uretilen-menu-beklenir');
});

test('GERİLEME (4): yalnız shim satırı eklenmiş kök → sadik', () => {
  const guncel = paketleyiciEnjekteEt(MOTOR_KOPYASI);
  const r = karsilastir(MOTOR_KOPYASI, guncel);
  assert.strictEqual(r.sonuc, 'sadik');
});

// ────── karsilastir — panel SET menüsü (Web-Z kabuk) yanlış-pozitifi (2026-09-27, 60015) ──────
//
// Belirti: 72380/72378/45487 (android) ve 60015 (pardus) için "ezilmis" uyarısı çıktı ama
// 60015 pardus paketi konteyner kabulünden GEÇTİ — ekranda geçerli panel SET menüsü vardı
// (YABANCI DİL / 3.SINIF sekmeleri, kitap kapakları). Kök neden: denetim yalnız K17'nin
// kendi imzasını (`MENU_ISARETI`) tanıyordu, Üretim Masası'nın Web-Z kabuğunu (kendi
// imzası `scripts/language-set.js`) tanımıyordu.

test('GERİLEME (5a): motor kopyası kaynak + Web-Z kabuk (panel SET menüsü) güncel → uretilen-menu-beklenir (ARIZA ÖNCESİ: ezilmis)', () => {
  const r = karsilastir(MOTOR_KOPYASI, WEB_Z_KABUK);
  assert.strictEqual(r.sonuc, 'uretilen-menu-beklenir', `beklenmedik: ${r.sonuc} — ${r.detay}`);
});

test('GERİLEME (5b): kaynakta kök index yok + Web-Z kabuk (panel SET menüsü) güncel → uretilen-menu-beklenir', () => {
  const r = karsilastir(null, WEB_Z_KABUK);
  assert.strictEqual(r.sonuc, 'uretilen-menu-beklenir', `beklenmedik: ${r.sonuc} — ${r.detay}`);
});

test('GERİLEME (5c) KONTROL: motor kopyası/yok kaynak + Web-Z kabuk İMZASI OLMAYAN yabancı kök → hâlâ ezilmis (gerçek ezilme yakalanmalı)', () => {
  const r = karsilastir(MOTOR_KOPYASI, '<html><body><div class="sekme">sahte menü ama imzasız</div></body></html>');
  assert.strictEqual(r.sonuc, 'ezilmis', `beklenmedik: ${r.sonuc} — ${r.detay}`);
});

test('GERİLEME (5d) KONTROL: yayıncının kendi özel kök menüsü Web-Z kabuğuna ezilirse hâlâ ezilmis (K17 dışı senaryo dokunulmaz)', () => {
  // Kaynakta yayıncının kendi (motor kopyası OLMAYAN) menüsü vardı — bu dal kaynakUretilenMenuBekler
  // dalına HİÇ girmez, Web-Z kabuk istisnası burada uygulanmaz; sessiz değişim yine ezilmis olmalı.
  const r = karsilastir(YAYINCI_MENUSU, WEB_Z_KABUK);
  assert.strictEqual(r.sonuc, 'ezilmis', `beklenmedik: ${r.sonuc} — ${r.detay}`);
});

// ─────────────────────────── karsilastir — ek uç durumlar ───────────────────────────

test('kaynakta kök index yok + K17 menüsü üretilmiş → uretilen-menu-beklenir', () => {
  const r = karsilastir(null, URETILEN_MENU);
  assert.strictEqual(r.sonuc, 'uretilen-menu-beklenir');
});

test('ne kaynakta ne pakette kök index var → yok (denetim dışı)', () => {
  const r = karsilastir(null, null);
  assert.strictEqual(r.sonuc, 'yok');
});

test('motor kopyası kaynak + K17 kapalıyken dokunulmamış kök → sadik (henüz ezilme yok)', () => {
  const r = karsilastir(MOTOR_KOPYASI, MOTOR_KOPYASI);
  assert.strictEqual(r.sonuc, 'sadik');
});

test('motor kopyası/yok kaynak + ne aynı ne K17 imzalı bir kök → ezilmis', () => {
  const r = karsilastir(MOTOR_KOPYASI, '<html><body>beklenmeyen içerik</body></html>');
  assert.strictEqual(r.sonuc, 'ezilmis');
});

// ───────────────── GERİLEME (6): android yamaları (2026-09-28, 45100 — yanlış-pozitif) ─────────────────
//
// 45100 ("Influence Grade 12" SETİ, 16 kitap, birleşik-SPA kökü — main.js referanslı
// gerçek okuyucu index.html'i, K17/Web-Z menüsü YOK çünkü SET kendi içinde tek SPA)
// android paketlemede `ezilmis` uyardı. Gerçek iş klasöründen (`empp-agent-Y1R5l7`)
// alınan kaynak/paket kökleri (küçültülmüş örnek — tam metin `arastirma/45100-*.html`
// değil, buradaki fixture'lar) kanıtladı: fark yalnız `packagingService.js`'in
// `enableAndroidFullscreen()` adımı + `sayfa-on-getirme.js`'in ürettiği bilinen yamalardı.
const KAYNAK_TEK_SPA = '<!doctype html><html lang="en"><head>'
  + '<meta charset="UTF-8"/>'
  + '<meta name="viewport" content="width=device-width,initial-scale=0.9"/>'
  + '<script src="icons.js"></script>'
  + '<title>Akıllı Tahta Uygulaması</title></head>'
  + '<body><script defer="defer" src="./42c86ce0fe3ad185f93d.main.js"></script>'
  + '<link href="./b9ea95bc3dffcbc36a58.main.css" rel="stylesheet">'
  + '<img src="./core/kurumLogo.png" style="display: none;"></body></html>';

/** `packagingService.js` + `sayfa-on-getirme.js`'in android paketlemede uyguladığı BEŞ yama. */
const PAKET_ANDROID_YAMALI = '<!doctype html><html lang="en"><head>'
  + '<script src="empp-android-shim.js"></script><script src="empp-fs-shim.js"></script>'
  + '<meta charset="UTF-8"/>'
  + '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, '
  + 'user-scalable=no, viewport-fit=cover">'
  + '<script src="icons.js?v=123"></script>'
  + '<title>Akıllı Tahta Uygulaması</title>'
  + '<style>\n/* Android Fullscreen Support */\nbody{margin:0}\n</style>'
  + '</head>'
  + '<body><script defer="defer" src="./bd0c1a4f650802c98ebf.main.js"></script>'
  + '<link href="./c84d32924edb93d564b1.main.css" rel="stylesheet">'
  + '<script src="cordova.js"></script>'
  + '<img src="./core/kurumlogo.png" style="display: none;">'
  + '<script>/*EMPP_ON_GETIRME*/(function(){var SAYFALAR=["assets/28005/pages/1.png"];})();</script>\n\n'
  // Gerçek 45100 paketinde iki enjekte blok arasında VE </body>'den önce birden çok
  // boş satır kalıyordu (bloklar ayrı ayrı kaldırılınca yan etki) — bosSatirlariSadelestir
  // bunu yutmazsa `\s` yerine yalnız `[ \t]` kullanan ilk sürüm burada `ezilmis` üretiyordu
  // (2026-09-28 ölçümü, gerçek dosya çifti). Bilerek İKİ `\n` bırakıldı, tek değil.
  + '<script>\n// Android Fullscreen Support\ndocument.addEventListener(\'deviceready\',function(){});\n</script>\n\n'
  + '</body></html>';

test('GERİLEME (6a): birleşik-SPA kaynak + android yamaları (viewport/icons.js/fullscreen/'
  + 'ön-getirme/cordova/main.js hash/kurumLogo case) → sadik (45100 android, ölçümle)', () => {
  const r = karsilastir(KAYNAK_TEK_SPA, PAKET_ANDROID_YAMALI);
  assert.strictEqual(r.sonuc, 'sadik');
});

test('GERİLEME (6b) KONTROL: android yamaları ÜSTÜNE gerçek yabancı içerik eklenirse '
  + 'yine ezilmis (androidYamalariniCikar aşırı geniş normalize ETMİYOR)', () => {
  const yabanciIcerikli = PAKET_ANDROID_YAMALI.replace(
    '</body>', '<div id="yabanci-menu">beklenmeyen menü</div></body>',
  );
  const r = karsilastir(KAYNAK_TEK_SPA, yabanciIcerikli);
  assert.strictEqual(r.sonuc, 'ezilmis');
});

test('androidYamalariniCikar: EMPP_ON_GETIRME/fullscreen/cordova bloklarını çıkarır, '
  + 'viewport+icons.js+kurumLogo case normalize eder', () => {
  const temiz = androidYamalariniCikar(PAKET_ANDROID_YAMALI);
  assert.ok(!temiz.includes('EMPP_ON_GETIRME'));
  assert.ok(!temiz.includes('Android Fullscreen Support'));
  assert.ok(!temiz.includes('cordova.js'));
  assert.ok(!temiz.includes('icons.js?v=123'));
  assert.ok(temiz.includes('icons.js'));
  assert.ok(!temiz.includes('kurumLogo.png'));
  assert.ok(temiz.includes('kurumlogo.png'));
});

// ─────────────────────────── modOku / acikMi ───────────────────────────

test('modOku: tanımsız/boş → uyar (ölçülene dek varsayılan uyarı; 2026-09-26)', () => {
  assert.strictEqual(modOku({}), 'uyar');
  assert.strictEqual(modOku({ EMPP_KOK_INDEX_DENETIMI: '' }), 'uyar');
  assert.strictEqual(modOku({ EMPP_KOK_INDEX_DENETIMI: 'dusur' }), 'dusur');
});

test('modOku: 0/false/kapali → kapali', () => {
  for (const v of ['0', 'false', 'kapali', 'kapalı']) {
    assert.strictEqual(modOku({ EMPP_KOK_INDEX_DENETIMI: v }), 'kapali');
  }
});

test('modOku: uyar/warn → uyar', () => {
  assert.strictEqual(modOku({ EMPP_KOK_INDEX_DENETIMI: 'uyar' }), 'uyar');
  assert.strictEqual(modOku({ EMPP_KOK_INDEX_DENETIMI: 'warn' }), 'uyar');
});

test('acikMi: yalnız kapali modda false döner', () => {
  assert.strictEqual(acikMi({ EMPP_KOK_INDEX_DENETIMI: 'kapali' }), false);
  assert.strictEqual(acikMi({}), true);
  assert.strictEqual(acikMi({ EMPP_KOK_INDEX_DENETIMI: 'uyar' }), true);
});

// ─────────────────────────── denetle — mod davranışı ───────────────────────────

test('denetle: dusur modunda ezilme HATA fırlatır, e.kokIndexSonucu dolu gelir', async () => {
  await assert.rejects(
    () => denetle(YAYINCI_MENUSU, URETILEN_MENU, { env: { EMPP_KOK_INDEX_DENETIMI: 'dusur' } }),
    (err) => {
      assert.ok(err.kokIndexSonucu);
      assert.strictEqual(err.kokIndexSonucu.sonuc, 'ezilmis');
      return true;
    },
  );
});

test('denetle: uyar modunda ezilme HATA fırlatmaz, sonucu döner', async () => {
  const r = await denetle(YAYINCI_MENUSU, URETILEN_MENU, { env: { EMPP_KOK_INDEX_DENETIMI: 'uyar' } });
  assert.strictEqual(r.uygulandi, true);
  assert.strictEqual(r.sonuc.sonuc, 'ezilmis');
});

test('denetle: kapali modda karşılaştırma HİÇ yapılmaz', async () => {
  const r = await denetle(YAYINCI_MENUSU, URETILEN_MENU, { env: { EMPP_KOK_INDEX_DENETIMI: '0' } });
  assert.strictEqual(r.uygulandi, false);
  assert.strictEqual(r.sonuc, null);
});

test('denetle: sadık durumda dusur modunda da hata fırlatmaz', async () => {
  const r = await denetle(YAYINCI_MENUSU, YAYINCI_MENUSU, { env: {} });
  assert.strictEqual(r.uygulandi, true);
  assert.strictEqual(r.sonuc.sonuc, 'sadik');
});

// ─────────────────────────── kokIndexOku / paketeUygula — gerçek dosya sistemi ───────────────────────────

test('kokIndexOku: dosya yoksa null döner (hata fırlatmaz)', async () => {
  const kok = await tempDir();
  assert.strictEqual(await kokIndexOku(kok), null);
});

test('kokIndexOku: kök index.html varsa içeriğini döner', async () => {
  const kok = await tempDir();
  await fs.writeFile(path.join(kok, 'index.html'), YAYINCI_MENUSU);
  assert.strictEqual(await kokIndexOku(kok), YAYINCI_MENUSU);
});

test('paketeUygula: gerçek ağaçta sadık kalan paket GEÇER', async () => {
  const kok = await tempDir();
  await fs.writeFile(path.join(kok, 'index.html'), paketleyiciEnjekteEt(YAYINCI_MENUSU));
  const r = await paketeUygula(kok, YAYINCI_MENUSU, { env: {} });
  assert.strictEqual(r.sonuc.sonuc, 'sadik');
});

test('paketeUygula: gerçek ağaçta ezilmiş kök dusur modunda HATA fırlatır', async () => {
  const kok = await tempDir();
  await fs.writeFile(path.join(kok, 'index.html'), URETILEN_MENU);
  await assert.rejects(
    () => paketeUygula(kok, YAYINCI_MENUSU, { env: { EMPP_KOK_INDEX_DENETIMI: 'dusur' } }),
    (err) => {
      assert.strictEqual(err.kokIndexSonucu.sonuc, 'ezilmis');
      return true;
    },
  );
});

test('paketeUygula: gerçek ağaçta motor-sayfa kaynağı + üretilen menü GEÇER', async () => {
  const kok = await tempDir();
  await fs.writeFile(path.join(kok, 'index.html'), URETILEN_MENU);
  const r = await paketeUygula(kok, MOTOR_KOPYASI, { env: {} });
  assert.strictEqual(r.sonuc.sonuc, 'uretilen-menu-beklenir');
});

// ─────────────────────── T2/T3 — main.js/css content-hash yanlış-pozitifi (2026-09-26) ───────────────────────
//
// Rapor "Yapısal risk": okuyucu kabuğu (`okuyucu-kabugu.js` `indexYenidenYaz`) kanonik sürüm
// değiştikçe `<20 hex>.main.js`/`.main.css` referansını YENİDEN YAZAR — bu bir kök ezilmesi
// DEĞİL, kanonik okuyucunun kendi sürüm yükseltmesidir. 11845 kaynak→paket kıyası TEK bu
// farktan (+ paketleyici enjeksiyonu) `ezilmis` çıkıyordu (yanlış pozitif).

test('anaDosyaReferanslariniNormallestir: main.js/main.css hash\'lerini sabit adla değiştirir', () => {
  const html = '<script src="./a8f43f74c72b65a3dd05.main.js"></script>'
    + '<link href="bd0c1a4f650802c98abc.main.css">';
  const n = anaDosyaReferanslariniNormallestir(html);
  assert.match(n, /HASH\.main\.js/);
  assert.match(n, /HASH\.main\.css/);
  assert.doesNotMatch(n, /a8f43f74c72b65a3dd05/);
});

test('anaDosyaReferanslariniNormallestir: string olmayan girdiyi olduğu gibi döner', () => {
  assert.strictEqual(anaDosyaReferanslariniNormallestir(null), null);
});

test('T2 — GERİLEME: yalnız main.js hash değişimi + paketleyici enjeksiyonu → sadik (11845 dersi)', () => {
  // Kaynak: 11845'in İmpark kökü (motor sayfası, hash a8f43f74c72b65a3dd05).
  const kaynak = MOTOR_KOPYASI;
  // Paket: okuyucu kabuğu kanonik main.js'i günceller (hash bd0c1a4f650802c98ebf'e döner) VE
  // paketleyici kendi script'lerini enjekte eder — İKİSİ de İÇERİK farkı DEĞİL.
  const guncel = paketleyiciEnjekteEt(
    MOTOR_KOPYASI.replace('a8f43f74c72b65a3dd05.main.js', 'bd0c1a4f650802c98ebf.main.js'),
  );
  const r = karsilastir(kaynak, guncel);
  assert.strictEqual(r.sonuc, 'sadik', `beklenmedik: ${r.sonuc} — ${r.detay}`);
});

test('T3 — GERİLEME: hash farkının ÖTESİNDE gerçek menü kaybı hâlâ ezilmis (yanlış-negatif YOK)', () => {
  // 45551 arşiv kabuğu (Web-Z, özel yayıncı menüsü) → İmpark motor sayfasına dönüşmüş.
  // Normalizasyon yalnız main.js/css hash'ini yutar; menünün KENDİSİ farklı kalır.
  const r = karsilastir(YAYINCI_MENUSU, MOTOR_KOPYASI);
  assert.strictEqual(r.sonuc, 'ezilmis');
});

test('T2 kontrol: farklı hash + FARKLI gövde (gerçek menü değişikliği) yine ezilmis', () => {
  const kaynak = MOTOR_KOPYASI;
  const guncelFarkliGovde = MOTOR_KOPYASI
    .replace('a8f43f74c72b65a3dd05.main.js', 'bd0c1a4f650802c98ebf.main.js')
    .replace('<body>', '<body><div id="baska-bir-menu">yeni içerik</div>');
  const r = karsilastir(kaynak, guncelFarkliGovde);
  assert.strictEqual(r.sonuc, 'ezilmis', 'yalnız hash normalizasyonu gerçek içerik farkını maskelemez');
});

// ─────────────────────────────── T5 — kaynak anlık görüntüsü köprüsü (2026-09-26) ───────────────────────────────
//
// Rapor: packagingService kendi "kaynak" anlık görüntüsünü workingPath İLK DOLDURULDUĞUNDA
// alıyordu — ama o an zaten RUNNER'IN `applyPublisherUpdate`'i UYGULANMIŞ hâldeydi (zip
// güncellemeden SONRA kuruluyor). `kaynakSnapshotAl`, runner'ın güncellemeden ÖNCE bıraktığı
// `KAYNAK_KOK_INDEX_MARKER` dosyasını (varsa) TERCİH eder.

test('T5 — GERİLEME: runner marker\'ı VARSA gerçek (güncelleme-öncesi) kaynak kabul edilir', async () => {
  const dir = await tempDir();
  // workingPath'in GÜNCEL kökü: runner'ın publisher-update'i zaten uygulanmış (motor sayfası).
  await fs.writeFile(path.join(dir, 'index.html'), MOTOR_KOPYASI);
  // Runner'ın güncellemeden HEMEN ÖNCE bıraktığı gerçek kaynak: Web-Z kabuğu (yayıncı menüsü).
  await fs.writeFile(path.join(dir, KAYNAK_KOK_INDEX_MARKER), YAYINCI_MENUSU);

  const kaynak = await kaynakSnapshotAl(dir);
  assert.strictEqual(kaynak, YAYINCI_MENUSU, 'marker TERCİH edilmeliydi, workingPath kökü DEĞİL');

  // Marker okunur okunmaz silinmeli — pakete SIZMAZ.
  await assert.rejects(fs.access(path.join(dir, KAYNAK_KOK_INDEX_MARKER)));

  // Bugünkü (T5 düzeltmesi öncesi) davranışı simüle etseydik kaynak workingPath'in KENDİ
  // kökü (MOTOR_KOPYASI) olurdu → motorKopyasiMi(kaynak)=true, güncel de aynı MOTOR_KOPYASI
  // (K17 tetiklenmedi çünkü zaten "bir menü" vardı) → 'sadik' — ARIZA GİZLENİRDİ.
  const guncelHtml = await fs.readFile(path.join(dir, 'index.html'), 'utf8');
  const eskiDavranisSonuc = karsilastir(MOTOR_KOPYASI, guncelHtml);
  assert.strictEqual(eskiDavranisSonuc.sonuc, 'sadik', 'DÜZELTMEDEN ÖNCE bu satır test kırmızıydı');

  // DÜZELTİLMİŞ akış: gerçek kaynak (marker'dan) Web-Z kabuğuydu, paket sessizce motor
  // sayfasına dönüşmüş → kök EZİLMİŞ doğru tespit edilir.
  const r = karsilastir(kaynak, guncelHtml);
  assert.strictEqual(r.sonuc, 'ezilmis', `beklenmedik: ${r.sonuc} — ${r.detay}`);
});

test('T5: marker YOKSA eski davranış sürer — workingPath kendi kök index kaynak sayılır', async () => {
  const dir = await tempDir();
  await fs.writeFile(path.join(dir, 'index.html'), YAYINCI_MENUSU);
  const kaynak = await kaynakSnapshotAl(dir);
  assert.strictEqual(kaynak, YAYINCI_MENUSU);
});

test('T5: kök index hiç yoksa (marker de yok) null döner (hata fırlatmaz)', async () => {
  const dir = await tempDir();
  const kaynak = await kaynakSnapshotAl(dir);
  assert.strictEqual(kaynak, null);
});
