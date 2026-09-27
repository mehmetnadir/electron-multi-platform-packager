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

// Gerçek kaynak menü tanımlarından (kaynak-arsivi/<id>/build.zip → set-menu.json) kısaltılmış fikstürler.
const IYI_PIKSEL_MENU = { sapma: 0.2, koyu: 0.9, renk: 50000 };
const menuKitap = (ad, assetId, klasor) => ({ ad, assetId, grup: '', kapakVarMi: true, klasor });
// 45549 Shall We?! 7 Set: book5 = Grade-7-Games motor imzalı ama menü tanımında YOK (KV page:77u69 4 kitap).
const SW7 = {
  dizinler: ['book1', 'book2', 'book3', 'book4', 'book5'],
  setMenu: { setAdi: 'Shall We?! 7 Set', tema: 'webZSf425', kitaplar: [
    menuKitap('Reference Book', '25775', 'book1'), menuKitap('Workbook', '25777', 'book2'),
    menuKitap('Key Words', '25830', 'book3'), menuKitap('Test Book', '16031', 'book4'),
  ] },
};
// 45482 Shall We 8 Set: kimliği "0" olan Games kitabı (book4) menü tanımında VAR → kartı çizilir.
const SW8 = {
  dizinler: ['book1', 'book2', 'book3', 'book4'],
  setMenu: { setAdi: 'Shall We 8 Set', tema: 'webZSf425', kitaplar: [
    menuKitap('Reference Book', '44187', 'book1'), menuKitap('Workbook', '25772', 'book2'),
    menuKitap('Key Words', '44579', 'book3'), menuKitap('Games', 'Grade-8-Games', 'book4'),
  ] },
};

test('beklenenKartSayisi 45549: menü tanımı varsa beklenen = tanım (4), dizin sayısı (5) değil', () => {
  assert.equal(O.beklenenKartSayisi({ kitapDizinleri: SW7.dizinler, setMenu: SW7.setMenu }), 4);
  assert.deepEqual(O.menudeOlmayanKitapDizinleri({ kitapDizinleri: SW7.dizinler, setMenu: SW7.setMenu }), ['book5']);
  // Canlı ölçüm (kabul-kanit/45549-android-20260926-234443): 4 webz kartı → artık GEÇTİ.
  const k = O.asamaKarari(
    { baslik: 'Shall We?! 7 Set', kartSayisi: 4, yukleniyor: [], piksel: { sapma: 0.237, koyu: 0.963, renk: 261617 } },
    { asama: 'menu', setMi: true,
      beklenenKart: O.beklenenKartSayisi({ kitapDizinleri: SW7.dizinler, setMenu: SW7.setMenu }) },
  );
  assert.equal(k.durum, O.DURUM.GECTI, k.sebepler.join('; '));
});

test('beklenenKartSayisi 45482: kimliği "0" olan kitap menüdeyse kartı beklenir (4/4)', () => {
  assert.equal(O.beklenenKartSayisi({ kitapDizinleri: SW8.dizinler, setMenu: SW8.setMenu }), 4);
  assert.deepEqual(O.menudeOlmayanKitapDizinleri({ kitapDizinleri: SW8.dizinler, setMenu: SW8.setMenu }), []);
  // Menü tanımı 4 derken 3 kart çizilirse hâlâ RED (kart kaybı yakalanır).
  const k = O.asamaKarari(
    { baslik: 'Shall We 8 Set', kartSayisi: 3, yukleniyor: [], piksel: IYI_PIKSEL_MENU },
    { asama: 'menu', setMi: true, beklenenKart: 4 },
  );
  assert.equal(k.durum, O.DURUM.RED);
  assert.ok(k.sebepler.some((x) => /menü kartı 3 ≠ beklenen 4/.test(x)));
});

test('beklenenKartSayisi: boş menü tanımı dizin sayısına düşer; klasörsüz tanımda menü dışı yok', () => {
  assert.equal(O.beklenenKartSayisi({ kitapDizinleri: SW7.dizinler, setMenu: { kitaplar: [] } }), 5);
  assert.equal(O.beklenenKartSayisi({ kitapDizinleri: SW7.dizinler, setMenu: {} }), 5);
  assert.equal(O.beklenenKartSayisi({ kitapDizinleri: SW7.dizinler, setMenu: SW7.setMenu, elle: 5 }), 5);
  const klasorsuz = { kitaplar: [{ ad: 'A' }] };
  assert.deepEqual(O.menudeOlmayanKitapDizinleri({ kitapDizinleri: SW7.dizinler, setMenu: klasorsuz }), []);
  assert.deepEqual(O.menudeOlmayanKitapDizinleri({ kitapDizinleri: SW7.dizinler }), []);
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

// 27.09 45469/45472 android: aktivasyon kodlu seri. Gerçek ölçümler (kabul-kanit karar.json).
const AKT_DIYALOG_PIKSEL = { sapma: 0.180517, koyu: 0.853358, renk: 483 }; // 45472 cihaz: gri zemin + kod diyaloğu
const AKT_METIN = 'Aktivasyon Kitabı görüntülemek için aktivasyon kodunu giriniz. Aktivasyon Kodu AKTIVE ET';
const OFFLINE_YUKLENIYOR = { sapma: 0.019238, koyu: 0.000397, renk: 27 }; // 45469 ağ kapalı koşum

test('aktivasyonEkraniMi: kod diyaloğu metni tanınır, boş/başka metin tanınmaz', () => {
  assert.equal(O.aktivasyonEkraniMi({ gorunurMetin: AKT_METIN }), true);
  assert.equal(O.aktivasyonEkraniMi({ gorunurMetin: '' }), false);
  assert.equal(O.aktivasyonEkraniMi({ gorunurMetin: 'Unit 1 Reading' }), false);
  assert.equal(O.aktivasyonEkraniMi(null), false);
});

test('asamaKarari aktivasyon: kod diyaloğu okuyucu aşamasında GEÇTİ (sayfa izi aranmaz, ProBook ile aynı)', () => {
  const b = { asama: 'kitap', setMi: false, beklenenKart: 0, aktivasyon: true };
  const olcum = { baslik: 'Akıllı Tahta Uygulaması', kartSayisi: 0, yukleniyor: [], piksel: AKT_DIYALOG_PIKSEL,
    gorunurMetin: AKT_METIN };
  const k = O.asamaKarari(olcum, b);
  assert.equal(k.durum, 'GECTI', k.sebepler.join(' | '));
  assert.match(k.notlar.join(' '), /aktivasyon ekranı/);
});

test('asamaKarari aktivasyon (mutasyon): diyalog yoksa, yükleniyorsa ya da ekran beyazsa yine RED', () => {
  const b = { asama: 'kitap', setMi: false, beklenenKart: 0, aktivasyon: true };
  const iyi = { baslik: 'x', kartSayisi: 0, yukleniyor: [], piksel: AKT_DIYALOG_PIKSEL, gorunurMetin: AKT_METIN };
  // aktivasyon bayrağı olmadan aynı ekran eskisi gibi RED (sayfa izi yok)
  assert.equal(O.asamaKarari(iyi, { ...b, aktivasyon: false }).durum, 'RED');
  // bayrak var ama diyalog metni yok → sayfa izi aranır
  assert.match(O.asamaKarari({ ...iyi, gorunurMetin: '' }, b).sebepler.join(' '), /sayfa çizmedi/);
  // 45469 ağ kapalı koşumu: yükleniyor + beyaz → RED
  const offline = O.asamaKarari({ ...iyi, gorunurMetin: '', piksel: OFFLINE_YUKLENIYOR,
    yukleniyor: ['seçici:#loader-root.loading .lds-ellipsis'] }, b);
  assert.equal(offline.durum, 'RED');
  // metin var ama ekran beyaz → piksel yine düşürür
  assert.equal(O.asamaKarari({ ...iyi, piksel: OFFLINE_YUKLENIYOR }, b).durum, 'RED');
  // metin var ama hâlâ yükleniyor göstergesi → RED
  assert.equal(O.asamaKarari({ ...iyi, yukleniyor: ['seçici:.lds-ellipsis'] }, b).durum, 'RED');
});

// --- Review bulgusu 27.09 (b689ae7 sonrası): eski regex /aktivasyon\s+kod/i "Aktivasyon kodu
// geçersiz." gibi bir HATA ekranını da diyalog sayıyordu, asamaKarari sayfa izi/kapak
// denetimini atlayıp bozuk paketi GEÇTİ verebiliyordu. Aşağıdaki testler dar eşleşmeyi kilitler.

/** HTML kanıt dosyasından script/style dışlanmış, etiketsiz, boşluğu sıkıştırılmış görünür metin
 * (dom-yoklama.js'teki `document.body.innerText` yaklaşıklaması — tahmin değil). */
function kanitGorunurMetni(dosyaYolu) {
  const html = fs.readFileSync(dosyaYolu, 'utf8');
  const scriptsiz = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  return scriptsiz.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const KANIT_DOSYALARI = [
  path.join(process.env.HOME || '', '.empp-agent', 'kabul-kanit', '45469-android-20260927-052532', 'k4', 'kitap-cdp.dom.html'),
  path.join(process.env.HOME || '', '.empp-agent', 'kabul-kanit', '45472-android-20260927-072720', 'k4', 'kitap-cdp.dom.html'),
];

test('aktivasyonEkraniMi: iki gerçek kanıt dosyasının (45469, 45472) görünür metni → true', (t) => {
  let bulunan = 0;
  for (const yol of KANIT_DOSYALARI) {
    if (!fs.existsSync(yol)) continue;
    bulunan += 1;
    const metin = kanitGorunurMetni(yol);
    assert.match(metin, /aktivasyon\s+kodunu\s+giriniz/i, `kanıt metninde istem cümlesi yok: ${yol}`);
    assert.equal(O.aktivasyonEkraniMi({ gorunurMetin: metin }), true, `${yol} diyalog sayılmadı`);
    // hata muafiyeti kanıt metninde YOK — regresyon testi geçerli olsun diye doğrula
    assert.doesNotMatch(metin, O.AKTIVASYON_HATA_DESENI, `kanıt metninde beklenmedik hata sözcüğü: ${yol}`);
  }
  if (bulunan === 0) t.skip('kanıt dosyaları bu makinede yok (~/.empp-agent/kabul-kanit)');
});

test('aktivasyonEkraniMi: hata varyantları (aynı "aktivasyon kod" izini taşır) diyalog SAYILMAZ', () => {
  // Eski regex /aktivasyon\s+kod/i üçünde de true dönerdi (review bulgusu, 27.09).
  assert.equal(O.aktivasyonEkraniMi({ gorunurMetin: 'Aktivasyon kodu geçersiz.' }), false);
  assert.equal(O.aktivasyonEkraniMi({ gorunurMetin: 'Aktivasyon kodu servisine ulaşılamıyor, tekrar deneyin.' }), false);
  assert.equal(O.aktivasyonEkraniMi({ gorunurMetin: 'Aktivasyon kodunu giriniz. Kod hatalı.' }), false);
});

test('asamaKarari aktivasyon: hata ekranı metni artık diyalog SAYILMAZ → sayfa izi aranır → RED', () => {
  const b = { asama: 'kitap', setMi: false, beklenenKart: 0, aktivasyon: true };
  const hataOlcum = { baslik: 'x', kartSayisi: 0, yukleniyor: [], piksel: AKT_DIYALOG_PIKSEL,
    gorunurMetin: 'Aktivasyon kodu geçersiz.' };
  const k = O.asamaKarari(hataOlcum, b);
  assert.equal(k.durum, 'RED', k.sebepler.join(' | '));
  assert.match(k.sebepler.join(' '), /okuyucu sayfa çizmedi/);
  // aynı ölçüm gerçek diyalog metniyle → RED değil (mevcut davranış korunur, ProBook ile aynı)
  const iyiOlcum = { ...hataOlcum, gorunurMetin: AKT_METIN };
  assert.notEqual(O.asamaKarari(iyiOlcum, b).durum, 'RED');
});
