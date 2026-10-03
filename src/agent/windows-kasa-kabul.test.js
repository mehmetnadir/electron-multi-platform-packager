'use strict';

/**
 * windows-kasa kabul kapısı (2026-10-02) — saf kararlar + gerçek modül, SAHTE köprü sürücüsüyle.
 * Gerçek makineye/köprüye/R2'ye DOKUNULMAZ: vm kökü, kilit ve kanıt kökü geçici dizindedir
 * (test-yalitim: EMPP_VM_KOK, EMPP_WIN_KASA_KILIT, EMPP_KABUL_KANIT_KOK).
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();
after(() => YALITIM.temizle());

const K = require('./windows-kasa-kabul');
const W = require('./windows-serit');
const karar = require('../windows/vm-kapi-karar');
const { ertelenebilirKaynakHatasi, WIN_KASA_KABUL_ISARETI } = require('./runner-helpers');

const SURUCU = path.join(__dirname, 'fikstur', 'sahte-kasa-surucu.js');
const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `kasa-${ad}-`));

/** Taze kalpli vm kökü + kapı ayarları. */
function ortam({ kalp = new Date().toISOString(), bende = false, ayar = {} } = {}) {
  const vmKok = tmp('vm');
  fs.mkdirSync(path.join(vmKok, 'durum'), { recursive: true });
  if (kalp !== null) fs.writeFileSync(path.join(vmKok, 'durum', 'kalp-windows-kasa.txt'), kalp);
  if (bende) fs.writeFileSync(path.join(vmKok, 'BENDE-windows-kasa'), '');
  const d = tmp('is');
  const exe = path.join(d, 'paket-Setup.exe');
  fs.writeFileSync(exe, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4096, 7)]));
  const gunluk = path.join(d, 'surucu.jsonl');
  const cfg = {
    ...K.kasaAyarlari({}),
    winKasaVmKok: vmKok, winKasaSurucu: SURUCU, winKasaKopruAdres: '127.0.0.1',
    winKasaKilit: path.join(tmp('kilit'), 'windows-kasa-kabul.kilit'),
    winKasaKilitBeklemeMs: 3000, winKasaKilitAralikMs: 50, winKasaKabulTimeoutMs: 60000,
    ...ayar,
  };
  const gordu = () => (fs.existsSync(gunluk)
    ? fs.readFileSync(gunluk, 'utf8').split('\n').filter(Boolean).map((s) => JSON.parse(s)) : []);
  return { vmKok, exe, cfg, gunluk, gordu };
}

async function kos(o, kip, ek = {}) {
  // Sahte sürücünün kipi/günlüğü ÇAĞRI BAŞINA çocuk ortamına verilir (global env değil — eşzamanlı
  // iki kabulde biri diğerinin ortamını geri alıp ezmesin). Gerçek spawn yolu (komutKos) korunur.
  const calistir = (argv, s) => W.komutKos(argv, {
    ...s, env: { ...(s.env || {}), SAHTE_KASA_KIP: kip, SAHTE_KASA_GUNLUK: o.gunluk },
  });
  const loglar = [];
  try {
    const r = await K.kasaKabulKapisi({
      exe: o.exe, bookId: '74390', etiket: 'imzasiz', baslik: "Test 'Kitap'", cfg: o.cfg, calistir,
      log: (...a) => loglar.push(a.join(' ')), sleep: (ms) => new Promise((x) => setTimeout(x, ms)), ...ek,
    });
    return { r, loglar };
  } catch (e) {
    return { hata: e, loglar };
  }
}

function ozetOku(kanitDizini) {
  return JSON.parse(fs.readFileSync(path.join(kanitDizini, 'ozet.json'), 'utf8'));
}
const kanitDizini = (hata) => (/kanıt: (\S+)$/.exec(hata.message) || [])[1];

// ---------------------------------------------------------------------------
// Saf kararlar
// ---------------------------------------------------------------------------

test('kasaErisimKarari: taze kalp → erişilir; bayat/yok/BENDE/kapalı/şerit tıkalı → erişilemez', () => {
  const simdi = Date.parse('2026-10-02T12:00:00Z');
  const iso = (snOnce) => new Date(simdi - snOnce * 1000).toISOString();
  assert.equal(K.kasaErisimKarari({ etkin: true, kalpMetni: iso(5), bende: false, simdiMs: simdi }).erisilir, true);
  const bayat = K.kasaErisimKarari({ etkin: true, kalpMetni: iso(449245), bende: false, simdiMs: simdi });
  assert.equal(bayat.erisilir, false);
  assert.match(bayat.sebep, /izleyici olu/);
  assert.match(K.kasaErisimKarari({ etkin: true, kalpMetni: '', bende: false, simdiMs: simdi }).sebep, /izleyici yok/);
  assert.match(K.kasaErisimKarari({ etkin: true, kalpMetni: iso(1), bende: true, simdiMs: simdi }).sebep, /BENDE/);
  assert.match(K.kasaErisimKarari({ etkin: false, kalpMetni: iso(1), bende: false, simdiMs: simdi }).sebep, /=0/);
  const tikali = JSON.stringify({ kalp: iso(2), sonDonguDamgasi: iso(4000), donguDurumu: 'bos' });
  const t = K.kasaErisimKarari({ etkin: true, kalpMetni: tikali, bende: false, simdiMs: simdi });
  assert.equal(t.erisilir, false);
  assert.match(t.sebep, /tıkalı/);
});

test('raporKarari: GECTI yalnız her kitap GECTI ise; indirme/aktarım ÖLÇÜLEMEDİ; kurulum/açılış/kitap KALDI', () => {
  const kitap = (s) => ({ id: 'book1', sonuc: s, thumbOK: 0, canvasDolu: 0, sayfa: '12/40' });
  assert.equal(K.raporKarari({ sonuc: 'GECTI', kitaplar: [kitap('GECTI'), kitap('GECTI')] }).durum, 'GECTI');
  assert.equal(K.raporKarari({ sonuc: 'GECTI', kitaplar: [kitap('GECTI'), kitap('KALDI')] }).durum, 'KALDI');
  assert.equal(K.raporKarari({ sonuc: 'GECTI', kitaplar: [] }).durum, 'KALDI', 'kitapsız GECTI güvenilmez');
  assert.equal(K.raporKarari({ sonuc: 'KALDI', sebep: 'INDIRILEMEDI', indirme: { cikis: 7 } }).durum, 'OLCULEMEDI');
  assert.equal(K.raporKarari({ sonuc: 'KALDI', sebep: 'PE_DEGIL' }).durum, 'OLCULEMEDI');
  for (const sebep of ['KURULMADI', 'EXE_YOK', 'CDP_ACILMADI']) {
    assert.deepEqual(K.raporKarari({ sonuc: 'KALDI', sebep }), { durum: 'KALDI', sebep });
  }
  const k = K.raporKarari({ sonuc: 'KALDI', kitaplar: [kitap('GECTI'), kitap('KALDI')] });
  assert.equal(k.durum, 'KALDI');
  assert.match(k.sebep, /1\/2 kitap GECTI — book1:thumb=0 tuval=0 sayfa=12\/40/);
  assert.equal(K.raporKarari(null).durum, 'OLCULEMEDI');
  assert.equal(K.raporKarari({ sonuc: '???' }).durum, 'OLCULEMEDI');
});

test('guestKomutu/sarmalayiciPs: belirteç komutta GEÇMEZ, guest dosyasından okunur; komut izleyici sınırında', () => {
  const anahtar = K.kabulAnahtari('74390', 'imzasiz', new Date(2026, 9, 2, 15, 4, 5));
  assert.equal(anahtar, '74390-imzasiz-20261002150405');
  assert.equal(K.kabulAnahtari('74 390/..', "im'zali", new Date(2026, 0, 1)).startsWith('74-390-im-zali-'), true);
  const cmd = K.guestKomutu({ anahtar, adres: '100.87.144.56', port: 8791 });
  assert.equal(karar.calistirGovdesi(cmd, 2700).hata, undefined, 'vm-kapi calistir komutu reddetmemeli');
  assert.ok(cmd.length <= karar.KOMUT_AZAMI);
  assert.match(cmd, /\$b=\(Get-Content C:\\vm-kapi\\belirtec\.txt -Raw\)\.Trim\(\)/);
  assert.match(cmd, new RegExp(`/\\$b/dosya/wrap-${anahtar}\\.ps1`));
  const ps = K.sarmalayiciPs({ anahtar, adres: '100.87.144.56', port: 8791, baslik: "Ali'nin Kitabı" });
  assert.match(ps, /'Ali''nin Kitabı'/, 'tek tırnak PowerShell kaçışı');
  assert.match(ps, new RegExp(`"http://100\\.87\\.144\\.56:8791/\\$b/dosya/kabul-${anahtar}\\.exe"`));
  assert.match(ps, new RegExp(`Remove-Item .*D:\\\\kabul\\\\${anahtar}\\.exe`), 'kasa diski temizlenir');
  assert.doesNotMatch(ps + cmd, /[0-9a-f]{24}/, 'belirteç değeri gömülmez');
});

test('kabulPyHazirla: gerçek kabul.py MACIP satırı çalışma-anı adresiyle değişir; satır yoksa fırlatır', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'windows', 'kabul', 'kabul.py'), 'utf8');
  const yeni = K.kabulPyHazirla(kaynak, '10.1.2.3');
  assert.match(yeni, /^MACIP = "10\.1\.2\.3"$/m);
  assert.equal(yeni.split('\n').length, kaynak.split('\n').length);
  assert.throws(() => K.kabulPyHazirla('print(1)', '1.1.1.1'), /MACIP/);
});

test('ciktidanJson: son JSON>>> kazanır; işaretsiz/bozuk → null (kosu.py aynası)', () => {
  assert.deepEqual(K.ciktidanJson('a\nJSON>>>{"sonuc":"KALDI"}\nJSON>>>{"sonuc":"GECTI"}\n'), { sonuc: 'GECTI' });
  assert.equal(K.ciktidanJson('JSON>>>{bozuk'), null);
  assert.equal(K.ciktidanJson(''), null);
});

test('WIN_KASA_KABUL_ISARETI ertelenebilir sınıfta (failed yazılmaz, kira bırakılır)', () => {
  assert.equal(ertelenebilirKaynakHatasi(new Error(`${WIN_KASA_KABUL_ISARETI} x`)), true);
  assert.equal(ertelenebilirKaynakHatasi(new Error('windows paketi windows-kasa kabul kapısından geçemedi (KALDI)')), false);
});

// ---------------------------------------------------------------------------
// Gerçek modül + sahte köprü sürücüsü
// ---------------------------------------------------------------------------

test('GECTI: paket bağlantıyla sunulur, MACIP yazılır, kanıt <bookId>-windows-<damga>/ altına; geçiciler kalkar', async () => {
  const o = ortam();
  const { r, hata, loglar } = await kos(o, 'gecti');
  assert.equal(hata, undefined, hata && hata.stack);
  assert.equal(r.kullanildi, true);
  assert.equal(r.durum, 'GECTI');
  const g = o.gordu();
  assert.equal(g.length, 1);
  assert.equal(g[0].makine, 'windows-kasa');
  assert.equal(g[0].exeBoyut, fs.statSync(o.exe).size, 'sunulan paket üretilen exe ile aynı boyutta');
  assert.equal(g[0].exeBas, 'MZ');
  assert.equal(g[0].pyMacip, '127.0.0.1');
  assert.equal(g[0].psVar, true);
  assert.match(g[0].psMetni, /'Test ''Kitap'''/);
  assert.equal(g[0].zamanAsimi, '60');
  assert.match(path.basename(r.kanitDizini), /^74390-windows-\d{8}-\d{6}$/);
  assert.equal(path.dirname(r.kanitDizini), process.env.EMPP_KABUL_KANIT_KOK);
  const oz = ozetOku(r.kanitDizini);
  assert.equal(oz.karar, 'GECTI');
  assert.equal(oz.etiket, 'imzasiz');
  assert.deepEqual(oz.ekranlar.sort(), [`${g[0].anahtar}-k01.png`, `${g[0].anahtar}-k02.png`, `${g[0].anahtar}-menu.png`]);
  for (const f of oz.ekranlar) assert.ok(fs.existsSync(path.join(r.kanitDizini, f)), f);
  assert.ok(fs.existsSync(path.join(r.kanitDizini, 'rapor.json')));
  assert.ok(fs.existsSync(path.join(r.kanitDizini, 'kosu.log')));
  const kalan = fs.readdirSync(o.vmKok).filter((f) => /^(kabul-|wrap-)/.test(f));
  assert.deepEqual(kalan, [], 'sunulan exe/py/ps1 iş sonunda kalkar');
  assert.ok(fs.existsSync(o.exe), 'üretilen exe (bağlantının kaynağı) yerinde kalır');
  assert.ok(loglar.some((s) => /windows-kasa kabul kapısı GEÇTİ \[imzasiz\]/.test(s)));
});

test('KALDI (kitap ilk sayfa/thumbnail yok): fırlatır, ertelenebilir DEĞİL (failed), kanıt yazılır', async () => {
  const o = ortam();
  const { hata } = await kos(o, 'kaldi-kitap');
  assert.ok(hata);
  assert.match(hata.message, /windows-kasa kabul kapısından geçemedi \(KALDI\) — R2'ye YÜKLENMEDİ: 1\/2 kitap GECTI/);
  assert.equal(ertelenebilirKaynakHatasi(hata), false);
  assert.equal(ozetOku(kanitDizini(hata)).karar, 'KALDI');
});

test('KALDI (KURULMADI): paket kusuru — failed', async () => {
  const { hata } = await kos(ortam(), 'kurulmadi');
  assert.match(hata.message, /\(KALDI\).*KURULMADI/);
  assert.equal(ertelenebilirKaynakHatasi(hata), false);
});

for (const [kip, desen] of [
  ['indirilemedi', /paket kasa'ya inmedi \(INDIRILEMEDI, curl 7\)/],
  ['pe-degil', /PE_DEGIL/],
  ['zaman-asimi', /zaman aşımı/],
  ['bozuk', /izleyici koptu/],
]) {
  test(`ÖLÇÜLEMEDİ (${kip}): ertelenebilir işaretli fırlatır — failed yazılmaz, yedeğe DÜŞÜLMEZ`, async () => {
    const o = ortam();
    const { hata } = await kos(o, kip);
    assert.ok(hata);
    assert.ok(hata.message.includes(WIN_KASA_KABUL_ISARETI), hata.message);
    assert.match(hata.message, desen);
    assert.equal(ertelenebilirKaynakHatasi(hata), true);
    assert.equal(ozetOku(kanitDizini(hata)).karar, 'OLCULEMEDI');
  });
}

test('rapor dosyası gelmese de stdout JSON>>> ile karar verilir', async () => {
  const { r, hata } = await kos(ortam(), 'yalniz-stdout');
  assert.equal(hata, undefined, hata && hata.message);
  assert.equal(r.durum, 'GECTI');
});

test('erişilemez (kalp yok / bayat / BENDE) → kullanildi:false, köprüye iş GİTMEZ', async () => {
  for (const o of [ortam({ kalp: null }), ortam({ kalp: '2026-09-27T07:54:34.513Z' }), ortam({ bende: true })]) {
    const { r, hata } = await kos(o, 'gecti');
    assert.equal(hata, undefined);
    assert.equal(r.kullanildi, false);
    assert.deepEqual(o.gordu(), []);
  }
});

test('aktivasyon kodlu seri → kasa kullanılmaz (kabul.py aktivasyon ekranını tanımaz)', async () => {
  const o = ortam();
  const { r } = await kos(o, 'gecti', { aktivasyon: true });
  assert.equal(r.kullanildi, false);
  assert.match(r.sebep, /aktivasyon/);
  assert.deepEqual(o.gordu(), []);
});

test('kilit: başka kabul tutarken beklenir, tavan dolarsa ertelenebilir hata; köprüye iş gitmez', async () => {
  const o = ortam({ ayar: { winKasaKilitBeklemeMs: 300 } });
  fs.mkdirSync(path.dirname(o.cfg.winKasaKilit), { recursive: true });
  const tut = await W.kilitDene(o.cfg.winKasaKilit);
  assert.ok(tut.tutucu, 'test kilidi alınmalı');
  try {
    const { hata, loglar } = await kos(o, 'gecti');
    assert.ok(hata);
    assert.ok(hata.message.includes(WIN_KASA_KABUL_ISARETI));
    assert.match(hata.message, /kilidi .* boşalmadı/);
    assert.ok(loglar.some((s) => /kilidi dolu/.test(s)));
    assert.deepEqual(o.gordu(), []);
  } finally {
    await W.kilitBirak(tut.tutucu);
  }
});

test('kilit: tutan bırakınca sıra gelir ve kabul koşar', async () => {
  const o = ortam();
  fs.mkdirSync(path.dirname(o.cfg.winKasaKilit), { recursive: true });
  const tut = await W.kilitDene(o.cfg.winKasaKilit);
  setTimeout(() => { W.kilitBirak(tut.tutucu); }, 400);
  const { r, hata, loglar } = await kos(o, 'gecti');
  assert.equal(hata, undefined, hata && hata.message);
  assert.equal(r.durum, 'GECTI');
  assert.ok(loglar.some((s) => /kilidi dolu/.test(s)));
});

test('kilit: aynı makineye eşzamanlı iki kabul ÜST ÜSTE BİNMEZ (sıralanır)', async () => {
  const o = ortam({ ayar: { winKasaKilitBeklemeMs: 20000 } });
  const [a, b] = await Promise.all([kos(o, 'gecti-yavas'), kos(o, 'gecti-yavas')]);
  assert.equal(a.hata, undefined, a.hata && a.hata.message);
  assert.equal(b.hata, undefined, b.hata && b.hata.message);
  assert.equal(a.r.kullanildi, true, a.r.sebep);
  assert.equal(b.r.kullanildi, true, b.r.sebep);
  const g = o.gordu().sort((x, y) => x.bas - y.bas);
  assert.equal(g.length, 2);
  assert.ok(g[1].bas >= g[0].son, `ikinci kabul (${g[1].bas}) birinci bitmeden (${g[0].son}) başladı`);
});

test('kosu.py ile AYNI kilit dosyası adı (elle koşu + runner aynı makineye birlikte gitmez)', () => {
  const py = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'windows', 'kabul', 'kosu.py'), 'utf8');
  assert.match(py, /"windows-kasa-kabul\.kilit"/);
  assert.equal(path.basename(K.kasaAyarlari({}).winKasaKilit), 'windows-kasa-kabul.kilit');
  assert.equal(K.kasaAyarlari({ EMPP_WIN_KASA_KABUL: '0' }).winKasaKabul, false);
  assert.equal(K.kasaAyarlari({}).winKasaKabul, true, 'varsayılan AÇIK');
});

// ---------------------------------------------------------------------------
// YEREL KİP (2026-10-02) — runner windows-kasa'nın kendisinde; köprü/izleyici yok.
// ---------------------------------------------------------------------------

function yerelOrtam({ ayar = {} } = {}) {
  const d = tmp('yerel');
  const exe = path.join(d, 'paket-Setup.exe');
  fs.writeFileSync(exe, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4096, 7)]));
  const cfg = {
    ...K.kasaAyarlari({ EMPP_WIN_KASA_YEREL: '1' }),
    winKasaYerelKok: tmp('kabulkok'), winKasaPython: 'python-sahte', winKasaKabulPy: 'kabul.py',
    winKasaKilit: path.join(tmp('kilit'), 'yerel.kilit'), winKasaKilitAralikMs: 5, winKasaKilitBeklemeMs: 200,
    ...ayar,
  };
  return { cfg, exe };
}

const raporCikti = (r) => `KURULUM|x\nRAPOR|x\nJSON>>>${JSON.stringify(r)}\n`;

test('yerel: win32 varsayılan AÇIK, darwin KAPALI; env ile zorlanır', () => {
  assert.equal(K.kasaAyarlari({}, 'win32').winKasaYerel, true);
  assert.equal(K.kasaAyarlari({}, 'darwin').winKasaYerel, false);
  assert.equal(K.kasaAyarlari({ EMPP_WIN_KASA_YEREL: '0' }, 'win32').winKasaYerel, false);
  assert.equal(K.kasaAyarlari({ EMPP_WIN_KASA_YEREL: '1' }, 'darwin').winKasaYerel, true);
});

test('yerel: erişim kalp dosyası aramaz (köprü yok); EMPP_WIN_KASA_KABUL=0 yine kapatır', () => {
  const { cfg } = yerelOrtam();
  assert.equal(K.kasaErisimi({ ...cfg, winKasaVmKok: tmp('bos') }).erisilir, true);
  assert.equal(K.kasaErisimi({ ...cfg, winKasaKabul: false }).erisilir, false);
});

test('yerel: argv kabul.py anahtar + yerel: + başlık; GECTI → kanıt dizininde rapor/özet, paket kopyası kalkar', async () => {
  const { cfg, exe } = yerelOrtam();
  let gelen = null;
  const calistir = async (argv, o) => {
    gelen = { argv, env: o.env };
    // kabul.py yerel kipte ekranı kanıt dizinine yazar
    fs.writeFileSync(path.join(o.env.EMPP_KABUL_YEREL_DIZIN, 'x-menu.png'), 'png');
    return { kod: 0, cikti: raporCikti({ sonuc: 'GECTI', kitaplar: [{ sonuc: 'GECTI' }, { sonuc: 'GECTI' }] }) };
  };
  const r = await K.kasaKabulKapisi({ exe, bookId: 45538, etiket: 'imzasiz', cfg, calistir });
  assert.equal(r.kullanildi, true);
  assert.equal(r.durum, 'GECTI');
  assert.equal(gelen.argv[0], 'python-sahte');
  assert.equal(gelen.argv[1], 'kabul.py');
  assert.match(gelen.argv[2], /^45538-imzasiz-\d{14}$/);
  assert.match(gelen.argv[3], /^yerel:.*45538-imzasiz-\d{14}\.exe$/);
  assert.equal(gelen.env.PYTHONIOENCODING, 'utf-8');
  const ozet = JSON.parse(fs.readFileSync(path.join(r.kanitDizini, 'ozet.json'), 'utf8'));
  assert.equal(ozet.kip, 'yerel');
  assert.equal(ozet.karar, 'GECTI');
  assert.deepEqual(ozet.ekranlar, ['x-menu.png']);
  assert.ok(fs.existsSync(path.join(r.kanitDizini, 'rapor.json')));
  assert.deepEqual(fs.readdirSync(cfg.winKasaYerelKok), [], 'paket kopyası (kendi geçici dosyası) kaldırılmalı');
  assert.ok(fs.existsSync(exe), 'kaynak paket yerinde kalmalı');
});

test('yerel: KALDI → fırlatır (paket kusuru), ÖLÇÜLEMEDİ → ertelenebilir işaret', async () => {
  const { cfg, exe } = yerelOrtam();
  await assert.rejects(K.kasaKabulKapisi({
    exe, bookId: 1, etiket: 'imzasiz', cfg,
    calistir: async () => ({ kod: 0, cikti: raporCikti({ sonuc: 'KALDI', sebep: 'CDP_ACILMADI', kitaplar: [] }) }),
  }), (e) => /KALDI/.test(e.message) && !e.message.includes(WIN_KASA_KABUL_ISARETI));
  await assert.rejects(K.kasaKabulKapisi({
    exe, bookId: 1, etiket: 'imzasiz', cfg, calistir: async () => ({ kod: 1, cikti: 'Traceback\nhata' }),
  }), (e) => e.message.includes(WIN_KASA_KABUL_ISARETI) && /rapor gelmedi/.test(e.message));
});

test('yerel: aktivasyon kodlu seri, test kodu dosyası YOKSA yerel kipe girmez (başsız yedeğe düşer)', async () => {
  const { cfg, exe } = yerelOrtam({ ayar: { winKasaAktivasyonKod: path.join(tmp('kodyok'), 'yok.txt') } });
  let cagrildi = false;
  const r = await K.kasaKabulKapisi({
    exe, bookId: 1, etiket: 'imzasiz', aktivasyon: true, cfg, calistir: async () => { cagrildi = true; return {}; },
  });
  assert.equal(r.kullanildi, false);
  assert.equal(cagrildi, false);
});

test('yerel kilit: canlı sahip beklenir + tavanda ertelenebilir hata; ölü sahip devralınır', async () => {
  const { cfg } = yerelOrtam();
  fs.writeFileSync(cfg.winKasaKilit, JSON.stringify({ pid: 12345, zaman: new Date().toISOString() }));
  await assert.rejects(K.yerelKilitAl(cfg, { log: () => {}, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), pidYasiyor: () => true }),
    (e) => e.message.includes(WIN_KASA_KABUL_ISARETI));
  const birak = await K.yerelKilitAl(cfg, { log: () => {}, sleep: async () => {}, pidYasiyor: () => false });
  assert.equal(JSON.parse(fs.readFileSync(cfg.winKasaKilit, 'utf8')).pid, process.pid);
  await birak();
  assert.equal(fs.existsSync(cfg.winKasaKilit), false);
});

test('yerel: aktivasyon kodlu seri, test kodu dosyası VARSA kabul.py aktivasyon kipinde koşar (kod env\'e girmez)', async () => {
  const kodDosyasi = path.join(tmp('kod'), 'aktivasyon-test-kodu.txt');
  fs.writeFileSync(kodDosyasi, 'GIZLI');
  const { cfg, exe } = yerelOrtam({ ayar: { winKasaAktivasyonKod: kodDosyasi } });
  let gelen = null;
  const adimlar = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((a) => [a, { sonuc: 'GECTI' }]));
  const r = await K.kasaKabulKapisi({
    exe, bookId: 45449, etiket: 'imzasiz', aktivasyon: true, cfg,
    calistir: async (argv, o) => {
      gelen = o.env;
      return { kod: 0, cikti: raporCikti({ sonuc: 'GECTI', aktivasyon: { adimlar, online: false }, kitaplar: [{ sonuc: 'GECTI' }] }) };
    },
  });
  assert.equal(r.kullanildi, true);
  assert.equal(r.durum, 'GECTI');
  assert.equal(gelen.EMPP_KABUL_AKTIVASYON, '1');
  assert.equal(gelen.EMPP_KABUL_AKTIVASYON_KOD_DOSYASI, kodDosyasi);
  assert.ok(!JSON.stringify(gelen).includes('GIZLI'), 'kodun DEĞERİ env\'e konmaz, yalnız dosya yolu');
});

test('raporKarari: aktivasyon adımlarından biri GECTI değilse rapor GECTI dese de KALDI; d tek kitapta ATLANDI kabul', () => {
  const tam = (deg) => ({ sonuc: 'GECTI', kitaplar: [{ sonuc: 'GECTI' }],
    aktivasyon: { adimlar: { a: { sonuc: 'GECTI' }, b: { sonuc: 'GECTI' }, c: { sonuc: 'GECTI' }, d: { sonuc: 'GECTI' }, e: { sonuc: 'GECTI' }, ...deg } } });
  assert.equal(K.raporKarari(tam({})).durum, 'GECTI');
  assert.equal(K.raporKarari(tam({ d: { sonuc: 'ATLANDI' } })).durum, 'GECTI');
  const k = K.raporKarari(tam({ e: { sonuc: 'KALDI' } }));
  assert.equal(k.durum, 'KALDI');
  assert.match(k.sebep, /aktivasyon-e KALDI/);
  assert.equal(K.raporKarari(tam({ b: undefined })).durum, 'KALDI');
});
