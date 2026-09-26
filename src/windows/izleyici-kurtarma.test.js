'use strict';
const test = require('node:test');
const assert = require('node:assert');
const m = require('./izleyici-kurtarma.js');

const SIMDI = 1_800_000_000_000;
const sn = (x) => x * 1000;

/** Sağlam bir "her şey yolunda" ölçümü — testler yalnız değiştirdikleri alanı yazar. */
function olcum(ek = {}) {
  return Object.assign({
    simdiMs: SIMDI,
    izleyiciVar: true,
    damgaMs: SIMDI - sn(3),
    durum: 'bos',
    zamanAsimiSn: null,
    uzakTetik: null,
    gorulenTetik: null,
    mudahaleGecmisi: [],
    ilkTur: false,
  }, ek);
}

// ——— temel akış ————————————————————————————————————————————————————————

test('taze damga + boşta → bekle (müdahale yok)', () => {
  const r = m.kurtarmaKarari(olcum());
  assert.strictEqual(r.karar, 'bekle');
  assert.strictEqual(r.yasSn, 3);
});

test('boşta + damga eşiği aştı → yeniden-baslat (bos-serit)', () => {
  const r = m.kurtarmaKarari(olcum({ damgaMs: SIMDI - sn(m.BOS_AZAMI_SN + 1) }));
  assert.strictEqual(r.karar, 'yeniden-baslat');
  assert.strictEqual(r.tetik, 'bos-serit');
  assert.match(r.sebep, /damga basmıyor/);
});

test('boşta eşiğin TAM üstünde bekle, bir saniye fazlası müdahale (sınır testi)', () => {
  const esikte = m.kurtarmaKarari(olcum({ damgaMs: SIMDI - sn(m.BOS_AZAMI_SN) }));
  const asan = m.kurtarmaKarari(olcum({ damgaMs: SIMDI - sn(m.BOS_AZAMI_SN + 1) }));
  assert.strictEqual(esikte.karar, 'bekle');
  assert.strictEqual(asan.karar, 'yeniden-baslat');
});

test('uzun görev tavanı içindeyken DOKUNULMAZ (yanlış alarm üretme)', () => {
  // 1,3 GB kurulum: 1800 sn tavan, 1200 sn'dir sürüyor — bu normaldir.
  const r = m.kurtarmaKarari(olcum({ durum: 'calisiyor', zamanAsimiSn: 1800, damgaMs: SIMDI - sn(1200) }));
  assert.strictEqual(r.karar, 'bekle');
  assert.match(r.sebep, /görev sürüyor/);
});

test('görev tavanı + pay aşıldı → yeniden-baslat (gorev-tavani)', () => {
  const yas = 600 + m.TAVAN_PAYI_SN + 1;
  const r = m.kurtarmaKarari(olcum({
    durum: 'calisiyor', zamanAsimiSn: 600, gorev: '20260921-102107', damgaMs: SIMDI - sn(yas),
  }));
  assert.strictEqual(r.karar, 'yeniden-baslat');
  assert.strictEqual(r.tetik, 'gorev-tavani');
  assert.match(r.sebep, /20260921-102107/);
  assert.match(r.sebep, /zaman aşımı tutmamış/);
});

test('görev kendi tavanını bildirmediyse varsayılan tavan kullanılır', () => {
  const altinda = m.kurtarmaKarari(olcum({
    durum: 'calisiyor', zamanAsimiSn: null, damgaMs: SIMDI - sn(m.VARSAYILAN_TAVAN_SN),
  }));
  const ustunde = m.kurtarmaKarari(olcum({
    durum: 'calisiyor', zamanAsimiSn: null,
    damgaMs: SIMDI - sn(m.VARSAYILAN_TAVAN_SN + m.TAVAN_PAYI_SN + 1),
  }));
  assert.strictEqual(altinda.karar, 'bekle');
  assert.strictEqual(ustunde.karar, 'yeniden-baslat');
});

// ——— kör kalma: "iyi" demek yasak ——————————————————————————————————————

test('izleyici ayakta ama damga YOK → elle (eski sürüm, gözcü kör)', () => {
  const r = m.kurtarmaKarari(olcum({ damgaMs: null }));
  assert.strictEqual(r.karar, 'elle');
  assert.match(r.sebep, /ESKİ sürüm/);
  assert.match(r.sebep, /YUKSELTME/);
});

test('şimdi damgası yoksa karar üretilmez → elle', () => {
  assert.strictEqual(m.kurtarmaKarari({ simdiMs: null }).karar, 'elle');
  assert.strictEqual(m.kurtarmaKarari(null).karar, 'elle');
});

// ——— süreç yok ————————————————————————————————————————————————————————

test('izleyici süreci yoksa öldürme değil BAŞLAT kararı çıkar', () => {
  const r = m.kurtarmaKarari(olcum({ izleyiciVar: false, damgaMs: null }));
  assert.strictEqual(r.karar, 'basla');
  assert.match(r.sebep, /bulunamadı/);
});

// ——— frenler: bekçi kendisi arıza olmasın ————————————————————————————————

test('soğuma penceresinde müdahale ERTELENİR', () => {
  const r = m.kurtarmaKarari(olcum({
    damgaMs: SIMDI - sn(600),
    mudahaleGecmisi: [SIMDI - sn(30)],
  }));
  assert.strictEqual(r.karar, 'bekle');
  assert.match(r.sebep, /soğuma/);
});

test('soğuma bittiğinde müdahale yeniden serbest', () => {
  const r = m.kurtarmaKarari(olcum({
    damgaMs: SIMDI - sn(600),
    mudahaleGecmisi: [SIMDI - sn(m.SOGUMA_SN + 1)],
  }));
  assert.strictEqual(r.karar, 'yeniden-baslat');
});

test('saatlik tavan dolduysa gözcü DURUR ve insana bırakır (288 restart/gün dersi)', () => {
  const gecmis = [];
  for (let i = 0; i < m.SAATLIK_TAVAN; i += 1) gecmis.push(SIMDI - sn(300 * (i + 1)));
  const r = m.kurtarmaKarari(olcum({ damgaMs: SIMDI - sn(600), mudahaleGecmisi: gecmis }));
  assert.strictEqual(r.karar, 'elle');
  assert.match(r.sebep, /tavan/);
});

test('1 saatten eski müdahaleler tavanı doldurmaz (pencere kayar)', () => {
  const eski = [SIMDI - sn(4000), SIMDI - sn(5000), SIMDI - sn(6000)];
  assert.strictEqual(m.sonPenceredekiMudahale(eski, SIMDI), 0);
  const r = m.kurtarmaKarari(olcum({ damgaMs: SIMDI - sn(600), mudahaleGecmisi: eski }));
  assert.strictEqual(r.karar, 'yeniden-baslat');
});

// ——— uzaktan tetik ————————————————————————————————————————————————————

test('uzak tetik değiştiyse sağlıklı şeritte bile yeniden-baslat (operatör talebi)', () => {
  const r = m.kurtarmaKarari(olcum({ uzakTetik: 'a2', gorulenTetik: 'a1' }));
  assert.strictEqual(r.karar, 'yeniden-baslat');
  assert.strictEqual(r.tetik, 'uzak');
  assert.strictEqual(r.yeniTetik, 'a2');
});

test('uzak tetik AYNIYSA hiçbir şey olmaz (idempotent)', () => {
  const r = m.kurtarmaKarari(olcum({ uzakTetik: 'a2', gorulenTetik: 'a2' }));
  assert.strictEqual(r.karar, 'bekle');
});

test('İLK TUR: eski tetik tohumlanır, müdahale ÜRETMEZ', () => {
  // Tuzak: gözcü her açılışında dosyadaki eski damgayı "yeni" sayarsa her başlatma
  // bir restart doğurur — sonsuz döngü. İlk tur yalnız tohumlar.
  const r = m.kurtarmaKarari(olcum({ uzakTetik: 'a9', gorulenTetik: null, ilkTur: true }));
  assert.strictEqual(r.karar, 'bekle');
  assert.strictEqual(r.yeniTetik, 'a9');
});

test('uzak tetik soğumayı ve tavanı AŞAR (insanın açık talebi kazanır)', () => {
  const gecmis = [];
  for (let i = 0; i < m.SAATLIK_TAVAN; i += 1) gecmis.push(SIMDI - sn(60 * (i + 1)));
  const r = m.kurtarmaKarari(olcum({ uzakTetik: 'z', gorulenTetik: null, mudahaleGecmisi: gecmis }));
  assert.strictEqual(r.karar, 'yeniden-baslat');
  assert.strictEqual(r.tetik, 'uzak');
});

// ——— SAPMA BEKÇİSİ ——————————————————————————————————————————————————————
// Host TEŞHİS eder, gözcü MÜDAHALE eder; eşikler ayrışırsa host "tıkalı" derken
// gözcü susar. İki tarafın sayıları birebir aynı kalmalı.
test('eşikler host karar modülüyle birebir aynı (sapma bekçisi)', () => {
  const host = require('./vm-kapi-karar.js');
  assert.strictEqual(m.BOS_AZAMI_SN, host.SERIT_BOS_AZAMI_SN);
  assert.strictEqual(m.TAVAN_PAYI_SN, host.SERIT_PAY_SN);
  assert.strictEqual(m.VARSAYILAN_TAVAN_SN, host.SERIT_VARSAYILAN_TAVAN_SN);
});

// ——— uzak tetik damgası ————————————————————————————————————————————————

test('tetik damgası aynı ms içinde bile FARKLI üretilebilir (rastgele son ek)', () => {
  const a = m.tetikDamgasi(SIMDI, 0.1);
  const b = m.tetikDamgasi(SIMDI, 0.9);
  assert.notStrictEqual(a, b);
  assert.match(a, /^\d{8}T\d{6}-\d{4}$/);
});

test('tetik damgası zamanla ARTAR (gözcü "değişti mi" diye bakar, sıra da anlamlı)', () => {
  const once = m.tetikDamgasi(SIMDI, 0.5);
  const sonra = m.tetikDamgasi(SIMDI + 60_000, 0.5);
  assert.ok(sonra > once, `${sonra} > ${once} olmalı`);
});
