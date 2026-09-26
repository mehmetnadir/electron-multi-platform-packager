'use strict';

/**
 * GÜNCELLEME MANİFESTİ ÜRETİCİ TESTLERİ.
 *
 * DİSİPLİN: dosya sistemi HER TESTTE GERÇEK (gerçek `mkdtemp` geçici dizin).
 * Doğrulama iki katmanlıdır:
 *   1) Üretilen `manifest.json`/`surum.json` TÜKETİCİNİN KENDİ fonksiyonlarıyla
 *      (`kg.manifestiDogrula`, `kg.kabukGirdisiGecerliMi`, `kg.hedefYoluCoz`)
 *      okunup kabul ediliyor mu — kopya doğrulama kuralı YASAK.
 *   2) UÇTAN UCA: üretilen çıktı, `kg.guncellemeyiCalistir`'e dosya-sistemi
 *      tabanlı sahte bir `getir` ile verilir (gerçek HTTP sunucusu gerekmez —
 *      URL yolu doğrudan `<cikti>` dizininden okunur) ve gerçek bir hedef
 *      paket kopyasının güncellendiği ölçülür.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const uretici = require('./guncelleme-manifesti-uret');
const kabuk = require('../src/packaging/set-kabuk');
const kg = require('../src/runtime/kitap-guncelleyici');
const crypto = require('node:crypto');

/* TEST imza anahtarı (sözleşme G4) — PEM dosyası üreticinin CLI yolundan okunur. */
const { publicKey: TEST_ACIK_K, privateKey: TEST_OZEL } = crypto.generateKeyPairSync('ed25519');
const TEST_ACIK = TEST_ACIK_K.export({ type: 'spki', format: 'der' }).toString('base64');
function testAnahtarDosyasi() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'uretici-anahtar-'));
  const y = path.join(d, 'test.key');
  fs.writeFileSync(y, TEST_OZEL.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  return y;
}

function gecici(ad) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'empp-uretici-' + ad + '-'));
}

/** `{yol: icerik}` haritasından bir dizin ağacı kurar. */
function agacKur(kok, dosyalar) {
  for (const yol of Object.keys(dosyalar)) {
    const tam = path.join(kok, yol);
    fs.mkdirSync(path.dirname(tam), { recursive: true });
    fs.writeFileSync(tam, dosyalar[yol]);
  }
  return kok;
}

/** Ölçülen SM4 ağacına benzer, küçük bir örnek SET kökü. */
function ornekSetKoku() {
  return agacKur(gecici('set-koku'), {
    'index.html': '<html>MENU v1</html>',
    'set_app.config': 'ad=SM4',
    'empp-set.json': '{"setKimligi":"11811"}',           // envanterin kendisi — kabuk DEĞİL
    '.empp-set-guncelleme.json': '{"surum":"eski"}',      // durum dosyası — kabuk DEĞİL
    'assets2/menu.png': 'PNGVERISI',
    'core/logo.png': 'LOGOVERISI',
    'core/alt/ikon.png': 'IKONVERISI',
    'i18n/tr.json': '{"tamam":"Tamam"}',
    'book7/index.html': '<html>book7</html>',             // kitap içeriği — DOKUNULMAZ
    'book7/veri.txt': 'kitap verisi',
    'node_modules/paket/index.js': 'module.exports={}',   // artefakt — taranmaz
    'temp/cikti.bin': 'gecici build ciktisi',              // artefakt — taranmaz
    'fonts/custom.woff': 'FONTVERISI',                     // BİLİNMEYEN kök dizin
  });
}

/* ============================================================ argüman ayrıştırma */

test('argsAyristir: zorunlu argümanlar eksikse anlamlı hata fırlatır', () => {
  assert.throws(() => uretici.argsAyristir([]), /--set-koku zorunlu/);
  assert.throws(() => uretici.argsAyristir(['--set-koku', '/x']), /--set-kimligi zorunlu/);
  assert.throws(
    () => uretici.argsAyristir(['--set-koku', '/x', '--set-kimligi', '1']),
    /--cikti zorunlu/,
  );
  assert.throws(() => uretici.argsAyristir(['--bilinmeyen-bayrak']), /bilinmeyen argüman/);
});

test('argsAyristir: tüm bayrakları doğru okur', () => {
  const a = uretici.argsAyristir([
    '--set-koku', '/a/koku',
    '--set-kimligi', '11811',
    '--cikti', '/b/cikti',
    '--kitaplar', '[]',
    '--imza-anahtari', '/c/test.key',
  ]);
  assert.deepStrictEqual(a, {
    setKoku: '/a/koku', setKimligi: '11811', cikti: '/b/cikti', kitaplarJson: '[]',
    imzaAnahtari: '/c/test.key',
  });
});

/* ============================================================== kabuk taraması */

test('kabukVeKapsamTopla: book*/node_modules/temp içine HİÇ girilmez, kabuk beyaz listesi + kök dosyaları toplanır', async () => {
  const kok = ornekSetKoku();
  const { kabukYollari, kapsamDisi } = await uretici.kabukVeKapsamTopla(kok);

  assert.deepStrictEqual(kabukYollari, [
    'assets2/menu.png',
    'core/alt/ikon.png',
    'core/logo.png',
    'i18n/tr.json',
    'index.html',
    'set_app.config',
  ].sort());

  // Envanter + durum dosyası kabukta YOK; kitap/artefakt hiç sızmadı.
  assert.ok(!kabukYollari.includes('empp-set.json'));
  assert.ok(!kabukYollari.includes('.empp-set-guncelleme.json'));
  assert.ok(!kabukYollari.some((y) => y.startsWith('book7/')));
  assert.ok(!kabukYollari.some((y) => y.startsWith('node_modules/')));
  assert.ok(!kabukYollari.some((y) => y.startsWith('temp/')));

  // Bilinmeyen kök dizin (`fonts/`) gürültülü işaretlenir, sessizce yutulmaz.
  assert.deepStrictEqual(kapsamDisi, ['fonts']);

  // Sözleşmenin tanımıyla bire bir aynı — tahmin değil, set-kabuk.js'ten ölçüldü.
  for (const yol of kabukYollari) assert.ok(kabuk.kabukYoluMu(yol), yol + ' kabuk olmalıydı');
});

/* ============================================================= sha256 + boyut */

test('kabukGirdileriHesapla: sha256 ve boyut gerçek dosya içeriğinden hesaplanır', async () => {
  const kok = ornekSetKoku();
  const girdiler = await uretici.kabukGirdileriHesapla(kok, ['index.html', 'core/logo.png']);
  const beklenenIndex = kg.sha256(Buffer.from('<html>MENU v1</html>'));
  const beklenenLogo = kg.sha256(Buffer.from('LOGOVERISI'));

  const indexG = girdiler.find((g) => g.yol === 'index.html');
  const logoG = girdiler.find((g) => g.yol === 'core/logo.png');
  assert.strictEqual(indexG.sha256, beklenenIndex);
  assert.strictEqual(indexG.boyut, Buffer.byteLength('<html>MENU v1</html>'));
  assert.strictEqual(logoG.sha256, beklenenLogo);
  // Tüketicinin KENDİ geçerlilik kuralıyla da kabul ediliyor mu?
  for (const g of girdiler) assert.ok(kg.kabukGirdisiGecerliMi(g), JSON.stringify(g));
});

/* ------------------------------------------------------------- MUTASYON KANITI
 * (elle doğrulandı, kalıcı test DEĞİL): `kabukGirdileriHesapla` içindeki
 * `kg.sha256(veri)` çağrısı `kg.sha256(Buffer.concat([veri, Buffer.from('x')]))`
 * ile bozulup bu test tekrar koşturuldu → FAIL oldu (beklenen sha256 eşleşmedi).
 * Değişiklik hemen geri alındı. Kanıt: hash gerçekten dosya içeriğine bağlı,
 * sabit/placeholder bir değer DEĞİL.
 * ------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------ sürüm */

test('surumHesapla: aynı girdi aynı sürüm; yol/sha256/boyuttan biri değişirse farklı sürüm (deterministik)', () => {
  const a = [{ yol: 'index.html', sha256: 'a'.repeat(64), boyut: 10 }];
  const b = [{ yol: 'index.html', sha256: 'a'.repeat(64), boyut: 10 }];
  assert.strictEqual(uretici.surumHesapla(a), uretici.surumHesapla(b), 'aynı girdi aynı sürüm olmalı');

  // Girdi SIRASI sonucu etkilememeli (fonksiyon içeride sabit sıralar).
  const c = [
    { yol: 'z.txt', sha256: 'b'.repeat(64), boyut: 1 },
    { yol: 'a.txt', sha256: 'c'.repeat(64), boyut: 2 },
  ];
  const d = [c[1], c[0]];
  assert.strictEqual(uretici.surumHesapla(c), uretici.surumHesapla(d), 'sıra fark etmemeli');

  // Tek baytlık boyut farkı bile sürümü değiştirmeli.
  const e = [{ yol: 'index.html', sha256: 'a'.repeat(64), boyut: 11 }];
  assert.notStrictEqual(uretici.surumHesapla(a), uretici.surumHesapla(e), 'boyut farkı sürümü değiştirmeli');

  // sha256 tek karakter farkı da sürümü değiştirmeli.
  const f = [{ yol: 'index.html', sha256: 'b' + 'a'.repeat(63), boyut: 10 }];
  assert.notStrictEqual(uretici.surumHesapla(a), uretici.surumHesapla(f), 'sha256 farkı sürümü değiştirmeli');
});

/* --------------------------------------------------------------------- kitaplar */

test('kitaplariAyristir: --kitaplar verilmezse boş dizi, hiçbir şey reddedilmez', () => {
  const r = uretici.kitaplariAyristir(null);
  assert.deepStrictEqual(r, { kitaplar: [], reddedilen: 0 });
});

test('kitaplariAyristir: geçersiz girdi tüketicinin KENDİ kuralıyla reddedilir, geçerli kalır', () => {
  const gecerli = { dizin: 'book7', durum: 'ekle', kaynak: 'https://ornek/kaynak.zip', sha256: 'a'.repeat(64), boyut: 10 };
  const gecersiz = { dizin: 'book8', durum: 'ekle' }; // kaynak/sha256/boyut eksik
  const gunlukSatirlari = [];
  const r = uretici.kitaplariAyristir(JSON.stringify([gecerli, gecersiz]), (m) => gunlukSatirlari.push(m));
  assert.deepStrictEqual(r.kitaplar, [gecerli]);
  assert.strictEqual(r.reddedilen, 1);
  assert.ok(gunlukSatirlari.length === 1 && /geçersiz girdi reddedildi/.test(gunlukSatirlari[0]));
  // Kopya kural değil — aynı fonksiyonla tekrar denetlenince de aynı sonuç.
  assert.ok(kg.uyelikGirdisiGecerliMi(gecerli));
  assert.ok(!kg.uyelikGirdisiGecerliMi(gecersiz));
});

test('kitaplariAyristir: bozuk JSON anlamlı hata fırlatır', () => {
  assert.throws(() => uretici.kitaplariAyristir('{bozuk'), /geçersiz JSON/);
  assert.throws(() => uretici.kitaplariAyristir('{"dizi":"degil"}'), /JSON dizisi olmalı/);
});

/* ================================================== manifest — tüketiciyle doğrulama */

test('main: üretilen manifest.json/surum.json tüketicinin KENDİ doğrulama fonksiyonlarıyla geçerli sayılır', async () => {
  const setKoku = ornekSetKoku();
  const cikti = gecici('cikti-dogrulama');

  const rapor = await uretici.main([
    '--set-koku', setKoku,
    '--set-kimligi', '11811',
    '--cikti', cikti,
  ]);

  assert.strictEqual(rapor.setKimligi, '11811');
  assert.strictEqual(rapor.kabukDosyaSayisi, 6);
  assert.deepStrictEqual(rapor.kapsamDisiDallar, ['fonts']);

  const setDizini = path.join(cikti, 'set', '11811');
  const surumJson = JSON.parse(await fsp.readFile(path.join(setDizini, 'surum.json'), 'utf8'));
  const manifestHam = JSON.parse(await fsp.readFile(path.join(setDizini, 'manifest.json'), 'utf8'));

  assert.strictEqual(typeof surumJson.surum, 'string');
  assert.strictEqual(typeof surumJson.uretim, 'string');

  // TÜKETİCİNİN KENDİ fonksiyonuyla doğrula — kopya doğrulama mantığı yazma.
  const manifest = kg.manifestiDogrula(manifestHam);
  assert.ok(manifest, 'kg.manifestiDogrula reddetti: ' + JSON.stringify(manifestHam));
  assert.strictEqual(manifest.surum, surumJson.surum);
  for (const g of manifest.kabuk) {
    assert.ok(kg.kabukGirdisiGecerliMi(g), 'geçersiz kabuk girdisi: ' + JSON.stringify(g));
    assert.ok(kg.hedefYoluCoz('/paket/kok', g.yol), 'yol güvenli değil: ' + g.yol);
  }

  // `dosya/<yol>` altında her kabuk dosyasının birebir kopyası var mı?
  for (const g of manifest.kabuk) {
    const kopya = await fsp.readFile(path.join(setDizini, 'dosya', ...g.yol.split('/')));
    assert.strictEqual(kg.sha256(kopya), g.sha256);
    assert.strictEqual(kopya.length, g.boyut);
  }
});

/* ============================================================ UÇTAN UCA (K1-K18 disiplini) */

/**
 * `<cikti>` dizininden dosya okuyan, HTTP'siz sahte `getir`. `adres`in yol
 * kısmı doğrudan `<cikti>` altında aranır — tüketici hangi URL'i istediyse
 * (`/set/<id>/surum.json`, `/manifest.json`, `/dosya/<yol>`) üreticinin
 * yazdığı gerçek dosyaya düşer.
 */
function fsGetirKur(cikti) {
  const sayac = { yollar: [] };
  const getir = async (adres) => {
    const u = new URL(String(adres));
    const yol = decodeURIComponent(u.pathname);
    sayac.yollar.push(yol);
    const tam = path.join(cikti, yol);
    try {
      const govde = await fsp.readFile(tam);
      return { durum: 200, govde };
    } catch (e) {
      return { durum: 404, govde: Buffer.alloc(0) };
    }
  };
  return { getir, sayac };
}

// D-2 sonrası (2026-09-26, Şef kararı + Nadir onayı): bu üreticinin çıktısı YAYINA GİTMEZ —
// G manifestlerinin tek yazarı `tools/g-yayin` (Anahtar Zinciri imzası, `kanal:"G"`, G3 sürüm).
// G istemcisi (e07bc37) tüm kiplerde `kanal == "G"` + `setKimligi` + monoton G3 sürüm şartı koyar;
// bu eski üretici `kanal` yazmaz ve içerik-hash sürümü üretir → manifesti BİLEREK reddedilir.
// Olumlu uçtan uca yol: `tools/g-uctan-uca` (g-yayin → gerçek HTTPS → istemci, yerinde + örtü).
test('UÇTAN UCA (D-2 sonrası bu üretici yayına gitmiyor, olumlu yol tools/g-uctan-uca): eski üretici manifesti istemcide manifest-reddedildi:kanal-g-degil ile RED — hedef kopyaya dokunulmaz', async () => {
  const setKoku = ornekSetKoku();
  const cikti = gecici('cikti-e2e');

  const rapor = await uretici.main(['--set-koku', setKoku, '--set-kimligi', '11811', '--cikti', cikti,
    '--imza-anahtari', testAnahtarDosyasi()]);
  assert.strictEqual(rapor.imzali, true, 'manifest imzalanmalı (G4)');
  assert.strictEqual(typeof rapor.surum, 'string', 'üreticinin raporu sürüm sha256sini taşımalı');

  // Hedef: eski bir kurulum kopyası (index.html eski, kalanı aynı, kitap kendi verisiyle).
  const hedefKok = agacKur(gecici('hedef-paket'), {
    'index.html': '<html>MENU ESKI</html>',
    'set_app.config': 'ad=SM4',
    'assets2/menu.png': 'PNGVERISI',
    'core/logo.png': 'LOGOVERISI',
    'core/alt/ikon.png': 'IKONVERISI',
    'i18n/tr.json': '{"tamam":"Tamam"}',
    'book7/index.html': '<html>book7</html>',
    'book7/veri.txt': 'kitap verisi',
  });

  const { getir, sayac } = fsGetirKur(cikti);
  const r = await kg.guncellemeyiCalistir({
    taban: 'https://sahte-panel.invalid',
    set: { setKimligi: '11811', imza: { alg: 'ed25519', acikAnahtar: TEST_ACIK } },
    kok: hedefKok,
    getir,
    zamanAsimi: 4000,
  });

  assert.strictEqual(r.durum, 'atlandi', JSON.stringify(r));
  assert.strictEqual(r.sebep, 'manifest-reddedildi:kanal-g-degil', JSON.stringify(r));
  assert.strictEqual(r.kabukIndirilen, 0, 'reddedilen manifestten hiçbir kabuk dosyası inmemeli');
  assert.ok(!sayac.yollar.some((y) => y.includes('/dosya/')), 'reddedilen manifestin dosyası istenmemeli');
  assert.strictEqual(
    fs.readFileSync(path.join(hedefKok, 'index.html'), 'utf8'),
    '<html>MENU ESKI</html>',
    'reddedilen manifest hedef kopyaya DOKUNMAMALI',
  );
  assert.strictEqual(
    fs.readFileSync(path.join(hedefKok, 'book7/veri.txt'), 'utf8'),
    'kitap verisi',
    'kitap içeriğine bu kanaldan DOKUNULMAZ',
  );
  assert.ok(!fs.existsSync(path.join(hedefKok, kg.DAMGA_ADI)), 'reddedilen manifest damga yazmamalı');
});

test('G4: --imza-anahtari ile manifest.json.sig yazılır, tüketicinin doğrulayıcısı kabul eder', async () => {
  const setKoku = ornekSetKoku();
  const cikti = gecici('cikti-imza');
  const r = await uretici.main(['--set-koku', setKoku, '--set-kimligi', '11811', '--cikti', cikti,
    '--imza-anahtari', testAnahtarDosyasi()]);
  const dizin = path.join(cikti, 'set', '11811');
  const govde = fs.readFileSync(path.join(dizin, 'manifest.json'));
  const imza = fs.readFileSync(path.join(dizin, 'manifest.json' + kg.IMZA_UZANTI), 'utf8');
  assert.strictEqual(r.imzali, true);
  assert.strictEqual(kg.manifestImzasiGecerliMi(govde, imza, TEST_ACIK), true);
  const bozuk = Buffer.from(govde); bozuk[5] ^= 1;
  assert.strictEqual(kg.manifestImzasiGecerliMi(bozuk, imza, TEST_ACIK), false);
});

test('G4: anahtarsız üretim imzasız manifest yazar ve UYARIR; RSA anahtarı reddedilir', async () => {
  const setKoku = ornekSetKoku();
  const cikti = gecici('cikti-imzasiz');
  const satirlar = [];
  const r = await uretici.main(['--set-koku', setKoku, '--set-kimligi', '11811', '--cikti', cikti],
    { gunluk: (m) => satirlar.push(m) });
  assert.strictEqual(r.imzali, false);
  assert.ok(!fs.existsSync(path.join(cikti, 'set', '11811', 'manifest.json' + kg.IMZA_UZANTI)));
  assert.ok(satirlar.some((m) => /İMZASIZ/.test(m)));
  const { privateKey: rsa } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  const y = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'uretici-rsa-')), 'rsa.key');
  fs.writeFileSync(y, rsa.export({ type: 'pkcs8', format: 'pem' }));
  await assert.rejects(uretici.main(['--set-koku', setKoku, '--set-kimligi', '11811',
    '--cikti', gecici('cikti-rsa'), '--imza-anahtari', y]), /ed25519 değil/);
});
