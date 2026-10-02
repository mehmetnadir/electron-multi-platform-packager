'use strict';
// Yedek main.js şablonu (yedek-main.js) — 02.10 74430 Flashy Grade 4 Set: template literal `\n\n`
// gerçek satır sonuna dönüştü, main.js:27 SyntaxError, pencere hiç açılmadı (ProBook kabulü RED).
// Kapı: üretilen kaynak vm.Script ile DERLENİR (çalıştırılmaz); tuzak adlar + mutasyon.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { yedekMainJs, basligiGuncelle, jsMetin } = require('./yedek-main');
const { readyToShowEkle } = require('./acilis-yamasi');

const derlenir = (kaynak, ad = 'main.js') => { new vm.Script(kaynak, { filename: ad }); return true; };

const TUZAK_ADLAR = [
  'Flashy Grade 4 Set',
  "Ali'nin Kitabı",
  'Çift "tırnak" ve \\ ters bölü',
  'Satır\nsonu',
  'Şablon ${process.exit(1)} ve `backtick`',
  'Dolar $& $1 $$ dizisi',
  '',
];

test('yedekMainJs: 74430 değerleriyle derlenir (kök neden: main.js:27 SyntaxError)', () => {
  const k = yedekMainJs({ windowTitle: 'Flashy Grade 4 Set', appName: 'Flashy Grade 4 Set', companyName: null });
  assert.ok(derlenir(k));
  // detail metni tek satırlık literal; içindeki satır sonu KAÇIŞLI (\\n), gerçek değil
  const detay = k.split('\n').find((s) => s.includes('detail:'));
  assert.ok(detay, 'detail satırı yok');
  assert.match(detay, /hazırlanmıştır\.\\n\\nAppImage/);
  assert.match(detay, /Bilinmeyen Kurum/);
});

test('yedekMainJs: tuzak adların hepsiyle derlenir ve değer birebir korunur', () => {
  for (const ad of TUZAK_ADLAR) {
    for (const kurum of [null, ad, "O'Neil Yayın"]) {
      const windowTitle = kurum ? `${ad} - ${kurum}` : ad;
      const k = yedekMainJs({ windowTitle, appName: ad, companyName: kurum });
      assert.ok(derlenir(k), `derlenmedi: ${JSON.stringify(ad)} / ${JSON.stringify(kurum)}`);
      // title literal'i geri okunduğunda aynı değer
      const m = /title: ("(?:[^"\\]|\\.)*"),/.exec(k);
      assert.equal(JSON.parse(m[1]), windowTitle);
    }
  }
});

test('yedekMainJs: companyName şablonda serbest tanımlayıcı değil (ReferenceError yok)', () => {
  const k = yedekMainJs({ windowTitle: 'X', appName: 'X', companyName: 'Flashy ELT' });
  assert.ok(!/\(companyName \|\|/.test(k), 'tanımsız companyName ifadesi şablonda kalmış');
  assert.match(k, /Bu uygulama Flashy ELT tarafından/);
});

test('basligiGuncelle: tuzak başlıkla mevcut main.js derlenir kalır, $-dizileri bozulmaz', () => {
  const temel = yedekMainJs({ windowTitle: 'eski', appName: 'eski' });
  for (const ad of TUZAK_ADLAR) {
    const yeni = basligiGuncelle(temel, ad);
    assert.ok(derlenir(yeni), `derlenmedi: ${JSON.stringify(ad)}`);
    assert.equal(JSON.parse(/title: ("(?:[^"\\]|\\.)*"),/.exec(yeni)[1]), ad);
  }
  // yayıncının tek tırnaklı electron.js'i
  const yayinci = "const w = new BrowserWindow({ title: 'Yayıncı', width: 800 });";
  assert.ok(derlenir(basligiGuncelle(yayinci, "Ali'nin \"Seti\"")));
  // başlık yoksa aynen
  assert.equal(basligiGuncelle('const a = 1;', 'X'), 'const a = 1;');
});

test('basligiGuncelle: kaçışlı tırnaklı mevcut başlığı tam literal olarak değiştirir (kuyruk kalmaz)', () => {
  const ilk = basligiGuncelle(yedekMainJs({ windowTitle: 'x', appName: 'x' }), 'A "b" c');
  const iki = basligiGuncelle(ilk, 'Yeni');
  assert.ok(derlenir(iki));
  assert.ok(!iki.includes('b\\" c'), 'eski literal kuyruğu dosyada kaldı');
});

test('zincir: yedek şablon + başlık + EMPP_READY_TO_SHOW yaması sonrası derlenir', () => {
  const k = yedekMainJs({ windowTitle: "Ali'nin Kitabı - Kurum", appName: "Ali'nin Kitabı", companyName: 'Kurum' });
  const yama = readyToShowEkle(basligiGuncelle(k, "Ali'nin Kitabı - Kurum"));
  assert.ok(derlenir(yama.icerik));
});

test('jsMetin: null/undefined boş literal', () => {
  assert.equal(jsMetin(null), '""');
  assert.equal(jsMetin(undefined), '""');
});

// MUTASYON: eski şablonun (backtick içinde '\n\n' + kaçışsız ${...}) aynı girdiyle DERLENMEDİĞİ
// kanıtlanır — bu test eski hatayı yakalayabilen bir kapı olduğumuzu gösterir.
test('mutasyon: eski template-literal şablonu 74430 girdisiyle SyntaxError verir', () => {
  const appName = 'Flashy Grade 4 Set';
  const eski = `
function createWindow() {
  const mainWindow = new BrowserWindow({ title: '${appName}' });
  dialog.showMessageBox(mainWindow, {
    detail: 'Bu uygulama ' + (companyName || 'Bilinmeyen Kurum') + ' tarafından hazırlanmıştır.\n\nAppImage formatı sayesinde yönetici şifresi gerekmedi.',
  });
}`;
  assert.throws(() => derlenir(eski), SyntaxError);
  // ve kaçışsız tek tırnak enjeksiyonu
  const eskiBaslik = `const o = { title: '${"Ali'nin Kitabı"}' };`;
  assert.throws(() => derlenir(eskiBaslik), SyntaxError);
});

test('packagingService: yedek main.js YALNIZ yedekMainJs üzerinden, başlık YALNIZ basligiGuncelle ile', () => {
  const ps = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.match(ps, /yedekMainJs\(\{ windowTitle, appName, companyName \}\)/);
  assert.match(ps, /basligiGuncelle\(mainJsContent, windowTitle\)/);
  assert.ok(!ps.includes("tarafından hazırlanmıştır.\\n\\nAppImage"), 'eski şablon packagingService içinde kalmış');
  assert.ok(!/title: '\$\{windowTitle\}'/.test(ps), 'kaçışsız başlık enjeksiyonu kalmış');
});
