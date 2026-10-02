#!/usr/bin/env node
'use strict';
/**
 * SAHTE windows-kasa köprü sürücüsü (testler için) — `tools/windows/vm-kapi.js calistir` yerine geçer.
 *
 * Gerçek makineye/köprüye DOKUNMAZ. Kapının hazırladığını DOĞRULAR (sunulan exe, MACIP'i yazılmış
 * kabul.py, sarmalayıcı ps1) ve SAHTE_KASA_KIP'e göre kabul.py'nin bıraktığı izleri üretir:
 * `sonuc/windows-kasa/rapor-<anahtar>.png` (JSON) + menü/kitap ekranları + stdout `JSON>>>`.
 *
 * Kipler: gecti · kaldi-kitap · kurulmadi · indirilemedi · pe-degil · zaman-asimi · bozuk ·
 *         yalniz-stdout · gecti-yavas (1,5 sn bekler; kilit sıralaması testi için)
 * Ortam: EMPP_VM_KOK (kapı verir), SAHTE_KASA_KIP, SAHTE_KASA_GUNLUK (her çağrı bir JSON satırı).
 */
const fs = require('fs');
const path = require('path');

const kok = process.env.EMPP_VM_KOK;
const kip = process.env.SAHTE_KASA_KIP || 'gecti';
const gunluk = process.env.SAHTE_KASA_GUNLUK;
const komut = process.argv[3] || '';
const anahtar = (/wrap-([A-Za-z0-9_-]+)\.ps1/.exec(komut) || [])[1];
const bas = Date.now();

function kaydet(o) {
  if (gunluk) fs.appendFileSync(gunluk, `${JSON.stringify(o)}\n`);
}

const exeYol = path.join(kok, `kabul-${anahtar}.exe`);
const pyYol = path.join(kok, `kabul-${anahtar}.py`);
const psYol = path.join(kok, `wrap-${anahtar}.ps1`);
const gordu = {
  anahtar,
  makine: process.argv[process.argv.indexOf('--makine') + 1],
  zamanAsimi: process.argv[process.argv.indexOf('--zaman-asimi') + 1],
  exeBoyut: fs.existsSync(exeYol) ? fs.statSync(exeYol).size : null,
  exeBas: fs.existsSync(exeYol) ? fs.readFileSync(exeYol).subarray(0, 2).toString('latin1') : null,
  pyMacip: fs.existsSync(pyYol) ? (/^MACIP = "([^"]*)"/m.exec(fs.readFileSync(pyYol, 'utf8')) || [])[1] : null,
  psVar: fs.existsSync(psYol),
  psMetni: fs.existsSync(psYol) ? fs.readFileSync(psYol, 'utf8') : '',
  komutUzunluk: komut.length,
};

function sonucYaz(ad, veri) {
  const d = path.join(kok, 'sonuc', 'windows-kasa');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, ad), veri);
}

function kitap(sira, sonuc) {
  return {
    sira, id: `book${sira}`, ad: `book${sira}`, sayfa: sonuc === 'GECTI' ? '1/120' : '12/120', toplamSayfa: 120,
    thumbOK: sonuc === 'GECTI' ? 7 : 0, canvasDolu: sonuc === 'GECTI' ? 4000 : 0, canvasRenk: 300,
    ilkSayfada: sonuc === 'GECTI', ekran: `${anahtar}-k${String(sira).padStart(2, '0')}`, sonuc,
  };
}

function bitir(rapor, { dosya = true } = {}) {
  if (dosya) {
    sonucYaz(`${anahtar}-menu.png`, Buffer.from('PNGmenu'));
    for (const k of rapor.kitaplar || []) sonucYaz(`${k.ekran}.png`, Buffer.from(`PNG${k.sira}`));
    sonucYaz(`rapor-${anahtar}.png`, JSON.stringify(rapor));
  }
  kaydet({ ...gordu, kip, bas, son: Date.now() });
  console.log(`görev 20261002-000000-1 [windows-kasa] — ${komut.slice(0, 60)}`);
  console.log(`çıkış 0\nINDIRME|${anahtar}|{}\nRAPOR|${anahtar}|${rapor.sonuc}\nJSON>>>${JSON.stringify(rapor)}`);
  process.exit(0);
}

const temel = { bookId: anahtar, baslik: 'Test', indirme: { durum: 'INDI', bayt: gordu.exeBoyut } };
const bekle = (ms) => { const s = Date.now() + ms; while (Date.now() < s) { /* meşgul bekleme */ } };

if (kip === 'gecti' || kip === 'gecti-yavas') {
  if (kip === 'gecti-yavas') bekle(1500);
  bitir({ ...temel, kurulum: { durum: 'KURULDU', aile: 'nsis' }, kitaplar: [kitap(1, 'GECTI'), kitap(2, 'GECTI')],
    gecenKitap: 2, toplamKitap: 2, sonuc: 'GECTI', kaldirma: 'KALDIRILDI' });
} else if (kip === 'kaldi-kitap') {
  bitir({ ...temel, kurulum: { durum: 'KURULDU', aile: 'nsis' }, kitaplar: [kitap(1, 'GECTI'), kitap(2, 'KALDI')],
    gecenKitap: 1, toplamKitap: 2, sonuc: 'KALDI', kaldirma: 'KALDIRILDI' });
} else if (kip === 'kurulmadi') {
  bitir({ ...temel, kurulum: { durum: 'KURULMADI', aile: 'nsis' }, sonuc: 'KALDI', sebep: 'KURULMADI' });
} else if (kip === 'indirilemedi') {
  bitir({ ...temel, indirme: { durum: 'INDIRILEMEDI', cikis: 7 }, sonuc: 'KALDI', sebep: 'INDIRILEMEDI' });
} else if (kip === 'pe-degil') {
  bitir({ ...temel, indirme: { durum: 'PE_DEGIL', bayt: 9 }, sonuc: 'KALDI', sebep: 'PE_DEGIL' });
} else if (kip === 'yalniz-stdout') {
  bitir({ ...temel, kurulum: { durum: 'KURULDU', aile: 'nsis' }, kitaplar: [kitap(1, 'GECTI')],
    gecenKitap: 1, toplamKitap: 1, sonuc: 'GECTI' }, { dosya: false });
} else if (kip === 'zaman-asimi') {
  kaydet({ ...gordu, kip, bas, son: Date.now() });
  console.log(JSON.stringify({ durum: 'zaman-asimi', sebep: 'guest komutu kesti: 2640 sn' }, null, 2));
  process.exit(1);
} else if (kip === 'bozuk') {
  kaydet({ ...gordu, kip, bas, son: Date.now() });
  console.log(JSON.stringify({ durum: 'bozuk', sebep: 'izleyici olu: son kalp 400 sn önce (eşik 300)' }, null, 2));
  process.exit(1);
} else {
  console.error(`bilinmeyen kip ${kip}`);
  process.exit(2);
}
