'use strict';
/**
 * SET tüm alt kitaplar güncelliği — sahte SET ağacı (gerçek fs, geçici dizin) + sahte İmpark
 * cevabı (getir enjekte; AĞ YOK). Senaryo SM2 Set DMG'nin birebiri (26.09 ölçüldü): book1 58336 v17
 * güncel, book2 58237 v7 → İmpark v14 (motor bu kitabı hiç sormadı).
 *
 * Mutasyon kanıtı (26.09): (M1) `setTumBirlestir` K4 kararını aynen döndürürse (= yalnız motorun
 * sorduğu ilk kitap) "SM2: book2 geride → GÜNCEL-DEĞİL" ve "genel karar" testleri kırılır;
 * (M2) `agacOlc` yalnız ilk alt kitabı ölçerse "her alt kitap sorulur" ve SM2 testleri kırılır.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ST = require('./set-guncellik');
const K4 = require('./k4-guncellik');
const ig = require('../../src/runtime/icerik-guncelleme');

const UC = 'https://www.sorucoz.tv/TestlerMobil/GetKitapGuncellemeBilgi?id={bookId}&setMi={isSet}&versiyon={version}';
const appConfig = `window.AppConfig = { updateBookEndPoint: "${UC}" };`;

/** Sahte SET ağacı: kök kabuk menüsü (işlenmez) + her kitap menüsü (motorun kodlamasıyla). */
function sahteSet(kitaplar, { kokMenu = true } = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'set-tum-'));
  const yaz = (rel, veri) => {
    fs.mkdirSync(path.dirname(path.join(kok, rel)), { recursive: true });
    fs.writeFileSync(path.join(kok, rel), veri);
  };
  yaz('index.html', '<html><title>Super Monsters 2 Set</title></html>');
  if (kokMenu) yaz('classlibraries/ImWin32.dll', ig.menuKodla('<main><cover ID="1" version="1"/></main>', () => 0.5));
  yaz('assets2/kapak.png', 'png');
  for (const [dizin, kapaklar] of Object.entries(kitaplar)) {
    yaz(`${dizin}/index.html`, '<html></html>');
    yaz(`${dizin}/app.config.js`, appConfig);
    const xml = `<main>${kapaklar.map(([id, v]) => `<cover ID="${id}" version="${v}" URL=""/>`).join('')}</main>`;
    yaz(`${dizin}/classlibraries/ImWin32.dll`, kapaklar === null ? 'bozuk' : ig.menuKodla(xml, () => 0.5));
    yaz(`${dizin}/assets/${(kapaklar[0] || ['0'])[0]}/thumbs/1.jpg`, 'jpg');
  }
  return kok;
}

/** Sahte İmpark: {id: Vs}. Sorulan versiyon < Vs → Data dolu (canlı biçim), değilse Data "". */
function sahteImpark(tablo, { hata = {} } = {}) {
  const sorulan = [];
  const getir = async (url) => {
    const q = new URL(url).searchParams;
    const id = q.get('id');
    const v = Number(q.get('versiyon'));
    sorulan.push(`${id}@${v}`);
    if (hata[id]) return hata[id];
    const vs = tablo[id];
    if (vs == null) return { status: 200, govde: JSON.stringify({ Success: true, Data: '', Vs: v }) };
    const data = v < vs ? `https://akillitahta.ydspublishing.com/Uploads/ZKitapZipH/${id}-${vs}.zip` : '';
    return { status: 200, govde: JSON.stringify({ Success: true, Data: data, Vs: data ? vs : v }) };
  };
  return { getir, sorulan };
}

const SM2 = { book1: [['58336', 17]], book2: [['58237', 7]] };
const SM2_IMPARK = { 58336: 17, 58237: 14 };

async function olc(kitaplar, impark, secenek) {
  const kok = sahteSet(kitaplar, secenek);
  const i = sahteImpark(impark, secenek);
  const olcum = await ST.agacOlc(ST.agacTopla(fs, path, kok), { getir: i.getir });
  return { kok, olcum, karar: ST.setTumKarari(olcum), sorulan: i.sorulan };
}

test('bayrak: KABUL_SET_TUM varsayılan KAPALI, yalnız "1" açar', () => {
  assert.equal(ST.setTumEtkin({ env: {} }), false);
  assert.equal(ST.setTumEtkin({ env: { KABUL_SET_TUM: '0' } }), false);
  assert.equal(ST.setTumEtkin({ env: { KABUL_SET_TUM: '1' } }), true);
  assert.equal(ST.setTumEtkin({ env: {}, bayrak: true }), true);
});

test('agacTopla: kök + her alt kitabın menüsü ve app.config.js; menüsüz dizin (assets2) alınmaz', () => {
  const kok = sahteSet(SM2);
  const a = ST.agacTopla(fs, path, kok);
  assert.equal(a.hata, undefined);
  assert.deepEqual(a.adlar, ['classlibraries/ImWin32.dll', 'book1/classlibraries/ImWin32.dll', 'book1/app.config.js',
    'book2/classlibraries/ImWin32.dll', 'book2/app.config.js']);
  assert.equal(Buffer.from(a.dosyalar['book2/app.config.js'], 'base64').toString('utf8'), appConfig);
  assert.match(ST.agacTopla(fs, path, path.join(kok, 'yok')).hata, /kök okunamadı/);
  assert.match(ST.agacTopla(fs, path, kok, 10).hata, /tavanı aşıldı/);
});

test('sayfaIfadesi: canlı sayfadaki ifade agacTopla ile AYNI ağacı verir; Node yoksa gerekçe', () => {
  const kok = sahteSet(SM2);
  const sayfa = JSON.parse(vm.runInNewContext(ST.sayfaIfadesi(kok), { require }));
  assert.deepEqual(sayfa, ST.agacTopla(fs, path, kok));
  const nodesuz = JSON.parse(vm.runInNewContext(ST.sayfaIfadesi(kok), {}));
  assert.match(nodesuz.hata, /Node \(require\) yok/);
  assert.equal(ST.kokuUrldenBul('file:///a/Super%20Monsters%202%20Set.app/Contents/Resources/app.asar/index.html'),
    '/a/Super Monsters 2 Set.app/Contents/Resources/app.asar');
  assert.equal(ST.kokuUrldenBul('https://localhost/index.html'), null);
});

test('SM2: her alt kitap sorulur (motor yalnız book1\'i sordu) — book2 58237 v7 < İmpark v14 → GÜNCEL-DEĞİL', async () => {
  const { olcum, karar, sorulan } = await olc(SM2, SM2_IMPARK);
  assert.equal(olcum.set, true);
  assert.deepEqual(sorulan, ['58336@17', '58237@7'], 'kök kabuk menüsü sorulmaz, İKİ alt kitap da sorulur');
  assert.equal(karar.durum, 'GUNCEL_DEGIL');
  assert.equal(karar.kod, 3);
  assert.equal(karar.sebep, 'SET alt kitap geride: book2 58237 paket v7 < İmpark v14');
  assert.match(karar.oneri, /ZKitapZipH\/58237-14\.zip/);
  assert.ok(karar.notlar.includes('book1 58336 v17 güncel'), karar.notlar.join());
  assert.deepEqual(karar.satirlar.map((s) => `${s.kitap}:${s.durum}`), ['book1:GUNCEL', 'book2:GERIDE']);
});

test('hepsi güncel → GEÇTİ (her kitap sebepte); tek kitap → ATLANDI', async () => {
  const g = await olc(SM2, { 58336: 17, 58237: 7 });
  assert.equal(g.karar.durum, 'GECTI');
  assert.equal(g.karar.kod, 0);
  assert.match(g.karar.sebep, /güncel \(2\): book1 58336 v17 güncel; book2 58237 v7 güncel/);
  // Tek kitap: kökte kitap menüsü, alt dizinde menü yok → motor açılışta bütün kapakları sorar.
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'set-tum-tek-'));
  fs.mkdirSync(path.join(kok, 'classlibraries'));
  fs.writeFileSync(path.join(kok, 'classlibraries/ImWin32.dll'), ig.menuKodla('<main><cover ID="44187" version="33"/></main>', () => 0.5));
  fs.writeFileSync(path.join(kok, 'app.config.js'), appConfig);
  const i = sahteImpark({ 44187: 36 });
  const t = ST.setTumKarari(await ST.agacOlc(ST.agacTopla(fs, path, kok), { getir: i.getir }));
  assert.equal(t.durum, 'ATLANDI');
  assert.deepEqual(i.sorulan, [], 'tek kitapta set-tum ağa çıkmaz (E7/K4 motor sorusunu ölçer)');
});

test('ölçülemeyen alt kitap → ÖLÇÜLEMEDİ satırı, ENGELLEMEZ; geride olan varsa GÜNCEL-DEĞİL baskın', async () => {
  const kitaplar = { book1: [['58336', 17]], book2: [['58237', 7]], book3: [['60001', 2]] };
  const o = await olc(kitaplar, { 58336: 17, 58237: 7 }, { hata: { 60001: { status: 404, govde: '' } } });
  assert.equal(o.karar.durum, 'OLCULEMEDI');
  assert.equal(o.karar.kod, 4);
  assert.equal(o.karar.engeller, false);
  assert.equal(o.karar.sebep, 'SET alt kitap ölçülemedi: book3 60001 v2 ÖLÇÜLEMEDİ (HTTP 404)');
  const d = await olc(kitaplar, { 58336: 17, 58237: 14 }, { hata: { 60001: { hata: 'zaman aşımı (15 sn)' } } });
  assert.equal(d.karar.durum, 'GUNCEL_DEGIL');
  assert.ok(d.karar.notlar.some((n) => /book3 60001 v2 ÖLÇÜLEMEDİ \(zaman aşımı/.test(n)), d.karar.notlar.join());
  // Menü çözülemeyen alt kitap da satır olur (sahte GÜNCEL yok).
  const kok = sahteSet(SM2);
  fs.writeFileSync(path.join(kok, 'book2/classlibraries/ImWin32.dll'), 'bozuk');
  const b = ST.setTumKarari(await ST.agacOlc(ST.agacTopla(fs, path, kok), { getir: sahteImpark(SM2_IMPARK).getir }));
  assert.equal(b.durum, 'OLCULEMEDI');
  assert.match(b.sebep, /book2 \? v\? ÖLÇÜLEMEDİ \(menü çözülemedi\)/);
  // Ağaç hiç okunamadı → ÖLÇÜLEMEDİ (engellemez).
  const h = ST.setTumKarari(await ST.agacOlc({ adlar: [], dosyalar: {}, hata: 'sayfada Node (require) yok' }));
  assert.equal(h.durum, 'OLCULEMEDI');
  assert.equal(h.engeller, false);
});

const k4 = (durum, ek = {}) => ({
  durum, kod: K4.K4_KOD[durum], sebep: `motor ${durum}`, oneri: '', notlar: [], engeller: false, kaynak: 'electron', ...ek,
});

test('setTumBirlestir: en kötüsü (GÜNCEL-DEĞİL > ÖLÇÜLEMEDİ > GEÇTİ), K4 engeli SET GEÇTİ ile kalkmaz', async () => {
  const { karar: geride } = await olc(SM2, SM2_IMPARK);
  const { karar: guncel } = await olc(SM2, { 58336: 17, 58237: 7 });
  const b = ST.setTumBirlestir(k4('GECTI', { sebep: 'E7 58336 v17 güncel (Vs=17)' }), geride);
  assert.equal(b.durum, 'GUNCEL_DEGIL');
  assert.equal(b.kod, 3);
  assert.match(b.sebep, /book2 58237 paket v7 < İmpark v14/);
  assert.match(b.oneri, /58237-14/);
  assert.ok(b.notlar.some((n) => /electron: GEÇTİ — E7 58336/.test(n)), b.notlar.join());
  assert.deepEqual(b.kaynaklar.map((k) => k.kaynak), ['electron', 'set-tum']);
  assert.equal(ST.setTumBirlestir(k4('GUNCEL_DEGIL'), guncel).durum, 'GUNCEL_DEGIL');
  const eng = ST.setTumBirlestir(k4('OLCULEMEDI', { engeller: true }), guncel);
  assert.equal(eng.durum, 'OLCULEMEDI');
  assert.equal(eng.engeller, true, 'CDP kurulamadı/E8 engeli SET ile kalkmaz');
  const stOlc = ST.setTumKarari({ set: true, satirlar: [{ kitap: 'book2', id: '58237', surum: 7, durum: 'OLCULEMEDI', not: 'HTTP 404' }] });
  const o = ST.setTumBirlestir(k4('GECTI'), stOlc);
  assert.equal(o.durum, 'OLCULEMEDI', 'ölçülemeyen alt kitap K4 alanını GEÇTİ bırakmaz (sahte yeşil yok)');
  assert.equal(o.engeller, false);
  const g = ST.setTumBirlestir(k4('GECTI', { sebep: 'E7 x' }), guncel);
  assert.equal(g.durum, 'GECTI');
  assert.match(g.sebep, /^E7 x; SET tüm alt kitaplar güncel/);
  const atl = ST.setTumBirlestir(k4('GECTI'), ST.setTumKarari({ set: false, satirlar: [] }));
  assert.equal(atl.durum, 'GECTI');
  assert.ok(atl.notlar.some((n) => /set-tum: ATLANDI/.test(n)));
  assert.equal(ST.setTumBirlestir(null, null), null);
  assert.equal(ST.setTumBirlestir(null, geride).durum, 'GUNCEL_DEGIL');
});

test('genel karar (Pardus politikası): geride alt kitap → GÜNCEL-DEĞİL rc 3; ölçülemeyen alt kitap kararı değiştirmez', async () => {
  const { karar: geride } = await olc(SM2, SM2_IMPARK);
  const k = ST.setTumBirlestir(k4('GECTI'), geride);
  const genel = K4.genelKararK4('GECTI', k);
  assert.equal(genel, 'GUNCEL_DEGIL');
  assert.equal(K4.k4CikisKodu(genel, true, () => 9), 3);
  const stOlc = ST.setTumKarari({ set: true, satirlar: [{ kitap: 'book2', id: '58237', surum: 7, durum: 'OLCULEMEDI', not: 'x' }] });
  assert.equal(K4.genelKararK4('GECTI', ST.setTumBirlestir(k4('GECTI'), stOlc)), 'GECTI');
  assert.equal(K4.genelKararK4('RED', k), 'RED', 'paket kusuru (RED) GÜNCEL-DEĞİL\'den önce');
});

test('satirlariYaz: probook-kabul.sh\'in okuduğu SET_TUM* satırları tek satır', async () => {
  const { karar } = await olc(SM2, SM2_IMPARK);
  const l = [];
  ST.satirlariYaz({ ...karar, sebep: `${karar.sebep}\nikinci` }, (x) => l.push(x));
  assert.equal(l[0], 'SET_TUM=GUNCEL_DEGIL');
  assert.equal(l[1], 'SET_TUM_AYRINTI=SET alt kitap geride: book2 58237 paket v7 < İmpark v14 ikinci');
  assert.match(l[2], /^SET_TUM_ONERI=kaynak S1 ile yenilenmeli \(ZKitapZipH\/58237-14\.zip\)/);
  assert.match(l[3], /^SET_TUM_NOT=book1 58336 v17 güncel/);
});

test('sayfadanOlc: CDP yok / kök yok / sayfa istisnası → ÖLÇÜLEMEDİ (fırlatmaz)', async () => {
  assert.match((await ST.sayfadanOlc({ cdp: null, kok: '/x' })).karar.sebep, /CDP oturumu yok/);
  const cdp = { degerlendir: async () => { throw new Error('sayfa istisnası: x'); } };
  assert.match((await ST.sayfadanOlc({ cdp, kok: null })).karar.sebep, /kökü çözülemedi/);
  assert.match((await ST.sayfadanOlc({ cdp, kok: '/x' })).karar.sebep, /sayfada ağaç okunamadı: sayfa istisnası/);
  const kok = sahteSet(SM2);
  const canli = { degerlendir: async (ifade) => vm.runInNewContext(ifade, { require }) };
  const r = await ST.sayfadanOlc({ cdp: canli, kok, getir: sahteImpark(SM2_IMPARK).getir });
  assert.equal(r.karar.durum, 'GUNCEL_DEGIL');
  assert.equal(r.adlar.length, 5);
});

test('tek kaynak: SET listesi/kimliği içerik merdiveni S0 çekirdeğinden (kopya yok)', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, 'set-guncellik.js'), 'utf8');
  assert.match(kaynak, /const \{ s0Kaynaktan, menuKonumlari, DURUM: S0 \} = require\('\.\.\/\.\.\/src\/agent\/icerik-merdiven'\);/);
  assert.doesNotMatch(kaynak, /runtime\/icerik-guncelleme|\.menuCoz\(|\.kapaklar\(|function teklif|updateBookEndPoint\s*:/,
    'menü çözümü/soru/yorum yeniden yazılmamalı');
  const m = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'agent', 'icerik-merdiven.js'), 'utf8');
  assert.match(m, /async function s0Olc\(\{ zip, getir = varsayilanGetir, zamanAsimiMs \} = \{\}\) \{\n\s+const dizin = zipDizini\(zip\);\n\s+return s0Kaynaktan\(/);
});

test('ATLANAN ÜYE manifesti: atlanan kimlik SET_TUM satırlarından düşer (404 ölçülemedi / Data boş sahte güncel olmaz), nota girer', async () => {
  const kitaplar = { book1: [['58336', 17]], book2: [['58237', 7]], book3: [['14835', 3]] };
  const tablo = { 58336: 17, 58237: 7 };
  const hata = { 14835: { status: 404, govde: '' } };
  // manifest yok → 14835 404 = ÖLÇÜLEMEDİ (eski davranış)
  const eski = await olc(kitaplar, tablo, { hata });
  assert.equal(eski.karar.durum, 'OLCULEMEDI');
  // manifest var → 14835 beklenmez: GEÇTİ, satırda yok, not var
  const kok = sahteSet(kitaplar);
  fs.writeFileSync(path.join(kok, 'empp-uretec.json'), JSON.stringify({
    kaynak: 'uretec', atlananUyeler: [{ kitapId: '14835', ad: 'Old Man', sebep: "İmpark'ta içerik yok" }],
  }));
  const i = sahteImpark(tablo, { hata });
  const agac = ST.agacTopla(fs, path, kok);
  assert.ok(agac.adlar.includes('empp-uretec.json'));
  const olcum = await ST.agacOlc(agac, { getir: i.getir });
  const karar = ST.setTumKarari(olcum);
  assert.equal(karar.durum, 'GECTI', karar.sebep);
  assert.deepEqual(karar.satirlar.map((s) => s.id), ['58336', '58237']);
  assert.ok(karar.notlar.some((n) => /^SET: atlanan üye \(manifest, beklenenden düşüldü\): 14835 "Old Man"/.test(n)), karar.notlar.join());
  // canlı sayfa ifadesi de manifesti taşır (agacTopla kendi kendine yeter)
  assert.deepEqual(JSON.parse(vm.runInNewContext(ST.sayfaIfadesi(kok), { require })), agac);
});
