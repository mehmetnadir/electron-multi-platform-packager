'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./hat-bekcisi');

const NOW_DB = '2026-10-06 16:30:00.000';
const NOW_MS = Date.parse('2026-10-06T13:30:00Z');
const defterKaydi = (tur, set, platform, dkOnce, sonuc = 'tamam') => ({
  tur, set, platform, sonuc, ms: NOW_MS - dkOnce * 60000,
});

// ─── Sınıflandırıcı (bugünkü gerçek hata metinleri) ────────────────────────────────────────

test('sınıflandırıcı: geçici hata metinleri', () => {
  const gecici = [
    'connect EADDRNOTAVAIL 127.0.0.1:3001 - Local (0.0.0.0:0)',
    'TypeError: fetch failed',
    'read ECONNRESET',
    'connect ETIMEDOUT 1.2.3.4:443',
    'socket hang up',
    '[kaynak-r2] tamamla yanıtı beklenmedik: HTTP 503 Service Unavailable',
    'HTTP 502',
    'HTTP 504 Gateway Timeout',
    '[kaynak-r2] yükleme ağ hatası: parça 4',
  ];
  for (const m of gecici) assert.equal(H.hataSinifla(m).sinif, 'gecici', m);
});

test('sınıflandırıcı: kalıcı hata metinleri', () => {
  const kalici = {
    'HTTP 403': 'http-4xx',
    '[kaynak-iceriksiz] set 45550 kaynağı yok': 'kaynak-iceriksiz',
    'windows paketi windows-kasa kabul kapısından geçemedi (KALDI) — R2\'ye YÜKLENMEDİ: 22/24': 'kabul-kaldi',
    '[kaynak-r2] tamamla yanıtı beklenmedik: HTTP 400 Bad Request': 'http-4xx',
    'yazma kapısı RED: motor sha uyuşmuyor': 'kapi-red',
  };
  for (const [m, e] of Object.entries(kalici)) {
    const c = H.hataSinifla(m);
    assert.equal(c.sinif, 'kalici', m);
    assert.equal(c.etiket, e, m);
  }
});

test('sınıflandırıcı: kalıcı kalıp geçiciden önce gelir; boş/bilinmeyen ayrı', () => {
  assert.equal(H.hataSinifla('kabul kapısından geçemedi (KALDI) connect ETIMEDOUT').sinif, 'kalici');
  assert.equal(H.hataSinifla('HTTP 429 Too Many Requests').sinif, 'gecici');
  assert.equal(H.hataSinifla('').sinif, 'bilinmeyen');
  assert.equal(H.hataSinifla(null).sinif, 'bilinmeyen');
  assert.equal(H.hataSinifla('Electron Builder mac build failed (exit code 1)').sinif, 'bilinmeyen');
});

// ─── S2 geçici hata: bekleme + tavan ───────────────────────────────────────────────────────

const failed = (set, platform, hata, sonZaman) => ({ set, platform, status: 'failed', hata, sonZaman });

test('S2: bekleme dolmadan requeue yok, dolunca var (10/30/90 dk)', () => {
  const s = [failed('1', 'windows', 'connect EADDRNOTAVAIL 127.0.0.1:3001', '2026-10-06 16:25:00')];
  let p = H.planHata(s, [], NOW_MS, NOW_DB);
  assert.equal(p.requeue.length, 0);
  assert.equal(p.bekleyen.length, 1);
  s[0].sonZaman = '2026-10-06 16:19:00';
  p = H.planHata(s, [], NOW_MS, NOW_DB);
  assert.equal(p.requeue.length, 1);
  assert.equal(p.requeue[0].tur, 'gecici-requeue');
  // 2. deneme: bekleme 30 dk
  const d1 = [defterKaydi('gecici-requeue', '1', 'windows', 60)];
  s[0].sonZaman = '2026-10-06 16:10:00';
  assert.equal(H.planHata(s, d1, NOW_MS, NOW_DB).requeue.length, 0);
  s[0].sonZaman = '2026-10-06 15:59:00';
  assert.equal(H.planHata(s, d1, NOW_MS, NOW_DB).requeue.length, 1);
  // 3. deneme: bekleme 90 dk
  const d2 = [...d1, defterKaydi('gecici-requeue', '1', 'windows', 30)];
  s[0].sonZaman = '2026-10-06 15:20:00';
  assert.equal(H.planHata(s, d2, NOW_MS, NOW_DB).requeue.length, 0);
  s[0].sonZaman = '2026-10-06 14:50:00';
  assert.equal(H.planHata(s, d2, NOW_MS, NOW_DB).requeue.length, 1);
});

test('S2: 24 saatte en çok 3; eski ve başarısız kayıtlar sayılmaz', () => {
  const s = [failed('1', 'windows', 'TypeError: fetch failed', '2026-10-06 10:00:00')];
  const uc = [1, 2, 3].map((i) => defterKaydi('gecici-requeue', '1', 'windows', i * 100));
  const p = H.planHata(s, uc, NOW_MS, NOW_DB);
  assert.equal(p.requeue.length, 0);
  assert.equal(p.tavan.length, 1);
  const sayilmaz = [
    defterKaydi('gecici-requeue', '1', 'windows', 25 * 60),
    defterKaydi('gecici-requeue', '1', 'windows', 100, 'hata'),
    defterKaydi('gecici-requeue', '1', 'windows', 100, 'yedek-yok'),
    defterKaydi('gecici-requeue', '2', 'windows', 100),
    defterKaydi('gecici-requeue', '1', 'mac', 100),
  ];
  assert.equal(H.planHata(s, sayilmaz, NOW_MS, NOW_DB).requeue.length, 1);
  assert.equal(H.son24Say(uc, NOW_MS, 'gecici-requeue', '1', 'windows'), 3);
});

// ─── S3 kalıcı hata ───────────────────────────────────────────────────────────────────────

test('S3: kalıcı ve bilinmeyen hata requeue edilmez, listelenir', () => {
  const s = [
    failed('45472', 'windows', 'kabul kapısından geçemedi (KALDI)', '2026-10-06 10:00:00'),
    failed('69588', 'mac', 'HTTP 403', '2026-10-06 10:00:00'),
    failed('74405', 'mac', 'Electron Builder mac build failed', '2026-10-06 10:00:00'),
  ];
  const p = H.planHata(s, [], NOW_MS, NOW_DB);
  assert.equal(p.requeue.length, 0);
  assert.deepEqual(p.kalici.map((k) => k.etiket), ['kabul-kaldi', 'http-4xx', 'bilinmeyen']);
});

test('S3: aynı satır×hata 24 saatte 1 bildirim, tek özet mesajı', () => {
  const kalici = [
    { set: '45472', platform: 'windows', etiket: 'kabul-kaldi', hata: 'KALDI 22/24 kanıt 20261006-160628' },
    { set: '69588', platform: 'mac', etiket: 'http-4xx', hata: 'HTTP 403' },
  ];
  const o1 = H.bildirimOzeti(kalici, [], {}, NOW_MS);
  assert.equal(o1.kanal, 'kosucu');
  assert.equal(o1.anahtarlar.length, 2);
  assert.match(o1.mesaj, /kabul-kaldi 45472\/windows/);
  const damga = Object.fromEntries(o1.anahtarlar.map((a) => [a, NOW_MS - 60 * 60000]));
  assert.equal(H.bildirimOzeti(kalici, [], damga, NOW_MS), null);
  // Hata metnindeki sayı (kanıt zaman damgası) değişse de aynı hata sayılır
  const ayni = [{ ...kalici[0], hata: 'KALDI 22/24 kanıt 20261006-170000' }, kalici[1]];
  assert.equal(H.bildirimOzeti(ayni, [], damga, NOW_MS), null);
  // 24 saat geçince yeniden
  const eski = Object.fromEntries(o1.anahtarlar.map((a) => [a, NOW_MS - 25 * 3600000]));
  assert.ok(H.bildirimOzeti(kalici, [], eski, NOW_MS));
  // Tavan dolumu da özete girer
  const t = H.bildirimOzeti([], [{ tur: 'gecici-requeue', set: '1', platform: 'windows', etiket: 'ag-soket' }], {}, NOW_MS);
  assert.match(t.mesaj, /tavan-ag-soket 1\/windows/);
});

// ─── S4 kira ──────────────────────────────────────────────────────────────────────────────

test('S4: yalnız kirası dolmuş running requeue; 24 saatte en çok 2', () => {
  const s = [
    { set: '1', platform: 'mac', status: 'running', kiraDoldu: true, kiraBitis: '2026-10-06 15:00:00', ajan: 'a' },
    { set: '2', platform: 'mac', status: 'running', kiraDoldu: false },
    { set: '3', platform: 'mac', status: 'queued', kiraDoldu: true },
  ];
  const p = H.planKira(s, [], NOW_MS);
  assert.deepEqual(p.requeue.map((r) => r.set), ['1']);
  assert.equal(p.requeue[0].kosul, 'kira');
  assert.match(p.requeue[0].sebep, /kira 15 dk\+/);
  const iki = [defterKaydi('kira-requeue', '1', 'mac', 100), defterKaydi('kira-requeue', '1', 'mac', 200)];
  const p2 = H.planKira(s, iki, NOW_MS);
  assert.equal(p2.requeue.length, 0);
  assert.equal(p2.tavan.length, 1);
});

// ─── S1 askıda kur isteği ─────────────────────────────────────────────────────────────────

const kitap = (set, istek, baslangic = null, kaynakModu = 'otomatik') => ({ set, istek, baslangic, kaynakModu });
const platS = (set, platform, status, hata = '') => ({ set, platform, status, hata });

test('S1: yaşlı istek + kurulum başlamamış + mac bitmiş → mac öne alınır', () => {
  const k = [kitap('11845', '2026-10-06 14:59:06.128')];
  const s = [platS('11845', 'mac', 'completed'), platS('11845', 'windows', 'queued')];
  const p = H.planKurAskida(k, s, [], NOW_MS, NOW_DB);
  assert.equal(p.requeue.length, 1);
  assert.equal(p.requeue[0].platform, 'mac');
  assert.equal(p.requeue[0].oneAl, '2026-10-06 00:00:00');
  assert.equal(p.requeue[0].tur, 'kur-oncelik');
});

test('S1: koşullar tutmazsa eylem yok', () => {
  const s = [platS('1', 'mac', 'completed')];
  const hic = (k, sat = s) => H.planKurAskida(k, sat, [], NOW_MS, NOW_DB).requeue.length;
  assert.equal(hic([kitap('1', '2026-10-06 16:20:00')]), 0, 'istek 20 dk\'dan genç');
  assert.equal(hic([kitap('1', '2026-10-06 14:00:00', '2026-10-06 14:05:00')]), 0, 'kurulum başladı');
  assert.equal(hic([kitap('1', '2026-10-06 14:00:00', '2026-10-06 13:00:00')]), 1, 'başlangıç istekten eski');
  assert.equal(hic([kitap('1', '2026-10-06 14:00:00', null, 'manuel')]), 0, 'manuel set');
  assert.equal(hic([kitap('1', '2026-10-06 14:00:00')], [platS('1', 'mac', 'queued')]), 0, 'mac zaten kuyrukta');
  assert.equal(hic([kitap('1', '2026-10-06 14:00:00')], [platS('1', 'mac', 'running')]), 0, 'mac koşuyor');
  assert.equal(hic([kitap('1', '2026-10-06 14:00:00')], [platS('1', 'windows', 'completed')]), 0, 'mac satırı yok');
  assert.equal(hic([kitap('1', '2026-10-06 14:00:00')], [platS('1', 'mac', 'failed', 'kabul (KALDI)')]), 0, 'kalıcı hata');
  assert.equal(hic([kitap('1', '2026-10-06 14:00:00')], [platS('1', 'mac', 'failed', 'fetch failed')]), 1, 'geçici hata');
});

test('S1: tavan set başına 24 saatte 2', () => {
  const k = [kitap('1', '2026-10-06 14:00:00')];
  const s = [platS('1', 'mac', 'completed')];
  const iki = [defterKaydi('kur-oncelik', '1', 'mac', 60), defterKaydi('kur-oncelik', '1', 'mac', 600)];
  const p = H.planKurAskida(k, s, iki, NOW_MS, NOW_DB);
  assert.equal(p.requeue.length, 0);
  assert.equal(p.tavan.length, 1);
  assert.equal(H.planKurAskida(k, s, [iki[0]], NOW_MS, NOW_DB).requeue.length, 1);
});

test('birleştirme: aynı satır tek requeue, S1 önce', () => {
  const a = [{ set: '1', platform: 'mac', tur: 'kur-oncelik' }];
  const b = [{ set: '1', platform: 'mac', tur: 'gecici-requeue' }, { set: '2', platform: 'mac', tur: 'gecici-requeue' }];
  const r = H.requeueBirlestir(a, [], b);
  assert.equal(r.length, 2);
  assert.equal(r[0].tur, 'kur-oncelik');
});

// ─── S5 ajan ──────────────────────────────────────────────────────────────────────────────

const ajanlar = (kasa, mac, probook) => [
  { ad: 'windows-kasa', hostname: 'Windows-Kasa', dk: kasa },
  { ad: 'Nadir-MacBook-Pro.local', hostname: 'Nadir-MacBook-Pro.local', dk: mac },
  { ad: 'probook-pardus', hostname: 'etap', dk: probook },
  { ad: 'Server21-linux', hostname: 'websrv', dk: 99999 },
];

test('S5: 20 dk eşiği; yalnız durum değişince bildirim', () => {
  let p = H.planAjan(ajanlar(1, 2, 3), {}, true);
  assert.equal(p.bildirimler.length, 0);
  p = H.planAjan(ajanlar(1, 2, 21), { kasa: 'ok', mac: 'ok', probook: 'ok' }, false);
  assert.equal(p.bildirimler.length, 1);
  assert.equal(p.bildirimler[0].kanal, 'bekci');
  assert.equal(p.bildirimler[0].yuksek, true);
  assert.match(p.bildirimler[0].mesaj, /probook.*ssh 22: KAPALI/);
  // Aynı ölü durum ikinci koşuda tekrar bildirilmez
  const p2 = H.planAjan(ajanlar(1, 2, 300), p.yeni, false);
  assert.equal(p2.bildirimler.length, 0);
  // Geri gelince bir kez
  const p3 = H.planAjan(ajanlar(1, 2, 1), p2.yeni, true);
  assert.equal(p3.bildirimler.length, 1);
  assert.match(p3.bildirimler[0].mesaj, /geri geldi: probook/);
  assert.equal(p3.bildirimler[0].yuksek, false);
  assert.equal(H.planAjan(ajanlar(1, 2, 20), {}, true).bildirimler.length, 0, '20 dk tam eşik ölü değil');
});

test('S5: tabloda hiç yoksa ölü sayılır; Server21 izlenmez', () => {
  const p = H.planAjan([{ ad: 'windows-kasa', hostname: 'x', dk: 1 }], {}, true);
  assert.deepEqual(p.bildirimler.map((b) => /mac|probook/.exec(b.mesaj)[0]).sort(), ['mac', 'probook']);
});

// ─── S6 kasa sürümü ───────────────────────────────────────────────────────────────────────

test('S6: md5 farklıysa bir kez bildir, eşitse temizle, ölçülemezse susar', () => {
  const a = 'f900035e32bdeb99b9fade00e27e6ed8'; const b = 'aaaaaaaa32bdeb99b9fade00e27e6ed8';
  assert.equal(H.planKasaSurum(a, a, null).bildirim, null);
  assert.equal(H.planKasaSurum(a, a, 'x').yeni, null);
  const p = H.planKasaSurum(a, b, null);
  assert.equal(p.bildirim.kanal, 'bekci');
  assert.match(p.bildirim.mesaj, /Mac f900035e ≠ kasa aaaaaaaa/);
  assert.equal(H.planKasaSurum(a, b, p.yeni).bildirim, null);
  assert.equal(H.planKasaSurum(a, null, null).durum, 'olculemedi');
  assert.equal(H.planKasaSurum(a, null, null).bildirim, null);
});

// ─── S7 üretim kapısı ─────────────────────────────────────────────────────────────────────

const iso = (dkOnce) => new Date(NOW_MS - dkOnce * 60000).toISOString();
const kapaliSatir = (dk) => `${iso(dk)} [agent] Üretim kapısı KAPALI — iş alınmıyor`;
const kapaliBozuk = (dk) => `${iso(dk)} [agent] �retim kap�s� KAPALI`;

test('S7: yalnız KAPALI + kabul işçisi durgunsa bildirim; tekrarsız', () => {
  const kabulEski = `${iso(60)} kabul-işçisi: bitti`;
  const p = H.planUretimKapisi([kapaliSatir(25), kapaliBozuk(10)], kabulEski, NOW_MS, null);
  assert.equal(p.durum, 'kapali');
  assert.equal(p.bildirim.kanal, 'bekci');
  assert.equal(H.planUretimKapisi([kapaliSatir(5)], kabulEski, NOW_MS, 'kapali').bildirim, null);
});

test('S7: başka satır, taze kabul işçisi, eski log ya da ölçüm yoksa alarm yok', () => {
  const kabulEski = `${iso(60)} x`;
  const kabulTaze = `${iso(10)} x`;
  const is = `${iso(5)} [agent] polling...`;
  assert.equal(H.planUretimKapisi([kapaliSatir(20), is], kabulEski, NOW_MS, null).bildirim, null);
  assert.equal(H.planUretimKapisi([kapaliSatir(20)], kabulTaze, NOW_MS, null).bildirim, null);
  assert.equal(H.planUretimKapisi([kapaliSatir(40)], kabulEski, NOW_MS, null).bildirim, null, '30 dk dışında satır yok');
  assert.equal(H.planUretimKapisi([kapaliSatir(5)], '', NOW_MS, null).durum, 'olculemedi');
  assert.equal(H.planUretimKapisi([kapaliSatir(5)], kabulEski, NOW_MS, null).durum, 'kapali');
});

// ─── SQL ve yedek kapısı ──────────────────────────────────────────────────────────────────

test('SQL: requeue kalıbı ve koşullar', () => {
  const q = H.sql.requeue('11845', 'mac', 'bitmis', '2026-10-06 00:00:00');
  assert.match(q, /status='queued', last_result=NULL, progress=0, current_phase=NULL, last_run_at=NULL/);
  assert.match(q, /leased_by_agent=NULL, lease_expires_at=NULL, last_queued_at='2026-10-06 00:00:00'/);
  assert.match(q, /status IN \('completed','failed','idle'\)/);
  assert.match(H.sql.requeue('1', 'windows', 'bitmis'), /last_queued_at=NOW\(3\)/);
  assert.match(H.sql.requeue('1', 'mac', 'kira'), /status='running' AND lease_expires_at < NOW\(\) - INTERVAL 15 MINUTE/);
  assert.throws(() => H.sql.requeue("1' OR 1=1", 'mac', 'bitmis'), /geçersiz id/);
  assert.throws(() => H.sql.requeue('1', 'web-stream', 'bitmis'), /geçersiz platform/);
  assert.throws(() => H.yedekKomutu(H.ayarlar({}, '/ev'), 'x'), /geçersiz damga/);
});

/** srv21 ssh taklidi: yedek ve yazma çağrılarını kaydeder. */
function sahteDunya({ yedekCikti }) {
  const w = { cagrilar: [], dosyalar: {}, uyarilar: [], now: NOW_MS };
  w.d = {
    simdi: () => w.now,
    uyar: (m) => w.uyarilar.push(m),
    dosyaVar: (y) => y in w.dosyalar,
    dosyaOku: (y) => w.dosyalar[y],
    dosyaYaz: (y, m) => { w.dosyalar[y] = m; },
    async calistir(cmd, args) {
      const komut = args[args.length - 1];
      w.cagrilar.push(komut);
      if (/mariadb-dump/.test(komut)) return { kod: 0, stdout: yedekCikti, stderr: '' };
      if (/^mariadb --defaults/.test(komut)) return { kod: 0, stdout: '1\n', stderr: '' };
      return { kod: 0, stdout: '', stderr: '' };
    },
  };
  return w;
}
const OK_YEDEK = '-- Dump completed on 2026-10-06 16:30:00\nINSERT_SAYISI=42\n';
const RQ = [{ tur: 'gecici-requeue', set: '1', platform: 'windows', sebep: 'x', kosul: 'bitmis' }];

test('yedek kapısı: doğrulanmış yedekle yazım yapılır, defter tamam kaydı alır', async () => {
  const w = sahteDunya({ yedekCikti: OK_YEDEK });
  const cfg = H.ayarlar({}, '/ev');
  const db = { srv: require('../set-yenile/set-yenile').srv21Istemci(cfg, w.d) };
  const s = await H.yazimUygula(RQ, db, cfg, w.d);
  assert.equal(s.durdu, null);
  assert.ok(s.yedek);
  assert.equal(s.kayitlar[0].sonuc, 'tamam');
  assert.equal(w.cagrilar.filter((c) => /^mariadb --defaults/.test(c)).length, 1);
  const defter = H.defterOku(w.dosyalar[cfg.eylemDefteri]);
  assert.equal(H.son24Say(defter, NOW_MS, 'gecici-requeue', '1', 'windows'), 1);
});

test('yedek kapısı: yedek doğrulanmazsa DB yazımı YOK', async () => {
  const kotuler = [
    '-- Dump completed on x\nINSERT_SAYISI=0\n', // INSERT yok
    'INSERT_SAYISI=42\n', // "Dump completed" yok
    '',
  ];
  for (const cikti of kotuler) {
    const w = sahteDunya({ yedekCikti: cikti });
    const cfg = H.ayarlar({}, '/ev');
    const db = { srv: require('../set-yenile/set-yenile').srv21Istemci(cfg, w.d) };
    const s = await H.yazimUygula(RQ, db, cfg, w.d);
    assert.match(s.durdu, /yedek doğrulanamadı/);
    assert.equal(w.cagrilar.filter((c) => /^mariadb --defaults/.test(c)).length, 0, `yazım olmamalı: ${JSON.stringify(cikti)}`);
    const defter = H.defterOku(w.dosyalar[cfg.eylemDefteri]);
    assert.equal(defter[0].sonuc, 'yedek-yok');
    assert.equal(H.son24Say(defter, NOW_MS, 'gecici-requeue', '1', 'windows'), 0, 'yedek-yok tavana sayılmaz');
  }
});

test('yedek kapısı: requeue yoksa yedek de yazım da yok', async () => {
  const w = sahteDunya({ yedekCikti: OK_YEDEK });
  const cfg = H.ayarlar({}, '/ev');
  const s = await H.yazimUygula([], { srv: {} }, cfg, w.d);
  assert.equal(s.yedek, null);
  assert.equal(w.cagrilar.length, 0);
});

test('argümanlar ve kilit', () => {
  assert.equal(H.argAyristir([]).uygula, true);
  assert.equal(H.argAyristir(['--kuru']).uygula, false);
  assert.equal(H.argAyristir(['--uygula']).uygula, true);
  assert.ok(H.argAyristir(['--x']).hata);
  const dz = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'hat-'));
  const cfg = H.ayarlar({ EMPP_HAT_DIZINI: dz }, '/ev');
  assert.equal(H.kilitAl(cfg, Date.now()), true);
  assert.equal(H.kilitAl(cfg, Date.now()), false, 'canlı kilit: ikinci koşu girmez');
  H.kilitBirak(cfg);
  assert.equal(H.kilitAl(cfg, Date.now()), true);
  H.kilitBirak(cfg);
});

test('S1 gece (06.10): Mac duraklatıldı → kur pardus satırından; pardus kuyruktaysa eylem yok', () => {
  const k = [kitap('11845', '2026-10-06 14:59:06.128')];
  const p = H.planKurAskida(k, [platS('11845', 'mac', 'completed'), platS('11845', 'pardus', 'completed')],
    [], NOW_MS, NOW_DB, ['pardus']);
  assert.equal(p.requeue.length, 1);
  assert.equal(p.requeue[0].platform, 'pardus');
  assert.equal(H.planKurAskida(k, [platS('11845', 'pardus', 'queued')], [], NOW_MS, NOW_DB, ['pardus']).requeue.length, 0);
});

test('S1: mac kalıcı hatalıysa pardus yedeği seçilir; kurPlatformlari duraklat bayrağına bakar', () => {
  const k = [kitap('1', '2026-10-06 14:00:00')];
  const s = [platS('1', 'mac', 'failed', 'kabul (KALDI)'), platS('1', 'pardus', 'completed')];
  assert.equal(H.planKurAskida(k, s, [], NOW_MS, NOW_DB, ['mac', 'pardus']).requeue[0].platform, 'pardus');
  const cfg = { macDuraklat: '/x/duraklat.istek' };
  assert.deepEqual(H.kurPlatformlari(cfg, { dosyaVar: () => true }), ['pardus']);
  assert.deepEqual(H.kurPlatformlari(cfg, { dosyaVar: () => false }), ['mac', 'pardus']);
});
