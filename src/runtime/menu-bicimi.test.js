'use strict';

/**
 * Menü (ImWin32.dll) İKİ BİÇİM — gerçek fikstürlerle (2026-09-26).
 *
 * 72378 Lingoland (tek kitap) ve 73581 SW6 Maarif (set, book1) menüleri 127/17 biçiminde:
 * eski `menuCoz` yalnız 27/5 bildiği için ikisi de "çözülemedi" sayılıyordu → çalışma anında K
 * uzlaşması kördü (73581 kuru kabulü: "menü çözülemedi book1..book4"), merdiven S0 ÖLÇÜLEMEDİ.
 * Okuyucunun kendi çözücüsü (`w()`, 72378 `a8f43f74c72b65a3dd05.main.js`) iki biçimi de açıyor.
 * Fikstürler kaynaktan salt okunarak alındı (key="" lisans="" — sır yok):
 *   menu-127-17-72378-tek.dll    ← ~/.empp-agent/cache/72378/Lingoland-Grade-2.exe/build.zip
 *   menu-127-17-73581-book1.dll  ← ~/.empp-agent/kaynak-arsivi/73581/build.zip book1/
 *   menu-27-5-45482-book1.dll    ← ~/.empp-agent/kaynak-arsivi/45482/build.zip book1/ (gerileme)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const m = require('./icerik-guncelleme');

const F = (ad) => fs.readFileSync(path.join(__dirname, 'fikstur', ad));
const YENI = { bas: 127, ara: 16, son: 127 };
const ESKI = { bas: 27, ara: 4, son: 27 };

/** Okuyucunun `w()` fonksiyonunun birebir kopyası (yalnız test kıyası için). */
function motorW(t) {
  let n = 127; let r = 17; let o = '';
  if (t.substr(127, 1) === '<' && t.substr(t.length - 144, 1) === '>') { n = 127; r = 17; }
  else if (t.substr(27, 1) === '<' && t.substr(t.length - 32, 1) === '>') { n = 27; r = 5; }
  t = t.substr(n, t.length - n);
  while (t.length > n) { o += t.substr(0, 1); t = t.substr(r, t.length - r); }
  return o;
}

for (const [ad, bicim, kapak] of [
  ['menu-127-17-72378-tek.dll', YENI, ['72378', 18]],
  ['menu-127-17-73581-book1.dll', YENI, ['73452', 6]],
  ['menu-27-5-45482-book1.dll', ESKI, ['44187', 33]],
]) {
  test(`gerçek menü ${ad}: çözülür, kapak ${kapak.join(' v')}, biçim ${bicim.bas}/${bicim.ara + 1}`, () => {
    const ham = F(ad);
    const xml = m.menuCoz(ham);
    assert.ok(xml, 'çözülmeliydi');
    assert.match(xml, /^<\?xml[^>]*\?>\s*<main\b/);
    assert.match(xml, /<\/main>$/);
    assert.equal(xml, motorW(ham.toString('utf8')), 'okuyucunun kendi çözümüyle birebir');
    const [c] = m.kapaklar(xml);
    assert.deepEqual([c.ID, c.version], kapak);
    assert.deepEqual(m.menuBicimi(ham), bicim);
  });

  test(`gerçek menü ${ad}: biçim korunarak yeniden kodlanır, okuyucu yine açar`, () => {
    const ham = F(ad);
    const xml = m.kapakAyarla(m.menuCoz(ham), kapak[0], { version: kapak[1] + 1 });
    const yeni = m.menuKodla(xml, null, m.menuBicimi(ham));
    assert.deepEqual(m.menuBicimi(yeni), bicim, 'kaynağın biçimi korunmalı');
    assert.equal(m.menuCoz(yeni), xml);
    assert.equal(motorW(yeni), xml, 'okuyucu yeniden yazılanı da çözer');
  });
}

test('menuKodla biçimsiz: motorun kendi yazıcısının biçimi (27/5); YENI verilirse 127/17', () => {
  const xml = '<?xml version="1.0"?><main><Group ID="0"><Tab ID="0"><cover ID="1" version="2"/>'
    + '</Tab></Group></main>';
  const k = m.menuKodla(xml);
  assert.deepEqual(m.menuBicimi(k), ESKI);
  assert.equal(k.length, 27 + xml.length * 5 + 27);
  assert.equal(motorW(k), xml);
  const y = m.menuKodla(xml, null, YENI);
  assert.equal(y.length, 127 + xml.length * 17 + 127);
  assert.equal(motorW(y), xml);
});

test('işaret tutmasa da 127/17 denenir (motorun varsayılanı): XML satır sonuyla biterse', () => {
  const xml = '<?xml version="1.0"?><main><Group ID="0"><Tab ID="0"><cover ID="9" version="3"/>'
    + '</Tab></Group></main>\n';
  const k = m.menuKodla(xml, null, YENI);
  assert.notEqual(k.charAt(k.length - 144), '>', 'son karakter satır sonu → işaret tutmaz');
  assert.equal(motorW(k), xml, 'okuyucu varsayılan 127/17 ile açar');
  assert.equal(m.menuCoz(k), xml);
  assert.deepEqual(m.menuBicimi(k), YENI);
});

test('sahte çözüm yok: çöp, kesik ve açık metin', () => {
  assert.equal(m.menuCoz('çöp'.repeat(400)), null);
  assert.equal(m.menuBicimi('çöp'.repeat(400)), null);
  const ham = F('menu-127-17-72378-tek.dll').toString('utf8');
  assert.equal(m.menuCoz(ham.slice(0, 2000)), null, 'kesik menü <main üretmez');
  const acik = '<?xml version="1.0"?><main></main>';
  assert.equal(m.menuCoz(acik), acik);
  assert.equal(m.menuBicimi(acik), null);
});

test('K uzlaşması: 127/17 paket menüsü artık KÖR DEĞİL (73581 "menü çözülemedi" kapandı)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-base-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-work-'));
  const menuYol = (kok) => path.join(kok, 'book1', 'classlibraries', 'ImWin32.dll');
  fs.mkdirSync(path.dirname(menuYol(base)), { recursive: true });
  fs.mkdirSync(path.dirname(menuYol(work)), { recursive: true });
  const paket = F('menu-127-17-73581-book1.dll');
  fs.writeFileSync(menuYol(base), paket);
  // WORK: motor sürümü 6→7 yazmış (27/5, kendi yazıcısı) ama içerik hiç açılmamış → sahte ilerletme.
  const workXml = m.kapakAyarla(m.menuCoz(paket), '73452', { version: 7 });
  fs.writeFileSync(menuYol(work), m.menuKodla(workXml));
  const loglar = [];
  const rapor = m.uzlastir({ baseKok: base, workKok: work, log: (s) => loglar.push(s) });
  assert.ok(!loglar.some((s) => /menü çözülemedi/.test(s)), loglar.join('\n'));
  const r = rapor.find((x) => x.kitap === 'book1');
  assert.deepEqual(r.kararlar.map((k) => [k.id, k.work, k.paket, k.sonuc, k.taraf]),
    [['73452', 7, 6, 6, 'paket-sahte-ilerletme']]);
  const yazilan = fs.readFileSync(menuYol(work));
  assert.equal(m.kapaklar(m.menuCoz(yazilan))[0].version, 6);
  assert.deepEqual(m.menuBicimi(yazilan), ESKI, 'WORK menüsünün kendi biçimi korunur');
});
