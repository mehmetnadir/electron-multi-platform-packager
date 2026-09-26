'use strict';
/**
 * G ENJEKSİYON KARARI (2026-09-26, e2e denetçi bulgusu): taban verilmediğinde set-kimligi
 * yer tutucu `https://panel-yok.invalid/set-guncelleme` yazıyordu ve güncelleyici YİNE enjekte
 * ediliyordu → "G'li" görünen ama hiç güncelleme alamayan paket. Artık kimlik / gerçek taban /
 * imza anahtarı yoksa enjekte EDİLMEZ, sebep görünür yazılır. Ayrıca claim `surum`u
 * empp-set.json'a iner (istemcinin monoton tabanı).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ge = require('./guncelleyici-enjekte');
const sk = require('./set-kimligi');

const ACIK = crypto.generateKeyPairSync('ed25519').publicKey
  .export({ type: 'spki', format: 'der' }).toString('base64');
const MAIN = "const { app } = require('electron');\napp.whenReady().then(() => {});\n";

function paket() {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-gkarar-'));
  fs.writeFileSync(path.join(kok, 'main.js'), MAIN);
  fs.writeFileSync(path.join(kok, 'index.html'), '<html></html>');
  fs.mkdirSync(path.join(kok, 'book1'));
  return kok;
}
const yaz = (kok, o) => sk.paketeYaz(kok, Object.assign({ env: {}, damga: 0 }, o)).then((r) => r.harita);
const TAM = { setKimligi: '74390', guncellemeTabani: 'https://g.example.org/set-guncelleme', imzaAcikAnahtari: ACIK };

test('karar: taban verilmedi → set-kimligi yer tutucu yazar (kaynak varsayilan) ve karar taban-yok', async () => {
  const h = await yaz(paket(), { setKimligi: '74390', imzaAcikAnahtari: ACIK });
  assert.strictEqual(h.taban, sk.VARSAYILAN_TABAN, 'ölçüm: yer tutucu hâlâ yazılıyor');
  assert.strictEqual(h.tabanKaynagi, 'varsayilan');
  assert.deepStrictEqual(ge.enjeksiyonKarari(h), { enjekte: false, sebep: 'taban-yok' });
});

test('karar: yer tutucu alan adı istek/env ile gelse de (.invalid) taban-yok', async () => {
  const h1 = await yaz(paket(), { ...TAM, guncellemeTabani: 'https://panel-yok.invalid/set-guncelleme' });
  assert.strictEqual(h1.tabanKaynagi, 'istek');
  assert.strictEqual(ge.enjeksiyonKarari(h1).sebep, 'taban-yok');
  const h2 = await yaz(paket(), { ...TAM, guncellemeTabani: null, env: { EMPP_GUNCELLEME_TABANI: 'https://x.invalid/g' } });
  assert.strictEqual(h2.tabanKaynagi, 'env');
  assert.strictEqual(ge.enjeksiyonKarari(h2).sebep, 'taban-yok');
});

test('karar: istemcinin reddedeceği taban (uzak http) → taban-yok', async () => {
  const h = await yaz(paket(), { ...TAM, guncellemeTabani: 'http://g.example.org/set-guncelleme' });
  assert.strictEqual(ge.enjeksiyonKarari(h).sebep, 'taban-yok');
});

test('karar: set kimliği / imza anahtarı yoksa enjekte edilmez; harita yoksa da', async () => {
  assert.strictEqual(ge.enjeksiyonKarari(await yaz(paket(), { ...TAM, setKimligi: null })).sebep, 'set-kimligi-yok');
  assert.strictEqual(ge.enjeksiyonKarari(await yaz(paket(), { ...TAM, imzaAcikAnahtari: null })).sebep, 'imza-anahtari-yok');
  assert.deepStrictEqual(ge.enjeksiyonKarari(null), { enjekte: false, sebep: 'set-haritasi-yok' });
});

test('karar: kimlik + gerçek https taban + anahtar → enjekte', async () => {
  assert.deepStrictEqual(ge.enjeksiyonKarari(await yaz(paket(), TAM)), { enjekte: true, sebep: 'hazir' });
  const yerel = await yaz(paket(), { ...TAM, guncellemeTabani: 'http://127.0.0.1:8453/set-guncelleme' });
  assert.strictEqual(ge.enjeksiyonKarari(yerel).enjekte, true, 'yerel test sunucusu (istemci de kabul eder)');
});

test('kararliUygula: yer tutucu tabanlı pakete HİÇBİR şey yazılmaz, sebep görünür uyarılır', async () => {
  const kok = paket();
  const h = await yaz(kok, { setKimligi: '74390', imzaAcikAnahtari: ACIK });
  const uyarilar = [];
  const { karar, sonuc } = await ge.kararliUygula(kok, h, { uyar: (s) => uyarilar.push(s) });
  assert.strictEqual(karar.enjekte, false);
  assert.deepStrictEqual(sonuc, []);
  assert.strictEqual(fs.readFileSync(path.join(kok, 'main.js'), 'utf8'), MAIN, 'main.js yamalanmamalı');
  assert.ok(!fs.existsSync(path.join(kok, ge.MODUL_ADI)), 'modül kopyalanmamalı');
  assert.strictEqual(uyarilar.length, 1);
  assert.match(uyarilar[0], /ENJEKTE EDİLMEDİ \(taban-yok\)/);
});

test('kararliUygula: tam kimlikli pakete enjekte eder (modül + yama)', async () => {
  const kok = paket();
  const h = await yaz(kok, TAM);
  const uyarilar = [];
  const { karar, sonuc } = await ge.kararliUygula(kok, h, { uyar: (s) => uyarilar.push(s) });
  assert.strictEqual(karar.enjekte, true);
  assert.ok(sonuc.some((x) => x.uygulandi && x.modul));
  assert.match(fs.readFileSync(path.join(kok, 'main.js'), 'utf8'), new RegExp(ge.ISARET));
  assert.ok(fs.existsSync(path.join(kok, ge.MODUL_ADI)));
  assert.deepStrictEqual(uyarilar, []);
});

test('set-kimligi surum: G3 yazılır; yoksa null; G3 değilse düşer + sebep (sessiz değil)', async () => {
  assert.strictEqual((await yaz(paket(), { ...TAM, surum: '2.90.3' })).surum, '2.90.3');
  assert.strictEqual((await yaz(paket(), TAM)).surum, null);
  const bozuk = await yaz(paket(), { ...TAM, surum: '1.0.0' });
  assert.strictEqual(bozuk.surum, null);
  assert.match(bozuk.sebep, /surum G3 değil/);
  const kok = paket();
  await yaz(kok, { ...TAM, surum: '2.90.3' });
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(kok, 'empp-set.json'), 'utf8')).surum, '2.90.3');
});

test('SENTİNEL: packagingService set haritasını karara verir, claim surum\'unu paketeYaz\'a geçirir', () => {
  const k = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.match(k, /setHaritasi = sh;/, 'harita karara taşınmıyor');
  assert.match(k, /guncelleyiciEnjekte\.kararliUygula\(\s*workingPath, setHaritasi,/);
  assert.ok(!/guncelleyiciEnjekte\.paketeUygula\(/.test(k), 'karar atlanarak doğrudan enjekte ediliyor');
  assert.match(k, /surum: jobInfo\.surum \|\|/, 'claim surum paketeYaz\'a geçmiyor');
});
