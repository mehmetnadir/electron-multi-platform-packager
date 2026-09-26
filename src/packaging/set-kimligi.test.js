'use strict';
/**
 * SET kimliği / kabuk envanteri testleri.
 *
 * `GERİLEME:` önekli testler regresyon kapılarıdır — kırılırsa DUR, körü körüne
 * geri alma (proje kuralı, CLAUDE.md §SET know-how).
 *
 * GERÇEK VERİ: `uploads/579b35ed-…` altındaki Super Monsters 4 Set ölçümü
 * (book1…book6, kökte index.html + set_app.config + assets2/52 dosya).
 * Ölçüm testte tmpdir'de BİREBİR yeniden kurulur — gerçek ağaç yoksa test yine koşar.
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const m = require('./set-kimligi');

/** SM4 Set'in ÖLÇÜLMÜŞ yapısını tmpdir'de kurar. */
async function sahteSm4Set() {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'set-kimligi-'));
  await fs.writeFile(path.join(kok, 'index.html'), '<html>menü</html>', 'utf8');
  await fs.writeFile(path.join(kok, 'set_app.config'), 'var setConfig={};', 'utf8');
  await fs.ensureDir(path.join(kok, 'assets2'));
  for (const ad of ['styles.css', 'book1-button.png', 'world.apng']) {
    await fs.writeFile(path.join(kok, 'assets2', ad), 'x', 'utf8');
  }
  await fs.ensureDir(path.join(kok, 'assets2', 'alt'));
  await fs.writeFile(path.join(kok, 'assets2', 'alt', 'derin.js'), 'x', 'utf8');
  // book1-book4: sayısal assets kimliği olan tam kitaplar (eski tasarımın kaynağı)
  for (const [ad, id] of [['book1', '45516'], ['book2', '25788'], ['book3', '25175'], ['book4', '11810']]) {
    await fs.ensureDir(path.join(kok, ad, 'assets', id));
    await fs.writeFile(path.join(kok, ad, 'index.html'), '<html>kitap</html>', 'utf8');
    await fs.writeFile(path.join(kok, ad, 'app.config.js'), 'var c={};', 'utf8');
  }
  // book5: assets/g (sayısal DEĞİL) — eski tasarımda kimliksizdi
  await fs.ensureDir(path.join(kok, 'book5', 'assets', 'g'));
  await fs.writeFile(path.join(kok, 'book5', 'index.html'), '<html>kitap</html>', 'utf8');
  await fs.writeFile(path.join(kok, 'book5', 'app.config.js'), 'var c={};', 'utf8');
  // book6: TEK PDF — motor imzası YOK
  await fs.ensureDir(path.join(kok, 'book6'));
  await fs.writeFile(path.join(kok, 'book6', 'SUPER-MONSTERS-4-Teachers-Pack.pdf'), '%PDF', 'utf8');
  // 2026-09-21 DÜZELTMESİ: gerçek ağacın kabuğu `assets2/`den ibaret DEĞİL —
  // `index.html` kökteki hash'li paketleri ve `core/` + `i18n/` altını yükler.
  // Eski fixture bu dosyaları hiç kurmadığı için yanlış tanım testte GÖRÜNMÜYORDU.
  await fs.writeFile(path.join(kok, 'a8f43f74c72b65a3dd05.main.js'), 'x', 'utf8');
  await fs.writeFile(path.join(kok, '43e23fce2b7009474555a77.js'), 'x', 'utf8');
  await fs.writeFile(path.join(kok, 'empp-fs-shim.js'), 'x', 'utf8');
  await fs.ensureDir(path.join(kok, 'core'));
  await fs.writeFile(path.join(kok, 'core', 'kurumLogo.png'), 'x', 'utf8');
  await fs.ensureDir(path.join(kok, 'i18n'));
  await fs.writeFile(path.join(kok, 'i18n', 'tr.js'), 'x', 'utf8');
  // Kabuk DIŞI artefaktlar — gerçek ağaçta ikisi de vardı (temp/ 1,8 GB).
  await fs.ensureDir(path.join(kok, 'node_modules', 'electron'));
  await fs.writeFile(path.join(kok, 'node_modules', 'electron', 'package.json'), '{}', 'utf8');
  await fs.ensureDir(path.join(kok, 'temp', 'macos'));
  await fs.writeFile(path.join(kok, 'temp', 'macos', 'app.icns'), 'x', 'utf8');
  return kok;
}

// ─────────────────────────── kimlik ───────────────────────────

test('setKimligi VERİLİRSE haritada aynen durur, kaynağı "acik"', () => {
  const h = m.haritaUret({ setKimligi: '45516', taban: 'https://x/y', damga: 0 });
  assert.strictEqual(h.setKimligi, '45516');
  assert.strictEqual(h.setKimligiKaynagi, 'acik');
  assert.strictEqual(h.sebep, null);
});

test('setKimligi VERİLMEZSE null + sebep — kanal kapalı, tahmin YOK', () => {
  const h = m.haritaUret({ taban: 'https://x/y', damga: 0 });
  assert.strictEqual(h.setKimligi, null);
  assert.strictEqual(h.setKimligiKaynagi, 'yok');
  assert.match(h.sebep, /setKimligi verilmedi/);
});

test('GERİLEME: kimliksiz pakette dosya YİNE yazılır (sessizce düşmez)', async () => {
  const kok = await sahteSm4Set();
  const r = await m.paketeYaz(kok, {});                 // kimlik verilmedi
  assert.strictEqual(r.yazildi, true);
  const okunan = JSON.parse(await fs.readFile(path.join(kok, m.DOSYA_ADI), 'utf8'));
  assert.strictEqual(okunan.setKimligi, null);
  assert.ok(okunan.sebep && okunan.sebep.length > 0, 'sebep yazılmamış');
  assert.strictEqual(okunan.kitapSayisi, 6, 'kimlik yok diye üyelik listesi düşmüş');
});

test('geçersiz TİP (sayı/obje/dizi/boolean) → null + sebep, istek düşürülmez', () => {
  for (const kotu of [42, {}, [], true, 0]) {
    const h = m.haritaUret({ setKimligi: kotu, damga: 0 });
    assert.strictEqual(h.setKimligi, null, JSON.stringify(kotu));
    assert.match(h.sebep, /geçersiz/);
  }
});

test('boş / yalnız boşluk string → null + sebep', () => {
  for (const kotu of ['', '   ', '\t\n']) {
    const h = m.haritaUret({ setKimligi: kotu, damga: 0 });
    assert.strictEqual(h.setKimligi, null, JSON.stringify(kotu));
    assert.match(h.sebep, /geçersiz/);
  }
});

test('GERİLEME: yol kaçışı taşıyan kimlik reddedilir (URL yolu güvenliği)', () => {
  for (const kotu of ['..', '../../etc/passwd', 'a/b', 'a\\b', 'iki kelime', 'x'.repeat(65), '.']) {
    assert.strictEqual(m.kimlikGecerliMi(kotu), false, kotu);
    assert.strictEqual(m.haritaUret({ setKimligi: kotu, damga: 0 }).setKimligi, null, kotu);
  }
});

test('geçerli kimlik biçimleri kabul edilir, baştaki/sondaki boşluk kırpılır', () => {
  for (const iyi of ['45516', 'SET-sm4-2026', 'yds.sm4:2026', 'A_B-c.d']) {
    assert.strictEqual(m.kimlikGecerliMi(iyi), true, iyi);
  }
  assert.strictEqual(m.setKimligiCoz('  45516  ').setKimligi, '45516');
});

test('setKimligiCoz: null ve undefined AYNI şekilde "verilmedi" sayılır', () => {
  for (const yok of [null, undefined]) {
    const c = m.setKimligiCoz(yok);
    assert.strictEqual(c.kaynak, 'yok');
    assert.match(c.sebep, /verilmedi/);
  }
});

test('dışarıdan gelen ek sebep kimlik sebebini EZMEZ, birleşir', () => {
  const h = m.haritaUret({ sebep: 'guncellemeTabani geçersiz — yok sayıldı', damga: 0 });
  assert.match(h.sebep, /setKimligi verilmedi/);
  assert.match(h.sebep, /guncellemeTabani geçersiz/);
});

// ─────────────────────────── kabuk ───────────────────────────

test('kabuk = KÖK DOSYALARI + assets2/ + core/ + i18n/ (tanım: set-kabuk.js)', () => {
  const k = m.kabukDosyalariTopla([
    'index.html', 'set_app.config', 'assets2/styles.css', 'assets2/alt/derin.js',
    'a8f43f74c72b65a3dd05.main.js', 'core/icons/a.svg', 'i18n/tr.js', 'electron.js',
  ]);
  assert.deepStrictEqual(k, [
    'a8f43f74c72b65a3dd05.main.js', 'assets2/alt/derin.js', 'assets2/styles.css',
    'core/icons/a.svg', 'electron.js', 'i18n/tr.js', 'index.html', 'set_app.config',
  ]);
});

test('GERİLEME (2026-09-21): kökteki hash\'li paketler kabuğun İÇİNDEDİR', () => {
  // Eski tanım bunları dışarıda bırakıyordu: kanal yeni bir index.html gönderdiğinde
  // o index yeni hash'li paketlere bakar, paketler hiç inmez → set BOŞ EKRANA açılır.
  const k = m.kabukDosyalariTopla([
    '016270bb2d1096fc39b4.151.css', '14a3e0f44538395536ff.540.js',
    '6e964d06f8fb224c9b46.907.js.LICENSE.txt', 'favicon.ico',
  ]);
  assert.strictEqual(k.length, 4, 'hash\'li webpack parçaları kabuk dışında kaldı');
});

test('GERİLEME: KİTAP İÇİ dosyalar kabuğa SIZMAZ (kitabın kendi kanalı)', () => {
  const k = m.kabukDosyalariTopla([
    'index.html', 'book1/index.html', 'book1/app.config.js', 'book1/assets/45516/p1.png',
    'book2/assets2/x.png', 'book6/rehber.pdf',
  ]);
  assert.deepStrictEqual(k, ['index.html'], 'kitap içeriği set kanalına sızdı');
});

test('kabukta yol kaçışı (..) ve mutlak yol reddedilir', () => {
  const k = m.kabukDosyalariTopla([
    '../index.html', 'assets2/../../gizli', '/index.html', './index.html', 'assets2\\win.png',
  ]);
  assert.deepStrictEqual(k, ['assets2/win.png', 'index.html']);
});

test('kabuk listesi tekilleştirilir ve sıralıdır', () => {
  const k = m.kabukDosyalariTopla(['assets2/b.png', 'index.html', 'assets2/b.png', 'assets2/a.png']);
  assert.deepStrictEqual(k, ['assets2/a.png', 'assets2/b.png', 'index.html']);
});

test('kök `assets/` (kitap deposu) kabuk DEĞİLDİR — beyaz listede yok', () => {
  assert.deepStrictEqual(m.kabukDosyalariTopla(['assets/45516/p1.png', 'assets2/ok.png']), ['assets2/ok.png']);
});

test('GERİLEME: `node_modules/` ve `temp/` kabuğa GİRMEZ (artefakt, 1,8 GB tuzağı)', () => {
  assert.deepStrictEqual(m.kabukDosyalariTopla([
    'node_modules/electron/package.json', 'temp/macos/app.icns', 'index.html',
  ]), ['index.html']);
});

test('bozuk girdi (null/sayı/dizi değil) kabuğu çökertmez', () => {
  assert.deepStrictEqual(m.kabukDosyalariTopla(null), []);
  assert.deepStrictEqual(m.kabukDosyalariTopla(['index.html', null, 42, '']), ['index.html']);
});

// ─────────────────────────── üyelik ───────────────────────────

test('üyelik listesi ^book\\d+$ ile süzülür, sayısal sıralanır', () => {
  const k = m.kitapDizinleriTopla(['book10', 'book2', 'book1', 'assets2', 'fasikul1', 'book', 'bookA']);
  assert.deepStrictEqual(k, ['book1', 'book2', 'book10']);
});

test('GERİLEME: içeriğe BAKILMADAN üyelik — tek PDF taşıyan book6 de üyedir', async () => {
  const kok = await sahteSm4Set();
  const kitaplar = await m.kitapDizinleriBul(kok);
  assert.ok(kitaplar.includes('book6'), 'motor imzası yok diye book6 üyelikten düştü');
  assert.ok(kitaplar.includes('book5'), 'assets/g (sayısal değil) yüzünden book5 düştü');
});

test('üyelik listesi tekilleştirilir, dizin olmayan girdiler düşer', () => {
  assert.deepStrictEqual(m.kitapDizinleriTopla(['book1', 'book1', null, 7]), ['book1']);
});

// ─────────────────────────── taban ───────────────────────────

test('taban önceliği: istek > env > gömülü varsayılan', () => {
  const env = { EMPP_GUNCELLEME_TABANI: 'https://env/uc' };
  assert.deepStrictEqual(m.tabanCoz(env, 'https://istek/uc'), { taban: 'https://istek/uc', kaynak: 'istek' });
  assert.deepStrictEqual(m.tabanCoz(env, null), { taban: 'https://env/uc', kaynak: 'env' });
  assert.deepStrictEqual(m.tabanCoz({}, null), { taban: m.VARSAYILAN_TABAN, kaynak: 'varsayilan' });
});

test('tabanın sonundaki eğik çizgiler kırpılır, boş değer yok sayılır', () => {
  assert.strictEqual(m.tabanCoz({}, 'https://x/y///').taban, 'https://x/y');
  assert.strictEqual(m.tabanCoz({ EMPP_GUNCELLEME_TABANI: '   ' }, '  ').kaynak, 'varsayilan');
});

test('GERİLEME: gömülü varsayılan taban ÇÖZÜLEMEYEN bir adrestir (sır/canlı host değil)', () => {
  assert.match(m.VARSAYILAN_TABAN, /^https:\/\/[^/]+\.invalid\//);
  assert.doesNotMatch(m.VARSAYILAN_TABAN, /token|key|secret|password|@/i);
});

// ─────────────────────────── şema / damga / kapı ───────────────────────────

test('JSON şeması: beklenen alanlar ve tipleri', () => {
  const h = m.haritaUret({
    setKimligi: '45516', taban: { taban: 'https://x/y', kaynak: 'env' }, damga: 0,
    kabukDosyalari: ['index.html', 'assets2/a.png'], kitapDizinleri: ['book1', 'book2'],
  });
  assert.deepStrictEqual(Object.keys(h), [
    'sema', 'setKimligi', 'setKimligiKaynagi', 'sebep', 'taban', 'tabanKaynagi',
    'damga', 'kabukTanimi', 'kabukDosyaSayisi', 'kabukDosyalari', 'kapsamDisiDallar',
    'kitapSayisi', 'kitapDizinleri', 'imza', 'imzaSebebi',
  ]);
  assert.strictEqual(h.kabukTanimi, m.KABUK_IMZASI,
    'paket, hangi kabuk tanımıyla üretildiğini TAŞIMALI (kapı imzayı karşılaştırır)');
  assert.deepStrictEqual(h.kapsamDisiDallar, []);
  assert.strictEqual(h.sema, m.SEMA_SURUMU);
  assert.strictEqual(h.tabanKaynagi, 'env');
  assert.strictEqual(h.kabukDosyaSayisi, 2);
  assert.strictEqual(h.kitapSayisi, 2);
  assert.strictEqual(JSON.parse(JSON.stringify(h)).setKimligi, '45516', 'JSON serileştirilemiyor');
});

test('damga: ms sayısı, Date ve hazır ISO string kabul edilir', () => {
  assert.strictEqual(m.haritaUret({ damga: 1758412800000 }).damga, new Date(1758412800000).toISOString());
  assert.strictEqual(m.haritaUret({ damga: new Date(0) }).damga, '1970-01-01T00:00:00.000Z');
  assert.strictEqual(m.haritaUret({ damga: '2026-09-21T10:00:00.000Z' }).damga, '2026-09-21T10:00:00.000Z');
  assert.match(m.haritaUret({}).damga, /^\d{4}-\d{2}-\d{2}T/);    // damga verilmezse "şimdi"
});

test('kapı: EMPP_SET_GUNCELLEME=0 dışında AÇIK', () => {
  assert.strictEqual(m.acikMi({}), true);
  assert.strictEqual(m.acikMi({ EMPP_SET_GUNCELLEME: '1' }), true);
  assert.strictEqual(m.acikMi({ EMPP_SET_GUNCELLEME: '0' }), false);
});

// ─────────────────────────── uçtan uca (gerçek ölçüm) ───────────────────────────

test('GERÇEK VERİ (SM4 Set): 6 kitap üye, kabuk = kök + assets2 + core + i18n', async () => {
  const kok = await sahteSm4Set();
  const r = await m.paketeYaz(kok, { setKimligi: '45516', damga: 0, env: {} });
  const h = r.harita;
  assert.deepStrictEqual(h.kitapDizinleri, ['book1', 'book2', 'book3', 'book4', 'book5', 'book6']);
  assert.deepStrictEqual(h.kabukDosyalari, [
    '43e23fce2b7009474555a77.js', 'a8f43f74c72b65a3dd05.main.js',
    'assets2/alt/derin.js', 'assets2/book1-button.png', 'assets2/styles.css',
    'assets2/world.apng', 'core/kurumLogo.png', 'empp-fs-shim.js', 'i18n/tr.js',
    'index.html', 'set_app.config',
  ]);
  assert.strictEqual(h.kabukDosyalari.filter((x) => /^book\d/.test(x)).length, 0, 'kitap sızdı');
  assert.strictEqual(h.kabukDosyalari.filter((x) => x.startsWith('node_modules/')).length, 0);
  assert.strictEqual(h.kabukDosyalari.filter((x) => x.startsWith('temp/')).length, 0);
  assert.deepStrictEqual(h.kapsamDisiDallar, [], 'gerçek ağaç şeklinde kör nokta yok');
  assert.strictEqual(h.setKimligi, '45516');
  assert.strictEqual(h.tabanKaynagi, 'varsayilan');
});

test('paketeYaz: dosya kökte, adı empp-set.json, geçerli JSON + sonda yeni satır', async () => {
  const kok = await sahteSm4Set();
  await m.paketeYaz(kok, { setKimligi: 'SET-x-1', damga: 0 });
  const ham = await fs.readFile(path.join(kok, 'empp-set.json'), 'utf8');
  assert.ok(ham.endsWith('}\n'));
  assert.strictEqual(JSON.parse(ham).setKimligi, 'SET-x-1');
  assert.strictEqual(m.DOSYA_ADI, 'empp-set.json');
});

test('kabuğu eksik paket (index.html/assets2 yok) çökertmez, boş liste yazar', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'set-bos-'));
  await fs.ensureDir(path.join(kok, 'book1'));
  const r = await m.paketeYaz(kok, { setKimligi: 'X', damga: 0 });
  assert.deepStrictEqual(r.harita.kabukDosyalari, []);
  assert.deepStrictEqual(r.harita.kitapDizinleri, ['book1']);
});

test('okunamayan kök paketlemeyi düşürmez (I/O hatası yutulur)', async () => {
  assert.deepStrictEqual(await m.kitapDizinleriBul('/olmayan/dizin/xyz'), []);
  assert.deepStrictEqual(await m.kabukDosyalariBul('/olmayan/dizin/xyz'), []);
});

// ─────────────────────────── manifest imza anahtarı (sözleşme G4) ───────────────────────────

test('G4: geçerli ed25519 açık anahtar empp-set.json\'a gömülür; kaynak istek > env', () => {
  const crypto = require('node:crypto');
  const a = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const b = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const h = m.haritaUret({ setKimligi: '59835', imzaAcikAnahtari: a, env: { EMPP_GUNCELLEME_ACIK_ANAHTAR: b } });
  assert.deepStrictEqual(h.imza, { alg: 'ed25519', acikAnahtar: a, kaynak: 'istek' });
  assert.strictEqual(h.imzaSebebi, null);
  const e = m.haritaUret({ setKimligi: '59835', env: { EMPP_GUNCELLEME_ACIK_ANAHTAR: b } });
  assert.strictEqual(e.imza.kaynak, 'env');
});

test('G4: anahtar yok / RSA / bozuk → imza null + GÖRÜNÜR sebep (sessiz düşme yok)', () => {
  const crypto = require('node:crypto');
  assert.strictEqual(m.haritaUret({ setKimligi: '1' }).imza, null);
  assert.match(m.haritaUret({ setKimligi: '1' }).imzaSebebi, /anahtarı yok/);
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey
    .export({ type: 'spki', format: 'der' }).toString('base64');
  const r = m.haritaUret({ setKimligi: '1', imzaAcikAnahtari: rsa });
  assert.strictEqual(r.imza, null);
  assert.match(r.imzaSebebi, /geçersiz.*rsa/);
  assert.strictEqual(m.haritaUret({ setKimligi: '1', imzaAcikAnahtari: 'bozuk!' }).imza, null);
});

test('G4: paketeYaz imzaAcikAnahtari seçeneğini dosyaya yazar', async () => {
  const crypto = require('node:crypto');
  const a = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const kok = await sahteSm4Set();
  await m.paketeYaz(kok, { setKimligi: '59835', imzaAcikAnahtari: a, env: {} });
  const okunan = JSON.parse(await fs.readFile(path.join(kok, m.DOSYA_ADI), 'utf8'));
  assert.strictEqual(okunan.imza.acikAnahtar, a);
  assert.strictEqual(okunan.imza.alg, 'ed25519');
});

// ─── PLATFORM KAPSAMI (2026-09-26, Windows sözleşmesi ONAYLI — yalnız Windows) ───
// Bayrak virgüllü platform listesi alabilir; kapı yalnız işin platformlarının HEPSİ
// listedeyse açıktır (ortak workingPath: karışık işte mac çıktısına sızmasın).
// Kural kaynağı: platform-kapisi.js — burada bu modülün acikMi'si uçtan uca sınanır.
test('PLATFORM KAPSAMI: EMPP_SET_GUNCELLEME=windows — windows açık, macos kapalı, karışık kapalı', () => {
  const uyarilar = [];
  const s = { uyar: (x) => uyarilar.push(x) };
  const env = { EMPP_SET_GUNCELLEME: 'windows' };
  assert.strictEqual(m.acikMi(env, ['windows'], s), true, 'yalnız windows işi açık olmalı');
  assert.strictEqual(m.acikMi(env, ['macos'], s), false, 'yalnız macos işi kapalı olmalı');
  assert.strictEqual(m.acikMi(env, ['windows', 'macos'], s), false, 'karışık iş kapalı olmalı');
  assert.strictEqual(m.acikMi({ EMPP_SET_GUNCELLEME: 'windows,macos' }, ['windows', 'macos'], s), true);
  assert.deepStrictEqual(uyarilar, []);
});

test('PLATFORM KAPSAMI: EMPP_SET_GUNCELLEME eski değerler — 0 kapalı, 1 açık, tanımsız → varsayılan AÇIK', () => {
  for (const is of [['windows'], ['macos'], ['windows', 'macos'], undefined]) {
    assert.strictEqual(m.acikMi({ EMPP_SET_GUNCELLEME: '0' }, is), false);
    assert.strictEqual(m.acikMi({ EMPP_SET_GUNCELLEME: '1' }, is), true);
    assert.strictEqual(m.acikMi({}, is), true);
  }
});

test('PLATFORM KAPSAMI: EMPP_SET_GUNCELLEME bilinmeyen platform adı → görünür UYARI, eşleşme yok', () => {
  const uyarilar = [];
  const s = { uyar: (x) => uyarilar.push(x) };
  assert.strictEqual(m.acikMi({ EMPP_SET_GUNCELLEME: 'windows,mac' }, ['macos'], s), false);
  assert.strictEqual(uyarilar.length, 1);
  assert.match(uyarilar[0], /^UYARI: EMPP_SET_GUNCELLEME tanınmayan platform adı: mac /);
  assert.strictEqual(m.acikMi({ EMPP_SET_GUNCELLEME: 'windows,mac' }, ['windows'], s), true, 'tanınan ad çalışmaya devam eder');
});
