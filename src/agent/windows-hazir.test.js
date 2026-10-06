'use strict';

/**
 * Windows hazır kuyruğu ("imza bekliyor", sözleşme exesiz-kaynak §2a) — dosya düzeni + bildirim kararı.
 * Gerçek ~/.empp-agent'e dokunulmaz (her test kendi geçici kökünü kullanır).
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();
after(() => YALITIM.temizle());

const H = require('./windows-hazir');

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `hazir-${ad}-`));
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

function kur() {
  const cfg = { ...H.hazirAyarlari({}), winHazirKoku: path.join(tmp('kok'), 'windows-hazir') };
  const work = tmp('work');
  const govde = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(5000)]);
  const exe = path.join(work, 'runner-74390-Test-2.51.3-Setup.exe');
  fs.writeFileSync(exe, govde);
  const kanit = { imzasiz: { md5: md5(govde), sha256: 'ab'.repeat(32), boyut: govde.length }, kapi: { ozet: '12 PASS' }, kokIndex: { sha256: 'cd' } };
  const job = { bookId: '74390', platform: 'windows', bookTitle: 'Test', publisherName: 'YDS', surum: '2.51.3', guncellemeTabani: 'https://x', downloadUrl: 'https://gizli?X-Amz-Signature=abc' };
  return { cfg, work, govde, exe, kanit, job };
}

test('hazirAyarlari: varsayılan AÇIK, EMPP_WIN_IMZA_BEKLEME=0 kapatır; kök env ile değişir', () => {
  assert.equal(H.hazirAyarlari({}).winHazirAcik, true);
  assert.equal(H.hazirAyarlari({ EMPP_WIN_IMZA_BEKLEME: '0' }).winHazirAcik, false);
  assert.equal(H.hazirAyarlari({ EMPP_WIN_HAZIR_KOK: '/x/y' }).winHazirKoku, '/x/y');
  assert.equal(path.basename(H.hazirAyarlari({}).winHazirKoku), 'windows-hazir');
  assert.equal(H.hazirAyarlari({}).winHazirBildirimEsikMs, 3 * 3600 * 1000);
});

test('hazirKoy: exe + manifest (bookId, platform, sürüm, sha256, kabul kanıtı, R2 hedefi, claim, zaman); claim\'in imzalı URL\'si yazılmaz', async () => {
  const o = kur();
  const h = await H.hazirKoy({
    exe: o.exe, job: o.job, surum: '2.51.3', kanit: o.kanit, cfg: o.cfg,
    kabul: { kapi: 'kasa', kanitDizini: '/k/74390-windows-1' }, r2Hedef: { r2ObjectKey: 'softwares/74390/T.exe' },
    sebep: 'imza yuvası erişilemiyor',
  });
  assert.equal(h.dizin, path.join(o.cfg.winHazirKoku, '74390-2.51.3'));
  const m = JSON.parse(fs.readFileSync(path.join(h.dizin, 'manifest.json'), 'utf8'));
  assert.equal(m.bookId, '74390');
  assert.equal(m.platform, 'windows');
  assert.equal(m.surum, '2.51.3');
  assert.equal(m.sha256, 'ab'.repeat(32));
  assert.equal(m.md5, md5(o.govde));
  assert.equal(m.boyut, o.govde.length);
  assert.equal(m.kabulKapi, 'kasa');
  assert.equal(m.kabulKanit, '/k/74390-windows-1');
  assert.equal(m.r2Hedef.r2ObjectKey, 'softwares/74390/T.exe');
  assert.equal(m.durum, 'imza-bekliyor');
  assert.equal(m.job.publisherName, 'YDS');
  assert.equal(m.job.downloadUrl, undefined, 'imzalı indirme adresi manifeste girmez');
  assert.ok(Date.parse(m.zaman));
  assert.equal(md5(fs.readFileSync(path.join(h.dizin, m.exe))), md5(o.govde), 'hazır kopya üretilen exe ile bayt bayt aynı');
  fs.rmSync(o.work, { recursive: true, force: true }); // runner iş sonunda work'ü siler
  assert.ok(fs.existsSync(path.join(h.dizin, m.exe)), 'work silinince hazır kopya yerinde kalır');
  assert.deepEqual(fs.readdirSync(o.cfg.winHazirKoku).filter((f) => f.startsWith('.')), [], 'geçici dizin kalmaz');
});

test('hazirKoy: üretilen paketle boyut tutmazsa fırlatır (yarım kopya kuyruğa girmez)', async () => {
  const o = kur();
  o.kanit.imzasiz.boyut += 1;
  await assert.rejects(H.hazirKoy({ exe: o.exe, job: o.job, surum: '2.51.3', kanit: o.kanit, cfg: o.cfg }), /boyutu/);
  assert.equal((await H.hazirListesi(o.cfg)).length, 0);
});

test('hazirBul: bekleyen kayıt bulunur; exe eksik/boyut farklı/durum farklı → null', async () => {
  const o = kur();
  assert.equal(await H.hazirBul(o.cfg, '74390', '2.51.3'), null);
  const h = await H.hazirKoy({ exe: o.exe, job: o.job, surum: '2.51.3', kanit: o.kanit, cfg: o.cfg });
  const b = await H.hazirBul(o.cfg, '74390', '2.51.3');
  assert.equal(b.dizin, h.dizin);
  assert.equal(await H.hazirBul(o.cfg, '74390', '2.51.4'), null, 'başka sürüm eşleşmez');
  fs.appendFileSync(b.exeYolu, 'x');
  assert.equal(await H.hazirBul(o.cfg, '74390', '2.51.3'), null, 'boyutu değişmiş kopya kullanılmaz');
});

test('aynı sürüm yeniden konunca eskisi SİLİNMEZ, eskiler/ altına taşınır', async () => {
  const o = kur();
  await H.hazirKoy({ exe: o.exe, job: o.job, surum: '2.51.3', kanit: o.kanit, cfg: o.cfg });
  await H.hazirKoy({ exe: o.exe, job: o.job, surum: '2.51.3', kanit: o.kanit, cfg: o.cfg });
  const eskiler = fs.readdirSync(path.join(o.cfg.winHazirKoku, 'eskiler'));
  assert.equal(eskiler.length, 1);
  assert.match(eskiler[0], /^74390-2\.51\.3-\d{8}-\d{6}/);
  assert.equal((await H.hazirListesi(o.cfg)).length, 1);
});

test('hazirListesi: en eskiden yeniye; alt dizinler, gizli/geçici ve manifestsiz dizinler sayılmaz', async () => {
  const o = kur();
  const a = await H.hazirKoy({ exe: o.exe, job: { ...o.job, bookId: '1' }, surum: '2.1.1', kanit: o.kanit, cfg: o.cfg });
  const b = await H.hazirKoy({ exe: o.exe, job: { ...o.job, bookId: '2' }, surum: '2.1.1', kanit: o.kanit, cfg: o.cfg });
  await H.manifestGuncelle(a.dizin, { zaman: '2026-10-02T10:00:00.000Z' });
  await H.manifestGuncelle(b.dizin, { zaman: '2026-10-02T08:00:00.000Z' });
  fs.mkdirSync(path.join(o.cfg.winHazirKoku, 'manifestsiz'));
  fs.mkdirSync(path.join(o.cfg.winHazirKoku, '.yarim.tmp-1'));
  fs.mkdirSync(path.join(o.cfg.winHazirKoku, 'yayinlandi'), { recursive: true });
  const l = await H.hazirListesi(o.cfg);
  assert.deepEqual(l.map((x) => x.manifest.bookId), ['2', '1']);
});

test('hazirListesi: imza-oncelik.txt listesindeki kayıt (dosya sırasıyla) en eskilerin ÖNÜNE geçer', async () => {
  const o = kur();
  const a = await H.hazirKoy({ exe: o.exe, job: { ...o.job, bookId: '1' }, surum: '2.1.1', kanit: o.kanit, cfg: o.cfg });
  const b = await H.hazirKoy({ exe: o.exe, job: { ...o.job, bookId: '2' }, surum: '2.1.1', kanit: o.kanit, cfg: o.cfg });
  const c = await H.hazirKoy({ exe: o.exe, job: { ...o.job, bookId: '73768' }, surum: '2.1.1', kanit: o.kanit, cfg: o.cfg });
  await H.manifestGuncelle(a.dizin, { zaman: '2026-10-02T08:00:00.000Z' });
  await H.manifestGuncelle(b.dizin, { zaman: '2026-10-02T09:00:00.000Z' });
  await H.manifestGuncelle(c.dizin, { zaman: '2026-10-02T12:00:00.000Z' });
  assert.deepEqual((await H.hazirListesi(o.cfg)).map((x) => x.manifest.bookId), ['1', '2', '73768'], 'dosyasız: en eski önce');
  fs.writeFileSync(H.oncelikDosyasi(o.cfg), '# Super Monsters 3\n73768\n\n2 # sonra\nabc\n');
  assert.deepEqual(await H.oncelikOku(o.cfg), ['73768', '2']);
  assert.deepEqual((await H.hazirListesi(o.cfg)).map((x) => x.manifest.bookId), ['73768', '2', '1']);
});

test('sonuclandir: manifest güncellenir, kayıt yayinlandi/ ya da reddedildi/ altına TAŞINIR', async () => {
  const o = kur();
  await H.hazirKoy({ exe: o.exe, job: o.job, surum: '2.51.3', kanit: o.kanit, cfg: o.cfg });
  const [g] = await H.hazirListesi(o.cfg);
  const s = await H.sonuclandir(o.cfg, g, 'yayinlandi', { durum: 'yayinlandi', yayin: { r2ObjectKey: 'k' } });
  assert.equal(path.dirname(s.dizin), path.join(o.cfg.winHazirKoku, 'yayinlandi'));
  const m = JSON.parse(fs.readFileSync(path.join(s.dizin, 'manifest.json'), 'utf8'));
  assert.equal(m.durum, 'yayinlandi');
  assert.equal(m.yayin.r2ObjectKey, 'k');
  assert.ok(fs.existsSync(path.join(s.dizin, m.exe)));
  assert.equal((await H.hazirListesi(o.cfg)).length, 0);
  assert.equal(await H.hazirBul(o.cfg, '74390', '2.51.3'), null);
});

test('bildirimKarari: bekleyen yoksa sus; yuva yok → bildir; 3 sa eşiği; aynı sebep 3 saatte bir', () => {
  const S = 3 * 3600 * 1000;
  const t = Date.parse('2026-10-02T12:00:00Z');
  const temel = { bekleyenSayisi: 2, enEskiMs: t - 60000, yuvaErisilir: false, sebep: 'VPN kapalı', simdiMs: t, durum: {}, esikMs: S, aralikMs: S };
  assert.equal(H.bildirimKarari({ ...temel, bekleyenSayisi: 0 }).gonder, false);
  const k = H.bildirimKarari(temel);
  assert.equal(k.gonder, true);
  assert.equal(k.mesaj, '2 Windows paketi imza bekliyor: VPN kapalı');
  assert.equal(H.bildirimKarari({ ...temel, durum: { [k.anahtar]: t - S + 1000 } }).gonder, false, '3 saat dolmadan aynı sebep');
  assert.equal(H.bildirimKarari({ ...temel, durum: { [k.anahtar]: t - S - 1000 } }).gonder, true, '3 saat sonra yeniden');
  assert.equal(H.bildirimKarari({ ...temel, durum: { [k.anahtar]: t }, sebep: 'başka sebep' }).gonder, true, 'yeni sebep hemen');
  assert.equal(H.bildirimKarari({ ...temel, yuvaErisilir: true, sebep: null }).gonder, false, 'yuva var + taze bekleyen → sus');
  const eski = H.bildirimKarari({ ...temel, yuvaErisilir: true, sebep: null, enEskiMs: t - S - 1 });
  assert.equal(eski.gonder, true);
  assert.match(eski.mesaj, /^2 Windows paketi imza bekliyor: en eski 3 saattir bekliyor$/);
});

test('kayitKilidiDene: tutulurken ikinci alamaz, bırakınca alınır', async () => {
  const d = tmp('kilit');
  const b1 = await H.kayitKilidiDene(d);
  assert.ok(b1);
  assert.equal(await H.kayitKilidiDene(d), null);
  await b1();
  const b2 = await H.kayitKilidiDene(d);
  assert.ok(b2);
  await b2();
});

// ---------------------------------------------------------------------------
// KABUL KUYRUĞU (05.10) — durum parametresi, bekçi listesi kabul-bekliyor GÖRMEZ, kabulListesi sırası.
// ---------------------------------------------------------------------------

test('hazirAyarlari: kabul kuyruğu varsayılan KAPALI; derinlik 1, min boş 15 GB; env ile değişir', () => {
  const v = H.hazirAyarlari({});
  assert.equal(v.winKabulKuyrugu, false);
  assert.equal(v.winKabulDerinlik, 1);
  assert.equal(v.winUretMinBosGb, 15);
  const e = H.hazirAyarlari({ EMPP_WIN_KABUL_KUYRUK: '1', EMPP_WIN_KABUL_DERINLIK: '2', EMPP_WIN_URET_MIN_BOS_GB: '30' });
  assert.equal(e.winKabulKuyrugu, true);
  assert.equal(e.winKabulDerinlik, 2);
  assert.equal(e.winUretMinBosGb, 30);
  assert.equal(H.hazirAyarlari({ EMPP_WIN_KABUL_DERINLIK: '0' }).winKabulDerinlik, 1, 'derinlik en az 1');
  assert.equal(H.hazirAyarlari({ EMPP_WIN_KABUL_KUYRUK: 'evet' }).winKabulKuyrugu, false, 'yalnız "1" açar');
});

test('hazirKoy durum parametresi: kabul-bekliyor yazılır; bilinmeyen durum reddedilir; varsayılan imza-bekliyor', async () => {
  const o = kur();
  const h = await H.hazirKoy({ exe: o.exe, job: o.job, surum: '2.51.3', kanit: o.kanit, cfg: o.cfg, durum: H.KABUL_BEKLIYOR });
  const m = JSON.parse(fs.readFileSync(path.join(h.dizin, 'manifest.json'), 'utf8'));
  assert.equal(m.durum, 'kabul-bekliyor');
  assert.equal(m.kabulKapi, null, 'kabul henüz koşmadı');
  await assert.rejects(H.hazirKoy({ exe: o.exe, job: o.job, surum: '2.51.4', kanit: o.kanit, cfg: o.cfg, durum: 'yayinlandi' }), /bilinmeyen durum/);
  const v = await H.hazirKoy({ exe: o.exe, job: { ...o.job, bookId: '9' }, surum: '2.51.3', kanit: o.kanit, cfg: o.cfg });
  assert.equal(v.manifest.durum, 'imza-bekliyor');
});

test('nöbetçi: hazirListesi (imza bekçisinin listesi) kabul-bekliyor kaydı GÖRMEZ; hazirBul iki durumu da bulur', async () => {
  const o = kur();
  await H.hazirKoy({ exe: o.exe, job: o.job, surum: '2.51.3', kanit: o.kanit, cfg: o.cfg, durum: H.KABUL_BEKLIYOR });
  assert.deepEqual(await H.hazirListesi(o.cfg), [], 'kabulsüz paket imzaya gitmez');
  const b = await H.hazirBul(o.cfg, '74390', '2.51.3');
  assert.equal(b.manifest.durum, 'kabul-bekliyor');
  await H.manifestGuncelle(b.dizin, { durum: H.IMZA_BEKLIYOR_FAZI });
  assert.equal((await H.hazirListesi(o.cfg)).length, 1, 'GEÇTİ sonrası aynı kayıt bekçiye görünür');
  assert.deepEqual(await H.kabulListesi(o.cfg), []);
  assert.equal((await H.hazirBul(o.cfg, '74390', '2.51.3')).manifest.durum, 'imza-bekliyor');
});

test('kabulListesi: yalnız kabul-bekliyor, en eski önce; olculemedi/ ve alt dizinler sayılmaz; isleniyor = canlı pid izi', async () => {
  const o = kur();
  const a = await H.hazirKoy({ exe: o.exe, job: { ...o.job, bookId: '1' }, surum: '2.1.1', kanit: o.kanit, cfg: o.cfg, durum: H.KABUL_BEKLIYOR });
  const b = await H.hazirKoy({ exe: o.exe, job: { ...o.job, bookId: '2' }, surum: '2.1.1', kanit: o.kanit, cfg: o.cfg, durum: H.KABUL_BEKLIYOR });
  await H.hazirKoy({ exe: o.exe, job: { ...o.job, bookId: '3' }, surum: '2.1.1', kanit: o.kanit, cfg: o.cfg }); // imza-bekliyor
  await H.manifestGuncelle(a.dizin, { zaman: '2026-10-05T10:00:00.000Z', kabulIsleniyor: { pid: process.pid, zaman: 'x' } });
  await H.manifestGuncelle(b.dizin, { zaman: '2026-10-05T08:00:00.000Z', kabulIsleniyor: { pid: 999999999, zaman: 'x' } });
  fs.mkdirSync(path.join(o.cfg.winHazirKoku, 'olculemedi', 'x'), { recursive: true });
  const l = await H.kabulListesi(o.cfg);
  assert.deepEqual(l.map((x) => x.manifest.bookId), ['2', '1']);
  assert.deepEqual(l.map((x) => x.isleniyor), [false, true], 'ölü pid izi bekleyen sayılır, canlı pid işleniyor');
  assert.ok(H.ALT_DIZINLER.includes('olculemedi'));
});

// ── KARIŞIK KABUK (06.10, kasa 45496 2.53.4 A1 seti) ──────────────────────────────────────────
// manifest.kanonik.kabukSurum ÖLÇÜLEN sürüm DEĞİL, damganın kanonikSurum'udur (kanonik-surum.js):
// paket eski kabukla çıksa da kanonik sürümü taşır. Bu yüzden "kabukSurum eşit → karisik bayat değil"
// gevşetmesi YAPILMAZ: 45496'da okuyucu gerçekten 1.13.3 kaldı (kanonik 1.13.14). Onarım ölçümde
// (okuyucu-kabugu.js A1 birimi); bayat kuralı aynen kalır.
const GK = { motorSha12: '03e8af70a0f3', kabukSurum: '1.13.14' };
const kanonikli = (k) => ({ job: { kaynakSurumu: '2.53.4' },
  kanonik: { motorSha12: '03e8af70a0f3', motorDurum: 'guncel', kabukSurum: '1.13.14', kabukDurum: 'guncel', ...k } });

test('bayatKarari: A1 yeni kabuk (damga guncel, kanonik eşit) → bayat DEĞİL', () => {
  const r = H.bayatKarari(kanonikli({}), { gecerliKaynakSurumu: '2.53.4', gecerliKanonik: GK });
  assert.equal(r.bayat, false, r.sebep);
});

test('bayatKarari: bookN eski kabuk (kabuk 1.13.3 ≠ kanonik 1.13.14) → bayat', () => {
  const r = H.bayatKarari(kanonikli({ kabukSurum: '1.13.3' }), { gecerliKanonik: GK });
  assert.equal(r.bayat, true);
  assert.match(r.sebep, /kabuk 1\.13\.3 ≠ kanonik 1\.13\.14/);
});

test('bayatKarari: kanoniksiz kayıt (damga yok / boş) → bayat (fail-closed)', () => {
  for (const m of [{ job: {} }, { job: {}, kanonik: {} }, { job: {}, kanonik: { kabukDurum: null } }]) {
    const r = H.bayatKarari(m, { gecerliKanonik: GK });
    assert.equal(r.bayat, true);
    assert.match(r.sebep, /damgası yok/);
  }
});

test('bayatKarari: karisik + kabukSurum kanonikle EŞİT → yine bayat (kabukSurum ölçüm değil)', () => {
  const r = H.bayatKarari(kanonikli({ kabukDurum: 'karisik' }), { gecerliKanonik: GK });
  assert.equal(r.bayat, true);
  assert.match(r.sebep, /kabuk durum "karisik"/);
});

test('ZİNCİR A1: okuyucuKabuguDegistir → paket.json → kanonik özet → bayatKarari bayat DEĞİL', async () => {
  const K = require('../packaging/okuyucu-kabugu');
  const A1 = require('../packaging/a1-duzen');
  const { paketJsondanOku, govdeAlanlari } = require('./kanonik-surum');
  const kok = tmp('zincir-a1');
  const yaz = (rel, icerik) => {
    fs.mkdirSync(path.dirname(path.join(kok, rel)), { recursive: true });
    fs.writeFileSync(path.join(kok, rel), icerik);
  };
  const kab = (dir, main, parca, surum) => {
    yaz(path.join(dir, main), `x={923:"${parca}"}`);
    yaz(path.join(dir, `${parca}.923.js`), `e.exports={i8:"${surum}"}`);
  };
  const eskiMain = `${'a'.repeat(20)}.main.js`;
  kab('paket', eskiMain, 'b'.repeat(20), '1.13.3');
  yaz('paket/index.html', '<html><head></head><body>sf425</body></html>');
  yaz('paket/kapak/index.html', A1.baslikEkle(`<html><head><script src="./${eskiMain}"></script></head></html>`));
  yaz('paket/app.config.js', 'x');
  yaz('paket/classlibraries/ImWin32.dll', 'x');
  const yeniMain = `${'d'.repeat(20)}.main.js`;
  kab('kabuk/1.13.14', yeniMain, 'e'.repeat(20), '1.13.14');
  const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(kok, rel)))
    .digest('hex').slice(0, 12);
  const dosyalar = [yeniMain, `${'e'.repeat(20)}.923.js`].map((ad) => ({ ad, sha12: sha(`kabuk/1.13.14/${ad}`) }));
  yaz('kabuk/1.13.14/manifest.json', JSON.stringify({ surum: '1.13.14', main: yeniMain, dosyalar }));
  yaz('kabuk/kanonik.json', JSON.stringify({ surum: '1.13.14', dizin: path.join(kok, 'kabuk', '1.13.14') }));
  const d = await K.okuyucuKabuguDegistir(path.join(kok, 'paket'), path.join(kok, 'kabuk', 'kanonik.json'));
  assert.equal(d.durum, 'guncel');
  const pj = JSON.parse(fs.readFileSync(path.join(kok, 'paket', 'paket.json'), 'utf8'));
  pj.motorSurumu = { durum: 'guncel', sha12: '03e8af70a0f3' };
  fs.writeFileSync(path.join(kok, 'paket', 'paket.json'), JSON.stringify(pj));
  const kanonik = govdeAlanlari(await paketJsondanOku(path.join(kok, 'paket')));
  assert.deepEqual(kanonik,
    { motorSha12: '03e8af70a0f3', motorDurum: 'guncel', kabukSurum: '1.13.14', kabukDurum: 'guncel' });
  const r = H.bayatKarari({ job: { kaynakSurumu: '2.53.4' }, kanonik },
    { gecerliKaynakSurumu: '2.53.4', gecerliKanonik: GK });
  assert.equal(r.bayat, false, r.sebep);
});
