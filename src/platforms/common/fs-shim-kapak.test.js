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

// ─── 13b5bfd incelemesi düzeltmeleri (K1/K2/Ö1-Ö4, k1/k3) ─────────────────────────────────

const { yazmaKarari, kapakFetchYolu, install } = require('./fs-shim');
const workMenuYolu = (work) => path.join(work, 'classlibraries/ImWin32.dll');
const geciciler = (work) => {
  try { return fs.readdirSync(path.join(work, 'classlibraries')).filter((a) => a !== 'ImWin32.dll'); } catch (e) { return []; }
};
function uyarilariTopla(fn) {
  const eski = console.warn; const l = [];
  console.warn = (...a) => l.push(a.map(String).join(' '));
  try { return { sonuc: fn(), uyarilar: l }; } finally { console.warn = eski; }
}

for (const [ad, bozuk] of [['renameSync EPERM', 'renameSync'], ['writeFileSync ENOSPC', 'writeFileSync']]) {
  test(`K1: ${ad} → yazma ATLANIR, aynen yazmaya DÜŞÜLMEZ, geçici dosya silinir, asıl yerinde`, () => {
    const { base, work } = fixture('12');
    // Önce sağlam bir birleşik menü WORK'e yazılsın (asıl = WORK kopyası).
    const saglam = createShim(fs, path, work, base, null, '12');
    const suz = coz(saglam.readFileSync('classlibraries/ImWin32.dll', 'utf8'));
    saglam.writeFileSync('classlibraries/ImWin32.dll', motorYazar(suz));
    const once = fs.readFileSync(workMenuYolu(work), 'utf8');
    const kod = bozuk === 'renameSync' ? 'EPERM' : 'ENOSPC';
    const sahteFs = { ...fs, [bozuk]: (...a) => {
      if (String(a[0]).includes('.empp-') || bozuk === 'renameSync') { const e = new Error('x'); e.code = kod; throw e; }
      return fs[bozuk](...a);
    } };
    const shim = createShim(sahteFs, path, work, base, null, '12');
    const { uyarilar } = uyarilariTopla(() => shim.writeFileSync('classlibraries/ImWin32.dll',
      motorYazar(suz.replace('key=""', 'key="SAHTE-ISARET"'))));
    assert.strictEqual(fs.readFileSync(workMenuYolu(work), 'utf8'), once, 'asıl menü değişmemeli');
    assert.deepStrictEqual(kapakIdleri(coz(fs.readFileSync(workMenuYolu(work), 'utf8'))), ['11', '12', '13', '21']);
    assert.deepStrictEqual(geciciler(work), [], 'geçici/kilit dosyası kalmamalı');
    assert.ok(uyarilar.some((u) => u.includes('[empp-fs-shim] kapak yazılamadı') && u.includes(kod)), uyarilar.join('\n'));
    assert.ok(!uyarilar.some((u) => u.includes('SAHTE-ISARET') || u.includes('<main')), 'içerik/anahtar basılmaz');
  });
}

test('k2: rename EBUSY/EPERM geçiciyse yeniden denenir → yazıldı; kalıcı EPERM 5 denemede biter', () => {
  const { base, work } = fixture('12');
  const saglam = createShim(fs, path, work, base, null, '12');
  const suz = coz(saglam.readFileSync('classlibraries/ImWin32.dll', 'utf8'));
  let sayac = 0;
  const gecici = { ...fs, renameSync: (...a) => {
    sayac += 1;
    if (sayac <= 2) { const e = new Error('x'); e.code = sayac === 1 ? 'EBUSY' : 'EPERM'; throw e; }
    return fs.renameSync(...a);
  } };
  createShim(gecici, path, work, base, null, '12').writeFileSync('classlibraries/ImWin32.dll',
    motorYazar(suz.replace('key=""', 'key="SAHTE-ISARET"')));
  assert.strictEqual(sayac, 3);
  assert.ok(coz(fs.readFileSync(workMenuYolu(work), 'utf8')).includes('key="SAHTE-ISARET"'));
  assert.deepStrictEqual(geciciler(work), []);
  let kalici = 0;
  const kaliciFs = { ...fs, renameSync: () => { kalici += 1; const e = new Error('x'); e.code = 'EPERM'; throw e; } };
  uyarilariTopla(() => createShim(kaliciFs, path, work, base, null, '12').writeFileSync('classlibraries/ImWin32.dll',
    motorYazar(suz.replace('key=""', 'key="IKINCI"'))));
  assert.strictEqual(kalici, 5);
  assert.deepStrictEqual(geciciler(work), []);
});

const DUP = '<?xml version="1.0"?><main activation="true" key="" ID="9">'
  + `<Group ID="1"><Tab ID="0" label="Tümü">${kapak(11)}${kapak(12)}</Tab><Tab ID="1">${kapak(11)}</Tab></Group>`
  + `<Group ID="2"><Tab ID="2">${kapak(11)}${kapak(13)}</Tab></Group><Tab ID="9">${kapak(11)}</Tab>${kapak(11)}</main>`;

test('K2: yinelenen kapak (iki Tab, iki Group, Group dışı) → süzme TEK kapak, ilk Group/Tab', () => {
  const s = menuSuz(DUP, '11');
  assert.deepStrictEqual(kapakIdleri(s), ['11']);
  assert.ok(s.includes('<Group ID="1"><Tab ID="0" label="Tümü">') && !s.includes('<Group ID="2"') && !s.includes('<Tab ID="9"'));
  assert.ok(!s.includes('\u0001'), 'geçici işaret kalmaz');
  assert.deepStrictEqual(kapakIdleri(menuSuz(DUP, '13')), ['13']);
});

test('K2: kapak yalnız Group dışında → süzme yok (motor main.Group dışını okumaz)', () => {
  const x = `<main key=""><Group ID="1"><Tab ID="1">${kapak(12)}</Tab></Group><Tab ID="2">${kapak(11)}</Tab></main>`;
  assert.strictEqual(menuSuz(x, '11'), null);
});

test('K2: yinelenen asılda birleşim bütün kopyaları günceller, kapak kümesi korunur', () => {
  const yazilan = menuSuz(DUP, '11').replace('version="1"', 'version="8"');
  const b = menuBirlestir(DUP, yazilan, '11');
  assert.strictEqual((b.match(/ID="11" etkID="11" actName="K11" version="8"/g) || []).length, 5);
  assert.deepStrictEqual(kapakIdleri(b), kapakIdleri(DUP));
  // Eski hatalı süzmenin (['11','11']) yazması da tekil sayılır ve birleşir.
  const ikili = `<main key=""><Group ID="1"><Tab ID="0">${kapak(11)}</Tab><Tab ID="1">${kapak(11)}</Tab></Group></main>`;
  assert.ok(menuBirlestir(DUP, ikili, '11'));
});

test('Ö1: yazmaKarari — dar / başka kimlik / 0 kapak / çözülemez / asıl yok → reddet; tam menü → aynen', () => {
  const asil = imwinYaz(MENU, 127, 17);
  const tek = (id) => motorYazar(menuSuz(MENU, id));
  assert.strictEqual(yazmaKarari(asil, tek('12'), '12').tur, 'birlesik');
  assert.match(yazmaKarari(asil, tek('11'), '12').neden, /dar/);
  assert.match(yazmaKarari(asil, motorYazar('<main key=""></main>'), '12').neden, /dar/);
  assert.match(yazmaKarari(asil, motorYazar(MENU.replace(kapak(21), '')), '12').neden, /dar/);
  assert.match(yazmaKarari(asil, 'düz metin', '12').neden, /çözülemedi/);
  assert.match(yazmaKarari(null, tek('12'), '12').neden, /asıl menü okunamadı/);
  assert.match(yazmaKarari('bozuk', tek('12'), '12').neden, /asıl menü okunamadı/);
  assert.strictEqual(yazmaKarari(asil, motorYazar(MENU), '12').tur, 'aynen');
  assert.strictEqual(yazmaKarari(asil, motorYazar(MENU.replace('</main>', `<Group ID="3"><Tab ID="4">${kapak(31)}</Tab></Group></main>`)), '12').tur, 'aynen');
});

test('Ö1: Uint8Array/Buffer veri doğru çözülür (String() "1,2,3" değil)', () => {
  const asil = imwinYaz(MENU, 127, 17);
  const m = motorYazar(menuSuz(MENU, '12'));
  const u8 = new Uint8Array(Buffer.from(m, 'utf8'));
  assert.strictEqual(yazmaKarari(asil, u8, '12').tur, 'birlesik');
  assert.strictEqual(yazmaKarari(asil, Buffer.from(m, 'utf8'), '12').tur, 'birlesik');
});

test('Ö1: shim — asıl okunamazsa yazma atlanır (dar menü WORK\'e GİTMEZ)', () => {
  const { base, work, shim } = fixture('12');
  const suz = coz(shim.readFileSync('classlibraries/ImWin32.dll', 'utf8'));
  fs.renameSync(path.join(base, 'classlibraries/ImWin32.dll'), path.join(base, 'classlibraries/yok.dll'));
  uyarilariTopla(() => shim.writeFileSync('classlibraries/ImWin32.dll', motorYazar(suz)));
  assert.ok(!fs.existsSync(workMenuYolu(work)));
  assert.deepStrictEqual(geciciler(work), []);
});

test('Ö1: shim — motor tam menüyü yazarsa (sunucudan kurulan) aynen geçer', () => {
  const { work, shim } = fixture('12');
  const tam = motorYazar(MENU.replace('key=""', 'key="T"'));
  shim.writeFileSync('classlibraries/ImWin32.dll', tam);
  assert.strictEqual(fs.readFileSync(workMenuYolu(work), 'utf8'), tam);
});

test('Ö3: taze kilit tutuluyken yazma atlanır; bayat kilit (>5 sn) kırılır', () => {
  const { work, shim } = fixture('12');
  const suz = coz(shim.readFileSync('classlibraries/ImWin32.dll', 'utf8'));
  fs.mkdirSync(path.join(work, 'classlibraries'), { recursive: true });
  const kilit = workMenuYolu(work) + '.lock';
  fs.writeFileSync(kilit, '');
  const { uyarilar } = uyarilariTopla(() => shim.writeFileSync('classlibraries/ImWin32.dll', motorYazar(suz)));
  assert.ok(!fs.existsSync(workMenuYolu(work)), 'kilit varken yazılmamalı');
  assert.ok(uyarilar.some((u) => u.includes('kilit alınamadı')), uyarilar.join('\n'));
  const eski = new Date(Date.now() - 60000);
  fs.utimesSync(kilit, eski, eski);
  shim.writeFileSync('classlibraries/ImWin32.dll', motorYazar(suz.replace('key=""', 'key="K"')));
  assert.ok(coz(fs.readFileSync(workMenuYolu(work), 'utf8')).includes('key="K"'));
  assert.ok(!fs.existsSync(kilit), 'kilit bırakılır');
});

test('Ö2: bozuk % dizisi fetch\'i çökertmez; Request nesnesi de süzülür', async () => {
  assert.strictEqual(kapakFetchYolu('classlibraries/%E0%A4%A.dll', path, fs, '/w', '/b'), null);
  assert.strictEqual(kapakFetchYolu('%', path, fs, '/w', '/b'), null);
  const { base, work } = fixture('12');
  const gercek = [];
  const win = { Response, fetch: (u) => { gercek.push(u); return Promise.resolve(new Response('x')); } };
  installFetch(win, fs, path, work, base, '12');
  await win.fetch('assets/%E0%A4%A.png');
  assert.deepStrictEqual(gercek, ['assets/%E0%A4%A.png']);
  const r = await win.fetch(new Request('file://' + path.join(base, 'classlibraries/ImWin32.dll')));
  assert.deepStrictEqual(kapakIdleri(coz(await r.text())), ['12']);
});

test('k1: kapakOku uç durumları', () => {
  assert.strictEqual(kapakOku('?kapak=0012'), '12');
  assert.strictEqual(kapakOku('?kapak=0'), null);
  assert.strictEqual(kapakOku('?kapak=12abc'), null);
  assert.strictEqual(kapakOku('?kapak=1234567890123'), null);
  assert.strictEqual(kapakOku('?kapak=25861#x'), '25861');
  assert.strictEqual(kapakOku('?xkapak=1'), null);
  assert.strictEqual(kapakOku('?a=1&kapak=7&b=2'), '7');
});

test('writeFile(p, veri, cb) seçeneksiz + encoding\'siz readFile cb → Buffer', async () => {
  const { work, shim } = fixture('13');
  const v = await new Promise((c2) => shim.readFile('classlibraries/ImWin32.dll', (e, d) => c2(d)));
  assert.ok(Buffer.isBuffer(v));
  const suz = coz(v.toString('utf8'));
  await new Promise((c2) => shim.writeFile('classlibraries/ImWin32.dll', motorYazar(suz.replace('key=""', 'key="C"')), c2));
  assert.ok(coz(fs.readFileSync(workMenuYolu(work), 'utf8')).includes('key="C"'));
});

test('uçtan uca install(): location.search\'ten KAPAK; win32 + A1 (alt kitap yok) → TEK WORK = EMPP_WORK_DIR', () => {
  const { base } = fixture(null);
  const workKok = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-a1-win-'));
  const kaynak = fs.readFileSync(require.resolve('./fs-shim.js'), 'utf8');
  const kur = (search) => {
    const mod = { exports: {} };
    const proc = { platform: 'win32', env: { EMPP_WORK_DIR: workKok }, pid: 1 };
    new Function('module', 'exports', 'require', '__dirname', 'process', kaynak)(mod, mod.exports, require, base, proc);
    const win = { require: (n) => require(n), location: { search } };
    return { shim: mod.exports.install(win), win };
  };
  const a = kur('?kapak=11&defaultPageNo=3');
  const b = kur('?kapak=21');
  assert.strictEqual(a.shim.__empp.KAPAK, '11');
  assert.strictEqual(a.shim.__empp.WORK, workKok, 'A1\'de alt kitap ad alanı yok');
  assert.strictEqual(b.shim.__empp.WORK, workKok, 'iki kapak AYNI WORK');
  const suz = coz(a.win.require('fs').readFileSync('classlibraries/ImWin32.dll', 'utf8'));
  assert.deepStrictEqual(kapakIdleri(suz), ['11']);
  a.win.require('fs').writeFileSync('/classlibraries/ImWin32.dll', motorYazar(suz.replace('key=""', 'key="W"')));
  const okunan = coz(b.win.require('fs').readFileSync('classlibraries/ImWin32.dll', 'utf8'));
  assert.deepStrictEqual(kapakIdleri(okunan), ['21']);
  assert.ok(okunan.includes('key="W"'), 'anahtar diğer kapakta okunur');
  assert.strictEqual(kur('').shim.__empp.KAPAK, null);
});

test('Windows ters bölülü yol (path.win32 + sahte fs): süzme ve birleştirme çalışır', () => {
  const dosyalar = new Map();
  const yok = (p) => { const e = new Error('ENOENT ' + p); e.code = 'ENOENT'; return e; };
  const sahte = {
    existsSync: (p) => dosyalar.has(p),
    readFileSync: (p) => { if (!dosyalar.has(p)) throw yok(p); return dosyalar.get(p); },
    writeFileSync: (p, v) => { dosyalar.set(p, String(v)); },
    renameSync: (a, b) => { dosyalar.set(b, dosyalar.get(a)); dosyalar.delete(a); },
    unlinkSync: (p) => { if (!dosyalar.delete(p)) throw yok(p); },
    openSync: (p, f) => { if (f === 'wx' && dosyalar.has(p)) { const e = new Error('x'); e.code = 'EEXIST'; throw e; } dosyalar.set(p, ''); return 7; },
    closeSync: () => {},
    statSync: () => ({ mtimeMs: Date.now() }),
    mkdirSync: () => {},
  };
  dosyalar.set('C:\\app\\classlibraries\\ImWin32.dll', imwinYaz(MENU, 127, 17));
  const shim = createShim(sahte, path.win32, 'C:\\w', 'C:\\app', null, '12');
  const suz = coz(shim.readFileSync('C:\\app\\classlibraries\\ImWin32.dll', 'utf8'));
  assert.deepStrictEqual(kapakIdleri(suz), ['12']);
  shim.writeFileSync('\\classlibraries\\ImWin32.dll', motorYazar(suz.replace('key=""', 'key="Y"')));
  const w = coz(dosyalar.get('C:\\w\\classlibraries\\ImWin32.dll'));
  assert.deepStrictEqual(kapakIdleri(w), ['11', '12', '13', '21']);
  assert.ok(w.includes('key="Y"'));
  assert.deepStrictEqual([...dosyalar.keys()].filter((k) => k.startsWith('C:\\w')), ['C:\\w\\classlibraries\\ImWin32.dll']);
});

const M = require('./fs-shim');

test('Ö2a/Ö2b: masaüstü yazmaKarari — dar yazmadaki yeni anahtar asıla taşınır; tam menüde boş anahtar dolu anahtarı ezmez', () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'fsk-o2-'));
  const menuYolu = path.join(kok, 'classlibraries', 'ImWin32.dll');
  fs.mkdirSync(path.dirname(menuYolu), { recursive: true });
  const TAM = '<?xml version="1.0"?><main activation="true" key="" ID="9"><Group ID="1"><Tab ID="1">'
    + ['11', '12', '13'].map((id) => `<cover ID="${id}" version="1" xmlSource="assets/${id}/data/BookContent.xml"></cover>`).join('')
    + '</Tab></Group></main>';
  fs.writeFileSync(menuYolu, M.imwinYaz(TAM, 127, 17));
  const k = M.yazmaKarari(fs.readFileSync(menuYolu, 'utf8'), M.imwinYaz(M.menuSuz(TAM, '11').replace('key=""', 'key="YENI"'), 27, 5), '12');
  assert.equal(k.tur, 'birlesik');
  assert.match(k.neden, /yalnız anahtar taşındı/);
  const x = M.imwinCoz(k.metin).xml;
  assert.ok(x.includes('key="YENI"'));
  assert.deepEqual(M.kapakIdleri(x), ['11', '12', '13']);
  assert.equal(x.replace('key="YENI"', 'key=""'), TAM, 'menünün gerisi asıldan bayt-aynı');
  const dolu = M.imwinYaz(TAM.replace('key=""', 'key="DOLU"'), 127, 17);
  const b = M.yazmaKarari(dolu, M.imwinYaz(TAM.replace('version="1"', 'version="5"'), 27, 5), '12');
  assert.equal(b.tur, 'birlesik');
  assert.ok(M.imwinCoz(b.metin).xml.includes('key="DOLU"'));
  assert.ok(M.imwinCoz(b.metin).xml.includes('version="5"'), 'menü yazılandan');
});
