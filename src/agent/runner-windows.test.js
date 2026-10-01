'use strict';

/**
 * Runner WINDOWS ŞERİDİ — uçtan uca (gerçek `processJob`) + saf kararlar (2026-09-26).
 *
 * Sözleşme: `.claude/docs/windows-paketleme-sozlesmesi.md` [ONAYLI] toplu akış 1-5 + madde 13 G.
 * Kanıtlanan: imzasız yayın yolu YOK — imza zaman aşımında, imza doğrulaması düşünce, G kapısı
 * RED verince R2'ye yazılan bayt SIFIR; başarılı yolda R2'ye giden dosya imzalı kopyadır.
 *
 * Hiçbir gerçek dış sisteme dokunulmaz: paketleyici (3001) ve book-update API'si yerel sahte HTTP
 * sunucusu; imza yuvası, osslsigncode, statik kapı ve başsız kabul sahte betik; kilit, yuva kökü,
 * kanıt dizini mkdtemp altında. SMB/İmpark/R2/pipeline'a istek GİTMEZ.
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

// TEST YALITIMI (2026-09-28, agent-test-borcu-20260928 — bkz. test-yalitim.js).
const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();

const SRC = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
const RUNNER = require('./runner.js');
const { CONFIG, processJob } = RUNNER;
const W = require('./windows-serit');
const { etkinYetenekler, mapPlatform } = require('./runner-helpers');

YALITIM.configUygula(CONFIG);
after(() => YALITIM.temizle());

const AYRAC = '// ---------------------------------------------------------------------------\n';
const PROCESS_JOB = SRC.slice(SRC.indexOf('async function processJob'), SRC.indexOf(`${AYRAC}// Main loops`));
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `rwin-${ad}-`));

// ---------------------------------------------------------------------------
// Sahte PE: MZ + PE32 başlığı (NSIS yükleyicileri PE32), güvenlik dizini boş.
// ---------------------------------------------------------------------------
const E = 0x80;
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

/** İmzala: 8 bayta hizala, WIN_CERTIFICATE (PKCS#7) ekle, CheckSum + güvenlik dizini girdisini yaz. */
function imzalaBuf(orj) {
  const hiza = (8 - (orj.length % 8)) % 8;
  const sertifika = Buffer.alloc(2000, 0x5a);
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

const OSSL_OK = `PE checksum   : 0002AB07

Signature Index: 0  (Primary Signature)

Message digest algorithm  : SHA384
Current message digest    : F832F44798DD68F1D7DE88E48A0EC0C6
Calculated message digest : F832F44798DD68F1D7DE88E48A0EC0C6

Signer's certificate:
\t------------------
\tSigner #0:
\t\tSubject: CN=İm Park Bilişim Elektronik Basın Yayın ve Reklam. Eğt. LTD. STİ.,O=İm Park Bilişim,L=Yenimahalle,ST=Ankara,C=TR
\t\tIssuer : CN=DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1,O=DigiCert\\, Inc.,C=US

Countersignatures:
\tTimestamp time: Sep 26 09:22:55 2026 GMT
\tSigning time: Sep 26 09:22:55 2026 GMT

Signature CRL verification: ok
Signature verification: ok

Number of verified signatures: 1
Succeeded
`;

// ---------------------------------------------------------------------------
// Sahte dış araçlar (betik dosyaları mkdtemp'te)
// ---------------------------------------------------------------------------
function sahteAraclar() {
  const d = tmp('arac');
  const node = process.execPath;
  const yaz = (ad, govde) => { const p = path.join(d, ad); fs.writeFileSync(p, govde, { mode: 0o755 }); return p; };
  const gunluk = path.join(d, 'gunluk.txt');
  const kaydet = `const G=${JSON.stringify(gunluk)};const kaydet=(s)=>require('fs').appendFileSync(G,s+'\\n');`;

  // imza-yuva-smb.sh taklidi: hazirla / bekle-ve-tak / hizli-kontrol
  const imzaJs = yaz('sahte-imza.js', `#!${node}
${kaydet}
const fs=require('fs'),path=require('path');
const [k,a,b]=process.argv.slice(2); const kip=process.env.SAHTE_IMZA_KIP||'basarili';
const kok=process.env.SAHTE_YUVA_KOK;
kaydet('imza '+k+' '+path.basename(a||'')+' SMB_SHA='+process.env.SMB_SHA+' TETIK='+process.env.TETIK);
if(k==='hazirla'){fs.mkdirSync(path.join(kok,'_hazir'),{recursive:true});fs.copyFileSync(a,path.join(kok,'_hazir',path.basename(a)));process.exit(0);}
if(k==='hizli-kontrol'){process.exit(0);}
if(k!=='bekle-ve-tak'){process.exit(2);}
console.log('PENCERE BEKLENİYOR — exe-create tetiği şimdi çekilebilir');
if(kip==='asili'){setTimeout(()=>{},60000);return;}
if(kip==='tavan'){console.log('2. deneme de tavanı doldu');process.exit(3);}
${imzalaBuf.toString()}
const E=${E};
let orj=fs.readFileSync(a); if(kip==='yabanci'){orj=Buffer.from(orj);orj[orj.length-5]^=0xff;}
const s=imzalaBuf(orj);
const dz=process.env.IMZALI_DIZIN; fs.mkdirSync(dz,{recursive:true});
fs.writeFileSync(path.join(dz,path.basename(a,'.exe')+'-imzali.exe'),s);
fs.mkdirSync(path.join(kok,'66902'),{recursive:true}); fs.writeFileSync(path.join(kok,'66902','windows.exe'),s);
console.log('İMZALI'); process.exit(0);
`);
  const imzaSh = yaz('sahte-imza-yuva.sh', `#!/bin/bash\nexec ${JSON.stringify(node)} ${JSON.stringify(imzaJs)} "$@"\n`);

  const ossl = yaz('sahte-osslsigncode', `#!${node}
${kaydet}
kaydet('ossl '+process.argv.slice(2).map((x)=>require('path').basename(x)).join(' '));
if((process.env.SAHTE_OSSL_KIP||'ok')==='ok'){process.stdout.write(${JSON.stringify(OSSL_OK)});process.exit(0);}
process.stdout.write('Signature verification: failed\\n\\nNumber of verified signatures: 0\\nFailed\\n');process.exit(1);
`);

  const kapi = yaz('sahte-kapi.js', `#!${node}
${kaydet}
const fs=require('fs'),os=require('os'),path=require('path');
const exe=process.argv[2]; kaydet('kapi '+path.basename(exe)+' '+process.argv.slice(3).join(' '));
const g=fs.mkdtempSync(path.join(os.tmpdir(),'empp-kapi-'));
fs.mkdirSync(path.join(g,'app','resources','app'),{recursive:true});
fs.writeFileSync(path.join(g,'app','resources','app','index.html'),'<html>kok-index</html>');
console.log('Paket: '+exe); console.log('Çıkarım: '+g);
const m=[]; for(let no=1;no<=15;no+=1){m.push({no,ad:'m'+no,durum:(no===3||no===5)?'ÖLÇÜLEMEDİ':(no===7?'RAPOR':'PASS'),detay:'d'});}
if(process.env.SAHTE_KAPI_KIP==='g-red'){m[12].durum='FAIL';m[12].detay='empp-set.json yok';}
const kod=m.some((x)=>x.durum==='FAIL')?1:3;
console.log(JSON.stringify({paket:exe,boyut:1,maddeler:m,kod},null,2));
console.log('(geçici dizin tutuldu: '+g+')'); process.exit(kod);
`);

  const kabul = yaz('sahte-kabul.js', `#!${node}
${kaydet}
kaydet('kabul '+require('path').basename(process.argv[2])+' '+process.argv.slice(3).join(' '));
console.log('[kabul] SONUÇ: GEÇTİ'); process.exit(0);
`);

  const bildir = yaz('sahte-bildir', `#!${node}
${kaydet}
kaydet('bildir '+process.argv.slice(2).join(' | '));
`);
  const tetik = [node, '-e', `require('fs').appendFileSync(${JSON.stringify(gunluk)}, 'tetik\\n')`];
  const temizle = [node, '-e', `require('fs').appendFileSync(${JSON.stringify(gunluk)}, 'yuva-temizle\\n')`];
  const oku = () => (fs.existsSync(gunluk) ? fs.readFileSync(gunluk, 'utf8') : '');
  return { d, imzaSh, ossl, kapi, kabul, bildir, tetik, temizle, oku };
}

// ---------------------------------------------------------------------------
// Sahte paketleyici (3001) + sahte book-update API / R2
// ---------------------------------------------------------------------------
async function dinle(isleyici) {
  const s = http.createServer(isleyici);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${s.address().port}`, kapat: () => new Promise((r) => s.close(r)) };
}

function govdeOku(req) {
  return new Promise((r) => { const p = []; req.on('data', (d) => p.push(d)); req.on('end', () => r(Buffer.concat(p))); });
}

async function sahtePaketleyici(exeBuf) {
  const istekler = [];
  const durum = { paketGovdesi: null };
  const sunucu = await dinle(async (req, res) => {
    istekler.push(`${req.method} ${req.url}`);
    const govde = await govdeOku(req);
    const json = (kod, v) => { res.writeHead(kod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.url === '/api/upload-build') return json(200, { sessionId: 's1' });
    if (req.url === '/api/logos') return json(200, []);
    if (req.url === '/api/package') { durum.paketGovdesi = JSON.parse(govde.toString()); return json(200, { jobId: 'j1' }); }
    if (req.url === '/api/package-status/j1') {
      return json(200, { job: { status: 'completed', results: {
        windows: { success: true, filename: 'x-Setup.exe', size: exeBuf.length },
        guncellemePaketi: { tarYolu: '/tmp/yok/guncelleme.tar.gz', surum: 'abc', imzali: true },
      } } });
    }
    if (req.url === '/api/download/j1/windows') { res.writeHead(200); return res.end(exeBuf); }
    if (req.url === '/api/download/j1/guncelleme') { res.writeHead(200); return res.end(Buffer.from('tar')); }
    if (req.method === 'DELETE' && req.url === '/api/delete-job/j1') return json(200, { ok: true });
    return json(404, {});
  });
  return { ...sunucu, istekler, durum };
}

async function sahteApi() {
  const kayit = { istekler: [], putlar: [], sonuclar: [] };
  let taban = '';
  const sunucu = await dinle(async (req, res) => {
    kayit.istekler.push(`${req.method} ${req.url}`);
    const govde = await govdeOku(req);
    const json = (kod, v) => { res.writeHead(kod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.url === '/agents/test/result/presign') {
      return json(200, { uploadUrl: `${taban}/r2/put`, r2ObjectKey: 'softwares/74390/Test - YDS.exe',
        publicUrl: 'https://cdn.example/softwares/74390/Test - YDS.exe', contentType: 'application/x-msdownload' });
    }
    if (req.method === 'PUT' && req.url === '/r2/put') { kayit.putlar.push({ md5: md5(govde), boyut: govde.length }); res.writeHead(200); return res.end(); }
    if (req.url === '/agents/test/result') { kayit.sonuclar.push(JSON.parse(govde.toString())); return json(200, { ok: true }); }
    if (req.url === '/agents/test/release') { (kayit.release = kayit.release || []).push(JSON.parse(govde.toString())); return json(200, { ok: true }); }
    return json(404, {});
  });
  taban = sunucu.url;
  return { ...sunucu, kayit };
}

// ---------------------------------------------------------------------------
// Ortam kurulumu + processJob koşusu
// ---------------------------------------------------------------------------
const WIN_ALANLARI = Object.keys(W.varsayilanAyarlar());

async function windowsIsiKostur({ is = {}, kip = {}, ayar = {}, arsivYok = false } = {}) {
  const exeBuf = peExe(1_200_000);
  const araclar = sahteAraclar();
  const paketleyici = await sahtePaketleyici(exeBuf);
  const api = await sahteApi();
  const yuvaKok = tmp('yuva');
  const kanitDizini = tmp('kanit');
  const arsiv = tmp('arsiv');
  fs.mkdirSync(path.join(arsiv, '74390'));
  // build.zip GERÇEK zip (assets/ içerir): içeriksiz kaynak kapısının ZIP yolu (icerik-kapisi-zip,
  // 26.09) arşiv/HIT kaynağını okur; düz metin artık (haklı olarak) [kaynak-iceriksiz] RED alır.
  const buildZip = new AdmZip();
  buildZip.addFile('index.html', Buffer.from('<html></html>'));
  buildZip.addFile('assets/74390/thumbs/1.jpg', Buffer.from('build-zip'));
  const buildZipBuf = buildZip.toBuffer();
  fs.writeFileSync(path.join(arsiv, '74390', 'build.zip'), buildZipBuf);
  if (!arsivYok) fs.writeFileSync(path.join(arsiv, '74390', 'kaynak.json'), JSON.stringify({
    dosya: 'build.zip', md5: md5(buildZipBuf), boyut: buildZipBuf.length, etiket: 'test',
    impark_kaynagi: 'yds-v51.exe' }));

  const eskiConfig = {};
  for (const k of ['apiBase', 'packagerApi', 'kaynakYokDurumDosyasi', ...WIN_ALANLARI]) eskiConfig[k] = CONFIG[k];
  // Her koşu kendi özet-bildirim durumuyla (aralık önceki koşudan etkilenmesin).
  CONFIG.kaynakYokDurumDosyasi = path.join(tmp('kaynak-yok'), 'durum.json');
  const ENV = {
    EMPP_RUNNER_WINDOWS: '1', EMPP_KAYNAK_ARSIVI: arsiv, EMPP_SOURCE_CACHE: tmp('cache'),
    EMPP_BILDIR_IKILI: araclar.bildir, EMPP_BILDIRIM: '1', AGENT_UPLOAD_RATE: '',
    SAHTE_YUVA_KOK: yuvaKok, SAHTE_IMZA_KIP: kip.imza || 'basarili', SAHTE_OSSL_KIP: kip.ossl || 'ok',
    SAHTE_KAPI_KIP: kip.kapi || 'pass',
  };
  const eskiEnv = {};
  for (const k of Object.keys(ENV)) { eskiEnv[k] = process.env[k]; process.env[k] = ENV[k]; }
  Object.assign(CONFIG, {
    apiBase: api.url, packagerApi: paketleyici.url,
    winImzaBetigi: araclar.imzaSh, winImzaKabuk: 'bash', winImzaYuvaKoku: yuvaKok, winImzaYuvaSunucu: '',
    winImzaTetik: araclar.tetik, winImzaYuvaTemizle: araclar.temizle,
    winImzaKilit: path.join(tmp('kilit'), 'imza-yuva.kilit'),
    winImzaYabanciDesen: `rwin-yok-boyle-bir-surec-${crypto.randomBytes(6).toString('hex')}`,
    winImzaKilitBeklemeMs: 5000, winImzaKilitAralikMs: 50, winImzaHazirlaTimeoutMs: 30000,
    winImzaTimeoutMs: 30000, winOsslsigncode: araclar.ossl, winKapiBetigi: araclar.kapi,
    winKabulCli: araclar.kabul, winAgirSh: '', winKanitDizini: kanitDizini, ...ayar,
  });
  const loglar = [];
  const orj = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a) => loglar.push(a.join(' '));
  console.warn = (...a) => loglar.push(a.join(' '));
  let hata = null;
  try {
    await processJob({ agentId: 'test', token: 'x' }, {
      bookId: '74390', platform: 'windows', bookTitle: 'Test Kitap', publisherName: 'YDS Publishing',
      downloadUrl: 'https://r2.example/akillitahtalar/74390/yds-v51.exe?X-Amz-Signature=abc',
      surum: '2.51.3', guncellemeTabani: 'https://cdn.ydspublishing.com/guncelleme', ...is,
    });
  } catch (e) {
    hata = e;
  } finally {
    Object.assign(console, orj);
    Object.assign(CONFIG, eskiConfig);
    for (const [k, v] of Object.entries(eskiEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await paketleyici.kapat();
    await api.kapat();
  }
  const kanitYolu = path.join(kanitDizini, '74390', `${is.surum || '2.51.3'}.json`);
  const kanit = fs.existsSync(kanitYolu) ? JSON.parse(fs.readFileSync(kanitYolu, 'utf8')) : null;
  return {
    hata, loglar: loglar.join('\n'), gunluk: araclar.oku(), okuGunluk: araclar.oku, exeBuf, kanit, yuvaKok,
    paketleyici: { istekler: paketleyici.istekler, paketGovdesi: paketleyici.durum.paketGovdesi },
    api: api.kayit,
  };
}

/** R2'ye HİÇBİR ŞEY yazılmadı: presign yok, PUT yok, sonuç yok, G yüklemesi yok. */
function r2YazimiSifir(r) {
  assert.equal(r.api.putlar.length, 0, 'R2 PUT olmamalı');
  assert.equal(r.api.sonuclar.length, 0, '/result (completed) olmamalı');
  assert.deepEqual(r.api.istekler.filter((x) => /presign|r2\//.test(x)), [], 'presign isteği olmamalı');
}

// ---------------------------------------------------------------------------
// Uçtan uca — gerçek processJob
// ---------------------------------------------------------------------------

test('başarılı yol: üret → kapı → kabul → _hazir → imza → doğrula → kabul → R2 (yalnız İMZALI kopya)', async () => {
  const r = await windowsIsiKostur();
  assert.equal(r.hata, null, r.hata && r.hata.stack);
  // Paketleyiciye sözleşme sürümü + kimlik = book_id + G tabanı gitti.
  assert.equal(r.paketleyici.paketGovdesi.appVersion, '2.51.3');
  assert.equal(r.paketleyici.paketGovdesi.setKimligi, '74390');
  assert.equal(r.paketleyici.paketGovdesi.guncellemeTabani, 'https://cdn.ydspublishing.com/guncelleme');
  assert.deepEqual(r.paketleyici.paketGovdesi.platforms, ['windows']);
  // R2'ye giden bayt = imzalı dosya (üretilen imzasız DEĞİL).
  const imzali = imzalaBuf(r.exeBuf);
  assert.equal(r.api.putlar.length, 1);
  assert.equal(r.api.putlar[0].md5, md5(imzali));
  assert.notEqual(r.api.putlar[0].md5, md5(r.exeBuf));
  assert.equal(r.api.sonuclar.length, 1);
  assert.equal(r.api.sonuclar[0].status, 'completed');
  assert.equal(r.api.sonuclar[0].buildMethod, 'build');
  // Adım sırası: kapı → kabul(imzasız) → hazırla → bekle-ve-tak → tetik → ossl → kabul(imzalı).
  const sira = r.gunluk.split('\n').filter(Boolean).map((s) => s.split(' ')[0] + (s.startsWith('imza') ? ` ${s.split(' ')[1]}` : ''));
  const ilk = (x) => sira.indexOf(x);
  assert.ok(ilk('kapi') >= 0 && ilk('kapi') < ilk('kabul'), sira.join(','));
  assert.ok(ilk('kabul') < ilk('imza hazirla'));
  assert.ok(ilk('imza hazirla') < ilk('imza bekle-ve-tak'));
  assert.ok(ilk('imza bekle-ve-tak') < ilk('ossl'));
  assert.ok(ilk('ossl') < sira.lastIndexOf('kabul'));
  assert.equal(sira.filter((x) => x === 'kabul').length, 2, 'başsız kabul imzasız + imzalı iki kez');
  assert.match(r.gunluk, /kabul runner-74390-Test-Kitap-2\.51\.3-Setup-imzali\.exe --platform windows/);
  assert.equal(sira.filter((x) => x === 'tetik').length, 1, 'tetik bir kez');
  assert.match(r.gunluk, /imza bekle-ve-tak runner-74390-Test-Kitap-2\.51\.3-Setup\.exe SMB_SHA=0 TETIK=1/);
  assert.match(r.gunluk, /yuva-temizle/);
  assert.ok(fs.existsSync(path.join(r.yuvaKok, '_imzali', 'runner-74390-Test-Kitap-2.51.3-Setup.exe')), 'yuva _imzali/\'ye');
  assert.doesNotMatch(r.gunluk, /bildir bekci/, 'başarıda bekçi bildirimi yok');
  // İş kanıtı: md5'ler, kök index (g-yayin --ilk), sürüm, R2 anahtarı.
  assert.equal(r.kanit.durum, 'yayinlandi');
  assert.equal(r.kanit.surum, '2.51.3');
  assert.equal(r.kanit.imzali.md5, md5(imzali));
  assert.equal(r.kanit.imzasiz.md5, md5(r.exeBuf));
  assert.equal(r.kanit.imzali.imzaci.startsWith('İm Park Bilişim'), true);
  assert.deepEqual(r.kanit.kokIndex, { yol: 'resources/app/index.html', sha256: sha256('<html>kok-index</html>'), boyut: 22 });
  assert.equal(r.kanit.r2ObjectKey, 'softwares/74390/Test - YDS.exe');
});

test('G set tar\'ı paketleyicide VARKEN bile runner onu indirmez ve hiçbir yere yüklemez (tek yazar g-yayin)', async () => {
  const r = await windowsIsiKostur();
  assert.equal(r.hata, null, r.hata && r.hata.message);
  assert.deepEqual(r.paketleyici.istekler.filter((x) => x.includes('guncelleme')), []);
  assert.deepEqual(r.api.istekler.filter((x) => x.includes('guncelleme')), []);
  assert.equal(r.api.putlar.length, 1, 'yalnız exe');
});

test('imza zaman aşımı → R2 yazımı 0, iş görünür hatayla düşer + bildir bekci', async () => {
  const r = await windowsIsiKostur({ kip: { imza: 'asili' }, ayar: { winImzaTimeoutMs: 1500 } });
  assert.ok(r.hata);
  assert.match(r.hata.message, /\[windows-serit\] imza zaman aşımı/);
  r2YazimiSifir(r);
  assert.doesNotMatch(r.gunluk, /^ossl/m, 'imzasız dosya doğrulamaya da gitmez');
  assert.match(r.gunluk, /bildir bekci \| Test Kitap \(74390\) Windows şeridi düştü, R2'ye yazılmadı/);
});

test('imza kuyruğu 2 denemede imzalamadı (betik çıkış 3) → R2 yazımı 0', async () => {
  const r = await windowsIsiKostur({ kip: { imza: 'tavan' } });
  assert.match(r.hata.message, /imza kuyruğu 2 denemede imzalamadı/);
  r2YazimiSifir(r);
  assert.match(r.gunluk, /bildir bekci/);
});

test('imza doğrulaması başarısız (osslsigncode RED) → R2 yazımı 0', async () => {
  const r = await windowsIsiKostur({ kip: { ossl: 'red' } });
  assert.ok(r.hata, 'iş düşmeliydi');
  assert.match(r.hata.message, /Authenticode doğrulaması BAŞARISIZ/);
  r2YazimiSifir(r);
  assert.equal(r.gunluk.split('\n').filter((s) => s.startsWith('kabul')).length, 1, 'imzalı kabule geçilmez');
  assert.equal(r.kanit, null, 'kanıt "doğrulandı" yazılmaz');
  assert.match(r.gunluk, /bildir bekci/);
});

test('yuvadan dönen imzalı dosya BİZİM exe değil (gövde farklı) → R2 yazımı 0', async () => {
  const r = await windowsIsiKostur({ kip: { imza: 'yabanci' } });
  assert.match(r.hata.message, /imzalı dosya bizim exe'miz değil/);
  r2YazimiSifir(r);
});

test('G kapısı RED (madde 13 FAIL) → imzaya gitmez, R2 yazımı 0', async () => {
  const r = await windowsIsiKostur({ kip: { kapi: 'g-red' } });
  assert.match(r.hata.message, /statik kapı RED — madde 13 FAIL/);
  r2YazimiSifir(r);
  assert.doesNotMatch(r.gunluk, /^imza /m, 'imza betiği hiç çağrılmaz');
  assert.doesNotMatch(r.gunluk, /^kabul /m);
  assert.match(r.gunluk, /bildir bekci/);
});

test('claim sürüm taşımıyor → paketleyiciye ve kaynağa HİÇ gidilmez, R2 yazımı 0', async () => {
  const r = await windowsIsiKostur({ is: { surum: undefined } });
  assert.match(r.hata.message, /sözleşme madde 1: claim'de Windows sürümü/);
  assert.deepEqual(r.paketleyici.istekler, []);
  r2YazimiSifir(r);
  assert.match(r.gunluk, /bildir bekci/);
});

// EXE'SİZ SÖZLEŞME (Nadir 01.10): Windows şeridi AYNI kaynak kararını kullanır — arşiv/manuel yoksa
// İmpark exe'si indirilmez; kira bırakılır, failed yazılmaz, paketleyiciye/imzaya/R2'ye gidilmez.
test('exe\'siz: arşiv/manuel kaynak yok → exe İNDİRİLMEZ, kira bırakılır, üretim/imza/R2 yok', async () => {
  const r = await windowsIsiKostur({ arsivYok: true });
  assert.equal(r.hata, null, r.hata && r.hata.stack);
  assert.deepEqual(r.api.release, [{ bookId: '74390', platform: 'windows',
    sebep: 'build yok — exe\'siz sözleşme: arşiv/manuel kaynak gerekli' }]);
  assert.deepEqual(r.paketleyici.istekler, []);
  r2YazimiSifir(r);
  // bildir ayrık (detached) süreçte koşar — günlüğe düşmesini kısa süre bekle.
  let gunluk = r.gunluk;
  for (let i = 0; i < 60 && !/bildir kosucu/.test(gunluk); i += 1) {
    await new Promise((ok) => setTimeout(ok, 50));
    gunluk = r.okuGunluk();
  }
  assert.match(gunluk, /^bildir kosucu \| 1 iş build bekliyor: 74390\/windows\. /m);
  assert.doesNotMatch(r.gunluk, /^(tetik|kabul |bildir bekci)/m, 'imza yuvası/kabul/bekçi tetiklenmemeli');
  assert.match(r.loglar, /\[kaynak-yok\] 74390 windows/);
});

// İnceleme 01.10: kaynak kararı araç/yuva denetiminden ÖNCE — build yoksa araç eksikliği iş düşürmez.
test('exe\'siz: build yok + imza aracı/yuva YOK → yine kira bırakılır (failed değil), araç denetimi koşmaz', async () => {
  const r = await windowsIsiKostur({ arsivYok: true,
    ayar: { winOsslsigncode: '/yok/boyle/bir/osslsigncode', winImzaYuvaKoku: '/yok/boyle/bir/yuva' } });
  assert.equal(r.hata, null, r.hata && r.hata.stack);
  assert.equal(r.api.release.length, 1);
  assert.doesNotMatch(r.loglar, /ön koşul: .*osslsigncode bulunamadı/);
  r2YazimiSifir(r);
});

test('build VAR + imza aracı YOK → araç denetimi düşürür (davranış korunur), kira bırakılmaz', async () => {
  const r = await windowsIsiKostur({ ayar: { winOsslsigncode: '/yok/boyle/bir/osslsigncode' } });
  assert.match(r.hata.message, /ön koşul: .*osslsigncode bulunamadı/);
  assert.equal((r.api.release || []).length, 0);
  assert.deepEqual(r.paketleyici.istekler, []);
});

test('claim setKimligi book_id\'den farklı → iş düşer, üretim yok', async () => {
  const r = await windowsIsiKostur({ is: { setKimligi: '11811' } });
  assert.match(r.hata.message, /kimlik = book_id/);
  assert.deepEqual(r.paketleyici.istekler, []);
  r2YazimiSifir(r);
});

test('imza kuyruğu kilidi başka iş tutarken sıra beklenir, bırakılınca alınır', async () => {
  const cfg = { ...W.varsayilanAyarlar(), winImzaKilit: path.join(tmp('kilit2'), 'k'),
    winImzaYabanciDesen: `rwin-yok-${crypto.randomBytes(6).toString('hex')}`, winImzaKilitAralikMs: 30, winImzaKilitBeklemeMs: 4000 };
  const loglar = [];
  const log = (...a) => loglar.push(a.join(' '));
  const birak1 = await W.imzaKilidiAl(cfg, { log, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  let ikinciAldi = false;
  const ikinci = W.imzaKilidiAl(cfg, { log, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) })
    .then((b) => { ikinciAldi = true; return b; });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(ikinciAldi, false, 'kilit tutulurken ikinci iş imzaya giremez');
  assert.match(loglar.join('\n'), /kilidi dolu/);
  await birak1();
  const birak2 = await ikinci;
  assert.equal(ikinciAldi, true);
  await birak2();
});

test('imza kuyruğu kilidi tavanı dolarsa iş düşer (sessiz bekleme yok)', async () => {
  const cfg = { ...W.varsayilanAyarlar(), winImzaKilit: path.join(tmp('kilit3'), 'k'),
    winImzaYabanciDesen: `rwin-yok-${crypto.randomBytes(6).toString('hex')}`, winImzaKilitAralikMs: 20, winImzaKilitBeklemeMs: 200 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const birak = await W.imzaKilidiAl(cfg, { log: () => {}, sleep });
  await assert.rejects(W.imzaKilidiAl(cfg, { log: () => {}, sleep }), /kilidi .* dk boşalmadı/);
  await birak();
});

// ---------------------------------------------------------------------------
// Kaynak yapısı — imzasız yayın yolu kodda YOK
// ---------------------------------------------------------------------------

test('processJob: tek yayın çağrısı yayinYolu ile; Windows\'ta yayinYolu YALNIZ zincirin imzalı kopyası', () => {
  const cagrilar = PROCESS_JOB.match(/postResultSuccess\(/g) || [];
  assert.equal(cagrilar.length, 1);
  assert.match(PROCESS_JOB, /await postResultSuccess\(auth, job, yayinYolu\)/);
  const winDal = PROCESS_JOB.slice(PROCESS_JOB.indexOf("if (packagerPlatform === 'windows') {\n      winZincir"),
    PROCESS_JOB.indexOf('} else {', PROCESS_JOB.indexOf('winZincir = await')));
  assert.match(winDal, /winZincir = await windowsSerit\.yayinOncesiZincir\(/);
  assert.match(winDal, /yayinYolu = winZincir\.imzaliYol;/);
  assert.doesNotMatch(winDal, /yayinYolu = artifactPath/);
  // Zincir, yayın çağrısından ÖNCE.
  assert.ok(PROCESS_JOB.indexOf('yayinOncesiZincir(') < PROCESS_JOB.indexOf('await postResultSuccess('));
});

test('imzayı kapatan anahtar yok: şerit modülü ortamdan imza atlama bayrağı okumaz', () => {
  const M = fs.readFileSync(path.join(__dirname, 'windows-serit.js'), 'utf8');
  assert.doesNotMatch(M, /process\.env\.[A-Z_]*(IMZA|SIGN)[A-Z_]*/);
  assert.doesNotMatch(SRC, /process\.env\.[A-Z_]*IMZASIZ/);
});

test('runner G set yükleme yolu kaldırıldı (tek yazar g-yayin)', () => {
  assert.doesNotMatch(SRC, /guncellemeSetiYukleVeDogrula|presign-guncelleme|api\/download\/\$\{jobId\}\/guncelleme/);
  for (const ad of ['guncellemeSetiYukleVeDogrula', 'guncellemeTarIndir', 'presignGuncelleme', 'guncellemeDosyaYukle', 'guncellemeSurumDogrula']) {
    assert.equal(ad in RUNNER, false, ad);
  }
});

test('sıra: onKosul (saf) → kaynak kararı → araç/yuva denetimi → kaynak hazırlığı', () => {
  const on = PROCESS_JOB.indexOf('windowsSerit.onKosul(job)');
  const karar = PROCESS_JOB.indexOf('kaynakKarari({ job, arsiv })');
  const arac = PROCESS_JOB.indexOf('windowsSerit.araclariDenetle(CONFIG)');
  const hazirlik = PROCESS_JOB.indexOf('await fsp.copyFile(arsiv.zip');
  assert.ok(on > 0 && karar > on && arac > karar && hazirlik > arac);
});

test('şerit hatası bekçiye bildirilir, sonra yukarı fırlatılır (ana döngü failed yazar)', () => {
  assert.match(PROCESS_JOB, /if \(packagerPlatform === 'windows'\) \{\s*\n\s*await windowsSerit\.bekciBildir\(/);
  assert.match(PROCESS_JOB, /bekciBildir\([^)]*\)[^]*?throw e;/);
});

// ---------------------------------------------------------------------------
// Saf kararlar
// ---------------------------------------------------------------------------

test('onKosul: sürüm 2.<panel>.<sayaç>; kimlik book_id; G tabanı https', () => {
  const t = { bookId: '74390', surum: '2.51.0', guncellemeTabani: 'https://cdn.x/guncelleme' };
  assert.deepEqual(W.onKosul(t), { surum: '2.51.0', setKimligi: '74390', guncellemeTabani: 'https://cdn.x/guncelleme' });
  assert.equal(W.onKosul({ ...t, surum: undefined, appVersion: '2.9.12' }).surum, '2.9.12');
  for (const s of ['1.0.0', '1.3.4', '2.51', '2.51.0.1', 'v2.51.0', '', undefined]) {
    assert.throws(() => W.onKosul({ ...t, surum: s }), /madde 1/, String(s));
  }
  assert.throws(() => W.onKosul({ ...t, setKimligi: '45482' }), /kimlik = book_id/);
  assert.equal(W.onKosul({ ...t, setKimligi: '74390' }).setKimligi, '74390');
  assert.throws(() => W.onKosul({ ...t, guncellemeTabani: 'http://cdn.x/g' }), /https değil/);
  assert.throws(() => W.onKosul({ ...t, guncellemeTabani: undefined }), /https değil/);
});

const madde = (no, durum) => ({ no, ad: `m${no}`, durum, detay: `d${no}` });
const tamKapi = () => ({ maddeler: Array.from({ length: 15 }, (_, i) => madde(i + 1, 'PASS')) });

test('kapiKarari: 0 FAIL + 13/14/15 PASS + ÖLÇÜLEMEDİ yalnız 3/5 → geçer', () => {
  const s = tamKapi();
  s.maddeler[2].durum = 'ÖLÇÜLEMEDİ';
  s.maddeler[4].durum = 'ÖLÇÜLEMEDİ';
  s.maddeler[6].durum = 'RAPOR';
  const k = W.kapiKarari(s);
  assert.equal(k.gecti, true, k.sebep);
  assert.equal(k.ozet, '12 PASS · 0 FAIL · 2 ÖLÇÜLEMEDİ · 1 RAPOR');
});

test('kapiKarari: herhangi bir FAIL, 13/14/15 PASS değil ya da izinsiz ÖLÇÜLEMEDİ → RED', () => {
  for (const [no, durum, desen] of [[13, 'FAIL', /madde 13 FAIL/], [14, 'ÖLÇÜLEMEDİ', /madde 14 ÖLÇÜLEMEDİ/],
    [15, 'RAPOR', /madde 15 \(kurulum dizinine yazma yok\) PASS değil: RAPOR/], [2, 'FAIL', /madde 2 FAIL/],
    [9, 'ÖLÇÜLEMEDİ', /madde 9 ÖLÇÜLEMEDİ/], [4, 'BİLMEM', /bilinmeyen durum/]]) {
    const s = tamKapi();
    s.maddeler[no - 1].durum = durum;
    const k = W.kapiKarari(s);
    assert.equal(k.gecti, false, `${no} ${durum}`);
    assert.match(k.sebep, desen);
  }
  const eksik = tamKapi();
  eksik.maddeler = eksik.maddeler.filter((x) => x.no !== 13);
  assert.match(W.kapiKarari(eksik).sebep, /madde 13 \(G güncelleme kanalı\) PASS değil: YOK/);
  assert.equal(W.kapiKarari(null).gecti, false);
  assert.equal(W.kapiKarari({ maddeler: [] }).gecti, false);
});

test('kapiCiktisiniAyristir: gerçek kapı biçimi (--json --tut + agir.sh satırı)', () => {
  const s = tamKapi();
  const metin = ['agir.sh: x slot bekliyor (18:00:00)', 'Paket: /a/b.exe', 'Boyut: 1 bayt', 'NSIS korpusu taranıyor…',
    'Çıkarım: /tmp/empp-kapi-abc', '  7z: /usr/local/bin/7z', JSON.stringify({ paket: '/a/b.exe', maddeler: s.maddeler, kod: 0 }, null, 2),
    '(geçici dizin tutuldu: /tmp/empp-kapi-abc)', 'AGIR-EXIT=0 etiket=x slot=1'].join('\n');
  const a = W.kapiCiktisiniAyristir(metin);
  assert.equal(a.cikarimDizini, '/tmp/empp-kapi-abc');
  assert.equal(a.sonuc.maddeler.length, 15);
  assert.equal(W.kapiCiktisiniAyristir('bozuk { çıktı').sonuc, null);
});

test('imzaDogrulamaKarari: gerçek osslsigncode 2.14 çıktısı geçer; eksik/yanlış her koşul RED', () => {
  const ok = W.imzaDogrulamaKarari({ kod: 0, cikti: OSSL_OK }, 'İm Park Bilişim');
  assert.equal(ok.gecti, true, ok.sebep);
  assert.match(ok.imzaci, /^İm Park Bilişim Elektronik/);
  assert.equal(ok.zamanDamgasi, 'Sep 26 09:22:55 2026 GMT');
  const red = (cikti, kod = 0) => W.imzaDogrulamaKarari({ kod, cikti }, 'İm Park Bilişim');
  assert.match(red(OSSL_OK, 1).sebep, /çıkış 1/);
  assert.match(red(OSSL_OK.replace('Signature verification: ok', 'Signature verification: failed')).sebep, /Signature verification/);
  assert.match(red(OSSL_OK.replace('Signature CRL verification: ok\n', '')).sebep, /CRL/);
  assert.match(red(OSSL_OK.replace('Succeeded', 'Failed')).sebep, /Succeeded/);
  assert.match(red(OSSL_OK.replace(/Countersignatures:[\s\S]*?GMT\n/, '')).sebep, /zaman damgası/);
  assert.match(red(OSSL_OK.replace('Calculated message digest : F832', 'Calculated message digest : 0000')).sebep, /özeti eşleşmiyor/);
  assert.match(red(OSSL_OK.replace(/CN=İm Park Bilişim Elektronik/, 'CN=Baska Firma')).sebep, /imzacı beklenen/);
  assert.equal(W.imzaDogrulamaKarari({ zamanAsimi: true, kod: -1, cikti: OSSL_OK }, 'İm Park Bilişim').gecti, false);
  assert.equal(W.imzaDogrulamaKarari({ hata: 'ENOENT', kod: -1, cikti: '' }, 'İm Park Bilişim').gecti, false);
});

test('govdeEsitMi: bizim imzalı kopya geçer; gövde/hizalama/blok bozuksa RED', async () => {
  const d = tmp('govde');
  const orj = peExe(50_003, 3);
  const a = path.join(d, 'a.exe');
  fs.writeFileSync(a, orj);
  const yaz = (b) => { const p = path.join(d, `${crypto.randomBytes(4).toString('hex')}.exe`); fs.writeFileSync(p, b); return p; };
  assert.deepEqual(await W.govdeEsitMi(a, yaz(imzalaBuf(orj))), { esit: true, sebep: 'ok' });
  const govdeBozuk = imzalaBuf(orj); govdeBozuk[30_000] ^= 0xff;
  assert.match((await W.govdeEsitMi(a, yaz(govdeBozuk))).sebep, /gövde/);
  const hizaBozuk = imzalaBuf(orj); hizaBozuk[orj.length] = 1;
  assert.match((await W.govdeEsitMi(a, yaz(hizaBozuk))).sebep, /hizalama/);
  const basBozuk = imzalaBuf(orj); basBozuk[0x10] = 9;
  assert.match((await W.govdeEsitMi(a, yaz(basBozuk))).sebep, /başlık farklı/);
  const blokBozuk = imzalaBuf(orj); blokBozuk.writeUInt16LE(0x0001, orj.length + 5 + 6);
  assert.match((await W.govdeEsitMi(a, yaz(blokBozuk))).sebep, /PKCS#7/);
  assert.match((await W.govdeEsitMi(a, yaz(orj))).sebep, /büyük değil/);
});

test('etkinYetenekler: windows yalnız EMPP_RUNNER_WINDOWS açık VE imza yuvası erişilirken ilan edilir', () => {
  const caps = ['android', 'pardus', 'windows'];
  assert.deepEqual(etkinYetenekler(caps, { ofiste: true }), ['android', 'pardus']);
  assert.deepEqual(etkinYetenekler(caps, { ofiste: true, windowsAcik: true }), ['android', 'pardus']);
  assert.deepEqual(etkinYetenekler(caps, { ofiste: true, windowsAcik: true, imzaYuvasi: false }), ['android', 'pardus']);
  assert.deepEqual(etkinYetenekler(caps, { ofiste: true, windowsAcik: false, imzaYuvasi: true }), ['android', 'pardus']);
  assert.deepEqual(etkinYetenekler(caps, { ofiste: true, windowsAcik: true, imzaYuvasi: true }), caps);
  assert.deepEqual(caps, ['android', 'pardus', 'windows'], 'girdi değişmez');
});

test('mapPlatform: windows anahtarı hâlâ yalnız EMPP_RUNNER_WINDOWS=1 ile açılır', () => {
  const eski = process.env.EMPP_RUNNER_WINDOWS;
  try {
    delete process.env.EMPP_RUNNER_WINDOWS;
    assert.equal(mapPlatform('windows'), null);
    process.env.EMPP_RUNNER_WINDOWS = '1';
    assert.equal(mapPlatform('windows'), 'windows');
  } finally {
    if (eski === undefined) delete process.env.EMPP_RUNNER_WINDOWS; else process.env.EMPP_RUNNER_WINDOWS = eski;
  }
});

test('imzaDosyaAdi: runner önekli, sürümlü, boşluksuz', () => {
  assert.equal(W.imzaDosyaAdi('59835', 'Super Monsters 2 Set', '2.51.2'), 'runner-59835-Super-Monsters-2-Set-2.51.2-Setup.exe');
});
