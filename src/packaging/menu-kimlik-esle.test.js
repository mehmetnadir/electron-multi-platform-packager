'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const vm = require('vm');
const crypto = require('crypto');
const fs = require('fs-extra');
const M = require('./menu-kimlik-esle');
const K = require('./okuyucu-kabugu');

const sha12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const H = (c) => c.repeat(20);

// Kanonik 1.13.14 `1478d1f68940d2fdb30a.main.js` içindeki h — BİREBİR (2026-10-05 dosyadan).
const H_KANONIK = 'h=function(e,n,r){var o,i;return null===(o=t.main.Group.find((function(t){'
  + 'var n;return parseInt(null==t||null===(n=t.$)||void 0===n?void 0:n.ID)===e})))||void 0===o'
  + '||null===(i=o.Tab.find((function(e){var t;return parseInt(null==e||null===(t=e.$)||'
  + 'void 0===t?void 0:t.ID)===n})))||void 0===i?void 0:i.cover.find((function(e){var t;'
  + 'return parseInt(null==e||null===(t=e.$)||void 0===t?void 0:t.ID)===r}))}';

/** h'yi gerçek bağlamına benzer bir main.js'e gömer (rozet parça haritası dahil). */
function mainJs(hMetni = H_KANONIK, parcaHash = H('e')) {
  return `x={923:"${parcaHash}"};var p=function(){var e=1;var s=[],f=[],`
    + `d=function(e){return f.filter((function(t){return t.TabId==e}))},${hMetni},`
    + 'm=function(e){var n=h(e.GroupId,e.TabId,e.Id);return n};return m}();';
}

/** Metindeki `<ad>=function(...){...}` ifadesini `t` köküne bağlı fonksiyona çevirir. */
function hDerle(metin, agac, ad = 'h') {
  // Gerçek dosyada başka `h=function(` da var: yamalıda işarete en yakın, yamasızda yapısal bul.
  const bas = metin.includes(M.ISARET)
    ? metin.lastIndexOf(`${ad}=function(`, metin.indexOf(M.ISARET))
    : (M.hFonksiyonuBul(metin) || { bas: -1 }).bas;
  assert.ok(bas >= 0, 'h bulunamadı');
  const son = M.parantezSonu(metin, metin.indexOf('{', bas));
  assert.ok(son > bas, 'h kapanışı bulunamadı');
  const ifade = metin.slice(bas + ad.length + 1, son + 1);
  // eslint-disable-next-line no-new-func
  return new Function('t', `return ${ifade}`)(agac);
}

/** Sahte yerel menü: paket menüsü biçimi (Group=setId, Tab=1..n). */
function paketMenusu() {
  return { main: { $: { ID: '45449' }, Group: [
    { $: { ID: '45449' }, Tab: [
      { $: { ID: '1' }, cover: [{ $: { ID: '31456', version: '10' } }] },
      { $: { ID: '2' }, cover: [{ $: { ID: '31457', version: '3' } }] },
    ] },
  ] } };
}

const GERCEK_ADAYLAR = [
  path.join(os.homedir(), '.empp-agent', 'kabuk', '1.13.14', '1478d1f68940d2fdb30a.main.js'),
  '/private/tmp/claude-501/-Users-nadir/006cff11-8d65-4460-944b-a19c21ec727c/scratchpad/i12/'
    + '1478d1f68940d2fdb30a.main.js',
];
const GERCEK = GERCEK_ADAYLAR.find((p) => fs.existsSync(p));

test('SAF: gerçek kanonik main.js → yamandi; ikinci kez zaten; sözdizimi geçerli', {
  skip: GERCEK ? false : 'gerçek 1.13.14 main.js bu makinede yok',
}, () => {
  const ham = fs.readFileSync(GERCEK, 'utf8');
  const r = M.menuKimlikEsleYamasi(ham);
  assert.equal(r.durum, 'yamandi');
  assert.ok(r.metin.includes(M.ISARET));
  assert.doesNotThrow(() => new vm.Script(r.metin), 'yamalı main.js derlenebilir');
  // Rozet kalıpları korunur (motor-surumu.rozetSurumuOkuEsz bunlarla okur).
  const parca = (s) => [...s.matchAll(/(\d+):"([0-9a-f]{20})"/g)].map((m) => m[0]).join();
  assert.equal(parca(r.metin), parca(ham));
  assert.equal(r.metin.length - ham.length, 636, 'eklenen kod boyu (kanonik 1.13.14)');
  const r2 = M.menuKimlikEsleYamasi(r.metin);
  assert.equal(r2.durum, 'zaten');
  assert.equal(r2.metin, r.metin);
  // gerçek yamalı h davranışı
  const h = hDerle(r.metin, paketMenusu());
  assert.equal(h(683, 1419, 31456).$.version, '10');
  assert.equal(hDerle(ham, paketMenusu())(683, 1419, 31456), undefined);
});

test('SAF: birebir kanonik h kesiti → yamandi, ASCII, zaten; bozuk → kalip-yok', () => {
  const ham = mainJs();
  const r = M.menuKimlikEsleYamasi(ham);
  assert.equal(r.durum, 'yamandi');
  const eklenen = r.metin.slice(ham.indexOf('h=function'), r.metin.length - (ham.length
    - ham.indexOf('h=function') - H_KANONIK.length));
  assert.match(eklenen, /^[\x20-\x7e]+$/, 'yalnız yazdırılabilir ASCII');
  assert.doesNotThrow(() => new vm.Script(r.metin));
  assert.equal(M.menuKimlikEsleYamasi(r.metin).durum, 'zaten');
  for (const bozuk of ['', null, 'var a=1;', ham.replace('.main.Group.find(', '.main.Grup.find('),
    ham.replace('.cover.find(', '.kapak.find(')]) {
    const b = M.menuKimlikEsleYamasi(bozuk);
    assert.equal(b.durum, 'kalip-yok');
    assert.equal(b.metin, String(bozuk == null ? '' : bozuk), 'kalıpsızda metin aynen');
  }
});

test('SAF: kalıp iki kez geçerse (belirsiz) ya da gövde dize taşırsa kalip-yok', () => {
  const ikiKez = mainJs(`${H_KANONIK},${H_KANONIK.replace(/^h=/, 'k=')}`);
  assert.equal(M.menuKimlikEsleYamasi(ikiKez).durum, 'kalip-yok');
  const dizeli = mainJs(H_KANONIK.replace('===r}))}', '===r||"x"}))}'));
  assert.equal(M.menuKimlikEsleYamasi(dizeli).durum, 'kalip-yok');
});

test('SAF: gövdede arguments/this varsa (IIFE sarmalı güvensiz) kalip-yok', () => {
  for (const ek of ['arguments.length', 'this.x']) {
    const govdeli = mainJs(H_KANONIK.replace('===r}))}', `===r||${ek}}))}`));
    const r = M.menuKimlikEsleYamasi(govdeli);
    assert.equal(r.durum, 'kalip-yok', ek);
    assert.equal(r.metin, govdeli);
  }
  // kelime sınırı: `thisX` / `argumentsY` gibi adlar engellemez
  const benzer = mainJs(H_KANONIK.replace('===r}))}', '===r||thisX||argumentsY}))}'));
  assert.equal(M.menuKimlikEsleYamasi(benzer).durum, 'yamandi');
});

test('SAF: küçültücü adları değişse de yapısal tanınır', () => {
  const adli = H_KANONIK.replace(/^h=function\(e,n,r\)\{var o,i;return null===\(o=t\.main/,
    'Q=function(a,b,c){var x,y;return null===(x=$m.main')
    .replace('|void 0===o||null===(i=o.Tab', '|void 0===x||null===(y=x.Tab')
    .replace(')===e})))', ')===a})))').replace(')===n})))||void 0===i?void 0:i.cover',
      ')===b})))||void 0===y?void 0:y.cover')
    .replace(')===r}))}', ')===c}))}');
  const r = M.menuKimlikEsleYamasi(`var z=0,${adli};`);
  assert.equal(r.durum, 'yamandi');
  const bas = r.metin.indexOf('Q=function(');
  const son = M.parantezSonu(r.metin, r.metin.indexOf('{', bas));
  // eslint-disable-next-line no-new-func
  const q = new Function('$m', `return ${r.metin.slice(bas + 2, son + 1)}`)(paketMenusu());
  assert.equal(q(683, 1419, 31457).$.version, '3');
});

test('DAVRANIŞ: panel kimlikleri (683/1419) → yamalı v10, yamasız undefined', () => {
  const ham = mainJs();
  const yamali = M.menuKimlikEsleYamasi(ham).metin;
  const agac = paketMenusu();
  const hY = hDerle(yamali, agac);
  const hE = hDerle(ham, agac);
  assert.equal(hY(683, 1419, 31456).$.version, '10');
  assert.equal(hE(683, 1419, 31456), undefined);
  // Dize kimlik (panel bazen string döndürür) sayısal karşılaştırılır.
  assert.equal(hY(683, 4294, '31457').$.version, '3');
  // Ağaçta olmayan kapak → ikisi de undefined (version ?? 1 davranışı değişmez).
  assert.equal(hY(683, 1419, 99999), undefined);
  assert.equal(hY(683, 1419, undefined), undefined);
});

test('DAVRANIŞ: Group/Tab eşleşiyorsa eski davranış aynen (öncelik Group/Tab kapağında)', () => {
  const ham = mainJs();
  const yamali = M.menuKimlikEsleYamasi(ham).metin;
  const agac = paketMenusu();
  // aynı kapak kimliği başka bir grupta da var — Group/Tab eşleşmesi kazanmalı
  agac.main.Group.unshift({ $: { ID: '9' }, Tab: [{ $: { ID: '9' },
    cover: [{ $: { ID: '31456', version: '77' } }] }] });
  const hY = hDerle(yamali, agac);
  const hE = hDerle(ham, agac);
  for (const [g, tb, c] of [[45449, 1, 31456], [45449, 2, 31457], [9, 9, 31456]]) {
    assert.strictEqual(hY(g, tb, c), hE(g, tb, c));
  }
  assert.equal(hY(45449, 1, 31456).$.version, '10');
  // Eşleşmeyen Group/Tab'da ağaçtaki İLK kapak döner.
  assert.equal(hY(683, 1419, 31456).$.version, '77');
  // Eski kod Tab'sız grupta TypeError atıyordu — yamalı da aynı (davranış değişmez).
  const tabsiz = { main: { Group: [{ $: { ID: '5' } }] } };
  assert.throws(() => hDerle(ham, tabsiz)(5, 1, 1), TypeError);
  assert.throws(() => hDerle(yamali, tabsiz)(5, 1, 1), TypeError);
});

test('toplamDurum / acikMi', () => {
  assert.equal(M.toplamDurum([]), 'kalip-yok');
  assert.equal(M.toplamDurum([{ durum: 'zaten' }, { durum: 'yamandi' }]), 'yamandi');
  assert.equal(M.toplamDurum([{ durum: 'zaten' }]), 'zaten');
  assert.equal(M.toplamDurum([{ durum: 'yamandi' }, { durum: 'kalip-yok' }]), 'kalip-yok');
  assert.equal(M.acikMi({}), true);
  assert.equal(M.acikMi({ EMPP_MENU_ID_ESLE: '0' }), false);
});

/** okuyucu-kabugu.test.js ile aynı düzen: eski kabuklu paket + h taşıyan kanonik. */
async function alanKur({ kanonikMain = mainJs(), kitapSayisi = 2 } = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'menu-kimlik-'));
  const kok = path.join(tmp, 'paket');
  for (let i = 1; i <= kitapSayisi; i += 1) {
    const b = path.join(kok, `book${i}`);
    await fs.outputFile(path.join(b, `${H('a')}.main.js`), `x={923:"${H('b')}"}`);
    await fs.writeFile(path.join(b, `${H('b')}.923.js`),
      '4147:function(e){e.exports={i8:"1.11.5"}}');
    await fs.writeFile(path.join(b, 'index.html'),
      `<head><script defer="defer" src="./${H('a')}.main.js"></script></head>`);
    await fs.writeFile(path.join(b, 'version.txt'), '1.11.5');
  }
  await fs.writeFile(path.join(kok, 'paket.json'), JSON.stringify({ setId: 'S1' }));
  const kd = path.join(tmp, 'kabuk', '1.13.14');
  const main = `${H('d')}.main.js`;
  await fs.outputFile(path.join(kd, main), kanonikMain);
  await fs.writeFile(path.join(kd, `${H('e')}.923.js`),
    '4147:function(e){e.exports={i8:"1.13.14"}}');
  const dosyalar = [];
  for (const ad of [main, `${H('e')}.923.js`]) {
    dosyalar.push({ ad, sha12: sha12(await fs.readFile(path.join(kd, ad))) });
  }
  await fs.writeFile(path.join(kd, 'manifest.json'),
    JSON.stringify({ surum: '1.13.14', main, dosyalar }));
  const kYol = path.join(tmp, 'kabuk', 'kanonik.json');
  await fs.writeFile(kYol, JSON.stringify({ surum: '1.13.14', dizin: kd }));
  return { tmp, kok, kYol, kd, main };
}

test('AKIŞ: kabuk değişimi → adım main.js yamalar, kapı geçer, kanonik dokunulmaz', async () => {
  const { tmp, kok, kYol, kd, main } = await alanKur();
  try {
    const kanonikOnce = sha12(await fs.readFile(path.join(kd, main)));
    const damga = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(damga.durum, 'guncel');
    const uyarilar = [];
    const s = await M.kabukSonrasiAdim(kok, { log: () => {}, uyar: (x) => uyarilar.push(x) });
    assert.equal(s.durum, 'yamandi');
    assert.deepEqual(uyarilar, []);
    for (const b of ['book1', 'book2']) {
      const metin = await fs.readFile(path.join(kok, b, main), 'utf8');
      assert.ok(metin.includes(M.ISARET), `${b} yamalı`);
      assert.equal(hDerle(metin, paketMenusu())(683, 1419, 31456).$.version, '10');
    }
    const kanonik = await K.kanonikKabukYukle(kYol);
    assert.ok(kanonik, 'kanonik dizin doğrulaması hâlâ geçer');
    assert.equal(sha12(await fs.readFile(path.join(kd, main))), kanonikOnce, 'kanonik değişmedi');
    const kapi = await K.kabukKapisi(kok, kanonik);
    assert.equal(kapi.gecti, true, kapi.sebep);
    const pj = JSON.parse(await fs.readFile(path.join(kok, 'paket.json'), 'utf8'));
    assert.equal(pj.kabukSurumu.durum, 'guncel');
    assert.equal(pj.menuKimlikEsle, 'yamandi');
    assert.equal(pj.setId, 'S1');

    // İKİNCİ GEÇİŞ (yeniden paketleme): kabuk 'ayni' → yamayı geri almaz; adım 'zaten'.
    const d2 = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(d2.durum, 'guncel');
    assert.equal(d2.degisen, 0);
    const s2 = await M.kabukSonrasiAdim(kok, { log: () => {}, uyar: (x) => uyarilar.push(x) });
    assert.equal(s2.durum, 'zaten');
    assert.ok((await fs.readFile(path.join(kok, 'book1', main), 'utf8')).includes(M.ISARET));
    assert.equal((await K.kabukKapisi(kok, kanonik)).gecti, true);
    assert.equal(JSON.parse(await fs.readFile(path.join(kok, 'paket.json'), 'utf8')).menuKimlikEsle,
      'zaten');
  } finally { await fs.remove(tmp); }
});

test('AKIŞ: kalıp yoksa paketleme durmaz — uyarı + paket.json "kalip-yok"', async () => {
  const { tmp, kok, kYol, main } = await alanKur({ kanonikMain: `x={923:"${H('e')}"};var a=1;` });
  try {
    await K.okuyucuKabuguDegistir(kok, kYol);
    const once = await fs.readFile(path.join(kok, 'book1', main), 'utf8');
    const uyarilar = [];
    const s = await M.kabukSonrasiAdim(kok, { log: () => {}, uyar: (x) => uyarilar.push(x) });
    assert.equal(s.durum, 'kalip-yok');
    assert.equal(uyarilar.length, 1);
    assert.match(uyarilar[0], /kalıbı tutmadı/);
    assert.equal(await fs.readFile(path.join(kok, 'book1', main), 'utf8'), once, 'dosya aynen');
    const pj = JSON.parse(await fs.readFile(path.join(kok, 'paket.json'), 'utf8'));
    assert.equal(pj.menuKimlikEsle, 'kalip-yok');
    assert.equal(pj.kabukSurumu.durum, 'guncel');
  } finally { await fs.remove(tmp); }
});

test('AKIŞ: tek kitap → kök main.js yamalanır; index yoksa kalip-yok(main-yok)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'menu-kimlik-tek-'));
  try {
    await fs.outputFile(path.join(tmp, `${H('d')}.main.js`), mainJs());
    await fs.writeFile(path.join(tmp, 'index.html'),
      `<script src="${H('d')}.main.js?v=2"></script>`);
    const r = await M.paketeUygula(tmp);
    assert.equal(r.durum, 'yamandi');
    assert.deepEqual(r.kitaplar.map((k) => k.dizin), ['.']);
    const bos = await fs.mkdtemp(path.join(os.tmpdir(), 'menu-kimlik-bos-'));
    try {
      const b = await M.paketeUygula(bos, { paketJsonYaz: false });
      assert.equal(b.durum, 'kalip-yok');
      assert.equal(b.kitaplar[0].sebep, 'main-yok');
      assert.equal(await fs.pathExists(path.join(bos, 'paket.json')), false);
    } finally { await fs.remove(bos); }
  } finally { await fs.remove(tmp); }
});

test('KODLAMA: utf8 gidiş-dönüşü tutmayan main.js yazılmaz → kalip-yok(kodlama)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'menu-kimlik-kod-'));
  try {
    const yol = path.join(tmp, `${H('d')}.main.js`);
    // geçerli h + latin1 'ç' baytı (0xE7, tek başına geçersiz utf8)
    const ham = Buffer.concat([Buffer.from(mainJs(), 'utf8'), Buffer.from([0x2f, 0x2a, 0xe7,
      0x2a, 0x2f])]);
    await fs.writeFile(yol, ham);
    await fs.writeFile(path.join(tmp, 'index.html'), `<script src="${H('d')}.main.js"></script>`);
    await fs.writeFile(path.join(tmp, 'paket.json'), '{"setId":"S1"}');
    const r = await M.paketeUygula(tmp);
    assert.equal(r.durum, 'kalip-yok');
    assert.equal(r.kitaplar[0].sebep, 'kodlama');
    assert.ok((await fs.readFile(yol)).equals(ham), 'dosya bayt bayt aynı');
    const pj = JSON.parse(await fs.readFile(path.join(tmp, 'paket.json'), 'utf8'));
    assert.deepEqual(pj, { setId: 'S1', menuKimlikEsle: 'kalip-yok' });
  } finally { await fs.remove(tmp); }
});

test('paketJsonaYaz: paket.json yoksa YARATMAZ, varsa alanları koruyarak günceller', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'menu-kimlik-pj-'));
  try {
    const pjYol = path.join(tmp, 'paket.json');
    await M.paketJsonaYaz(tmp, 'yamandi');
    assert.equal(await fs.pathExists(pjYol), false);
    // akış yolu da (paketeUygula varsayılanı + kabukSonrasiAdim) yaratmaz
    await fs.outputFile(path.join(tmp, `${H('d')}.main.js`), mainJs());
    await fs.writeFile(path.join(tmp, 'index.html'), `<script src="${H('d')}.main.js"></script>`);
    const s = await M.kabukSonrasiAdim(tmp, { log: () => {}, uyar: () => {} });
    assert.equal(s.durum, 'yamandi');
    assert.equal(await fs.pathExists(pjYol), false);
    await fs.writeFile(pjYol, '{"setId":"S1","kabukSurumu":{"durum":"guncel"}}');
    await M.paketJsonaYaz(tmp, 'zaten');
    assert.deepEqual(JSON.parse(await fs.readFile(pjYol, 'utf8')),
      { setId: 'S1', kabukSurumu: { durum: 'guncel' }, menuKimlikEsle: 'zaten' });
  } finally { await fs.remove(tmp); }
});

test('SENTINEL: packagingService adımı kabuktan SONRA, motordan ÖNCE çağırır', () => {
  const svc = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.match(svc, /require\('\.\/menu-kimlik-esle'\)/);
  const kabuk = svc.indexOf('okuyucuKabugu.okuyucuKabuguDegistir(workingPath');
  const sart = svc.indexOf("kanonikSart.sartiUygula('kabuk'");
  const adim = svc.indexOf('menuKimlikEsle.kabukSonrasiAdim(workingPath');
  const motor = svc.indexOf('motorSurumu.motorDegistir(workingPath');
  const manifest = svc.indexOf('paketManifesti.paketeUygula(workingPath');
  const geriYaz = svc.indexOf('menuKimlikEsle.paketJsonaYaz(workingPath, menuKimlikSonucu.durum)');
  assert.ok(kabuk > 0 && adim > kabuk && adim > sart && adim < motor, 'sıra: kabuk → yama → motor');
  assert.ok(geriYaz > manifest, 'manifest paket.json\'u ezdikten sonra kayıt geri yazılır');
});
