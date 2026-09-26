'use strict';
/**
 * Başsız kabul kapısı — saf ölçüt/karar birim testleri.
 * Eşik değerleri probook-kabul.sh ile AYNI olmalı; biri değişirse bu dosya kırılır.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const O = require('./olcutler');

/** w×h BGRA tampon; boyayici(x,y) → [r,g,b]. */
function tampon(w, h, boyayici, duzen = 'bgra') {
  const b = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, bl] = boyayici(x, y);
      const i = (y * w + x) * 4;
      if (duzen === 'bgra') { b[i] = bl; b[i + 1] = g; b[i + 2] = r; } else { b[i] = r; b[i + 1] = g; b[i + 2] = bl; }
      b[i + 3] = 255;
    }
  }
  return b;
}

test('eşikler probook-kabul.sh ile birebir aynı', () => {
  assert.deepEqual(O.ESIKLER, { sapma: 0.05, koyu: 0.005, renk: 500 });
  assert.equal(O.KOYU_ESIGI, 0.85);
  const sh = fs.readFileSync(path.join(__dirname, '..', 'pardus', 'probook-kabul.sh'), 'utf8');
  assert.match(sh, /s\+0 >= 0\.05 && k\+0 >= 0\.005 && r\+0 >= re/);
  assert.match(sh, /RENK_ESIGI=500/);
  assert.match(sh, /-threshold 85%/);
});

test('pikselMetrikleri: düz beyaz ekran → sapma 0, koyu 0, renk 1', () => {
  const m = O.pikselMetrikleri(tampon(40, 30, () => [255, 255, 255]), 40, 30);
  assert.equal(m.sapma, 0);
  assert.equal(m.koyu, 0);
  assert.equal(m.renk, 1);
});

test('pikselMetrikleri: yarı siyah yarı beyaz → sapma 0.5, koyu 0.5', () => {
  const m = O.pikselMetrikleri(tampon(40, 30, (x) => (x < 20 ? [0, 0, 0] : [255, 255, 255])), 40, 30);
  assert.equal(m.sapma, 0.5);
  assert.equal(m.koyu, 0.5);
  assert.equal(m.renk, 2);
});

test('pikselMetrikleri: BGRA ve RGBA düzeni aynı sonucu verir; renk sayımı RGB üzerinden', () => {
  const boya = (x, y) => [x * 6 % 256, y * 8 % 256, (x + y) % 256];
  const a = O.pikselMetrikleri(tampon(40, 30, boya, 'bgra'), 40, 30, { duzen: 'bgra' });
  const b = O.pikselMetrikleri(tampon(40, 30, boya, 'rgba'), 40, 30, { duzen: 'rgba' });
  assert.deepEqual(a, b);
  assert.ok(a.renk > 500);
});

test('pikselMetrikleri: eksik tampon ölçüm üretmez (0)', () => {
  const m = O.pikselMetrikleri(Buffer.alloc(10), 40, 30);
  assert.equal(m.renk, 0);
});

test('pikselKarari: probook kırık ölçümü RED, sağlam ölçümü GEÇTİ', () => {
  assert.equal(O.pikselKarari({ sapma: 0.020, koyu: 0.00047, renk: 10 }).gecti, false);
  assert.equal(O.pikselKarari({ sapma: 0.198, koyu: 0.51, renk: 93750 }).gecti, true);
});

test('pikselKarari: her eşik tek başına düşürür (sınır değerleri)', () => {
  const iyi = { sapma: 0.05, koyu: 0.005, renk: 500 };
  assert.equal(O.pikselKarari(iyi).gecti, true, 'eşiğe eşit geçer (>=)');
  assert.equal(O.pikselKarari({ ...iyi, sapma: 0.0499 }).gecti, false);
  assert.equal(O.pikselKarari({ ...iyi, koyu: 0.0049 }).gecti, false);
  assert.equal(O.pikselKarari({ ...iyi, renk: 499 }).gecti, false);
});

test('pikselKarari: aktivasyon kodlu seride renk eşiği aranmaz, sapma/koyu aranır', () => {
  assert.equal(O.pikselKarari({ sapma: 0.1, koyu: 0.2, renk: 40 }, { aktivasyon: true }).gecti, true);
  assert.equal(O.pikselKarari({ sapma: 0.01, koyu: 0.2, renk: 40 }, { aktivasyon: true }).gecti, false);
});

test('pikselKarari: ölçüm yoksa ÖLÇÜLEMEDİ (GEÇTİ değil)', () => {
  const k = O.pikselKarari(null);
  assert.equal(k.gecti, false);
  assert.equal(k.olculemedi, true);
});

test('okuyucuBasligiMi: okuyucu başlığı (boşluk/büyük harf farkıyla) tanınır', () => {
  assert.equal(O.okuyucuBasligiMi('Akıllı Tahta Uygulaması'), true);
  assert.equal(O.okuyucuBasligiMi('  AKILLI TAHTA UYGULAMASI '), true);
  assert.equal(O.okuyucuBasligiMi('Super Monsters Grade 3 - Maarif'), false);
  assert.equal(O.okuyucuBasligiMi(''), false);
});

test('beklenenKartSayisi: bookN sayısı; grup varsa grup+grupsuz; elle sayı her şeyi ezer', () => {
  assert.equal(O.beklenenKartSayisi({ kitapDizinleri: ['book1', 'book2', 'book3'] }), 3);
  const setMenu = { kitaplar: [{ grup: 'A' }, { grup: 'A' }, { grup: '' }, { grup: 'B' }] };
  assert.equal(O.beklenenKartSayisi({ kitapDizinleri: ['book1', 'book2', 'book3', 'book4'], setMenu }), 3);
  assert.equal(O.beklenenKartSayisi({ kitapDizinleri: ['book1'], setMenu: { kitaplar: [{ grup: '' }] } }), 1);
  assert.equal(O.beklenenKartSayisi({ kitapDizinleri: ['book1', 'book2'], elle: 5 }), 5);
  assert.equal(O.beklenenKartSayisi({}), 0);
});

test('konsolSiniflandir: ERR_FILE_NOT_FOUND URL başına bir kez, JS hatası ayrı, K17 imzaları RED', () => {
  const k = O.konsolSiniflandir([
    { seviye: 'error', mesaj: '[kabul] net::ERR_FILE_NOT_FOUND: <script> file:///x/app.config.js' },
    { seviye: 'error', mesaj: 'net::ERR_FILE_NOT_FOUND file:///x/app.config.js' },
    { seviye: 'error', mesaj: 'Uncaught (in promise) ReferenceError: AppConfig is not defined' },
    { seviye: 'info', mesaj: 'Error: ENOENT, assets not found in /a/app.asar' },
    { seviye: 'error', mesaj: 'Uncaught (in promise) Error: ImWin32.dll dosyası okunamadı.' },
    { seviye: 'warning', mesaj: 'Electron Security Warning' },
  ]);
  assert.equal(k.dosyaBulunamadi.length, 1);
  assert.equal(k.jsHatalari.length, 2);
  assert.equal(k.redImzalari.length, 2);
});

const IYI_PIKSEL = { sapma: 0.2, koyu: 0.9, renk: 50000 };
const KIRIK_PIKSEL = { sapma: 0.017, koyu: 0.0004, renk: 31 };

test('asamaKarari: sağlam SET menüsü GEÇTİ', () => {
  const k = O.asamaKarari(
    { baslik: 'Super Monsters Grade 3 - Maarif', kartSayisi: 3, yukleniyor: [], piksel: IYI_PIKSEL },
    { asama: 'menu', setMi: true, beklenenKart: 3 },
  );
  assert.equal(k.durum, 'GECTI', k.sebepler.join('; '));
});

test('asamaKarari: 73768 ezilmiş kök (gerçek ölçüm) RED — dört ayrı sebep', () => {
  const k = O.asamaKarari(
    {
      baslik: 'Akıllı Tahta Uygulaması', kartSayisi: 0, beklenenSn: 46,
      yukleniyor: ['seçici:#loader-root.loading .lds-ellipsis'], piksel: KIRIK_PIKSEL,
    },
    { asama: 'menu', setMi: true, beklenenKart: 3 },
  );
  assert.equal(k.durum, 'RED');
  assert.equal(k.sebepler.length, 4);
});

test('asamaKarari (mutasyon): her kritik ölçüt TEK BAŞINA bozulunca RED', () => {
  const temel = { baslik: 'Set', kartSayisi: 3, yukleniyor: [], piksel: IYI_PIKSEL };
  const b = { asama: 'menu', setMi: true, beklenenKart: 3 };
  const mutantlar = {
    baslik: { ...temel, baslik: 'Akıllı Tahta Uygulaması' },
    eksikKart: { ...temel, kartSayisi: 2 },
    fazlaKart: { ...temel, kartSayisi: 4 },
    yukleniyor: { ...temel, yukleniyor: ['metin:Yükleniyor'] },
    beyazEkran: { ...temel, piksel: KIRIK_PIKSEL },
    yuklenemedi: { ...temel, yuklenemedi: 'ERR_FILE_NOT_FOUND (-6)' },
    cokme: { ...temel, cokme: 'crashed (11)' },
  };
  for (const [ad, olcum] of Object.entries(mutantlar)) {
    assert.equal(O.asamaKarari(olcum, b).durum, 'RED', `mutant ${ad} yakalanmadı`);
  }
});

test('asamaKarari: tek kitapta (SET değil) başlık ve kart aranmaz; okuyucuda sayfa izi aranır', () => {
  const b = { asama: 'kitap', setMi: false, beklenenKart: 0 };
  const olcum = { baslik: 'Akıllı Tahta Uygulaması', kartSayisi: 0, yukleniyor: [], piksel: IYI_PIKSEL, tuval: 4 };
  assert.equal(O.asamaKarari(olcum, b).durum, 'GECTI');
  const izsiz = O.asamaKarari({ ...olcum, tuval: 0 }, b);
  assert.equal(izsiz.durum, 'RED', 'renkli açılış ekranı sayfa izi olmadan geçmemeli');
  assert.match(izsiz.sebepler.join(' '), /sayfa çizmedi/);
});

test('asamaKarari: motor kitap rafı (kitaplik) — kapak şart, sapma yalnız burada gevşer', () => {
  // MEÇ 73714 gerçek raf ölçümü: beyaz zemin, sapma 0,0494 (< 0,05), sayfa izi yok.
  const raf = { sapma: 0.049403, koyu: 0.03, renk: 5000 };
  const olcum = { baslik: 'x', kartSayisi: 0, yukleniyor: [], piksel: raf, kapaklar: [{ x: 100, y: 200 }] };
  const b = { asama: 'kitaplik', setMi: false, beklenenKart: 0 };
  assert.equal(O.asamaKarari(olcum, b).durum, 'GECTI');
  const kapaksiz = O.asamaKarari({ ...olcum, kapaklar: [] }, b);
  assert.equal(kapaksiz.durum, 'RED');
  assert.match(kapaksiz.sebepler.join(' '), /kapak yok/);
  // Aynı piksel okuyucu aşamasında gevşemez: sapma eşiği ve sayfa izi aranır.
  const okuyucu = O.asamaKarari({ ...olcum, tuval: 1 }, { ...b, asama: 'kitap' });
  assert.equal(okuyucu.durum, 'RED');
  assert.match(okuyucu.sebepler.join(' '), /sapma/);
  // Rafta koyu/renk eşiği hâlâ aranır: beyaz ekran kapak olsa da geçmez.
  const beyaz = O.asamaKarari({ ...olcum, piksel: { sapma: 0, koyu: 0, renk: 1 } }, b);
  assert.equal(beyaz.durum, 'RED');
  assert.equal(O.pikselKarari(raf, { sapmaAranmaz: true }).gecti, true);
  assert.equal(O.pikselKarari(raf).gecti, false);
});

test('asamaKarari: ölçüm yoksa / ekran alınamadıysa ÖLÇÜLEMEDİ', () => {
  assert.equal(O.asamaKarari(null, { asama: 'menu', setMi: true, beklenenKart: 1 }).durum, 'OLCULEMEDI');
  assert.equal(O.asamaKarari({ olculemedi: 'koşum çöktü' }, { asama: 'menu', setMi: true, beklenenKart: 1 }).durum, 'OLCULEMEDI');
  const k = O.asamaKarari({ baslik: 'x', kartSayisi: 1, yukleniyor: [], piksel: null }, { asama: 'menu', setMi: true, beklenenKart: 1 });
  assert.equal(k.durum, 'OLCULEMEDI');
});

test('genelKarar: RED baskın, sonra ÖLÇÜLEMEDİ, boş liste ÖLÇÜLEMEDİ', () => {
  assert.equal(O.genelKarar([{ durum: 'GECTI' }, { durum: 'GECTI' }]), 'GECTI');
  assert.equal(O.genelKarar([{ durum: 'GECTI' }, { durum: 'OLCULEMEDI' }]), 'OLCULEMEDI');
  assert.equal(O.genelKarar([{ durum: 'OLCULEMEDI' }, { durum: 'RED' }]), 'RED');
  assert.equal(O.genelKarar([]), 'OLCULEMEDI');
  assert.equal(O.genelKarar([{ durum: 'GECTI' }, null]), 'OLCULEMEDI');
});

test('cikisKodu: 0 GEÇTİ, 1 RED, 3 ÖLÇÜLEMEDİ, bilinmeyen 3', () => {
  assert.equal(O.cikisKodu('GECTI'), 0);
  assert.equal(O.cikisKodu('RED'), 1);
  assert.equal(O.cikisKodu('OLCULEMEDI'), 3);
  assert.equal(O.cikisKodu('???'), 3);
});

test('odakKarari: önce=sonra korundu; kapı süreci öne geçerse ÇALINDI; kullanıcı geçişi ayrılır', () => {
  const once = { asn: 'ASN:0x0-0x6f06f', pid: 2285 };
  assert.equal(O.odakKarari({ once, sonra: { ...once }, kendiPidler: [999] }).esit, true);
  const c = O.odakKarari({ once, sonra: { ...once }, ornekler: [{ asn: 'ASN:0x0-0x1', pid: 999 }], kendiPidler: [999] });
  assert.equal(c.calindi, true);
  const k = O.odakKarari({ once, sonra: { asn: 'ASN:0x0-0x2', pid: 77 }, kendiPidler: [999] });
  assert.equal(k.esit, false);
  assert.equal(k.calindi, false);
  assert.match(k.ozet, /kullanıcı geçişi/);
});

test('asnAyikla / pidAyikla: lsappinfo çıktı biçimleri', () => {
  assert.equal(O.asnAyikla('ASN:0x0-0x75075:\n'), 'ASN:0x0-0x75075');
  assert.equal(O.asnAyikla(''), '');
  assert.equal(O.pidAyikla('"pid"=2449\n"LSDisplayName"="Code"'), 2449);
  assert.equal(O.pidAyikla('"pid"=[ NULL ]'), null);
});
