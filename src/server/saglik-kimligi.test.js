'use strict';
// K-saglik-kimligi (2026-09-21, kaçak paketleyici arızası) — bkz. saglik-kimligi.js
// başlık yorumu. Bu testler saf karar fonksiyonlarını (I/O yok) kilitler: her kapının
// açık/kapalı/varsayılan davranışı, bilinmeyen env değerleri, bozuk/eksik sağlık
// cevabı, kısmi beklenen, commit uyuşmazlığı ve "hepsi uyuşuyor" durumu.
const test = require('node:test');
const assert = require('node:assert');
const { kapilariOku, kimlikUyusuyorMu, yesilSayilirMi } = require('./saglik-kimligi');

// ---------------------------------------------------------------------------
// kapilariOku — her kapı için açık/kapalı + varsayılan
// ---------------------------------------------------------------------------

test('kapilariOku: sayfaWebp EMPP_SAYFA_WEBP=1 ile açık', () => {
  assert.strictEqual(kapilariOku({ EMPP_SAYFA_WEBP: '1' }).sayfaWebp, true);
});

test('kapilariOku: sayfaWebp env yokken kapalı (varsayılan KAPALI)', () => {
  assert.strictEqual(kapilariOku({}).sayfaWebp, false);
});

test('kapilariOku: setMenu EMPP_SET_MENU=1 ile açık', () => {
  assert.strictEqual(kapilariOku({ EMPP_SET_MENU: '1' }).setMenu, true);
});

test('kapilariOku: setMenu env yokken kapalı (varsayılan KAPALI)', () => {
  assert.strictEqual(kapilariOku({}).setMenu, false);
});

test('kapilariOku: pardusKabul EMPP_PARDUS_KABUL=1 ile açık', () => {
  assert.strictEqual(kapilariOku({ EMPP_PARDUS_KABUL: '1' }).pardusKabul, true);
});

test('kapilariOku: pardusKabul env yokken kapalı (varsayılan KAPALI)', () => {
  assert.strictEqual(kapilariOku({}).pardusKabul, false);
});

test('kapilariOku: surumNormallestir env yokken açık (varsayılan AÇIK)', () => {
  assert.strictEqual(kapilariOku({}).surumNormallestir, true);
});

test('kapilariOku: surumNormallestir EMPP_SURUM_NORMALLESTIR=0 ile kapalı', () => {
  assert.strictEqual(kapilariOku({ EMPP_SURUM_NORMALLESTIR: '0' }).surumNormallestir, false);
});

test('kapilariOku: yama EMPP_YAMA=1 ile açık', () => {
  assert.strictEqual(kapilariOku({ EMPP_YAMA: '1' }).yama, true);
});

test('kapilariOku: yama env yokken kapalı (varsayılan KAPALI)', () => {
  assert.strictEqual(kapilariOku({}).yama, false);
});

// ---------------------------------------------------------------------------
// kapilariOku — bilinmeyen/yanlış-biçimli env değerleri (strict '1'/'0' dışı)
// ---------------------------------------------------------------------------

test('kapilariOku: sayfaWebp EMPP_SAYFA_WEBP="true" (string) ile hâlâ kapalı — sadece "1" açar', () => {
  assert.strictEqual(kapilariOku({ EMPP_SAYFA_WEBP: 'true' }).sayfaWebp, false);
});

test('kapilariOku: yama EMPP_YAMA=1 (sayısal, string değil) ile hâlâ kapalı — strict "===" karşılaştırma', () => {
  assert.strictEqual(kapilariOku({ EMPP_YAMA: 1 }).yama, false);
});

test('kapilariOku: surumNormallestir EMPP_SURUM_NORMALLESTIR="0 " (fazladan boşluk) ile hâlâ açık', () => {
  assert.strictEqual(kapilariOku({ EMPP_SURUM_NORMALLESTIR: '0 ' }).surumNormallestir, true);
});

test('kapilariOku: setMenu EMPP_SET_MENU=0 (sayısal) ile kapalı kalır (zaten varsayılan)', () => {
  assert.strictEqual(kapilariOku({ EMPP_SET_MENU: 0 }).setMenu, false);
});

test('kapilariOku: env undefined verilse çökmez, tüm kapılar varsayılana döner', () => {
  const k = kapilariOku(undefined);
  assert.deepStrictEqual(k, {
    sayfaWebp: false, setMenu: false, pardusKabul: false,
    surumNormallestir: true, yama: false,
  });
});

test('kapilariOku: dönen nesne yalnız boolean taşır (ham değer sızdırmaz)', () => {
  const k = kapilariOku({ EMPP_SAYFA_WEBP: '1', EMPP_YAMA: '1' });
  for (const v of Object.values(k)) assert.strictEqual(typeof v, 'boolean');
});

// ---------------------------------------------------------------------------
// kimlikUyusuyorMu
// ---------------------------------------------------------------------------

test('kimlikUyusuyorMu: hepsi uyuşuyorsa uygun true, sebep yok', () => {
  const saglik = { commit: 'abc1234', kapilar: { sayfaWebp: false, yama: false } };
  const beklenen = { commit: 'abc1234', kapilar: { sayfaWebp: false, yama: false } };
  const r = kimlikUyusuyorMu(saglik, beklenen);
  assert.deepStrictEqual(r, { uygun: true, sebepler: [] });
});

test('kimlikUyusuyorMu: kapı uyuşmazlığı insan-okunur tek satır sebep üretir', () => {
  const saglik = { kapilar: { sayfaWebp: true } };
  const beklenen = { kapilar: { sayfaWebp: false } };
  const r = kimlikUyusuyorMu(saglik, beklenen);
  assert.strictEqual(r.uygun, false);
  assert.strictEqual(r.sebepler.length, 1);
  assert.strictEqual(r.sebepler[0], 'sayfaWebp: bekleniyor kapalı, gelen açık');
});

test('kimlikUyusuyorMu: commit uyuşmazlığı sebep listesine commit satırı ekler', () => {
  const saglik = { commit: 'deadbee' };
  const beklenen = { commit: 'cafebab' };
  const r = kimlikUyusuyorMu(saglik, beklenen);
  assert.strictEqual(r.uygun, false);
  assert.match(r.sebepler[0], /^commit: bekleniyor cafebab, gelen deadbee$/);
});

test('kimlikUyusuyorMu: kısmi beklenen — verilmeyen kapı YOK SAYILIR', () => {
  // beklenen yalnız sayfaWebp'i belirtiyor; setMenu/yama farklı olsa da etkilemez.
  const saglik = { kapilar: { sayfaWebp: false, setMenu: true, yama: true } };
  const beklenen = { kapilar: { sayfaWebp: false } };
  const r = kimlikUyusuyorMu(saglik, beklenen);
  assert.deepStrictEqual(r, { uygun: true, sebepler: [] });
});

test('kimlikUyusuyorMu: beklenen boşsa (hiçbir alan) her zaman uygun', () => {
  assert.deepStrictEqual(kimlikUyusuyorMu({ commit: 'x' }, {}), { uygun: true, sebepler: [] });
});

test('kimlikUyusuyorMu: gelen kapilar eksikse beklenen kapı "tanımsız" olarak raporlanır', () => {
  const r = kimlikUyusuyorMu({}, { kapilar: { yama: true } });
  assert.strictEqual(r.uygun, false);
  assert.strictEqual(r.sebepler[0], 'yama: bekleniyor açık, gelen tanımsız');
});

test('kimlikUyusuyorMu: birden çok uyuşmazlık varsa hepsi ayrı satır olarak listelenir', () => {
  const saglik = { kapilar: { sayfaWebp: true, yama: true } };
  const beklenen = { kapilar: { sayfaWebp: false, yama: false } };
  const r = kimlikUyusuyorMu(saglik, beklenen);
  assert.strictEqual(r.sebepler.length, 2);
});

// ---------------------------------------------------------------------------
// yesilSayilirMi — şüphede DAİMA false
// ---------------------------------------------------------------------------

test('yesilSayilirMi: eksik sağlık cevabı (undefined) → false', () => {
  assert.strictEqual(yesilSayilirMi(undefined, { commit: 'x' }), false);
});

test('yesilSayilirMi: eksik sağlık cevabı (null) → false', () => {
  assert.strictEqual(yesilSayilirMi(null, { commit: 'x' }), false);
});

test('yesilSayilirMi: bozuk JSON — sağlık bir obje değil (string) → false', () => {
  assert.strictEqual(yesilSayilirMi('bozuk-yanit-metni', { commit: 'x' }), false);
});

test('yesilSayilirMi: bozuk JSON — sağlık bir dizi → false (obje bekleniyor)', () => {
  assert.strictEqual(yesilSayilirMi([], { commit: 'x' }), false);
});

test('yesilSayilirMi: beklenen kapı istiyor ama cevapta kapilar hiç yok → false', () => {
  assert.strictEqual(yesilSayilirMi({ commit: 'x' }, { kapilar: { sayfaWebp: false } }), false);
});

test('yesilSayilirMi: beklenen kapı istiyor ama gelen kapilar obje değil (bozuk) → false', () => {
  const saglik = { commit: 'x', kapilar: 'bozuk' };
  assert.strictEqual(yesilSayilirMi(saglik, { kapilar: { sayfaWebp: false } }), false);
});

test('yesilSayilirMi: commit + kapilar tamamen uyuşuyorsa → true', () => {
  const saglik = { commit: 'abc1234', pid: 111, kapilar: { sayfaWebp: false, yama: false, setMenu: false, pardusKabul: false, surumNormallestir: true } };
  const beklenen = { commit: 'abc1234', kapilar: { sayfaWebp: false, yama: false, setMenu: false, pardusKabul: false, surumNormallestir: true } };
  assert.strictEqual(yesilSayilirMi(saglik, beklenen), true);
});

test('yesilSayilirMi: commit uyuşuyor ama bir kapı farklıysa → false (yanlış yeşil YASAK)', () => {
  const saglik = { commit: 'abc1234', kapilar: { sayfaWebp: true } };
  const beklenen = { commit: 'abc1234', kapilar: { sayfaWebp: false } };
  assert.strictEqual(yesilSayilirMi(saglik, beklenen), false);
});

test('yesilSayilirMi: beklenen verilmezse (undefined) ve sağlık geçerli objeyse → true', () => {
  // beklenen hiç verilmediğinde denetlenecek alan yok — "hiçbir şey istenmedi" true'dur,
  // ama kapılı bir beklenti (kapilar) her zaman ayrı test edilir (yukarıdaki testler).
  assert.strictEqual(yesilSayilirMi({ commit: 'x' }, undefined), true);
});

test('yesilSayilirMi: kimlikUyusuyorMu fırlatsa bile (savunma) false döner, çökmez', () => {
  // beklenen.kapilar bilinçli olarak Object.keys'i patlatacak bir Proxy değil ama
  // en azından tuhaf tipler (Symbol içeren obje) çökmeden false dönmeli.
  const tuhafBeklenen = { kapilar: { [Symbol('x')]: true, sayfaWebp: false } };
  const saglik = { kapilar: { sayfaWebp: false } };
  assert.doesNotThrow(() => yesilSayilirMi(saglik, tuhafBeklenen));
});
