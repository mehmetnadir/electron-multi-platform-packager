'use strict';
/**
 * Statik paket denetçisi — her aile + her RED yolu, sentetik paketlerle.
 * Koşu: npm run test:e2e   (ağır: ~/.empp-agent/agir.sh e2e-test npm run test:e2e)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Readable } = require('stream');
const S = require('./sentetik');
const PD = require('./adimlar/paket-denetle');
const asar = require('./adimlar/asar');
const { icerikTopla } = require('./adimlar/icerik');
const cdnMd5Kiyas = require('./adimlar/cdn-md5-kiyas');

const D = S.geciciDizin('paket-denetle');
process.env.EMPP_E2E_DIZIN = path.join(D, 'rapor');
process.env.EMPP_E2E_CALISMA = path.join(D, 'calisma-varsayilan');
const ARAC_YOK = { osslsigncode: null };
const satir = (r, alt) => r.satirlar.find((s) => s.adim === `paket-denetle/${alt}`);
const durum = (r, alt) => (satir(r, alt) || {}).durum;

function sunucu(dosya, { rangeYok = false, durumKodu = 200, basliklar = {} } = {}) {
  const veri = fs.readFileSync(dosya);
  const sayac = { govdeBayt: 0, istek: 0 };
  const srv = http.createServer((req, res) => {
    sayac.istek += 1;
    if (durumKodu !== 200) {
      res.writeHead(durumKodu, basliklar);
      res.end();
      return;
    }
    const ortak = {
      'Content-Type': 'application/octet-stream',
      'Accept-Ranges': rangeYok ? 'none' : 'bytes',
      ETag: `"${S.md5(veri)}"`,
      ...basliklar,
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, { ...ortak, 'Content-Length': veri.length });
      res.end();
      return;
    }
    const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    if (m && !rangeYok) {
      const a = Number(m[1]);
      const b = Math.min(Number(m[2]), veri.length - 1);
      const p = veri.subarray(a, b + 1);
      sayac.govdeBayt += p.length;
      res.writeHead(206, {
        ...ortak,
        'Content-Length': p.length,
        'Content-Range': `bytes ${a}-${b}/${veri.length}`,
      });
      res.end(p);
      return;
    }
    sayac.govdeBayt += veri.length;
    res.writeHead(200, { ...ortak, 'Content-Length': veri.length });
    res.end(veri);
  });
  return new Promise((coz) =>
    srv.listen(0, '127.0.0.1', () => {
      coz({
        url: `http://127.0.0.1:${srv.address().port}/${path.basename(dosya)}`,
        sayac,
        kapat: () => new Promise((k) => srv.close(k)),
      });
    }),
  );
}

/* ------------------------------------------------------------------ aileler */

test('NSIS imzasız: aile nsis, bütünlük TAM, imza KALDI (imzasız)', async () => {
  const r = await PD.paketDenetle({
    paket: S.nsisYap(path.join(D, 'imzasiz.exe')),
    araclar: ARAC_YOK,
    icerik: false,
  });
  assert.equal(r.ozet.aile, 'nsis');
  assert.equal(durum(r, 'aile'), 'GECTI');
  assert.equal(durum(r, 'butunluk'), 'GECTI');
  assert.equal(durum(r, 'imza'), 'KALDI');
  assert.match(satir(r, 'imza').kanit.olcum.sebep, /imzasız/);
});

test('NSIS imzalı + osslsigncode yok → SARI (dizin var, doğrulanmadı); bütünlük imzayı hesaba katar', async () => {
  const r = await PD.paketDenetle({
    paket: S.nsisYap(path.join(D, 'imzali.exe'), { imzali: true }),
    araclar: ARAC_YOK,
    icerik: false,
  });
  assert.equal(durum(r, 'butunluk'), 'GECTI');
  assert.equal(durum(r, 'imza'), 'SARI');
  assert.match(satir(r, 'imza').kanit.olcum.sebep, /osslsigncode kurulu değil/);
  assert.equal(satir(r, 'imza').kanit.olcum.win_certificate.tur, 2);
});

test('NSIS kesik yükleme → bütünlük KALDI; imza dizini dosya dışında → imza KALDI', async () => {
  const r = await PD.paketDenetle({
    paket: S.nsisYap(path.join(D, 'kesik.exe'), { imzali: true, kes: 50 }),
    araclar: ARAC_YOK,
    icerik: false,
  });
  assert.equal(durum(r, 'butunluk'), 'KALDI');
  assert.equal(durum(r, 'imza'), 'KALDI');
});

test('WIN_CERTIFICATE türü PKCS#7 değil → imza KALDI', async () => {
  const r = await PD.paketDenetle({
    paket: S.nsisYap(path.join(D, 'tur.exe'), { imzali: true, sertifikaTuru: 1 }),
    araclar: ARAC_YOK,
    icerik: false,
  });
  assert.equal(durum(r, 'imza'), 'KALDI');
  assert.match(satir(r, 'imza').kanit.olcum.sebep, /PKCS#7/);
});

test('osslsigncode verify: ok → GECTI · failed → KALDI · imza ok ama zincir/CRL düştü → SARI', async () => {
  const stub = S.betikYaz(
    path.join(D, 'osslsigncode-stub'),
    [
      'case "$STUB_OSSL" in',
      '  ok) printf "Signer\'s certificate:\\n  Subject: /CN=Test Imzaci\\nSignature verification: ok\\nSucceeded\\n"; exit 0;;',
      '  crl) printf "Signature verification: ok\\nCRL verification: failed\\n"; exit 1;;',
      '  *) printf "Signature verification: failed\\n"; exit 1;;',
      'esac',
    ].join('\n'),
  );
  const paket = S.nsisYap(path.join(D, 'ossl.exe'), { imzali: true });
  const kos = async (v) => {
    process.env.STUB_OSSL = v;
    return PD.paketDenetle({ paket, araclar: { osslsigncode: stub }, icerik: false });
  };
  const ok = await kos('ok');
  assert.equal(durum(ok, 'imza'), 'GECTI');
  assert.equal(satir(ok, 'imza').kanit.olcum.imzaci, '/CN=Test Imzaci');
  assert.equal(durum(await kos('fail'), 'imza'), 'KALDI');
  assert.equal(durum(await kos('crl'), 'imza'), 'SARI');
  delete process.env.STUB_OSSL;
});

test('Rar5 SFX: aile sfx-rar5 (WinRAR dizgesiyle); WinRAR dizgesi yoksa da tanınır ve işaretlenir', async () => {
  const r = await PD.paketDenetle({
    paket: S.sfxYap(path.join(D, 'impark.exe')),
    araclar: ARAC_YOK,
    icerik: false,
  });
  assert.equal(r.ozet.aile, 'sfx-rar5');
  assert.equal(satir(r, 'aile').kanit.olcum.winrar_dizgesi, true);
  assert.equal(durum(r, 'imza'), 'SARI');
  const r2 = await PD.paketDenetle({
    paket: S.sfxYap(path.join(D, 'impark2.exe'), { winrar: false }),
    araclar: ARAC_YOK,
    icerik: false,
  });
  assert.equal(satir(r2, 'aile').kanit.olcum.winrar_dizgesi, false);
});

test('AppImage: squashfs ofset 193728, bytes_used TAM → GECTI; kesik → KALDI', async () => {
  const r = await PD.paketDenetle({
    paket: S.appimageYap(path.join(D, 'tam.impark')),
    icerik: false,
  });
  assert.equal(r.ozet.aile, 'appimage');
  assert.equal(satir(r, 'aile').kanit.olcum.squashfs_ofset, 193728);
  assert.equal(durum(r, 'butunluk'), 'GECTI');
  const k = await PD.paketDenetle({
    paket: S.appimageYap(path.join(D, 'kesik.impark'), { kes: 100 }),
    icerik: false,
  });
  assert.equal(durum(k, 'butunluk'), 'KALDI');
  assert.equal(satir(k, 'butunluk').kanit.olcum.durum, 'KESIK');
  assert.equal(satir(k, 'imza'), undefined, 'ELF için imza satırı yok');
});

test('DMG: koly trailer TAM → GECTI; XML ofseti dosya dışında → KALDI', async () => {
  const r = await PD.paketDenetle({ paket: S.dmgYap(path.join(D, 'tam.dmg')), icerik: false });
  assert.equal(r.ozet.aile, 'dmg');
  assert.equal(durum(r, 'butunluk'), 'GECTI');
  const b = await PD.paketDenetle({
    paket: S.dmgYap(path.join(D, 'bozuk.dmg'), { bozuk: true }),
    icerik: false,
  });
  assert.equal(durum(b, 'butunluk'), 'KALDI');
});

test('APK: zip + AndroidManifest → apk; manifest yoksa zip → aile KALDI', async () => {
  const r = await PD.paketDenetle({
    paket: S.apkYap(path.join(D, 'k.apk'), { 'index.html': 'x' }),
    icerik: false,
  });
  assert.equal(r.ozet.aile, 'apk');
  assert.equal(durum(r, 'aile'), 'GECTI');
  assert.equal(durum(r, 'butunluk'), 'GECTI');
  const z = await PD.paketDenetle({
    paket: S.zipYaz(path.join(D, 'duz.zip'), { 'a.txt': 'a' }),
    icerik: false,
  });
  assert.equal(z.ozet.aile, 'zip');
  assert.equal(durum(z, 'aile'), 'KALDI');
});

test('bilinmeyen dosya → aile KALDI, içerik ÖLÇÜLEMEDİ; beklenen aile tutmazsa KALDI', async () => {
  fs.writeFileSync(path.join(D, 'rastgele.bin'), Buffer.alloc(2048, 7));
  const r = await PD.paketDenetle({ paket: path.join(D, 'rastgele.bin') });
  assert.equal(durum(r, 'aile'), 'KALDI');
  assert.equal(durum(r, 'icerik-ac'), 'OLCULEMEDI');
  const b = await PD.paketDenetle({
    paket: S.dmgYap(path.join(D, 'b.dmg')),
    beklenen: { aile: 'nsis' },
    icerik: false,
  });
  assert.equal(durum(b, 'aile'), 'KALDI');
});

test('yerel dosya yok → kaynak ÖLÇÜLEMEDİ (KALDI değil)', async () => {
  const r = await PD.paketDenetle({ paket: path.join(D, 'olmayan.exe') });
  assert.equal(durum(r, 'kaynak'), 'OLCULEMEDI');
});

/* ----------------------------------------------------- içerik değerlendirme */

function degerlendir(agacSecenek, beklenenEk = {}, aile = 'nsis') {
  const anahtar = agacSecenek.anahtar || S.testAnahtari();
  const agac = S.uygulamaAgaci({ anahtar, ...agacSecenek });
  const liste = Object.keys(agac);
  const { secilen } = PD.secimYap(liste);
  const toplanan = new Map(
    [...secilen].filter((k) => agac[k] !== undefined).map((k) => [k, Buffer.from(agac[k])]),
  );
  const bek = {
    md5_43e23: S.md5(S.KANONIK),
    md5_index: S.md5(Buffer.from(agac['index.html'] || agac['build/index.html'] || '')),
    parmak_izi: anahtar.parmakIzi,
    taban: 'https://cdn.ydspublishing.com/guncelleme',
    ...beklenenEk,
  };
  const satirlar = PD.icerikDegerlendir(
    'T1',
    { kok: 'resources/app.asar', liste, toplanan },
    bek,
    aile,
  );
  const d = Object.fromEntries(satirlar.map((s) => [s.adim.replace('paket-denetle/', ''), s]));
  return { d, anahtar, satirlar };
}

test('sağlıklı ağaç: index + ANA klasör 43e23 + G (istemci/anahtar/taban) hepsi GECTI; etk ve set kökü yargılanmaz', () => {
  const { d } = degerlendir({});
  for (const a of ['index', '43e23', 'g-istemci', 'g-anahtar', 'g-taban'])
    assert.equal(d[a].durum, 'GECTI', a);
  const kop = d['43e23'].kanit.olcum.kopyalar;
  assert.deepEqual(
    kop.map((k) => k.yol),
    [S.MOTOR, `book1/${S.MOTOR}`, `book2/${S.MOTOR}`],
  );
  assert.equal(kop[0].yargi, 'set-koku (yargılanmadı)');
  assert.ok(!kop.some((k) => k.yol.includes('etk/')), 'etk alt kopyası kapsam dışı');
});

test('RED: bir kitabın ANA klasöründe eski 43e23 → KALDI ve hangi kitap yazılır', () => {
  const { d } = degerlendir({ kitap2Motor: S.ESKI });
  assert.equal(d['43e23'].durum, 'KALDI');
  assert.deepEqual(d['43e23'].kanit.olcum.farkli, [`book2/${S.MOTOR}`]);
});

test('RED: kök index md5 beklenenden farklı → KALDI; beklenen verilmezse ÖLÇÜLEMEDİ (md5 yine yazılır)', () => {
  assert.equal(degerlendir({}, { md5_index: 'f'.repeat(32) }).d.index.durum, 'KALDI');
  const o = degerlendir({}, { md5_index: null }).d.index;
  assert.equal(o.durum, 'OLCULEMEDI');
  assert.match(o.kanit.olcum.md5, /^[0-9a-f]{32}$/);
});

test('tek kitap: kökteki 43e23 ANA klasördür ve yargılanır; web kökü build/ (İmpark SFX düzeni)', () => {
  const agac = {
    'package.json': '{"main":"main.js"}',
    'main.js': 'x',
    'build/index.html': 'i',
    [`build/${S.MOTOR}`]: S.ESKI,
  };
  const liste = Object.keys(agac);
  const { webKok, secilen } = PD.secimYap(liste);
  assert.equal(webKok, 'build/');
  const toplanan = new Map([...secilen].map((k) => [k, Buffer.from(agac[k])]));
  const s = PD.icerikDegerlendir(
    'T1',
    { kok: 'resources/app', liste, toplanan },
    { md5_43e23: S.md5(S.KANONIK) },
    'sfx-rar5',
  );
  const m = s.find((x) => x.adim.endsWith('43e23'));
  assert.equal(m.durum, 'KALDI');
  assert.equal(m.kanit.olcum.kopyalar[0].yargi, 'ANA');
});

test('RED: G enjeksiyonu yok / modül yok / setKimligi boş → g-istemci KALDI', () => {
  assert.equal(degerlendir({ enjeksiyon: false }).d['g-istemci'].durum, 'KALDI');
  assert.equal(degerlendir({ modul: false }).d['g-istemci'].durum, 'KALDI');
  assert.equal(degerlendir({ setKimligi: '' }).d['g-istemci'].durum, 'KALDI');
  const y = degerlendir({ setJson: false }).d;
  for (const a of ['g-istemci', 'g-anahtar', 'g-taban']) assert.equal(y[a].durum, 'KALDI', a);
});

test('RED: gömülü anahtar üretim anahtarı değil → g-anahtar KALDI; anahtarın kendisi rapora yazılmaz', () => {
  const baska = S.testAnahtari();
  const { d, satirlar } = degerlendir(
    { anahtar: baska },
    { parmak_izi: PD.varsayilanBeklenen().parmak_izi },
  );
  assert.equal(d['g-anahtar'].durum, 'KALDI');
  assert.equal(d['g-anahtar'].kanit.olcum.parmak_izi, baska.parmakIzi);
  assert.ok(
    !JSON.stringify(satirlar).includes(baska.acikB64),
    'açık anahtar metni rapora düşmemeli',
  );
});

test('RED: taban cdn.ydspublishing.com/guncelleme değil → g-taban KALDI', () => {
  assert.equal(
    degerlendir({ taban: 'https://panel-yok.invalid/set-guncelleme' }).d['g-taban'].durum,
    'KALDI',
  );
});

test('Android G: www istemci dosyaları + empp-g-paket.json + empp-set.json → GECTI, sürüm yazılır', () => {
  const anahtar = S.testAnahtari();
  const s2 = androidDegerlendir({ anahtar });
  for (const a of ['g-istemci', 'g-anahtar', 'g-taban']) assert.equal(s2[a].durum, 'GECTI', a);
  assert.equal(s2['g-istemci'].kanit.olcum.paket_surumu, '1.4.2');
  assert.equal(s2['43e23'].durum, 'GECTI');
});

test('RED Android: G istemcisi yok / empp-g-paket.json yok ya da bozuk → g-istemci KALDI', () => {
  const yok = androidDegerlendir({ gIstemci: false })['g-istemci'];
  assert.equal(yok.durum, 'KALDI');
  assert.deepEqual(yok.kanit.olcum.android_www.eksik, [
    'empp-g-istemci.js',
    'empp-g-kabuk.js',
    'empp-g-nacl.js',
  ]);
  assert.equal(androidDegerlendir({ paketJson: null })['g-istemci'].durum, 'KALDI');
  assert.equal(androidDegerlendir({ paketJson: '{bozuk' })['g-istemci'].durum, 'KALDI');
  assert.equal(androidDegerlendir({ paketJson: '{"surum":null}' })['g-istemci'].durum, 'GECTI');
  const hic = androidDegerlendir({ gIstemci: false, paketJson: null, setJson: false });
  for (const a of ['g-istemci', 'g-anahtar', 'g-taban']) assert.equal(hic[a].durum, 'KALDI', a);
});

test('RED: taban panel-yok.invalid (taban verilmemiş) → g-taban KALDI, açık mesajla', () => {
  const t = androidDegerlendir({ taban: 'https://panel-yok.invalid/set-guncelleme' })['g-taban'];
  assert.equal(t.durum, 'KALDI');
  assert.match(t.kanit.olcum.sebep, /panel-yok\.invalid/);
  assert.match(t.kanit.olcum.sebep, /EMPP_GUNCELLEME_TABANI/);
  const e = degerlendir({ taban: 'https://panel-yok.invalid/set-guncelleme' }).d['g-taban'];
  assert.match(e.kanit.olcum.sebep, /ölü adres/);
});

function androidDegerlendir(secenek = {}) {
  const anahtar = secenek.anahtar || S.testAnahtari();
  const agac = S.androidAgaci({ anahtar, ...secenek });
  const liste = Object.keys(agac);
  const { secilen } = PD.secimYap(liste);
  const toplanan = new Map([...secilen].map((k) => [k, Buffer.from(agac[k])]));
  const bek = {
    md5_43e23: S.md5(S.KANONIK),
    parmak_izi: anahtar.parmakIzi,
    taban: 'https://cdn.ydspublishing.com/guncelleme',
  };
  const kaynak = { kok: 'assets/public', liste, toplanan };
  const satirlar = PD.icerikDegerlendir('T4', kaynak, bek, 'apk');
  return Object.fromEntries(satirlar.map((x) => [x.adim.replace('paket-denetle/', ''), x]));
}

/* --------------------------------------------------------------------- asar */

test('asar: yerel okuma ve parça sınırlarında akıştan toplama birebir; hepsi gelince erken kesilir', async () => {
  const agac = {
    'a.txt': 'A'.repeat(10),
    'b/c.bin': Buffer.alloc(5000, 3),
    'z.txt': 'son'.repeat(50),
  };
  const buf = asar.asarYaz(agac);
  const yol = path.join(D, 'x.asar');
  fs.writeFileSync(yol, buf);
  const y = asar.yerelAc(yol);
  assert.deepEqual(
    y.dosyalar.map((f) => f.yol),
    ['a.txt', 'b/c.bin', 'z.txt'],
  );
  assert.equal(y.oku(y.dosyalar[1]).length, 5000);
  const parcalar = [];
  for (let i = 0; i < buf.length; i += 7) parcalar.push(buf.subarray(i, i + 7));
  const r = await asar.akistanTopla(
    Readable.from(parcalar),
    (yollar) => new Set(yollar.filter((y) => y !== 'z.txt')),
  );
  assert.equal(r.toplanan.get('a.txt').toString(), 'A'.repeat(10));
  assert.ok(r.toplanan.get('b/c.bin').equals(Buffer.alloc(5000, 3)));
  assert.equal(r.erkenKesildi, true);
  assert.ok(r.okunanBayt < buf.length, 'z.txt okunmadan kesilmeli');
});

/* ------------------------------------------------ içerik açıcılar (gerçek araç) */

test('APK içeriği gerçek unzip ile: K1/K2 + Android G (empp-g-paket.json okunur)', async () => {
  const anahtar = S.testAnahtari();
  const agac = S.androidAgaci({ anahtar });
  const apk = S.apkYap(path.join(D, 'icerik.apk'), agac);
  const r = await PD.paketDenetle({
    paket: apk,
    beklenen: {
      md5_43e23: S.md5(S.KANONIK),
      md5_index: S.md5(Buffer.from(agac['index.html'])),
      parmak_izi: anahtar.parmakIzi,
    },
    calisma: path.join(D, 'calisma'),
  });
  assert.equal(durum(r, 'icerik-ac'), 'GECTI');
  assert.equal(satir(r, 'icerik-ac').kanit.olcum.kok, 'assets/public');
  assert.ok(satir(r, 'icerik-ac').kanit.olcum.toplanan.includes('empp-g-paket.json'));
  for (const a of ['index', '43e23', 'g-istemci', 'g-anahtar', 'g-taban'])
    assert.equal(durum(r, a), 'GECTI', a);
  const gsiz = S.androidAgaci({ anahtar, gIstemci: false, paketJson: null });
  const r2 = await PD.paketDenetle({
    paket: S.apkYap(path.join(D, 'icerik-gsiz.apk'), gsiz),
    calisma: path.join(D, 'calisma'),
  });
  assert.equal(durum(r2, 'g-istemci'), 'KALDI');
});

test(
  'NSIS içerik açıcı gerçek 7z ile: $PLUGINSDIR/app-64.7z → resources/app.asar akışı',
  { skip: !S.yedizVar() && '7z yok' },
  async () => {
    const anahtar = S.testAnahtari();
    const agac = S.uygulamaAgaci({ anahtar, kitap2Motor: S.ESKI });
    const arsiv = S.nsisIcerikArsiviYap(S.geciciDizin('paket-denetle/nsis7z'), agac);
    const r = await icerikTopla(arsiv, 'nsis', (l) => PD.secimYap(l).secilen, {
      calisma: path.join(D, 'calisma-nsis'),
    });
    assert.equal(r.tur, 'asar');
    assert.equal(r.yuk, '$PLUGINSDIR/app-64.7z');
    const s = PD.icerikDegerlendir(
      'T1',
      r,
      {
        md5_43e23: S.md5(S.KANONIK),
        parmak_izi: anahtar.parmakIzi,
        taban: 'https://cdn.ydspublishing.com/guncelleme',
      },
      'nsis',
    );
    const d = Object.fromEntries(s.map((x) => [x.adim.replace('paket-denetle/', ''), x.durum]));
    assert.equal(d['43e23'], 'KALDI', 'book2 eski motor yakalanmalı');
    assert.equal(d['g-istemci'], 'GECTI');
    assert.equal(d['g-anahtar'], 'GECTI');
  },
);

test('SFX içerik açıcı unrar lb / p -inul ile (sahte unrar): web kökü build/', async () => {
  const dz = S.geciciDizin('paket-denetle/sfx');
  const exe = S.sfxYap(path.join(dz, 'kitap.exe'));
  const agac = {
    'resources/app/package.json': '{"main":"main.js"}',
    'resources/app/main.js': 'x',
    'resources/app/build/index.html': 'idx',
    [`resources/app/build/${S.MOTOR}`]: S.KANONIK,
  };
  S.agacYaz(`${exe}.d`, agac);
  fs.writeFileSync(`${exe}.liste`, `${Object.keys(agac).join('\n')}\n`);
  const unrar = S.betikYaz(
    path.join(dz, 'unrar-stub'),
    'case "$1" in lb) cat "$2.liste";; p) cat "$3.d/$4";; esac',
  );
  const r = await PD.paketDenetle({
    paket: exe,
    araclar: { unrar, osslsigncode: null },
    beklenen: { md5_43e23: S.md5(S.KANONIK), md5_index: S.md5(Buffer.from('idx')) },
    calisma: path.join(dz, 'calisma'),
  });
  assert.equal(durum(r, 'icerik-ac'), 'GECTI');
  assert.equal(durum(r, 'index'), 'GECTI');
  assert.equal(durum(r, '43e23'), 'GECTI');
  assert.equal(durum(r, 'g-istemci'), 'KALDI', "İmpark SFX'te G yok");
});

test('araç yoksa içerik ÖLÇÜLEMEDİ ve eksik araç adı yazılır', async () => {
  const r = await PD.paketDenetle({
    paket: S.nsisYap(path.join(D, 'aracsiz.exe')),
    araclar: { '7z': null, '7zz': null, osslsigncode: null },
  });
  assert.equal(durum(r, 'icerik-ac'), 'OLCULEMEDI');
  assert.equal(satir(r, 'icerik-ac').kanit.olcum.eksik_arac, '7z');
  for (const a of ['index', '43e23', 'g-istemci']) assert.equal(durum(r, a), 'OLCULEMEDI', a);
  const u = await PD.paketDenetle({
    paket: S.sfxYap(path.join(D, 'unrarsiz.exe')),
    araclar: { unrar: null, osslsigncode: null },
  });
  assert.equal(satir(u, 'icerik-ac').kanit.olcum.eksik_arac, 'unrar');
});

test(
  'DMG gerçek hdiutil ile (-nobrowse -readonly): aile + bütünlük + içerik',
  { skip: process.platform !== 'darwin' && 'yalnız macOS' },
  async () => {
    const dz = S.geciciDizin('paket-denetle/dmg');
    const anahtar = S.testAnahtari();
    const kaynak = path.join(dz, 'kaynak');
    S.agacYaz(kaynak, {
      'Kitap.app/Contents/Resources/app.asar': S.asarYaz(S.uygulamaAgaci({ anahtar })),
    });
    const dmg = path.join(dz, 'kitap.dmg');
    const c = require('child_process').spawnSync(
      '/usr/bin/hdiutil',
      [
        'create',
        '-quiet',
        '-ov',
        '-fs',
        'HFS+',
        '-format',
        'UDZO',
        '-volname',
        'E2E',
        '-srcfolder',
        kaynak,
        dmg,
      ],
      { encoding: 'utf8', timeout: 100000 },
    );
    assert.equal(c.status, 0, c.stderr);
    const r = await PD.paketDenetle({
      paket: dmg,
      beklenen: { md5_43e23: S.md5(S.KANONIK), parmak_izi: anahtar.parmakIzi },
      calisma: path.join(dz, 'calisma'),
    });
    assert.equal(r.ozet.aile, 'dmg');
    assert.equal(durum(r, 'butunluk'), 'GECTI');
    assert.equal(durum(r, 'icerik-ac'), 'GECTI');
    assert.equal(durum(r, '43e23'), 'GECTI');
    assert.equal(durum(r, 'g-anahtar'), 'GECTI');
  },
);

/* ---------------------------------------------------------------------- CDN */

test('CDN: yalnız HEAD + Range — aile/imza/bütünlük ölçülür, tam indirme YOK', async () => {
  const paket = S.nsisYap(path.join(D, 'cdn.exe'), { imzali: true, veri: 6 * 1024 * 1024 });
  const s = await sunucu(paket);
  try {
    const r = await PD.paketDenetle({ url: s.url, calisma: path.join(D, 'calisma-cdn') });
    assert.equal(durum(r, 'kaynak'), 'GECTI');
    assert.equal(r.ozet.aile, 'nsis');
    assert.equal(durum(r, 'butunluk'), 'GECTI');
    assert.equal(durum(r, 'imza'), 'SARI');
    assert.match(satir(r, 'imza').kanit.olcum.sebep, /indirilmedi/);
    assert.equal(durum(r, 'icerik-ac'), 'OLCULEMEDI');
    const boyut = fs.statSync(paket).size;
    assert.ok(
      s.sayac.govdeBayt < boyut,
      `sunucudan ${s.sayac.govdeBayt} B çıktı, dosya ${boyut} B`,
    );
    assert.equal(r.ozet.indirilen, s.sayac.govdeBayt);
  } finally {
    await s.kapat();
  }
});

test('CDN Range desteklemiyorsa baştan okuma kesilir, ortadan okuma ÖLÇÜLEMEDİ olur (tam indirme yok)', async () => {
  const paket = S.nsisYap(path.join(D, 'rangesiz.exe'), { imzali: true, veri: 6 * 1024 * 1024 });
  const s = await sunucu(paket, { rangeYok: true });
  try {
    const r = await PD.paketDenetle({ url: s.url, calisma: path.join(D, 'calisma-rs') });
    assert.equal(r.ozet.aile, 'nsis');
    assert.equal(durum(r, 'imza'), 'OLCULEMEDI');
    assert.ok(
      r.ozet.indirilen < fs.statSync(paket).size,
      `istemci ${r.ozet.indirilen} B aldı (tam indirme olmamalı)`,
    );
    assert.ok(r.ozet.aralik.hata, 'Range yoksa aralık izi ölçülemez');
  } finally {
    await s.kapat();
  }
});

test('CDN 404 → kaynak KALDI; Cloudflare challenge 403 → ÖLÇÜLEMEDİ', async () => {
  const p = S.dmgYap(path.join(D, 'yok.dmg'));
  const s404 = await sunucu(p, { durumKodu: 404 });
  const s403 = await sunucu(p, { durumKodu: 403, basliklar: { 'cf-mitigated': 'challenge' } });
  try {
    assert.equal(durum(await PD.paketDenetle({ url: s404.url }), 'kaynak'), 'KALDI');
    assert.equal(durum(await PD.paketDenetle({ url: s403.url }), 'kaynak'), 'OLCULEMEDI');
  } finally {
    await s404.kapat();
    await s403.kapat();
  }
});

test('--indir: tam indirme md5 + içerik; cdn-md5-kiyas üretilen md5 ile GECTI/KALDI', async () => {
  const agac = S.uygulamaAgaci({ setJson: false, modul: false });
  const apk = S.apkYap(path.join(D, 'indir.apk'), agac);
  const s = await sunucu(apk);
  try {
    const r = await PD.paketDenetle({
      url: s.url,
      indir: true,
      beklenen: { md5_43e23: S.md5(S.KANONIK) },
      calisma: path.join(D, 'calisma-indir'),
    });
    assert.equal(durum(r, 'indir'), 'GECTI');
    assert.equal(r.ozet.md5, S.md5(fs.readFileSync(apk)));
    assert.equal(durum(r, 'icerik-ac'), 'GECTI');
    const sonuc = { girdi: { tur: 'url', deger: s.url }, ...r };
    const kos = (uretilen) =>
      cdnMd5Kiyas.kos({
        test: 'T1',
        paketSonuclari: [sonuc],
        beklenen: { uretilen_md5: uretilen },
        testeUygun: () => true,
      });
    assert.equal((await kos(r.ozet.md5))[0].durum, 'GECTI');
    assert.equal((await kos('0'.repeat(32)))[0].durum, 'KALDI');
    assert.equal((await kos(null))[0].durum, 'OLCULEMEDI');
  } finally {
    await s.kapat();
  }
});

test('cdn-md5-kiyas: çok parçalı ETag md5 sayılmaz → ÖLÇÜLEMEDİ', () => {
  assert.equal(
    cdnMd5Kiyas.cdnMd5({ ozet: { etag: '"cf1c4ae353cd1d061c2690df594006fd-116"' } }).md5,
    null,
  );
  assert.equal(
    cdnMd5Kiyas.cdnMd5({ ozet: { etag: '"cf1c4ae353cd1d061c2690df594006fd"' } }).md5,
    'cf1c4ae353cd1d061c2690df594006fd',
  );
});

/* ------------------------------------------------ CDN ↔ üretilen: kısmi eşlik */

function uzakYerel(ua, ya, ozetEk = {}) {
  const uzak = {
    girdi: { tur: 'url', deger: 'https://cdn/x.impark' },
    ozet: { aile: 'appimage', boyut: ua.boyut, etag: '"abc123-19"', aralik: ua, ...ozetEk },
  };
  const yerel = ya
    ? { girdi: { tur: 'paket', deger: '/u/x.impark' }, ozet: { aile: 'appimage', aralik: ya } }
    : null;
  return [uzak, yerel];
}

test('kısmi eşlik: çok parçalı ETag + aynı boyut ve ilk/son pencere md5 → SARI (GECTI değil)', () => {
  const a = { boyut: 100, pencere: 25, bas_md5: 'a', son_md5: 'b' };
  const k = cdnMd5Kiyas.kiyasla(...uzakYerel(a, { ...a }));
  assert.equal(k.durum, 'SARI');
  assert.equal(k.olcum.sinif, 'kismi-eslik');
  assert.match(k.olcum.sebep, /tam md5 değil/);
});

test('RED kısmi eşlik: boyut farklı → KALDI; aynı boyut son pencere farklı → KALDI', () => {
  const a = { boyut: 100, pencere: 25, bas_md5: 'a', son_md5: 'b' };
  assert.equal(cdnMd5Kiyas.kiyasla(...uzakYerel(a, { ...a, boyut: 101 })).durum, 'KALDI');
  const k = cdnMd5Kiyas.kiyasla(...uzakYerel(a, { ...a, son_md5: 'c' }));
  assert.equal(k.durum, 'KALDI');
  assert.match(k.olcum.sebep, /son_md5/);
});

test('R2 üst verisi sha256 ↔ üretilen sha256: eşit GECTI, farklı KALDI; yalnız boyut SARI/KALDI', () => {
  const a = { boyut: 100, pencere: 25, bas_md5: 'a', son_md5: 'b' };
  const [uzak] = uzakYerel(a, null, { meta: { sha256: 'F'.repeat(64) } });
  assert.equal(cdnMd5Kiyas.kiyasla(uzak, null, { uretilen_sha256: 'f'.repeat(64) }).durum, 'GECTI');
  assert.equal(cdnMd5Kiyas.kiyasla(uzak, null, { uretilen_sha256: 'e'.repeat(64) }).durum, 'KALDI');
  const [u2] = uzakYerel(a, null);
  assert.equal(cdnMd5Kiyas.kiyasla(u2, null, { uretilen_boyut: 100 }).durum, 'SARI');
  assert.equal(cdnMd5Kiyas.kiyasla(u2, null, { uretilen_boyut: 99 }).durum, 'KALDI');
  assert.equal(cdnMd5Kiyas.kiyasla(u2, null, {}).durum, 'OLCULEMEDI');
});

test('uçtan uca kısmi eşlik: CDN (Range) ↔ yerel üretilen aynı dosya SARI, son bayt farklı KALDI', async () => {
  const yerel = S.appimageYap(path.join(D, 'uretilen.impark'), { bytesUsed: 9 * 1024 * 1024 });
  const bozuk = path.join(D, 'cdn-bozuk.impark');
  const b = fs.readFileSync(yerel);
  b[b.length - 1] ^= 0xff;
  fs.writeFileSync(bozuk, b);
  const ayni = await sunucu(yerel, { basliklar: { ETag: '"0123456789abcdef0123456789abcdef-3"' } });
  const farkli = await sunucu(bozuk, {
    basliklar: { ETag: '"0123456789abcdef0123456789abcdef-3"' },
  });
  try {
    const y = {
      girdi: { tur: 'paket', deger: yerel },
      ...(await PD.paketDenetle({ paket: yerel, icerik: false })),
    };
    for (const [s, beklenenDurum] of [
      [ayni, 'SARI'],
      [farkli, 'KALDI'],
    ]) {
      const u = {
        girdi: { tur: 'url', deger: s.url },
        ...(await PD.paketDenetle({ url: s.url, icerik: false })),
      };
      assert.ok(u.ozet.indirilen < b.length, 'tam indirme olmamalı');
      const [satirK] = await cdnMd5Kiyas.kos({
        test: 'T2',
        paketSonuclari: [u, y],
        beklenen: {},
        testeUygun: () => true,
      });
      assert.equal(satirK.durum, beklenenDurum, s.url);
      assert.equal(satirK.kanit.olcum.uretilen_paket, yerel);
    }
  } finally {
    await ayni.kapat();
    await farkli.kapat();
  }
});

/**
 * db-kanit — book-update DB'sinden (sahte ssh/pipeline-sql) okunan file_sha256/file_size_bytes
 * ile CDN kıyası. GERÇEK ssh/pipeline-sql hiçbir testte koşmaz (dbCalistirSsh her zaman sahte);
 * db-kaniti.js'in kendi birim testleri tests/e2e/db-kaniti.test.js'te.
 */
test('db-kanit: --indir + kitapId/platform → DB sha256 = CDN tam sha256 → GECTI', async () => {
  const agac = S.uygulamaAgaci({ setJson: false, modul: false });
  const apk = S.apkYap(path.join(D, 'db-kanit-gecti.apk'), agac);
  const s = await sunucu(apk);
  try {
    const gercekSha256 = require('crypto').createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
    let cagrildiKomut = null;
    const r = await PD.paketDenetle({
      url: s.url,
      indir: true,
      kitapId: '45482',
      platform: 'android',
      calisma: path.join(D, 'calisma-db-kanit-gecti'),
      dbCalistirSsh: (komut) => {
        cagrildiKomut = komut;
        return { status: 0, stdout: `file_sha256\tfile_size_bytes\n${gercekSha256}\t${fs.statSync(apk).size}\n` };
      },
    });
    assert.equal(durum(r, 'db-kanit'), 'GECTI');
    assert.match(cagrildiKomut, /book_id='45482'/);
    assert.match(cagrildiKomut, /platform='android'/);
    const s0 = satir(r, 'db-kanit');
    assert.equal(s0.kanit.olcum.yontem, 'sha256 (tam, --indir)');
    assert.equal(s0.kanit.olcum.db_sha256, gercekSha256);
    assert.equal(s0.kanit.olcum.cdn_sha256, gercekSha256);
  } finally {
    await s.kapat();
  }
});

test('db-kanit: DB sha256 farklı (üretici ezmiş/bozuk yükleme) → KALDI', async () => {
  const agac = S.uygulamaAgaci({ setJson: false, modul: false });
  const apk = S.apkYap(path.join(D, 'db-kanit-kaldi.apk'), agac);
  const s = await sunucu(apk);
  try {
    const r = await PD.paketDenetle({
      url: s.url,
      indir: true,
      kitapId: '45482',
      platform: 'android',
      calisma: path.join(D, 'calisma-db-kanit-kaldi'),
      dbCalistirSsh: () => ({
        status: 0,
        stdout: `file_sha256\tfile_size_bytes\n${'0'.repeat(64)}\t999\n`,
      }),
    });
    assert.equal(durum(r, 'db-kanit'), 'KALDI');
  } finally {
    await s.kapat();
  }
});

test('db-kanit: --indir YOK (yalnız --url) → hafif kip, boyut kıyası (yöntem: boyut)', async () => {
  const agac = S.uygulamaAgaci({ setJson: false, modul: false });
  const apk = S.apkYap(path.join(D, 'db-kanit-boyut.apk'), agac);
  const s = await sunucu(apk);
  try {
    const r = await PD.paketDenetle({
      url: s.url,
      kitapId: '45482',
      platform: 'android',
      icerik: false,
      calisma: path.join(D, 'calisma-db-kanit-boyut'),
      dbCalistirSsh: () => ({
        status: 0,
        stdout: `file_sha256\tfile_size_bytes\n${'a'.repeat(64)}\t${fs.statSync(apk).size}\n`,
      }),
    });
    assert.equal(durum(r, 'db-kanit'), 'GECTI');
    assert.equal(satir(r, 'db-kanit').kanit.olcum.yontem, 'boyut (hafif — tam sha256 için --indir gerekir)');
  } finally {
    await s.kapat();
  }
});

test('db-kanit: DB satırı yok (migration uygulanmamış / ajan henüz göndermedi) → ÖLÇÜLEMEDİ', async () => {
  const agac = S.uygulamaAgaci({ setJson: false, modul: false });
  const apk = S.apkYap(path.join(D, 'db-kanit-yok.apk'), agac);
  const s = await sunucu(apk);
  try {
    const r = await PD.paketDenetle({
      url: s.url,
      kitapId: '45482',
      platform: 'android',
      icerik: false,
      calisma: path.join(D, 'calisma-db-kanit-yok'),
      dbCalistirSsh: () => ({ status: 0, stdout: 'file_sha256\tfile_size_bytes\n' }),
    });
    assert.equal(durum(r, 'db-kanit'), 'OLCULEMEDI');
  } finally {
    await s.kapat();
  }
});

test('db-kanit: ssh/pipeline-sql hata verirse (ör. bağlantı kopuk) ÖLÇÜLEMEDİ — FIRLATMAZ, paket-denetle çökmez', async () => {
  const agac = S.uygulamaAgaci({ setJson: false, modul: false });
  const apk = S.apkYap(path.join(D, 'db-kanit-hata.apk'), agac);
  const s = await sunucu(apk);
  try {
    const r = await PD.paketDenetle({
      url: s.url,
      kitapId: '45482',
      platform: 'android',
      icerik: false,
      calisma: path.join(D, 'calisma-db-kanit-hata'),
      dbCalistirSsh: () => ({ status: 255, stdout: '', stderr: 'ssh: connect timed out' }),
    });
    assert.equal(durum(r, 'db-kanit'), 'OLCULEMEDI');
    assert.match(satir(r, 'db-kanit').kanit.olcum.sebep, /DB sorgusu:/);
  } finally {
    await s.kapat();
  }
});

test('db-kanit: kitapId/platform verilmezse adım hiç koşmaz (mevcut davranış korunur)', async () => {
  const agac = S.uygulamaAgaci({ setJson: false, modul: false });
  const apk = S.apkYap(path.join(D, 'db-kanit-yok-parametre.apk'), agac);
  const s = await sunucu(apk);
  try {
    const r = await PD.paketDenetle({ url: s.url, icerik: false, calisma: path.join(D, 'calisma-db-kanit-param') });
    assert.equal(satir(r, 'db-kanit'), undefined);
  } finally {
    await s.kapat();
  }
});
