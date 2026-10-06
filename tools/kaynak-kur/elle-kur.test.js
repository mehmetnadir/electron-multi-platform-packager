'use strict';

/**
 * elle-kur (tek set, runner dışı r2-kur) — argümanlar, DB satırı, kilit, claim, geçit, kuru/uygula
 * seam'leri ve GERÇEK processJob ile uçtan uca kuru koşu (ağ yok, paketleyici yok, R2 yok).
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { izoleOrtam } = require('../../src/agent/test-yalitim');

const YALITIM = izoleOrtam();
const ARSIV = fs.mkdtempSync(path.join(os.tmpdir(), 'elle-kur-arsiv-'));
const ESKI_ARSIV = process.env.EMPP_KAYNAK_ARSIVI;
process.env.EMPP_KAYNAK_ARSIVI = ARSIV;

const runner = require('../../src/agent/runner');
const helpers = require('../../src/agent/runner-helpers');
const kaynakR2 = require('../../src/agent/kaynak-r2');
const M = require('../../src/agent/icerik-merdiven');
const E = require('./elle-kur');

YALITIM.configUygula(runner.CONFIG);
after(() => {
  YALITIM.temizle();
  if (ESKI_ARSIV === undefined) delete process.env.EMPP_KAYNAK_ARSIVI;
  else process.env.EMPP_KAYNAK_ARSIVI = ESKI_ARSIV;
  fs.rmSync(ARSIV, { recursive: true, force: true });
});

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `elle-kur-${ad}-`));
const hex = (s) => Buffer.from(s, 'utf8').toString('hex').toUpperCase();
const LISTE = '11822 | Student\'s Book | \n11826 | Activity Book | \nlink:https://x.example/oyun | Oyun';

function satir(ek = {}) {
  return {
    bookId: '11845', bookTitle: 'Super Monsters 3 Set - 2025', publisherName: 'YDS Publishing',
    kisaKod: 'abc123', setListesi: LISTE,
    kilit: { ajan: null, surum: null, bitisMs: null, simdiMs: 1_000_000 },
    gecerliSurum: null, ...ek,
  };
}

// ─── argümanlar ───────────────────────────────────────────────────────────────────────────

test('argAyristir: --set zorunlu ve sayısal; varsayılan kuru, platform mac', () => {
  assert.deepEqual(
    E.argAyristir(['--set', '11845']),
    { set: '11845', uygula: false, cikti: null, platform: 'mac', surum: null },
  );
  assert.match(E.argAyristir([]).hata, /--set/);
  assert.match(E.argAyristir(['--set', '11a']).hata, /--set/);
  assert.match(E.argAyristir(['--set']).hata, /--set/);
});

test('argAyristir: --uygula, --cikti, --platform, --surum ve hatalı biçimler', () => {
  const o = E.argAyristir(['--set', '1', '--uygula', '--cikti', '/tmp/x', '--platform', 'android']);
  assert.equal(o.uygula, true);
  assert.equal(o.cikti, '/tmp/x');
  assert.equal(o.platform, 'android');
  assert.match(E.argAyristir(['--set', '1', '--platform', 'pardus']).hata, /platform/);
  assert.match(E.argAyristir(['--set', '1', '--cikti']).hata, /--cikti/);
  assert.match(E.argAyristir(['--set', '1', '--surum', '3.1']).hata, /--surum/);
  assert.equal(E.argAyristir(['--set', '1', '--surum', '2.51.4']).surum, '2.51.4');
  assert.match(E.argAyristir(['--set', '1', '--uygula', '--surum', '2.1.1']).hata, /kilit satırından/);
  assert.match(E.argAyristir(['--set', '1', '--zorla']).hata, /bilinmeyen/);
  assert.equal(E.argAyristir(['--yardim']).yardim, true);
});

// ─── DB satırı / kilit / claim ────────────────────────────────────────────────────────────

test('sqlKur: salt SELECT, metin alanları HEX, uzak kabukta güvensiz karakter yok', () => {
  const s = E.sqlKur('11845');
  assert.match(s, /^SELECT /);
  assert.doesNotMatch(s, /\b(UPDATE|INSERT|DELETE)\b/i);
  assert.match(s, /HEX\(w\.proxy_asset_id\)/);
  assert.match(s, /s\.book_id = '11845'/);
  assert.doesNotMatch(s, /[;"$`\\]/);
  assert.throws(() => E.sqlKur('1 OR 1=1'), /sayısal/);
});

test('satirAyristir: HEX çözülür, NULL → null, çok satırlı liste bozulmaz', () => {
  const tsv = [
    'book_id\tbaslik_hex\tyayinci_hex\tkisa_kod\tliste_hex\tkilit_ajan\tkilit_surum\tkilit_bitis\tsimdi\tgecerli_surum',
    `11845\t${hex('Süper Set')}\t${hex('YDS Publishing')}\tabc123\t${hex(LISTE)}\tNULL\tNULL\tNULL\t1700000000.123\tNULL`,
  ].join('\n');
  const r = E.satirAyristir(tsv);
  assert.equal(r.bookTitle, 'Süper Set');
  assert.equal(r.setListesi, LISTE);
  assert.equal(r.kisaKod, 'abc123');
  assert.deepEqual(r.kilit, { ajan: null, surum: null, bitisMs: null, simdiMs: 1700000000123 });
  assert.equal(r.gecerliSurum, null);
  assert.equal(E.satirAyristir('book_id\n'), null);
});

test('kilitDenetle: yok / başka ajan / sürümsüz / dolmuş → ret; geçerli → sürüm', () => {
  const k = (kilit) => E.kilitDenetle({ kilit: { simdiMs: 1000, ...kilit } }, 'ajan-1');
  assert.match(k({ ajan: null }).neden, /claim yolunda/);
  assert.match(k({ ajan: 'ajan-2', surum: '2.1.1', bitisMs: 9e9 }).neden, /başka ajanda/);
  assert.match(k({ ajan: 'ajan-1', surum: null, bitisMs: 9e9 }).neden, /sürümü/);
  assert.match(k({ ajan: 'ajan-1', surum: '2.1.1', bitisMs: 999 }).neden, /dolmuş/);
  assert.deepEqual(k({ ajan: 'ajan-1', surum: '2.51.1', bitisMs: 1000 + 30 * 60000 }),
    { tamam: true, surum: '2.51.1', kalanDk: 30 });
});

test('claimKur → runner parseNextJob: geçerli r2-kur işi, liste HAM, tabanUrl yok', () => {
  const ham = E.claimKur({ satir: satir(), platform: 'mac', kaynakSurumu: '2.0.0', kurulumBitisMs: 2e12 });
  const job = helpers.parseNextJob(200, ham);
  assert.equal(job.kaynakTuru, 'r2-kur');
  assert.equal(job.kaynakGecersiz, undefined);
  assert.equal(job.setListesi, LISTE);
  assert.equal(job.kisaKod, 'abc123');
  assert.equal(job.publisherName, 'YDS Publishing');
  assert.equal(job.tabanUrl, undefined);
  assert.equal(kaynakR2.claimKaynakDogrula(ham).gecerli, true);
});

test('zipKokOzeti: kök klasör başına dosya ve bayt, sayısal sıra', () => {
  const d = new Map([
    ['book10/a', { ad: 'book10/a', boyut: 5, dizin: false }],
    ['book2/', { ad: 'book2/', boyut: 0, dizin: true }],
    ['book2/x', { ad: 'book2/x', boyut: 3, dizin: false }],
    ['main.js', { ad: 'main.js', boyut: 7, dizin: false }],
  ]);
  assert.deepEqual(E.zipKokOzeti(d).map((z) => [z.ad, z.dosya, z.bayt]),
    [['book2/', 1, 3], ['book10/', 1, 5], ['main.js', 1, 7]]);
});

test('kaynak-r2.yazmaKapisiSor: kapıya r2KurYayinla ile AYNI girdi (tur otomatik)', () => {
  let gelen;
  const k = kaynakR2.yazmaKapisiSor({
    kapi: (g) => { gelen = g; return { gecti: true }; },
    zipYolu: '/z', setListesi: 'L', oncekiBoyut: 5, oncekiEnvanter: null, vsler: { 1: 3 }, fazla: 1,
  });
  assert.equal(k.gecti, true);
  assert.deepEqual(gelen, { zipYolu: '/z', setListesi: 'L', oncekiBoyut: 5, oncekiEnvanter: null, tur: 'otomatik', vsler: { 1: 3 } });
});

test('runner: processJob yayını kaynakAdim.r2KurYayinla seam\'inden çağırır (doğrudan kaynakR2 değil)', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '../../src/agent/runner.js'), 'utf8');
  assert.match(kaynak, /yayin = await kaynakAdim\.r2KurYayinla\(\{/);
  assert.doesNotMatch(kaynak, /await kaynakR2\.r2KurYayinla\(/);
  assert.equal(typeof runner.kaynakAdim.r2KurYayinla, 'function');
  assert.equal(typeof runner.loadToken, 'function');
});

// ─── geçit ────────────────────────────────────────────────────────────────────────────────

async function istek(url, yol, govde = {}, jeton = 'GIZLI') {
  const r = await fetch(`${url}${yol}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Token': jeton },
    body: JSON.stringify(govde),
  });
  return { status: r.status, govde: await r.json() };
}

test('geçit kuru: kaynak/presign dahil HİÇBİR çağrı iletilmez', async () => {
  const iletilen = [];
  const g = E.gecitKur({ kip: 'kuru', hedefApi: 'https://api.example', ilet: async (o) => { iletilen.push(o); return { status: 200, govde: '{}' }; } });
  const url = await g.baslat();
  try {
    assert.equal((await istek(url, '/agents/a1/kaynak/presign-multipart')).govde.elleKur, 'yutuldu');
    await istek(url, '/agents/a1/kaynak/tamamla');
    await istek(url, '/agents/a1/release');
  } finally { await g.kapat(); }
  assert.equal(iletilen.length, 0);
  assert.equal(g.kayit.length, 3);
  assert.ok(g.kayit.every((k) => !k.iletildi));
});

test('geçit uygula: yalnız kaynak/{presign,tamamla,birak} iletilir; release yutulur; jeton kayda girmez', async () => {
  const iletilen = [];
  const g = E.gecitKur({
    kip: 'uygula', hedefApi: 'https://api.example/api/v1',
    ilet: async (o) => { iletilen.push(o); return { status: 409, govde: '{"error":"kilit_yok"}' }; },
  });
  const url = await g.baslat();
  try {
    const r = await istek(url, '/agents/a1/kaynak/presign-multipart', { partCount: 2 });
    assert.equal(r.status, 409);
    assert.equal(r.govde.error, 'kilit_yok');
    await istek(url, '/agents/a1/kaynak/birak');
    await istek(url, '/agents/a1/release');
    await istek(url, '/agents/a1/result');
    await istek(url, '/agents/a1/kaynak/presign-multipart/../../release');
  } finally { await g.kapat(); }
  assert.deepEqual(iletilen.map((o) => o.url), [
    'https://api.example/api/v1/agents/a1/kaynak/presign-multipart',
    'https://api.example/api/v1/agents/a1/kaynak/birak',
  ]);
  assert.equal(iletilen[0].jeton, 'GIZLI');
  assert.doesNotMatch(JSON.stringify(g.kayit), /GIZLI/);
});

// ─── elleKur (sahte runner) ───────────────────────────────────────────────────────────────

/** Sahte runner: processJob seam'i kendi kapısıyla çağırır; gerçek yayın casusu sayılır. */
function sahteBag({ db = satir(), kapiGecti = true, donus = null, token = null } = {}) {
  const sayac = { yayin: 0, processJob: 0, arsiv: 0, ilet: 0 };
  const zipDir = tmp('zip');
  const zip = path.join(zipDir, 'build.zip');
  fs.writeFileSync(zip, 'ZIPVERI');
  const CONFIG = { apiBase: 'https://gercek.example/api/v1', kaynakKurSerbestFlag: '/gercek/bayrak', kaynakKur: false };
  const kaynakAdim = {
    r2KurYayinla: async () => {
      sayac.yayin += 1;
      return { surum: '2.51.1', sha256: 'a'.repeat(64), boyut: 7, r2ObjectKey: 'kaynak/11845/2.51.1/build.zip', kitaplar: [], ozet: { sha256: 'a'.repeat(64), boyut: 7, md5: 'm' } };
    },
    merdiven: async () => ({ satirlar: [{ kitap: 'book1', id: '11822', surum: 4, vs: 4, durum: 'GUNCEL' }] }),
    imKeys: async () => ({ rapor: { paketAnahtarli: false, kapakSayisi: 5, anahtarli: [], yazilan: [], kodSayisi: 0 }, kapi: { gecti: true, nedenler: [] } }),
  };
  const fakeRunner = {
    CONFIG, kaynakAdim,
    loadToken: async () => token,
    processJob: async (auth, job) => {
      sayac.processJob += 1;
      // Zincir sırasında seam'ler ve geçit etkin olmalı.
      assert.match(CONFIG.apiBase, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.notEqual(CONFIG.kaynakKurSerbestFlag, '/gercek/bayrak');
      assert.equal(CONFIG.kaynakKur, true);
      if (donus) return donus;
      await kaynakAdim.merdiven({});
      await kaynakAdim.imKeys({});
      job.uretecOzeti = { kaynak: 'uretec', kalip: '45549', kitap: 5, linkKarti: 1, liste: 'claim' };
      job.kabukTazeleme = { durum: 'uygulandi', girdiSha: 'f'.repeat(64), kitaplar: ['book1'] };
      return kaynakAdim.r2KurYayinla({
        job, zipYolu: zip, setListesi: job.setListesi, oncekiBoyut: null, oncekiEnvanter: null, vsler: { 1: 4 },
        kapi: () => (kapiGecti
          ? { gecti: true, nedenler: [], kitaplar: [{ n: 1, id: '11822', vs: 4, icerik: true, kapak: true }] }
          : { gecti: false, nedenler: ['kitap-eksik: 11826'], nedenKodlari: ['kitap-eksik'] }),
        ozet: async () => ({ sha256: 'b'.repeat(64), boyut: 7, md5: 'm' }),
        ekWebzVarliklari: [{ n: 6, id: '11840', yol: 'link' }],
        tamamlaEki: {},
      });
    },
  };
  const bag = {
    log: () => {},
    dbOku: async () => db,
    runner: () => fakeRunner,
    helpers: () => helpers,
    kaynakR2: () => kaynakR2,
    arsiveYaz: async () => { sayac.arsiv += 1; },
    zipDizini: (z) => M.zipDizini(z),
    ilet: async () => { sayac.ilet += 1; return { status: 200, govde: '{}' }; },
    simdi: () => 1_000_000,
  };
  return { bag, sayac, CONFIG, kaynakAdim, gercekYayin: kaynakAdim.r2KurYayinla };
}

test('elleKur kuru, kapı GEÇTİ: gerçek yayın ÇAĞRILMAZ, build.zip çıktıya, seam/CONFIG geri, çıkış 0', async () => {
  const s = sahteBag();
  const cikti = tmp('cikti');
  const { kod, rapor } = await E.elleKur({ set: '11845', uygula: false, cikti, platform: 'mac', surum: null }, s.bag);
  assert.equal(kod, 0, rapor.hata);
  assert.equal(s.sayac.yayin, 0);
  assert.equal(s.sayac.arsiv, 0);
  assert.equal(s.sayac.ilet, 0);
  assert.equal(fs.readFileSync(path.join(cikti, 'build.zip'), 'utf8'), 'ZIPVERI');
  assert.equal(rapor.kapi.gecti, true);
  assert.deepEqual(rapor.kapi.kitaplar, [{ n: 1, id: '11822', vs: 4, icerik: true, kapak: true }]);
  assert.deepEqual(rapor.kapi.webzVarliklari.map((w) => w.id), ['11840']);
  assert.equal(rapor.ozet.sha256, 'b'.repeat(64));
  assert.equal(rapor.merdiven[0].durum, 'GUNCEL');
  assert.equal(rapor.kabuk.durum, 'uygulandi');
  assert.equal(rapor.aktivasyon.paketAnahtarli, false);
  assert.equal(rapor.kaynakSurumu, '2.0.0');
  assert.equal(s.CONFIG.apiBase, 'https://gercek.example/api/v1');
  assert.equal(s.CONFIG.kaynakKurSerbestFlag, '/gercek/bayrak');
  assert.equal(s.CONFIG.kaynakKur, false);
  assert.equal(s.kaynakAdim.r2KurYayinla, s.gercekYayin);
  assert.ok(fs.existsSync(path.join(cikti, 'rapor-kuru.json')));
  assert.match(E.raporMetni(rapor), /Yazma kapısı \| GEÇTİ/);
});

test('elleKur kuru, kapı RED: yayın YOK, çıkış 1, neden raporda', async () => {
  const s = sahteBag({ kapiGecti: false });
  const { kod, rapor } = await E.elleKur({ set: '11845', uygula: false, cikti: tmp('red'), platform: 'mac', surum: null }, s.bag);
  assert.equal(kod, 1);
  assert.equal(s.sayac.yayin, 0);
  assert.equal(rapor.kapi.gecti, false);
  assert.deepEqual(rapor.kapi.nedenler, ['kitap-eksik: 11826']);
  assert.match(rapor.hata, /RED/);
  assert.equal(s.kaynakAdim.r2KurYayinla, s.gercekYayin);
});

test('elleKur: geçerli kaynak build\'i olan set reddedilir — processJob hiç koşmaz', async () => {
  const s = sahteBag({ db: satir({ gecerliSurum: '2.51.3' }) });
  const { kod, rapor } = await E.elleKur({ set: '11845', uygula: false, cikti: tmp('gec'), platform: 'mac', surum: null }, s.bag);
  assert.equal(kod, 1);
  assert.equal(s.sayac.processJob, 0);
  assert.match(rapor.hata, /geçerli kaynak build/);
});

test('elleKur: zincir yayına varmadan döner (ertele) → çıkış 1, yayın yok', async () => {
  const s = sahteBag({ donus: { ertelendi: true, sebep: '[uretec] uretec-liste-yok: x' } });
  const { kod, rapor } = await E.elleKur({ set: '11845', uygula: false, cikti: tmp('ert'), platform: 'mac', surum: null }, s.bag);
  assert.equal(kod, 1);
  assert.equal(s.sayac.yayin, 0);
  assert.match(rapor.hata, /uretec-liste-yok/);
});

test('elleKur uygula: kilit yoksa hiçbir şey kurulmaz (processJob yok), çıkış 1', async () => {
  const s = sahteBag({ token: { agentId: 'ajan-1', token: 'T' } });
  const { kod, rapor } = await E.elleKur({ set: '11845', uygula: true, cikti: tmp('kil'), platform: 'mac', surum: null }, s.bag);
  assert.equal(kod, 1);
  assert.equal(s.sayac.processJob, 0);
  assert.match(rapor.hata, /claim yolunda/);
});

test('elleKur uygula: kilit bu ajanda → gerçek yayın + arşiv önbelleği, sürüm kilitten, çıkış 0', async () => {
  const db = satir({ kilit: { ajan: 'ajan-1', surum: '2.51.1', bitisMs: 1_000_000 + 3600_000, simdiMs: 1_000_000 } });
  const s = sahteBag({ db, token: { agentId: 'ajan-1', token: 'T' } });
  const { kod, rapor } = await E.elleKur({ set: '11845', uygula: true, cikti: tmp('uyg'), platform: 'mac', surum: null }, s.bag);
  assert.equal(kod, 0, rapor.hata);
  assert.equal(s.sayac.yayin, 1);
  assert.equal(s.sayac.arsiv, 1);
  assert.equal(rapor.kaynakSurumu, '2.51.1');
  assert.equal(rapor.yayin.r2ObjectKey, 'kaynak/11845/2.51.1/build.zip');
  assert.doesNotMatch(JSON.stringify(rapor), /"T"/);
});

// ─── GERÇEK processJob (uçtan uca kuru) ───────────────────────────────────────────────────

async function zipla(kok, dosyalar, hedef) {
  for (const [yol, veri] of Object.entries(dosyalar)) {
    await fsp.mkdir(path.dirname(path.join(kok, yol)), { recursive: true });
    await fsp.writeFile(path.join(kok, yol), veri);
  }
  const r = await M.komut('zip', ['-q', '-r', '-X', path.resolve(hedef), '.'], { cwd: kok });
  assert.equal(r.code, 0, r.stderr);
}

test('GERÇEK processJob kuru: üreteç tabanı → zincir → gerçek yazma kapısı; yayın yok, paketleyici yok', async () => {
  const { kaynakAdim, CONFIG } = runner;
  const eski = { ...kaynakAdim };
  const eskiPackager = CONFIG.packagerApi;
  const eskiApi = CONFIG.apiBase;
  const eskiMerdiven = process.env.EMPP_ARSIV_MERDIVEN;
  let packagerIstegi = 0;
  const packager = http.createServer((q, r) => { packagerIstegi += 1; r.writeHead(500); r.end(); });
  await new Promise((ok) => packager.listen(0, '127.0.0.1', ok));
  CONFIG.packagerApi = `http://127.0.0.1:${packager.address().port}`;
  process.env.EMPP_ARSIV_MERDIVEN = '1';
  runner._platformAyarla('darwin');
  let gercekYayin = 0;
  const adimlar = [];
  Object.assign(kaynakAdim, {
    r2KurYayinla: async () => { gercekYayin += 1; throw new Error('kuru kipte çağrılmamalı'); },
    uretec: async (o) => {
      adimlar.push('uretec');
      await zipla(tmp('kalip'), {
        'main.js': 'require("electron")', 'package.json': '{"main":"main.js"}', 'index.html': '<html/>',
        'book1/index.html': '<html/>', 'book1/assets/11822/data/BookContent.xml': '<Book/>',
      }, o.zipPath);
      return {
        rapor: {
          kapiListesi: '11822 | Student\'s Book | ', duzen: 'otomatik', aktivasyon: 'yok',
          motor: { kalip: '/arsiv/45549/build.zip', dizin: 'book1', kurum: '60' }, kabuk: 'kalip',
          kitaplar: [{ n: 1 }], linkKarti: [], atlanan: [],
        },
        liste: { ham: '11822 | Student\'s Book | ', kaynak: 'claim' },
      };
    },
    merdiven: async () => { adimlar.push('merdiven'); return { satirlar: [{ kitap: 'book1', id: '11822', surum: 4, vs: 4, durum: 'GUNCEL' }] }; },
    panelMenuHizala: async () => { adimlar.push('panel'); return { hizali: false }; },
    imKeys: async () => { adimlar.push('imKeys'); return { rapor: null, kapi: { gecti: true, nedenler: [], nedenKodlari: [] } }; },
    menuBasligi: async () => { adimlar.push('menu'); return { degisen: [] }; },
  });
  const bag = {
    ...E.varsayilanBag(process.env),
    log: () => {},
    dbOku: async () => satir({ setListesi: '11822 | Student\'s Book | ' }),
    ilet: async () => { throw new Error('kuru kipte iletim olmamalı'); },
  };
  let sonuc;
  try {
    sonuc = await E.elleKur({ set: '11845', uygula: false, cikti: tmp('gercek'), platform: 'mac', surum: null }, bag);
  } finally {
    Object.assign(kaynakAdim, eski);
    CONFIG.packagerApi = eskiPackager;
    if (eskiMerdiven === undefined) delete process.env.EMPP_ARSIV_MERDIVEN;
    else process.env.EMPP_ARSIV_MERDIVEN = eskiMerdiven;
    runner._platformAyarla(null);
    await new Promise((ok) => packager.close(ok));
  }
  const { rapor, kod } = sonuc;
  assert.deepEqual(adimlar, ['uretec', 'merdiven', 'panel', 'imKeys', 'menu'], rapor.hata);
  assert.equal(gercekYayin, 0);
  assert.equal(packagerIstegi, 0);
  assert.ok(rapor.kapi, `kapıya varılmadı: ${rapor.hata}`);
  assert.equal(kod, rapor.kapi.gecti ? 0 : 1);
  assert.ok(rapor.ozet && /^[0-9a-f]{64}$/.test(rapor.ozet.sha256));
  assert.ok(fs.existsSync(rapor.zip));
  assert.equal(rapor.uretec.kalip, '45549');
  assert.equal(rapor.merdiven[0].durum, 'GUNCEL');
  assert.ok(rapor.zipKok.some((z) => z.ad === 'book1/'));
  assert.ok(rapor.gecit.every((g) => !g.iletildi));
  assert.equal(CONFIG.apiBase, eskiApi);
});
