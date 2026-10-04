'use strict';

/**
 * imza-yuva-win.js (windows-kasa imza gözcüsü) — KURU yerel kökte: hazırla, pencere → takas → imza,
 * tavan → exe-remove isteği + yeniden hazırlama + 2. deneme → çıkış 3, yabancı imzalı → 4,
 * hizli-kontrol, Authenticode hükmü, istek dosyası güvenliği. Canlı yuvaya/SMB'ye dokunmaz.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Y = require('./imza-yuva-win');
const A = require('./authenticode-win');
const I = require('./imza-istek');

const E = 0x80;
const CN = 'İm Park Bilişim';
const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `iyw-${ad}-`));

function peExe(boyut, tohum = 1) {
  const b = Buffer.alloc(boyut);
  for (let i = 0; i < boyut; i += 1) b[i] = (i * 31 + tohum * 7) & 0xff;
  b.fill(0, 0, 0x200);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(E, 0x3c);
  b.write('PE\0\0', E, 'latin1');
  b.writeUInt16LE(0x014c, E + 4);
  b.writeUInt16LE(0x10b, E + 24);
  return b;
}

function imzalaBuf(orj, { cn = CN, bmp = false } = {}) {
  const hiza = (8 - (orj.length % 8)) % 8;
  let ad = Buffer.from(cn, bmp ? 'utf16le' : 'utf8');
  if (bmp) { ad = Buffer.from(ad); for (let i = 0; i + 1 < ad.length; i += 2) { const t = ad[i]; ad[i] = ad[i + 1]; ad[i + 1] = t; } }
  const zaman = Buffer.concat([Buffer.from([0x18, 0x0f]), Buffer.from('20261003091500Z', 'latin1')]);
  const sertifika = Buffer.concat([Buffer.alloc(300, 0x5a), ad, Buffer.alloc(50, 0x11), zaman, Buffer.alloc(200, 0x22)]);
  const wc = Buffer.alloc(8);
  wc.writeUInt32LE(8 + sertifika.length, 0);
  wc.writeUInt16LE(0x0200, 4);
  wc.writeUInt16LE(0x0002, 6);
  const blok = Buffer.concat([wc, sertifika]);
  const imzali = Buffer.concat([orj, Buffer.alloc(hiza), blok]);
  imzali.writeUInt32LE(0x12345678, E + 88);
  imzali.writeUInt32LE(orj.length + hiza, E + 24 + 96 + 32);
  imzali.writeUInt32LE(blok.length, E + 24 + 96 + 36);
  return imzali;
}

function ortam() {
  const kok = tmp('kok');
  const is = tmp('is');
  fs.mkdirSync(path.join(kok, '66902'), { recursive: true });
  const exe = path.join(is, 'runner-1-Kitap-2.0.1-Setup.exe');
  const buf = peExe(5000, 3);
  fs.writeFileSync(exe, buf);
  const yuva = path.join(kok, '66902', 'windows.exe');
  fs.writeFileSync(yuva, peExe(3000, 9)); // önceki iş
  const istek = tmp('istek');
  const env = { KURU: '1', KURU_DIZIN: kok, ARALIK_SN: '0.02', SMB_SHA: '1', EMPP_IMZA_ISTEK_DIZINI: istek };
  return { kok, is, exe, buf, yuva, istek, env };
}

async function kos(argv, env, bag) {
  const satir = [];
  const kod = await Y.ana(argv, { env, platform: 'darwin', out: (s) => satir.push(s), err: (s) => satir.push(s), bag });
  return { kod, cikti: satir.join('\n') };
}

/** İmpark taklidi: yuvayı izler; önce kendi dosyasını koyar, takastan sonra imzalar. */
function sahteImpark(o, { imzaFn = imzalaBuf, gecikmeMs = 60, imzala = true } = {}) {
  let dur = false;
  let adim = 0;
  const dongu = async () => {
    while (!dur) {
      await new Promise((r) => setTimeout(r, gecikmeMs));
      if (adim === 0) { fs.writeFileSync(o.yuva, peExe(4000, 5)); adim = 1; continue; }
      if (adim === 1 && imzala) {
        let cur = null;
        try { cur = fs.readFileSync(o.yuva); } catch (_) { cur = null; }
        if (cur && cur.equals(o.buf)) { fs.writeFileSync(o.yuva, imzaFn(o.buf)); adim = 2; }
      }
    }
  };
  const p = dongu();
  return async () => { dur = true; await p; };
}

test('hazirla: _hazir/<ad> kopyası + geri okuma doğrulanır', async () => {
  const o = ortam();
  const r = await kos(['hazirla', o.exe], o.env);
  assert.equal(r.kod, 0, r.cikti);
  assert.match(r.cikti, /HAZIR — boyut\+sha256 DOĞRULANDI/);
  assert.ok(fs.readFileSync(path.join(o.kok, '_hazir', path.basename(o.exe))).equals(o.buf));
});

test('bekle-ve-tak: pencere → takas → imza → İMZALI (aynı log işaretleri)', async () => {
  const o = ortam();
  assert.equal((await kos(['hazirla', o.exe], o.env)).kod, 0);
  const durdur = sahteImpark(o);
  const r = await kos(['bekle-ve-tak', o.exe], { ...o.env, TAVAN_SN: '20' });
  await durdur();
  assert.equal(r.kod, 0, r.cikti);
  assert.match(r.cikti, /PENCERE BEKLENİYOR/);
  assert.match(r.cikti, /PENCERE: İmpark dosyası yuvada/);
  assert.match(r.cikti, /takas 1\/3: yuva geri okundu, boyut\+sha256 EŞİT/);
  assert.match(r.cikti, /İMZALI: /);
  const imzali = path.join(o.kok, 'imzali', 'runner-1-Kitap-2.0.1-Setup-imzali.exe');
  assert.ok(fs.readFileSync(imzali).equals(imzalaBuf(o.buf)));
  assert.equal(fs.readdirSync(o.istek).length, 0, 'ilk denemede tetik isteğini serit atar, betik değil');
});

test('takas bozulursa 3 deneme, sonra çıkış 4', async () => {
  const o = ortam();
  assert.equal((await kos(['hazirla', o.exe], o.env)).kod, 0);
  process.env.KURU_TAKAS_BOZ = '3';
  try {
    const durdur = sahteImpark(o, { imzala: false });
    const r = await kos(['bekle-ve-tak', o.exe], { ...o.env, TAVAN_SN: '20' });
    await durdur();
    assert.equal(r.kod, 4, r.cikti);
    assert.match(r.cikti, /takas 3\/3: geri okuma TUTMADI/);
  } finally { delete process.env.KURU_TAKAS_BOZ; }
});

test('yuvadaki imzalı dosya bizim değilse çıkış 4', async () => {
  const o = ortam();
  assert.equal((await kos(['hazirla', o.exe], o.env)).kod, 0);
  const yabanci = (b) => { const x = Buffer.from(b); x[x.length - 7] ^= 0xff; return imzalaBuf(x); };
  const durdur = sahteImpark(o, { imzaFn: yabanci });
  const r = await kos(['bekle-ve-tak', o.exe], { ...o.env, TAVAN_SN: '20' });
  await durdur();
  assert.equal(r.kod, 4, r.cikti);
  assert.match(r.cikti, /bizim exe DEĞİL/);
});

test('iki deneme de tavanı doldurursa: exe-remove + exe-create istekleri, yeniden hazırlama, çıkış 3', async () => {
  const o = ortam();
  assert.equal((await kos(['hazirla', o.exe], o.env)).kod, 0);
  const r = await kos(['bekle-ve-tak', o.exe], { ...o.env, TAVAN_SN: '0.3', TAVAN2_SN: '0.3', TETIK: '1' });
  assert.equal(r.kod, 3, r.cikti);
  assert.match(r.cikti, /YENİDEN DENEME/);
  assert.match(r.cikti, /2\. deneme de tavanı doldu/);
  const istekler = fs.readdirSync(o.istek).filter((a) => a.endsWith('.json')).sort();
  assert.deepEqual(istekler.map((a) => I.AD_DESENI.exec(a)[2]), ['exe-remove', 'exe-create']);
  const ic = JSON.parse(fs.readFileSync(path.join(o.istek, istekler[0]), 'utf8'));
  assert.equal(ic.exe, path.basename(o.exe));
  assert.equal(I.istekKomutu(istekler[0], fs.readFileSync(path.join(o.istek, istekler[0]), 'utf8')).argv.join(' '),
    'yayincilikadm book exe-remove --windows --yes 66902');
});

test('KURU: SMB/UNC kökü reddedilir (çıkış 2)', async () => {
  const o = ortam();
  const r = await kos(['hazirla', o.exe], { ...o.env, KURU_DIZIN: '\\\\172.17.2.23\\Storage7' });
  assert.equal(r.kod, 2);
  assert.match(r.cikti, /yerel KURU_DIZIN şart/);
});

test('canlı win32 varsayılan kökü Storage7 UNC (172.17.2.23), Authenticode açık', () => {
  const o = Y.ayarlar({}, {}, 'win32');
  assert.equal(o.kok, Y.UNC_KOK);
  assert.ok(o.kok.startsWith('\\\\172.17.2.23\\Storage7\\'));
  assert.equal(o.authenticode, true);
  assert.equal(o.tavanSn, 180 * 60);
  assert.equal(o.tavan2Sn, 60 * 60);
});

test('canlı win32 FAIL-CLOSED: yerel yuva kökü reddedilir (çıkış 2); macOS ve KURU etkilenmez (04.10)', () => {
  assert.throws(() => Y.ayarlar({ EMPP_IMZA_YUVA_KOKU: 'C:\\Users\\Administrator\\yuva' }, {}, 'win32'),
    (e) => e instanceof Y.CikisHatasi && e.kod === 2 && /UNC olmalı/.test(e.message));
  assert.equal(Y.ayarlar({ EMPP_IMZA_YUVA_KOKU: Y.UNC_KOK }, {}, 'win32').kok, Y.UNC_KOK);
  assert.doesNotThrow(() => Y.ayarlar({ EMPP_IMZA_YUVA_KOKU: '/tmp/yerel-yuva' }, {}, 'darwin'));
});

test('hizli-kontrol: imzalı+bizim 0 · imzasız 3 · yabancı imzacı 4 · gövde farklı 4 · BMPString imzacı 0', async () => {
  const o = ortam();
  const yaz = (ad, b) => { const p = path.join(o.is, ad); fs.writeFileSync(p, b); return p; };
  const buyuk = peExe(1200000, 4);
  const orj = yaz('orj.exe', buyuk);
  const s = (p, q) => Y.hizliKontrol(p, q, { beklenenCn: CN });
  const r0 = await s(yaz('imzali.exe', imzalaBuf(buyuk)), orj);
  assert.equal(r0.kod, 0, r0.satirlar.join('\n'));
  assert.match(r0.satirlar.join('\n'), /İMZALI ve BİZİM/);
  assert.match(r0.satirlar.join('\n'), /zaman damgası 2026-10-03 09:15:00 UTC/);
  assert.equal((await s(orj, orj)).kod, 3);
  assert.equal((await s(yaz('yab.exe', imzalaBuf(buyuk, { cn: 'Baska Firma' })), orj)).kod, 4);
  const degisik = Buffer.from(buyuk); degisik[1000] ^= 1;
  assert.equal((await s(yaz('deg.exe', imzalaBuf(degisik)), orj)).kod, 4);
  assert.equal((await s(yaz('bmp.exe', imzalaBuf(buyuk, { bmp: true })), orj)).kod, 0);
});

const GERCEK_AC = { // kasada 45550 imzalı exe üzerinde ölçülen alanlar (03.10)
  Status: 'Valid', StatusMessage: 'Signature verified.', SignatureType: 'Authenticode',
  Signer: 'CN=İm Park Bilişim Elektronik Basın Yayın ve Reklam. Eğt. LTD. STİ., O=İm Park Bilişim Elektronik Basın Yayın ve Reklam. Eğt. LTD. STİ., L=Yenimahalle, S=Ankara, C=TR',
  TimeStamper: 'CN=DigiCert SHA256 RSA4096 Timestamp Responder 2026 1, O="DigiCert, Inc.", C=US',
  Zincir: [
    'CN=İm Park Bilişim Elektronik Basın Yayın ve Reklam. Eğt. LTD. STİ., O=İm Park Bilişim, C=TR',
    'CN=DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1, O="DigiCert, Inc.", C=US',
    'CN=DigiCert Trusted Root G4, OU=www.digicert.com, O=DigiCert Inc, C=US',
  ],
};
const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');

test('Authenticode hükmü: gerçek kasa çıktısı geçer; Status/imzacı/zaman damgası/DigiCert eksikleri düşer', () => {
  const k = A.authenticodeKarari({ kod: 0, cikti: b64(GERCEK_AC) }, CN);
  assert.equal(k.gecti, true, k.sebep);
  assert.match(k.imzaci, /^İm Park Bilişim Elektronik/);
  assert.match(k.zamanDamgasi, /DigiCert SHA256 RSA4096 Timestamp/);
  const d = (deg) => A.authenticodeKarari({ kod: 0, cikti: b64({ ...GERCEK_AC, ...deg }) }, CN);
  assert.match(d({ Status: 'HashMismatch' }).sebep, /Status HashMismatch/);
  assert.match(d({ Status: 'NotSigned' }).sebep, /Status NotSigned/);
  assert.match(d({ Signer: 'CN=Baska Firma, C=TR' }).sebep, /imzacı beklenen/);
  assert.match(d({ TimeStamper: null }).sebep, /zaman damgası/);
  assert.match(d({ Zincir: [GERCEK_AC.Zincir[0], 'CN=Sahte CA', 'CN=Sahte Kök'] }).sebep, /DigiCert yok/);
  assert.match(A.authenticodeKarari({ kod: 1, cikti: 'hata' }, CN).sebep, /powershell çıkış 1/);
  assert.match(A.authenticodeKarari({ kod: 0, cikti: 'çöp!' }, CN).sebep, /çözülemedi/);
  assert.match(A.authenticodeKarari({ hata: 'ENOENT' }, CN).sebep, /başlatılamadı/);
});

test('Authenticode çıktısı: EMPPAC işareti, araya stderr CLIXML karışsa da çözülür (kasa 04.10 ölçümü)', () => {
  const clixml = '#< CLIXML\r\n<Objs Version="1.1.0.1"><Obj S="progress"><AV>Preparing modules for first use.</AV></Obj></Objs>';
  const isaretli = `${A.ISARET}${b64(GERCEK_AC)}`;
  assert.equal(A.authenticodeKarari({ kod: 0, cikti: `${isaretli}${clixml}` }, CN).gecti, true);
  assert.equal(A.authenticodeKarari({ kod: 0, cikti: `${clixml}\r\n${isaretli}` }, CN).gecti, true);
  // eski biçim (işaretsiz, tek base64) hâlâ çözülür
  assert.equal(A.authenticodeKarari({ kod: 0, cikti: b64(GERCEK_AC) }, CN).gecti, true);
  // işaretsiz + arkada CLIXML → çözülemez (eski hatanın kendisi; işaret bunun için var)
  assert.match(A.authenticodeKarari({ kod: 0, cikti: `${b64(GERCEK_AC)}${clixml}` }, CN).sebep, /çözülemedi/);
  // boş çıktı (detached powershell: stdout boru dışına) → çözülemedi, asla geçmez
  assert.match(A.authenticodeKarari({ kod: 0, cikti: '' }, CN).sebep, /çözülemedi/);
  assert.match(A.PS_BETIK, /\$ProgressPreference = 'SilentlyContinue'/);
  assert.match(A.PS_BETIK, /'EMPPAC:' \+ \[Convert\]::ToBase64String/);
});

test('psKos: ayrık değil, yalnız stdout çözülür; stderr karışmaz; çıkış ≠ 0 ise stderr sebebe girer', async () => {
  const b = b64(GERCEK_AC);
  const ok = await A.psKos([process.execPath, '-e',
    `process.stderr.write('#< CLIXML <Objs/>');process.stdout.write('${A.ISARET}${b}')`]);
  assert.equal(ok.kod, 0);
  assert.equal(ok.cikti, `${A.ISARET}${b}`);
  assert.match(ok.hataCikti, /CLIXML/);
  assert.equal(A.authenticodeKarari(ok, CN).gecti, true);
  const kotu = await A.psKos([process.execPath, '-e', "process.stderr.write('patladi');process.exit(3)"]);
  assert.equal(kotu.kod, 3);
  assert.match(A.authenticodeKarari(kotu, CN).sebep, /powershell çıkış 3: patladi/);
  let secenek = null;
  await A.psKos(['x'], { kosucu: (k, a, o) => { secenek = o; throw new Error('yok'); } });
  assert.equal(secenek.detached, undefined, 'detached Windows\'ta stdout\'u kaybettirir');
  const za = await A.psKos([process.execPath, '-e', 'setTimeout(()=>{},5000)'], { zamanAsimiMs: 200 });
  assert.equal(za.zamanAsimi, true);
});

test('authenticodeDogrula: komutKos (ayrık) VERİLSE DE kullanılmaz; psKos/kos ile koşar, yol ortamdan', async () => {
  let komutKosCagrildi = false;
  let gelen = null;
  const k = await A.authenticodeDogrula('C:\\x\\k.exe', {
    komutKos: async () => { komutKosCagrildi = true; return { kod: 0, cikti: '' }; },
    beklenenImzaci: CN,
    kos: async (argv, o) => { gelen = { argv, o }; return { kod: 0, cikti: `${A.ISARET}${b64(GERCEK_AC)}` }; },
  });
  assert.equal(komutKosCagrildi, false);
  assert.equal(k.gecti, true, k.sebep);
  assert.equal(gelen.o.env.EMPP_AUTHENTICODE_YOL, 'C:\\x\\k.exe');
  assert.equal(gelen.argv[0], 'powershell.exe');
});

test('Authenticode argv: -EncodedCommand UTF-16LE, yol ortamdan (argv\'de dosya yolu yok)', () => {
  const argv = A.authenticodeArgv();
  assert.equal(argv[0], 'powershell.exe');
  const betik = Buffer.from(argv[argv.length - 1], 'base64').toString('utf16le');
  assert.equal(betik, A.PS_BETIK);
  assert.match(betik, /\$env:EMPP_AUTHENTICODE_YOL/);
});

test('canlı win32 imza doğrulaması Authenticode\'u çağırır; imzacı yanlışsa 4, Status kötüyse 3', async () => {
  const o = ortam();
  const imzali = path.join(o.is, 'k.exe');
  fs.writeFileSync(imzali, imzalaBuf(o.buf));
  const ay = { ...Y.ayarlar(o.env, {}, 'darwin'), authenticode: true, beklenenCn: CN };
  const g = (sonuc) => new Y.Gozcu(ay, o.exe, { log: () => {}, authenticode: async () => sonuc });
  const gz = g({ gecti: true, imzaci: `${CN} LTD`, zamanDamgasi: 'TS' }); await gz.hedef();
  assert.equal(await gz.imzaDogrula(imzali), 0);
  const g4 = g({ gecti: false, sebep: 'imzacı', imzaci: 'Baska' }); await g4.hedef();
  assert.equal(await g4.imzaDogrula(imzali), 4);
  const g3 = g({ gecti: false, sebep: 'Status NotTrusted', imzaci: `${CN} LTD` }); await g3.hedef();
  assert.equal(await g3.imzaDogrula(imzali), 3);
});

test('imza isteği: beyaz liste dışı komut yazılamaz; köprü yalnız sabit argv kurar, bayat/sahte ad reddedilir', async () => {
  const d = tmp('ist');
  await assert.rejects(I.istekYaz(d, 'rm -rf'), /bilinmeyen komut/);
  const yol = await I.istekYaz(d, 'exe-create', { exe: 'C:\\x\\a.exe' });
  const ad = path.basename(yol);
  const ic = fs.readFileSync(yol, 'utf8');
  assert.deepEqual(I.istekKomutu(ad, ic).argv, ['yayincilikadm', 'book', 'exe-create', '66902', '--wait', '0']);
  assert.equal(JSON.parse(ic).exe, 'a.exe');
  assert.equal(I.istekKomutu('x; rm.json', ic).argv, null);
  assert.equal(I.istekKomutu(ad, JSON.stringify({ komut: 'exe-remove' })).argv, null, 'içerik/ad uyuşmazlığı');
  assert.match(I.istekKomutu(ad, ic, { simdiMs: Date.now() + 7 * 3600 * 1000 }).sebep, /bayat/);
  assert.equal(fs.readdirSync(d).filter((a) => a.endsWith('.part')).length, 0);
});
