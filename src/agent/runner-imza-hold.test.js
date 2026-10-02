'use strict';

/**
 * Windows "imza bekliyor" TUTMA + imza eşiği (2026-10-02, dal imza-hold-20261002).
 * Gerçek yuva/İmpark/sunucu YOK: sahte API (http), sahte imza betiği (bash), geçici kökler.
 *
 *  (A) releaseJobYanit: yeni sunucu `tutuldu:true` → tutuldu; eski sunucu (alan yok) → ok ama tutuldu DEĞİL
 *  (B) imzaBekliyorBildir: `durum:'imza-bekliyor'` gönderir; currentJob release'ten ÖNCE düşer (kaynak sırası)
 *  (C) hazirAyarlari: esik varsayılan 5 dk, env ile değişir, EMPP_WIN_IMZA_BEKLEME=0 / ESIK_DK=0 kapatır
 *  (D) imzaKilidiAl: kilit eşikte boşalmazsa imzaEsigiHatasi (yuvaya dokunulmadan); eşiksiz davranış aynı
 *  (E) imzaBekleVeTak: pencere beklenirken eşik KESER; takas başladıysa ASLA kesmez (yuva paylaşımlı)
 *  (F) bağlantı: runner eşiği zincire geçirir, esik hatasında hazır kuyruğa alır, kill switch dalı
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { izoleOrtam } = require('./test-yalitim');
const YALITIM = izoleOrtam();
after(() => YALITIM.temizle());

const runner = require('./runner');
const W = require('./windows-serit');
const H = require('./windows-hazir');

const tmp = (ad) => fs.mkdtempSync(path.join(os.tmpdir(), `imza-hold-${ad}-`));
const AUTH = { agentId: 'ajan-test', token: 'tok-123' };
const IS = { bookId: '73768', platform: 'windows' };

async function sahteApi(yanit, govde) {
  const istekler = [];
  const sunucu = http.createServer((req, res) => {
    let g = '';
    req.on('data', (c) => { g += c; });
    req.on('end', () => { istekler.push({ url: req.url, govde: g }); yanit(res); });
  });
  await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
  const onceki = runner.CONFIG.apiBase;
  runner.CONFIG.apiBase = `http://127.0.0.1:${sunucu.address().port}`;
  try { return await govde(istekler); } finally {
    runner.CONFIG.apiBase = onceki;
    await new Promise((r) => sunucu.close(r));
  }
}

test('(A) releaseJobYanit: tutuldu:true yalnız yeni sunucuda; eski sunucu ok ama tutuldu DEĞİL; hata → ok:false', async () => {
  await sahteApi((res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok","tutuldu":true,"durum":"imza-bekliyor"}'); },
    async () => assert.deepEqual(await runner.releaseJobYanit(AUTH, IS, 's', { durum: 'imza-bekliyor' }), { ok: true, tutuldu: true }));
  await sahteApi((res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}'); },
    async () => assert.deepEqual(await runner.releaseJobYanit(AUTH, IS, 's', { durum: 'imza-bekliyor' }), { ok: true, tutuldu: false }));
  await sahteApi((res) => { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end('{"error":"lease_not_held"}'); },
    async () => assert.deepEqual(await runner.releaseJobYanit(AUTH, IS, 's', { durum: 'imza-bekliyor' }), { ok: false, tutuldu: false }));
  // releaseJob eski sözleşmesi (boolean) bozulmaz
  await sahteApi((res) => { res.writeHead(200); res.end('{"status":"ok","tutuldu":true}'); },
    async () => assert.strictEqual(await runner.releaseJob(AUTH, IS, 's'), true));
});

test('(B) imzaBekliyorBildir /release\'e durum=imza-bekliyor + hazır adını yollar', async () => {
  const kok = tmp('b');
  await sahteApi((res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok","tutuldu":true}'); },
    async (istekler) => {
      const r = await runner.imzaBekliyorBildir(AUTH, IS, { dizin: path.join(kok, '73768-2.1.1') }, 'yuva meşgul');
      assert.deepEqual(r, { ok: true, tutuldu: true });
      const g = JSON.parse(istekler[0].govde);
      assert.equal(istekler[0].url, '/agents/ajan-test/release');
      assert.equal(g.durum, 'imza-bekliyor');
      assert.equal(g.hazir, '73768-2.1.1');
      assert.match(g.sebep, /^\[imza-bekliyor\] yuva meşgul/);
    });
  const kaynak = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
  const f = kaynak.slice(kaynak.indexOf('async function imzaBekliyorBildir'));
  const govde = f.slice(0, f.indexOf('\n}\n'));
  assert.ok(govde.indexOf('currentJob = null') > -1 && govde.indexOf('currentJob = null') < govde.indexOf('releaseJobYanit('),
    'heartbeat NULL lease\'i tazeleyip tutmayı bozmasın: currentJob release\'ten ÖNCE düşer');
});

test('(C) hazirAyarlari: esik 5 dk varsayılan; env ile değişir; kill switch ve ESIK_DK=0 kapatır', () => {
  assert.equal(H.hazirAyarlari({}).winImzaEsikMs, 5 * 60 * 1000);
  assert.equal(H.hazirAyarlari({ EMPP_WIN_IMZA_ESIK_DK: '12' }).winImzaEsikMs, 12 * 60 * 1000);
  assert.equal(H.hazirAyarlari({ EMPP_WIN_IMZA_ESIK_DK: '0' }).winImzaEsikMs, 0);
  assert.equal(H.hazirAyarlari({ EMPP_WIN_IMZA_BEKLEME: '0' }).winImzaEsikMs, 0, 'kill switch eşiği de kapatır');
  assert.equal(H.hazirAyarlari({ EMPP_WIN_IMZA_ESIK_DK: 'abc' }).winImzaEsikMs, 0, 'bozuk değer → kapalı (eski davranış)');
});

test('(D) imzaKilidiAl: kilit eşikte boşalmazsa imzaEsigiHatasi; boşsa eşikli de kilidi alır', async () => {
  const d = tmp('d');
  const cfg = {
    ...W.varsayilanAyarlar(), winImzaKilit: path.join(d, 'imza.kilit'), winImzaKilitAralikMs: 10,
    winImzaYabanciDesen: 'asla-eslesmeyen-desen-imza-hold-test',
  };
  const tutucu = await W.kilitDene(cfg.winImzaKilit);
  assert.ok(tutucu.tutucu, 'test kilidi alındı');
  try {
    await assert.rejects(
      W.imzaKilidiAl(cfg, { log: () => {}, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), esikBitisMs: Date.now() + 80 }),
      (e) => W.imzaEsigiMi(e) && e.message.includes(W.IMZA_ESIK_ISARETI),
    );
  } finally {
    await W.kilitBirak(tutucu.tutucu);
  }
  const birak = await W.imzaKilidiAl(cfg, { log: () => {}, sleep: async () => {}, esikBitisMs: Date.now() + 5000 });
  await birak();
});

/** Sahte imza betiği: argümanlar `<komut> <exe>`; senaryo ortam değişkeninden. */
function sahteBetik(dizin, govde) {
  const p = path.join(dizin, 'imza.sh');
  fs.writeFileSync(p, `#!/bin/bash\n${govde}\n`, { mode: 0o755 });
  return p;
}
const imzaCfg = (d, betik) => ({
  ...W.varsayilanAyarlar(), winImzaKabuk: 'bash', winImzaBetigi: betik, winImzaTetik: ['true'],
  winImzaTimeoutMs: 20000, winImzaYuvaKoku: path.join(d, 'yuva'),
});

test('(E1) imzaBekleVeTak: pencere BEKLENİRKEN eşik betiği keser → imzaEsigiHatasi', async () => {
  const d = tmp('e1');
  const betik = sahteBetik(d, 'echo "PENCERE BEKLENİYOR — exe-create tetiği"; sleep 30');
  const t0 = Date.now();
  await assert.rejects(
    W.imzaBekleVeTak({ exe: path.join(d, 'k.exe'), work: d, cfg: imzaCfg(d, betik), log: () => {}, esikBitisMs: Date.now() + 300 }),
    (e) => W.imzaEsigiMi(e),
  );
  assert.ok(Date.now() - t0 < 10000, 'betik 30 sn beklenmeden kesildi');
});

test('(E2) imzaBekleVeTak: TAKAS BAŞLADIYSA eşik geçse de betik kesilmez, imzalı kopya döner', async () => {
  const d = tmp('e2');
  const betik = sahteBetik(d, [
    'echo "PENCERE: İmpark dosyası yuvada — takas"',
    'sleep 2',
    'echo "takas tamam — imza bekleniyor"',
    'mkdir -p "$IMZALI_DIZIN"',
    'exe="$2"; b="$(basename "$exe" .exe)"',
    'echo SIGNED > "$IMZALI_DIZIN/$b-imzali.exe"',
    'exit 0',
  ].join('\n'));
  const exe = path.join(d, 'kitap.exe');
  fs.writeFileSync(exe, 'x');
  const imzali = await W.imzaBekleVeTak({ exe, work: d, cfg: imzaCfg(d, betik), log: () => {}, esikBitisMs: Date.now() + 300 });
  assert.ok(fs.existsSync(imzali), 'takas sürerken eşik KESMEDİ');
});

test('(E3) esikBitisMs=0 (bekçi / eşik kapalı): betik eşik olmadan sonuna kadar çalışır', async () => {
  const d = tmp('e3');
  const betik = sahteBetik(d, [
    'echo "PENCERE BEKLENİYOR"; sleep 1',
    'mkdir -p "$IMZALI_DIZIN"; b="$(basename "$2" .exe)"; echo S > "$IMZALI_DIZIN/$b-imzali.exe"; exit 0',
  ].join('\n'));
  const exe = path.join(d, 'kitap.exe');
  fs.writeFileSync(exe, 'x');
  const imzali = await W.imzaBekleVeTak({ exe, work: d, cfg: imzaCfg(d, betik), log: () => {}, esikBitisMs: 0 });
  assert.ok(fs.existsSync(imzali));
});

test('(F) bağlantı: eşik zincire geçer, esik hatası hazır kuyruğa alır, kill switch eşiği kapatır, bekçi esiksiz', () => {
  const serit = fs.readFileSync(path.join(__dirname, 'windows-serit.js'), 'utf8');
  const runnerSrc = fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8');
  const bekci = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'windows', 'imza-bekcisi.js'), 'utf8');
  assert.match(serit, /const esikMs = cfg\.winHazirAcik \? Number\(cfg\.winImzaEsikMs\) \|\| 0 : 0;/);
  assert.match(serit, /if \(!imzaEsigiMi\(e\)\) throw e;[\s\S]{0,300}return hazirdaTut\(/);
  assert.match(runnerSrc, /esikMs: CONFIG\.winHazirAcik \? Number\(CONFIG\.winImzaEsikMs\) \|\| 0 : 0/);
  assert.match(runnerSrc, /imzaEsigiMi\(e\)[\s\S]{0,400}imzaBekliyorBildir\(auth, job, bekleyen/);
  assert.doesNotMatch(bekci, /winImzaEsikMs/, 'bekçi eşik KULLANMAZ (kendi kilit tavanı var)');
});
