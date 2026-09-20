'use strict';
// Köprü PROTOKOLÜ testi — guest taklit edilir ama dosya alışverişi GERÇEKTİR
// (mocklu test taşıma katmanını gizler; burada taşıma katmanı dosya sistemidir).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function tazeKok() {
  const k = fs.mkdtempSync(path.join(os.tmpdir(), 'vmkapi-'));
  process.env.EMPP_VM_KOK = k;
  delete require.cache[require.resolve('./vm-kapi.js')];
  return { kok: k, mod: require('./vm-kapi.js') };
}

function kalpAt(kok, kaymaMs = 0) {
  fs.mkdirSync(path.join(kok, 'durum'), { recursive: true });
  fs.writeFileSync(path.join(kok, 'durum', 'kalp.txt'),
    new Date(Date.now() - kaymaMs).toISOString());
}

test('izleyici hiç başlatılmamışsa YOK', () => {
  const { mod } = tazeKok();
  assert.strictEqual(mod.hazirMi().durum, 'yok');
});

test('taze kalp → ayakta; bayat kalp → ölü', () => {
  const { kok, mod } = tazeKok();
  kalpAt(kok, 0);
  assert.strictEqual(mod.hazirMi().durum, 'ayakta');
  kalpAt(kok, 120000);
  assert.strictEqual(mod.hazirMi().durum, 'olu');
});

test('bozuk kalp dosyası ÇÖKERTMEZ, YOK sayılır', () => {
  const { kok, mod } = tazeKok();
  fs.mkdirSync(path.join(kok, 'durum'), { recursive: true });
  fs.writeFileSync(path.join(kok, 'durum', 'kalp.txt'), 'bugün filan');
  assert.strictEqual(mod.hazirMi().durum, 'yok');
});

test('görev dosyası ATOMİK yazılır — yarım .tmp kalmaz', () => {
  const { kok, mod } = tazeKok();
  const kimlik = mod.gorevYaz({ tur: 'ekran' });
  const gorevler = fs.readdirSync(path.join(kok, 'gorev'));
  assert.deepStrictEqual(gorevler, [`${kimlik}.json`]);
  assert.strictEqual(gorevler.some((f) => f.endsWith('.tmp')), false);
  const g = JSON.parse(fs.readFileSync(path.join(kok, 'gorev', `${kimlik}.json`), 'utf8'));
  assert.strictEqual(g.tur, 'ekran');
});

test('aynı anda yazılan iki görev birbirini EZMEZ', () => {
  const { kok, mod } = tazeKok();
  const k = new Set([mod.gorevYaz({ tur: 'ekran' }), mod.gorevYaz({ tur: 'ekran' }),
    mod.gorevYaz({ tur: 'ekran' })]);
  assert.strictEqual(k.size, 3);
  assert.strictEqual(fs.readdirSync(path.join(kok, 'gorev')).length, 3);
});

test('UÇTAN UCA: guest sonucu yazınca bekleme GEÇTİ döner', async () => {
  const { kok, mod } = tazeKok();
  kalpAt(kok, 0);
  const kimlik = mod.gorevYaz({ tur: 'kur', dosya: 'x.exe', surecAdi: 'X' });
  // guest taklidi: 1 sn sonra atomik sonuç + ekran dosyası
  setTimeout(() => {
    kalpAt(kok, 0);
    const s = path.join(kok, 'sonuc');
    fs.mkdirSync(s, { recursive: true });
    fs.writeFileSync(path.join(s, `${kimlik}.png`), 'sahte-png');
    const gec = path.join(s, `${kimlik}.tmp`);
    fs.writeFileSync(gec, JSON.stringify({ kimlik, cikis: 0, ekran: `${kimlik}.png`, surecSayisi: 4 }));
    fs.renameSync(gec, path.join(s, `${kimlik}.json`));
  }, 1000);
  const k = await mod.bekle(kimlik, 30);
  assert.strictEqual(k.durum, 'gecti');
  assert.strictEqual(k.surecSayisi, 4);
});

test('UÇTAN UCA: çıkış 0 ama ekran yoksa KALDI (çıkış kodu kanıt değil)', async () => {
  const { kok, mod } = tazeKok();
  kalpAt(kok, 0);
  const kimlik = mod.gorevYaz({ tur: 'kur', dosya: 'x.exe' });
  const s = path.join(kok, 'sonuc');
  fs.mkdirSync(s, { recursive: true });
  fs.writeFileSync(path.join(s, `${kimlik}.json`),
    JSON.stringify({ kimlik, cikis: 0, surecSayisi: 4 }));
  const k = await mod.bekle(kimlik, 30);
  assert.strictEqual(k.durum, 'kaldi');
  assert.match(k.sebep, /EKRAN KANITI/);
});

test('beklerken izleyici ÖLÜRSE sonsuza kadar beklenmez', async () => {
  const { kok, mod } = tazeKok();
  kalpAt(kok, 120000);           // zaten bayat
  const kimlik = mod.gorevYaz({ tur: 'ekran' });
  const k = await mod.bekle(kimlik, 60);
  assert.strictEqual(k.durum, 'bozuk');
  assert.match(k.sebep, /izleyici olu/);
});

test('sonuç hiç gelmezse ZAMAN AŞIMI', async () => {
  const { kok, mod } = tazeKok();
  kalpAt(kok, 0);                                          // izleyici ayakta
  const kimlik = mod.gorevYaz({ tur: 'ekran' });
  const sayac = setInterval(() => kalpAt(kok, 0), 500);   // ayakta kalıyor ama iş yapmıyor
  const k = await mod.bekle(kimlik, 4);
  clearInterval(sayac);
  assert.strictEqual(k.durum, 'zaman-asimi');
});
