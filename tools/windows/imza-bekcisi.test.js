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
    winHazirKoku: path.join(d, 'windows-hazir'), winImzaYuvaKoku: yuvaKok, winImzaYuvaSunucu: '',
    winKanitDizini: path.join(d, 'kanit'), bekciDiskBetigi: disk, bekciBildirIkili: bildir,
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
  const ekle = async (bookId, { yasMs = 60000 } = {}) => {
    const w = tmp('w');
    const govde = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(3000)]);
    const exe = path.join(w, `runner-${bookId}-T-2.1.1-Setup.exe`);
    fs.writeFileSync(exe, govde);
    const h = await H.hazirKoy({
      exe, job: { bookId, platform: 'windows', bookTitle: `Kitap ${bookId}`, surum: '2.1.1' }, surum: '2.1.1',
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
  assert.doesNotMatch(o.oku(), /^bildir/m, 'sorun yok → bildirim yok');
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
