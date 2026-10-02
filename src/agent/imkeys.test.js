'use strict';

/**
 * imKeys.dll (güvenlik 02.10) — biçim, okuyucu uyumu, kapak keşfi, anahtar çekme, kapı.
 * Okuyucu tarafı yayıncı bundle'ından (modül 6395) BİREBİR kopyalanan fonksiyonlarla simüle edilir:
 * yazdığımız dosyayı okuyucunun kendi çözücüsü açıyor mu, çevrimdışında 123456 kapısı kapanıyor mu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ig = require('../runtime/icerik-guncelleme');
const K = require('./imkeys');

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `imkeys-${ad}-`));
const SAHTE_KODLAR = ['AB3CD', 'xk7mz', ' PQ9RS ', 'AB3CD', 'çok-yanlış!', ''];

// --- Okuyucunun kendisi (minified bundle'dan, adlar korunarak; yalnız fetch yerine bayt alır) ---
function okuyucuO(baytlar) { // O(t): fetch → Uint8Array → r[o]=256-r[o] → TextDecoder; hata → "[]"
  try {
    const r = new Uint8Array(baytlar);
    for (let o = 0; o < r.length; o++) r[o] = 256 - r[o];
    return new TextDecoder().decode(r);
  } catch (e) { return '[]'; }
}
const okuyucuX = (e) => e.split('').map((c) => String.fromCharCode(156 - c.charCodeAt(0))).join('');
const okuyucuS = okuyucuX; // DR
function okuyucuJJ(baytlar) { // _(t): JSON.parse(O(t)).map(x); hata → []
  const n = okuyucuO(baytlar);
  try { return JSON.parse(n).map((e) => okuyucuX(e)); } catch (e) { return []; }
}
/** Aktivasyon diyaloğu + "Aktive et" düğmesi, çevrimdışı dal (window.isOnline=false). */
function okuyucuCevrimdisi(baytlar, girilen) {
  const imKeys = baytlar == null ? [] : okuyucuJJ(baytlar);
  if ((imKeys == null ? undefined : imKeys.length) < 1 && !false /* !window.isOnline */) return { aktif: true, key: '123456' };
  const r = String(girilen).toUpperCase();
  const o = imKeys.findIndex((e) => okuyucuS(e) == r) >= 0; // eslint-disable-line eqeqeq
  return { aktif: o, key: o ? r : null };
}

// --- zip yardımcıları (gerçek `zip` CLI; runner'ın kullandığı araç) ---
function zipKur(dosyalar) {
  const kok = tmp('kaynak');
  for (const [ad, icerik] of Object.entries(dosyalar)) {
    fs.mkdirSync(path.dirname(path.join(kok, ad)), { recursive: true });
    fs.writeFileSync(path.join(kok, ad), icerik);
  }
  const zip = path.join(tmp('zip'), 'build.zip');
  const r = spawnSync('zip', ['-q', '-r', '-X', zip, '.'], { cwd: kok, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return zip;
}
const zipOku = (zip, ad) => {
  const r = spawnSync('unzip', ['-p', zip, ad], { encoding: 'buffer' });
  return r.status === 0 ? r.stdout : null;
};
const zipAdlari = (zip) => spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

function menu({ setId = '45480', aktivasyon = 'true', kapaklar }) {
  const c = kapaklar.map(([id, xs]) => `<cover ID="${id}" etkID="${id}" actName="K${id}" xmlSource="${xs}" key="" version="1" />`).join('');
  return ig.menuKodla(`<?xml version="1.0"?><main activation="${aktivasyon}" key="" ID="${setId}"><Group ID="1"><Tab ID="1">${c}</Tab></Group></main>`);
}
const ICERIK = '<Book kitapId="0"/>';

test('biçim: imKeysBicimle → okuyucunun KENDİ çözücüsü (O+JJ+DR) aynı kodları verir; düz metin dosyada görünmez', () => {
  const b = K.imKeysBicimle(SAHTE_KODLAR);
  const okunan = okuyucuJJ(b).map(okuyucuS);
  assert.deepEqual(okunan, ['AB3CD', 'PQ9RS', 'XK7MZ'], 'normalleştirilmiş (kırp, büyük harf, tekil, sıralı)');
  assert.ok(!b.includes(Buffer.from('AB3CD')), 'kod dosyada düz ASCII durmamalı (okuyucunun bayt katmanı)');
  assert.deepEqual(K.imKeysCoz(b), okunan, 'bizim çözücü = okuyucunun çözücüsü');
  assert.deepEqual(K.kodlariNormallestir(SAHTE_KODLAR).atilan, 2);
});

test('okuyucu simülasyonu: imKeys YOK/boş → çevrimdışı 123456 (kök neden); dolu → yanlış RED, doğru (küçük harf) KABUL, 123456 RED', () => {
  assert.deepEqual(okuyucuCevrimdisi(null, 'HERHANGI'), { aktif: true, key: '123456' }, 'kusur: dosya yok');
  assert.deepEqual(okuyucuCevrimdisi(K.imKeysBicimle([]), 'HERHANGI'), { aktif: true, key: '123456' }, 'kusur: boş liste');
  const b = K.imKeysBicimle(SAHTE_KODLAR);
  assert.equal(okuyucuCevrimdisi(b, 'ZZZZZ').aktif, false, 'yanlış kod reddedilir');
  assert.equal(okuyucuCevrimdisi(b, '123456').aktif, false, 'sabit 123456 artık açmaz');
  assert.deepEqual(okuyucuCevrimdisi(b, 'xk7mz'), { aktif: true, key: 'XK7MZ' }, 'doğru kod (küçük harf) kabul');
  assert.equal(K.cevrimdisiKarar(b, 'pq9rs'), 'kabul');
  assert.equal(K.cevrimdisiKarar(b, 'ZZZZZ'), 'red');
  assert.equal(K.cevrimdisiKarar(Buffer.from('bozuk'), 'X'), 'otomatik-123456');
});

test('kapaklariBul: kök SET menüsü (Marvel düzeni) + bookN menüsü + menüsüz sayısal yedek; içeriksiz ve kimliksiz kapak ayrılır', () => {
  const zip = zipKur({
    'classlibraries/ImWin32.dll': menu({ kapaklar: [['31723', 'assets/31723/data/BookContent.xml'],
      ['61633', 'assets/61633/data/BookContent.xml'], ['0', 'assets/Games/data/BookContent.xml'],
      ['99999', 'assets/99999/data/BookContent.xml']] }),
    'assets/31723/data/BookContent.xml': ICERIK,
    'assets/61633/data/BookContent.xml': ICERIK,
    'assets/Games/data/BookContent.xml': ICERIK,
    'book2/classlibraries/ImWin32.dll': menu({ setId: '45550', aktivasyon: 'false', kapaklar: [['6376', 'assets/English-Up-5-Workbook/data/BookContent.xml']] }),
    'book2/assets/English-Up-5-Workbook/data/BookContent.xml': ICERIK,
    'book3/assets/25814/data/BookContent.xml': ICERIK,
    '__MACOSX/book4/assets/111/data/BookContent.xml': ICERIK,
  });
  const { kapaklar, menuler, kimliksiz } = K.kapaklariBul(K.zipOkuyucu(zip));
  const ozet = kapaklar.map((k) => `${k.id}|${k.imKeysYolu}|${k.kaynak}|${k.ilk}`).sort();
  assert.deepEqual(ozet, [
    '25814|book3/assets/25814/imKeys.dll|dizin|false',
    '31723|assets/31723/imKeys.dll|menu|true',
    '61633|assets/61633/imKeys.dll|menu|false',
    '6376|book2/assets/English-Up-5-Workbook/imKeys.dll|menu|true',
  ], '99999 içeriksiz → yok; __MACOSX yok sayılır; ad dizinli kapak menüden kimlik alır');
  assert.deepEqual(kimliksiz, ['assets/Games/data/BookContent.xml']);
  assert.deepEqual(menuler.map((m) => `${m.kok}|${m.setId}|${m.setAktivasyon}`).sort(), ['book2/|45550|false', '|45480|true']);
});

function sahteBag(anahtarli, kodlar = SAHTE_KODLAR) {
  const casus = { soru: [], cek: 0 };
  return {
    casus,
    anahtarliMi: async (id) => { casus.soru.push(id); return anahtarli.includes(String(id)); },
    kodCek: async () => { casus.cek += 1; if (kodlar instanceof Error) throw kodlar; return kodlar; },
  };
}

test('imKeysHazirla + kapı: anahtarlı kapaklara yazılır, anahtarsıza DOKUNULMAZ; set aktivasyonu İLK kapağı kapsar; kapı GEÇER', async () => {
  const zip = zipKur({
    'classlibraries/ImWin32.dll': menu({ kapaklar: [['61633', 'assets/61633/data/BookContent.xml'],
      ['31723', 'assets/31723/data/BookContent.xml'], ['61635', 'assets/61635/data/BookContent.xml']] }),
    'assets/61633/data/BookContent.xml': ICERIK,
    'assets/31723/data/BookContent.xml': ICERIK,
    'assets/61635/data/BookContent.xml': ICERIK,
  });
  const bag = sahteBag(['45480', '31723']);
  const rapor = await K.imKeysHazirla({ zipYolu: zip, paketId: '45480', calisma: tmp('w'), ...bag });
  assert.deepEqual(rapor.yazilan.sort(), ['assets/31723/imKeys.dll', 'assets/61633/imKeys.dll'],
    '31723 anahtarlı; 61633 set diyaloğunun okuduğu covers[0]; 61635 anahtarsız → yazılmaz');
  assert.equal(zipOku(zip, 'assets/61635/imKeys.dll'), null, 'anahtarsız kapakta kod ekranı AÇILMAMALI');
  for (const y of rapor.yazilan) assert.equal(okuyucuCevrimdisi(zipOku(zip, y), 'ab3cd').aktif, true);
  assert.equal(okuyucuCevrimdisi(zipOku(zip, 'assets/31723/imKeys.dll'), 'ZZZZZ').aktif, false);
  assert.equal(rapor.kodSayisi, 3);
  assert.equal(bag.casus.cek, 1, 'kodlar paket başına BİR kez çekilir');
  assert.ok(!JSON.stringify(rapor).includes('AB3CD'), 'rapor kod DEĞERİ taşımaz');
  assert.deepEqual(K.imKeysKapisi({ zipYolu: zip, rapor }), { gecti: true, nedenler: [], nedenKodlari: [] });
});

test('kapı RED (imkeys-yok): anahtarlı kapakta dosya yok ya da boş; paket anahtarlı ama kapak çözülemedi', async () => {
  const zip = zipKur({ 'assets/31723/data/BookContent.xml': ICERIK, 'assets/31724/data/BookContent.xml': ICERIK,
    'assets/31724/imKeys.dll': K.imKeysBicimle([]) });
  const rapor = { paketId: '45480', paketAnahtarli: true,
    anahtarli: [{ id: '31723', imKeysYolu: 'assets/31723/imKeys.dll' }, { id: '31724', imKeysYolu: 'assets/31724/imKeys.dll' }] };
  const k = K.imKeysKapisi({ zipYolu: zip, rapor });
  assert.equal(k.gecti, false);
  assert.deepEqual(k.nedenKodlari, ['imkeys-yok']);
  assert.match(k.nedenler.join('|'), /31723: assets\/31723\/imKeys\.dll yok.*31724: assets\/31724\/imKeys\.dll boş/);
  const k2 = K.imKeysKapisi({ zipYolu: zip, rapor: { paketId: '45480', paketAnahtarli: true, anahtarli: [] } });
  assert.match(k2.nedenler[0], /^imkeys-yok: paket 45480 anahtarlı ama build'de anahtarlı kapak çözülemedi/);
  assert.equal(K.imKeysKapisi({ zipYolu: zip, rapor: null }).gecti, false, 'rapor yoksa geçiş yok');
});

test('anahtarsız kitap: hiçbir şey yazılmaz, keypanel çağrılmaz, zip bayt bayt aynı, kapı geçer', async () => {
  const zip = zipKur({ 'book1/assets/25776/data/BookContent.xml': ICERIK });
  const once = fs.readFileSync(zip);
  const bag = sahteBag([]);
  const rapor = await K.imKeysHazirla({ zipYolu: zip, paketId: '45550', calisma: tmp('w'), ...bag });
  assert.deepEqual(rapor.yazilan, []);
  assert.equal(bag.casus.cek, 0);
  assert.deepEqual(fs.readFileSync(zip), once);
  assert.equal(K.imKeysKapisi({ zipYolu: zip, rapor }).gecti, true);
});

test('mod eksikse (r2-al): dolu imKeys KORUNUR (keypanel çağrılmaz); boş olan yeniden yazılır', async () => {
  const dolu = K.imKeysBicimle(['OLDKY']);
  const zip = zipKur({ 'assets/31723/data/BookContent.xml': ICERIK, 'assets/31723/imKeys.dll': dolu,
    'assets/31724/data/BookContent.xml': ICERIK, 'assets/31724/imKeys.dll': K.imKeysBicimle([]) });
  const bag = sahteBag(['31723', '31724']);
  const rapor = await K.imKeysHazirla({ zipYolu: zip, paketId: '45480', mod: 'eksikse', calisma: tmp('w'), ...bag });
  assert.deepEqual(rapor.korunan, ['assets/31723/imKeys.dll']);
  assert.deepEqual(rapor.yazilan, ['assets/31724/imKeys.dll']);
  assert.deepEqual(zipOku(zip, 'assets/31723/imKeys.dll'), dolu);
  assert.deepEqual(K.imKeysCoz(zipOku(zip, 'assets/31724/imKeys.dll')), ['AB3CD', 'PQ9RS', 'XK7MZ']);
  const z2 = zipKur({ 'assets/31723/data/BookContent.xml': ICERIK, 'assets/31723/imKeys.dll': dolu });
  const bag2 = sahteBag(['31723']);
  await K.imKeysHazirla({ zipYolu: z2, paketId: '45480', mod: 'eksikse', calisma: tmp('w'), ...bag2 });
  assert.equal(bag2.casus.cek, 0, 'hepsi doluysa keypanel çağrılmaz');
});

test('mod yaz (kurulan build): eski imKeys TAZE kodlarla ezilir', async () => {
  const zip = zipKur({ 'assets/31723/data/BookContent.xml': ICERIK, 'assets/31723/imKeys.dll': K.imKeysBicimle(['OLDKY']) });
  await K.imKeysHazirla({ zipYolu: zip, paketId: '45480', calisma: tmp('w'), ...sahteBag(['31723']) });
  assert.deepEqual(K.imKeysCoz(zipOku(zip, 'assets/31723/imKeys.dll')), ['AB3CD', 'PQ9RS', 'XK7MZ']);
  assert.equal(zipAdlari(zip).filter((a) => a.endsWith('imKeys.dll')).length, 1, 'çift giriş yok');
});

test('imKeysAdimi: keypanel 0 kod / paket tanımsız → kalıcı RED sonucu (yazılmaz); geçici hata FIRLATIR (ertele)', async () => {
  const zip = zipKur({ 'assets/31723/data/BookContent.xml': ICERIK });
  const bos = await K.imKeysAdimi({ zipYolu: zip, paketId: '45480', calisma: tmp('w'), bag: sahteBag(['31723'], ['!!', '']) });
  assert.equal(bos.kapi.gecti, false);
  assert.match(bos.kapi.nedenler[0], /^imkeys-yok: paket 45480 için keypanel'de geçerli kod yok/);
  assert.equal(zipOku(zip, 'assets/31723/imKeys.dll'), null);
  const tanimsiz = await K.imKeysAdimi({ zipYolu: zip, paketId: '45480', calisma: tmp('w'),
    bag: sahteBag(['31723'], new K.ImKeysHatasi('paket 45480 keypanel\'de tanımlı değil (404)')) });
  assert.deepEqual(tanimsiz.kapi.nedenKodlari, ['imkeys-yok']);
  await assert.rejects(K.imKeysAdimi({ zipYolu: zip, paketId: '45480', calisma: tmp('w'),
    bag: sahteBag(['31723'], new K.ImKeysHatasi('ssh rc=255', { gecici: true })) }), (e) => e.gecici === true);
  await assert.rejects(K.imKeysAdimi({ zipYolu: zip, paketId: '45480', calisma: tmp('w'), bag: {
    anahtarliMi: async () => { throw new K.ImKeysHatasi('HasZKitapKey sorulamadı', { gecici: true }); }, kodCek: async () => [] } }),
  (e) => e.gecici === true, 'anahtarlı mı bilinmiyorsa ertele — "anahtarsız" sayma');
});

test('kodCekiciOlustur ssh: jeton UZAKTA okunur (argümanda jeton yok), 200/404/500/jeton-yok/rc≠0 ayrımı, gövde hataya sızmaz', async () => {
  const cagri = [];
  const sahte = (cevap) => async (komut, args) => { cagri.push([komut, args]); return cevap; };
  let cek = K.kodCekiciOlustur({ env: {}, calistir: sahte({ rc: 0, stdout: '{"kodlar":["AB3CD","PQ9RS"]}\n200', stderr: '' }) });
  assert.deepEqual(await cek('45480'), ['AB3CD', 'PQ9RS']);
  const [komut, args] = cagri[0];
  assert.equal(komut, 'ssh');
  assert.deepEqual(args.slice(0, 6), ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-p', '2222']);
  assert.equal(args[6], 'root@100.117.187.26');
  assert.match(args[7], /sed -n 's\/\^KEYPANEL_IC_JETON=\/\/p' \/root\/keypanel\/data\/keypanel\.env/);
  assert.match(args[7], /curl -s -m 40 -H @- .*'http:\/\/127\.0\.0\.1:8801\/ic\/paket\/45480\/kodlar\?sade=1&durum=gecerli'/);
  cek = K.kodCekiciOlustur({ env: {}, calistir: sahte({ rc: 0, stdout: '{"detail":"x"}\n404' }) });
  await assert.rejects(cek('45480'), (e) => e.gecici === false && e.nedenKodu === 'imkeys-yok');
  cek = K.kodCekiciOlustur({ env: {}, calistir: sahte({ rc: 0, stdout: '{"kodlar":["GIZLI"]}\n500' }) });
  await assert.rejects(cek('45480'), (e) => e.gecici && !e.message.includes('GIZLI'));
  cek = K.kodCekiciOlustur({ env: {}, calistir: sahte({ rc: 0, stdout: 'IMKEYS_JETON_YOK\n' }) });
  await assert.rejects(cek('45480'), (e) => e.gecici && /jeton/.test(e.message));
  cek = K.kodCekiciOlustur({ env: {}, calistir: sahte({ rc: 255, stdout: '', stderr: 'Connection timed out' }) });
  await assert.rejects(cek('45480'), (e) => e.gecici && /ssh rc=255/.test(e.message));
  cek = K.kodCekiciOlustur({ env: {}, calistir: sahte({ rc: 0, stdout: '{"kodlar":["GIZLI"]\n200' }) });
  await assert.rejects(cek('45480'), (e) => e.gecici && !e.message.includes('GIZLI'));
  await assert.rejects(cek('1;id'), /geçersiz paket kimliği/, 'kabuk enjeksiyonu: kimlik yalnız rakam');
  await assert.rejects(K.kodCekiciOlustur({ env: { EMPP_KEYPANEL_ENV: '/x;id' }, calistir: sahte({}) })('45480'), /güvensiz/);
});

test('kodCekiciOlustur HTTP (srv21 üstü): x-jeton başlıkta, adres yolda; ağ hatası geçici', async () => {
  const goren = [];
  const cek = K.kodCekiciOlustur({ env: { EMPP_KEYPANEL_IC_URL: 'http://127.0.0.1:8801/', EMPP_KEYPANEL_IC_JETON: 'JTN' },
    fetchFn: async (u, o) => { goren.push([u, o.headers['x-jeton']]); return { status: 200, text: async () => '{"kodlar":[{"kod":"AB3CD"}]}' }; } });
  assert.deepEqual(await cek('45477'), ['AB3CD']);
  assert.deepEqual(goren, [['http://127.0.0.1:8801/ic/paket/45477/kodlar?sade=1&durum=gecerli', 'JTN']]);
  const kopuk = K.kodCekiciOlustur({ env: { EMPP_KEYPANEL_IC_URL: 'http://x', EMPP_KEYPANEL_IC_JETON: 'J' },
    fetchFn: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(kopuk('45477'), (e) => e.gecici === true);
});

test('hasZKitapKeyIstemcisi: "Kitap key içeriyor"/"içermiyor"; Cloudflare HTML → GECİCİ (anahtarsız SAYILMAZ); önbellek', async () => {
  const sayac = { n: 0 };
  const cevaplar = { 45480: '{"Success":true,"Message":"Kitap key içeriyor"}', 45550: '{"Success":false,"Message":"ZKitap key içermiyor."}',
    11811: '<!DOCTYPE html><title>Just a moment...</title>' };
  const sor = K.hasZKitapKeyIstemcisi({ bekle: async () => {}, fetchFn: async (u) => {
    sayac.n += 1;
    const id = u.split('=').pop();
    return { status: cevaplar[id].startsWith('<') ? 403 : 200, text: async () => cevaplar[id] };
  } });
  assert.equal(await sor('45480'), true);
  assert.equal(await sor('45550'), false);
  await assert.rejects(sor('11811'), (e) => e.gecici === true && /JSON değil \(HTTP 403\)/.test(e.message));
  const once = sayac.n;
  assert.equal(await sor('45480'), true);
  assert.equal(sayac.n, once, 'önbellekten');
  assert.equal(K.HAS_KEY_VARSAYILAN, 'https://akillitahta.ydspublishing.com/TestlerMobil/HasZKitapKey?kitapId={kitapId}');
});

test('kapiSar: imKeys RED yazma kapısını RED yapar, neden kodu eklenir; GEÇ ise yazma kapısı aynen', () => {
  const yk = () => ({ gecti: true, kitaplar: [1], nedenler: [], nedenKodlari: [] });
  const red = K.kapiSar(yk, K.redSonucu('31723 yok'))({});
  assert.equal(red.gecti, false);
  assert.deepEqual(red.nedenKodlari, ['imkeys-yok']);
  assert.deepEqual(red.kitaplar, [1]);
  assert.deepEqual(K.kapiSar(yk, { gecti: true, nedenler: [], nedenKodlari: [] })({}), yk());
});
