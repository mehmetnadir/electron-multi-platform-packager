'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs-extra');
const M = require('./motor-surumu');

/** Sentetik SET ağacı kurar: kök + book1/book2 + node_modules çöplüğü, hepsi motoru taşır. */
async function sentetikAgacKur(icerik = 'MOTOR-v1') {
  const kok = await fs.mkdtemp(path.join(os.tmpdir(), 'motor-surumu-'));
  await fs.writeFile(path.join(kok, M.MOTOR_DOSYA_ADI), icerik);
  await fs.ensureDir(path.join(kok, 'book1'));
  await fs.writeFile(path.join(kok, 'book1', M.MOTOR_DOSYA_ADI), icerik);
  await fs.ensureDir(path.join(kok, 'book2'));
  await fs.writeFile(path.join(kok, 'book2', M.MOTOR_DOSYA_ADI), icerik);
  // node_modules altına da aynı ada sahip bir dosya koy — taramaya GİRMEMELİ.
  await fs.ensureDir(path.join(kok, 'node_modules', 'x'));
  await fs.writeFile(path.join(kok, 'node_modules', 'x', M.MOTOR_DOSYA_ADI), 'baska-bir-sey');
  return kok;
}

function sha12(icerik) {
  return crypto.createHash('sha256').update(icerik).digest('hex').slice(0, 12);
}

test('motorDosyalariniBul: kök + her alt-kitapta bulur, node_modules ATLANIR', async () => {
  const kok = await sentetikAgacKur();
  try {
    const bulunanlar = await M.motorDosyalariniBul(kok);
    assert.deepEqual(bulunanlar, [M.MOTOR_DOSYA_ADI, `book1/${M.MOTOR_DOSYA_ADI}`, `book2/${M.MOTOR_DOSYA_ADI}`]);
  } finally {
    await fs.remove(kok);
  }
});

test('motorDamgasi: kanonik verilmezse (opts.kanonik ile enjekte) sha12/boyut/mtime dolu, durum AYNI', async () => {
  const icerik = 'MOTOR-v1';
  const kok = await sentetikAgacKur(icerik);
  try {
    const beklenenSha = sha12(icerik);
    const damgalar = await M.motorDamgasi(kok, { kanonik: { sha12: beklenenSha } });
    assert.equal(damgalar.length, 3, 'kök + 2 alt-kitap = 3 kayıt');
    for (const d of damgalar) {
      assert.equal(d.sha12, beklenenSha);
      assert.equal(d.boyut, Buffer.byteLength(icerik));
      assert.ok(typeof d.mtime === 'string' && !Number.isNaN(Date.parse(d.mtime)));
      assert.equal(d.durum, 'ayni');
      assert.equal(d.kanonikSha12, beklenenSha);
    }
  } finally {
    await fs.remove(kok);
  }
});

test('GÜVENLİK: kanonik yokken (null) durum "bilinmiyor" — sahte yeşil YOK', async () => {
  const kok = await sentetikAgacKur('MOTOR-v1');
  try {
    const damgalar = await M.motorDamgasi(kok, { kanonik: null });
    assert.ok(damgalar.length > 0);
    for (const d of damgalar) {
      assert.equal(d.durum, 'bilinmiyor');
      assert.equal(d.kanonikSha12, null);
    }
  } finally {
    await fs.remove(kok);
  }
});

test('MUTASYON: motor dosyasında bir bayt değişince sha12 değişir ve durum FARKLI olur', async () => {
  const kok = await sentetikAgacKur('MOTOR-v1');
  try {
    const kanonikSha = sha12('MOTOR-v1');
    // Kökteki motoru bir bayt bozarak "eski/farklı sürüm" simüle et.
    await fs.writeFile(path.join(kok, M.MOTOR_DOSYA_ADI), 'MOTOR-v2');
    const damgalar = await M.motorDamgasi(kok, { kanonik: { sha12: kanonikSha } });
    const kokKaydi = damgalar.find((d) => d.dosya === M.MOTOR_DOSYA_ADI);
    const altKaydi = damgalar.find((d) => d.dosya === `book1/${M.MOTOR_DOSYA_ADI}`);
    assert.notEqual(kokKaydi.sha12, kanonikSha, 'bozulan dosyanın hash\'i kanonikten farklı olmalı');
    assert.equal(kokKaydi.durum, 'farkli');
    assert.equal(kokKaydi.kanonikSha12, kanonikSha);
    // book1 dokunulmadı — hâlâ kanonikle aynı olmalı.
    assert.equal(altKaydi.durum, 'ayni');
  } finally {
    await fs.remove(kok);
  }
});

test('kanonikOku: dosya yoksa null (fırlatmaz)', async () => {
  const yol = path.join(os.tmpdir(), `olmayan-kanonik-${Date.now()}.json`);
  const sonuc = await M.kanonikOku(yol);
  assert.equal(sonuc, null);
});

test('kanonikOku: bozuk JSON null döner', async () => {
  const dosya = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'kanonik-bozuk-')), 'kanonik.json');
  await fs.writeFile(dosya, '{ bu gecerli json degil');
  const sonuc = await M.kanonikOku(dosya);
  assert.equal(sonuc, null);
});

test('kanonikOku: geçerli sha12 içeren dosya okunur', async () => {
  const dizin = await fs.mkdtemp(path.join(os.tmpdir(), 'kanonik-gecerli-'));
  const dosya = path.join(dizin, 'kanonik.json');
  await fs.writeFile(dosya, JSON.stringify({ sha12: 'abcdef012345', boyut: 10, mtime: '2026-01-01T00:00:00.000Z' }));
  const sonuc = await M.kanonikOku(dosya);
  assert.equal(sonuc.sha12, 'abcdef012345');
});

test('kanonikOku: sha12 alanı eksik/geçersizse null', async () => {
  const dizin = await fs.mkdtemp(path.join(os.tmpdir(), 'kanonik-eksik-'));
  const dosya = path.join(dizin, 'kanonik.json');
  await fs.writeFile(dosya, JSON.stringify({ boyut: 10 }));
  const sonuc = await M.kanonikOku(dosya);
  assert.equal(sonuc, null);
});

test('paketJsonDamgasi: SAF — girdi nesnesi mutasyona uğramaz, yeni alan eklenir', () => {
  const orijinal = Object.freeze({ setId: 'SET-abc', kitapSayisi: 2 });
  const damga = [{ dosya: 'x', sha12: 'aaa', durum: 'ayni' }];
  const yeni = M.paketJsonDamgasi(orijinal, damga);
  assert.equal(yeni.motorSurumu, damga);
  assert.equal(yeni.setId, 'SET-abc');
  assert.equal(orijinal.motorSurumu, undefined, 'orijinal nesneye alan eklenmemiş olmalı');
});

test('rozet: AYNI durumu', () => {
  const metin = M.rozet({ sha12: 'abcdef012345', durum: 'ayni', kanonikSha12: 'abcdef012345' });
  assert.equal(metin, 'motor: abcdef012345 (kanonikle AYNI)');
});

test('rozet: FARKLI durumu kanonik sha12\'yi de gösterir', () => {
  const metin = M.rozet({ sha12: '111111111111', durum: 'farkli', kanonikSha12: '222222222222' });
  assert.equal(metin, 'motor: 111111111111 (FARKLI: kanonik 222222222222)');
});

test('rozet: bilinmiyor durumu', () => {
  const metin = M.rozet({ sha12: 'abcdef012345', durum: 'bilinmiyor', kanonikSha12: null });
  assert.equal(metin, 'motor: abcdef012345 (bilinmiyor)');
});

test('rozet: liste verilirse her kayıt için satır üretir, boş listede "bulunamadı"', () => {
  assert.equal(M.rozet([]), 'motor: bulunamadı');
  const liste = [
    { sha12: 'aaaaaaaaaaaa', durum: 'ayni', kanonikSha12: 'aaaaaaaaaaaa' },
    { sha12: 'bbbbbbbbbbbb', durum: 'farkli', kanonikSha12: 'aaaaaaaaaaaa' },
  ];
  assert.equal(
    M.rozet(liste),
    'motor: aaaaaaaaaaaa (kanonikle AYNI); motor: bbbbbbbbbbbb (FARKLI: kanonik aaaaaaaaaaaa)',
  );
});

test('acikMi: varsayılan AÇIK, EMPP_MOTOR_SURUMU=0 kapatır', () => {
  assert.equal(M.acikMi({}), true);
  assert.equal(M.acikMi({ EMPP_MOTOR_SURUMU: '0' }), false);
  assert.equal(M.acikMi({ EMPP_MOTOR_SURUMU: '1' }), true);
});
