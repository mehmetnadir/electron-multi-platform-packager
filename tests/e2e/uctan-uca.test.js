'use strict';
/**
 * Koşucu iskeleti: plan, kos (kuru), rapor dosyaları, sonuç şeması, bildirim kanalı, yazma kapıları.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('./sentetik');

const D = S.geciciDizin('uctan-uca');
const RAPOR = path.join(D, 'rapor');
process.env.EMPP_E2E_DIZIN = RAPOR;
process.env.EMPP_E2E_CALISMA = path.join(D, 'calisma');
process.env.EMPP_E2E_AGIR = '0';
// Ağsız: pipeline-sql sahte (0 satır), İmpark/G ağ ölçümü kapalı, canlı kayıt yolları geçici dizinde.
const KO = S.kesifOrtami(path.join(D, 'kesif'));
Object.assign(process.env, KO.env);
const U = require('./uctan-uca');

const DURUMLAR = new Set(['GECTI', 'KALDI', 'SARI', 'OLCULEMEDI']);

function semaUygun(s) {
  assert.deepEqual(Object.keys(s).sort(), ['adim', 'durum', 'kanit', 'sure_ms', 'test']);
  assert.ok(DURUMLAR.has(s.durum), s.durum);
  assert.equal(typeof s.adim, 'string');
  assert.equal(typeof s.kanit, 'object');
  assert.ok(Number.isInteger(s.sure_ms) && s.sure_ms >= 0);
}

async function sessiz(fn) {
  const eski = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = eski;
  }
}

test('plan: T1-T5 her adımın modülü var, ölçütü yazılı; yazan adımlar işaretli', () => {
  const p = U.plan(['T1', 'T2', 'T3', 'T4', 'T5']);
  assert.deepEqual(
    p.map((t) => t.test),
    ['T1', 'T2', 'T3', 'T4', 'T5'],
  );
  for (const t of p) {
    assert.ok(t.adimlar.length > 0);
    for (const a of t.adimlar) {
      assert.ok(fs.existsSync(path.join(__dirname, '..', '..', a.modul)), a.modul);
      assert.ok(a.olcut && a.olcut.length > 10, `${a.adim} ölçütsüz`);
    }
  }
  const yazan = p
    .flatMap((t) => t.adimlar)
    .filter((a) => a.yazar)
    .map((a) => a.adim);
  assert.ok(yazan.includes('t5-tetik') && yazan.includes('g-uygula'));
  assert.ok(
    p
      .find((t) => t.test === 'T1')
      .adimlar.some((a) => a.adim === 'paket-statik' && a.durum === 'hazır'),
  );
});

test('bilinmeyen test reddedilir; kuru + --indir birlikte verilebilir (indirme salt okumadır)', async () => {
  assert.throws(() => U.testListesi('T9'), /bilinmeyen test/);
  const r = await sessiz(() =>
    U.kos({ test: 'T1', kuru: true, indir: true, paketler: [], urller: [], beklenen: {} }),
  );
  assert.equal(r.kuru, true);
  assert.equal(r.kesif.durum, 'satir-yok', 'keşif sahte pipeline-sql ile koştu (ağ yok)');
});

test('kos --kuru: rapor JSON + MD yazılır, her satır şemaya uyar, paket testlere aileyle dağıtılır', async () => {
  const exe = S.nsisYap(path.join(D, 'kitap.exe'), { imzali: true });
  const impark = S.appimageYap(path.join(D, 'kitap.impark'), { kes: 10 });
  const apk = S.apkYap(path.join(D, 'kitap.apk'), { 'index.html': 'x' });
  const r = await sessiz(() =>
    U.kos({
      test: 'T1,T2,T3,T4,T5',
      kitap: '74390',
      kuru: true,
      paketler: [exe, impark, apk],
      urller: [],
      beklenen: { md5_43e23: 'a'.repeat(32) },
    }),
  );
  assert.ok(fs.existsSync(r.dosyalar.json) && fs.existsSync(r.dosyalar.md));
  assert.match(path.basename(r.dosyalar.json), /^\d{8}-\d{4}(-\d+)?\.json$/);
  assert.equal(
    path.basename(r.dosyalar.md),
    path.basename(r.dosyalar.json).replace(/\.json$/, '.md'),
  );
  const disk = JSON.parse(fs.readFileSync(r.dosyalar.json, 'utf8'));
  assert.equal(disk.sonuclar.length, r.sonuclar.length);
  for (const s of disk.sonuclar) semaUygun(s);
  // kanıttaki `girdi` HER ZAMAN girdinin yolu/URL'sidir (ölçüm alanı onu ezemez — zip girdi sayısı dersi)
  const girdiler = new Set([exe, impark, apk]);
  for (const s of disk.sonuclar) {
    const g = s.kanit.olcum && s.kanit.olcum.girdi;
    if (g !== undefined)
      assert.ok(girdiler.has(g), `${s.test} ${s.adim}: girdi=${JSON.stringify(g)}`);
  }
  assert.ok(disk.sonuclar.some((s) => s.test === 'T4' && s.kanit.olcum.girdi === apk));
  const t1 = r.sonuclar.filter((s) => s.test === 'T1');
  assert.ok(t1.some((s) => s.adim === 'paket-denetle/aile' && s.kanit.olcum.aile === 'nsis'));
  assert.ok(
    !t1.some((s) => s.kanit.olcum && s.kanit.olcum.girdi === impark),
    "impark T1'e girmemeli",
  );
  const t2 = r.sonuclar.filter((s) => s.test === 'T2');
  assert.ok(
    t2.some((s) => s.adim === 'paket-denetle/butunluk' && s.durum === 'KALDI'),
    "kesik impark T2'de KALDI",
  );
  assert.equal(r.test_ozet.T2, 'KALDI');
  const aile1 = t1.find((s) => s.adim === 'paket-denetle/aile');
  assert.equal(aile1.kanit.olcum.girdi, exe);
  assert.equal(r.genel, 'KALDI');
  const tetik = r.sonuclar.find((s) => s.adim === 't5-tetik');
  assert.equal(tetik.durum, 'OLCULEMEDI');
  assert.match(tetik.kanit.olcum.kuru, /ATILMADI/);
  const md = fs.readFileSync(r.dosyalar.md, 'utf8');
  assert.match(md, /Genel: \*\*KALDI\*\*/);
  assert.match(md, /\| T2 \| KALDI \|/);
});

test('T1 NSIS bekler: SFX gelirse aile KALDI; T3 içerik açıldıysa açma kanıtı K1/K2 yanında', async () => {
  const statik = require('./adimlar/paket-statik');
  const ac = {
    test: 'paket',
    adim: 'paket-denetle/icerik-ac',
    durum: 'GECTI',
    kanit: { olcum: { kok: 'resources/app.asar' } },
    sure_ms: 5,
  };
  const sonuc = {
    girdi: { tur: 'url', deger: 'https://cdn/x.exe' },
    ozet: { aile: 'sfx-rar5' },
    satirlar: [
      {
        test: 'paket',
        adim: 'paket-denetle/aile',
        durum: 'GECTI',
        kanit: { olcum: { aile: 'sfx-rar5' } },
        sure_ms: 1,
      },
      ac,
      {
        test: 'paket',
        adim: 'paket-denetle/index',
        durum: 'GECTI',
        kanit: { olcum: { md5: 'a' } },
        sure_ms: 0,
      },
    ],
  };
  const t1 = await statik.kos({ test: 'T1', paketSonuclari: [sonuc] });
  const aile = t1.find((s) => s.adim === 'paket-denetle/aile');
  assert.equal(aile.durum, 'KALDI');
  assert.equal(aile.kanit.olcum.beklenen, 'nsis');
  const t3 = await statik.kos({ test: 'T3', paketSonuclari: [sonuc] });
  assert.deepEqual(
    t3.map((s) => s.adim),
    ['K1-K2-icerik-ac', 'K1-index'],
  );
  assert.ok(t3.every((s) => s.test === 'T3' && s.kanit.olcum.girdi === 'https://cdn/x.exe'));
});

test('uygun girdi yoksa test sessizce geçmez: paket-statik ÖLÇÜLEMEDİ "girdi yok"', async () => {
  const r = await sessiz(() =>
    U.kos({ test: 'T4', kuru: true, paketler: [], urller: [], beklenen: {} }),
  );
  const s = r.sonuclar.find((x) => x.adim === 'paket-statik');
  assert.equal(s.durum, 'OLCULEMEDI');
  assert.match(s.kanit.olcum.sebep, /girdi yok/);
  assert.notEqual(r.genel, 'GECTI');
});

test('yazan adım demo kitap dışında koşmaz (kuru olmasa da)', async () => {
  const r = await sessiz(() =>
    U.kos({ test: 'T5', kitap: '45482', paketler: [], urller: [], beklenen: {} }),
  );
  const tetik = r.sonuclar.find((s) => s.adim === 't5-tetik');
  assert.match(tetik.kanit.olcum.reddedildi, /74390/);
});

test('bildirim: GECTI → kosucu, diğer → bekci; bildir iki argümanla çağrılır (yalnız --bildir)', async () => {
  const g = U.bildirimMesaji(
    { genel: 'GECTI', testler: ['T1'], sonuclar: [{}], sayac: {} },
    { md: '/x.md' },
  );
  assert.equal(g.kanal, 'kosucu');
  const kayit = path.join(D, 'bildir-kayit.txt');
  fs.writeFileSync(kayit, '');
  process.env.EMPP_E2E_BILDIR = S.betikYaz(
    path.join(D, 'bildir-stub'),
    `printf '%s\\n' "$#" "$1" "$2" > "${kayit}"`,
  );
  try {
    const r = await sessiz(() =>
      U.kos({ test: 'T5', kuru: true, bildir: true, paketler: [], urller: [], beklenen: {} }),
    );
    const [n, kanal, mesaj] = fs.readFileSync(kayit, 'utf8').split('\n');
    assert.equal(n, '2');
    assert.equal(kanal, 'bekci');
    assert.match(mesaj, /e2e OLCULEMEDI: T5 /);
    assert.ok(mesaj.includes(r.dosyalar.json));
    assert.equal(r.bildirim.rc, 0);
    fs.writeFileSync(kayit, '');
    await sessiz(() => U.kos({ test: 'T5', kuru: true, paketler: [], urller: [], beklenen: {} }));
    assert.equal(fs.readFileSync(kayit, 'utf8'), '', '--bildir yoksa bildirim yok');
  } finally {
    delete process.env.EMPP_E2E_BILDIR;
  }
});

test('rapor: son raporun özetini basar; --liste son raporları listeler', async () => {
  const cikti = [];
  const eski = process.stdout.write.bind(process.stdout);
  const eskiLog = console.log;
  process.stdout.write = (s) => {
    cikti.push(String(s));
    return true;
  };
  console.log = (...a) => cikti.push(a.join(' '));
  try {
    assert.equal(await U.ana(['rapor']), 0);
    assert.equal(await U.ana(['rapor', '--liste']), 0);
  } finally {
    process.stdout.write = eski;
    console.log = eskiLog;
  }
  const metin = cikti.join('\n');
  assert.match(metin, /# Uçtan uca sağlık/);
  assert.match(metin, /\d{8}-\d{4}.*\.json/);
});
