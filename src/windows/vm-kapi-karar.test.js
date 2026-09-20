'use strict';
const test = require('node:test');
const assert = require('node:assert');
const m = require('./vm-kapi-karar.js');

const SIMDI = 1_800_000_000_000;

// --- izleyici durumu ---

test('kalp atışı yoksa izleyici YOK (başlatılmamış)', () => {
  const r = m.izleyiciDurumu(null, SIMDI);
  assert.strictEqual(r.durum, 'yok');
  assert.match(r.sebep, /başlatılmamış/);
});

test('kalp atışı sayı değilse YOK sayılır', () => {
  assert.strictEqual(m.izleyiciDurumu(NaN, SIMDI).durum, 'yok');
  assert.strictEqual(m.izleyiciDurumu('dun', SIMDI).durum, 'yok');
});

test('taze kalp → ayakta', () => {
  const r = m.izleyiciDurumu(SIMDI - 5000, SIMDI);
  assert.strictEqual(r.durum, 'ayakta');
  assert.strictEqual(r.yasSn, 5);
});

test('eşikte AYAKTA, eşiği aşınca ÖLÜ (sınır testi)', () => {
  assert.strictEqual(m.izleyiciDurumu(SIMDI - m.KALP_TAZE_SN * 1000, SIMDI).durum, 'ayakta');
  assert.strictEqual(m.izleyiciDurumu(SIMDI - (m.KALP_TAZE_SN + 1) * 1000, SIMDI).durum, 'olu');
});

test('ölü izleyici sebebi eşiği söyler', () => {
  const r = m.izleyiciDurumu(SIMDI - 120000, SIMDI);
  assert.strictEqual(r.durum, 'olu');
  assert.match(r.sebep, /120 sn önce/);
});

test('guest saati ileriyse ölü DENMEZ — uyarı verilir', () => {
  const r = m.izleyiciDurumu(SIMDI + 60000, SIMDI);
  assert.strictEqual(r.durum, 'ayakta');
  assert.match(r.uyari, /ileri/);
});

// --- görev kararı ---

test('sonuç yokken süre dolmadıysa BEKLENİYOR', () => {
  const r = m.gorevKarari(null, 10, 900);
  assert.strictEqual(r.durum, 'bekleniyor');
  assert.strictEqual(r.gecenSn, 10);
});

test('sonuç yokken süre dolduysa ZAMAN AŞIMI (sessiz bekleme yok)', () => {
  assert.strictEqual(m.gorevKarari(null, 900, 900).durum, 'zaman-asimi');
  assert.strictEqual(m.gorevKarari(null, 901, 900).durum, 'zaman-asimi');
});

test('çıkış kodu alanı yoksa BOZUK — başarı sayılmaz', () => {
  assert.strictEqual(m.gorevKarari({}, 5).durum, 'bozuk');
  assert.strictEqual(m.gorevKarari({ cikis: 'sifir' }, 5).durum, 'bozuk');
  assert.strictEqual(m.gorevKarari('tamam', 5).durum, 'bozuk');
});

test('sıfır olmayan çıkış kodu KALDI', () => {
  const r = m.gorevKarari({ cikis: 1, cikti: 'hata' }, 5);
  assert.strictEqual(r.durum, 'kaldi');
  assert.match(r.sebep, /çıkış kodu 1/);
  assert.strictEqual(r.ciktiKuyrugu, 'hata');
});

test('ÇIKIŞ 0 TEK BAŞINA GEÇMEZ — ekran kanıtı yoksa KALDI', () => {
  const r = m.gorevKarari({ cikis: 0, surecSayisi: 3 }, 5);
  assert.strictEqual(r.durum, 'kaldi');
  assert.match(r.sebep, /EKRAN KANITI yok/);
});

test('ÇIKIŞ 0 + ekran var ama süreç ayakta değilse KALDI', () => {
  for (const s of [0, undefined, null, 'üç']) {
    const r = m.gorevKarari({ cikis: 0, ekran: 'a.png', surecSayisi: s }, 5);
    assert.strictEqual(r.durum, 'kaldi', `surecSayisi=${s}`);
    assert.match(r.sebep, /süreci ayakta değil/);
  }
});

test('çıkış 0 + ekran + ayakta süreç → GEÇTİ', () => {
  const r = m.gorevKarari({ cikis: 0, ekran: 'a.png', surecSayisi: 4 }, 12);
  assert.strictEqual(r.durum, 'gecti');
  assert.strictEqual(r.ekran, 'a.png');
  assert.strictEqual(r.surecSayisi, 4);
});

test('kanıt istenmeyen görev (ör. sadece komut) ekransız GEÇER', () => {
  const r = m.gorevKarari({ cikis: 0, beklenenKanit: false }, 3);
  assert.strictEqual(r.durum, 'gecti');
});

test('varsayılan zaman aşımı kullanılır', () => {
  assert.strictEqual(m.gorevKarari(null, m.VARSAYILAN_ZAMAN_ASIMI_SN - 1).durum, 'bekleniyor');
  assert.strictEqual(m.gorevKarari(null, m.VARSAYILAN_ZAMAN_ASIMI_SN).durum, 'zaman-asimi');
});

// --- alarm ---

test('alarmlı durumlar tam olarak bunlar', () => {
  for (const d of ['kaldi', 'zaman-asimi', 'bozuk']) assert.strictEqual(m.alarmliMi(d), true, d);
  for (const d of ['gecti', 'bekleniyor']) assert.strictEqual(m.alarmliMi(d), false, d);
});

// --- görev kimliği ---

test('görev kimliği damga + sıfır dolgulu sonek', () => {
  const k = m.gorevKimligi(Date.UTC(2026, 8, 20, 15, 4, 5), 7);
  assert.strictEqual(k, '20260920-150405-0007');
});

test('aynı anda iki görev ÇAKIŞMAZ', () => {
  assert.notStrictEqual(m.gorevKimligi(SIMDI, 1), m.gorevKimligi(SIMDI, 2));
});

// ——— Çakışma koruması (Nadir aynı VM'i elle kullanıyor) ———————————————
const { mudahaleKarari } = require('./vm-kapi-karar');

test('serbest VM: her komut geçer', () => {
  for (const k of ['baslat', 'uyut', 'kur', 'ekran', 'hazir']) {
    assert.strictEqual(mudahaleKarari({ komut: k }).izin, true, k);
  }
});

test('BENDE bayrağı: durum değiştiren komutlar reddedilir', () => {
  for (const k of ['baslat', 'uyut', 'kur', 'kapat']) {
    const r = mudahaleKarari({ komut: k, bendeBayragi: true });
    assert.strictEqual(r.izin, false, k);
    assert.strictEqual(r.sebep, 'nadir-kullaniyor');
  }
});

test('BENDE bayrağı: ÖLÇÜM komutları yine de geçer (ekran/hazir)', () => {
  for (const k of ['ekran', 'hazir', 'anlik-al']) {
    assert.strictEqual(mudahaleKarari({ komut: k, bendeBayragi: true }).izin, true, k);
  }
});

test('pencere açıkken uyut/kur reddedilir — ekranını dondurmayız', () => {
  assert.strictEqual(mudahaleKarari({ komut: 'uyut', pencereAcik: true }).izin, false);
  assert.strictEqual(mudahaleKarari({ komut: 'kur', pencereAcik: true }).sebep, 'pencere-acik');
});

test('--zorla yalnız YIKICI OLMAYAN hamleyi açar', () => {
  assert.strictEqual(mudahaleKarari({ komut: 'uyut', pencereAcik: true, zorla: true }).izin, true);
  assert.strictEqual(mudahaleKarari({ komut: 'kur', bendeBayragi: true, zorla: true }).izin, true);
});

test('geri-don EL DEĞMİŞSE --zorla ile bile açılmaz (geri dönülmez veri kaybı)', () => {
  for (const d of [{ bendeBayragi: true }, { pencereAcik: true }]) {
    const r = mudahaleKarari({ komut: 'geri-don', ...d, zorla: true });
    assert.strictEqual(r.izin, false);
    assert.strictEqual(r.sebep, 'yikici-el-degmis');
  }
});

test('geri-don temiz VM\'de serbest', () => {
  assert.strictEqual(mudahaleKarari({ komut: 'geri-don' }).izin, true);
});

// ——— Meşgul izleyici: uzun iş sırasında susma ölüm sayılmaz ———————————
const { KALP_MESGUL_SN, KALP_TAZE_SN, izleyiciDurumu } = require('./vm-kapi-karar');

test('GERİLEME: görev uçuştayken 31 sn sessizlik ÖLÜM sayılmaz', () => {
  const simdi = Date.UTC(2026, 8, 20, 12, 0, 31);
  const kalp = Date.UTC(2026, 8, 20, 12, 0, 0);
  assert.strictEqual(izleyiciDurumu(kalp, simdi).durum, 'olu', 'boştayken eşik 30 sn kalmalı');
  const mesgul = izleyiciDurumu(kalp, simdi, { gorevUcusta: true });
  assert.strictEqual(mesgul.durum, 'ayakta');
  assert.match(mesgul.uyari, /sessiz/);
});

test('meşgul izleyici de SÜRESİZ susamaz (300 sn tavanı)', () => {
  const kalp = 0;
  assert.strictEqual(izleyiciDurumu(kalp, (KALP_MESGUL_SN + 1) * 1000, { gorevUcusta: true }).durum, 'olu');
  assert.strictEqual(izleyiciDurumu(kalp, (KALP_MESGUL_SN - 5) * 1000, { gorevUcusta: true }).durum, 'ayakta');
});

test('meşgul eşiği boş eşikten büyük olmalı (yoksa düzeltme anlamsız)', () => {
  assert.ok(KALP_MESGUL_SN > KALP_TAZE_SN);
});

test('taze kalp meşgulken uyarı ÜRETMEZ', () => {
  const r = izleyiciDurumu(1000 * 10, 1000 * 15, { gorevUcusta: true });
  assert.strictEqual(r.durum, 'ayakta');
  assert.strictEqual(r.uyari, undefined);
});

test('GERİLEME: VM KAPALIYKEN kalan pencere baslat\'ı engellemez', () => {
  const r = mudahaleKarari({ komut: 'baslat', pencereAcik: true, vmCalisiyor: false });
  assert.strictEqual(r.izin, true, 'durmuş VM kimse tarafından kullanılıyor olamaz');
});

test('VM ÇALIŞIRKEN açık pencere hâlâ engeller', () => {
  assert.strictEqual(mudahaleKarari({ komut: 'uyut', pencereAcik: true, vmCalisiyor: true }).izin, false);
});

test('kapalı VM\'de geri-don yalnız BENDE ile engellenir', () => {
  assert.strictEqual(mudahaleKarari({ komut: 'geri-don', pencereAcik: true, vmCalisiyor: false }).izin, true);
  assert.strictEqual(mudahaleKarari({ komut: 'geri-don', bendeBayragi: true, vmCalisiyor: false }).izin, false);
});

// ——— UZAK KOMUT GÖVDESİ ————————————————————————————————————————————————
test('calistirGovdesi: normal satır izleyicinin komut dalına gövde üretir', () => {
  const r = m.calistirGovdesi('  wmic logicaldisk get freespace  ');
  assert.equal(r.hata, undefined);
  assert.deepEqual(r.govde, { tur: 'komut', komut: 'wmic logicaldisk get freespace' });
});

test('calistirGovdesi: boş/boşluk satırı görev YAZILMADAN reddedilir', () => {
  for (const g of ['', '   ', '\t\n', undefined, null, 42]) {
    assert.equal(m.calistirGovdesi(g).hata, 'bos-komut', `girdi: ${JSON.stringify(g)}`);
    assert.equal(m.calistirGovdesi(g).govde, undefined);
  }
});

test('calistirGovdesi: azami uzunluk sınırı vardır', () => {
  const tam = 'a'.repeat(m.KOMUT_AZAMI);
  assert.equal(m.calistirGovdesi(tam).hata, undefined);
  assert.equal(m.calistirGovdesi(tam).govde.komut.length, m.KOMUT_AZAMI);
  assert.equal(m.calistirGovdesi(`${tam}a`).hata, 'komut-uzun');
});
