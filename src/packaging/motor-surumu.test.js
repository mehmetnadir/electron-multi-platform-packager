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

// ---------------------------------------------------------------------------
// İKİ PARDUS ŞERİDİ (2026-09-26, kanıt E3 / T6 / D-1): ANA kopya sha12'si, senkron kanonik
// okuma (nabız + şerit denetçisi), makine-okur damga satırı.
// ---------------------------------------------------------------------------

/** Doğrulanabilir kanonik önbellek kurar: <dizin>/{43e23…js, kanonik.json}. */
async function kanonikKur(icerik = 'KANONIK-MOTOR-v2', ek = {}) {
  const dizin = await fs.mkdtemp(path.join(os.tmpdir(), 'motor-kanonik-'));
  await fs.writeFile(path.join(dizin, M.MOTOR_DOSYA_ADI), icerik);
  const json = { sha12: sha12(icerik), surum: '2026.9.12', surumler: {}, ...ek };
  await fs.writeFile(path.join(dizin, 'kanonik.json'), JSON.stringify(json));
  return { dizin, yol: path.join(dizin, 'kanonik.json'), sha12: sha12(icerik) };
}

test('anaKopyaMi: kök ve doğrudan bookN/ ANA; htmletk/etk iç kopyası ANA DEĞİL', () => {
  assert.equal(M.anaKopyaMi(M.MOTOR_DOSYA_ADI), true);
  assert.equal(M.anaKopyaMi(`book3/${M.MOTOR_DOSYA_ADI}`), true);
  assert.equal(M.anaKopyaMi(`book1/htmletk/u1/etk/${M.MOTOR_DOSYA_ADI}`), false);
  assert.equal(M.anaKopyaMi('book1/baska.js'), false);
  assert.equal(M.anaSha12([{ dosya: `book1/${M.MOTOR_DOSYA_ADI}`, sonraSha12: 'a' },
    { dosya: `book2/${M.MOTOR_DOSYA_ADI}`, sonraSha12: 'b' }]), null, 'karışık ANA → null');
  assert.equal(M.anaSha12([]), null);
});

test('T6 kod tarafı: kanonik görünürse paket.json.motorSurumu.sha12 = kanonik (ANA kopyalar)', async () => {
  const kok = await sentetikAgacKur('YAYINCI-ESKI');
  const k = await kanonikKur();
  try {
    const d = await M.motorDegistir(kok, k.yol);
    assert.equal(d.durum, 'guncel');
    assert.equal(d.sha12, k.sha12);
    const pj = JSON.parse(await fs.readFile(path.join(kok, 'paket.json'), 'utf8'));
    assert.equal(pj.motorSurumu.sha12, k.sha12);
    assert.equal(pj.motorSurumu.kanonikSha12, k.sha12);
  } finally {
    await fs.remove(kok);
    await fs.remove(k.dizin);
  }
});

test('T6 negatif: kanonik GÖRÜNMEZSE durum bilinmiyor, motor değişmez, sha12 = eski ANA motor', async () => {
  const kok = await sentetikAgacKur('YAYINCI-ESKI');
  try {
    const d = await M.motorDegistir(kok, path.join(kok, 'yok', 'kanonik.json'));
    assert.equal(d.durum, 'bilinmiyor');
    assert.equal(d.degisen, 0);
    assert.equal(d.sha12, sha12('YAYINCI-ESKI'), 'değişmemiş motorun izi pakette kalır');
    const pj = JSON.parse(await fs.readFile(path.join(kok, 'paket.json'), 'utf8'));
    assert.equal(pj.motorSurumu.durum, 'bilinmiyor');
    assert.equal(pj.motorSurumu.kanonikSha12, null);
  } finally {
    await fs.remove(kok);
  }
});

test('kanonikOzetEsz: doğrulanmış {sha12, surum}; hash tutmazsa / dosya yoksa / sürüm bozuksa null', async () => {
  const k = await kanonikKur();
  try {
    assert.deepEqual(M.kanonikOzetEsz(k.yol), { sha12: k.sha12, surum: '2026.9.12' });
    await fs.writeFile(path.join(k.dizin, M.MOTOR_DOSYA_ADI), 'BASKA-ICERIK');
    assert.equal(M.kanonikOzetEsz(k.yol), null, 'json sha12 ≠ dosya → null');
    await fs.remove(path.join(k.dizin, M.MOTOR_DOSYA_ADI));
    assert.equal(M.kanonikOzetEsz(k.yol), null, 'motor dosyası yok → null');
    assert.equal(M.kanonikOzetEsz(path.join(k.dizin, 'yok.json')), null);
  } finally {
    await fs.remove(k.dizin);
  }
  const b = await kanonikKur('X', { surum: 'eski' });
  try {
    assert.equal(M.kanonikOzetEsz(b.yol), null, 'geçersiz sürüm → null (kanonikYukle ile aynı ölçüt)');
    assert.equal(await M.kanonikYukle(b.yol), null);
  } finally {
    await fs.remove(b.dizin);
  }
});

test('damgaSatiri ↔ damgaSatiriAyristir gidiş-dönüş; null damga = kapı kapalı; son satır kazanır', () => {
  const s = M.damgaSatiri({ durum: 'guncel', sha12: '03e8af70a0f3', kanonikSha12: '03e8af70a0f3', kanonikSurum: '2026.9.12', degisen: 5 });
  assert.equal(s, 'EMPP_MOTOR durum=guncel sha12=03e8af70a0f3 kanonik=03e8af70a0f3 surum=2026.9.12 degisen=5');
  assert.equal(M.damgaSatiri(null), 'EMPP_MOTOR durum=kapali sha12=- kanonik=YOK');
  const o = M.damgaSatiriAyristir(`[io] x\n${M.damgaSatiri({ durum: 'bilinmiyor', sha12: 'f44371530000' })}\n${s}\n`);
  assert.equal(o.durum, 'guncel');
  assert.equal(o.sha12, '03e8af70a0f3');
  assert.equal(M.damgaSatiriAyristir('EMPP_MOTORX durum=a\nhiçbir şey'), null);
});

test('packagingService motor adımından sonra makine-okur damga satırını basar (Pardus betikleri okur)', async () => {
  const src = await fs.readFile(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.match(src, /console\.log\(motorSurumu\.damgaSatiri\(motorDamgasiSonucu\)\);/);
  const motorBlok = src.indexOf('motorSurumu.motorDegistir(workingPath');
  const satir = src.indexOf('motorSurumu.damgaSatiri(motorDamgasiSonucu)');
  const manifest = src.indexOf('paketManifesti.paketeUygula(workingPath');
  assert.ok(motorBlok > 0 && satir > motorBlok && satir < manifest, 'motor adımından sonra, manifestten önce');
});

test('rozetSurumuOkuEsz: eski kabuk (.main EKSİZ giriş, 45550 book4) rozeti okunur; .main\'li aynen', async () => {
  const H = (c) => c.repeat(20);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rozet-eksiz-'));
  try {
    await fs.writeFile(path.join(dir, `${H('6')}.js`), `x={336:"${H('f')}"}`);
    await fs.writeFile(path.join(dir, `${H('f')}.336.js`), 'e.exports={i8:"1.9.12.5"}');
    await fs.writeFile(path.join(dir, 'index.html'),
      `<script src="43e23fce2b7009474555a77.js"></script><script defer src="./${H('6')}.js"></script>`);
    assert.deepEqual(M.rozetSurumuOkuEsz(dir), { surum: '1.9.12.5', main: `${H('6')}.js`, parca: `${H('f')}.336.js` });
    assert.equal((await M.rozetSurumuOku(dir)).surum, '1.9.12.5');
    // .main'li giriş öncelikli (eski davranış)
    await fs.writeFile(path.join(dir, `${H('a')}.main.js`), `x={923:"${H('b')}"}`);
    await fs.writeFile(path.join(dir, `${H('b')}.923.js`), 'e.exports={i8:"1.13.14"}');
    await fs.writeFile(path.join(dir, 'index.html'),
      `<script src="./${H('6')}.js"></script><script src="./${H('a')}.main.js"></script>`);
    assert.equal(M.rozetSurumuOkuEsz(dir).surum, '1.13.14');
    // yalnız webpack parçası referansı → ana giriş YOK
    await fs.writeFile(path.join(dir, 'index.html'), `<script src="./${H('f')}.336.js"></script>`);
    assert.deepEqual(M.rozetSurumuOkuEsz(dir), { surum: null, main: null, parca: null });
    // iki eksiz aday → belirsiz, okunmaz
    await fs.writeFile(path.join(dir, 'index.html'),
      `<script src="./${H('6')}.js"></script><script src="./${H('7')}.js"></script>`);
    assert.equal(M.rozetSurumuOkuEsz(dir).surum, null);
  } finally { await fs.remove(dir); }
});
