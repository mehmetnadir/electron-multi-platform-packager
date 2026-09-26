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
  kokIndexOku, paketeUygula,
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
