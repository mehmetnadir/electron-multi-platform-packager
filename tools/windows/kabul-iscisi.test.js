'use strict';

/**
 * Kabul işçisi (kabul kuyruğu, 05.10) — bağımlılıklar sahte. Gerçek kasaya (kabul.py), sunucuya, imza
 * yuvasına ve R2'ye DOKUNULMAZ: kabulKos / presign / postResultFailure / releaseJob enjekte edilir.
 *
 *  GEÇTİ · KALDI · ÖLÇÜLEMEDİ×3 · presign 409 · kayıt kilidi dolu · tekil kilit · döngü uykusu ·
 *  işlenirken üretim kapısı kaydı saymaz · uçtan uca: işçi GEÇTİ → imza bekçisi tur() kaydı yayınlar.
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { izoleOrtam } = require('../../src/agent/test-yalitim');
const YALITIM = izoleOrtam();
after(() => YALITIM.temizle());

const K = require('./kabul-iscisi');
const B = require('./imza-bekcisi');
const H = require('../../src/agent/windows-hazir');
const W = require('../../src/agent/windows-serit');

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `kabul-isci-${ad}-`));
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const KALDI = "windows paketi windows-kasa kabul kapısından geçemedi (KALDI) — R2'ye YÜKLENMEDİ: kitap 2 açılmadı; kanıt: /k/x";
const OLCULEMEDI = '[ertelenebilir-windows-kasa] windows-kasa kabulü ÖLÇÜLEMEDİ — paket kusuru DEĞİL, yükleme YOK, iş ertelenmeli: rapor gelmedi';

function ortam() {
  const d = tmp('o');
  const yuvaKok = path.join(d, 'yuva');
  fs.mkdirSync(yuvaKok);
  const cfg = {
    ...W.varsayilanAyarlar(), ...B.bekciAyarlari({}), ...K.isciAyarlari({}),
    winHazirKoku: path.join(d, 'windows-hazir'), winKanitDizini: path.join(d, 'kanit'),
    winImzaYuvaKoku: yuvaKok, winImzaYuvaSunucu: '', winYuvaSmbSart: false,
    bekciBildirIkili: path.join(d, 'bildir-yok'),
    winKanonikYukleyici: async () => ({ motorSha12: null, kabukSurum: null }),
  };
  const cagri = { kabul: [], presign: 0, failure: [], release: [], uyku: 0, bildir: 0 };
  const saat = { t: Date.now() };
  const bagimlilik = (ek = {}) => ({
    cfg, log: () => {}, simdi: () => saat.t, sleep: async () => { cagri.uyku += 1; },
    auth: { agentId: 'test', token: 'x' }, aktivasyonBeklenir: () => false,
    presignUpload: async () => { cagri.presign += 1; return { r2ObjectKey: 'k' }; },
    postResultFailure: async (auth, job, mesaj) => { cagri.failure.push({ job, mesaj }); return { ok: true, status: 200 }; },
    releaseJob: async (auth, job, sebep) => { cagri.release.push({ job, sebep }); return true; },
    bekciBildir: async () => { cagri.bildir += 1; },
    kabulKos: async (p) => { cagri.kabul.push(p); return { kapi: 'kasa', kanitDizini: '/kanit/k1' }; },
    // Okuyucu sürümü kapısı (06.10): varsayılan GEÇTİ; kapı testleri kendi ölçümünü verir.
    okuyucuOlc: async (p) => {
      cagri.okuyucu = (cagri.okuyucu || []).concat([p]);
      return { karar: 'GECTI', hamKarar: 'GECTI', olculen: '1.13.14', kanonik: '1.13.14', birimler: [], sebepler: [] };
    },
    ...ek,
  });
  const ekle = async (bookId, { yasMs = 60000 } = {}) => {
    const w = tmp('w');
    const govde = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(3000)]);
    const exe = path.join(w, `runner-${bookId}-T-2.1.1-Setup.exe`);
    fs.writeFileSync(exe, govde);
    const kanit = { bookId, surum: '2.1.1', imzasiz: { md5: md5(govde), sha256: 's', boyut: govde.length }, kapi: { ozet: 'PASS' } };
    const h = await H.hazirKoy({
      exe, job: { bookId, platform: 'windows', bookTitle: `Kitap ${bookId}`, surum: '2.1.1' }, surum: '2.1.1',
      kanit, cfg, durum: H.KABUL_BEKLIYOR,
    });
    await W.kanitYaz(cfg, { ...kanit, durum: H.KABUL_BEKLIYOR, hazirDizini: h.dizin });
    await H.manifestGuncelle(h.dizin, { zaman: new Date(Date.now() - yasMs).toISOString() });
    return { ...h, govde };
  };
  const manifest = (dizin) => JSON.parse(fs.readFileSync(path.join(dizin, 'manifest.json'), 'utf8'));
  const alt = (ad) => (fs.existsSync(path.join(cfg.winHazirKoku, ad)) ? fs.readdirSync(path.join(cfg.winHazirKoku, ad)) : []);
  return { cfg, cagri, bagimlilik, ekle, manifest, alt, ileri: (ms) => { saat.t += ms; } };
}

test('GEÇTİ: kayıt yerinde imza-bekliyor olur (kabulKapi/kanıt), bekçi listesine geçer; failed/release YOK', async () => {
  const o = ortam();
  const k = await o.ekle('201');
  const z = await K.tur(o.bagimlilik());
  assert.equal(z.gecti, 1);
  assert.equal(o.cagri.kabul.length, 1);
  assert.equal(o.cagri.kabul[0].etiket, 'imzasiz');
  assert.equal(o.cagri.kabul[0].exe, k.dizin + path.sep + k.manifest.exe);
  assert.equal(o.cagri.kabul[0].cfg.winKasaKilitBeklemeMs, 120 * 60 * 1000, 'kasa kilidi 120 dk beklenir');
  assert.equal(o.cagri.kabul[0].job.bookId, '201');
  const m = o.manifest(k.dizin);
  assert.equal(m.durum, 'imza-bekliyor');
  assert.equal(m.kabulKapi, 'kasa');
  assert.equal(m.kabulKanit, '/kanit/k1');
  assert.equal(m.kabulIsleniyor, null);
  assert.equal((await H.hazirListesi(o.cfg)).length, 1, 'imza bekçisi artık görür');
  assert.deepEqual(await H.kabulListesi(o.cfg), []);
  const kanit = JSON.parse(fs.readFileSync(W.kanitYolu(o.cfg, '201', '2.1.1'), 'utf8'));
  assert.equal(kanit.kabulImzasiz, 'GECTI');
  assert.equal(kanit.kabulImzasizKapi, 'kasa');
  assert.equal(kanit.durum, 'imza-bekliyor');
  assert.equal(o.cagri.failure.length, 0);
  assert.equal(o.cagri.release.length, 0);
});

test('KALDI: reddedildi/\'ye taşınır, /result failed runner\'ın satır içi KALDI metniyle AYNI; release YOK', async () => {
  const o = ortam();
  await o.ekle('202');
  const z = await K.tur(o.bagimlilik({ kabulKos: async () => { throw new Error(KALDI); } }));
  assert.equal(z.red, 1);
  assert.equal(o.cagri.failure.length, 1);
  assert.equal(o.cagri.failure[0].mesaj, KALDI, 'hata metni aynen (runner ana döngüsü postResultFailure(e.message))');
  assert.equal(o.cagri.failure[0].job.bookId, '202');
  assert.equal(o.cagri.release.length, 0);
  assert.equal(o.cagri.bildir, 1, 'bekçi bildirimi (runner şeridi düştü bildirimiyle aynı)');
  assert.equal(o.alt('reddedildi').length, 1);
  assert.deepEqual(await H.kabulListesi(o.cfg), []);
  assert.deepEqual(await H.hazirListesi(o.cfg), [], 'kusurlu paket imzaya gitmez');
});

test('ÖLÇÜLEMEDİ ×3: 1. ve 2. denemede kayıt yerinde (kabulDeneme), 3. denemede release (durumsuz) + olculemedi/', async () => {
  const o = ortam();
  const k = await o.ekle('203');
  const d = o.bagimlilik({ kabulKos: async () => { throw new Error(OLCULEMEDI); } });
  let z = await K.tur(d);
  assert.equal(z.olculemedi, 1);
  assert.equal(o.manifest(k.dizin).kabulDeneme, 1);
  assert.equal(o.manifest(k.dizin).durum, 'kabul-bekliyor');
  z = await K.tur(d);
  assert.equal(z.atlandi, 1, '10 dk bekleme dolmadan yeniden denenmez');
  assert.equal(o.cagri.kabul.length, 0, 'kabulKos sahte değil — sayaç yok; deneme sayısı manifestte');
  o.ileri(10 * 60 * 1000 + 1);
  z = await K.tur(d);
  assert.equal(o.manifest(k.dizin).kabulDeneme, 2);
  assert.equal(o.cagri.release.length, 0);
  o.ileri(10 * 60 * 1000 + 1);
  z = await K.tur(d);
  assert.equal(z.atlandi, 1, '2. denemeden sonra bekleme 20 dk');
  o.ileri(10 * 60 * 1000);
  z = await K.tur(d);
  assert.equal(z.birakildi, 1);
  assert.equal(o.cagri.release.length, 1);
  assert.match(o.cagri.release[0].sebep, /^\[kabul-kuyrugu\] imzasız kabul 3 denemede ölçülemedi/);
  assert.equal(o.cagri.failure.length, 0, 'ölçülemedi paket kusuru DEĞİL — failed yazılmaz');
  const ol = o.alt('olculemedi');
  assert.equal(ol.length, 1, 'silinmedi, olculemedi/\'ye taşındı');
  const m = JSON.parse(fs.readFileSync(path.join(o.cfg.winHazirKoku, 'olculemedi', ol[0], 'manifest.json'), 'utf8'));
  assert.equal(m.durum, 'olculemedi');
  assert.equal(m.kabulDeneme, 3);
  assert.deepEqual(await H.kabulListesi(o.cfg), []);
  assert.equal(await H.hazirBul(o.cfg, '203', '2.1.1'), null, 'yeniden kiralamada yeniden üretilir');
});

test('presign 409 (kira bu ajanda değil): kabul KOŞMAZ, kayıt dokunulmadan kalır', async () => {
  const o = ortam();
  const k = await o.ekle('204');
  const z = await K.tur(o.bagimlilik({ presignUpload: async () => { throw new Error('presign failed: HTTP 409 {"error":"lease_not_held"}'); } }));
  assert.equal(z.atlandi, 1);
  assert.equal(o.cagri.kabul.length, 0);
  assert.equal(o.manifest(k.dizin).durum, 'kabul-bekliyor');
  assert.equal(o.manifest(k.dizin).kabulDeneme, undefined);
  assert.equal(o.cagri.failure.length + o.cagri.release.length, 0);
});

test('kayıt kilidi dolu (runner/bekçi kayıtta): sunucuya bile sorulmaz, kabul yok', async () => {
  const o = ortam();
  const k = await o.ekle('205');
  const birak = await H.kayitKilidiDene(k.dizin);
  try {
    const z = await K.tur(o.bagimlilik());
    assert.equal(z.atlandi, 1);
    assert.equal(o.cagri.presign, 0);
    assert.equal(o.cagri.kabul.length, 0);
  } finally { await birak(); }
});

test('kabul sürerken kayıt "işleniyor" sayılır (üretim kapısı onu saymaz); bitince iz temizlenir', async () => {
  const o = ortam();
  const k = await o.ekle('206');
  let ici = null;
  await K.tur(o.bagimlilik({ kabulKos: async () => { ici = await H.kabulListesi(o.cfg); return { kapi: 'kasa' }; } }));
  assert.equal(ici.length, 1);
  assert.equal(ici[0].isleniyor, true);
  assert.equal(o.manifest(k.dizin).kabulIsleniyor, null);
});

test('en eski önce: iki kayıt sırayla kabul edilir', async () => {
  const o = ortam();
  await o.ekle('301', { yasMs: 1000 });
  await o.ekle('302', { yasMs: 90000 });
  await K.tur(o.bagimlilik());
  assert.deepEqual(o.cagri.kabul.map((p) => p.job.bookId), ['302', '301']);
});

test('tekil kilit: başka işçi koşuyorsa döngü hemen çıkar, kayda dokunmaz', async () => {
  const o = ortam();
  await o.ekle('207');
  fs.mkdirSync(o.cfg.winHazirKoku, { recursive: true });
  const t = await W.kilitDene(path.join(o.cfg.winHazirKoku, K.TEKIL_KILIT));
  assert.ok(t.tutucu);
  try {
    const s = await K.dongu(o.bagimlilik({ dur: () => false }));
    assert.deepEqual(s, { atlandi: 'tekil-kilit' });
    assert.equal(o.cagri.kabul.length, 0);
  } finally { await W.kilitBirak(t.tutucu); }
});

test('döngü: ilerleme yoksa uyur; kuyruk boş + ömür dolunca temiz çıkar; bayraktan bağımsız boşaltır', async () => {
  const o = ortam();
  o.cfg.winKabulKuyrugu = false; // bayrak kapalı: işçi yine boşaltır
  await o.ekle('208');
  let n = 0;
  const s = await K.dongu(o.bagimlilik({ dur: (tur) => tur >= 3, simdi: () => (n += 1) }));
  assert.equal(s.cikis, 'dur');
  assert.equal(o.cagri.kabul.length, 1, 'kayıt bayrak kapalıyken de kabul edildi');
  assert.equal(o.cagri.uyku, 2, '1. tur ilerledi (uyku yok), 2. ve 3. tur boş (uyku)');
  const o2 = ortam();
  o2.cfg.isciOmurMs = 10;
  let t = 0;
  const s2 = await K.dongu(o2.bagimlilik({ dur: () => false, simdi: () => (t += 100) }));
  assert.equal(s2.cikis, 'omur');
});

test('isciAyarlari: varsayılanlar (120 dk kilit, 60 sn uyku, 3 deneme, 6 sa ömür); env ile değişir', () => {
  const v = K.isciAyarlari({});
  assert.equal(v.isciKasaKilitBeklemeMs, 120 * 60 * 1000);
  assert.equal(v.isciUykuMs, 60000);
  assert.equal(v.isciAzamiDeneme, 3);
  assert.equal(v.isciOmurMs, 6 * 3600 * 1000);
  assert.equal(K.isciAyarlari({ EMPP_KABUL_ISCI_DENEME: '5' }).isciAzamiDeneme, 5);
  assert.equal(K.isciAyarlari({ EMPP_KABUL_ISCI_KILIT_DK: 'x' }).isciKasaKilitBeklemeMs, 120 * 60 * 1000);
});

test('uçtan uca: işçi GEÇTİ → imza bekçisi tur() kaydı alır, sahte imza zinciriyle İMZALI kopyayı yayınlar', async () => {
  const o = ortam();
  const k = await o.ekle('209');
  // 1. Bekçi işçiden ÖNCE: kabulsüz kayıt bekçiye görünmez.
  const yayin = [];
  const bekciD = {
    cfg: o.cfg, log: () => {}, simdi: () => Date.now(), sleep: async () => {}, kuru: false,
    auth: { agentId: 'test', token: 'x' }, aktivasyonBeklenir: () => false,
    komutKos: async (argv, op) => (argv[0] === 'ping' ? { kod: 0, cikti: '' } : W.komutKos(argv, op)),
    presignUpload: async () => ({ r2ObjectKey: 'k' }),
    imzaliYayinZinciri: async ({ imzasiz, kanit, work }) => {
      assert.equal(kanit.kabulImzasiz, 'GECTI', 'bekçi işçinin kabul kanıtını okudu');
      const imzali = path.join(work, 'imzali.exe');
      fs.writeFileSync(imzali, Buffer.concat([fs.readFileSync(imzasiz), Buffer.from('IMZA')]));
      kanit.imzali = { md5: md5(fs.readFileSync(imzali)) };
      return { imzaliYol: imzali, kanit, kanitYolu: null };
    },
    postResultSuccess: async (auth, job, dosya) => {
      yayin.push({ job, md5: md5(fs.readFileSync(dosya)) });
      return { r2ObjectKey: `softwares/${job.bookId}/x.exe`, publicUrl: 'https://cdn/x.exe' };
    },
  };
  const z0 = await B.tur(bekciD);
  assert.equal(z0.bekleyen, 0, 'kabul-bekliyor kayıt bekçiye görünmez');
  assert.equal(yayin.length, 0);
  // 2. İşçi GEÇTİ.
  await K.tur(o.bagimlilik());
  // 3. Bekçi kaydı alır ve imzalı kopyayı yayınlar.
  const z1 = await B.tur(bekciD);
  assert.equal(z1.yayinlanan, 1);
  assert.equal(yayin.length, 1);
  assert.equal(yayin[0].md5, md5(Buffer.concat([k.govde, Buffer.from('IMZA')])), 'yüklenen = imzalı kopya');
  assert.notEqual(yayin[0].md5, md5(k.govde));
  assert.equal(o.alt('yayinlandi').length, 1);
  assert.deepEqual(await H.kabulListesi(o.cfg), []);
});

// ---------------------------------------------------------------------------
// İnceleme düzeltmeleri (05.10): K1 önce bildir sonra taşı · K2 kilit altında taze manifest ·
// Ö3 açılıştan eski pid izi · Ö4 yaş alarmı · Ö5 kasa meşgul sayılmaz.
// ---------------------------------------------------------------------------
const BASARISIZ_SONUC = [
  ['409', async () => ({ ok: false, status: 409 })],
  ['5xx', async () => ({ ok: false, status: 502 })],
  ['ağ hatası', async () => ({ ok: false, status: null })],
];

for (const [ad, yanit] of BASARISIZ_SONUC) {
  test(`K1 KALDI + /result ${ad}: kayıt YERİNDE (bekleyenSonuc), sonraki turda kabul koşmadan bildirim + taşıma`, async () => {
    const o = ortam();
    const k = await o.ekle('401');
    let kabulSayisi = 0;
    const kaldi = async () => { kabulSayisi += 1; throw new Error(KALDI); };
    const z1 = await K.tur(o.bagimlilik({ kabulKos: kaldi, postResultFailure: yanit }));
    assert.equal(z1.hata, 1);
    assert.equal(o.alt('reddedildi').length, 0, 'bildirim düştü → taşınmadı');
    const m = o.manifest(k.dizin);
    assert.equal(m.durum, 'kabul-bekliyor');
    assert.equal(m.bekleyenSonuc.tur, 'red');
    assert.equal(m.bekleyenSonuc.mesaj, KALDI);
    assert.equal(m.kabulIsleniyor, null);
    assert.match(m.sonHata, /sunucu bildirimi başarısız/);
    assert.equal(o.cagri.bildir, 0, 'bekçi bildirimi taşımadan sonra');
    const z2 = await K.tur(o.bagimlilik({ kabulKos: kaldi }));
    assert.equal(z2.red, 1);
    assert.equal(kabulSayisi, 1, 'ikinci turda kabul YENİDEN KOŞMADI');
    assert.equal(o.cagri.failure.length, 1);
    assert.equal(o.cagri.failure[0].mesaj, KALDI);
    assert.equal(o.alt('reddedildi').length, 1);
    assert.equal(o.cagri.bildir, 1);
    const r = JSON.parse(fs.readFileSync(path.join(o.cfg.winHazirKoku, 'reddedildi', o.alt('reddedildi')[0], 'manifest.json'), 'utf8'));
    assert.equal(r.durum, 'red');
    assert.equal(r.bekleyenSonuc, null);
  });
}

test('K1 ÖLÇÜLEMEDİ 3. deneme + /release düştü: kayıt yerinde; sonraki turda release + olculemedi/', async () => {
  const o = ortam();
  const k = await o.ekle('402');
  await H.manifestGuncelle(k.dizin, { kabulDeneme: 2 });
  let kabulSayisi = 0;
  const olc = async () => { kabulSayisi += 1; throw new Error(OLCULEMEDI); };
  const z1 = await K.tur(o.bagimlilik({ kabulKos: olc, releaseJob: async () => false }));
  assert.equal(z1.hata, 1);
  assert.equal(o.alt('olculemedi').length, 0);
  assert.equal(o.manifest(k.dizin).bekleyenSonuc.tur, 'birakildi');
  const z2 = await K.tur(o.bagimlilik({ kabulKos: olc }));
  assert.equal(z2.birakildi, 1);
  assert.equal(kabulSayisi, 1);
  assert.equal(o.cagri.release.length, 1);
  assert.match(o.cagri.release[0].sebep, /3 denemede ölçülemedi/);
  assert.equal(o.alt('olculemedi').length, 1);
});

test('K1 bayat + /result düştü: kayıt yerinde; sonraki turda bildirim + bayat/', async () => {
  const o = ortam();
  const k = await o.ekle('403');
  await H.manifestGuncelle(k.dizin, { job: { ...k.manifest.job, kaynakSurumu: '2.0.7' } });
  const bayatD = (ek) => o.bagimlilik({ gecerliKaynakSurumu: async () => '2.0.11', ...ek });
  const z1 = await K.tur(bayatD({ postResultFailure: async () => ({ ok: false, status: 503 }) }));
  assert.equal(z1.hata, 1);
  assert.equal(o.alt('bayat').length, 0);
  const z2 = await K.tur(bayatD({}));
  assert.equal(z2.bayat, 1);
  assert.equal(o.alt('bayat').length, 1);
  assert.match(o.cagri.failure[0].mesaj, /^\[imza-bekliyor\] \[kabul-kuyrugu\] hazır kayıt bayat \(kayıt 2\.0\.7, geçerli 2\.0\.11\)/);
  assert.equal(o.cagri.kabul.length, 0);
});

test('K2: liste ile kilit arasında kayıt bayata taşınıp YENİDEN üretildi → yeni manifest kullanılır, eski sha/md5 yazılmaz', async () => {
  const o = ortam();
  await o.ekle('404');
  const [eski] = await H.kabulListesi(o.cfg);
  // Kilit alınmadan önce: kayıt bayat/'a gider, aynı anahtarla yeni paket üretilir.
  await H.sonuclandir(o.cfg, eski, 'bayat', { durum: 'bayat' });
  const yeni = await o.ekle('404');
  assert.notEqual(yeni.manifest.md5, eski.manifest.md5);
  const r = await K.kaydiIsle(eski, o.bagimlilik({ kabulKos: async () => { throw new Error(KALDI); } }));
  assert.equal(r.durum, 'red');
  const red = JSON.parse(fs.readFileSync(path.join(r.dizin, 'manifest.json'), 'utf8'));
  assert.equal(red.md5, yeni.manifest.md5, 'reddedilen manifest yeni paketin');
  assert.equal(red.sha256, yeni.manifest.sha256);
  assert.equal(md5(fs.readFileSync(path.join(r.dizin, red.exe))), md5(yeni.govde));
});

test('K2: liste ile kilit arasında kayıt imza-bekliyor oldu (başka yol kabul etti) → atlanır, kabul koşmaz', async () => {
  const o = ortam();
  const k = await o.ekle('405');
  const [eski] = await H.kabulListesi(o.cfg);
  await H.manifestGuncelle(k.dizin, { durum: H.IMZA_BEKLIYOR_FAZI });
  const r = await K.kaydiIsle(eski, o.bagimlilik());
  assert.equal(r.durum, 'atlandi');
  assert.equal(o.cagri.kabul.length, 0);
  assert.equal(o.cagri.presign, 0);
  assert.equal(o.manifest(k.dizin).durum, 'imza-bekliyor', 'eski kopya yazılmadı');
});

test('Ö5: kasa meşgul (kabul kilidi boşalmadı) deneme SAYILMAZ ve bekleme koymaz', async () => {
  const o = ortam();
  const k = await o.ekle('406');
  const mesgul = '[ertelenebilir-windows-kasa] yerel kabul kilidi 120 dk boşalmadı — paket kusuru DEĞİL, iş ertelenmeli';
  assert.equal(K.kasaMesgulMu(new Error(mesgul)), true);
  assert.equal(K.kasaMesgulMu(new Error(OLCULEMEDI)), false);
  for (let i = 0; i < 4; i += 1) await K.tur(o.bagimlilik({ kabulKos: async () => { throw new Error(mesgul); } }));
  const m = o.manifest(k.dizin);
  assert.equal(m.kabulDeneme, undefined);
  assert.equal(m.sonrakiDeneme, undefined);
  assert.equal(m.durum, 'kabul-bekliyor');
  assert.equal(o.cagri.release.length, 0);
});

test('Ö4: en eski kabul-bekliyor 2 saati aşınca bildirim; 3 saat içinde tekrar yok; bildir yoksa uyarı logu', async () => {
  const o = ortam();
  const gunluk = path.join(tmp('b'), 'g.txt');
  const bildir = path.join(path.dirname(gunluk), 'bildir');
  fs.writeFileSync(bildir, `#!/bin/bash\nprintf 'bildir %s\\n' "$*" >> ${JSON.stringify(gunluk)}\n`, { mode: 0o755 });
  o.cfg.bekciBildirIkili = bildir;
  await o.ekle('407', { yasMs: 60 * 60 * 1000 });
  const d = o.bagimlilik({ kabulKos: async () => { throw new Error('[ertelenebilir-windows-kasa] yerel kabul kilidi açılamadı'); } });
  assert.equal(await K.yasAlarmi(d), null, '1 sa → sus');
  o.ileri(61 * 60 * 1000);
  assert.match(await K.yasAlarmi(d), /^1 Windows paketi kabul bekliyor: en eski 121 dk/);
  assert.match(fs.readFileSync(gunluk, 'utf8'), /^bildir paket 1 Windows paketi kabul bekliyor: .* -p yuksek$/m);
  o.ileri(60 * 60 * 1000);
  assert.equal(await K.yasAlarmi(d), null, '3 saat dolmadan tekrar yok');
  const o2 = ortam();
  await o2.ekle('408', { yasMs: 3 * 3600 * 1000 });
  const loglar = [];
  assert.ok(await K.yasAlarmi(o2.bagimlilik({ log: (s) => loglar.push(s) })));
  assert.match(loglar.join('\n'), /UYARI 1 Windows paketi kabul bekliyor/);
});

test('Ö3: açılıştan ESKİ kabulIsleniyor izi pid yaşasa da bayat (işleniyor sayılmaz); açılıştan yeni iz işleniyor', async () => {
  const o = ortam();
  const k = await o.ekle('409');
  const acilisMs = Date.parse('2026-10-05T09:00:00Z');
  await H.manifestGuncelle(k.dizin, { kabulIsleniyor: { pid: process.pid, zaman: '2026-10-05T08:00:00Z' } });
  assert.equal((await H.kabulListesi(o.cfg, { acilisMs }))[0].isleniyor, false, 'yeniden başlatma öncesi iz');
  await H.manifestGuncelle(k.dizin, { kabulIsleniyor: { pid: process.pid, zaman: '2026-10-05T10:00:00Z' } });
  assert.equal((await H.kabulListesi(o.cfg, { acilisMs }))[0].isleniyor, true);
});

test('Ö3: dosyaKilidiDene (win32 kilidi) açılıştan ESKİ kilidi pid yaşasa da devralır; yeni kilit doluysa 75', async () => {
  const d = tmp('kilit');
  const yol = path.join(d, 'k.kilit');
  const acilisMs = Date.now() - 3600 * 1000;
  fs.writeFileSync(yol, JSON.stringify({ pid: process.pid, zaman: new Date(acilisMs - 3600 * 1000).toISOString() }));
  const r = await W.dosyaKilidiDene(yol, { pidYasiyor: () => true, acilisMs });
  assert.ok(r.tutucu, 'açılış öncesi kilit bayat → alındı');
  const r2 = await W.dosyaKilidiDene(yol, { pidYasiyor: () => true, acilisMs });
  assert.equal(r2.kod, 75, 'bu açılışta alınan kilit dolu');
  assert.ok(Math.abs(W.acilisZamaniMs() - (Date.now() - os.uptime() * 1000)) < 5000);
});

// ---------------------------------------------------------------------------
// OKUYUCU SÜRÜMÜ KAPISI (06.10, A1 olayı): manifest damgası kanıt DEĞİL — exe'deki okuyucu kabuğu ÖLÇÜLÜR.
// RED → bayat (kabul.py hiç koşmaz) · ÖLÇÜLEMEDİ → deneme sayılır (paket suçlanmaz) · uyar → geçer.
// ---------------------------------------------------------------------------
const F = require('../kabul/fikstur/okuyucu-paket');

test('okuyucu RED: kabul.py KOŞMAZ, kayıt bayat/\'a, /result failed "okuyucu 1.12.7 ≠ kanonik 1.13.14"', async () => {
  const o = ortam();
  const k = await o.ekle('501');
  const olc = async (p) => {
    o.cagri.okuyucu = (o.cagri.okuyucu || []).concat([p]);
    return { karar: 'RED', hamKarar: 'RED', olculen: '1.12.7', kanonik: '1.13.14', birimler: [],
      sebepler: ['kapak/index.html: okuyucu 1.12.7 < kanonik 1.13.14'] };
  };
  const z = await K.tur(o.bagimlilik({ okuyucuOlc: olc }));
  assert.equal(z.bayat, 1, JSON.stringify(z));
  assert.equal(o.cagri.kabul.length, 0, 'bayat pakete kabul harcanmaz');
  assert.equal(o.cagri.okuyucu.length, 1);
  assert.equal(o.cagri.okuyucu[0].paket, k.dizin + path.sep + k.manifest.exe);
  assert.equal(o.cagri.okuyucu[0].platform, 'windows');
  assert.match(o.cagri.okuyucu[0].calisma, /kabul-iscisi-[^/\\]+[/\\]okuyucu$/);
  assert.equal(o.cagri.failure.length, 1);
  assert.match(o.cagri.failure[0].mesaj, /^\[imza-bekliyor\] \[kabul-kuyrugu\] hazır kayıt bayat \(okuyucu 1\.12\.7 ≠ kanonik 1\.13\.14: kapak\/index\.html/);
  assert.equal(o.cagri.release.length, 0);
  assert.equal(o.alt('bayat').length, 1);
  const m = JSON.parse(fs.readFileSync(path.join(o.cfg.winHazirKoku, 'bayat', o.alt('bayat')[0], 'manifest.json'), 'utf8'));
  assert.equal(m.durum, 'bayat');
  assert.equal(m.sebep, 'okuyucu-surumu: okuyucu 1.12.7 ≠ kanonik 1.13.14');
  assert.equal(m.okuyucuSurumu.olculen, '1.12.7');
  assert.equal(m.kabulIsleniyor, null);
});

test('okuyucu ÖLÇÜLEMEDİ: paket suçlanmaz — deneme sayılır, kabul.py koşmaz, bayat/failed YOK; 3. denemede release', async () => {
  const o = ortam();
  const k = await o.ekle('502');
  const olc = async () => ({ karar: 'OLCULEMEDI', hamKarar: 'OLCULEMEDI', olculen: null, kanonik: '1.13.14', birimler: [],
    sebepler: ['paket açılamadı: 7z yok — NSIS açılamadı'] });
  const z = await K.tur(o.bagimlilik({ okuyucuOlc: olc }));
  assert.equal(z.olculemedi, 1, JSON.stringify(z));
  assert.equal(o.cagri.kabul.length, 0);
  assert.equal(o.cagri.failure.length, 0);
  assert.equal(o.alt('bayat').length, 0);
  const m = o.manifest(k.dizin);
  assert.equal(m.kabulDeneme, 1);
  assert.match(m.sonHata, /^\[okuyucu-surumu\] okuyucu sürümü ÖLÇÜLEMEDİ: paket açılamadı: 7z yok/);
  // ölçüm fırlatırsa (beklenmeyen) da aynı yol
  o.ileri(60 * 60 * 1000);
  await K.tur(o.bagimlilik({ okuyucuOlc: async () => { throw new Error('ENOSPC'); } }));
  assert.equal(o.manifest(k.dizin).kabulDeneme, 2);
  o.ileri(60 * 60 * 1000);
  const z3 = await K.tur(o.bagimlilik({ okuyucuOlc: olc }));
  assert.equal(z3.birakildi, 1);
  assert.equal(o.cagri.release.length, 1);
  assert.equal(o.cagri.failure.length, 0, 'failed yazılmaz');
});

test('okuyucu UÇTAN UCA (gerçek paketOlc + 7z, NSIS benzeri exe): damga "guncel" ama okuyucu 1.12.7 → bayat; '
  + 'KABUL_OKUYUCU_SURUM=uyar → kabul.py koşar', { skip: !F.yediz() && '7z yok' }, async () => {
  const agac = F.a1Agaci('1.12.7');
  const d = F.gecici('ki-nsis');
  try {
    const exe = await F.nsisYap(agac, d);
    const govde = fs.readFileSync(exe);
    const kur = async (o, id) => {
      const k = await o.ekle(id);
      fs.copyFileSync(exe, k.dizin + path.sep + k.manifest.exe);
      // A1 olayındaki gibi: manifest damgası "güncel" diyor (kanıt değil)
      await H.manifestGuncelle(k.dizin, { kanonik: { motorDurum: 'guncel', kabukDurum: 'guncel', kabukSurum: '1.13.14' },
        md5: md5(govde), boyut: govde.length });
      o.cfg.winKanonikYukleyici = async () => ({ motorSha12: null, kabukSurum: '1.13.14' });
      return k;
    };
    const o = ortam();
    await kur(o, '503');
    const z = await K.tur(o.bagimlilik({ okuyucuOlc: undefined, env: { KABUL_OKUYUCU_SURUM: '' } }));
    assert.equal(z.bayat, 1, JSON.stringify(z));
    assert.equal(o.cagri.kabul.length, 0);
    assert.match(o.cagri.failure[0].mesaj, /okuyucu 1\.12\.7 ≠ kanonik 1\.13\.14/);
    const o2 = ortam();
    await kur(o2, '504');
    const loglar = [];
    const z2 = await K.tur(o2.bagimlilik({ okuyucuOlc: undefined, env: { KABUL_OKUYUCU_SURUM: 'uyar' }, log: (s) => loglar.push(s) }));
    assert.equal(z2.gecti, 1, JSON.stringify(z2) + loglar.join('\n'));
    assert.equal(o2.cagri.kabul.length, 1);
    assert.match(loglar.join('\n'), /okuyucu sürümü: GEÇTİ — ölçülen 1\.12\.7, kanonik 1\.13\.14 .*KABUL_OKUYUCU_SURUM=uyar/);
  } finally { F.temizle(agac, d); }
});
