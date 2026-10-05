'use strict';
// Kabuk değişimi ↔ main.js yamaları sırası. Kabuk 'eski' kararında kanonik dosyalar HAM
// kopyalanır; kabuk dosyalarına dokunan yamalar (K20, ilk sayfa, gösterge) kabuktan ÖNCE
// koşarsa kaybolur. Bu dosya hem davranışı (kayıp gösterimi) hem servis çağrı sırasını kilitler.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs-extra');
const K = require('./okuyucu-kabugu');
const ILK = require('./acilis-ilk-sayfa');
const GOS = require('./acilis-gostergesi');
const K20 = require('./ana-ekran-yolu-yamasi');

const sha12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
const H = (c) => c.repeat(20);

// Yamaların çapalarını taşıyan sahte kabuk main.js'i (gerçek kanonik kalıpların kısaltması).
function mainIcerik(surum) {
  return `x={923:"${H('b')}"};/*${surum}*/`
    + 'o.module.checkUpdates[e.id]||wn(e).then((function(t){'
    + 's(l.module.SET_CHECK_UPDATE,{id:e.id,update:Boolean(t.Data)})}));'
    + 'window.t1=setTimeout((function(){Ao(r.module.covers[0])}),5e3);'
    + 'var u=s.join(s.dirname(window.location.href),"../");';
}

async function alanKur() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kabuk-sira-'));
  const kok = path.join(tmp, 'paket');
  const b = path.join(kok, 'book1');
  await fs.ensureDir(b);
  await fs.writeFile(path.join(b, `${H('a')}.main.js`), mainIcerik('ESKI'));
  await fs.writeFile(path.join(b, `${H('b')}.923.js`), '4147:function(e){e.exports={i8:"1.11.5"}}');
  await fs.writeFile(path.join(b, 'index.html'),
    `<head><script defer="defer" src="./${H('a')}.main.js"></script></head>`);
  await fs.writeFile(path.join(b, 'version.txt'), '1.11.5');
  await fs.writeFile(path.join(kok, 'paket.json'), JSON.stringify({ setId: 'S1' }));
  const kd = path.join(tmp, 'kabuk', '1.13.14');
  const main = `${H('d')}.main.js`;
  await fs.ensureDir(kd);
  await fs.writeFile(path.join(kd, main), mainIcerik('KANONIK'));
  await fs.writeFile(path.join(kd, `${H('b')}.923.js`), '4147:function(e){e.exports={i8:"1.13.14"}}');
  const dosyalar = [];
  for (const ad of [main, `${H('b')}.923.js`]) {
    dosyalar.push({ ad, sha12: sha12(await fs.readFile(path.join(kd, ad))) });
  }
  await fs.writeFile(path.join(kd, 'manifest.json'),
    JSON.stringify({ surum: '1.13.14', main, mainCss: null, dosyalar }));
  const kYol = path.join(tmp, 'kabuk', 'kanonik.json');
  await fs.writeFile(kYol, JSON.stringify({ surum: '1.13.14', dizin: kd }));
  return { tmp, kok, kYol, main, b };
}

async function yamalar(kok) {
  await K20.paketiDuzelt(kok);
  await ILK.paketeUygula(kok);
  await GOS.paketeUygula(kok, { gecikmeMs: 0 });
}

const durum = async (b, main) => {
  const m = await fs.readFile(path.join(b, main), 'utf8');
  return {
    ilk: m.includes(ILK.ISARET), gos: m.includes(GOS.ISARET), k20: m.includes(K20.ISARET),
    kanonik: m.includes('KANONIK'),
  };
};

test('AKIŞ (düzeltilmiş sıra): kabuk → yamalar; yeni main.js\'te ilk sayfa + gösterge + K20 VAR', async () => {
  const { tmp, kok, kYol, main, b } = await alanKur();
  try {
    const d = await K.okuyucuKabuguDegistir(kok, kYol);
    assert.equal(d.degisen, 1);
    await yamalar(kok);
    assert.deepEqual(await durum(b, main), { ilk: true, gos: true, k20: true, kanonik: true });
    // İkinci geçiş (idempotentlik): dosya değişmez, hata yok.
    const once = await fs.readFile(path.join(b, main), 'utf8');
    await yamalar(kok);
    assert.equal(await fs.readFile(path.join(b, main), 'utf8'), once);
  } finally { await fs.remove(tmp); }
});

test('KAYIP KANITI (eski sıra): yamalar kabuktan ÖNCE koşarsa yeni main.js yamasız', async () => {
  const { tmp, kok, kYol, main, b } = await alanKur();
  try {
    await yamalar(kok);
    await K.okuyucuKabuguDegistir(kok, kYol);
    assert.deepEqual(await durum(b, main), { ilk: false, gos: false, k20: false, kanonik: true });
  } finally { await fs.remove(tmp); }
});

test('kabuk değişmezse (kanonik yok) yamalar yerinde kalır, ikinci geçiş no-op', async () => {
  const { tmp, kok, main, b } = await alanKur();
  try {
    const eskiMain = `${H('a')}.main.js`;
    await yamalar(kok);
    await K.okuyucuKabuguDegistir(kok, path.join(tmp, 'yok', 'kanonik.json'));
    const m = await fs.readFile(path.join(b, eskiMain), 'utf8');
    assert.ok(m.includes(ILK.ISARET) && m.includes(GOS.ISARET) && m.includes(K20.ISARET));
    assert.ok(main);
  } finally { await fs.remove(tmp); }
});

test('SENTINEL: K20 + ilk sayfa + gösterge çağrıları kabuktan sonra, menü-kimlik/motordan önce', () => {
  const svc = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const at = (s) => { const i = svc.indexOf(s); assert.ok(i > 0, `yok: ${s}`); return i; };
  const kabuk = at('okuyucuKabugu.okuyucuKabuguDegistir(workingPath');
  const sart = at("kanonikSart.sartiUygula('kabuk'");
  const k20 = at('anaEkranYolu.paketiDuzelt(workingPath');
  const ilk = at('ilkSayfa.paketeUygula(workingPath');
  const gos = at('acilisGostergesi.paketeUygula(workingPath');
  const menu = at('menuKimlikEsle.kabukSonrasiAdim(workingPath');
  const motor = at('motorSurumu.motorDegistir(workingPath');
  for (const [ad, i] of [['K20', k20], ['ilk sayfa', ilk], ['gösterge', gos]]) {
    assert.ok(i > kabuk && i > sart, `${ad} kabuktan SONRA olmalı`);
    assert.ok(i < menu && i < motor, `${ad} menü-kimlik/motordan ÖNCE olmalı`);
  }
});
