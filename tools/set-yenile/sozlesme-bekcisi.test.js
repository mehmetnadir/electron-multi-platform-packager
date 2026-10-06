'use strict';
/**
 * Sözleşme bekçisi testleri. Canlıya BAĞLANMAZ: ssh/rclone/bildir/HTTP sahte bağ (fixture) ile.
 * Koş: node --test tools/set-yenile/sozlesme-bekcisi.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const B = require('./sozlesme-bekcisi');

const ISTISNA_METNI = fs.readFileSync(path.join(__dirname, 'istisnalar.json'), 'utf8');
const SIMDI = Date.parse('2026-10-06T12:00:00+03:00');
const SA = 60 * 60 * 1000;
const hex = (s) => Buffer.from(s, 'utf8').toString('hex').toUpperCase();

function tsv(satirlar) {
  if (!satirlar.length) return '';
  const b = Object.keys(satirlar[0]);
  return `${[b.join('\t'), ...satirlar.map((r) => b.map((k) => (r[k] == null ? 'NULL' : String(r[k]))).join('\t'))].join('\n')}\n`;
}
const SEMA_TSV = tsv(Object.entries(B.SEMA).flatMap(([t, cs]) => cs.map((c) => ({ TABLE_NAME: t, COLUMN_NAME: c }))));

/** 45550 temel fikstürü: dört platform completed, kabuk kanonik, R2 build sonrası, İmpark = build. */
function fikstur(ust = {}) {
  const f = {
    kitaplar: [{ book_id: '45550', book_title: 'Shall We?! 6 Set', kaynak_kur_istegi_at: null, kaynak_modu: null, set_paket_sayaci: 7, kisa_kod: 'tlk2k' }],
    platformlar: B.PLATFORMLAR.map((p) => ({
      book_id: '45550', platform: p, status: 'completed', hata_hex: null, last_run_at: '2026-10-06 09:00:00',
      last_queued_at: '2026-10-06 08:08:07', kabuk_surum: '1.13.14', kabuk_durum: 'guncel', motor_sha12: '03e8af70a0f3',
      build_method: 'build', paket_sayaci: 7, r2_object_key: `softwares/45550/SW6.${{ windows: 'exe', pardus: 'impark', mac: 'dmg', android: 'apk' }[p]}`,
      file_size_bytes: 100,
    })),
    listeler: [{ book_id: '45550', liste_hex: hex('25776 | Reference Book | \n25786 | Workbook | \n66903 | Games |  | games\nlink:https://x.example/ws | WS') }],
    buildler: [{
      set_id: '45550', surum: '2.25.7', durum: 'gecerli', kaynak: 'uretec', olusturma: '2026-10-06 08:08:16.958',
      kitaplar_hex: hex(JSON.stringify([{ n: 1, id: '25776', vs: 13 }, { n: 2, id: '25786', vs: 2 }])),
    }],
    impark: { 25776: 13, 25786: 2 },
    panel: { 45550: [] },
    r2: { 45550: ['exe', 'impark', 'dmg', 'apk'].map((u) => `      100 2026-10-06 09:00:05.000000000 SW6.${u}`).join('\n') },
    g: { 45550: { status: 200, govde: JSON.stringify({ surum: '2.25.8', uretim: '2026-10-06T08:36:42.003Z', setKimligi: '45550' }) } },
    kv: {},
    dumpTamam: true,
    yazCevap: '1',
  };
  return { ...f, ...ust };
}

function sahteBag(f, dosyalar = new Map()) {
  const kayit = { sorgular: [], yazmalar: [], dump: 0, bildir: [], getir: [] };
  const d = {
    kayit,
    simdi: () => (f.simdi || SIMDI),
    async calistir(cmd, args, { girdi } = {}) {
      if (cmd === 'ssh') {
        const uzak = args[args.length - 1];
        if (uzak === 'pipeline-sql') {
          kayit.sorgular.push(girdi);
          if (/information_schema/.test(girdi)) return { kod: 0, stdout: SEMA_TSV, stderr: '' };
          if (/FROM pipeline_book_summaries s/.test(girdi)) return { kod: 0, stdout: tsv(f.kitaplar), stderr: '' };
          if (/HEX\(LEFT\(last_error/.test(girdi)) return { kod: 0, stdout: tsv(f.platformlar), stderr: '' };
          if (/platform = 'web-stream'/.test(girdi)) {
            return f.listeler.length ? { kod: 0, stdout: tsv(f.listeler), stderr: '' } : { kod: 1, stdout: '', stderr: '' };
          }
          if (/FROM kaynak_build_surumleri/.test(girdi)) {
            return f.buildler.length ? { kod: 0, stdout: tsv(f.buildler), stderr: '' } : { kod: 1, stdout: '', stderr: '' };
          }
          throw new Error(`beklenmeyen sorgu: ${girdi}`);
        }
        if (/mariadb-dump/.test(uzak)) {
          kayit.dump += 1;
          return f.dumpTamam
            ? { kod: 0, stdout: '-- Dump completed on 2026-10-06 12:00:00\nINSERT_SAYISI=4\n', stderr: '' }
            : { kod: 0, stdout: 'mariadb-dump: Got error\nINSERT_SAYISI=0\n', stderr: '' };
        }
        if (/^mariadb /.test(uzak)) { kayit.yazmalar.push(girdi); return { kod: 0, stdout: `${f.yazCevap}\n`, stderr: '' }; }
        throw new Error(`beklenmeyen ssh: ${uzak}`);
      }
      if (cmd === 'rclone') {
        const set = /\/(\d+)\/$/.exec(args[args.length - 1])[1];
        return { kod: 0, stdout: f.r2[set] || '', stderr: '' };
      }
      if (/bildir$/.test(cmd)) { kayit.bildir.push(args); return { kod: 0, stdout: '', stderr: '' }; }
      throw new Error(`beklenmeyen komut: ${cmd}`);
    },
    async getir(url) {
      kayit.getir.push(url);
      let m = /GetKitapGuncellemeBilgi\?id=(\d+)&setMi=0&versiyon=0$/.exec(url);
      if (m) {
        const vs = f.impark[m[1]];
        if (vs == null) return { status: 200, govde: JSON.stringify({ Success: true, Data: '', Vs: 0 }) };
        return { status: 200, govde: JSON.stringify({ Success: true, Data: `https://akillitahta.ydspublishing.com/Uploads/ZKitapZipH/${m[1]}-${vs}.zip`, Vs: vs }) };
      }
      m = /GetPackageBooks\?id=(\d+)$/.exec(url);
      if (m) return { status: 200, govde: JSON.stringify({ KitapId: Number(m[1]), Books: (f.panel[m[1]] || []).map((Id) => ({ Id })) }) };
      m = /\/set\/(\d+)\/android\/surum\.json$/.exec(url);
      if (m) return { status: 404, govde: '' };
      m = /\/set\/(\d+)\/surum\.json$/.exec(url);
      if (m) return f.g[m[1]] || { status: 404, govde: '' };
      m = /\/go\/([a-z0-9]+)\/web-stream\/config\/settings\.json$/.exec(url);
      if (m) return f.kv[m[1]] || { status: 404, govde: '' };
      throw new Error(`beklenmeyen URL: ${url}`);
    },
    dosyaVar: (y) => dosyalar.has(y),
    dosyaOku: (y) => { if (!dosyalar.has(y)) throw new Error(`ENOENT ${y}`); return dosyalar.get(y); },
    dosyaYaz: (y, m) => { dosyalar.set(y, m); },
    log: () => {},
    uyar: () => {},
  };
  return d;
}

function hazirla() {
  const cfg = B.ayarlar({}, '/sahte-ev');
  const dosyalar = new Map([
    [cfg.istisnalar, ISTISNA_METNI],
    [cfg.kanonikKabuk, JSON.stringify({ surum: '1.13.14' })],
  ]);
  return { cfg, dosyalar };
}

async function kos(f, argv = ['--setler', '45550'], ortak = null) {
  const { cfg, dosyalar } = ortak || hazirla();
  const d = sahteBag(f, dosyalar);
  const o = B.argAyristir(argv);
  assert.equal(o.hata, null);
  const r = await B.kos(o, cfg, d);
  const set = (id) => r.olcum.setler.find((s) => s.set === id);
  const hucre = (id, p) => set(id).hucreler.find((h) => h.platform === p);
  return { r, d, cfg, dosyalar, set, hucre };
}

// ─── Hücre kararları ───────────────────────────────────────────────────────────────────────

test('GÜNCEL: completed + kabuk kanonik + paket ≥ build + İmpark = build + R2 build sonrası', async () => {
  const { hucre, set, r } = await kos(fikstur());
  for (const p of B.PLATFORMLAR) assert.equal(hucre('45550', p).karar, B.K.GUNCEL, `${p}: ${hucre('45550', p).sebep}`);
  assert.equal(set('45550').g.durum, 'G-GÜNCEL');
  assert.equal(set('45550').liste.durum, 'PANEL-BOŞ');
  assert.equal(r.plan.requeue.length, 0);
  assert.equal(set('45550').ayarKaynak, 'db');
});

test('BAYAT/paket: paket kaynak build\'den eski → requeue planına girer', async () => {
  const f = fikstur();
  f.platformlar[0].last_run_at = '2026-10-06 07:00:00';
  const { hucre, r } = await kos(f);
  assert.equal(hucre('45550', 'windows').karar, B.K.BAYAT);
  assert.equal(hucre('45550', 'windows').alt, 'paket');
  assert.equal(hucre('45550', 'pardus').karar, B.K.GUNCEL);
  assert.deepEqual(r.plan.requeue.map((x) => `${x.set}/${x.platform}`), ['45550/windows']);
});

test('BAYAT/paket: kabuk kanonik değil (A1 karisik) → BAYAT', async () => {
  const f = fikstur();
  f.platformlar[1].kabuk_durum = 'karisik';
  f.platformlar[1].kabuk_surum = '1.13.3';
  const { hucre } = await kos(f);
  assert.equal(hucre('45550', 'pardus').karar, B.K.BAYAT);
  assert.match(hucre('45550', 'pardus').sebep, /kabuk 1\.13\.3\/karisik/);
});

test('BAYAT/kaynak: İmpark sürümü build\'dekinden büyük → requeue YOK, set kararı BAYAT-KAYNAK', async () => {
  const f = fikstur({ impark: { 25776: 14, 25786: 2 } });
  const { hucre, set, r } = await kos(f);
  for (const p of B.PLATFORMLAR) {
    assert.equal(hucre('45550', p).karar, B.K.BAYAT);
    assert.equal(hucre('45550', p).alt, 'kaynak');
  }
  assert.equal(r.plan.requeue.length, 0);
  assert.ok(r.plan.atlanan.every((a) => /set-yenile/.test(a.neden)));
  assert.ok(set('45550').kararlar.includes(B.SK.BAYAT_KAYNAK));
});

test('ÖLÇÜLEMEZ: kaynak build kaydı yok → sebep yazılır, requeue yok', async () => {
  const f = fikstur({ buildler: [] });
  const { hucre, r } = await kos(f);
  for (const p of B.PLATFORMLAR) {
    assert.equal(hucre('45550', p).karar, B.K.OLCULEMEZ);
    assert.ok(hucre('45550', p).olculemez.includes('kaynak build kaydı yok'));
  }
  assert.equal(r.plan.requeue.length, 0);
  assert.match(r.md, /kaynak build kaydı yok/);
});

test('ÖLÇÜLEMEZ: build vs kaydı null → kitap sürümü kıyaslanamaz', async () => {
  const f = fikstur();
  f.buildler[0].kitaplar_hex = hex(JSON.stringify([{ n: 1, id: '25776', vs: null }, { n: 2, id: '25786', vs: 2 }]));
  const { hucre } = await kos(f);
  assert.equal(hucre('45550', 'mac').karar, B.K.OLCULEMEZ);
  assert.match(hucre('45550', 'mac').sebep, /25776: build vs kaydı yok/);
});

test('KUYRUKTA / KOŞUYOR / FAIL hücreleri', async () => {
  const f = fikstur();
  f.platformlar[0].status = 'queued';
  f.platformlar[1].status = 'running';
  f.platformlar[2].status = 'failed';
  f.platformlar[2].hata_hex = hex('KÖPRÜ_BOŞ: '.padEnd(150, 'x'));
  const { hucre } = await kos(f);
  assert.equal(hucre('45550', 'windows').karar, B.K.KUYRUKTA);
  assert.equal(hucre('45550', 'pardus').karar, B.K.KOSUYOR);
  assert.equal(hucre('45550', 'mac').karar, B.K.FAIL);
  assert.ok(hucre('45550', 'mac').sebep.length <= 100);
});

test('YAYIN-EKSİK: R2\'de nesne yok / eski / boyut farklı', async () => {
  const f = fikstur();
  f.r2['45550'] = ['      100 2026-10-06 09:00:05.000 SW6.impark', '      100 2026-10-05 09:00:05.000 SW6.dmg',
    '       99 2026-10-06 09:00:05.000 SW6.apk'].join('\n');
  const { hucre } = await kos(f);
  assert.equal(hucre('45550', 'windows').karar, B.K.YAYIN_EKSIK);
  assert.match(hucre('45550', 'windows').sebep, /R2'de yok/);
  assert.equal(hucre('45550', 'mac').karar, B.K.YAYIN_EKSIK);
  assert.match(hucre('45550', 'mac').sebep, /R2 nesnesi/);
  assert.equal(hucre('45550', 'android').karar, B.K.YAYIN_EKSIK);
  assert.match(hucre('45550', 'android').sebep, /boyutu 99/);
  assert.equal(hucre('45550', 'pardus').karar, B.K.GUNCEL);
});

// ─── Set kararları ─────────────────────────────────────────────────────────────────────────

test('KANAL-G-YOK: surum.json 404', async () => {
  const { set } = await kos(fikstur({ g: {} }));
  assert.equal(set('45550').g.durum, B.SK.G_YOK);
  assert.ok(set('45550').kararlar.includes(B.SK.G_YOK));
  assert.match(set('45550').androidG, /ekleme-yok/);
});

test('KANAL-G-ESKİ: G sürümü paket sürümünden küçük', async () => {
  const f = fikstur({ g: { 45550: { status: 200, govde: JSON.stringify({ surum: '2.25.6', uretim: '2026-10-06T08:36:42Z' }) } } });
  const { set } = await kos(f);
  assert.equal(set('45550').g.durum, B.SK.G_ESKI);
  assert.match(set('45550').g.sebep, /2\.25\.6 < paket 2\.25\.7/);
});

test('LİSTE-FARKI: ayar listesi ≠ panel GetPackageBooks', async () => {
  const { set } = await kos(fikstur({ panel: { 45550: [25776, 99999] } }));
  assert.equal(set('45550').liste.durum, B.SK.LISTE_FARKI);
  assert.match(set('45550').liste.sebep, /ayarda olup panelde yok: 25786,66903/);
  assert.match(set('45550').liste.sebep, /panelde olup ayarda yok: 99999/);
});

test('İSTEK: DB listesi boşsa Worker KV settings.json okunur', async () => {
  const kv = { books: { book1: { assetId: '25776', title: 'K1', contentType: 'book' }, book2: { assetId: '25786', title: 'K2', contentType: 'book' } } };
  const f = fikstur({ listeler: [], kv: { tlk2k: { status: 200, govde: JSON.stringify(kv) } } });
  const { set, hucre } = await kos(f);
  assert.equal(set('45550').ayarKaynak, 'kv:tlk2k');
  assert.equal(hucre('45550', 'windows').karar, B.K.GUNCEL);
});

// ─── İstisnalar ────────────────────────────────────────────────────────────────────────────

test('istisna seti (Flashy 60114) atlanır: İSTİSNA sayılır, DB/R2/HTTP sorgusuna girmez', async () => {
  const { set, d, r } = await kos(fikstur(), ['--setler', '60114 45550']);
  assert.ok(set('60114').hucreler.every((h) => h.karar === B.K.ISTISNA));
  assert.equal(set('60114').istisna, 'flashy-elt-uretilmez');
  assert.ok(d.kayit.sorgular.every((q) => !q.includes('60114')));
  assert.ok(d.kayit.getir.every((u) => !u.includes('60114')));
  assert.equal(r.olcum.istisnaSayisi, 1);
  assert.equal(r.bildirim.bildirimler.filter((b) => b.set === '60114').length, 0);
});

test('istisnalar.json: her kayıt sebep + tarih taşır; eksikse hata', () => {
  const j = JSON.parse(ISTISNA_METNI);
  assert.ok(B.istisnaDogrula(j).length >= 4);
  assert.throws(() => B.istisnaDogrula({ istisnalar: [{ kimlik: 'x', tur: 'set-atla', setler: ['1'] }] }), /sebep \+ tarih/);
  assert.throws(() => B.istisnaDogrula({ istisnalar: [{ kimlik: 'x', tur: 'uydurma', sebep: 'a', tarih: '2026-10-06' }] }), /tür/);
});

// ─── Eylem: requeue ────────────────────────────────────────────────────────────────────────

const bayatHucre = (set, platform, ust = {}) => ({ set, platform, karar: B.K.BAYAT, alt: 'paket', status: 'completed', sebep: 'paket eski', kurIstegiAcik: false, ...ust });

test('requeue idempotent: UPDATE yalnız completed/failed satıra dokunur; queued/running hücre plana girmez', async () => {
  const q = B.sql.requeue('45550', 'windows');
  assert.match(q, /AND status IN \('completed','failed'\);/);
  assert.match(q, /WHERE book_id='45550' AND platform='windows'/);
  const plan = B.eylemPlani([bayatHucre('1', 'mac', { status: 'queued' }), bayatHucre('2', 'mac', { status: 'running' })], [], SIMDI);
  assert.equal(plan.requeue.length, 0);
  // Uçtan uca: KUYRUKTA hücre için hiçbir yazma yapılmaz.
  const f = fikstur();
  f.platformlar.forEach((p) => { p.status = 'queued'; });
  const { d } = await kos(f, ['--setler', '45550', '--uygula']);
  assert.equal(d.kayit.yazmalar.length, 0);
  assert.equal(d.kayit.dump, 0);
});

test('requeue --uygula: önce yedek, sonra tek UPDATE; ROW_COUNT 0 → satir-yok (yarış)', async () => {
  const f = fikstur();
  f.platformlar[0].last_run_at = '2026-10-06 07:00:00';
  const { d, r, dosyalar, cfg } = await kos(f, ['--setler', '45550', '--uygula']);
  assert.equal(d.kayit.dump, 1);
  assert.equal(d.kayit.yazmalar.length, 1);
  assert.match(d.kayit.yazmalar[0], /platform='windows' AND status IN/);
  assert.equal(r.eylem.requeue[0].sonuc, 'tamam');
  assert.match(dosyalar.get(cfg.eylemDefteri), /"sonuc":"tamam"/);
  const f2 = fikstur({ yazCevap: '0' });
  f2.platformlar[0].last_run_at = '2026-10-06 07:00:00';
  const k2 = await kos(f2, ['--setler', '45550', '--uygula']);
  assert.equal(k2.r.eylem.requeue[0].sonuc, 'satir-yok');
});

test('24 sa tavanı: aynı set×platform 24 saatte bir kez', () => {
  const defter = [{ tur: 'requeue', set: '45550', platform: 'windows', sonuc: 'tamam', ms: SIMDI - 3 * SA }];
  const p1 = B.eylemPlani([bayatHucre('45550', 'windows'), bayatHucre('45550', 'pardus')], defter, SIMDI);
  assert.deepEqual(p1.requeue.map((x) => x.platform), ['pardus']);
  assert.match(p1.atlanan[0].neden, /24 sa tavanı/);
  const eski = [{ ...defter[0], ms: SIMDI - 25 * SA }];
  assert.equal(B.eylemPlani([bayatHucre('45550', 'windows')], eski, SIMDI).requeue.length, 1);
});

test('24 sa tavanı uçtan uca: ikinci koşu aynı satırı yeniden kuyruğa almaz', async () => {
  const f = fikstur();
  f.platformlar[0].last_run_at = '2026-10-06 07:00:00';
  const ortak = hazirla();
  const k1 = await kos(f, ['--setler', '45550', '--uygula'], ortak);
  assert.equal(k1.d.kayit.yazmalar.length, 1);
  const k2 = await kos({ ...f, simdi: SIMDI + 30 * 60 * 1000 }, ['--setler', '45550', '--uygula'], ortak);
  assert.equal(k2.d.kayit.yazmalar.length, 0);
  assert.equal(k2.d.kayit.dump, 0);
  assert.match(k2.r.plan.atlanan[0].neden, /24 sa tavanı/);
});

test('günlük toplam tavanı: 24 saatte en çok 12 requeue (defterdekiler dahil)', () => {
  const hucreler = Array.from({ length: 20 }, (_, i) => bayatHucre(String(50000 + i), 'pardus'));
  assert.equal(B.eylemPlani(hucreler, [], SIMDI).requeue.length, B.TAVAN.toplam);
  const defter = Array.from({ length: 5 }, (_, i) => ({ tur: 'requeue', set: String(40000 + i), platform: 'mac', sonuc: 'tamam', ms: SIMDI - SA }));
  const p = B.eylemPlani(hucreler, defter, SIMDI);
  assert.equal(p.requeue.length, 7);
  assert.ok(p.atlanan.some((a) => /günlük toplam tavan/.test(a.neden)));
  // Yazma denenmemiş kayıtlar (yedek-yok, satir-yok) tavana sayılmaz.
  const sayilmaz = defter.map((e) => ({ ...e, sonuc: 'yedek-yok' }));
  assert.equal(B.eylemPlani(hucreler, sayilmaz, SIMDI).requeue.length, 12);
});

test('kaynak kur isteği açıkken requeue yapılmaz (set-yenile sürüyor)', () => {
  const p = B.eylemPlani([bayatHucre('45550', 'mac', { kurIstegiAcik: true })], [], SIMDI);
  assert.equal(p.requeue.length, 0);
  assert.match(p.atlanan[0].neden, /kur isteği açık/);
});

test('"Dump completed" yoksa yazma YOK: requeue durur, defter yedek-yok, çıkış hata', async () => {
  const f = fikstur({ dumpTamam: false });
  f.platformlar[0].last_run_at = '2026-10-06 07:00:00';
  const { d, r, dosyalar, cfg } = await kos(f, ['--setler', '45550', '--uygula']);
  assert.equal(d.kayit.dump, 1);
  assert.equal(d.kayit.yazmalar.length, 0);
  assert.match(r.eylem.durdu, /yedek doğrulanamadı/);
  assert.match(dosyalar.get(cfg.eylemDefteri), /"sonuc":"yedek-yok"/);
});

test('KURU koşu (varsayılan): BAYAT olsa da yedek/yazma/bildirim yok, rapor yazılır', async () => {
  const f = fikstur({ g: {} });
  f.platformlar[0].last_run_at = '2026-10-06 07:00:00';
  const { d, r, dosyalar, cfg } = await kos(f, ['--setler', '45550', '--olc', '--rapor']);
  assert.equal(d.kayit.dump + d.kayit.yazmalar.length + d.kayit.bildir.length, 0);
  assert.equal(r.eylem, null);
  assert.match(dosyalar.get(cfg.raporMd), /\| 45550 \| Shall We\?! 6 Set \| BAYAT-P \| GÜNCEL/);
});

// ─── Eylem: bildirim ───────────────────────────────────────────────────────────────────────

test('bildirim: set başına günde 1; ertesi gün yeniden', async () => {
  const ortak = hazirla();
  const f = fikstur({ g: {} });
  const k1 = await kos(f, ['--setler', '45550', '--bildir'], ortak);
  assert.equal(k1.d.kayit.bildir.length, 1);
  assert.deepEqual(k1.d.kayit.bildir[0].slice(0, 1), ['bekci']);
  assert.match(k1.d.kayit.bildir[0][1], /45550 .*KANAL-G-YOK/);
  assert.deepEqual(k1.d.kayit.bildir[0].slice(2, 4), ['-b', 'Sözleşme bekçisi']);
  assert.equal(k1.d.kayit.yazmalar.length + k1.d.kayit.dump, 0, '--bildir DB yazmaz');
  const k2 = await kos({ ...f, simdi: SIMDI + 2 * SA }, ['--setler', '45550', '--bildir'], ortak);
  assert.equal(k2.d.kayit.bildir.length, 0);
  assert.deepEqual(k2.r.bildirim.bastirilan, ['45550']);
  const k3 = await kos({ ...f, simdi: SIMDI + 13 * SA }, ['--setler', '45550', '--bildir'], ortak);
  assert.equal(k3.d.kayit.bildir.length, 1);
});

test('bildirim: FAIL varsa -p yuksek; yeni biten pakette YAYIN-EKSİK bildirimi bekler', () => {
  const s = (hucreler) => ({ set: '45550', ad: 'SW6', hucreler, g: { durum: 'G-GÜNCEL' }, liste: { durum: 'AYNI' } });
  const p1 = B.bildirimPlani([s([{ platform: 'mac', karar: B.K.FAIL }])], {}, SIMDI);
  assert.equal(p1.bildirimler[0].yuksek, true);
  const p2 = B.bildirimPlani([s([{ platform: 'windows', karar: B.K.YAYIN_EKSIK, yayinBekleme: true }])], {}, SIMDI);
  assert.equal(p2.bildirimler.length, 0);
  const p3 = B.bildirimPlani([s([{ platform: 'windows', karar: B.K.YAYIN_EKSIK, yayinBekleme: false }])], {}, SIMDI);
  assert.match(p3.bildirimler[0].mesaj, /YAYIN-EKSİK windows/);
  assert.equal(p3.bildirimler[0].yuksek, false);
});

test('bildirim: 5\'ten çok set → tek özet bildirim, her set o gün bildirildi sayılır', () => {
  const b = Array.from({ length: 7 }, (_, i) => ({ set: String(45000 + i), mesaj: 'x', konular: ['KANAL-G-YOK', ...(i < 2 ? ['FAIL mac'] : [])], yuksek: i < 2 }));
  const g = B.bildirimGruplari(b, '/r.md');
  assert.equal(g.length, 1);
  assert.equal(g[0].setler.length, 7);
  assert.equal(g[0].yuksek, true);
  assert.match(g[0].mesaj, /^7 set: KANAL-G-YOK 7 · FAIL 2/);
  assert.equal(B.bildirimGruplari(b.slice(0, B.OZET_ESIK), '/r.md').length, B.OZET_ESIK);
});

// ─── Saf yardımcılar ───────────────────────────────────────────────────────────────────────

test('argAyristir: --setler boşluk/virgül, bozuk kimlik reddi, --uygula bildirimi açar', () => {
  assert.deepEqual(B.argAyristir(['--setler', '1 2,3']).setler, ['1', '2', '3']);
  assert.match(B.argAyristir(['--setler', '12;DROP']).hata, /pozitif tamsayı/);
  assert.match(B.argAyristir(['--sil']).hata, /bilinmeyen/);
  const o = B.argAyristir(['--uygula']);
  assert.equal(o.uygula && o.bildir, true);
  assert.equal(B.argAyristir([]).uygula, false);
});

test('r2Ayristir: boşluklu ad, yerel saat (+03, ekleme yok)', () => {
  const r = B.r2Ayristir('841748816 2026-10-06 11:02:27.939000000 Shall We 6 Set - YDS Publishing.exe\n');
  assert.equal(r[0].ad, 'Shall We 6 Set - YDS Publishing.exe');
  assert.equal(r[0].zamanMs, Date.parse('2026-10-06T08:02:27.939Z'));
});

test('sql: okuma sorguları tek SELECT, ; içermez; kimlik doğrulanır', () => {
  for (const q of [B.sql.sema(), B.sql.kitaplar(['1']), B.sql.platformlar(['1']), B.sql.listeler(['1']), B.sql.buildler(['1'])]) {
    assert.match(q, /^SELECT /);
    assert.ok(!q.includes(';'));
  }
  assert.throws(() => B.sql.kitaplar(["1' OR 1=1"]), /geçersiz kimlik/);
  assert.throws(() => B.sql.requeue('1', 'web'), /geçersiz platform/);
});

test('şema eksikse koşu durur (veri modeli uydurulmaz)', async () => {
  const { cfg, dosyalar } = hazirla();
  const d = sahteBag(fikstur(), dosyalar);
  const asil = d.calistir;
  d.calistir = async (cmd, args, o) => {
    if (cmd === 'ssh' && /information_schema/.test((o && o.girdi) || '')) return { kod: 0, stdout: tsv([{ TABLE_NAME: 'book_pages', COLUMN_NAME: 'book_id' }]), stderr: '' };
    return asil(cmd, args, o);
  };
  await assert.rejects(B.kos(B.argAyristir(['--setler', '45550']), cfg, d), /şema doğrulanamadı/);
});
