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
// setGuncelleme — 2026-09-21'de kapatılan KÖR NOKTA.
// `EMPP_SET_GUNCELLEME` üretim davranışını değiştirir (empp-set.json yazılır mı,
// güncelleyici enjekte edilir mi) ama kapı listesinde YOKTU: `=0` ile başlatılmış
// kaçak bir süreç sağlık ucunda temiz kopyadan AYIRT EDİLEMİYORDU.
// ---------------------------------------------------------------------------

test('kapilariOku: setGuncelleme env yokken AÇIK (varsayılan AÇIK)', () => {
  assert.strictEqual(kapilariOku({}).setGuncelleme, true);
});

test('kapilariOku: setGuncelleme EMPP_SET_GUNCELLEME=0 ile kapalı', () => {
  assert.strictEqual(kapilariOku({ EMPP_SET_GUNCELLEME: '0' }).setGuncelleme, false);
});

test('kapilariOku: setGuncelleme "1"/""/"false" ile AÇIK kalır (yalnız "0" kapatır)', () => {
  for (const v of ['1', '', 'false', 'kapali']) {
    assert.strictEqual(kapilariOku({ EMPP_SET_GUNCELLEME: v }).setGuncelleme, true,
      `EMPP_SET_GUNCELLEME=${JSON.stringify(v)} kapıyı kapatmamalı`);
  }
});

test('GERİLEME: setGuncelleme kapısı `guncelleyici-enjekte.acikMi` ile BİREBİR', () => {
  // Kopya mantık YASAK (modül başlığı §BİREBİR KAYNAK). Enjektör kapalıysa paket
  // güncelleyiciyi HİÇ taşımaz; sağlık ucu bunun tersini söylerse yalan söylemiş olur.
  const { acikMi } = require('../packaging/guncelleyici-enjekte');
  for (const v of [undefined, '0', 0, '1', '', 'x']) {
    const env = v === undefined ? {} : { EMPP_SET_GUNCELLEME: v };
    assert.strictEqual(kapilariOku(env).setGuncelleme, acikMi(env) === true,
      `EMPP_SET_GUNCELLEME=${JSON.stringify(v)} için sağlık ucu enjektörden SAPTI`);
  }
});

test('GERİLEME: kaçak süreç ayırt edilebilir — kapı listesi setGuncelleme TAŞIR', () => {
  // 2026-09-20 arızasının tıpatıp aynısı: kaçak süreç kapıyı kapatmış, temiz kopya
  // açık. Kapı listede yoksa iki süreç sağlık ucunda AYNI görünür.
  const alanlar = Object.keys(kapilariOku({}));
  assert.ok(alanlar.includes('setGuncelleme'),
    `üretim davranışını değiştiren kapı listede yok: ${alanlar.join(', ')}`);
  const temiz = kapilariOku({});
  const kacak = kapilariOku({ EMPP_SET_GUNCELLEME: '0' });
  assert.notDeepStrictEqual(temiz, kacak, 'kaçak süreç temiz kopyadan ayırt edilemiyor');
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
    surumNormallestir: true, yama: false, setGuncelleme: true,
    windowsAsarsiz: true,
  });
});

// ---------------------------------------------------------------------------
// windowsAsarsiz — 2026-09-21'de eklenen PAKET DÜZENİ kapısı.
// Windows NSIS paketinde `asar` kapalı mı? Açıkken içerik `resources/app.asar`
// yerine `resources/app/` altında DÜZ DOSYA olarak durur — üretim davranışını
// değiştirir, dolayısıyla süreç kimliğinin parçasıdır.
// ---------------------------------------------------------------------------

test('kapilariOku: windowsAsarsiz env yokken AÇIK (varsayılan AÇIK = asar kapalı)', () => {
  assert.strictEqual(kapilariOku({}).windowsAsarsiz, true);
});

test('kapilariOku: windowsAsarsiz EMPP_WINDOWS_ASARSIZ=0 ile kapalı (asar geri gelir)', () => {
  assert.strictEqual(kapilariOku({ EMPP_WINDOWS_ASARSIZ: '0' }).windowsAsarsiz, false);
});

test('kapilariOku: windowsAsarsiz "1"/""/"false" ile AÇIK kalır (yalnız "0" kapatır)', () => {
  for (const v of ['1', '', 'false', 'hayir', '00', ' 0']) {
    assert.strictEqual(kapilariOku({ EMPP_WINDOWS_ASARSIZ: v }).windowsAsarsiz, true,
      `EMPP_WINDOWS_ASARSIZ=${JSON.stringify(v)} kapıyı kapatmamalı`);
  }
});

test('SÖZLEŞME: windowsAsarsiz kaynağıyla BİREBİR (kopya mantık yok)', () => {
  const { acikMi } = require('../packaging/windows-asarsiz');
  for (const v of [undefined, '0', '1', '', 'x', 0, 1]) {
    const env = v === undefined ? {} : { EMPP_WINDOWS_ASARSIZ: v };
    assert.strictEqual(kapilariOku(env).windowsAsarsiz, acikMi(env) === true,
      `EMPP_WINDOWS_ASARSIZ=${JSON.stringify(v)} için kapı listesi kaynaktan sapmış`);
  }
});

test('GERİLEME: kaçak süreç ayırt edilebilir — kapı listesi windowsAsarsiz TAŞIR', () => {
  // 2026-09-20 kaçak paketleyici arızasının aynısı: kaçak süreç paket düzenini
  // değiştiren kapıyı kapatmış olabilir. Kapı listede yoksa iki süreç sağlık
  // ucunda AYNI görünür ve yanlış yeşil üretilir.
  const alanlar = Object.keys(kapilariOku({}));
  assert.ok(alanlar.includes('windowsAsarsiz'),
    `üretim davranışını değiştiren kapı listede yok: ${alanlar.join(', ')}`);
  assert.notDeepStrictEqual(kapilariOku({}), kapilariOku({ EMPP_WINDOWS_ASARSIZ: '0' }),
    'asar kapısını kapatmış kaçak süreç temiz kopyadan ayırt edilemiyor');
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

// GERÇEK FİKSTÜR (2026-09-21 08:38, süreç canlıyken `curl http://127.0.0.1:3001/api/health`
// ile birebir yakalandı — kaçak sürece hiçbir müdahale yapılmadan, salt okunur ölçüm).
// PID 38819, ppid=1 (öksüz), portu tutuyor, ortamında EMPP_SAYFA_WEBP=1 var; ama commit
// alanı bugünkü K-saglik-kimligi değişikliğinden (db79bc3) ÖNCEki kodu koşuyor — bu yüzden
// `pid`/`kapilar` hiç yok. Tam olarak modülün var olma sebebi olan arıza deseni.
const KACAK_SUREC_GERCEK_YANITI = {
  status: 'Sunucu çalışıyor',
  timestamp: '2026-09-21T08:38:04.213Z',
  commit: 'a3f92bd',
  startedAt: '2026-09-20T20:30:38.635Z',
  // pid YOK, kapilar YOK — eski kod imzası.
};

test('yesilSayilirMi: BUGÜNKÜ GERÇEK kaçak süreç fikstürü (kapilar alanı yok) → false [GERİLEME]', () => {
  const beklenen = {
    kapilar: { sayfaWebp: false, setMenu: true, pardusKabul: true, surumNormallestir: true, yama: false },
  };
  assert.strictEqual(yesilSayilirMi(KACAK_SUREC_GERCEK_YANITI, beklenen), false);
  const { sebepler } = kimlikUyusuyorMu(KACAK_SUREC_GERCEK_YANITI, beklenen);
  // gelen kapilar objesi hiç olmadığı için her kapı "tanımsız" raporlanmalı.
  assert.ok(sebepler.some((s) => s.includes('tanımsız')), 'kapilar eksikliği tanımsız olarak raporlanmalı');
});

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

test('yesilSayilirMi: beklenen pid de verilir ve eşleşirse → true (temiz kopya, pid dahil)', () => {
  // kimlikUyusuyorMu 'kapilar' dışındaki her alanı generic karşılaştırır — pid de
  // bunlardan biri: launchd'nin başlattığı sürecin PID'i biliniyorsa (örn. runner
  // kendi başlattığı child'ın pid'ini expected olarak geçebilir) burada da denetlenir.
  const saglik = { commit: 'abc1234', pid: 4242, kapilar: { sayfaWebp: false, setMenu: true, pardusKabul: true, surumNormallestir: true, yama: false } };
  const beklenen = { commit: 'abc1234', pid: 4242, kapilar: { sayfaWebp: false, setMenu: true, pardusKabul: true, surumNormallestir: true, yama: false } };
  assert.strictEqual(yesilSayilirMi(saglik, beklenen), true);
});

test('yesilSayilirMi: damga (commit) uyuşuyor ama pid bilinen/beklenen PID ile FARKLIysa → false (şüphede false)', () => {
  // Senaryo: launchd'nin kendi başlattığı kopyanın PID'i biliniyor (örn. bir önceki
  // kontrolden ya da process-tracking dosyasından) ama /api/health BAŞKA bir pid
  // döndürüyor — commit doğru olsa bile bu "benim kopyam" demek DEĞİLDİR (iki ayrı
  // süreç aynı commit'i koşuyor olabilir — biri kaçak, biri temiz).
  const saglik = { commit: 'abc1234', pid: 99999, kapilar: { sayfaWebp: false, setMenu: true, pardusKabul: true, surumNormallestir: true, yama: false } };
  const beklenen = { commit: 'abc1234', pid: 4242, kapilar: { sayfaWebp: false, setMenu: true, pardusKabul: true, surumNormallestir: true, yama: false } };
  const r = yesilSayilirMi(saglik, beklenen);
  assert.strictEqual(r, false);
  const { sebepler } = kimlikUyusuyorMu(saglik, beklenen);
  assert.ok(sebepler.some((s) => s.startsWith('pid:')), 'pid uyuşmazlığı sebep listesinde görünmeli');
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

test('yesilSayilirMi: tuhaf tipler (Symbol içeren obje) çökmeden sonuç döner', () => {
  const tuhafBeklenen = { kapilar: { [Symbol('x')]: true, sayfaWebp: false } };
  const saglik = { kapilar: { sayfaWebp: false } };
  assert.doesNotThrow(() => yesilSayilirMi(saglik, tuhafBeklenen));
});

// 2026-09-21 mutasyon bulgusu: yukarıdaki test hiçbir zaman try/catch'in catch dalına
// GİRMİYORDU (Symbol'lü obje Object.keys'i patlatmaz) — `return false` → `return true`
// mutantı 33/33 testten kaçıyordu ("false döner" iddiası kanıtsızdı, bkz. gate-system
// "raporun eki raporu yalanlar"). Bu test getter'ı BİLİNÇLİ patlatıp catch dalını
// GERÇEKTEN tetikler ve dönüş değerini assert eder.
test('yesilSayilirMi: kimlikUyusuyorMu GERÇEKTEN fırlatırsa (getter patlar) → false döner, çökmez [GERİLEME]', () => {
  const patlayanBeklenen = {};
  Object.defineProperty(patlayanBeklenen, 'kapilar', {
    enumerable: true,
    get() { throw new Error('kasıtlı patlama — catch dalını tetikler'); },
  });
  const saglik = { kapilar: { sayfaWebp: false } };
  // Önce iç fonksiyonun gerçekten fırlattığını doğrula (yoksa aşağıdaki assert anlamsız olur).
  assert.throws(() => kimlikUyusuyorMu(saglik, patlayanBeklenen));
  let sonuc;
  assert.doesNotThrow(() => { sonuc = yesilSayilirMi(saglik, patlayanBeklenen); });
  assert.strictEqual(sonuc, false);
});
