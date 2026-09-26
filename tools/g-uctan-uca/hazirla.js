#!/usr/bin/env node
'use strict';

/**
 * G UÇTAN UCA — fikstür hazırlayıcı. TEST anahtarıyla imzalı örnek güncellemeyi, kurulu
 * sayılacak örnek SET ağacını, olumsuz senaryoları ve yerel TLS sertifikasını üretir.
 *
 *   <dizin>/kurulu/        paket 2.90.1'in kurulu ağacı (set 99901; empp-set.json'da TEST
 *                          açık anahtarı)
 *   <dizin>/kaynak/        yayının girdileri (index v2/v3, motor v2, book4/)
 *   <dizin>/senaryolar/<ad>/set/99901/…   sunucu.js'in servis ettiği ağaçlar
 *   <dizin>/beklenen.json  güncelleme sonrası ağaç (gDosyalari + tabanDosyalari + olmamali)
 *   <dizin>/hazirlik.json  port, taban, senaryolar, TLS ve anahtar bilgisi
 *   <dizin>/tls/           ca.pem, ca.der (istemci güveni), sunucu.pem/.key
 *
 * Yeniden koşulunca önceki nesil SİLİNMEZ, `<dizin>/_eski/<zaman>/` altına taşınır; TLS korunur.
 * "gecerli" senaryosu yayın aracının GERÇEK iki koşusudur (2.90.2, sonra 2.90.3) — birikimli
 * durum da böylece sınanır.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const kg = require('../../src/runtime/kitap-guncelleyici');
const anahtar = require('../g-yayin/anahtar');
const zip = require('../g-yayin/zip-yaz');
const yayin = require('../g-yayin/yayinla');
const { MOTOR_DOSYA_ADI } = require('../g-yayin/durum');
const { VARSAYILAN_DIZIN } = require('./sunucu');
const o = require('./ortak');

function zamanDamgasi() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
}

function yaz(kok, goreli, icerik) {
  const y = path.join(kok, ...goreli.split('/'));
  fs.mkdirSync(path.dirname(y), { recursive: true });
  fs.writeFileSync(y, icerik);
}

function indexHtml(baslik, kitaplar, surum) {
  const li = kitaplar.map((k) => `<li><a href="${k}/index.html">${k}</a></li>`).join('');
  return (
    '<!doctype html>\n<html lang="tr"><head><meta charset="utf-8">' +
    `<title>${baslik}</title></head><body data-g-surum="${surum}"><h1>${baslik}</h1>` +
    `<ul id="kitaplar">${li}</ul></body></html>\n`
  );
}

function motor(s) {
  return (
    `/* ${MOTOR_DOSYA_ADI} — G uçtan uca sahte motoru */\n` +
    `window.__EMPP_MOTOR_SURUMU = '${s}';\n`
  );
}

function kitapYaz(kok, dizin, motorSurumu, ekSayfa) {
  yaz(kok, `${dizin}/index.html`, `<!doctype html><html><body>${dizin}</body></html>\n`);
  yaz(kok, `${dizin}/${MOTOR_DOSYA_ADI}`, motor(motorSurumu));
  yaz(kok, `${dizin}/sayfa/1.txt`, `${dizin} sayfa 1\n`);
  if (ekSayfa) yaz(kok, `${dizin}/sayfa/${ekSayfa}`, `${dizin} ek sayfa\n`);
}

/* ------------------------------------------------------------------ TLS */

const CA_CNF = `[req]
distinguished_name = dn
prompt = no
[dn]
CN = EMPP G uctan uca TEST CA (yalniz 127.0.0.1)
[v3_ca]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
nameConstraints = critical,@ad_kisiti
[ad_kisiti]
permitted;IP.1 = 127.0.0.1/255.255.255.255
permitted;IP.2 = 10.0.2.2/255.255.255.255
permitted;DNS.1 = localhost
`;

const SUNUCU_EXT = `basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = IP:127.0.0.1,IP:10.0.2.2,DNS:localhost
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
`;

/**
 * Ad kısıtlı (yalnız 127.0.0.1 / 10.0.2.2 / localhost) test CA'sı + sunucu sertifikası.
 * Varsa yeniden üretmez (çalışan sunucular ve istemci güvenleri bozulmasın).
 */
function tlsHazirla(dizin, { yenile = false, openssl = process.env.OPENSSL || 'openssl' } = {}) {
  const t = path.join(dizin, 'tls');
  const gerekli = ['ca.pem', 'ca.der', 'sunucu.pem', 'sunucu.key'];
  if (!yenile && gerekli.every((f) => fs.existsSync(path.join(t, f))))
    return { dizin: t, yeni: false };
  if (fs.existsSync(t)) {
    const eski = path.join(dizin, '_eski', `${zamanDamgasi()}-tls`);
    fs.mkdirSync(path.dirname(eski), { recursive: true });
    fs.renameSync(t, eski);
  }
  fs.mkdirSync(t, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(t, 'ca.cnf'), CA_CNF);
  fs.writeFileSync(path.join(t, 'sunucu.ext'), SUNUCU_EXT);
  const kos = (args) => {
    try {
      execFileSync(openssl, args, { cwd: t, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const iz = e.stderr ? e.stderr.toString('utf8').slice(0, 300) : e.message;
      throw new Error(`openssl ${args[0]} başarısız: ${iz}`);
    }
  };
  kos([
    'req',
    '-x509',
    '-new',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'ca.key',
    '-out',
    'ca.pem',
    '-days',
    '825',
    '-sha256',
    '-config',
    'ca.cnf',
    '-extensions',
    'v3_ca',
  ]);
  kos([
    'req',
    '-new',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'sunucu.key',
    '-out',
    'sunucu.csr',
    '-config',
    'ca.cnf',
    '-subj',
    '/CN=127.0.0.1',
  ]);
  kos([
    'x509',
    '-req',
    '-in',
    'sunucu.csr',
    '-CA',
    'ca.pem',
    '-CAkey',
    'ca.key',
    '-set_serial',
    '0x' + crypto.randomBytes(12).toString('hex'),
    '-days',
    '825',
    '-sha256',
    '-extfile',
    'sunucu.ext',
    '-out',
    'sunucu.pem',
  ]);
  kos(['x509', '-in', 'ca.pem', '-outform', 'der', '-out', 'ca.der']);
  for (const f of ['ca.key', 'sunucu.key']) fs.chmodSync(path.join(t, f), 0o600);
  return { dizin: t, yeni: true };
}

/* ------------------------------------------------------------------ fikstür */

function nesliKenaraAl(dizin) {
  const adlar = [
    'kurulu',
    'kaynak',
    'senaryolar',
    'calisma',
    'beklenen.json',
    'hazirlik.json',
    'son-kosu.json',
  ].filter((a) => fs.existsSync(path.join(dizin, a)));
  if (!adlar.length) return null;
  const hedef = path.join(dizin, '_eski', zamanDamgasi());
  fs.mkdirSync(hedef, { recursive: true });
  for (const a of adlar) fs.renameSync(path.join(dizin, a), path.join(hedef, a));
  return hedef;
}

function imzaliManifestYaz(setDizini, manifest, ozel, acik) {
  const govde = Buffer.from(JSON.stringify(manifest), 'utf8');
  fs.mkdirSync(setDizini, { recursive: true });
  fs.writeFileSync(path.join(setDizini, 'manifest.json'), govde);
  fs.writeFileSync(path.join(setDizini, 'manifest.json.sig'), anahtar.imzala(govde, ozel, acik));
  fs.writeFileSync(
    path.join(setDizini, 'surum.json'),
    JSON.stringify({
      surum: manifest.surum,
      uretim: manifest.uretim,
      setKimligi: manifest.setKimligi,
    }),
  );
}

function setKopyala(dizin, kaynakSenaryo, hedefSenaryo, filtre) {
  const k = path.join(dizin, 'senaryolar', kaynakSenaryo, 'set', o.SET_KIMLIGI);
  const h = path.join(dizin, 'senaryolar', hedefSenaryo, 'set', o.SET_KIMLIGI);
  fs.cpSync(k, h, { recursive: true, filter: filtre || (() => true) });
  return h;
}

/**
 * @param {{dizin?:string, port?:number, anahtarDosya?:string, tlsYenile?:boolean,
 *   gunluk?:Function}} s
 * @returns {Promise<object>} hazirlik.json içeriği
 */
async function hazirla(s = {}) {
  const dizin = path.resolve(s.dizin || VARSAYILAN_DIZIN);
  const port = Number.isInteger(s.port) ? s.port : 8443;
  const gunluk = typeof s.gunluk === 'function' ? s.gunluk : () => {};
  const anahtarDosya = path.resolve(s.anahtarDosya || anahtar.TEST_ANAHTAR_YOLU);
  fs.mkdirSync(dizin, { recursive: true });
  const eski = nesliKenaraAl(dizin);
  if (eski) gunluk(`önceki nesil taşındı: ${eski}`);
  const tls = tlsHazirla(dizin, { yenile: !!s.tlsYenile });

  const ozel = anahtar.dosyadanOku(anahtarDosya);
  const acik = anahtar.acikAnahtarB64(ozel);
  const iz = anahtar.parmakIzi(acik);
  const taban = (senaryo) => `https://127.0.0.1:${port}/${senaryo}/guncelleme`;
  const senaryoDizini = (ad) => path.join(dizin, 'senaryolar', ad);

  // 1) Kurulu paket (2.90.1): book1-3, index v1.
  const kurulu = path.join(dizin, 'kurulu');
  yaz(
    kurulu,
    'index.html',
    indexHtml('G Test Seti v1', ['book1', 'book2', 'book3'], o.PAKET_SURUMU),
  );
  for (const b of ['book1', 'book2', 'book3']) kitapYaz(kurulu, b, 'v1');
  yaz(
    kurulu,
    'package.json',
    JSON.stringify(
      { name: 'g-uctan-uca-seti', productName: 'G Uçtan Uca Seti', version: o.PAKET_SURUMU },
      null,
      2,
    ) + '\n',
  );
  yaz(
    kurulu,
    kg.VARSAYILAN_SET_ADI,
    JSON.stringify(
      {
        sema: 2,
        setKimligi: o.SET_KIMLIGI,
        taban: taban('gecerli'),
        damga: o.PAKET_SURUMU,
        kabukDosyalari: ['index.html'],
        kapsamDisiDallar: [],
        kitapDizinleri: ['book1', 'book2', 'book3'],
        imza: { alg: kg.IMZA_ALG, acikAnahtar: acik },
      },
      null,
      2,
    ) + '\n',
  );

  // 2) Yayın girdileri.
  const kaynak = path.join(dizin, 'kaynak');
  yaz(kaynak, 'index-v2.html', indexHtml('G Test Seti v2', ['book1', 'book2', 'book4'], '2.90.2'));
  yaz(
    kaynak,
    'index-v3.html',
    indexHtml('G Test Seti v3', ['book1', 'book2', 'book4'], o.SON_SURUM),
  );
  yaz(kaynak, 'index-eski.html', indexHtml('G Test Seti ESKİ (geri alma)', ['book1'], '2.90.0'));
  yaz(kaynak, 'index-baska.html', indexHtml('BAŞKA SET 99902', ['book9'], '2.90.5'));
  yaz(kaynak, 'motor-v2.js', motor('v2'));
  kitapYaz(kaynak, 'book4', 'v2', 'ölçü.txt');

  // 3) gecerli — yayın aracının iki gerçek koşusu (birikimli durum).
  const ortak = (ad, ek) => ({
    komut: 'yayinla',
    setKimligi: o.SET_KIMLIGI,
    taban: taban(ad),
    cikti: senaryoDizini(ad),
    anahtarDosya,
    anahtarZinciri: false,
    motorlar: {},
    ekle: {},
    cikar: [],
    ...ek,
  });
  const k = (ad) => path.join(kaynak, ad);
  const r1 = await yayin.yayinla(
    ortak('gecerli', {
      ilk: true,
      oncekiSurum: o.PAKET_SURUMU,
      panel: o.PANEL,
      index: k('index-v2.html'),
      motorlar: { book2: k('motor-v2.js') },
      ekle: { book4: k('book4') },
      cikar: ['book3'],
    }),
    { gunluk },
  );
  const r2 = await yayin.yayinla(
    ortak('gecerli', {
      panel: o.PANEL,
      index: k('index-v3.html'),
      motorlar: { book1: k('motor-v2.js') },
    }),
    { gunluk },
  );
  if (r1.surum !== '2.90.2' || r2.surum !== o.SON_SURUM)
    throw new Error(`beklenmeyen sürüm: ${r1.surum}, ${r2.surum}`);

  // 4) Olumsuz senaryolar.
  const uretim = new Date().toISOString();
  const temel = {
    sema: 1,
    kanal: 'G',
    setKimligi: o.SET_KIMLIGI,
    onceki: o.PAKET_SURUMU,
    uretim,
    anahtar: iz,
  };

  const bozukDizin = setKopyala(dizin, 'gecerli', 'imza-bozuk');
  const bm = JSON.parse(fs.readFileSync(path.join(bozukDizin, 'manifest.json'), 'utf8'));
  bm.uretim = '1970-01-01T00:00:00.000Z';
  fs.writeFileSync(path.join(bozukDizin, 'manifest.json'), JSON.stringify(bm));

  setKopyala(dizin, 'gecerli', 'imzasiz', (y) => !y.endsWith('.sig'));

  await yayin.yayinla(
    ortak('sha-uyusmaz', {
      ilk: true,
      oncekiSurum: o.PAKET_SURUMU,
      panel: o.PANEL,
      index: k('index-v2.html'),
      ekle: { book4: k('book4') },
      cikar: ['book3'],
    }),
    { gunluk },
  );
  fs.writeFileSync(
    path.join(senaryoDizini('sha-uyusmaz'), 'set', o.SET_KIMLIGI, 'dosya', 'index.html'),
    '<!doctype html><html><body>SAHTE</body></html>\n',
  );

  const kacis = Buffer.from('kacis\n');
  imzaliManifestYaz(
    path.join(senaryoDizini('yol-kacisi'), 'set', o.SET_KIMLIGI),
    {
      ...temel,
      surum: '2.90.2',
      kabuk: [{ yol: '../kacis.txt', sha256: o.sha256(kacis), boyut: kacis.length }],
      kitaplar: [],
    },
    ozel,
    acik,
  );

  const zkSet = path.join(senaryoDizini('zip-kacisi'), 'set', o.SET_KIMLIGI);
  fs.mkdirSync(path.join(zkSet, 'kitap'), { recursive: true });
  const zk = zip.zipYaz(path.join(zkSet, 'kitap', 'book4-kacis.zip'), [
    { yol: 'index.html', veri: Buffer.from('<!doctype html><html><body>book4</body></html>\n') },
    { yol: '../../kacti.txt', veri: Buffer.from('kacti\n') },
  ]);
  imzaliManifestYaz(
    zkSet,
    {
      ...temel,
      surum: '2.90.2',
      kabuk: [],
      kitaplar: [
        {
          dizin: 'book4',
          durum: 'ekle',
          kaynak: `${taban('zip-kacisi')}/set/${o.SET_KIMLIGI}/kitap/book4-kacis.zip`,
          sha256: zk.sha256,
          boyut: zk.boyut,
        },
      ],
    },
    ozel,
    acik,
  );

  const kismi = setKopyala(dizin, 'gecerli', 'kismi-bozuk');
  fs.writeFileSync(path.join(kismi, 'dosya', 'book2', MOTOR_DOSYA_ADI), motor('BOZUK'));
  // Arşiv adresleri 'gecerli' tabanını gösterir; kitap arşivi oradan iner (aynı sunucu).

  await yayin.yayinla(
    ortak('geri-alma', { ilk: true, surum: '2.90.0', index: k('index-eski.html') }),
    { gunluk },
  );

  const baskaKaynak = path.join(dizin, 'senaryolar', '_baska-set-kaynak');
  await yayin.yayinla(
    {
      ...ortak('baska-set', {}),
      setKimligi: o.BASKA_SET,
      cikti: baskaKaynak,
      ilk: true,
      surum: '2.90.5',
      index: k('index-baska.html'),
    },
    { gunluk },
  );
  fs.cpSync(
    path.join(baskaKaynak, 'set', o.BASKA_SET),
    path.join(senaryoDizini('baska-set'), 'set', o.SET_KIMLIGI),
    { recursive: true },
  );

  // 5) Beklenen son ağaç — girdilerden BAĞIMSIZ hesaplanır (aracın çıktısından değil).
  const taban0 = o.agacOzeti(kurulu);
  const kaynakOz = o.agacOzeti(kaynak, []);
  const motorV2 = kaynakOz['motor-v2.js'];
  const gDosyalari = {
    'index.html': kaynakOz['index-v3.html'],
    [`book1/${MOTOR_DOSYA_ADI}`]: motorV2,
    [`book2/${MOTOR_DOSYA_ADI}`]: motorV2,
  };
  for (const [y, s] of Object.entries(kaynakOz)) if (y.startsWith('book4/')) gDosyalari[y] = s;
  const tabanDosyalari = {};
  for (const [y, s] of Object.entries(taban0)) {
    if (y.startsWith('book3/') || y in gDosyalari) continue;
    tabanDosyalari[y] = s;
  }
  const beklenen = {
    setKimligi: o.SET_KIMLIGI,
    paketSurumu: o.PAKET_SURUMU,
    surum: o.SON_SURUM,
    gDosyalari,
    tabanDosyalari,
    olmamali: ['book3'],
    yoksay: o.DURUM_DOSYALARI,
    kurulu: taban0,
  };
  fs.writeFileSync(path.join(dizin, 'beklenen.json'), JSON.stringify(beklenen, null, 2) + '\n');

  const hazirlik = {
    olusturma: uretim,
    dizin,
    port,
    setKimligi: o.SET_KIMLIGI,
    paketSurumu: o.PAKET_SURUMU,
    sonSurum: o.SON_SURUM,
    taban: taban('gecerli'),
    kurulu,
    acikAnahtar: acik,
    anahtarParmakIzi: iz,
    anahtarDosyasi: anahtarDosya,
    tls: {
      ca: path.join(tls.dizin, 'ca.pem'),
      caDer: path.join(tls.dizin, 'ca.der'),
      sunucuPem: path.join(tls.dizin, 'sunucu.pem'),
      sunucuKey: path.join(tls.dizin, 'sunucu.key'),
    },
    senaryolar: o.SENARYOLAR.map((x) => ({ ...x, taban: taban(x.ad) })),
    yayinlar: [r1.plan, r2.plan],
  };
  fs.writeFileSync(path.join(dizin, 'hazirlik.json'), JSON.stringify(hazirlik, null, 2) + '\n');
  return hazirlik;
}

async function main(argv) {
  const s = {};
  for (let i = 0; i < argv.length; i++) {
    const b = argv[i];
    if (b === '--dizin') s.dizin = argv[++i];
    else if (b === '--port') s.port = Number(argv[++i]);
    else if (b === '--anahtar-dosya') s.anahtarDosya = argv[++i];
    else if (b === '--tls-yenile') s.tlsYenile = true;
    else throw new Error(`bilinmeyen argüman: ${b}`);
  }
  if (s.port !== undefined && (!Number.isInteger(s.port) || s.port <= 0 || s.port === 3000)) {
    throw new Error(`--port geçersiz (3000 yasak): ${s.port}`);
  }
  const h = await hazirla({ ...s, gunluk: (m) => console.warn(m) });
  console.log(`hazır: ${h.dizin}`);
  console.log(
    `  set ${h.setKimligi}, paket ${h.paketSurumu} → ${h.sonSurum}, ` +
      `anahtar ${anahtar.kisaIz(h.anahtarParmakIzi)} (TEST)`,
  );
  console.log(`  taban ${h.taban}`);
  console.log(`  sunucu:  node tools/g-uctan-uca/sunucu.js --dizin ${h.dizin}`);
  console.log(`  referans: node tools/g-uctan-uca/kos.js --dizin ${h.dizin}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error('HATA: ' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  });
}

module.exports = { hazirla, tlsHazirla, indexHtml, motor, CA_CNF, SUNUCU_EXT };
