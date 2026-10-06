'use strict';
/**
 * İmpark okuyucu çıkarıcı (06.10): asar AKIŞINDAN yalnız ölçüm dosyaları; paket diske açılmaz.
 * + paket-cikar.js yedizBul Windows yolu (kasa: `which` yok / MSYS yolu döner).
 * + okuyucu-surumu-kapisi.js paketOlc pardus yolu (yerel + uzak) — mutasyon: 1.12.7 fikstür, kanonik 1.13.14.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const IC = require('./impark-okuyucu-cikar');
const OSK = require('./okuyucu-surumu-kapisi');
const PC = require('./paket-cikar');
const F = require('./fikstur/okuyucu-paket');

const KANONIK = '1.13.14';
const ESKI = '1.12.7';
const ZORUNLU = { KABUL_OKUYUCU_SURUM: '' };
const yedizYok = !F.yediz();

/** Tamponu `boy` baytlık parçalarla akıtan Readable (parça sınırı testleri). */
function parcaliAkis(buf, boy) {
  const parcalar = [];
  for (let i = 0; i < buf.length; i += boy) parcalar.push(buf.subarray(i, i + boy));
  return Readable.from(parcalar, { objectMode: false });
}

test('asarAkisiniAyristir: 7 baytlık parçalarda bile seçilen dosyalar asar.extractFile ile BAYT BAYT aynı', async () => {
  const asar = require('@electron/asar');
  const agac = F.setAgaci([KANONIK, null, ESKI]);
  const d = F.gecici('akis');
  try {
    const a = await F.asarYap(agac, path.join(d, 'app.asar'));
    const buf = fs.readFileSync(a);
    const istenen = ['index.html', 'book1/index.html', `book3/${F.MAIN}`, 'book2/kitap.pdf'];
    for (const boy of [7, 4096, buf.length]) {
      const r = await IC.asarAkisiniAyristir(parcaliAkis(buf, boy), () => istenen);
      assert.deepEqual([...r.dosyalar.keys()].sort(), [...istenen].sort(), `parça ${boy}`);
      for (const rel of istenen) assert.ok(r.dosyalar.get(rel).equals(asar.extractFile(a, rel)), `${rel} @${boy}`);
      assert.deepEqual(r.eksik, []);
      assert.ok(r.liste.dizinler.includes('book2'));
    }
  } finally { F.temizle(agac, d); }
});

test('asarAkisiniAyristir: son gerekli dosyadan sonra akış BIRAKILIR (büyük dolgu okunmaz)', async () => {
  const agac = F.a1Agaci(ESKI, { dolguKb: 2048 });
  const d = F.gecici('erken');
  try {
    const a = await F.asarYap(agac, path.join(d, 'app.asar'));
    const buf = fs.readFileSync(a);
    const r = await IC.asarAkisiniAyristir(parcaliAkis(buf, 64 * 1024),
      (l) => l.dosyalar.map((x) => x.rel).filter(OSK.asarGerekliMi));
    assert.ok(r.dosyalar.has('kapak/index.html'));
    assert.ok(r.okunan < buf.length / 2, `okunan ${r.okunan} / ${buf.length}`);
    const b = await IC.asarAkisiniAyristir(parcaliAkis(buf, 64 * 1024), () => []);
    assert.ok(b.okunan < 200 * 1024, 'yalnız başlık okunur');
    assert.ok(b.liste.dosyalar.some((x) => x.rel === 'zz-varliklar/dolgu.bin'));
  } finally { F.temizle(agac, d); }
});

test('asarAkisiniAyristir: boş akış / asar olmayan veri → anlaşılır hata; unpacked ve link eksik sayılır', async () => {
  await assert.rejects(IC.asarAkisiniAyristir(Readable.from([]), () => []), /asar akışı boş/);
  await assert.rejects(IC.asarAkisiniAyristir(Readable.from([Buffer.from('MZ\x90\x00 bu bir exe gövdesi')]), () => []),
    /asar değil/);
  const l = IC.basliktanListe({ files: { a: { size: 1, offset: '0' }, u: { size: 2, unpacked: true }, k: { link: 'a' },
    d: { files: { b: { size: 3, offset: '1' } } } } });
  assert.deepEqual(l.dosyalar.map((x) => [x.rel, x.unpacked, x.offset]), [['a', false, 0], ['u', true, null], ['d/b', false, 1]]);
  assert.deepEqual(l.dizinler, ['d']);
});

test('kabukAlinti / uzakNodeIfadesi: tek tırnak kaçışı, varsayılan ProBook node yolu', () => {
  assert.equal(IC.kabukAlinti("a'b c"), "'a'\\''b c'");
  assert.match(IC.uzakNodeIfadesi(null), /empp-serit\/node\/bin\/node/);
  assert.equal(IC.uzakNodeIfadesi('/x/node'), "'/x/node'");
});

test('yedizBul Windows: kasa taşınabilir 7-Zip tam yolu; `where` MSYS yolunu ELER; hiçbiri yoksa null', () => {
  const kasa = 'C:\\empp-ajan\\araclar\\7zip\\7z.exe';
  const cagri = [];
  const kos = (k, a) => { cagri.push([k, ...a]); return { status: 1, stdout: '' }; };
  assert.equal(PC.yedizBul({ platform: 'win32', env: {}, varMi: (y) => y === kasa, kos }), kasa);
  assert.equal(cagri.length, 0, 'tam yol varken where çağrılmaz');
  assert.ok(!cagri.some(([k]) => k === 'which'));
  // Program Files kurulumu
  const pf = 'C:\\Program Files\\7-Zip\\7z.exe';
  assert.equal(PC.yedizBul({ platform: 'win32', env: {}, varMi: (y) => y === pf, kos }), pf);
  // where: ilk satır Windows yolu (CRLF)
  const where = (k, a) => (k === 'where' && a[0] === '7za'
    ? { status: 0, stdout: 'D:\\araclar\\7za.exe\r\nE:\\x\\7za.exe\r\n' } : { status: 1, stdout: '' });
  assert.equal(PC.yedizBul({ platform: 'win32', env: {}, varMi: () => false, kos: where }), 'D:\\araclar\\7za.exe');
  // which.exe (Git usr\bin) MSYS yolu döndürse bile kullanılmaz; where MSYS döndürürse elenir
  const msys = (k) => ({ status: 0, stdout: k === 'where' ? '/c/empp-ajan/araclar/7zip/7z\n' : '/c/x/7z\n' });
  assert.equal(PC.yedizBul({ platform: 'win32', env: {}, varMi: () => false, kos: msys }), null);
  // EMPP_7Z her şeyden önce
  assert.equal(PC.yedizBul({ platform: 'win32', env: { EMPP_7Z: 'F:\\7z.exe' }, varMi: () => true, kos }), 'F:\\7z.exe');
  // POSIX: which yolu korunur
  assert.equal(PC.yedizBul({ platform: 'linux', env: {}, varMi: () => false,
    kos: (k, a) => (a[0] === '7z' ? { status: 0, stdout: '/usr/bin/7z\n' } : { status: 1, stdout: '' }) }), '/usr/bin/7z');
});

test('paketOlc pardus (gerçek 7z akışı): 1.12.7 fikstür, kanonik 1.13.14 → RED; kanonik 1.12.7 → GEÇTİ; '
  + 'uyar → GEÇTİ+uyarı', { skip: yedizYok && '7z yok' }, async () => {
  const agac = F.a1Agaci(ESKI, { dolguKb: 512 });
  const d = F.gecici('pardus');
  try {
    const paket = await F.imparkYap(agac, d);
    const r = await OSK.paketOlc({ paket, kanonik: KANONIK, env: ZORUNLU });
    assert.equal(r.karar, 'RED', JSON.stringify(r));
    assert.equal(r.olculen, ESKI);
    assert.equal(r.birimler[0].sayfa, 'kapak/index.html');
    assert.equal(r.cikarma.yontem, 'yerel-akis');
    assert.ok(r.cikarma.bayt < 64 * 1024, `yalnız ölçüm dosyaları: ${r.cikarma.bayt} B`);
    const g = await OSK.paketOlc({ paket, kanonik: ESKI, env: ZORUNLU });
    assert.equal(g.karar, 'GECTI', JSON.stringify(g));
    const u = await OSK.paketOlc({ paket, kanonik: KANONIK, env: { KABUL_OKUYUCU_SURUM: 'uyar' } });
    assert.equal(u.karar, 'GECTI');
    assert.equal(u.hamKarar, 'RED');
    assert.match(u.uyari, /yalnız uyarı/);
    // CLI: çıkış 1 + satırlar (probook-kabul.sh bunları okur)
    const satir = [];
    const c = await OSK.calis([paket, '--platform', 'pardus', '--kanonik', KANONIK], (s) => satir.push(s), ZORUNLU);
    assert.equal(c.kod, 1);
    assert.ok(satir.includes('OKUYUCU_KARAR=RED') && satir.includes(`OKUYUCU_OLCULEN=${ESKI}`), satir.join('\n'));
  } finally { F.temizle(agac, d); }
});

test('paketOlc pardus: asar taşımayan paket → ÖLÇÜLEMEDİ (fail-closed), uyar → GEÇTİ', { skip: yedizYok && '7z yok' },
  async () => {
    const d = F.gecici('bos');
    try {
      const paket = path.join(d, 'bozuk.impark');
      fs.writeFileSync(paket, '#!/bin/bash\nsleep 1\n');
      const satir = [];
      const c = await OSK.calis([paket, '--platform', 'pardus', '--kanonik', KANONIK], (s) => satir.push(s), ZORUNLU);
      assert.equal(c.kod, 1);
      assert.equal(c.sonuc.karar, 'OLCULEMEDI');
      assert.match(c.sonuc.sebepler.join(' '), /asar akışı boş/);
      const u = await OSK.calis([paket, '--platform', 'pardus', '--kanonik', KANONIK], () => {},
        { KABUL_OKUYUCU_SURUM: 'uyar' });
      assert.equal(u.kod, 0);
    } finally { F.temizle(d); }
  });

test('paketOlc UZAK (ssh yerine `bash -c`, gövde stdin\'den `node -`): iki geçiş, seçim yerelde; RED/GEÇTİ',
  { skip: yedizYok && '7z yok' }, async () => {
    const agac = F.setAgaci([KANONIK, null, ESKI]);
    const d = F.gecici('uzak');
    try {
      const paket = await F.imparkYap(agac, d);
      const uzak = { sshArgv: ['bash', '-c'], node: process.execPath };
      const r = await OSK.paketOlc({ paket, uzak, kanonik: KANONIK, env: ZORUNLU });
      assert.equal(r.karar, 'RED', JSON.stringify(r));
      assert.equal(r.cikarma.yontem, 'uzak-akis');
      assert.deepEqual(r.birimler.map((b) => `${b.sayfa}:${b.karar}`),
        ['book1/index.html:ayni', 'book2/index.html:kabuksuz', 'book3/index.html:eski']);
      const g = await OSK.paketOlc({ paket, uzak, kanonik: ESKI, env: ZORUNLU });
      assert.equal(g.hamKarar, 'RED', 'book1 1.13.14 ≠ 1.12.7 (eşitlik ister)');
      await assert.rejects(OSK.paketOlc({ paket: path.join(d, 'yok.impark'), uzak, kanonik: KANONIK, env: ZORUNLU }),
        /uzak çıkarıcı \(çıkış 1\): paket yok/);
      // CLI bayrakları uzak argv'sini kurar (gerçek ssh çağrılmaz: yalnız argv)
      assert.deepEqual(OSK.uzakSshArgv({ konak: 'etapadmin@h', anahtar: '/k' }).slice(-3), ['-i', '/k', 'etapadmin@h']);
      assert.deepEqual(OSK.argumanCoz(['p', '--uzak-konak', 'u@h', '--uzak-node', '/n']).uzakKonak, 'u@h');
    } finally { F.temizle(agac, d); }
  });
