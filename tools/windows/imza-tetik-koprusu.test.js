'use strict';

/** İmza tetik köprüsü (Mac): kasanın isteklerini sabit argv ile çalıştırır, birleştirir, reddeder, taşır. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const K = require('./imza-tetik-koprusu');
const I = require('../../src/agent/imza-istek');

function yerelUzak(d) {
  const tasinan = [];
  return {
    tasinan,
    listele: () => fs.readdirSync(d).filter((a) => I.AD_DESENI.test(a)),
    oku: (ad) => fs.readFileSync(path.join(d, ad), 'utf8'),
    tasi: (ad, s) => { tasinan.push([ad, s]); fs.renameSync(path.join(d, ad), path.join(d, `${ad}.${s}`)); return true; },
    // K2: kasadaki cmd move'un yerel eşi (rename atomik; kaynak yoksa başarısız)
    sahiplen: (ad, etiket) => {
      fs.mkdirSync(path.join(d, 'isleniyor'), { recursive: true });
      try { fs.renameSync(path.join(d, ad), path.join(d, 'isleniyor', `${ad}.${etiket}`)); } catch (_) { return null; }
      return `${ad}.${etiket}`;
    },
    bitir: (isAd, ad, s) => {
      tasinan.push([ad, s]);
      fs.mkdirSync(path.join(d, 'islendi'), { recursive: true });
      try { fs.renameSync(path.join(d, 'isleniyor', isAd), path.join(d, 'islendi', `${ad}.${s}`)); } catch (_) { return false; }
      return true;
    },
    geriAl: (isAd, ad) => {
      try { fs.renameSync(path.join(d, 'isleniyor', isAd), path.join(d, ad)); } catch (_) { return false; }
      return true;
    },
    isleniyorListele: () => { try { return fs.readdirSync(path.join(d, 'isleniyor')); } catch (_) { return []; } },
  };
}

test('iki exe-create + bir exe-remove: create TEK kez çalışır, hepsi taşınır; argv sabit tablodan', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kopru-'));
  let t = Date.now();
  const simdi = () => (t += 10);
  await I.istekYaz(d, 'exe-remove', {}, { simdi });
  await I.istekYaz(d, 'exe-create', {}, { simdi });
  await I.istekYaz(d, 'exe-create', {}, { simdi });
  const kosulan = [];
  const uzak = yerelUzak(d);
  const o = await K.tur({ uzak, kos: async (a) => { kosulan.push(a.join(' ')); return { kod: 0 }; }, log: () => {} });
  assert.deepEqual(kosulan, [
    'yayincilikadm book exe-remove --windows --yes 66902',
    'yayincilikadm book exe-create 66902 --wait 0',
  ]);
  assert.equal(o.islenen, 3);
  assert.deepEqual(uzak.tasinan.map((x) => x[1]), ['tamam', 'tamam', 'birlesik-tamam']);
  assert.equal(uzak.listele().length, 0);
});

test('sahte/bayat istek çalıştırılmaz, "red" olarak taşınır; --kuru hiçbir şey çalıştırmaz/taşımaz', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kopru2-'));
  const eski = Date.now() - 7 * 3600 * 1000;
  fs.writeFileSync(path.join(d, `${eski}-exe-create-1.json`), JSON.stringify({ komut: 'exe-create' }));
  fs.writeFileSync(path.join(d, `${Date.now()}-exe-remove-2.json`), JSON.stringify({ komut: 'exe-create', argv: ['rm', '-rf', '/'] }));
  const kosulan = [];
  const kos = async (a) => { kosulan.push(a); return { kod: 0 }; };
  const kuru = await K.tur({ uzak: yerelUzak(d), kos, log: () => {}, kuru: true });
  assert.equal(kuru.reddedilen, 2);
  assert.equal(fs.readdirSync(d).length, 2, 'kuru: taşıma yok');
  const uzak = yerelUzak(d);
  const o = await K.tur({ uzak, kos, log: () => {} });
  assert.equal(o.reddedilen, 2);
  assert.deepEqual(kosulan, []);
  assert.deepEqual(uzak.tasinan.map((x) => x[1]), ['red', 'red']);
});

test('ssh uzak ucu: güvensiz ad ile komut kurulmaz', () => {
  const cagri = [];
  const u = K.sshUzak({ ssh: 'h', dizin: 'C:\\d' }, (...a) => { cagri.push(a); return { status: 0, stdout: '' }; });
  assert.throws(() => u.oku('a" & del x & ".json'), /güvensiz ad/);
  assert.throws(() => u.tasi('x.json', 'tamam'), /güvensiz ad/);
  assert.equal(cagri.length, 0);
});

test('taşıma komutu: islendi VARKEN de move koşar (04.10: if-gövdesi & move tuzağı)', () => {
  const k = K.tasiKomutu('C:\\d', '1791099197917-exe-create-1.json', 'tamam');
  assert.equal(k, 'mkdir "C:\\d\\islendi" 2>nul & move /y "C:\\d\\1791099197917-exe-create-1.json" "C:\\d\\islendi\\1791099197917-exe-create-1.json.tamam"');
  assert.doesNotMatch(k, /if not exist/i, 'cmd: "if not exist X mkdir X & move" → move IF gövdesinde kalır');
  const cagri = [];
  const u = K.sshUzak({ ssh: 'h', dizin: 'C:\\d' }, (...a) => { cagri.push(a); return { status: 0, stdout: '' }; });
  assert.equal(u.tasi('1791099197917-exe-create-1.json', 'tamam'), true);
  assert.equal(cagri[0][1][cagri[0][1].length - 1], k);
});

test('taşıma tutmazsa istek İKİNCİ KEZ çalıştırılmaz (defter); taşıma yeniden denenir, loglanır', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kopru3-'));
  await I.istekYaz(d, 'exe-create', {});
  const kosulan = [];
  const loglar = [];
  const islenmis = new Set();
  let isaret = 0;
  const bozukUzak = { ...yerelUzak(d), bitir: () => false }; // K2: taşıma isleniyor\ → islendi\ adımında
  const kos = async (a) => { kosulan.push(a.join(' ')); return { kod: 0 }; };
  const o1 = await K.tur({ uzak: bozukUzak, kos, log: (m) => loglar.push(m), islenmis, isaretle: () => { isaret += 1; } });
  assert.equal(kosulan.length, 1);
  assert.equal(o1.tasinamayan, 1);
  assert.equal(isaret, 1);
  assert.ok(loglar.some((m) => /TAŞINAMADI/.test(m)));
  const o2 = await K.tur({ uzak: bozukUzak, kos, log: (m) => loglar.push(m), islenmis, isaretle: () => { isaret += 1; } });
  assert.equal(kosulan.length, 1, 'aynı istek ikinci turda yeniden çalıştı (04.10 döngüsü)');
  assert.equal(o2.tasinamayan, 1);
  const iyiUzak = yerelUzak(d);
  await K.tur({ uzak: iyiUzak, kos, log: () => {}, islenmis });
  assert.equal(kosulan.length, 1);
  assert.deepEqual(iyiUzak.tasinan.map((x) => x[1]), ['defter-tekrar']);
  assert.equal(iyiUzak.listele().length, 0);
  assert.deepEqual(iyiUzak.isleniyorListele(), []);
});

test('defter: diske yazılır/okunur, son 500 ad tutulur, bozuk dosya boş küme', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kopru4-'));
  const yol = path.join(d, 'alt', 'defter.json');
  assert.equal(K.defterOku(yol).size, 0);
  const s = new Set(Array.from({ length: 510 }, (_, i) => `a${i}`));
  K.defterYaz(yol, s);
  const g = K.defterOku(yol);
  assert.equal(g.size, 500);
  assert.ok(g.has('a509') && !g.has('a0'));
  fs.writeFileSync(yol, '{bozuk');
  assert.equal(K.defterOku(yol).size, 0);
});

const KILIT_METNI = 'yayincilikadm: hesap kilidi dolu. İş BAŞLAMADAN durduruldu — o iş bitince yeniden çalıştırın. YAYINCILIKADM_HESAP_KILIDI=0';

test('hesap kilidi metni: istek TAŞINMAZ, defterlenmez, "hesap kilidi" loglanır; sonraki turda yeniden denenir', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kopru5-'));
  await I.istekYaz(d, 'exe-create', {});
  const uzak = yerelUzak(d);
  const loglar = [];
  const islenmis = new Set();
  const o = await K.tur({ uzak, kos: async () => ({ kod: 1, cikti: KILIT_METNI }), log: (m) => loglar.push(m), islenmis });
  assert.equal(uzak.tasinan.length, 0);
  assert.equal(uzak.listele().length, 1);
  assert.equal(islenmis.size, 0);
  assert.equal(o.islenen, 0);
  assert.equal(o.kilitli, 1);
  assert.ok(loglar.some((m) => /hesap kilidi — sonraki turda yeniden/.test(m)));
  const kosulan = [];
  const o2 = await K.tur({ uzak, kos: async (a) => { kosulan.push(a); return { kod: 0 }; }, log: () => {}, islenmis });
  assert.equal(kosulan.length, 1);
  assert.equal(o2.islenen, 1);
  assert.equal(uzak.listele().length, 0);
});

test('başka hata → eski davranış (hata1 ile taşınır); başarı → tamam taşınır', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kopru6-'));
  await I.istekYaz(d, 'exe-create', {});
  const uzak = yerelUzak(d);
  await K.tur({ uzak, kos: async () => ({ kod: 1, cikti: 'panel 500' }), log: () => {} });
  assert.deepEqual(uzak.tasinan.map((x) => x[1]), ['hata1']);
  assert.equal(K.kilitMi({ kod: 0, cikti: KILIT_METNI }), false);
  assert.equal(K.kilitMi({ kod: 1, cikti: 'HESAP_KILIDI' }), true);
});

test('aynı turda kilitli birleşik istekler de taşınmaz; 3 ardışık kilit reddi tek bildirim', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kopru7-'));
  let t = Date.now();
  const simdi = () => (t += 10);
  for (let i = 0; i < 3; i += 1) await I.istekYaz(d, 'exe-create', {}, { simdi });
  const uzak = yerelUzak(d);
  const bildirimler = [];
  let cagri = 0;
  const o = await K.tur({ uzak, kos: async () => { cagri += 1; return { kod: 1, cikti: KILIT_METNI }; }, log: () => {}, bildir: (m) => bildirimler.push(m) });
  assert.equal(cagri, 1);
  assert.equal(o.kilitli, 3);
  assert.equal(uzak.tasinan.length, 0);
  assert.equal(bildirimler.length, 1);
  assert.match(bildirimler[0], /hesap kilidinde bekliyor \(exe-create\)/);
});

test('bildirim tavanı: saatte en çok 1; tek-kopya kilidi canlı pid ile ikinciyi reddeder', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kopru8-'));
  const damga = path.join(d, 'damga');
  const gonder = []; const t = 1e12;
  assert.equal(K.tavanliBildir(damga, 'a', (m) => gonder.push(m), () => t), true);
  assert.equal(K.tavanliBildir(damga, 'b', (m) => gonder.push(m), () => t + 59 * 60000), false);
  assert.equal(K.tavanliBildir(damga, 'c', (m) => gonder.push(m), () => t + 61 * 60000), true);
  assert.deepEqual(gonder, ['a', 'c']);
  const kilit = path.join(d, 'k.lock');
  assert.equal(K.tekKopyaAl(kilit, () => t, () => true), true);
  assert.equal(K.tekKopyaAl(kilit, () => t + 1000, () => true), false);
  assert.equal(K.tekKopyaAl(kilit, () => t + 1000, () => false), true, 'ölü pid');
  assert.equal(K.tekKopyaAl(kilit, () => t + 16 * 60000, () => true), true, 'bayat kilit');
});

// ------------------------------------------------------------------ nöbet (Mac ofiste, srv21 diğer zamanlarda)
// 05.10.2026 Pazartesi … 11.10.2026 Pazar. İstanbul = UTC+3 (yaz saati yok).
const ist = (gun, sa, dk, sn = 0) => Date.UTC(2026, 9, gun, sa - 3, dk, sn);
const PZT = 5; const CUM = 9; const CMT = 10; const PAZ = 11;

function nobetUzak(d) {
  const cagri = [];
  const temel = yerelUzak(d);
  const damgaYol = path.join(d, K.DAMGA_ADI);
  return {
    ...temel,
    cagri,
    listele: () => { cagri.push('listele'); return temel.listele(); },
    oku: (ad) => { cagri.push('oku'); return temel.oku(ad); },
    tasi: (ad, s) => { cagri.push('tasi'); return temel.tasi(ad, s); },
    damgaOku: () => { cagri.push('damgaOku'); try { return K.damgaCoz(fs.readFileSync(damgaYol, 'utf8')); } catch (_) { return null; } },
    damgaYaz: (konak, zaman, zorla) => {
      cagri.push('damgaYaz');
      fs.writeFileSync(damgaYol, `${JSON.stringify({ konak, zaman, zorla: zorla === true })}\r\n`);
      return true;
    },
  };
}
const konakCfg = (konak, kip) => ({ konak, kip });
const istekSay = (d) => fs.readdirSync(d).filter((a) => I.AD_DESENI.test(a)).length;

test('nöbet saati: 09:29 srv21 · 09:30 mac · 17:45 mac · 17:46 srv21; Cuma mac, hafta sonu srv21', () => {
  const N = K.saatNobetcisi;
  assert.equal(N(ist(PZT, 9, 29, 59)), 'srv21');
  assert.equal(N(ist(PZT, 9, 30)), 'mac');
  assert.equal(N(ist(PZT, 12, 0)), 'mac');
  assert.equal(N(ist(PZT, 17, 45)), 'mac');
  assert.equal(N(ist(PZT, 17, 45, 59)), 'mac');
  assert.equal(N(ist(PZT, 17, 46)), 'srv21');
  assert.equal(N(ist(PZT, 0, 0)), 'srv21');
  assert.equal(N(ist(PZT + 1, 2, 30)), 'srv21', 'UTC gece yarısı öncesi/sonrası');
  assert.equal(N(ist(CUM, 9, 30)), 'mac');
  assert.equal(N(ist(CUM, 17, 46)), 'srv21');
  assert.equal(N(ist(CMT, 12, 0)), 'srv21');
  assert.equal(N(ist(PAZ, 12, 0)), 'srv21');
  assert.equal(N(ist(PAZ, 23, 59)), 'srv21');
  assert.deepEqual(K.istanbulZamani(ist(PZT, 9, 30)), { gun: 1, dk: 570 });
});

test('nöbet saati konağın TZ ayarından bağımsız (srv21 Europe/Istanbul, Mac başka olabilir)', () => {
  const { spawnSync } = require('child_process');
  const kod = `const K=require(${JSON.stringify(require.resolve('./imza-tetik-koprusu'))});`
    + `process.stdout.write([${ist(PZT, 9, 29)},${ist(PZT, 9, 30)},${ist(PZT, 17, 46)}].map(K.saatNobetcisi).join(','))`;
  for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
    const r = spawnSync(process.execPath, ['-e', kod], { encoding: 'utf8', env: { ...process.env, TZ: tz } });
    assert.equal(r.stdout, 'srv21,mac,srv21', tz);
  }
});

test('ayarlar: konak yok → hep (eski davranış) · konak var → saat · EMPP_KOPRU_NOBET=zorla → zorla', () => {
  assert.deepEqual([K.ayarlar({}).konak, K.ayarlar({}).kip], ['mac', 'hep']);
  assert.deepEqual([K.ayarlar({ EMPP_KOPRU_KONAK: 'srv21' }).konak, K.ayarlar({ EMPP_KOPRU_KONAK: 'srv21' }).kip], ['srv21', 'saat']);
  assert.equal(K.ayarlar({ EMPP_KOPRU_KONAK: 'mac', EMPP_KOPRU_NOBET: 'zorla' }).kip, 'zorla');
  assert.equal(K.ayarlar({ EMPP_KASA_SSH_ANAHTAR: '/root/.ssh/kasa-kopru' }).anahtar, '/root/.ssh/kasa-kopru');
  assert.equal(K.ayarlar({}).anahtar, '');
});

test('nöbet hükmü: pasif / nöbetçi / taze yabancı → çekil / bayat yabancı → nöbetçi / zorla → devir', () => {
  const t = ist(CMT, 12, 0);
  const H = (konak, kip, damga, s = t) => K.nobetKarari({ konak, kip, simdiMs: s, damga });
  assert.equal(H('mac', 'saat', null).rol, 'pasif');
  assert.equal(H('srv21', 'saat', null).rol, 'nobetci');
  assert.equal(H('srv21', 'saat', null).damgaYaz, true);
  assert.equal(H('srv21', 'saat', { konak: 'srv21', zaman: t - 10000 }).rol, 'nobetci', 'kendi damgası engel değil');
  assert.equal(H('srv21', 'saat', { konak: 'mac', zaman: t - 2 * 60000 }).rol, 'cekildi');
  assert.equal(H('srv21', 'saat', { konak: 'mac', zaman: t - 2 * 60000 }).damgaYaz, false);
  assert.equal(H('srv21', 'saat', { konak: 'mac', zaman: t + 2 * 60000 }).rol, 'cekildi', 'ileri kaymış saat');
  assert.equal(H('srv21', 'saat', { konak: 'mac', zaman: t - K.DAMGA_TAZE_MS - 1000 }).rol, 'nobetci', 'bayat damga');
  assert.equal(H('mac', 'hep', null).rol, 'nobetci', 'hep: saatten bağımsız');
  assert.equal(H('mac', 'hep', { konak: 'srv21', zaman: t - 30000 }).rol, 'cekildi', 'hep de damgaya uyar');
  const dv = H('mac', 'zorla', { konak: 'srv21', zaman: t - 30000 });
  assert.deepEqual([dv.rol, dv.damgaYaz], ['devir', true]);
  assert.equal(H('mac', 'zorla', { konak: 'srv21', zaman: t - 30000, zorla: true }).rol, 'cekildi', 'iki zorla');
  assert.equal(H('pc', 'hep', null).rol, 'pasif', 'bilinmeyen konak');
});

test('damga: cmd komutu sabit biçim, konak beyaz listede; bozuk damga null', () => {
  assert.equal(K.damgaYazKomutu('C:\\d', 'srv21', 1791099197917.7, false),
    'mkdir "C:\\d" 2>nul & echo {"konak":"srv21","zaman":1791099197917,"zorla":false}>"C:\\d\\.nobetci.json"');
  assert.throws(() => K.damgaYazKomutu('C:\\d', 'x" & del', 1), /güvensiz konak/);
  assert.deepEqual(K.damgaCoz('{"konak":"mac","zaman":5,"zorla":true}\r\n'), { konak: 'mac', zaman: 5, zorla: true });
  assert.equal(K.damgaCoz(''), null);
  assert.equal(K.damgaCoz('{bozuk'), null);
  assert.equal(K.damgaCoz('{"konak":"pc","zaman":5}'), null);
  assert.equal(K.damgaCoz('{"konak":"mac"}'), null);
});

test('pasif konak isteği OKUMAZ/TÜKETMEZ: kasaya hiç dokunmaz, kos çağrılmaz', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nobet1-'));
  const t = ist(PZT, 11, 0);
  await I.istekYaz(d, 'exe-create', {}, { simdi: () => t });
  const uzak = nobetUzak(d);
  const kosulan = [];
  for (const [cfg, s] of [[konakCfg('srv21', 'saat'), t], [konakCfg('mac', 'saat'), ist(CMT, 11, 0)]]) {
    const o = await K.nobetliTur({ cfg, uzak, kos: async (a) => { kosulan.push(a); return { kod: 0 }; }, log: () => {}, simdi: () => s });
    assert.equal(o.rol, 'pasif');
  }
  assert.deepEqual(uzak.cagri, [], 'pasif konak listele/oku/damga çağırdı');
  assert.equal(kosulan.length, 0);
  assert.equal(istekSay(d), 1);
  // uzak=null ile de çalışır (ana() pasifte ssh ucu bile kurmaz)
  const o = await K.nobetliTur({ cfg: konakCfg('srv21', 'saat'), uzak: null, kos: null, log: () => {}, simdi: () => t });
  assert.equal(o.rol, 'pasif');
});

test('çift tetik freni: saat devrinde (17:45→17:46) srv21, Mac damgası bayatlayana dek çekilir', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nobet2-'));
  const uzak = nobetUzak(d);
  const kosulan = [];
  const kos = (kim) => async (a) => { kosulan.push(`${kim}:${a[2]}`); return { kod: 0 }; };
  const mac = konakCfg('mac', 'saat'); const srv = konakCfg('srv21', 'saat');
  const t0 = ist(PZT, 17, 45, 10);
  await I.istekYaz(d, 'exe-create', {}, { simdi: () => t0 - 5000 });
  let o = await K.nobetliTur({ cfg: mac, uzak, kos: kos('mac'), log: () => {}, simdi: () => t0 });
  assert.equal(o.rol, 'nobetci');
  assert.deepEqual(kosulan, ['mac:exe-create']);
  assert.equal(K.damgaCoz(fs.readFileSync(path.join(d, K.DAMGA_ADI), 'utf8')).konak, 'mac');
  // 17:46: yeni istek; Mac pasif (yazmaz), srv21 Mac'in taze damgasını görüp çekilir → kimse tüketmez
  const t1 = ist(PZT, 17, 46, 5);
  await I.istekYaz(d, 'exe-remove', {}, { simdi: () => t1 - 1000 });
  o = await K.nobetliTur({ cfg: mac, uzak, kos: kos('mac'), log: () => {}, simdi: () => t1 });
  assert.equal(o.rol, 'pasif');
  o = await K.nobetliTur({ cfg: srv, uzak, kos: kos('srv21'), log: () => {}, simdi: () => t1 + 1000 });
  assert.equal(o.rol, 'cekildi');
  assert.equal(istekSay(d), 1, 'çekilen konak isteği tüketti');
  assert.equal(K.damgaCoz(fs.readFileSync(path.join(d, K.DAMGA_ADI), 'utf8')).konak, 'mac', 'çekilen konak damga yazdı');
  // 17:49: Mac damgası 3 dk'yı aştı → srv21 nöbetçi
  o = await K.nobetliTur({ cfg: srv, uzak, kos: kos('srv21'), log: () => {}, simdi: () => ist(PZT, 17, 48, 11) });
  assert.equal(o.rol, 'nobetci');
  assert.deepEqual(kosulan, ['mac:exe-create', 'srv21:exe-remove']);
  assert.equal(istekSay(d), 0);
});

test('çift tetik freni (hep kipi): srv21 açılınca, konaksız eski Mac köprüsü damgasıyla srv21 boşta kalır', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nobet3-'));
  const uzak = nobetUzak(d);
  const kosulan = [];
  const t = ist(CMT, 3, 0);
  await I.istekYaz(d, 'exe-create', {}, { simdi: () => t - 1000 });
  const kos = (kim) => async () => { kosulan.push(kim); return { kod: 0 }; };
  // eski Mac (konak verilmemiş = hep) önce koştu
  await K.nobetliTur({ cfg: K.ayarlar({}), uzak, kos: kos('mac'), log: () => {}, simdi: () => t });
  await I.istekYaz(d, 'exe-remove', {}, { simdi: () => t + 30000 });
  const o = await K.nobetliTur({ cfg: konakCfg('srv21', 'saat'), uzak, kos: kos('srv21'), log: () => {}, simdi: () => t + 40000 });
  assert.equal(o.rol, 'cekildi');
  assert.deepEqual(kosulan, ['mac']);
});

test('tur ortasında karşı konak damga yazarsa sonraki komut çalışmaz, istek yerinde kalır', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nobet4-'));
  const t = ist(CMT, 12, 0);
  let n = 0;
  const simdi = () => t + (n += 1);
  await I.istekYaz(d, 'exe-remove', {}, { simdi: () => t - 2000 });
  await I.istekYaz(d, 'exe-create', {}, { simdi: () => t - 1000 });
  const uzak = nobetUzak(d);
  const kosulan = [];
  const kos = async (a) => {
    kosulan.push(a[2]);
    // ilk komut koşarken Mac (zorla) damga yazdı
    fs.writeFileSync(path.join(d, K.DAMGA_ADI), JSON.stringify({ konak: 'mac', zaman: t, zorla: true }));
    return { kod: 0 };
  };
  const loglar = [];
  const o = await K.nobetliTur({ cfg: konakCfg('srv21', 'saat'), uzak, kos, log: (m) => loglar.push(m), simdi });
  assert.equal(o.kesildi, true);
  assert.deepEqual(kosulan, ['exe-remove'], 'adlar zaman sırasıyla: önce exe-remove (t-2000)');
  assert.equal(istekSay(d), 1);
  assert.ok(loglar.some((m) => /nöbet karşı konağa geçti/.test(m)));
  assert.equal(K.damgaCoz(fs.readFileSync(path.join(d, K.DAMGA_ADI), 'utf8')).konak, 'mac', 'kesilen konak damgayı ezdi');
});

test('zorla devir el sıkışması: zorla önce yalnız damga yazar, karşı konak çekilir, sonraki turda zorla işler', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nobet5-'));
  const uzak = nobetUzak(d);
  const kosulan = [];
  const kos = (kim) => async () => { kosulan.push(kim); return { kod: 0 }; };
  const mac = konakCfg('mac', 'saat'); const srvZ = konakCfg('srv21', 'zorla');
  const t = ist(PZT, 11, 0);
  await K.nobetliTur({ cfg: mac, uzak, kos: kos('mac'), log: () => {}, simdi: () => t }); // Mac damgası
  await I.istekYaz(d, 'exe-create', {}, { simdi: () => t + 10000 });
  let o = await K.nobetliTur({ cfg: srvZ, uzak, kos: kos('srv21'), log: () => {}, simdi: () => t + 30000 });
  assert.equal(o.rol, 'devir');
  assert.deepEqual(K.damgaCoz(fs.readFileSync(path.join(d, K.DAMGA_ADI), 'utf8')), { konak: 'srv21', zaman: t + 30000, zorla: true });
  o = await K.nobetliTur({ cfg: mac, uzak, kos: kos('mac'), log: () => {}, simdi: () => t + 60000 });
  assert.equal(o.rol, 'cekildi');
  o = await K.nobetliTur({ cfg: srvZ, uzak, kos: kos('srv21'), log: () => {}, simdi: () => t + 90000 });
  assert.equal(o.rol, 'nobetci');
  assert.deepEqual(kosulan, ['srv21']);
  assert.equal(istekSay(d), 0);
});

test('damga yazılamazsa tur atlanır (freni kör konak iş yapmaz); --kuru damga yazmaz', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nobet6-'));
  const t = ist(CMT, 12, 0);
  await I.istekYaz(d, 'exe-create', {}, { simdi: () => t });
  const kosulan = [];
  const kos = async () => { kosulan.push(1); return { kod: 0 }; };
  const bozuk = { ...nobetUzak(d), damgaYaz: () => false };
  const o = await K.nobetliTur({ cfg: konakCfg('srv21', 'saat'), uzak: bozuk, kos, log: () => {}, simdi: () => t });
  assert.equal(o.rol, 'damga-yok');
  assert.equal(kosulan.length, 0);
  const uzak = nobetUzak(d);
  const k = await K.nobetliTur({ cfg: konakCfg('srv21', 'saat'), uzak, kos, log: () => {}, kuru: true, simdi: () => t });
  assert.equal(k.rol, 'nobetci');
  assert.ok(!uzak.cagri.includes('damgaYaz'));
  assert.equal(kosulan.length, 0);
  assert.equal(istekSay(d), 1);
});

test('kosOrtami: srv21 hesap devralmayı kapatır (başkasının işini öldürmez), Mac eski davranış', () => {
  assert.equal(K.kosOrtami('srv21', {}).YAYINCILIKADM_HESAP_DEVRAL_SN, '0');
  assert.equal(K.kosOrtami('srv21', {}).YAYINCILIKADM_HESAP_BEKLE, '90');
  assert.equal(K.kosOrtami('mac', {}).YAYINCILIKADM_HESAP_DEVRAL_SN, undefined);
  assert.equal(K.kosOrtami('srv21', { YAYINCILIKADM_HESAP_DEVRAL_SN: '3600' }).YAYINCILIKADM_HESAP_DEVRAL_SN, '3600');
});

test('ssh uzak ucu: anahtar verilirse -i + IdentitiesOnly; damga oku/yaz komutları', () => {
  const cagri = [];
  const u = K.sshUzak({ ssh: 'Administrator@h', dizin: 'C:\\d', anahtar: '/root/.ssh/kasa-kopru' },
    (...a) => { cagri.push(a); return { status: 0, stdout: '{"konak":"mac","zaman":7}\r\n' }; });
  assert.deepEqual(u.damgaOku(), { konak: 'mac', zaman: 7, zorla: false });
  assert.equal(u.damgaYaz('srv21', 9, false), true);
  const argv = cagri[0][1];
  assert.deepEqual(argv.slice(4, 8), ['-i', '/root/.ssh/kasa-kopru', '-o', 'IdentitiesOnly=yes']);
  assert.equal(argv[argv.length - 1], 'type "C:\\d\\.nobetci.json" 2>nul');
  assert.equal(cagri[1][1][cagri[1][1].length - 1], K.damgaYazKomutu('C:\\d', 'srv21', 9, false));
  const c2 = [];
  K.sshUzak({ ssh: 'h', dizin: 'C:\\d' }, (...a) => { c2.push(a); return { status: 0, stdout: '' }; }).listele();
  assert.ok(!c2[0][1].includes('-i'), 'anahtarsız Mac çağrısı değişmedi');
});

test('rol günlüğü yalnız rol değişince yazar', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nobet7-'));
  const y = path.join(d, 'rol');
  assert.equal(K.rolDegisti(y, 'pasif'), true);
  assert.equal(K.rolDegisti(y, 'pasif'), false);
  assert.equal(K.rolDegisti(y, 'nobetci'), true);
});

// ------------------------------------------------------------------ inceleme 06.10 (K1 + K2)
test('K1: 4 dk süren komut sırasında damga tazelenir → karşı konak ÇEKİLİR (çift exe-create yok)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'k1-'));
  const uzak = nobetUzak(d);
  const t0 = ist(CMT, 12, 0);
  let saat = t0;
  await I.istekYaz(d, 'exe-create', {}, { simdi: () => t0 - 1000 });
  const kosulan = [];
  let ikinciRol = null;
  const macKos = async (a) => {
    kosulan.push(`mac:${a[2]}`);
    for (let i = 0; i < 4; i += 1) { saat += 60000; t.mock.timers.tick(60000); }
    // 4. dakikada srv21 (zorla değil, hep kipi) turunu koşar
    const o = await K.nobetliTur({ cfg: { konak: 'srv21', kip: 'hep' },
      uzak, kos: async (b) => { kosulan.push(`srv21:${b[2]}`); return { kod: 0 }; }, log: () => {}, simdi: () => saat });
    ikinciRol = o.rol;
    return { kod: 0 };
  };
  const o = await K.nobetliTur({ cfg: { konak: 'mac', kip: 'hep' }, uzak, kos: macKos, log: () => {}, simdi: () => saat });
  assert.equal(o.rol, 'nobetci');
  assert.equal(ikinciRol, 'cekildi', 'karşı konak 4. dakikada bayat damga gördü');
  assert.deepEqual(kosulan, ['mac:exe-create']);
});

test('K1: kosAsenkron olay döngüsünü kilitlemez (setInterval komut sürerken tetiklenir)', async () => {
  let vurus = 0;
  const z = setInterval(() => { vurus += 1; }, 50);
  try {
    const r = await K.kosAsenkron([process.execPath, '-e', 'setTimeout(()=>{process.stdout.write("ok")},400)'], process.env, 5000);
    assert.equal(r.kod, 0);
    assert.equal(r.cikti, 'ok');
  } finally { clearInterval(z); }
  assert.ok(vurus >= 3, `setInterval komut sürerken ${vurus} kez tetiklendi`);
  const t = await K.kosAsenkron([process.execPath, '-e', 'setTimeout(()=>{},5000)'], process.env, 200);
  assert.notEqual(t.kod, 0, 'tavan aşımı başarı sayılmaz');
});

test('K2: komut öncesi isleniyor\\ altına sahiplenir; taşınamayan istek KARŞI KONAKTA yeniden koşmaz', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'k2-'));
  const t0 = ist(CMT, 12, 0);
  await I.istekYaz(d, 'exe-create', {}, { simdi: () => t0 - 1000 });
  const kosulan = [];
  const kos = (kim) => async (a) => { kosulan.push(`${kim}:${a[2]}`); return { kod: 0 }; };
  // Mac çalıştırır ama islendi\'ye taşıyamaz (ssh koptu)
  const macUzak = { ...yerelUzak(d), bitir: () => false };
  const loglar = [];
  const o1 = await K.tur({ uzak: macUzak, kos: kos('mac'), log: (m) => loglar.push(m), konak: 'mac',
    simdi: () => t0, islenmis: new Set() });
  assert.equal(o1.tasinamayan, 1);
  assert.equal(istekSay(d), 0, 'istek kökte kalmadı (isleniyor\\ altında)');
  assert.equal(fs.readdirSync(path.join(d, 'isleniyor')).length, 1);
  // srv21: ayrı defter (boş) — kökte istek yok, yeniden koşmaz
  const o2 = await K.tur({ uzak: yerelUzak(d), kos: kos('srv21'), log: (m) => loglar.push(m), konak: 'srv21',
    simdi: () => t0 + 120000, islenmis: new Set() });
  assert.deepEqual(kosulan, ['mac:exe-create']);
  assert.equal(o2.yetim, 0, '30 dk dolmadan yetim sayılmaz');
  // 31 dk sonra: yetim → yalnız raporlanır, geri alınmaz
  const o3 = await K.tur({ uzak: yerelUzak(d), kos: kos('srv21'), log: (m) => loglar.push(m), konak: 'srv21',
    simdi: () => t0 + 31 * 60000, islenmis: new Set() });
  assert.equal(o3.yetim, 1);
  assert.ok(loglar.some((m) => /YETİM/.test(m)));
  assert.equal(istekSay(d), 0, 'yetim imza-istek\\e geri alınmadı');
  assert.deepEqual(kosulan, ['mac:exe-create']);
});

test('K2: sahiplenme başarısızsa (başka konak aldı) komut ÇALIŞMAZ', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'k2b-'));
  await I.istekYaz(d, 'exe-create', {});
  const kosulan = [];
  const uzak = { ...yerelUzak(d), sahiplen: () => null };
  const o = await K.tur({ uzak, kos: async (a) => { kosulan.push(a); return { kod: 0 }; }, log: () => {} });
  assert.equal(kosulan.length, 0);
  assert.equal(o.sahiplenilemeyen, 1);
  assert.equal(o.islenen, 0);
});

test('K2: hesap kilidinde istek isleniyor\\den kökte geri alınır (iş koşmadı)', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'k2c-'));
  await I.istekYaz(d, 'exe-create', {});
  const uzak = yerelUzak(d);
  await K.tur({ uzak, kos: async () => ({ kod: 1, cikti: 'HESAP_KILIDI' }), log: () => {} });
  assert.equal(istekSay(d), 1, 'kilitli istek kökte yeniden denenmeli');
  assert.deepEqual(fs.readdirSync(path.join(d, 'isleniyor')), []);
});

test('K2: ssh komutları — sahiplen/bitir/geriAl atomik move, etiket ve ad beyaz listede', () => {
  const ad = '1791099197917-exe-create-1.json';
  assert.equal(K.sahiplenKomutu('C:\\d', ad, 'mac-1791099197999'),
    `mkdir "C:\\d\\isleniyor" 2>nul & move /y "C:\\d\\${ad}" "C:\\d\\isleniyor\\${ad}.mac-1791099197999"`);
  assert.equal(K.bitirKomutu('C:\\d', `${ad}.mac-1791099197999`, ad, 'tamam'),
    `mkdir "C:\\d\\islendi" 2>nul & move /y "C:\\d\\isleniyor\\${ad}.mac-1791099197999" "C:\\d\\islendi\\${ad}.tamam"`);
  assert.equal(K.geriAlKomutu('C:\\d', `${ad}.mac-1791099197999`, ad),
    `move /y "C:\\d\\isleniyor\\${ad}.mac-1791099197999" "C:\\d\\${ad}"`);
  assert.throws(() => K.sahiplenKomutu('C:\\d', ad, 'x" & del'), /güvensiz etiket/);
  assert.deepEqual(K.isleniyorCoz(`${ad}.srv21-1791099197999`), { isAd: `${ad}.srv21-1791099197999`, ad, konak: 'srv21', zaman: 1791099197999 });
  assert.equal(K.isleniyorCoz('rastgele.txt'), null);
  const cagri = [];
  const u = K.sshUzak({ ssh: 'h', dizin: 'C:\\d' }, (...a) => { cagri.push(a); return { status: 0, stdout: '' }; });
  assert.equal(u.sahiplen(ad, 'mac-1791099197999'), `${ad}.mac-1791099197999`);
  assert.equal(cagri[0][1][cagri[0][1].length - 1], K.sahiplenKomutu('C:\\d', ad, 'mac-1791099197999'));
  const u2 = K.sshUzak({ ssh: 'h', dizin: 'C:\\d' }, () => ({ status: 1, stdout: '' }));
  assert.equal(u2.sahiplen(ad, 'mac-1791099197999'), null, 'move başarısız → sahiplenilmedi');
});
