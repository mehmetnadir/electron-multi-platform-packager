'use strict';
/**
 * ŞERİT (ANA DÖNGÜ) İLERLEMESİ + KOMUT ZAMAN AŞIMI — karar katmanı testleri.
 *
 * NEDEN AYRI DOSYA: `vm-kapi-karar.test.js` üzerinde eşzamanlı başka ajanlar
 * çalışıyor olabilir (paylaşılan git indeksi kuralı). Bu dosya yalnız 2026-09-21
 * arızasının kapattığı deliği ölçer.
 *
 * ÖLÇÜLEN ARIZA: izleyicinin `komut` dalı erişilemeyen bir ağ sürücüsünde asıldı.
 * Kalp atışı AYRI işte koştuğu için atmaya devam etti → host "ayakta, yaş 2 sn"
 * dedi; oysa ana döngü 16+ dakika blokeydi. Alınan görev sonuç yazamadı, sıradaki
 * görev hiç alınmadı. Bu suite'in görevi: aynı durumda kararın "ayakta ve iyi"
 * DEMEMESİ.
 */
const test = require('node:test');
const assert = require('node:assert');
const k = require('./vm-kapi-karar.js');

const SIMDI = Date.parse('2026-09-21T12:00:00.000Z');
const once = (sn) => new Date(SIMDI - sn * 1000).toISOString();

// ——— kalpAyristir: İKİ BİÇİM ————————————————————————————————————————

test('kalpAyristir: ESKİ izleyicinin çıplak ISO damgası okunur (geriye uyum)', () => {
  const r = k.kalpAyristir(once(3));
  assert.strictEqual(r.kalpMs, SIMDI - 3000);
  assert.strictEqual(r.dongu, null, 'eski izleyicide şerit bilgisi YOKTUR — uydurulmamalı');
});

test('kalpAyristir: YENİ izleyicinin JSON kalbi şerit damgasını taşır', () => {
  const r = k.kalpAyristir(JSON.stringify({
    kalp: once(2),
    sonDonguDamgasi: once(7),
    donguDurumu: 'calisiyor',
    donguGorevi: '20260921-102107',
    donguZamanAsimiSn: 570,
  }));
  assert.strictEqual(r.kalpMs, SIMDI - 2000);
  assert.strictEqual(r.dongu.damgaMs, SIMDI - 7000);
  assert.strictEqual(r.dongu.durum, 'calisiyor');
  assert.strictEqual(r.dongu.gorev, '20260921-102107');
  assert.strictEqual(r.dongu.zamanAsimiSn, 570);
});

test('kalpAyristir: çöp içerik ÇÖKERTMEZ, null döner', () => {
  for (const ham of ['', null, 'bugün filan', '{bozuk json', '{"kalp":"yok"}', '[]']) {
    const r = k.kalpAyristir(ham);
    assert.strictEqual(r.kalpMs, null, JSON.stringify(ham));
    assert.strictEqual(r.dongu, null, JSON.stringify(ham));
  }
});

// ——— seritDurumu ————————————————————————————————————————————————————

test('seritDurumu: damga yoksa BİLİNMİYOR (eski izleyici) — "iyi" DENMEZ', () => {
  assert.strictEqual(k.seritDurumu(null, SIMDI).serit, 'bilinmiyor');
  assert.strictEqual(k.seritDurumu({ damgaMs: NaN }, SIMDI).serit, 'bilinmiyor');
});

test('seritDurumu: boşta taze damga AKIYOR', () => {
  const r = k.seritDurumu({ damgaMs: SIMDI - 5000, durum: 'bos' }, SIMDI);
  assert.strictEqual(r.serit, 'akiyor');
  assert.strictEqual(r.yasSn, 5);
});

test('seritDurumu: boşta bayat damga TIKALI — döngü görev almadan asılmış', () => {
  const r = k.seritDurumu({ damgaMs: SIMDI - (k.SERIT_BOS_AZAMI_SN + 10) * 1000, durum: 'bos' }, SIMDI);
  assert.strictEqual(r.serit, 'tikali');
  assert.match(r.uyari, /ilerlemiyor/);
});

test('seritDurumu: görev içinde tavan aşılmadıysa ÇALIŞIYOR (uzun iş yanlış alarm ÜRETMEZ)', () => {
  // 1,3 GB'lık kurulum dakikalarca sürer; bu normaldir ve tıkalı SAYILMAZ.
  const r = k.seritDurumu(
    { damgaMs: SIMDI - 400 * 1000, durum: 'calisiyor', gorev: 'g1', zamanAsimiSn: 570 }, SIMDI);
  assert.strictEqual(r.serit, 'calisiyor');
  assert.strictEqual(r.gorev, 'g1');
});

test('seritDurumu: görev KENDİ tavanını + payı aştıysa TIKALI (zaman aşımı DA tutmamış)', () => {
  const yas = 570 + k.SERIT_PAY_SN + 5;
  const r = k.seritDurumu(
    { damgaMs: SIMDI - yas * 1000, durum: 'calisiyor', gorev: '20260921-102107', zamanAsimiSn: 570 }, SIMDI);
  assert.strictEqual(r.serit, 'tikali');
  assert.match(r.uyari, /20260921-102107/);
  assert.match(r.uyari, /TUTMAMIŞ/);
});

test('seritDurumu: tavan bildirilmemişse varsayılan tavan kullanılır', () => {
  const altinda = k.SERIT_VARSAYILAN_TAVAN_SN + k.SERIT_PAY_SN - 5;
  const ustunde = k.SERIT_VARSAYILAN_TAVAN_SN + k.SERIT_PAY_SN + 5;
  assert.strictEqual(
    k.seritDurumu({ damgaMs: SIMDI - altinda * 1000, durum: 'calisiyor' }, SIMDI).serit, 'calisiyor');
  assert.strictEqual(
    k.seritDurumu({ damgaMs: SIMDI - ustunde * 1000, durum: 'calisiyor' }, SIMDI).serit, 'tikali');
});

// ——— izleyiciDurumu: ARIZANIN TA KENDİSİ ————————————————————————————

test('ARIZA: kalp TAZE ama şerit TIKALI → "ayakta" tek başına yeşil sayılmaz', () => {
  // 2026-09-21: kalp 5 sn'de bir atıyordu (ayrı iş), ana döngü 16+ dk blokeydi.
  const dongu = { damgaMs: SIMDI - 1000 * 1000, durum: 'calisiyor', gorev: '20260921-102107', zamanAsimiSn: 570 };
  const r = k.izleyiciDurumu(SIMDI - 2000, SIMDI, { dongu });
  assert.strictEqual(r.durum, 'ayakta', 'süreç gerçekten ayakta — orada yalan yok');
  assert.strictEqual(r.serit, 'tikali', 'ama ŞERİT ilerlemiyor ve bu SÖYLENMELİ');
  assert.strictEqual(r.seritYasSn, 1000);
  assert.strictEqual(r.seritGorevi, '20260921-102107');
  assert.match(r.uyari, /ayakta ama şerit 1000 sn'dir ilerlemiyor/);
});

test('GERİLEME: şerit bilgisi olmayan eski izleyicide eski kararlar AYNEN sürer', () => {
  assert.strictEqual(k.izleyiciDurumu(null, SIMDI).durum, 'yok');
  assert.strictEqual(k.izleyiciDurumu(SIMDI - 2000, SIMDI).durum, 'ayakta');
  assert.strictEqual(k.izleyiciDurumu(SIMDI - 100000, SIMDI).durum, 'olu');
  assert.strictEqual(k.izleyiciDurumu(SIMDI - 100000, SIMDI, { gorevUcusta: true }).durum, 'ayakta');
  assert.strictEqual(k.izleyiciDurumu(SIMDI - 2000, SIMDI).serit, 'bilinmiyor');
});

test('şerit akarken izleyiciDurumu fazladan UYARI üretmez (gürültü yok)', () => {
  const r = k.izleyiciDurumu(SIMDI - 2000, SIMDI, { dongu: { damgaMs: SIMDI - 4000, durum: 'bos' } });
  assert.strictEqual(r.serit, 'akiyor');
  assert.strictEqual(r.uyari, undefined);
});

// ——— GUEST TAVANI ————————————————————————————————————————————————————

test('guestZamanAsimiSn: guest tavanı host tavanından PAY kadar KISA', () => {
  assert.strictEqual(k.guestZamanAsimiSn(600), 600 - k.GUEST_PAY_SN);
  assert.strictEqual(k.guestZamanAsimiSn(1800), 1800 - k.GUEST_PAY_SN);
  assert.ok(k.guestZamanAsimiSn(600) < 600, 'guest ÖNCE konuşmalı — yoksa host sessizliği yorumlar');
});

test('guestZamanAsimiSn: çok kısa/geçersiz host tavanında güvenli değere oturur', () => {
  assert.strictEqual(k.guestZamanAsimiSn(10), k.GUEST_ASGARI_SN);
  assert.strictEqual(k.guestZamanAsimiSn(0), k.GUEST_VARSAYILAN_SN);
  assert.strictEqual(k.guestZamanAsimiSn('abc'), k.GUEST_VARSAYILAN_SN);
  assert.strictEqual(k.guestZamanAsimiSn(undefined), k.GUEST_VARSAYILAN_SN);
});

test('calistirGovdesi: her görev KENDİ tavanını taşır (sabit tavan gömülmez)', () => {
  const { govde } = k.calistirGovdesi('dir C:\\', 600);
  assert.strictEqual(govde.tur, 'komut');
  assert.strictEqual(govde.zamanAsimiSn, k.guestZamanAsimiSn(600));
  const uzun = k.calistirGovdesi('setup.exe /S', 3600);
  assert.strictEqual(uzun.govde.zamanAsimiSn, 3600 - k.GUEST_PAY_SN,
    'uzun kurulum için tavan da uzar — sabit kısa tavan üretimi bozardı');
  // reddetme yolları bozulmadı
  assert.strictEqual(k.calistirGovdesi('   ', 600).hata, 'bos-komut');
  assert.strictEqual(k.calistirGovdesi('x'.repeat(k.KOMUT_AZAMI + 1), 600).hata, 'komut-uzun');
});

// ——— gorevKarari: ZAMAN AŞIMI SESSİZCE KAYBOLMAZ ————————————————————

test('gorevKarari: guest durum:"zaman-asimi" yazdıysa KALDI değil ZAMAN-AŞIMI', () => {
  const r = k.gorevKarari({
    cikis: 124, durum: 'zaman-asimi', gecenSn: 571,
    komutOnEk: 'Get-PSDrive -PSProvider FileSystem', cikti: 'ZAMAN ASIMI: ...',
  }, 600, 600);
  assert.strictEqual(r.durum, 'zaman-asimi');
  assert.strictEqual(r.gecenSn, 571);
  assert.match(r.sebep, /571 sn/);
  assert.match(r.sebep, /Get-PSDrive/, 'hangi komutun astığı raporda görünmeli');
  assert.strictEqual(k.alarmliMi(r.durum), true, 'zaman aşımı ALARMLI bir sonuçtur');
});

test('GERİLEME: normal sonuçlar durum alanı eklenince de aynı karar verir', () => {
  assert.strictEqual(k.gorevKarari({ cikis: 0, durum: 'bitti', beklenenKanit: false }, 1).durum, 'gecti');
  assert.strictEqual(k.gorevKarari({ cikis: 3, durum: 'bitti' }, 1).durum, 'kaldi');
  assert.strictEqual(k.gorevKarari({ cikis: 0, durum: 'bitti', ekran: 'a.png', surecSayisi: 4 }, 1).durum, 'gecti');
  assert.strictEqual(k.gorevKarari({ cikis: 0, durum: 'bitti', surecSayisi: 4 }, 1).durum, 'kaldi');
  assert.strictEqual(k.gorevKarari(null, 5, 600).durum, 'bekleniyor');
  assert.strictEqual(k.gorevKarari(null, 600, 600).durum, 'zaman-asimi');
});
