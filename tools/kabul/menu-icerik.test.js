'use strict';
/**
 * MENÜ İÇERİK KAPISI testleri (2026-10-06, 45479 kitap 14835: menüde kart var, BookContent.xml pakette yok).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ig = require('../../src/runtime/icerik-guncelleme');
const K = require('./menu-icerik');

function menu(kapaklar) {
  const cov = kapaklar.map((c) => `<cover ID="${c.id}" actName="${c.ad || c.id}" externalExeUrl="${c.ext || ''}"`
    + `${c.xs === null ? '' : ` xmlSource="${c.xs || `assets/${c.id}/data/BookContent.xml`}"`} version="3" />`).join('');
  return ig.menuKodla(`<?xml version="1.0"?><main><Group ID="1"><Tab ID="1">${cov}</Tab></Group></main>`);
}

/** set: {book1:[kapaklar]...}; icerik: yazılacak id'ler (hepsi kitabın assets'ine). */
function paket({ set = true, kitaplar, icerik = [], bos = [] }) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-icerik-'));
  const yaz = (rel, v) => { fs.mkdirSync(path.dirname(path.join(kok, rel)), { recursive: true }); fs.writeFileSync(path.join(kok, rel), v); };
  for (const [kitap, kapaklar] of Object.entries(kitaplar)) {
    const on = set ? `${kitap}/` : '';
    yaz(`${on}classlibraries/ImWin32.dll`, menu(kapaklar));
    for (const c of kapaklar) {
      if (icerik.includes(c.id)) yaz(`${on}assets/${c.id}/data/BookContent.xml`, bos.includes(c.id) ? '' : '<bc/>');
    }
  }
  return kok;
}

const K1 = [{ id: '33574' }, { id: '14835' }];

test('14835 kalıbı: menüde kart var, BookContent.xml yok → RED, sebep kitabı adıyla söyler', () => {
  const s = K.menuIcerikOlcKok(paket({ kitaplar: { book1: K1 }, icerik: ['33574'] }));
  assert.equal(s.durum, K.DURUM.RED);
  assert.equal(s.kartlar.filter((k) => k.sorun).length, 1);
  assert.match(s.sebepler[0], /book1 14835 .*içerik dosyası pakette yok: book1\/assets\/14835\/data\/BookContent\.xml/);
});

test('tam set → GEÇTİ; tek kitap düzeni (kök menü) de ölçülür', () => {
  assert.equal(K.menuIcerikOlcKok(paket({ kitaplar: { book1: K1 }, icerik: ['33574', '14835'] })).durum, K.DURUM.GECTI);
  assert.equal(K.menuIcerikOlcKok(paket({ set: false, kitaplar: { x: K1 }, icerik: ['33574'] })).durum, K.DURUM.RED);
  assert.equal(K.menuIcerikOlcKok(paket({ set: false, kitaplar: { x: K1 }, icerik: ['33574', '14835'] })).durum, K.DURUM.GECTI);
});

test('boş (0 bayt) içerik dosyası RED', () => {
  const s = K.menuIcerikOlcKok(paket({ kitaplar: { book1: K1 }, icerik: ['33574', '14835'], bos: ['14835'] }));
  assert.equal(s.durum, K.DURUM.RED);
  assert.match(s.sebepler[0], /boş/);
});

test('muaflar: İmpark kitabı olmayan kimlik ve externalExeUrl\'li xmlSource\'suz kapak ölçülmez', () => {
  const s = K.menuIcerikOlcKok(paket({
    kitaplar: { book1: [{ id: '33574' }, { id: '0', xs: null, ad: 'Oyun' }, { id: 'Grade-8-Games', xs: null }, { id: '5555', xs: null, ext: 'https://x.test/o.exe' }] },
    icerik: ['33574'],
  }));
  assert.equal(s.durum, K.DURUM.GECTI, s.sebepler.join(' | '));
  assert.equal(s.kartlar.filter((k) => k.muaf).length, 3);
});

test('İmpark kimlikli kapak xmlSource\'suz ve externalExeUrl\'siz → RED', () => {
  const s = K.menuIcerikOlcKok(paket({ kitaplar: { book1: [{ id: '777', xs: null }] } }));
  assert.equal(s.durum, K.DURUM.RED);
  assert.match(s.sebepler[0], /xmlSource yok/);
});

test('xmlSource paket dışına çıkıyorsa RED', () => {
  const s = K.menuIcerikOlcKok(paket({ kitaplar: { book1: [{ id: '777', xs: '../../etc/x' }] } }));
  assert.equal(s.durum, K.DURUM.RED);
});

test('menü yok → ATLANDI; menü çözülemez → ÖLÇÜLEMEDİ (GEÇTİ\'ye düşmez); menüde kapak yok → ÖLÇÜLEMEDİ', () => {
  assert.equal(K.menuIcerikOlcKok(fs.mkdtempSync(path.join(os.tmpdir(), 'menu-icerik-bos-'))).durum, K.DURUM.ATLANDI);
  const kok = paket({ kitaplar: { book1: K1 }, icerik: ['33574', '14835'] });
  fs.writeFileSync(path.join(kok, 'book1/classlibraries/ImWin32.dll'), 'bozuk-çöp');
  assert.equal(K.menuIcerikOlcKok(kok).durum, K.DURUM.OLCULEMEDI);
  assert.equal(K.menuIcerikOlcKok(paket({ kitaplar: { book1: [] } })).durum, K.DURUM.OLCULEMEDI);
});

test('kip: varsayılan uyar; RED yalnız uyarı olur, reddet katman üretir, kapali hiçbir şey', () => {
  const s = K.menuIcerikOlcKok(paket({ kitaplar: { book1: K1 }, icerik: ['33574'] }));
  assert.equal(K.kip({}), 'uyar');
  assert.equal(K.kip({ KABUL_MENU_ICERIK: 'REDDET' }), 'reddet');
  assert.equal(K.kip({ KABUL_MENU_ICERIK: 'saçma' }), 'uyar');
  const u = K.kipliKarar(s, 'uyar');
  assert.equal(u.katman, null);
  assert.match(u.uyari, /KABUL_MENU_ICERIK=uyar: menü içerik RED/);
  const r = K.kipliKarar(s, 'reddet');
  assert.equal(r.katman.durum, 'RED');
  assert.deepEqual(K.kipliKarar(s, 'kapali'), { katman: null, uyari: null });
  const gecti = K.menuIcerikOlcKok(paket({ kitaplar: { book1: K1 }, icerik: ['33574', '14835'] }));
  assert.equal(K.kipliKarar(gecti, 'uyar').katman.durum, 'GECTI');
});

test('ATLANAN ÜYE (Nadir 06.10): kart menüden çıkarılmış, içerik yok → GEÇTİ; kart menüde kalsaydı RED (kapı kör değil)', () => {
  // üreteç 14835'i atladı: menüde yok, assets/14835 yok
  const atlanmis = K.menuIcerikOlcKok(paket({ kitaplar: { book1: [{ id: '33574' }], book3: [{ id: '40001' }] },
    icerik: ['33574', '40001'] }));
  assert.equal(atlanmis.durum, K.DURUM.GECTI, atlanmis.sebepler.join(' | '));
  assert.ok(!atlanmis.kartlar.some((k) => k.id === '14835'));
  // aynı paket, kart menüde bırakılmış → RED (atlama kartı menüden ÇIKARMAK zorunda)
  const kartli = K.menuIcerikOlcKok(paket({ kitaplar: { book1: [{ id: '33574' }, { id: '14835' }], book3: [{ id: '40001' }] },
    icerik: ['33574', '40001'] }));
  assert.equal(kartli.durum, K.DURUM.RED);
});

test('ATLANAN ÜYE manifesti (empp-uretec.json): sonuç + özet notu; kart menüde kalmışsa RED "ATLANAN ÜYE" etiketli; manifest yoksa alan yok', () => {
  const manifest = JSON.stringify({ kaynak: 'uretec', atlananUyeler: [{ kitapId: '14835', ad: 'Old Man', sebep: "İmpark'ta içerik yok (HTTP 404)" }] });
  const atlanmis = paket({ kitaplar: { book1: [{ id: '33574' }] }, icerik: ['33574'] });
  fs.writeFileSync(path.join(atlanmis, 'empp-uretec.json'), manifest);
  const s = K.menuIcerikOlcKok(atlanmis);
  assert.equal(s.durum, K.DURUM.GECTI);
  assert.deepEqual(s.atlananUyeler.map((a) => a.kitapId), ['14835']);
  assert.match(K.ozetSatiri(s), /NOT: atlanan üye \(manifest, beklenenden düşüldü\): 14835 "Old Man" — İmpark'ta içerik yok \(HTTP 404\)/);
  const kartli = paket({ kitaplar: { book1: K1 }, icerik: ['33574'] });
  fs.writeFileSync(path.join(kartli, 'empp-uretec.json'), manifest);
  const k = K.menuIcerikOlcKok(kartli);
  assert.equal(k.durum, K.DURUM.RED);
  assert.match(k.sebepler[0], /14835 .*ATLANAN ÜYE — kart menüden çıkarılmalıydı/);
  const yok = K.menuIcerikOlcKok(paket({ kitaplar: { book1: [{ id: '33574' }] }, icerik: ['33574'] }));
  assert.equal(yok.atlananUyeler, undefined);
  assert.doesNotMatch(K.ozetSatiri(yok), /NOT:/);
});
