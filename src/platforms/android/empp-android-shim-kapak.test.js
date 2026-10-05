'use strict';
/**
 * A1 kapak süzme — Android shim (2026-10-05). (1) EŞLİK: masaüstü fs-shim.js ile aynı vektörler,
 * aynı sonuç (kod kopyadır; ayrışırsa bu test düşer). (2) Uçtan uca: sahte localStorage + yerel
 * asset XHR'ı ile `kapak/index.html?kapak=<ID>` sayfası — okuma süzülür, yazma birleşir, dar yazma
 * atlanır, boş anahtar dolu anahtarı ezmez, anahtar ikinci kapakta okunur. Anahtar değerleri SAHTE.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../common/fs-shim');

function sahteDepo() {
  const m = new Map();
  return {
    m,
    get length() { return m.size; },
    key: (i) => [...m.keys()][i],
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (m.kota) { const e = new Error('dolu'); e.name = 'QuotaExceededError'; throw e; } m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
  };
}
function sahteXhr(dosyalar) {
  return class {
    open(_m, u) { this.u = String(u).replace(/^\.\//, ''); }
    overrideMimeType() {}
    send() {
      if (dosyalar.has(this.u)) { this.status = 200; this.responseText = dosyalar.get(this.u); } else { this.status = 404; }
    }
  };
}
function yukle({ search, depo, dosyalar, fetch }) {
  const win = {
    document: {}, localStorage: depo, location: { origin: 'https://localhost', pathname: '/kapak/index.html', search },
    XMLHttpRequest: sahteXhr(dosyalar), Response, ...(fetch ? { fetch } : {}),
  };
  const src = fs.readFileSync(path.join(__dirname, 'empp-android-shim.js'), 'utf8');
  const m = { exports: {} };
  new Function('module', 'window', 'btoa', 'atob', 'TextDecoder', src)(
    m, win, (s) => Buffer.from(s, 'binary').toString('base64'), (s) => Buffer.from(s, 'base64').toString('binary'), TextDecoder);
  return { mod: m.exports, win };
}

const kapak = (id) => `<cover guId="" ID="${id}" etkID="${id}" actName="K${id}" version="1" `
  + `xmlSource="assets/${id}/data/BookContent.xml"></cover>`;
const MENU = '<?xml version="1.0"?><main activation="true" key="" label="Set" ID="9">'
  + `<Group ID="1" label="G1"><Tab ID="1" label="T1">${kapak(11)}${kapak(12)}</Tab>`
  + `<Tab ID="2" label="T2">${kapak(13)}</Tab></Group>`
  + `<Group ID="2" label="G2"><Tab ID="3" label="T3">${kapak(21)}</Tab></Group></main>`;
const DUP = '<?xml version="1.0"?><main activation="true" key="" ID="9">'
  + `<Group ID="1"><Tab ID="0">${kapak(11)}${kapak(12)}</Tab><Tab ID="1">${kapak(11)}</Tab></Group>`
  + `<Group ID="2"><Tab ID="2">${kapak(11)}${kapak(13)}</Tab></Group><Tab ID="9">${kapak(11)}</Tab>${kapak(11)}</main>`;
const coz = (t) => M.imwinCoz(String(t)).xml;
const motorYazar = (xml) => M.imwinYaz(xml, 27, 5);
const VFS = 'empp_vfs:/kapak/classlibraries/ImWin32.dll';

test('EŞLİK: menuSuz / menuBirlestir / yazmaKarari / kapakOku masaüstüyle birebir aynı', () => {
  const { mod } = yukle({ search: '', depo: sahteDepo(), dosyalar: new Map() });
  const A = mod._internals;
  for (const [x, id] of [[MENU, '12'], [MENU, '21'], [MENU, '99'], [DUP, '11'], [DUP, '13'],
    [`<main><Group><Tab>${kapak(12)}</Tab></Group><Tab>${kapak(11)}</Tab></main>`, '11']]) {
    assert.equal(A.menuSuz(x, id), M.menuSuz(x, id), `menuSuz ${id}`);
  }
  const asil = M.imwinYaz(MENU, 127, 17);
  const vektorler = [
    motorYazar(M.menuSuz(MENU, '12').replace('key=""', 'key="S"')), motorYazar(M.menuSuz(MENU, '11')),
    motorYazar('<main key=""></main>'), motorYazar(MENU), 'düz', new Uint8Array(Buffer.from(motorYazar(M.menuSuz(MENU, '12')))),
  ];
  for (const v of vektorler) {
    const a = A.yazmaKarari(asil, v, '12'); const d = M.yazmaKarari(asil, v, '12');
    assert.equal(a.tur, d.tur);
    assert.equal(a.neden, d.neden);
    if (a.tur === 'birlesik') assert.equal(coz(a.metin), coz(d.metin));
  }
  assert.equal(A.yazmaKarari(null, vektorler[0], '12').neden, M.yazmaKarari(null, vektorler[0], '12').neden);
  const y = M.menuSuz(DUP, '11').replace('version="1"', 'version="8"');
  assert.equal(A.menuBirlestir(DUP, y, '11'), M.menuBirlestir(DUP, y, '11'));
  for (const s of ['?kapak=0012', '?kapak=0', '?kapak=12abc', '?kapak=1234567890123', '?a=1&kapak=7']) {
    assert.equal(A.kapakOku(s), M.kapakOku(s), s);
  }
});

function ortam(search, { depo = sahteDepo(), fetch } = {}) {
  const dosyalar = new Map([['classlibraries/ImWin32.dll', M.imwinYaz(MENU, 127, 17)]]);
  return { ...yukle({ search, depo, dosyalar, fetch }), depo, dosyalar };
}

test('Android ?kapak: okuma tek kapak, yazma asıl menüye birleşir, anahtar ikinci kapakta okunur', () => {
  const a = ortam('?kapak=11&defaultPageNo=3');
  assert.equal(a.mod._internals.KAPAK, '11');
  const suz = coz(a.mod.fsMod.readFileSync('/classlibraries/ImWin32.dll', 'utf8'));
  assert.deepEqual(M.kapakIdleri(suz), ['11']);
  a.mod.fsMod.writeFileSync('/classlibraries/ImWin32.dll', motorYazar(suz.replace('key=""', 'key="SAHTE-ISARET"')));
  const vfs = coz(a.depo.getItem(VFS));
  assert.deepEqual(M.kapakIdleri(vfs), ['11', '12', '13', '21']);
  assert.ok(vfs.includes('key="SAHTE-ISARET"'));
  const b = ortam('?kapak=21', { depo: a.depo });
  const okunan = coz(b.mod.fsMod.readFileSync('classlibraries/ImWin32.dll', 'utf8'));
  assert.deepEqual(M.kapakIdleri(okunan), ['21']);
  assert.ok(okunan.includes('key="SAHTE-ISARET"'), 'set başına tek anahtar');
});

test('Android: dar yazma (başka tek kapak / 0 kapak) ATLANIR, uyarı içerik basmaz', () => {
  const a = ortam('?kapak=12');
  const eski = console.warn; const l = [];
  console.warn = (...x) => l.push(x.map(String).join(' '));
  try {
    a.mod.fsMod.writeFileSync('/classlibraries/ImWin32.dll', motorYazar(M.menuSuz(MENU, '11').replace('key=""', 'key="GIZLI"')));
    a.mod.fsMod.writeFileSync('/classlibraries/ImWin32.dll', motorYazar('<main key=""></main>'));
  } finally { console.warn = eski; }
  assert.equal(a.depo.getItem(VFS), null, 'dar menü VFS\'e yazılmaz');
  assert.ok(l.some((u) => u.includes('[empp-android] kapak yazma reddedildi')), l.join('\n'));
  assert.ok(!l.some((u) => u.includes('GIZLI') || u.includes('<main')));
});

test('Android: anahtarsız ikinci sayfanın yazması dolu anahtarı silmez; kota hatası asılı korur', () => {
  const a = ortam('?kapak=11');
  const sb = coz(ortam('?kapak=21', { depo: a.depo }).mod.fsMod.readFileSync('classlibraries/ImWin32.dll', 'utf8'));
  const sa = coz(a.mod.fsMod.readFileSync('classlibraries/ImWin32.dll', 'utf8'));
  a.mod.fsMod.writeFileSync('/classlibraries/ImWin32.dll', motorYazar(sa.replace('key=""', 'key="K"')));
  const b = ortam('?kapak=21', { depo: a.depo });
  b.mod.fsMod.writeFileSync('/classlibraries/ImWin32.dll', motorYazar(sb.replace(/(ID="21"[^>]*)version="1"/, '$1version="9"')));
  let vfs = coz(a.depo.getItem(VFS));
  assert.ok(vfs.includes('key="K"') && /ID="21"[^>]*version="9"/.test(vfs));
  const once = a.depo.getItem(VFS);
  a.depo.m.kota = true;
  const eski = console.warn; console.warn = () => {};
  try { a.mod.fsMod.writeFileSync('/classlibraries/ImWin32.dll', motorYazar(sa.replace('key=""', 'key="Z"'))); } finally { console.warn = eski; }
  a.depo.m.kota = false;
  assert.equal(a.depo.getItem(VFS), once, 'kota hatasında asıl aynen');
  vfs = coz(once);
  assert.deepEqual(M.kapakIdleri(vfs), ['11', '12', '13', '21']);
});

test('Android: motor menüyü fetch ile okur → tek kapak (sürüm kaydı olmasa da)', async () => {
  const fetch = async () => new Response(M.imwinYaz(MENU, 127, 17));
  const a = ortam('?kapak=13', { fetch });
  const r = await a.win.fetch('classlibraries/ImWin32.dll');
  assert.equal(r.headers.get('X-EMPP-Source'), 'kapak');
  assert.deepEqual(M.kapakIdleri(coz(await r.text())), ['13']);
});

test('Android ?kapak yoksa davranış eski: okuma süzülmez, yazma aynen', () => {
  const a = ortam('');
  assert.equal(a.mod._internals.KAPAK, null);
  assert.deepEqual(M.kapakIdleri(coz(a.mod.fsMod.readFileSync('classlibraries/ImWin32.dll', 'utf8'))), ['11', '12', '13', '21']);
  const tek = motorYazar(M.menuSuz(MENU, '11'));
  a.mod.fsMod.writeFileSync('/classlibraries/ImWin32.dll', tek);
  assert.equal(a.depo.getItem(VFS), tek);
});
