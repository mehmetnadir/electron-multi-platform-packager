'use strict';

/**
 * ÜRETİM ÖN KONTROLÜ — testler.
 *
 * KURAL: her kontrolün HEM GEÇTİ HEM KALDI yolu ölçülür. Tek yönlü test, kapının
 * kendisini ölçmez — "hep yeşil" bir kapı kapı değildir (bkz. bekçi güven gate'i).
 * Saf katman I/O yapmadığı için testler gerçek sunucu/VM/disk GEREKTİRMEZ.
 */

const test = require('node:test');
const assert = require('node:assert');
const k = require('./uretim-on-kontrol');

const { GECTI, KALDI, UYARI } = k;

// ——— yardımcı: taze bir sağlık cevabı ————————————————————————————————
const BAS = '2026-09-21T10:00:00.000Z';
const BAS_MS = Date.parse(BAS);
function saglik(uzerine = {}) {
  return Object.assign({
    status: 'Sunucu çalışıyor',
    commit: '7031658',
    startedAt: BAS,
    pid: 61053,
    bayatMi: false,
    bayatSebepleri: [],
    kapilar: {
      sayfaWebp: true, setMenu: false, pardusKabul: false,
      surumNormallestir: true, yama: false, setGuncelleme: true, windowsAsarsiz: true,
    },
  }, uzerine);
}
/** süreçten ESKİ (yani sorunsuz) dosya damgaları */
const ESKI_DAMGALAR = [
  { yol: 'src/server/app.js', mtimeMs: BAS_MS - 60_000 },
  { yol: 'src/packaging/packagingService.js', mtimeMs: BAS_MS - 5_000 },
];

// =========================================================================
// 1. paketleyici-canli
// =========================================================================

test('1a paketleyici-canli: sağlık cevabı kimlik taşıyorsa GEÇTİ', () => {
  const r = k.kontrolPaketleyiciCanli({ saglik: saglik(), hata: null });
  assert.strictEqual(r.durum, GECTI);
  assert.strictEqual(r.olcum.commit, '7031658');
});

test('1b paketleyici-canli: uç cevap vermiyorsa KALDI + sebep taşınır', () => {
  const r = k.kontrolPaketleyiciCanli({ saglik: null, hata: 'ECONNREFUSED' });
  assert.strictEqual(r.durum, KALDI);
  assert.match(r.sebep, /ECONNREFUSED/);
});

test('1c paketleyici-canli: canlı ama `commit` YOKSA KALDI (canlılık kimlik değildir)', () => {
  const s = saglik();
  delete s.commit;
  const r = k.kontrolPaketleyiciCanli({ saglik: s, hata: null });
  assert.strictEqual(r.durum, KALDI);
  assert.match(r.sebep, /commit/);
});

// =========================================================================
// 2. surec-tazeligi — üç bağımsız kanıt
// =========================================================================

test('2a surec-tazeligi: üç kanıt da temizse GEÇTİ', () => {
  const r = k.kontrolSurecTazeligi({ saglik: saglik(), damgalar: ESKI_DAMGALAR });
  assert.strictEqual(r.durum, GECTI);
});

test('2b surec-tazeligi: bayatMi:true → KALDI, sebepler aktarılır', () => {
  const r = k.kontrolSurecTazeligi({
    saglik: saglik({ bayatMi: true, bayatSebepleri: ['set-kimligi.js: bellek ≠ disk'] }),
    damgalar: ESKI_DAMGALAR,
  });
  assert.strictEqual(r.durum, KALDI);
  assert.match(r.sebep, /bellek ≠ disk/);
});

test('2c surec-tazeligi: kapilar.windowsAsarsiz ALANI YOKSA KALDI (kapı listesi eski)', () => {
  const s = saglik();
  delete s.kapilar.windowsAsarsiz;
  const r = k.kontrolSurecTazeligi({ saglik: s, damgalar: ESKI_DAMGALAR });
  assert.strictEqual(r.durum, KALDI);
  assert.match(r.sebep, /windowsAsarsiz/);
});

test('2d surec-tazeligi: windowsAsarsiz:false DEĞER olarak varsa bayatlık DEĞİLDİR', () => {
  // Kapının kapalı olması bir KARAR'dır; alanın yokluğu ise SÜRÜM bayatlığıdır.
  // İkisi karıştırılırsa bilinçli bir geri dönüş "bayat süreç" sanılır.
  const s = saglik();
  s.kapilar.windowsAsarsiz = false;
  const r = k.kontrolSurecTazeligi({ saglik: s, damgalar: ESKI_DAMGALAR });
  assert.strictEqual(r.durum, GECTI);
});

test('2e surec-tazeligi: kritik dosya süreçten YENİYSE KALDI (bayatMi kör noktası)', () => {
  const r = k.kontrolSurecTazeligi({
    saglik: saglik(),                      // bayatMi:false — yani kör nokta
    damgalar: [{ yol: 'src/packaging/windows-asarsiz.js', mtimeMs: BAS_MS + 900_000 }],
  });
  assert.strictEqual(r.durum, KALDI);
  assert.match(r.sebep, /windows-asarsiz\.js/);
  assert.match(r.sebep, /SONRA/);
});

test('2f surec-tazeligi: mtime okunamadıysa GEÇTİ sayılmaz (ölçülemedi ≠ temiz)', () => {
  const r = k.kontrolSurecTazeligi({
    saglik: saglik(),
    damgalar: [{ yol: 'src/server/app.js', mtimeMs: null }],
  });
  assert.strictEqual(r.durum, KALDI);
  assert.match(r.sebep, /mtime okunamadı/);
});

test('2g surec-tazeligi: sağlık cevabı yoksa KALDI', () => {
  const r = k.kontrolSurecTazeligi({ saglik: null, damgalar: ESKI_DAMGALAR });
  assert.strictEqual(r.durum, KALDI);
});

// =========================================================================
// 3. kaynak-zip
// =========================================================================

test('3a kaynak-zip: boyut BİREBİR eşleşiyorsa GEÇTİ', () => {
  const r = k.kontrolKaynakZip({ varMi: true, boyut: 1433105846, yol: '/x/sm4.zip', beklenen: 1433105846 });
  assert.strictEqual(r.durum, GECTI);
});

test('3b kaynak-zip: dosya yoksa KALDI', () => {
  const r = k.kontrolKaynakZip({ varMi: false, boyut: null, yol: '/x/sm4.zip', beklenen: 1433105846 });
  assert.strictEqual(r.durum, KALDI);
});

test('3c kaynak-zip: tek bayt bile eksikse KALDI (yarım indirme)', () => {
  const r = k.kontrolKaynakZip({ varMi: true, boyut: 1433105845, yol: '/x/sm4.zip', beklenen: 1433105846 });
  assert.strictEqual(r.durum, KALDI);
  assert.match(r.sebep, /boyut uyuşmuyor/);
});

// =========================================================================
// 4. disk-yeri
// =========================================================================

test('4a disk-yeri: boş alan gerekenden fazlaysa GEÇTİ', () => {
  const r = k.kontrolDisk({ bosBayt: 130 * 1024 ** 3, gerekenBayt: 20 * 1024 ** 3, birim: '/' });
  assert.strictEqual(r.durum, GECTI);
});

test('4b disk-yeri: boş alan yetmiyorsa KALDI', () => {
  const r = k.kontrolDisk({ bosBayt: 3 * 1024 ** 3, gerekenBayt: 20 * 1024 ** 3, birim: '/' });
  assert.strictEqual(r.durum, KALDI);
  assert.match(r.sebep, /ENOSPC/);
});

test('4c disk-yeri: ölçülemediyse KALDI (bilinmeyen alan GEÇTİ değildir)', () => {
  const r = k.kontrolDisk({ bosBayt: null, gerekenBayt: 20 * 1024 ** 3, birim: '/' });
  assert.strictEqual(r.durum, KALDI);
});

// =========================================================================
// 5. windows-kasa şeridi
// =========================================================================

test('5a windows-kasa: ayakta + şerit akıyorsa GEÇTİ', () => {
  const r = k.kontrolKasaSeridi({ durum: { durum: 'ayakta', yasSn: 2, serit: 'akiyor' }, hata: null });
  assert.strictEqual(r.durum, GECTI);
});

test('5b windows-kasa: izleyici ölüyse KALDI + makine hatırlatması', () => {
  const r = k.kontrolKasaSeridi({
    durum: { durum: 'olu', yasSn: 7111, sebep: 'son kalp 7111 sn önce (eşik 30)' }, hata: null,
  });
  assert.strictEqual(r.durum, KALDI);
  assert.match(r.sebep, /7111/);
});

test('5c windows-kasa: şerit TIKALI ise KALDI ("online ama ölü")', () => {
  const r = k.kontrolKasaSeridi({
    durum: { durum: 'ayakta', yasSn: 3, serit: 'tikali', seritYasSn: 980, seritGorevi: '20260921-102107' },
    hata: null,
  });
  assert.strictEqual(r.durum, KALDI);
  assert.match(r.sebep, /TIKALI/);
});

test('5d windows-kasa: şerit BİLİNMİYOR ise UYARI (eski guest izleyici, durdurmaz)', () => {
  const r = k.kontrolKasaSeridi({ durum: { durum: 'ayakta', yasSn: 2, serit: 'bilinmiyor' }, hata: null });
  assert.strictEqual(r.durum, UYARI);
});

test('5e windows-kasa: komut çıktısı okunamadıysa KALDI', () => {
  const r = k.kontrolKasaSeridi({ durum: null, hata: 'çıktı çözülemedi' });
  assert.strictEqual(r.durum, KALDI);
  assert.match(r.sebep, /--makine windows-kasa/);
});

// =========================================================================
// 6. logo
// =========================================================================

test('6a logo: logoId listede varsa GEÇTİ', () => {
  const r = k.kontrolLogo({ logolar: [{ id: k.LOGO_ID }, { id: 'baska' }], logoId: k.LOGO_ID, hata: null });
  assert.strictEqual(r.durum, GECTI);
});

test('6b logo: logoId listede yoksa KALDI (paket logosuz doğar)', () => {
  const r = k.kontrolLogo({ logolar: [{ id: 'baska' }], logoId: k.LOGO_ID, hata: null });
  assert.strictEqual(r.durum, KALDI);
});

test('6c logo: liste okunamadıysa KALDI', () => {
  const r = k.kontrolLogo({ logolar: null, logoId: k.LOGO_ID, hata: 'HTTP 500' });
  assert.strictEqual(r.durum, KALDI);
  assert.match(r.sebep, /HTTP 500/);
});

// =========================================================================
// 7. 7z
// =========================================================================

test('7a 7z: bulunduysa GEÇTİ', () => {
  assert.strictEqual(k.kontrol7z({ yol: '/usr/local/bin/7z' }).durum, GECTI);
});

test('7b 7z: yoksa KALDI (kapı ÖLÇÜLEMEDİ döner)', () => {
  const r = k.kontrol7z({ yol: null });
  assert.strictEqual(r.durum, KALDI);
  assert.match(r.sebep, /ÖLÇÜLEMEDİ/);
});

// =========================================================================
// 8. teslim dizini
// =========================================================================

test('8a teslim-dizini: yazılabilirse GEÇTİ', () => {
  assert.strictEqual(k.kontrolTeslimDizini({ yol: '/x', yazilabilir: true, sebep: null }).durum, GECTI);
});

test('8b teslim-dizini: yazılamıyorsa KALDI', () => {
  const r = k.kontrolTeslimDizini({ yol: '/x', yazilabilir: false, sebep: 'EACCES' });
  assert.strictEqual(r.durum, KALDI);
  assert.match(r.sebep, /EACCES/);
});

// =========================================================================
// 9. nihai karar
// =========================================================================

test('9a karar: tek KALDI bile çıkış kodunu 1 yapar', () => {
  const c = k.karar([{ durum: GECTI }, { durum: GECTI }, { durum: KALDI }]);
  assert.strictEqual(c.cikisKodu, 1);
  assert.strictEqual(c.uretimeBaslanabilir, false);
});

test('9b karar: UYARI çıkış kodunu DEĞİŞTİRMEZ', () => {
  const c = k.karar([{ durum: GECTI }, { durum: UYARI }]);
  assert.strictEqual(c.cikisKodu, 0);
  assert.strictEqual(c.uyari, 1);
  assert.strictEqual(c.uretimeBaslanabilir, true);
});

test('9c karar: boş liste 0 döner ama sayaçlar sıfırdır', () => {
  const c = k.karar([]);
  assert.strictEqual(c.cikisKodu, 0);
  assert.strictEqual(c.gecti, 0);
});

// =========================================================================
// 10. argüman çözümü
// =========================================================================

test('10a argumanCoz: --json ve --disk-gb okunur', () => {
  const s = k.argumanCoz(['--json', '--disk-gb', '30']);
  assert.strictEqual(s.json, true);
  assert.strictEqual(s.diskGb, 30);
});

test('10b argumanCoz: geçersiz --disk-gb varsayılana düşer', () => {
  assert.strictEqual(k.argumanCoz(['--disk-gb', 'abc']).diskGb, k.VARSAYILAN_DISK_GB);
});

// =========================================================================
// 11. sabitler defterle hizalı mı (drift kapısı)
// =========================================================================

test('11a sabitler: kaynak ZIP boyutu ve kritik dosya listesi beklenen değerde', () => {
  assert.strictEqual(k.KAYNAK_ZIP_BAYT, 1433105846);
  assert.ok(k.KRITIK_DOSYALAR.includes('src/packaging/windows-asarsiz.js'));
  assert.ok(k.KRITIK_DOSYALAR.includes('src/platforms/windows/WindowsPackagingService.js'));
});
