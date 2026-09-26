#!/usr/bin/env node
'use strict';

/**
 * G UÇTAN UCA — REFERANS koşum: bugünkü Windows istemcisi (`src/runtime/kitap-guncelleyici.js`)
 * her senaryoda kurulu ağacın bir kopyasına karşı GERÇEK https ile koşar; sonuç ağacı
 * `beklenen.json` ile kıyaslanır. İstemci ayrı süreçte koşar (NODE_EXTRA_CA_CERTS yalnız
 * süreç başında okunur; taşıma katmanı mock'lanmaz).
 *
 *   node tools/g-uctan-uca/kos.js [--dizin D]
 *
 * Sunucu: hazirlik.json'daki port boşsa kos.js kendi başlatır; doluysa ve orada bizim
 * sunucumuz (`/saglik`) varsa onu kullanır.
 * Çıkış kodu: zorunlu (true) senaryoların hepsi geçerse 0. 'yeni' senaryolar referans
 * istemcide BİLİNEN AÇIK olarak raporlanır (yeni G istemcileri için zorunlu).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const o = require('./ortak');
const { VARSAYILAN_DIZIN, sunucuBaslat, tlsOku, hazirlikOku } = require('./sunucu');
const { beklenenOku, agaciDogrula } = require('./dogrula');

const ISTEMCI = path.resolve(__dirname, '..', '..', 'src', 'runtime', 'kitap-guncelleyici.js');

function saglikYokla(port, ca) {
  return new Promise((coz) => {
    const ist = https.get({ host: '127.0.0.1', port, path: '/saglik', ca, timeout: 3000 }, (y) => {
      const p = [];
      y.on('data', (d) => p.push(d));
      y.on('end', () => {
        try {
          coz(JSON.parse(Buffer.concat(p).toString('utf8')).gUctanUca === true);
        } catch (e) {
          coz(false);
        }
      });
    });
    ist.on('timeout', () => ist.destroy());
    ist.on('error', () => coz(false));
  });
}

async function sunucuHazirla(h) {
  const tls = tlsOku(h.dizin);
  try {
    const s = await sunucuBaslat({ dizin: h.dizin, port: h.port, tls, gunluk: () => {} });
    return { kapat: s.kapat, kendi: true };
  } catch (e) {
    if (e && e.code === 'EADDRINUSE' && (await saglikYokla(h.port, fs.readFileSync(h.tls.ca)))) {
      return { kapat: async () => {}, kendi: false };
    }
    throw new Error(`port ${h.port} kullanılamıyor ve orada G sunucusu yok (${e.message})`);
  }
}

/**
 * İstemciyi ayrı süreçte koşar; raporu döner. ASENKRON olmalı: sunucu aynı süreçte
 * olabilir, eşzamanlı bekleme olay döngüsünü kilitler (kilitlenme).
 */
function istemciKos(kok, taban, caYolu, zamanAsimiMs = 120000, ekEnv = {}) {
  const betik = `
    const kg = require(${JSON.stringify(ISTEMCI)});
    const g = [];
    kg.guncellemeyiBaslat({ kok: ${JSON.stringify(kok)}, env: process.env,
      gunluk: (m) => g.push(m) })
      .then((r) => process.stdout.write(JSON.stringify({ rapor: r, gunluk: g })));`;
  return new Promise((coz, red) => {
    const c = spawn(process.execPath, ['-e', betik], {
      env: {
        ...process.env,
        NODE_EXTRA_CA_CERTS: caYolu,
        EMPP_GUNCELLEME_TABANI: taban,
        EMPP_SET_GUNCELLEME: '1',
        ...ekEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const cikti = [];
    let hata = '';
    const sayac = setTimeout(() => {
      c.kill('SIGKILL');
    }, zamanAsimiMs);
    c.stdout.on('data', (d) => cikti.push(d));
    c.stderr.on('data', (d) => {
      hata += d.toString('utf8');
    });
    c.on('error', (e) => {
      clearTimeout(sayac);
      red(e);
    });
    c.on('close', (kod, sinyal) => {
      clearTimeout(sayac);
      if (kod !== 0) {
        red(new Error(`istemci süreci düştü (${kod || sinyal}): ${hata.slice(0, 300)}`));
        return;
      }
      try {
        coz(JSON.parse(Buffer.concat(cikti).toString('utf8')));
      } catch (e) {
        red(new Error('istemci çıktısı JSON değil'));
      }
    });
  });
}

/**
 * Örtü kipinin ETKİN görünümünü (`ortuGorunumu`: paket + örtü, gizlenenler hariç) `hedef`
 * dizinine kopyalar — ağaç kıyası Windows kipiyle aynı `agaciDogrula` ile yapılsın diye.
 */
function gorunumuYaz(kok, ortuKoku, hedef) {
  const kg = require(ISTEMCI);
  const d = kg.ortuDurumuYukle({ kok, ortuKoku });
  fs.rmSync(hedef, { recursive: true, force: true });
  fs.mkdirSync(hedef, { recursive: true });
  for (const [y, kaynak] of kg.ortuGorunumu(d, kok)) {
    if (o.DURUM_DOSYALARI.includes(y.split('/')[0])) continue;
    fs.mkdirSync(path.dirname(path.join(hedef, y)), { recursive: true });
    fs.copyFileSync(kaynak, path.join(hedef, y));
  }
  return hedef;
}

async function kos(s = {}) {
  const dizin = path.resolve(s.dizin || VARSAYILAN_DIZIN);
  const h = hazirlikOku(dizin);
  if (!h) throw new Error(`hazirlik.json yok (${dizin}) — önce hazirla.js`);
  const beklenen = beklenenOku(dizin);
  const sunucu = await sunucuHazirla(h);
  const calisma = path.join(dizin, 'calisma', new Date().toISOString().replace(/[-:.]/g, ''));
  const sonuclar = [];
  try {
    for (const sen of h.senaryolar) {
      const yer = path.join(calisma, sen.ad);
      const kok = path.join(yer, 'kurulu');
      // Senaryo kendi kurulu ağacını/beklenenini taşıyabilir (menu-k17: K17 kök menülü paket).
      fs.cpSync(sen.kurulu || h.kurulu, kok, { recursive: true });
      const bek = sen.beklenenDosyasi ? beklenenOku(dizin, sen.beklenenDosyasi) : beklenen;
      // --kip ortu (mac/Pardus): yazmalar örtüye gider; sınanan ağaç örtünün ETKİN görünümüdür
      // ve paket gövdesi (kurulu/) HER senaryoda birebir aynı kalmalıdır.
      const ortuKoku = s.kip === 'ortu' ? path.join(yer, 'ortu') : '';
      const ekEnv = ortuKoku ? { EMPP_G_ORTU_KOKU: ortuKoku } : {};
      const c = await istemciKos(kok, sen.taban, h.tls.ca, undefined, ekEnv);
      const kip = sen.beklenen === 'guncellendi' ? 'tam' : 'degismez';
      const agac = ortuKoku ? gorunumuYaz(kok, ortuKoku, path.join(yer, 'gorunum')) : kok;
      const d = agaciDogrula(agac, bek, kip);
      if (ortuKoku) {
        const g = agaciDogrula(kok, bek, 'degismez');
        if (!g.gecti) d.gecti = false;
        d.farkli = d.farkli.concat(g.farkli.map((y) => 'GÖVDE:' + y));
        d.fazla = d.fazla.concat(g.fazla.map((y) => 'GÖVDE:' + y));
        d.eksik = d.eksik.concat(g.eksik.map((y) => 'GÖVDE:' + y));
      }
      const disari = ['kacis.txt', 'kacti.txt'].filter(
        (f) => fs.existsSync(path.join(yer, f)) || fs.existsSync(path.join(kok, f)),
      );
      let gecti = d.gecti && !disari.length;
      if (sen.beklenen === 'guncellendi') gecti = gecti && c.rapor.durum === 'guncellendi';
      let ikinci = null;
      if (sen.beklenen === 'guncellendi' && gecti) {
        ikinci = (await istemciKos(kok, sen.taban, h.tls.ca, undefined, ekEnv)).rapor;
        const agac2 = ortuKoku ? gorunumuYaz(kok, ortuKoku, path.join(yer, 'gorunum2')) : kok;
        gecti =
          ikinci.durum === 'guncel' &&
          ikinci.istek === 1 &&
          agaciDogrula(agac2, bek, 'tam').gecti;
      }
      const sonuc = gecti ? 'GEÇTİ' : sen.zorunlu === 'yeni' ? 'AÇIK' : 'KALDI';
      sonuclar.push({
        senaryo: sen.ad,
        zorunlu: sen.zorunlu,
        sonuc,
        durum: c.rapor.durum,
        sebep: c.rapor.sebep,
        ikinci: ikinci ? `${ikinci.durum} (${ikinci.istek} istek)` : null,
        fark: {
          eksik: d.eksik,
          fazla: d.fazla,
          farkli: d.farkli,
          olmamaliVar: d.olmamaliVar,
          disari,
        },
        not: sen.not,
      });
    }
  } finally {
    await sunucu.kapat();
  }
  const zorunluKalan = sonuclar.filter((r) => r.zorunlu === true && r.sonuc !== 'GEÇTİ');
  const ozet = { gecti: zorunluKalan.length === 0, calisma, sonuclar };
  ozet.kip = s.kip || 'yerinde';
  const ad = s.kip === 'ortu' ? 'son-kosu-ortu.json' : 'son-kosu.json';
  fs.writeFileSync(path.join(dizin, ad), JSON.stringify(ozet, null, 2) + '\n');
  return ozet;
}

async function main(argv) {
  const s = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dizin') s.dizin = argv[++i];
    else if (argv[i] === '--kip') s.kip = argv[++i];
    else throw new Error(`bilinmeyen argüman: ${argv[i]}`);
  }
  if (s.kip && s.kip !== 'ortu' && s.kip !== 'yerinde') {
    throw new Error(`--kip yerinde|ortu olmalı: ${s.kip}`);
  }
  const r = await kos(s);
  for (const x of r.sonuclar) {
    console.log(
      `${x.sonuc.padEnd(6)} ${x.senaryo.padEnd(12)} istemci=${x.durum}/${x.sebep}` +
        (x.ikinci ? ` · 2. koşu ${x.ikinci}` : ''),
    );
    if (x.sonuc !== 'GEÇTİ') {
      const f = x.fark;
      const parca = [
        ['eksik', f.eksik],
        ['fazla', f.fazla],
        ['farklı', f.farkli],
        ['olmamalı', f.olmamaliVar],
        ['dışarı', f.disari],
      ]
        .filter(([, l]) => l.length)
        .map(([a, l]) => `${a}: ${l.join(', ')}`);
      if (parca.length) console.log(`         ${parca.join(' · ')}`);
    }
  }
  console.log(
    r.gecti
      ? 'SONUÇ: zorunlu senaryoların hepsi GEÇTİ ' +
        '(AÇIK = yeni G istemcileri için zorunlu, referans istemcide yok)'
      : 'SONUÇ: zorunlu senaryo KALDI',
  );
  return r.gecti ? 0 : 1;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((k) => {
      process.exitCode = k;
    })
    .catch((e) => {
      console.error('HATA: ' + (e && e.message ? e.message : e));
      process.exitCode = 2;
    });
}

module.exports = { kos, istemciKos, saglikYokla };
