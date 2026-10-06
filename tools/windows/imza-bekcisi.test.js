'use strict';

/**
 * İmza bekçisi (sözleşme exesiz-kaynak §2a, 02.10) — tek tur, bağımlılıklar sahte.
 * Gerçek İmpark ağına (ping), sudo'ya, imza yuvasına, sunucuya ve R2'ye DOKUNULMAZ:
 * ping/sudo komutları sahte komutKos'ta cevaplanır, disk betiği ve bildir sahte betiktir.
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

const B = require('./imza-bekcisi');
const H = require('../../src/agent/windows-hazir');
const W = require('../../src/agent/windows-serit');

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `bekci-${ad}-`));
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const SAAT = 3600 * 1000;

/** Ortam: hazır kök + (isteğe bağlı) yuva + sahte disk betiği + sahte bildir. */
function ortam({ yuva = false, ping = false, sudo = false, diskYuvaKurar = true } = {}) {
  const d = tmp('o');
  const yuvaKok = path.join(d, 'yuva');
  if (yuva) fs.mkdirSync(yuvaKok);
  const gunluk = path.join(d, 'gunluk.txt');
  const yaz = (ad, govde) => { const p = path.join(d, ad); fs.writeFileSync(p, govde, { mode: 0o755 }); return p; };
  const disk = yaz('disk.sh', `#!/bin/bash\necho "disk $*" >> ${JSON.stringify(gunluk)}\n${diskYuvaKurar ? `mkdir -p ${JSON.stringify(yuvaKok)}\n` : ''}exit 0\n`);
  const bildir = yaz('bildir', `#!/bin/bash\nprintf 'bildir %s\\n' "$*" >> ${JSON.stringify(gunluk)}\n`);
  const cfg = {
    ...W.varsayilanAyarlar(), ...B.bekciAyarlari({}),
    winHazirKoku: path.join(d, 'windows-hazir'), winImzaYuvaKoku: yuvaKok, winImzaYuvaSunucu: '', winYuvaSmbSart: false, // sahte YEREL yuva (04.10 df kanıtı testte kapalı)
    winKanitDizini: path.join(d, 'kanit'), bekciDiskBetigi: disk, bekciBildirIkili: bildir,
    imzaliArsivKoku: null, // kasada (win32) testler gerçek D:\empp-imzali-son'a yazmasın; ölçen test açar
  };
  const cagri = { ping: 0, sudo: 0, zincir: [], yayin: [], presign: 0 };
  const komutKos = async (argv, o) => {
    if (argv[0] === 'ping') { cagri.ping += 1; return { kod: ping ? 0 : 2, cikti: '' }; }
    if (argv[0] === 'sudo') { cagri.sudo += 1; return { kod: sudo ? 0 : 1, cikti: '' }; }
    return W.komutKos(argv, o);
  };
  let simdi = Date.parse('2026-10-02T12:00:00Z');
  const oku = () => (fs.existsSync(gunluk) ? fs.readFileSync(gunluk, 'utf8') : '');
  const bagimlilik = (ek = {}) => ({
    cfg, log: () => {}, komutKos, simdi: () => simdi, sleep: async () => {}, kuru: false,
    auth: { agentId: 'test', token: 'x' }, aktivasyonBeklenir: () => false,
    presignUpload: async () => { cagri.presign += 1; return { r2ObjectKey: 'k' }; },
    imzaliYayinZinciri: async ({ imzasiz, kanit, work }) => {
      cagri.zincir.push(path.basename(imzasiz));
      const imzali = path.join(work, 'imzali.exe');
      fs.writeFileSync(imzali, Buffer.concat([fs.readFileSync(imzasiz), Buffer.from('IMZA')]));
      kanit.imzali = { md5: md5(fs.readFileSync(imzali)) };
      return { imzaliYol: imzali, kanit, kanitYolu: null };
    },
    postResultSuccess: async (auth, job, dosya) => {
      cagri.yayin.push({ job, dosya, md5: md5(fs.readFileSync(dosya)) });
      return { r2ObjectKey: `softwares/${job.bookId}/x.exe`, publicUrl: 'https://cdn/x.exe' };
    },
    ...ek,
  });
  const ekle = async (bookId, { yasMs = 60000, kanonikSurum = null, icerikUyeleri = null } = {}) => {
    const w = tmp('w');
    const govde = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(3000)]);
    const exe = path.join(w, `runner-${bookId}-T-2.1.1-Setup.exe`);
    fs.writeFileSync(exe, govde);
    const h = await H.hazirKoy({
      exe, job: { bookId, platform: 'windows', bookTitle: `Kitap ${bookId}`, surum: '2.1.1', ...(kanonikSurum ? { kanonikSurum } : {}), ...(icerikUyeleri ? { icerikUyeleri } : {}) }, surum: '2.1.1',
      kanit: { imzasiz: { md5: md5(govde), sha256: 's', boyut: govde.length } }, cfg, kabul: { kapi: 'kasa' },
    });
    await H.manifestGuncelle(h.dizin, { zaman: new Date(simdi - yasMs).toISOString() });
    return { ...h, govde };
  };
  return { cfg, cagri, oku, bagimlilik, ekle, ileri: (ms) => { simdi += ms; } };
}

test('saf: kabulKaldiMi yalnız paket kusurunda; ölçülemedi/imza/ağ değil. kiraBizdeDegilMi 409', () => {
  assert.equal(B.kabulKaldiMi(new Error("windows paketi windows-kasa kabul kapısından geçemedi (KALDI) — R2'ye YÜKLENMEDİ")), true);
  assert.equal(B.kabulKaldiMi(new Error('windows paketi başsız kabul kapısından geçemedi (RED) — R2')), true);
  assert.equal(B.kabulKaldiMi(new Error('[ertelenebilir-windows-kasa] windows-kasa kabulü ÖLÇÜLEMEDİ')), false);
  assert.equal(B.kabulKaldiMi(new Error('[windows-serit] imza zaman aşımı')), false);
  assert.equal(B.kiraBizdeDegilMi(new Error('presign failed: HTTP 409 {"error":"lease_not_held"}')), true);
  assert.equal(B.kiraBizdeDegilMi(new Error('presign failed: HTTP 502')), false);
});

test('bekleyen yoksa hiçbir şeye dokunmaz (ping yok, disk yok, bildirim yok)', async () => {
  const o = ortam();
  const z = await B.tur(o.bagimlilik());
  assert.equal(z.bekleyen, 0);
  assert.equal(o.cagri.ping, 0);
  assert.equal(o.oku(), '');
  assert.equal(fs.existsSync(o.cfg.winHazirKoku), false, 'bekleyen yokken hazır kökü bile açılmaz');
});

test('yuva kapalı + VPN kapalı + parolasız sudo yok → VPN açılmaz, disk betiği koşmaz, bildirim (3 saatte bir)', async () => {
  const o = ortam({ ping: false, sudo: false });
  await o.ekle('101');
  const z = await B.tur(o.bagimlilik());
  assert.equal(z.yuva, false);
  assert.equal(z.disk.denendi, false);
  assert.match(z.disk.sebep, /parolasız sudo kuralı yok/);
  assert.equal(o.cagri.sudo, 1);
  assert.doesNotMatch(o.oku(), /^disk /m, 'parola penceresi açabilecek betik koşmadı');
  assert.match(o.oku(), /^bildir paket 1 Windows paketi imza bekliyor: imza yuvası erişilemiyor — İmpark VPN kapalı .* -p yuksek$/m);
  o.ileri(SAAT);
  await B.tur(o.bagimlilik());
  assert.equal(o.oku().split('\n').filter((s) => s.startsWith('bildir')).length, 1, '3 saat dolmadan aynı sebep yeniden bildirilmez');
  o.ileri(2 * SAAT + 1000);
  await B.tur(o.bagimlilik());
  assert.equal(o.oku().split('\n').filter((s) => s.startsWith('bildir')).length, 2, '3 saat sonra yeniden');
  assert.equal(o.cagri.zincir.length, 0);
  assert.equal(o.cagri.yayin.length, 0);
  assert.equal((await H.hazirListesi(o.cfg)).length, 1, 'kayıt yerinde');
});

test('yuva kapalı + VPN AYAKTA → yalnız disk bağlanır (--sessiz), yuva açılınca imzala → yayınla → yayinlandi/', async () => {
  const o = ortam({ ping: true });
  const k = await o.ekle('102');
  const z = await B.tur(o.bagimlilik());
  assert.match(o.oku(), /^disk --sessiz$/m);
  assert.equal(o.cagri.sudo, 0, 'VPN ayaktayken sudo/VPN denenmez');
  assert.equal(z.yuva, true);
  assert.equal(z.yayinlanan, 1);
  assert.equal(o.cagri.yayin.length, 1);
  assert.notEqual(o.cagri.yayin[0].md5, md5(k.govde), 'İMZASIZ paket yüklenmedi');
  assert.equal(o.cagri.yayin[0].md5, md5(Buffer.concat([k.govde, Buffer.from('IMZA')])), 'yüklenen = imzalı kopya');
  assert.equal(o.cagri.yayin[0].job.bookId, '102');
  assert.equal(o.cagri.yayin[0].job.platform, 'windows');
  assert.equal((await H.hazirListesi(o.cfg)).length, 0);
  const y = fs.readdirSync(path.join(o.cfg.winHazirKoku, 'yayinlandi'));
  assert.equal(y.length, 1);
  const m = JSON.parse(fs.readFileSync(path.join(o.cfg.winHazirKoku, 'yayinlandi', y[0], 'manifest.json'), 'utf8'));
  assert.equal(m.durum, 'yayinlandi');
  assert.equal(m.yayin.yayinlayan, 'imza-bekcisi');
  // 06.10: yayın sonrası BAŞARI bildirimi (kanal paket, normal öncelik); sorun bildirimi (yüksek) YOK.
  assert.match(o.oku(), /^bildir paket 102 Kitap 102 — \d+ MB, imzalı, kabulden geçti, yayınlandı -b ✅ windows yayınlandı -p normal -e white_check_mark$/m);
  assert.doesNotMatch(o.oku(), /-p yuksek/, 'sorun bildirimi yok');
});

test('yayinMesaji: kitap adı varsa bookId + ad + MB; yoksa yalnız bookId', () => {
  assert.equal(B.yayinMesaji({ bookId: '71717', boyut: 644e6 }, { bookTitle: 'Lingoland 3' }),
    '71717 Lingoland 3 — 644 MB, imzalı, kabulden geçti, yayınlandı');
  assert.equal(B.yayinMesaji({ bookId: '71717' }, {}), '71717 — imzalı, kabulden geçti, yayınlandı');
});

test('yayinBildir: bildir komutu hata verse de fırlatmaz; .cmd ikilisi powershell -File ile çağrılır', async () => {
  const komutlar = [];
  const dizin = tmp('yb');
  const cmd = path.join(dizin, 'bildir.cmd');
  fs.writeFileSync(cmd, '@echo off\r\n');
  fs.writeFileSync(path.join(dizin, 'bildir.ps1'), '');
  const d = { cfg: { bekciBildirIkili: cmd }, log: () => {}, komutKos: async (argv) => { komutlar.push(argv); return { kod: 1 }; } };
  await B.yayinBildir(d, { bookId: '9', boyut: 5e6 }, { bookTitle: 'Çalışma Kitabı' });
  assert.equal(komutlar.length, 1);
  assert.deepEqual(komutlar[0].slice(0, 5), ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File']);
  assert.equal(komutlar[0][5], path.join(dizin, 'bildir.ps1'));
  assert.deepEqual(komutlar[0].slice(6, 8), ['paket', '9 Çalışma Kitabı — 5 MB, imzalı, kabulden geçti, yayınlandı']);
  assert.ok(komutlar[0].includes('✅ windows yayınlandı'));
});

test('hazır kayıttaki kanonik damga /result işine kanonikSurum olarak geçer (motor/kabuk sütunları)', async () => {
  const o = ortam({ ping: true });
  const kanonikSurum = { motorSha12: '03e8af70a0f3', motorDurum: 'guncel', kabukSurum: '1.13.14', kabukDurum: 'guncel' };
  await o.ekle('103', { kanonikSurum });
  const z = await B.tur(o.bagimlilik());
  assert.equal(z.yayinlanan, 1);
  assert.deepEqual(o.cagri.yayin[0].job.kanonikSurum, kanonikSurum);
});

test('hazır kayıttaki icerikUyeleri bekçinin /result işine geçer; yoksa alan yok (05.10)', async () => {
  const o = ortam({ ping: true });
  const icerikUyeleri = [{ id: '31456', vs: 10, kitap: 'book1' }, { id: '31457', vs: 0, kitap: 'book2' }];
  await o.ekle('104', { icerikUyeleri });
  await o.ekle('105');
  const z = await B.tur(o.bagimlilik());
  assert.equal(z.yayinlanan, 2);
  const iş = (id) => o.cagri.yayin.find((y) => y.job.bookId === id).job;
  assert.deepEqual(iş('104').icerikUyeleri, icerikUyeleri);
  assert.equal('icerikUyeleri' in iş('105'), false);
});

test('VPN kapalı ama parolasız sudo VAR → betik VPN + disk için koşar', async () => {
  const o = ortam({ ping: false, sudo: true });
  await o.ekle('103');
  const z = await B.tur(o.bagimlilik());
  assert.match(o.oku(), /^disk --sessiz$/m);
  assert.equal(z.yayinlanan, 1);
});

test('EMPP_IMZA_BEKCI_VPN=0 → VPN kapalıyken betik koşmaz (sudo bile sorulmaz)', async () => {
  const o = ortam({ ping: false, sudo: true });
  o.cfg.bekciVpnDene = false;
  await o.ekle('104');
  const z = await B.tur(o.bagimlilik());
  assert.equal(o.cagri.sudo, 0);
  assert.equal(z.disk.denendi, false);
  assert.doesNotMatch(o.oku(), /^disk /m);
});

test('sırayla, en eskiden: iki kayıt da yayınlanır, eski önce', async () => {
  const o = ortam({ yuva: true });
  await o.ekle('201', { yasMs: 1000 });
  await o.ekle('202', { yasMs: 5000 });
  const z = await B.tur(o.bagimlilik());
  assert.equal(z.yayinlanan, 2);
  assert.deepEqual(o.cagri.yayin.map((y) => y.job.bookId), ['202', '201']);
  assert.equal(o.cagri.ping, 0, 'yuva açıkken VPN/disk ölçülmez');
});

test('tur içinde gelen ÖNCELİKLİ kayıt (imza-oncelik.txt) sıradaki eskilerin önüne geçer (05.10 SM3)', async () => {
  const o = ortam({ yuva: true });
  await o.ekle('401', { yasMs: 9000 });
  await o.ekle('402', { yasMs: 8000 });
  await o.ekle('403', { yasMs: 7000 });
  let eklendi = false;
  const d = o.bagimlilik();
  const asil = d.imzaliYayinZinciri;
  d.imzaliYayinZinciri = async (p) => {
    if (!eklendi) {
      eklendi = true; // ilk kayıt imzalanırken öncelikli set üretilir ve listeye yazılır
      await o.ekle('73768', { yasMs: 0 });
      fs.writeFileSync(H.oncelikDosyasi(o.cfg), '73768\n');
    }
    return asil(p);
  };
  const z = await B.tur(d);
  assert.equal(z.yayinlanan, 4);
  assert.deepEqual(o.cagri.yayin.map((y) => y.job.bookId), ['401', '73768', '402', '403']);
});

test('--yalniz: yalnız verilen kitap işlenir, diğerleri kuyrukta kalır (elle ilk tur, 04.10)', async () => {
  const o = ortam({ yuva: true });
  await o.ekle('301', { yasMs: 9000 });
  await o.ekle('302', { yasMs: 5000 });
  const z = await B.tur(o.bagimlilik({ yalniz: '302' }));
  assert.equal(z.yayinlanan, 1);
  assert.deepEqual(o.cagri.yayin.map((y) => y.job.bookId), ['302']);
  assert.equal((await H.hazirListesi(o.cfg)).length, 1, '301 kuyrukta kaldı');
});

test('sunucu kirayı tutmuyor (presign 409) → imzalanmaz, kayıt yerinde; eşik aşıldıysa bildirim', async () => {
  const o = ortam({ yuva: true });
  await o.ekle('301', { yasMs: 4 * SAAT });
  const z = await B.tur(o.bagimlilik({
    presignUpload: async () => { throw new Error('presign failed: HTTP 409 {"error":"lease_not_held"}'); },
  }));
  assert.equal(z.atlanan, 1);
  assert.equal(o.cagri.zincir.length, 0, 'kira yokken imza yuvası boşuna meşgul edilmez');
  assert.equal(o.cagri.yayin.length, 0);
  assert.equal((await H.hazirListesi(o.cfg)).length, 1);
  assert.match(o.oku(), /^bildir paket 1 Windows paketi imza bekliyor: kira sunucuda bu ajanda değil/m);
});

test('imzalı kopya kabulden KALDI → reddedildi/\'ye taşınır, yayın YOK, bildirim', async () => {
  const o = ortam({ yuva: true });
  await o.ekle('401');
  const z = await B.tur(o.bagimlilik({
    imzaliYayinZinciri: async () => { throw new Error("windows paketi windows-kasa kabul kapısından geçemedi (KALDI) — R2'ye YÜKLENMEDİ: 0/2"); },
  }));
  assert.equal(z.reddedilen, 1);
  assert.equal(o.cagri.yayin.length, 0);
  assert.equal(fs.readdirSync(path.join(o.cfg.winHazirKoku, 'reddedildi')).length, 1);
  assert.match(o.oku(), /^bildir paket Windows paketi 401 imzalı kabulden KALDI/m);
});

test('imza hatası → kayıt yerinde (sonHata), tur DURUR (ikinci kayıt denenmez), yayın YOK', async () => {
  const o = ortam({ yuva: true });
  await o.ekle('501', { yasMs: 9000 });
  await o.ekle('502', { yasMs: 1000 });
  let n = 0;
  const z = await B.tur(o.bagimlilik({
    imzaliYayinZinciri: async () => { n += 1; throw new Error('[windows-serit] imza zaman aşımı (300 dk)'); },
  }));
  assert.equal(n, 1, 'kuyruk tek yuvalı: ilk hata turu durdurur');
  assert.equal(z.yayinlanan, 0);
  assert.equal(o.cagri.yayin.length, 0);
  const l = await H.hazirListesi(o.cfg);
  assert.equal(l.length, 2);
  assert.match(l[0].manifest.sonHata, /imza zaman aşımı/);
});

const bayatDizinleri = (o) => (fs.existsSync(path.join(o.cfg.winHazirKoku, 'bayat')) ? fs.readdirSync(path.join(o.cfg.winHazirKoku, 'bayat')) : []);

test('ÜRETİM BAĞLAMASI: sunucu presign yanıtındaki gecerliKaynakSurumu (enjeksiyon YOK) → eski kayıt bayat; imza/R2 yok; sunucu satırı kapatılır', async () => {
  const o = ortam({ yuva: true });
  const k = await o.ekle('701');
  await H.manifestGuncelle(k.dizin, { job: { bookId: '701', kaynakSurumu: '2.0.7' } });
  const hatalar = [];
  const z = await B.tur(o.bagimlilik({
    presignUpload: async () => ({ r2ObjectKey: 'k', gecerliKaynakSurumu: '2.0.11' }),
    postResultFailure: async (auth, job, sebep) => { hatalar.push({ id: job.bookId, sebep }); },
  }));
  assert.equal(z.bayat, 1);
  assert.equal(o.cagri.zincir.length, 0, 'imza istenmedi');
  assert.equal(o.cagri.yayin.length, 0, 'R2/result yok');
  assert.equal((await H.hazirListesi(o.cfg)).length, 0);
  const bay = bayatDizinleri(o);
  assert.equal(bay.length, 1);
  assert.equal(fs.existsSync(path.join(o.cfg.winHazirKoku, 'bayat', bay[0], 'runner-701-T-2.1.1-Setup.exe')), true, 'exe silinmedi');
  assert.equal(hatalar.length, 1, 'K2: sunucu satırı açık bırakılmaz (failed)');
  assert.equal(hatalar[0].sebep, '[imza-bekliyor] hazır kayıt bayat (kayıt 2.0.7, geçerli 2.0.11)');
});

test('bayat DEĞİL: kayıt = geçerli sürüm, ya da yoklama sürüm döndürmüyor → akış aynen, imzalanır, failed çağrılmaz', async () => {
  const o = ortam({ yuva: true });
  const k = await o.ekle('702');
  await H.manifestGuncelle(k.dizin, { job: { bookId: '702', kaynakSurumu: '2.0.11' } });
  const hatalar = [];
  const z = await B.tur(o.bagimlilik({
    presignUpload: async () => ({ r2ObjectKey: 'k', gecerliKaynakSurumu: '2.0.11' }),
    postResultFailure: async () => { hatalar.push(1); },
  }));
  assert.equal(z.yayinlanan, 1);
  assert.equal(hatalar.length, 0);
  const o2 = ortam({ yuva: true });
  await o2.ekle('703');
  assert.equal((await B.tur(o2.bagimlilik())).yayinlanan, 1, 'sürüm bilinmiyorsa bayat sayılmaz');
});

test('kanoniksiz/eski kanonik kayıt (damgasız ya da kabuk 1.13.3 ≠ 1.13.14) → bayat, imza yok; güncel kanonikli → imzalanır', async () => {
  const kanonikli = (kanonik) => async () => {
    const o = ortam({ yuva: true });
    o.cfg.winKanonikYukleyici = async () => ({ motorSha12: '03e8af70a0f3', kabukSurum: '1.13.14' });
    const k = await o.ekle('710');
    await H.manifestGuncelle(k.dizin, { kanonik });
    return { o, z: await B.tur(o.bagimlilik()) };
  };
  let r = await kanonikli({})();
  assert.equal(r.z.bayat, 1, 'damgasız eski kayıt: fail-closed');
  assert.equal(r.o.cagri.zincir.length, 0);
  r = await kanonikli({ motorSha12: '03e8af70a0f3', motorDurum: 'guncel', kabukSurum: '1.13.3', kabukDurum: 'guncel' })();
  assert.equal(r.z.bayat, 1, 'eski kanonik kabuk');
  assert.equal(r.o.cagri.zincir.length, 0);
  assert.match(fs.readFileSync(path.join(r.o.cfg.winHazirKoku, 'bayat', bayatDizinleri(r.o)[0], 'manifest.json'), 'utf8'), /kanoniksiz\/eski kanonik: kabuk 1\.13\.3 ≠ kanonik 1\.13\.14/);
  r = await kanonikli({ motorSha12: '03e8af70a0f3', motorDurum: 'guncel', kabukSurum: '1.13.14', kabukDurum: 'guncel' })();
  assert.equal(r.z.yayinlanan, 1, 'güncel kanonikli: akış aynen');
  assert.equal(r.z.bayat, undefined);
});

test('/result yeniden kuyruğa aldı (200 + yenidenKuyruk) → kayıt yayinlandi DEĞİL, bayat/; reddi (kaynak-surumu-eski hatası) da aynı', async () => {
  const o = ortam({ yuva: true });
  await o.ekle('720');
  const z = await B.tur(o.bagimlilik({
    postResultSuccess: async () => ({ r2ObjectKey: 'k', publicUrl: 'u', yenidenKuyruk: { claim: '2.0.7', gecerli: '2.0.11' } }),
  }));
  assert.equal(z.yayinlanan, 0);
  assert.equal(z.bayat, 1);
  assert.equal(bayatDizinleri(o).length, 1);
  assert.equal(fs.existsSync(path.join(o.cfg.winHazirKoku, 'yayinlandi')), false);
  const o2 = ortam({ yuva: true });
  await o2.ekle('721');
  const hatalar = [];
  const z2 = await B.tur(o2.bagimlilik({
    postResultSuccess: async () => { throw new Error('result(completed) rejected: HTTP 409 kaynak-surumu-eski'); },
    postResultFailure: async (a, j, sebep) => { hatalar.push(sebep); },
  }));
  assert.equal(z2.bayat, 1);
  assert.equal(bayatDizinleri(o2).length, 1);
  assert.equal(hatalar.length, 1);
});

test('kayıt runner tarafından kilitliyse atlanır (çift imza/yayın yok)', async () => {
  const o = ortam({ yuva: true });
  const k = await o.ekle('601');
  const birak = await H.kayitKilidiDene(k.dizin);
  try {
    const z = await B.tur(o.bagimlilik());
    assert.equal(z.atlanan, 1);
    assert.equal(o.cagri.zincir.length, 0);
  } finally { await birak(); }
});

test('tekil koşu: önceki tur sürüyorsa çıkar', async () => {
  const o = ortam({ yuva: true });
  await o.ekle('701');
  fs.mkdirSync(o.cfg.winHazirKoku, { recursive: true });
  const t = await W.kilitDene(path.join(o.cfg.winHazirKoku, '.bekci.kilit'));
  try {
    const z = await B.tur(o.bagimlilik());
    assert.equal(z.atlandi, 'tekil-kilit');
    assert.equal(o.cagri.zincir.length, 0);
  } finally { await W.kilitBirak(t.tutucu); }
});

test('--kuru: ölçer ve raporlar; disk/imza/yayın/bildirim YOK', async () => {
  const o = ortam({ ping: true });
  await o.ekle('801', { yasMs: 5 * SAAT });
  const z = await B.tur(o.bagimlilik({ kuru: true }));
  assert.equal(z.bekleyen, 1);
  assert.match(z.bildirim, /1 Windows paketi imza bekliyor/);
  assert.equal(o.oku(), '');
  assert.equal(o.cagri.zincir.length, 0);
});

test('bekçi imza kilidini uzun beklemez ve runner ile AYNI kilit dosyasını kullanır', async () => {
  const o = ortam({ yuva: true });
  await o.ekle('901');
  let gelenCfg = null;
  await B.tur(o.bagimlilik({
    imzaliYayinZinciri: async (p) => { gelenCfg = p.cfg; throw new Error('[windows-serit] imza kuyruğu kilidi 2 dk boşalmadı'); },
  }));
  assert.equal(gelenCfg.winImzaKilit, W.varsayilanAyarlar().winImzaKilit);
  assert.equal(gelenCfg.winImzaKilitBeklemeMs, 2 * 60 * 1000);
});

test('kaynak: bekçi ikinci bir imza yolu içermez (imza betiği/osslsigncode doğrudan çağrılmaz)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'imza-bekcisi.js'), 'utf8');
  const kod = src.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
  assert.doesNotMatch(kod, /imza-yuva-smb|osslsigncode|bekle-ve-tak/);
  assert.match(kod, /imzaliYayinZinciri: W\.imzaliYayinZinciri/);
});

test('kabul KALDI → sunucudaki tutma kapatılır (postResultFailure çağrılır, satır sonsuza dek running kalmaz)', async () => {
  const o = ortam({ yuva: true });
  await o.ekle('402');
  const basarisizlar = [];
  const z = await B.tur(o.bagimlilik({
    imzaliYayinZinciri: async () => { throw new Error("windows paketi windows-kasa kabul kapısından geçemedi (KALDI) — R2'ye YÜKLENMEDİ: 0/2"); },
    postResultFailure: async (auth, job, mesaj) => { basarisizlar.push({ bookId: job.bookId, platform: job.platform, mesaj }); },
  }));
  assert.equal(z.reddedilen, 1);
  assert.equal(basarisizlar.length, 1);
  assert.equal(basarisizlar[0].bookId, '402');
  assert.equal(basarisizlar[0].platform, 'windows');
  assert.match(basarisizlar[0].mesaj, /^\[imza-bekliyor\] imzalı kabul KALDI/);
});

test('imza hatası (KALDI değil) → failed YAZILMAZ: kayıt yerinde, tutma sürer', async () => {
  const o = ortam({ yuva: true });
  await o.ekle('403');
  const basarisizlar = [];
  await B.tur(o.bagimlilik({
    imzaliYayinZinciri: async () => { throw new Error('imza yuvası zaman aşımı'); },
    postResultFailure: async (a, j, m) => { basarisizlar.push(m); },
  }));
  assert.equal(basarisizlar.length, 0);
});

test('win32: bekçi VPN/disk bağlamaz (servis + cmdkey), ping -n kullanır', async () => {
  const komutlar = [];
  const komutKos = async (argv) => { komutlar.push(argv.join(' ')); return { kod: 1, cikti: '' }; };
  const r = await B.diskBagla({ bekciDiskBetigi: __filename }, { komutKos, log: () => {}, platform: 'win32' });
  assert.equal(r.denendi, false);
  assert.match(r.sebep, /win32/);
  assert.deepEqual(komutlar, [], 'win32\'de ne ping ne sudo ne disk betiği');
});

test('bekçi imzalı kabul zincirine kasa kilit beklemesini 120 dk geçirir (env ile ezilir)', async () => {
  assert.equal(B.bekciAyarlari({}).bekciKasaKilitBeklemeMs, 120 * 60 * 1000);
  assert.equal(B.bekciAyarlari({ EMPP_BEKCI_KILIT_BEKLEME_DK: '45' }).bekciKasaKilitBeklemeMs, 45 * 60 * 1000);
  const o = ortam({ yuva: true });
  await o.ekle('301');
  const gorulen = [];
  const d = o.bagimlilik();
  const asil = d.imzaliYayinZinciri;
  d.imzaliYayinZinciri = async (a) => { gorulen.push(a.cfg.winKasaKilitBeklemeMs); return asil(a); };
  await B.tur(d);
  assert.deepEqual(gorulen, [120 * 60 * 1000]);
});

test('İMZALI ARŞİV (Nadir 06.10): yayın sonrası imzalı kopya <kök>/<bookId>/<özgün Setup adı> + son.json; eski sürüm silinir', async () => {
  const o = ortam({ yuva: true });
  const birim = fs.mkdtempSync(path.join(os.tmpdir(), 'bekci-D-'));
  o.cfg.imzaliArsivKoku = path.join(birim, 'empp-imzali-son');
  const k = path.join(o.cfg.imzaliArsivKoku, '301');
  fs.mkdirSync(k, { recursive: true });
  fs.writeFileSync(path.join(k, 'runner-301-T-2.1.0-Setup.exe'), 'eski');
  const h = await o.ekle('301');
  const z = await B.tur(o.bagimlilik());
  assert.equal(z.yayinlanan, 1);
  const exe = path.join(k, 'runner-301-T-2.1.1-Setup.exe');
  assert.deepEqual(fs.readFileSync(exe), Buffer.concat([h.govde, Buffer.from('IMZA')]), 'arşivdeki kopya İMZALI olan');
  assert.deepEqual(fs.readdirSync(k).sort(), ['runner-301-T-2.1.1-Setup.exe', 'son.json']);
  const son = JSON.parse(fs.readFileSync(path.join(k, 'son.json'), 'utf8'));
  assert.equal(son.bookId, '301');
  assert.equal(son.baslik, 'Kitap 301');
  assert.equal(son.surum, '2.1.1');
  assert.equal(son.r2Anahtari, 'softwares/301/x.exe');
  assert.ok(son.yayinZamani && son.sha256 && son.boyut);
  assert.doesNotMatch(o.oku(), /^bildir bekci/m);
  fs.rmSync(birim, { recursive: true, force: true });
});

test('İMZALI ARŞİV: sha uyuşmazlığı yayını DÜŞÜRMEZ — kayıt yayinlandi, eski sürüm yerinde, bildir bekci tek satır', async () => {
  const o = ortam({ yuva: true });
  const birim = fs.mkdtempSync(path.join(os.tmpdir(), 'bekci-D-'));
  o.cfg.imzaliArsivKoku = path.join(birim, 'empp-imzali-son');
  const k = path.join(o.cfg.imzaliArsivKoku, '302');
  fs.mkdirSync(k, { recursive: true });
  fs.writeFileSync(path.join(k, 'runner-302-T-2.1.0-Setup.exe'), 'eski');
  await o.ekle('302');
  const d = o.bagimlilik();
  const asil = d.imzaliYayinZinciri;
  d.imzaliYayinZinciri = async (a) => { const r = await asil(a); r.kanit.imzali.sha256 = '0'.repeat(64); return r; };
  const z = await B.tur(d);
  assert.equal(z.yayinlanan, 1, 'yayın başarılı sayıldı');
  assert.equal(o.cagri.yayin.length, 1);
  assert.deepEqual(fs.readdirSync(k), ['runner-302-T-2.1.0-Setup.exe'], 'eski kaldı, yeni yerleşmedi');
  const satirlar = o.oku().split('\n').filter((s) => s.startsWith('bildir bekci'));
  assert.equal(satirlar.length, 1, o.oku());
  assert.match(satirlar[0], /İmzalı arşiv 302: kopya: sha256 uyuşmadı/);
  fs.rmSync(birim, { recursive: true, force: true });
});

test('İMZALI ARŞİV: D: yoksa atlanır, yayın etkilenmez, bildirim yok', async () => {
  const o = ortam({ yuva: true });
  o.cfg.imzaliArsivKoku = path.join(os.tmpdir(), `yok-D-${process.pid}-${Date.now()}`, 'empp-imzali-son');
  await o.ekle('303');
  const z = await B.tur(o.bagimlilik());
  assert.equal(z.yayinlanan, 1);
  assert.equal(fs.existsSync(path.dirname(o.cfg.imzaliArsivKoku)), false);
  assert.doesNotMatch(o.oku(), /^bildir bekci/m);
});

test('bekciAyarlari: arşiv kökü env ile, "0" kapatır', () => {
  assert.equal(B.bekciAyarlari({ EMPP_IMZALI_ARSIV_KOKU: 'E:\\a' }).imzaliArsivKoku, 'E:\\a');
  assert.equal(B.bekciAyarlari({ EMPP_IMZALI_ARSIV_KOKU: '0' }).imzaliArsivKoku, null);
});
