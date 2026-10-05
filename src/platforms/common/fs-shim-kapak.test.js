'use strict';
/**
 * A1 kapak süzme (2026-10-05): `?kapak=<ID>` kipinde ImWin32.dll menüsü okunurken tek kapağa
 * süzülür, motor geri yazınca asıl menüye birleştirilir. Anahtar değerleri SAHTE işaretçidir.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createShim, installFetch, imwinCoz, imwinYaz, menuSuz, menuBirlestir, kapakOku, kapakIdleri,
} = require('./fs-shim');

const kapak = (id, ek = '') => `<cover guId="" ID="${id}" etkID="${id}" actName="K${id}" version="1" `
  + `xmlSource="assets/${id}/data/BookContent.xml"${ek}></cover>`;
const MENU = '<?xml version="1.0"?><main activation="true" key="" label="Set" ID="9">'
  + `<Group ID="1" label="G1"><Tab ID="1" label="T1">${kapak(11)}${kapak(12)}</Tab>`
  + `<Tab ID="2" label="T2">${kapak(13)}</Tab></Group>`
  + `<Group ID="2" label="G2"><Tab ID="3" label="T3">${kapak(21)}</Tab></Group></main>`;

function fixture(kapakId, bicim = [127, 17]) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-kapak-base-'));
  fs.mkdirSync(path.join(base, 'classlibraries'), { recursive: true });
  fs.writeFileSync(path.join(base, 'classlibraries/ImWin32.dll'), imwinYaz(MENU, bicim[0], bicim[1]));
  const work = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'empp-kapak-work-')), 'work');
  return { base, work, shim: createShim(fs, path, work, base, null, kapakId) };
}
const coz = (metin) => imwinCoz(String(metin)).xml;
const motorYazar = (xml) => imwinYaz(xml, 27, 5); // motorun 6395 `E` yazıcısı biçimi

test('imwinCoz/imwinYaz iki biçimde gidiş-dönüş, Türkçe karakter korunur', () => {
  const x = '<main label="İmpark Eğitim"/>';
  for (const [n, r] of [[127, 17], [27, 5]]) {
    const c = imwinCoz(imwinYaz(x, n, r));
    assert.deepStrictEqual([c.xml, c.n, c.r], [x, n, r]);
  }
  assert.strictEqual(imwinCoz('düz metin'), null);
});

test('kapakOku: yalnız sayısal ?kapak alınır', () => {
  assert.strictEqual(kapakOku('?kapak=25861&defaultPageNo=5'), '25861');
  assert.strictEqual(kapakOku('?defaultPageNo=5&kapak=34336'), '34336');
  assert.strictEqual(kapakOku('?kapak=abc'), null);
  assert.strictEqual(kapakOku(''), null);
});

test('menuSuz: yalnız kapağı taşıyan Group/Tab/cover kalır; kapak yoksa null', () => {
  const s = menuSuz(MENU, '13');
  assert.deepStrictEqual(kapakIdleri(s), ['13']);
  assert.ok(s.includes('<Group ID="1"') && !s.includes('<Group ID="2"'));
  assert.ok(s.includes('<Tab ID="2"') && !s.includes('<Tab ID="1"'));
  assert.ok(s.startsWith('<?xml version="1.0"?><main activation="true" key=""'));
  assert.deepStrictEqual(kapakIdleri(menuSuz(MENU, '21')), ['21']);
  assert.strictEqual(menuSuz(MENU, '99'), null);
});

test('menuBirlestir: main nitelikleri + kapak ögesi yazılandan, diğer kapaklar asıldan', () => {
  const yazilan = menuSuz(MENU, '12')
    .replace('key=""', 'key="SAHTE-ISARET"')
    .replace(kapak(12), kapak(12, ' activation="true" key=""').replace('version="1"', 'version="4"'));
  const b = menuBirlestir(MENU, yazilan, '12');
  assert.deepStrictEqual(kapakIdleri(b), ['11', '12', '13', '21']);
  assert.ok(b.includes('<main activation="true" key="SAHTE-ISARET"'));
  assert.ok(b.includes('ID="12" etkID="12" actName="K12" version="4"'));
  assert.ok(b.includes(kapak(11)) && b.includes(kapak(21)), 'diğer kapaklar aynen');
});

test('menuBirlestir: çok kapaklı ya da başka kapaklı yazma birleştirilmez (null → aynen geçer)', () => {
  assert.strictEqual(menuBirlestir(MENU, MENU, '12'), null);
  assert.strictEqual(menuBirlestir(MENU, menuSuz(MENU, '11'), '12'), null);
});

test('shim ?kapak: readFileSync süzülmüş menü döndürür (utf8 ve Buffer)', () => {
  const { shim } = fixture('11');
  assert.deepStrictEqual(kapakIdleri(coz(shim.readFileSync('classlibraries/ImWin32.dll', 'utf8'))), ['11']);
  const buf = shim.readFileSync('/classlibraries/ImWin32.dll');
  assert.ok(Buffer.isBuffer(buf));
  assert.deepStrictEqual(kapakIdleri(coz(buf.toString('utf8'))), ['11']);
});

test('shim ?kapak: motorun tek kapaklı yazması asıl menüye birleşir, paket değişmez', () => {
  const { base, work, shim } = fixture('12');
  const paketOnce = fs.readFileSync(path.join(base, 'classlibraries/ImWin32.dll'), 'utf8');
  const suz = coz(shim.readFileSync('classlibraries/ImWin32.dll', 'utf8'));
  shim.writeFileSync('/classlibraries/ImWin32.dll', motorYazar(suz.replace('key=""', 'key="SAHTE-ISARET"')));
  const workMenu = coz(fs.readFileSync(path.join(work, 'classlibraries/ImWin32.dll'), 'utf8'));
  assert.deepStrictEqual(kapakIdleri(workMenu), ['11', '12', '13', '21']);
  assert.ok(workMenu.includes('key="SAHTE-ISARET"'));
  assert.strictEqual(fs.readFileSync(path.join(base, 'classlibraries/ImWin32.dll'), 'utf8'), paketOnce);
  assert.deepStrictEqual(fs.readdirSync(path.join(work, 'classlibraries')), ['ImWin32.dll'], 'geçici dosya kalmaz');
});

test('set başına tek anahtar: kapak 11\'de yazılan main.key kapak 21 açılışında okunur', () => {
  const { base, work, shim } = fixture('11');
  const suz = coz(shim.readFileSync('classlibraries/ImWin32.dll', 'utf8'));
  shim.writeFileSync('classlibraries/ImWin32.dll', motorYazar(suz.replace('key=""', 'key="SAHTE-ISARET"')));
  const ikinci = createShim(fs, path, work, base, null, '21');
  const okunan = coz(ikinci.readFileSync('classlibraries/ImWin32.dll', 'utf8'));
  assert.deepStrictEqual(kapakIdleri(okunan), ['21']);
  assert.ok(okunan.includes('<main activation="true" key="SAHTE-ISARET"'));
});

test('writeFile (callback) ve promises.writeFile/readFile da birleştirir/süzer', async () => {
  const { work, shim } = fixture('13', [27, 5]);
  const suz = coz(await shim.promises.readFile('classlibraries/ImWin32.dll', 'utf8'));
  assert.deepStrictEqual(kapakIdleri(suz), ['13']);
  await new Promise((coz2, red) => shim.writeFile('classlibraries/ImWin32.dll',
    motorYazar(suz.replace('version="1"', 'version="7"')), {}, (e) => (e ? red(e) : coz2())));
  let m = coz(fs.readFileSync(path.join(work, 'classlibraries/ImWin32.dll'), 'utf8'));
  assert.deepStrictEqual(kapakIdleri(m), ['11', '12', '13', '21']);
  assert.ok(/ID="13"[^>]*version="7"/.test(m));
  await shim.promises.writeFile('classlibraries/ImWin32.dll', motorYazar(suz.replace('version="1"', 'version="7"').replace('key=""', 'key="P"')));
  m = coz(fs.readFileSync(path.join(work, 'classlibraries/ImWin32.dll'), 'utf8'));
  assert.ok(m.includes('key="P"') && /ID="13"[^>]*version="7"/.test(m), 'main + kapak birlikte birleşir');
  const geri = await new Promise((c2) => shim.readFile('classlibraries/ImWin32.dll', 'utf8', (e, v) => c2(v)));
  assert.deepStrictEqual(kapakIdleri(coz(geri)), ['13']);
});

test('iki kapak sırayla yazar: iki kapağın değişikliği de korunur, main son yazanın', () => {
  const { base, work, shim } = fixture('11');
  const b = createShim(fs, path, work, base, null, '21');
  const sa = coz(shim.readFileSync('classlibraries/ImWin32.dll', 'utf8'));
  const sb = coz(b.readFileSync('classlibraries/ImWin32.dll', 'utf8'));
  shim.writeFileSync('classlibraries/ImWin32.dll', motorYazar(sa.replace(/(ID="11"[^>]*)version="1"/, '$1version="5"')));
  b.writeFileSync('classlibraries/ImWin32.dll', motorYazar(sb.replace(/(ID="21"[^>]*)version="1"/, '$1version="6"')
    .replace('key=""', 'key="B"')));
  const m = coz(fs.readFileSync(path.join(work, 'classlibraries/ImWin32.dll'), 'utf8'));
  assert.ok(/ID="11"[^>]*version="5"/.test(m) && /ID="21"[^>]*version="6"/.test(m));
  assert.ok(m.includes('key="B"'));
});

test('anahtarsız açılmış ikinci pencerenin yazması dolu main.key\'i silmez', () => {
  const { base, work, shim } = fixture('11');
  const b = createShim(fs, path, work, base, null, '21');
  const sb = coz(b.readFileSync('classlibraries/ImWin32.dll', 'utf8')); // B anahtar girilmeden açıldı
  const sa = coz(shim.readFileSync('classlibraries/ImWin32.dll', 'utf8'));
  shim.writeFileSync('classlibraries/ImWin32.dll', motorYazar(sa.replace('key=""', 'key="SAHTE-ISARET"')));
  b.writeFileSync('classlibraries/ImWin32.dll', motorYazar(sb.replace(/(ID="21"[^>]*)version="1"/, '$1version="9"')));
  const m = coz(fs.readFileSync(path.join(work, 'classlibraries/ImWin32.dll'), 'utf8'));
  assert.ok(m.includes('<main activation="true" key="SAHTE-ISARET"'), 'anahtar korunur');
  assert.ok(/ID="21"[^>]*version="9"/.test(m), 'B\'nin kapak değişikliği yine birleşir');
});

test('?kapak yoksa ImWin32 okuma/yazma BİREBİR eski (süzme yok, birleştirme yok)', () => {
  const { base, work, shim } = fixture(null);
  const ham = fs.readFileSync(path.join(base, 'classlibraries/ImWin32.dll'), 'utf8');
  assert.strictEqual(shim.readFileSync('classlibraries/ImWin32.dll', 'utf8'), ham);
  const tek = motorYazar(menuSuz(MENU, '11'));
  shim.writeFileSync('classlibraries/ImWin32.dll', tek);
  assert.strictEqual(fs.readFileSync(path.join(work, 'classlibraries/ImWin32.dll'), 'utf8'), tek);
});

test('?kapak menüde yoksa okuma süzülmez (menü aynen)', () => {
  const { base, shim } = fixture('99');
  const ham = fs.readFileSync(path.join(base, 'classlibraries/ImWin32.dll'), 'utf8');
  assert.strictEqual(shim.readFileSync('classlibraries/ImWin32.dll', 'utf8'), ham);
});

test('installFetch ?kapak: ImWin32 fetch süzülmüş menüyle cevaplanır, diğer URL gerçek fetch', async () => {
  const { base, work } = fixture('12');
  const gercek = [];
  const win = { Response, fetch: (u) => { gercek.push(u); return Promise.resolve(new Response('x')); } };
  installFetch(win, fs, path, work, base, '12');
  const r = await win.fetch('classlibraries/ImWin32.dll');
  assert.strictEqual(r.headers.get('X-EMPP-Source'), 'kapak');
  assert.deepStrictEqual(kapakIdleri(coz(await r.text())), ['12']);
  const r2 = await win.fetch('file://' + path.join(base, 'classlibraries/ImWin32.dll'));
  assert.deepStrictEqual(kapakIdleri(coz(await r2.text())), ['12']);
  await win.fetch('assets/x.png');
  assert.deepStrictEqual(gercek, ['assets/x.png']);
});
