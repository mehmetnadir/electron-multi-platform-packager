'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const m = require('./paket-manifesti');

async function sahteSet(kitapAdlari = ['book1', 'book2']) {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-'));
  for (const ad of kitapAdlari) {
    const d = path.join(kok, ad);
    await fs.ensureDir(path.join(d, 'assets'));
    await fs.writeFile(path.join(d, 'index.html'), '<html></html>', 'utf8');   // motor imzası
    await fs.writeFile(path.join(d, 'app.config.js'), 'var c={};', 'utf8');    // motor imzası
    await fs.writeFile(path.join(d, 'assets', 'p1.png'), 'x'.repeat(100), 'utf8');
  }
  return kok;
}

test('setId VERİLİRSE aynen yazılır, üretilmez', () => {
  const r = m.manifestKur({ setId: 'YDS-SM4-2026', uygulamaAdi: 'Super Monsters 4', uygulamaSurumu: '1.0.0' });
  assert.strictEqual(r.setId, 'YDS-SM4-2026');
  assert.strictEqual(r.setIdKaynagi, 'verildi');
});

test('setId VERİLMEZSE üretilir ve kaynağı işaretlenir', () => {
  const r = m.manifestKur({ uygulamaAdi: 'Süper Canavarlar', uygulamaSurumu: '1.0.0' });
  assert.strictEqual(r.setIdKaynagi, 'uretildi');
  assert.match(r.setId, /^SET-super-canavarlar-[0-9a-f]{12}$/);
});

test('üretilen setId GLOBAL TEKİL — sayaç değil rastgelelik', () => {
  const kume = new Set();
  for (let i = 0; i < 200; i++) kume.add(m.setIdUret('Aynı Ad'));
  assert.strictEqual(kume.size, 200, 'çakışan kimlik üretildi');
});

test('GERİLEME: Türkçe karakterli ad ASCII sapa indirilir', () => {
  assert.strictEqual(m.sap('Işık Yayıncılık Ünite 3'), 'isik-yayincilik-unite-3');
  assert.strictEqual(m.sap('ÇĞİÖŞÜ'), 'cgiosu');
});

test('sap: boş/anlamsız ad varsayılana düşer, uzunluk sınırlanır', () => {
  assert.strictEqual(m.sap(''), 'set');
  assert.strictEqual(m.sap('!!!'), 'set');
  assert.ok(m.sap('a'.repeat(100)).length <= 24);
});

test('geçersiz setId reddedilir (boşluk, kontrol karakteri, aşırı uzun)', () => {
  for (const kotu of ['iki kelime', 'satır\nsonu', '', 'x'.repeat(129), null, 42, {}]) {
    assert.strictEqual(m.setIdGecerliMi(kotu), false, JSON.stringify(kotu));
  }
  for (const iyi of ['SET-a-1', 'yds.sm4:2026', 'A_B-c.d']) {
    assert.strictEqual(m.setIdGecerliMi(iyi), true, iyi);
  }
});

test('geçersiz setId verilirse SESSİZCE kabul edilmez, üretilir', () => {
  const r = m.manifestKur({ setId: 'iki kelime', uygulamaAdi: 'X' });
  assert.strictEqual(r.setIdKaynagi, 'uretildi');
  assert.notStrictEqual(r.setId, 'iki kelime');
});

test('parmak izi yol+boyuta duyarlı: tek bayt değişirse değişir', () => {
  const a = [{ yol: 'a/1.png', bayt: 100 }, { yol: 'a/2.png', bayt: 200 }];
  const b = [{ yol: 'a/1.png', bayt: 101 }, { yol: 'a/2.png', bayt: 200 }];
  const c = [{ yol: 'a/1.png', bayt: 100 }, { yol: 'a/3.png', bayt: 200 }];
  assert.strictEqual(m.parmakIzi(a), m.parmakIzi(a));
  assert.notStrictEqual(m.parmakIzi(a), m.parmakIzi(b), 'boyut değişimi yakalanmalı');
  assert.notStrictEqual(m.parmakIzi(a), m.parmakIzi(c), 'ad değişimi yakalanmalı');
});

test('İÇERİĞİ AYNI iki kitap FARKLI parmak izi alır (dizin adı özete girer)', async () => {
  const kok = await sahteSet(['book1', 'book2']);          // ikisi birebir aynı içerik
  const r = await m.paketeUygula(kok, { uygulamaAdi: 'X', uygulamaSurumu: '1' });
  const [a, b] = r.manifest.kitaplar;
  assert.notStrictEqual(a.parmakIzi, b.parmakIzi, 'aynı iz = "hangi kitap değişti" sorusu yanlış cevaplanır');
  await fs.remove(kok);
});

test('parmak izi öneksiz çağrıda eski davranışı korur', () => {
  const d = [{ yol: 'a', bayt: 1 }];
  assert.strictEqual(m.parmakIzi(d), m.parmakIzi(d, ''));
  assert.notStrictEqual(m.parmakIzi(d), m.parmakIzi(d, 'book1'));
});

test('paket parmak izi kitap parmak izlerinden türer', () => {
  const kitaplar = [{ dizin: 'book1', dosyaSayisi: 1, bayt: 1, parmakIzi: 'aa' }];
  const bir = m.manifestKur({ uygulamaAdi: 'X', kitaplar, setId: 'S-1' });
  const iki = m.manifestKur({ uygulamaAdi: 'X', kitaplar: [{ ...kitaplar[0], parmakIzi: 'bb' }], setId: 'S-1' });
  assert.notStrictEqual(bir.parmakIzi, iki.parmakIzi);
});

test('manifest alanları: şema, sayım, zaman ISO', () => {
  const r = m.manifestKur({
    setId: 'S-1', uygulamaAdi: 'X', uygulamaSurumu: '2.3.4',
    kitaplar: [{ dizin: 'a', dosyaSayisi: 2, bayt: 9, parmakIzi: 'p' },
               { dizin: 'b', dosyaSayisi: 3, bayt: 8, parmakIzi: 'q' }],
    simdiMs: Date.UTC(2026, 8, 20, 12, 0, 0),
  });
  assert.strictEqual(r.sema, m.SEMA_SURUMU);
  assert.strictEqual(r.kitapSayisi, 2);
  assert.strictEqual(r.uygulamaSurumu, '2.3.4');
  assert.strictEqual(r.uretim.zaman, '2026-09-20T12:00:00.000Z');
});

test('gerçek ağaçta: kitaplar motor imzasından bulunur, paket.json yazılır', async () => {
  const kok = await sahteSet(['book1', 'book2']);
  await fs.ensureDir(path.join(kok, 'assets'));                 // kitap DEĞİL (imza yok)
  await fs.writeFile(path.join(kok, 'assets', 'x.png'), 'y', 'utf8');
  const r = await m.paketeUygula(kok, { uygulamaAdi: 'Test Set', uygulamaSurumu: '1.0.0' });
  assert.strictEqual(r.yazildi, true);
  const yazilan = JSON.parse(await fs.readFile(path.join(kok, m.DOSYA_ADI), 'utf8'));
  assert.strictEqual(yazilan.kitapSayisi, 2);
  assert.deepStrictEqual(yazilan.kitaplar.map((k) => k.dizin).sort(), ['book1', 'book2']);
  assert.ok(yazilan.kitaplar[0].dosyaSayisi >= 3, 'alt dizindeki dosyalar sayılmalı');
  assert.ok(yazilan.kitaplar[0].bayt >= 100, 'baytlar toplanmalı');
  await fs.remove(kok);
});

test('setId BİR KEZ yazılır: ikinci koşuda mevcut kimlik DEĞİŞMEZ', async () => {
  const kok = await sahteSet(['book1']);
  const bir = await m.paketeUygula(kok, { uygulamaAdi: 'X', uygulamaSurumu: '1' });
  const iki = await m.paketeUygula(kok, { uygulamaAdi: 'X', uygulamaSurumu: '2', setId: 'BASKA-KIMLIK' });
  assert.strictEqual(iki.manifest.setId, bir.manifest.setId, 'kimlik değişmemeli');
  assert.strictEqual(iki.manifest.uygulamaSurumu, '2', 'sürüm güncellenmeli');
  await fs.remove(kok);
});

test('bozuk mevcut paket.json kimliği kilitlemez, yenisi yazılır', async () => {
  const kok = await sahteSet(['book1']);
  await fs.writeFile(path.join(kok, m.DOSYA_ADI), '{bozuk', 'utf8');
  const r = await m.paketeUygula(kok, { uygulamaAdi: 'X', uygulamaSurumu: '1', setId: 'S-YENI' });
  assert.strictEqual(r.manifest.setId, 'S-YENI');
  await fs.remove(kok);
});

test('içerik değişince paket parmak izi DEĞİŞİR (aynı kimlikle)', async () => {
  const kok = await sahteSet(['book1']);
  const bir = await m.paketeUygula(kok, { uygulamaAdi: 'X', uygulamaSurumu: '1' });
  await fs.writeFile(path.join(kok, 'book1', 'assets', 'p1.png'), 'x'.repeat(250), 'utf8');
  const iki = await m.paketeUygula(kok, { uygulamaAdi: 'X', uygulamaSurumu: '1' });
  assert.strictEqual(iki.manifest.setId, bir.manifest.setId);
  assert.notStrictEqual(iki.manifest.parmakIzi, bir.manifest.parmakIzi);
  await fs.remove(kok);
});

test('tek kitaplık (SET olmayan) paket: kitap bulunmazsa da manifest yazılır', async () => {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'tekkitap-'));
  await fs.writeFile(path.join(kok, 'index.html'), '<html></html>', 'utf8');
  await fs.writeFile(path.join(kok, 'app.config.js'), 'var c={};', 'utf8');
  const r = await m.paketeUygula(kok, { uygulamaAdi: 'Tek', uygulamaSurumu: '1' });
  assert.strictEqual(r.yazildi, true);
  assert.strictEqual(r.manifest.kitapSayisi, 0, 'kök kitabın kendisi alt-kitap değildir');
  assert.ok(r.manifest.setId, 'kimlik yine de üretilmeli');
  await fs.remove(kok);
});

test('okunamayan dizin paketlemeyi DURDURMAZ', async () => {
  const dokum = await m.dosyaDokumu('/var/olmayan-dizin-xyz');
  assert.deepStrictEqual(dokum, []);
});

test('kurum kimliği yazılır; yoksa alan VAR ama null (belirsizlik bırakma)', () => {
  const ile = m.manifestKur({ setId: 'S-1', uygulamaAdi: 'X', kurum: { id: '060', ad: 'YDS Publishing' } });
  assert.deepStrictEqual(ile.kurum, { id: '060', ad: 'YDS Publishing' });
  const siz = m.manifestKur({ setId: 'S-1', uygulamaAdi: 'X' });
  assert.ok('kurum' in siz, 'alan hiç yazılmamış — tüketicide belirsizlik üretir');
  assert.deepStrictEqual(siz.kurum, { id: null, ad: null });
});

test('kapı: varsayılan AÇIK, yalnız "0" kapatır', () => {
  assert.strictEqual(m.acikMi({}), true);
  assert.strictEqual(m.acikMi({ EMPP_PAKET_MANIFESTI: 'kapali' }), true);
  assert.strictEqual(m.acikMi({ EMPP_PAKET_MANIFESTI: '0' }), false);
});
