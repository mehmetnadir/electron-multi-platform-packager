#!/usr/bin/env node
'use strict';
/**
 * G Android canlı uçtan uca — yayın girdilerini ÜRETİLEN APK'nın kendi ağacından hazırlar ve GERÇEK
 * yayın aracını (tools/g-yayin/yayinla.js, TEST anahtar dosyasıyla) dört kez koşturur:
 *   A kabul   73768  2.51.4  index (+işaret) · book1 motoru (+işaret) · book4 EKLE (APK'nın book3'ü) · book2 ÇIKAR
 *   B yabancı 99999  2.51.5  index (+işaret)
 *   C eski    73768  2.51.2  index (+işaret)
 *   D eşit    73768  2.51.4  index (+işaret, A'dan farklı)
 *   W win-kitap 73768 2.51.4  index (+işaret) · book4 EKLE — kaynak ağacının (Windows biçimi) book3'ü
 *             (`--win-kitap <dizin>`; yayın aracının bugünkü ortak arşivi — Android'de RED beklenir)
 * Özel anahtarın içeriği basılmaz. R2/DB'ye hiçbir şey yazılmaz (yayinla.js yerel çıktı üretir).
 *
 *   node tools/g-android/g-canli-yayin.js --apk <apk> --kok <dizin> --anahtar <ozel.key> --taban <https>
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function arg(ad, v = null) {
  const i = process.argv.indexOf(`--${ad}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : v;
}
const MOTOR = '43e23fce2b7009474555a77.js';
const apk = arg('apk');
const kok = arg('kok');
const anahtar = arg('anahtar');
const taban = arg('taban');
if (!apk || !kok || !anahtar || !taban) { console.error('kullanım: --apk --kok --anahtar --taban'); process.exit(2); }

const agac = path.join(kok, 'apk-agac');
fs.mkdirSync(agac, { recursive: true });
const u = spawnSync('unzip', ['-q', '-o', apk, 'assets/public/index.html', `assets/public/book1/${MOTOR}`,
  'assets/public/book3/*', '-d', agac], { encoding: 'utf8', timeout: 110000 });
if (u.status !== 0) { console.error(`unzip: ${u.stderr}`); process.exit(1); }
const pub = path.join(agac, 'assets', 'public');
const index = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
if (!/empp-android-shim\.js/.test(index)) throw new Error('APK index.html Android shim\'ini çağırmıyor');

const girdi = path.join(kok, 'girdi');
fs.mkdirSync(girdi, { recursive: true });
function isaretliIndex(ad) {
  const y = path.join(girdi, `index-${ad}.html`);
  fs.writeFileSync(y, index.replace(/<head([^>]*)>/i, (m) => `${m}\n<meta name="empp-g-e2e" content="${ad}">`));
  return y;
}
const motorYolu = path.join(girdi, `motor-A.js`);
fs.writeFileSync(motorYolu, `${fs.readFileSync(path.join(pub, 'book1', MOTOR), 'utf8')}\n/* EMPP-G-E2E A 2.51.4 */\n`);

const DEPO = path.resolve(__dirname, '..', '..');
function yayinla(ad, ek) {
  const cikti = path.join(kok, ad);
  const a = ['tools/g-yayin/yayinla.js', 'yayinla', '--taban', taban, '--cikti', cikti, '--anahtar-dosya', anahtar, ...ek];
  const r = spawnSync(process.execPath, a, { cwd: DEPO, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
  const son = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-3).join(' | ');
  if (r.status !== 0) throw new Error(`${ad}: yayinla rc=${r.status}: ${son}`);
  return cikti;
}
const sonuc = {};
const liste = [
  ['A', '73768', ['--ilk', '--onceki-surum', '2.51.3', '--surum', '2.51.4', '--index', isaretliIndex('A-2.51.4'),
    '--motor', `book1=${motorYolu}`, '--ekle', `book4=${path.join(pub, 'book3')}`, '--cikar', 'book2']],
  ['B', '99999', ['--ilk', '--onceki-surum', '2.51.3', '--surum', '2.51.5', '--index', isaretliIndex('B-yabanci')]],
  ['C', '73768', ['--ilk', '--onceki-surum', '2.51.1', '--surum', '2.51.2', '--index', isaretliIndex('C-eski')]],
  ['D', '73768', ['--ilk', '--onceki-surum', '2.51.3', '--surum', '2.51.4', '--index', isaretliIndex('D-esit')]],
];
const winKitap = arg('win-kitap');
if (winKitap) {
  liste.push(['W', '73768', ['--ilk', '--onceki-surum', '2.51.3', '--surum', '2.51.4', '--index', isaretliIndex('W-win-kitap'),
    '--ekle', `book4=${winKitap}`]]);
}
const sec = arg('yalniz');
for (const [ad, kimlik, ek] of liste) {
  if (sec && !sec.split(',').includes(ad)) continue;
  const cikti = yayinla(ad, ['--set-kimligi', kimlik, ...ek]);
  const and = path.join(cikti, 'set', kimlik, 'android');
  const m = JSON.parse(fs.readFileSync(path.join(and, 'manifest.json'), 'utf8'));
  sonuc[ad] = {
    android: and, kitap: path.join(cikti, 'set', kimlik, 'kitap'), surum: m.surum, setKimligi: m.setKimligi, kanal: m.kanal,
    kabuk: (m.kabuk || []).map((g) => g.yol),
    kitaplar: (m.kitaplar || []).map((k) => ({ dizin: k.dizin, durum: k.durum, boyut: k.boyut, kaynak: k.kaynak })),
    surumJson: JSON.parse(fs.readFileSync(path.join(and, 'surum.json'), 'utf8')),
  };
}
fs.writeFileSync(path.join(kok, 'yayinlar.json'), JSON.stringify(sonuc, null, 1));
console.log(JSON.stringify(sonuc, null, 1));
