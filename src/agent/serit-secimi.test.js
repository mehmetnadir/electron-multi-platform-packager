'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  nabizAyristir, seritKarari, yetenekleriUygula, olayMetni, nabizOkuyucu, ESIK_MS,
} = require('./serit-secimi');

const T = Date.parse('2026-09-24T12:00:00Z');
const nabiz = (ek = {}) => nabizAyristir(JSON.stringify({
  zaman: new Date(T - 60000).toISOString(), ajan: 'active', diskBosGb: 130, dolulukYuzde: 40, ...ek,
}));

test('taze nabız + yeterli disk → ProBook sağlıklı, Mac pardus ALMAZ', () => {
  const k = seritKarari({ nabiz: nabiz(), simdi: T });
  assert.equal(k.probookSaglikli, true);
  assert.equal(k.macPardusAlsin, false);
  assert.deepEqual(yetenekleriUygula(['android', 'macos', 'pardus'], k), ['android', 'macos']);
});

test('nabız 10 dk+ bayat → Mac devralır', () => {
  const n = nabizAyristir(JSON.stringify({ zaman: new Date(T - ESIK_MS - 1000).toISOString(), ajan: 'active', diskBosGb: 130 }));
  const k = seritKarari({ nabiz: n, simdi: T });
  assert.equal(k.macPardusAlsin, true);
  assert.match(k.sebep, /nabız bayat \(10 dk\)/);
  assert.deepEqual(yetenekleriUygula(['android', 'pardus'], k), ['android', 'pardus']);
});

test('eşik sınırı: tam 10 dk hâlâ taze sayılır (> ile karşılaştırma)', () => {
  const n = nabizAyristir(JSON.stringify({ zaman: new Date(T - ESIK_MS).toISOString(), ajan: 'active', diskBosGb: 130 }));
  assert.equal(seritKarari({ nabiz: n, simdi: T }).probookSaglikli, true);
});

test('nabız okunamadı / bozuk JSON → Mac devralır', () => {
  assert.equal(nabizAyristir('{bozuk'), null);
  assert.equal(nabizAyristir(''), null);
  assert.equal(nabizAyristir('{"zaman":"dün"}'), null);
  assert.equal(seritKarari({ nabiz: null, simdi: T }).macPardusAlsin, true);
});

test('disk kapısı düşük ya da doluluk %85 üstü → Mac devralır', () => {
  assert.match(seritKarari({ nabiz: nabiz({ diskBosGb: 12 }), simdi: T }).sebep, /disk kapısı düşük \(12 GB/);
  assert.match(seritKarari({ nabiz: nabiz({ dolulukYuzde: 90 }), simdi: T }).sebep, /doluluğu %90/);
});

test('ajan birimi aktif değil → Mac devralır (nabız taze olsa bile)', () => {
  const k = seritKarari({ nabiz: nabiz({ ajan: 'failed' }), simdi: T });
  assert.equal(k.macPardusAlsin, true);
  assert.match(k.sebep, /ajan failed/);
});

test('sunucu ajanı 10 dk+ görmediyse Mac devralır', () => {
  const k = seritKarari({ nabiz: nabiz(), simdi: T, sunucuSonGorulmeMs: T - ESIK_MS - 60000 });
  assert.equal(k.macPardusAlsin, true);
  assert.match(k.sebep, /sunucu ajanı 11 dk görmedi/);
});

test('olaylar: yalnız karar DEĞİŞİNCE üretilir', () => {
  const devir = seritKarari({ nabiz: null, simdi: T, oncekiMacAlir: false });
  assert.equal(devir.olay, 'devir');
  assert.match(olayMetni(devir), /Mac'e devredildi — nabız okunamadı/);
  const donus = seritKarari({ nabiz: nabiz(), simdi: T, oncekiMacAlir: true });
  assert.equal(donus.olay, 'geri-birak');
  assert.match(olayMetni(donus), /ProBook'a döndü/);
  assert.equal(seritKarari({ nabiz: nabiz(), simdi: T, oncekiMacAlir: false }).olay, null);
  assert.equal(seritKarari({ nabiz: nabiz(), simdi: T }).olay, null, 'ilk kararda olay yok');
});

test('karar yoksa yetenekler aynen kalır (güvenli taraf: Mac alır)', () => {
  assert.deepEqual(yetenekleriUygula(['pardus'], null), ['pardus']);
  assert.deepEqual(yetenekleriUygula(null, null), []);
});

test('nabizOkuyucu: ssh ile okur, 60 sn önbellekler, hata → null', () => {
  let cagri = 0; let simdi = T; let cevap = { code: 0, stdout: JSON.stringify({ zaman: new Date(T).toISOString() }) };
  const oku = nabizOkuyucu({
    host: 'x@h', saat: () => simdi,
    calistir: (cmd, args) => { cagri++; assert.equal(cmd, 'ssh'); assert.ok(args.includes('x@h')); return cevap; },
  });
  assert.equal(oku().zamanMs, T);
  simdi += 30000; oku();
  assert.equal(cagri, 1, 'önbellek içinde yeniden ssh yok');
  simdi += 31000; cevap = { code: 255, stdout: '' };
  assert.equal(oku(), null);
  assert.equal(cagri, 2);
});

// ---------------------------------------------------------------------------
// 2026-09-26 — runner bağlantısı: API/arşiv alanları, async okuyucu, denetçi, eşleyici.
// ---------------------------------------------------------------------------
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  seritDenetcisiKur, nabizOkuyucuAsenkron, arsivEsleyici, olayBildirici, probookHostSec,
} = require('./serit-secimi');

test('ProBook API ok değilse Mac devralır; alan yoksa (eski nabız) engellemez', () => {
  assert.match(seritKarari({ nabiz: nabiz({ api: 'hata' }), simdi: T }).sebep, /ProBook API hata/);
  assert.match(seritKarari({ nabiz: nabiz({ api: 'yetkisiz' }), simdi: T }).sebep, /ProBook API yetkisiz/);
  assert.equal(seritKarari({ nabiz: nabiz({ api: 'ok' }), simdi: T }).probookSaglikli, true);
  assert.equal(seritKarari({ nabiz: nabiz(), simdi: T }).probookSaglikli, true);
});

test('kaynak arşivi: Mac özeti verildiyse ProBook özeti eşit olmalı, yoksa Mac alır', () => {
  assert.equal(seritKarari({ nabiz: nabiz({ arsivOzeti: 'abc' }), simdi: T, arsivOzeti: 'abc' }).probookSaglikli, true);
  assert.match(seritKarari({ nabiz: nabiz({ arsivOzeti: 'abc' }), simdi: T, arsivOzeti: 'def' }).sebep, /kaynak arşivi farklı/);
  assert.match(seritKarari({ nabiz: nabiz(), simdi: T, arsivOzeti: 'def' }).sebep, /arşivi özeti yok/);
  assert.equal(seritKarari({ nabiz: nabiz({ arsivOzeti: 'abc' }), simdi: T }).probookSaglikli, true, 'Mac özeti yoksa kıyas yok');
});

test('probookHostSec: açık EMPP_PROBOOK_HOST > PROBOOK_HOST (yerel değilse) > Tailscale', () => {
  assert.equal(probookHostSec({ EMPP_PROBOOK_HOST: 'a@b', PROBOOK_HOST: 'c@d' }), 'a@b');
  assert.equal(probookHostSec({ PROBOOK_HOST: 'etapadmin@192.168.1.55' }), 'etapadmin@192.168.1.55');
  assert.equal(probookHostSec({ PROBOOK_HOST: 'yerel' }), 'etapadmin@100.73.161.76');
  assert.equal(probookHostSec({}), 'etapadmin@100.73.161.76');
});

test('denetçi: bayrak yoksa ya da pardus yeteneği yoksa null (runner davranışı aynı)', () => {
  assert.equal(seritDenetcisiKur({ env: {}, caps: ['pardus'] }), null);
  assert.equal(seritDenetcisiKur({ env: { EMPP_PROBOOK_SERIT: '0' }, caps: ['pardus'] }), null);
  assert.equal(seritDenetcisiKur({ env: { EMPP_PROBOOK_SERIT: '1' }, caps: ['android', 'macos'] }), null);
});

test('denetçi: ilk okumadan önce Mac ALIR; taze nabızda düşer; 60 sn kısma; tek uçuş', async () => {
  let simdi = T; let okuma = 0; let cevap = nabiz(); let bekle = null;
  const d = seritDenetcisiKur({
    env: { EMPP_PROBOOK_SERIT: '1' }, caps: ['android', 'pardus'], saat: () => simdi,
    okuyucu: async () => { okuma++; if (bekle) await bekle; return cevap; },
  });
  assert.deepEqual(d.uygula(['android', 'pardus']), ['android', 'pardus'], 'karar yokken güvenli taraf');
  assert.equal(d.ozet(), 'ölçülmedi');
  await d.tazele();
  assert.deepEqual(d.uygula(['android', 'pardus']), ['android']);
  assert.match(d.ozet(), /^ProBook \(ProBook sağlıklı\)/);
  simdi += 30000; await d.tazele();
  assert.equal(okuma, 1, '60 sn içinde yeniden okuma yok');
  simdi += 31000;
  let coz; bekle = new Promise((r) => { coz = r; });
  const a = d.tazele(); const b = d.tazele();
  coz(); await Promise.all([a, b]);
  assert.equal(okuma, 2, 'aynı anda tek okuma');
});

test('denetçi: okuyucu hata fırlatırsa Mac alır; karar değişince olay + bildirim', async () => {
  let simdi = T; let hata = false; const olaylar = []; const loglar = [];
  const d = seritDenetcisiKur({
    env: { EMPP_PROBOOK_SERIT: '1' }, caps: ['pardus'], saat: () => simdi, log: (m) => loglar.push(m),
    olayBildir: (k) => olaylar.push(k.olay),
    okuyucu: async () => { if (hata) throw new Error('ssh'); return nabiz(); },
  });
  await d.tazele();
  assert.deepEqual(olaylar, [], 'ilk kararda olay yok');
  hata = true; simdi += 61000; await d.tazele();
  assert.deepEqual(d.uygula(['pardus']), ['pardus']);
  assert.deepEqual(olaylar, ['devir']);
  hata = false; simdi += 61000; await d.tazele({ zorla: true });
  assert.deepEqual(olaylar, ['devir', 'geri-birak']);
  assert.ok(loglar.some((l) => /Mac'e devredildi — nabız okunamadı/.test(l)));
});

test('denetçi: arşiv farkında eşleyici tetiklenir, nabız yokken tetiklenmez', async () => {
  let cevap = nabiz({ arsivOzeti: 'pb' }); const tetik = [];
  const d = seritDenetcisiKur({
    env: { EMPP_PROBOOK_SERIT: '1' }, caps: ['pardus'], saat: () => T, aralikMs: 0,
    okuyucu: async () => cevap, arsivOzetiFn: () => 'mac', arsivEsle: (s) => tetik.push(s),
  });
  await d.tazele();
  assert.equal(d.karar().macPardusAlsin, true);
  assert.equal(tetik.length, 1);
  cevap = null; await d.tazele();
  assert.equal(tetik.length, 1, 'ProBook okunamıyorsa eşleme denenmez');
  cevap = nabiz({ arsivOzeti: 'mac' }); await d.tazele();
  assert.equal(d.karar().probookSaglikli, true);
});

test('nabizOkuyucuAsenkron: dosya kipi; ssh kipi argümanları, rc!=0 → null, zaman aşımı → null', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nabiz-dosya-')), 'n.json');
  fs.writeFileSync(f, JSON.stringify({ zaman: new Date(T).toISOString() }));
  assert.equal((await nabizOkuyucuAsenkron({ dosya: f })()).zamanMs, T);
  assert.equal(await nabizOkuyucuAsenkron({ dosya: f + '.yok' })(), null);
  const sahte = (davranis) => (cmd, args) => {
    const p = new EventEmitter(); p.stdout = new EventEmitter(); p.kill = () => { p.olduruldu = true; };
    sahte.son = { cmd, args };
    setImmediate(() => davranis(p));
    return p;
  };
  const ok = await nabizOkuyucuAsenkron({ host: 'x@h', anahtar: '/k', spawnImpl: sahte((p) => {
    p.stdout.emit('data', JSON.stringify({ zaman: new Date(T).toISOString() })); p.emit('close', 0);
  }) })();
  assert.equal(ok.zamanMs, T);
  assert.equal(sahte.son.cmd, 'ssh');
  assert.deepEqual(sahte.son.args.slice(-3), ['/k', 'x@h', 'cat ~/empp-serit/log/nabiz.json']);
  assert.equal(await nabizOkuyucuAsenkron({ spawnImpl: sahte((p) => p.emit('close', 255)) })(), null);
  assert.equal(await nabizOkuyucuAsenkron({ zamanAsimiMs: 20, spawnImpl: sahte(() => {}) })(), null);
});

test('arsivEsleyici: aralık içinde bir kez başlatır (detached bash --host)', () => {
  let simdi = T; const cagri = [];
  const t = arsivEsleyici({ betik: '/b.sh', host: 'x@h', saat: () => simdi, spawnImpl: (c, a, o) => { cagri.push([c, a, o.detached]); return { on() {}, unref() {} }; } });
  assert.equal(t('fark'), true);
  simdi += 60000; assert.equal(t('fark'), false);
  simdi += 10 * 60 * 1000; assert.equal(t('fark'), true);
  assert.deepEqual(cagri[0], ['bash', ['/b.sh', '--host', 'x@h'], true]);
  assert.equal(cagri.length, 2);
});

test('olayBildirici: yalnız olayda, bildir paket kanalına; EMPP_BILDIRIM=0 susturur', () => {
  const cagri = [];
  const spawnImpl = (c, a) => { cagri.push([c, a]); return { on() {}, unref() {} }; };
  const b = olayBildirici({ env: { EMPP_BILDIR_IKILI: '/bin/bildir' }, spawnImpl });
  assert.equal(b({ olay: null }), false);
  assert.equal(b({ olay: 'devir', sebep: 'nabız bayat (12 dk)' }), true);
  assert.equal(cagri[0][0], '/bin/bildir');
  assert.equal(cagri[0][1][0], 'paket');
  assert.match(cagri[0][1][1], /Mac'e devredildi — nabız bayat/);
  assert.equal(olayBildirici({ env: { EMPP_BILDIRIM: '0' }, spawnImpl })({ olay: 'devir', sebep: 'x' }), false);
});

test('denetçi: zorla çağrısı uçuştaki ESKİ okumayı paylaşmaz, bitmesini bekleyip taze okur', async () => {
  let cevap = null; let coz; let okuma = 0;
  const d = seritDenetcisiKur({
    env: { EMPP_PROBOOK_SERIT: '1' }, caps: ['pardus'], saat: () => T,
    okuyucu: async () => { okuma++; const c = cevap; if (okuma === 1) await new Promise((r) => { coz = r; }); return c; },
  });
  const eski = d.tazele();            // eski durum (nabız yok) okunuyor
  cevap = nabiz();                    // bu arada ProBook nabız yazdı
  const taze = d.tazele({ zorla: true });
  coz();
  await Promise.all([eski, taze]);
  assert.equal(okuma, 2);
  assert.equal(d.karar().probookSaglikli, true);
});
