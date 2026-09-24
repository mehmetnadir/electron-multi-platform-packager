'use strict';
// Faz 3b — motorDegistir / motorKapisi / rozetSurumuOku (motor-surumu.js).
// Sentetik ağaç + mutasyon: kanonik ESKİYSE değiştirmez, sha eşitse dokunmaz,
// kitap-içi gömülü 5. kopya da yakalanır, kanonik yoksa hiçbir şey değişmez.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs-extra');
const M = require('./motor-surumu');

const AD = M.MOTOR_DOSYA_ADI;
const GOMULU = `book1/assets/73454/htmletk/u1/etk/${AD}`;

function sha12(icerik) {
  return crypto.createHash('sha256').update(icerik).digest('hex').slice(0, 12);
}

/** Çalışma alanı: <tmp>/paket (ağaç) + <tmp>/kanonik (önbellek). */
async function alanKur({ paketMotoru = 'YAYINCI-ESKI', gomulu = 'GOMULU-ESKI' } = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'motor-degistir-'));
  const kok = path.join(tmp, 'paket');
  for (const d of ['', 'book1', 'book2']) {
    await fs.ensureDir(path.join(kok, d));
    await fs.writeFile(path.join(kok, d, AD), paketMotoru);
  }
  await fs.ensureDir(path.dirname(path.join(kok, GOMULU)));
  await fs.writeFile(path.join(kok, GOMULU), gomulu);
  await fs.writeFile(path.join(kok, 'paket.json'), JSON.stringify({ setId: 'S1', sema: 1 }));
  return { tmp, kok };
}

async function kanonikKur(tmp, icerik, surum, surumler = {}) {
  const dir = path.join(tmp, 'kanonik');
  await fs.ensureDir(dir);
  await fs.writeFile(path.join(dir, AD), icerik);
  const j = { sha12: sha12(icerik), surum, surumler };
  await fs.writeFile(path.join(dir, 'kanonik.json'), JSON.stringify(j));
  return path.join(dir, 'kanonik.json');
}

test('surumKiyasla: semver benzeri, farklı uzunluk, geçersiz → null', () => {
  assert.equal(M.surumKiyasla('1.11.5', '1.13.3'), -1);
  assert.equal(M.surumKiyasla('2026.9.24', '2026.9.12'), 1);
  assert.equal(M.surumKiyasla('1.13', '1.13.0'), 0);
  assert.equal(M.surumKiyasla('1.10.0', '1.9.9'), 1, 'sözlük değil sayı kıyası');
  assert.equal(M.surumKiyasla('abc', '1.0'), null);
});

test('motorDegistir: yabancı soy (haritada yok) ESKİ → kök+alt+GÖMÜLÜ 5 kopya değişir, yedek ağaç DIŞINDA', async () => {
  const { tmp, kok } = await alanKur();
  try {
    const kYol = await kanonikKur(tmp, 'BIZIM-MOTOR-v2', '2026.9.12');
    const damga = await M.motorDegistir(kok, kYol);
    assert.equal(damga.durum, 'guncel');
    assert.equal(damga.degisen, 4);
    for (const rel of [AD, `book1/${AD}`, `book2/${AD}`, GOMULU]) {
      assert.equal(await fs.readFile(path.join(kok, rel), 'utf8'), 'BIZIM-MOTOR-v2', rel);
    }
    // eski silinmedi, paket ağacının dışına taşındı
    const yedekGomulu = path.join(tmp, '.empp-eski', 'paket', GOMULU);
    assert.equal(await fs.readFile(yedekGomulu, 'utf8'), 'GOMULU-ESKI');
    assert.equal(await fs.pathExists(path.join(kok, '.empp-eski')), false, 'ağaç içine yedek YOK');
    // paket.json birleşti, diğer alanlar korundu
    const pj = JSON.parse(await fs.readFile(path.join(kok, 'paket.json'), 'utf8'));
    assert.equal(pj.setId, 'S1');
    assert.equal(pj.motorSurumu.kanonikSha12, sha12('BIZIM-MOTOR-v2'));
    assert.equal(pj.motorSurumu.kanonikSurum, '2026.9.12');
    // kapı gerçek dosyadan geçer
    const kanonik = await M.kanonikYukle(kYol);
    const kapi = await M.motorKapisi(kok, kanonik);
    assert.equal(kapi.gecti, true);
    assert.equal(kapi.kopyalar.length, 4);
  } finally {
    await fs.remove(tmp);
  }
});

test('MUTASYON: kanonik daha ESKİYSE (haritada paket sürümü yüksek) DEĞİŞTİRMEZ', async () => {
  const { tmp, kok } = await alanKur({ paketMotoru: 'BIZIM-v3', gomulu: 'BIZIM-v3' });
  try {
    const kYol = await kanonikKur(tmp, 'BIZIM-v2', '2026.9.12', { [sha12('BIZIM-v3')]: '2026.9.20' });
    const damga = await M.motorDegistir(kok, kYol);
    assert.equal(damga.degisen, 0);
    assert.ok(damga.kopyalar.every((k) => k.karar === 'yeni'));
    assert.equal(await fs.readFile(path.join(kok, AD), 'utf8'), 'BIZIM-v3');
    assert.equal(await fs.pathExists(path.join(tmp, '.empp-eski')), false);
    const kapi = await M.motorKapisi(kok, await M.kanonikYukle(kYol));
    assert.equal(kapi.gecti, true, 'kanonikten yeni kopya kapıyı düşürmez');
  } finally {
    await fs.remove(tmp);
  }
});

test('MUTASYON: sha eşitse dokunmaz (mtime/içerik aynı kalır)', async () => {
  const { tmp, kok } = await alanKur({ paketMotoru: 'AYNI', gomulu: 'AYNI' });
  try {
    const kYol = await kanonikKur(tmp, 'AYNI', '2026.9.12');
    const once = (await fs.stat(path.join(kok, AD))).mtimeMs;
    const damga = await M.motorDegistir(kok, kYol);
    assert.equal(damga.degisen, 0);
    assert.ok(damga.kopyalar.every((k) => k.karar === 'ayni'));
    assert.equal((await fs.stat(path.join(kok, AD))).mtimeMs, once);
  } finally {
    await fs.remove(tmp);
  }
});

test('GÜVENLİK: kanonik yok → hiçbir şey değişmez, durum bilinmiyor, kapı null (sahte yeşil yok)', async () => {
  const { tmp, kok } = await alanKur();
  try {
    const damga = await M.motorDegistir(kok, path.join(tmp, 'yok', 'kanonik.json'));
    assert.equal(damga.durum, 'bilinmiyor');
    assert.equal(damga.degisen, 0);
    assert.equal(await fs.readFile(path.join(kok, AD), 'utf8'), 'YAYINCI-ESKI');
    const kapi = await M.motorKapisi(kok, null);
    assert.equal(kapi.gecti, null);
  } finally {
    await fs.remove(tmp);
  }
});

test('GÜVENLİK: kanonik.json sha12 ile yanındaki dosya uyuşmazsa kanonik YOK sayılır', async () => {
  const { tmp, kok } = await alanKur();
  try {
    const kYol = await kanonikKur(tmp, 'BIZIM-v2', '2026.9.12');
    await fs.writeFile(path.join(path.dirname(kYol), AD), 'BOZULMUS');
    assert.equal(await M.kanonikYukle(kYol), null);
    const damga = await M.motorDegistir(kok, kYol);
    assert.equal(damga.durum, 'bilinmiyor');
    assert.equal(await fs.readFile(path.join(kok, AD), 'utf8'), 'YAYINCI-ESKI');
  } finally {
    await fs.remove(tmp);
  }
});

test('KAPI: değiştirilmemiş ağaç (yayıncı motoru) kanonik varken düşer', async () => {
  const { tmp, kok } = await alanKur();
  try {
    const kYol = await kanonikKur(tmp, 'BIZIM-v2', '2026.9.12');
    const kapi = await M.motorKapisi(kok, await M.kanonikYukle(kYol));
    assert.equal(kapi.gecti, false);
    assert.equal(kapi.kopyalar.filter((k) => k.karar === 'eski').length, 4);
  } finally {
    await fs.remove(tmp);
  }
});

test('rozetSurumuOku: index.html → main.js parça haritası → i8 sürümü', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rozet-'));
  try {
    const main = 'aaaaaaaaaaaaaaaaaaaa.main.js';
    await fs.writeFile(path.join(tmp, 'index.html'), `<script src="./${main}"></script>`);
    await fs.writeFile(path.join(tmp, main), 'x={356:"bbbbbbbbbbbbbbbbbbbb",70:"cccccccccccccccccccc"}');
    await fs.writeFile(path.join(tmp, 'bbbbbbbbbbbbbbbbbbbb.356.js'), '4147:function(e){e.exports={i8:"1.11.5"}}');
    const r = await M.rozetSurumuOku(tmp);
    assert.equal(r.surum, '1.11.5');
    assert.equal(r.parca, 'bbbbbbbbbbbbbbbbbbbb.356.js');
    assert.equal((await M.rozetSurumuOku(path.join(tmp, 'yok'))).surum, null);
  } finally {
    await fs.remove(tmp);
  }
});
