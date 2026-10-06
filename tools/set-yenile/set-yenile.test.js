'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./set-yenile');

const CFG = {
  ...S.ayarlar({}, '/ev'),
  ekUret: '/repo/tools/set-kabuk/ek-uret.js',
  bildir: '/ev/.local/bin/bildir',
  durumDizini: '/ev/.empp-agent/set-yenile',
  arsivKoku: '/ev/.empp-agent/kaynak-arsivi',
};
const DB_T0 = '2026-10-06 09:00:00.123';
const MAC_SIMDI = Date.parse('2031-01-01T00:00:00Z'); // Mac saati bilerek DB'den çok farklı

/** Sahte dünya: srv21 DB + kasa + ProBook + ek-uret + CDN. Bütün çağrılar `cagrilar`a düşer. */
function sahteDunya(ayar = {}) {
  const w = {
    kitaplar: {
      11845: { book_id: '11845', kaynak_modu: 'otomatik' },
      45550: { book_id: '45550', kaynak_modu: 'otomatik' },
      ...(ayar.kitaplar || {}),
    },
    platformlar: ayar.platformlar || [
      { book_id: '11845', platform: 'windows', status: 'completed' },
      { book_id: '11845', platform: 'pardus', status: 'completed' },
      { book_id: '45550', platform: 'windows', status: 'completed' },
      { book_id: '45550', platform: 'pardus', status: 'completed' },
    ],
    tohum: ayar.tohum || [{ set_id: '11845', surum: '2.51.5', olusturma: '2026-10-01 10:00:00.000' },
      { set_id: '45550', surum: '2.25.6', olusturma: '2026-10-01 10:00:00.000' }],
    arsiv: new Set(ayar.arsiv || []),
    oncelik: ayar.oncelik === undefined ? '# 05.10 Nadir\r\n73768\r\n' : ayar.oncelik,
    bekciLog: ayar.bekciLog || '',
    cagrilar: [], bildirimler: [], yazilan: {}, uyarilar: [], loglar: [], tik: 0,
    simdi: MAC_SIMDI,
    srv21Birincil255: Boolean(ayar.srv21Birincil255),
    yedekBozuk: Boolean(ayar.yedekBozuk),
    ekKod: ayar.ekKod === undefined ? 0 : ayar.ekKod,
    tikHook: ayar.tikHook || (() => {}),
    okumaHata: ayar.okumaHata || (() => false),
    yazmaHata: ayar.yazmaHata || (() => false),
    bekleler: [],
    ekUretVar: ayar.ekUretVar !== false,
  };
  const tsv = (satirlar, kolonlar) => {
    if (!satirlar.length) return '';
    return `${kolonlar.join('\t')}\n${satirlar.map((r) => kolonlar.map((k) => (r[k] == null ? 'NULL' : r[k])).join('\t')).join('\n')}\n`;
  };
  const idleri = (q) => [...String(q).matchAll(/'(\d+)'/g)].map((m) => m[1]);
  const KITAP_K = ['book_id', 'kaynak_modu', 'kaynak_kur_istegi_at', 'kaynak_kurulum_baslangic', 'kaynak_kurulum_bitis',
    'kaynak_kurulum_ajan', 'kaynak_kurulum_surum', 'kaynak_kur_ret_at', 'kaynak_kur_ret_nedenleri'];
  const PLAT_K = ['book_id', 'platform', 'status', 'last_result', 'progress', 'current_phase', 'last_run_at', 'last_queued_at'];

  async function calistir(cmd, args, opts = {}) {
    const c = { cmd, args, girdi: opts.girdi, kodlama: opts.kodlama };
    w.cagrilar.push(c);
    const son = args[args.length - 1];
    const tamam = (stdout = '') => ({ kod: 0, stdout, stderr: '' });
    if (cmd === 'ssh' && args.includes('root@100.117.187.26') && w.srv21Birincil255) {
      return { kod: 255, stdout: '', stderr: 'ssh: connect to host 100.117.187.26 port 2222: Operation timed out' };
    }
    if (cmd === 'ssh' && (args.includes('root@100.117.187.26') || args.includes('root@10.0.0.21'))) {
      if (son === 'pipeline-sql') {
        const q = opts.girdi;
        if (w.okumaHata(q, w)) return { kod: -1, stdout: '', stderr: 'ControlSocket already exists, disabling multiplexing\nzaman aşımı 90000 ms' };
        const ids = idleri(q);
        if (/FROM pipeline_book_summaries/.test(q)) {
          const r = ids.map((id) => w.kitaplar[id]).filter(Boolean);
          return r.length ? tamam(tsv(r, KITAP_K)) : { kod: 1, stdout: '', stderr: '' };
        }
        if (/FROM pipeline_platform_summaries/.test(q)) {
          const pl = [...q.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
          const r = w.platformlar.filter((p) => ids.includes(p.book_id) && pl.includes(p.platform));
          return r.length ? tamam(tsv(r, PLAT_K)) : { kod: 1, stdout: '', stderr: '' };
        }
        if (/FROM kaynak_build_surumleri/.test(q)) {
          const r = w.tohum.filter((t) => ids.includes(t.set_id));
          return r.length ? tamam(tsv(r, ['set_id', 'surum', 'kaynak', 'olusturma'])) : { kod: 1, stdout: '', stderr: '' };
        }
        throw new Error(`beklenmeyen okuma: ${q}`);
      }
      if (/^mkdir -p .*mariadb-dump/.test(son)) {
        return w.yedekBozuk ? { kod: 0, stdout: 'INSERT_SAYISI=1\n', stderr: '' }
          : tamam('-- Dump completed on 2026-10-06  9:00:00\nINSERT_SAYISI=1\n');
      }
      if (/^mariadb --defaults-extra-file/.test(son)) {
        const q = opts.girdi;
        const id = idleri(q)[0];
        if (w.yazmaHata(q, w)) return { kod: 1, stdout: '', stderr: 'ERROR 2013 (HY000): Lost connection to server during query' };
        if (/UPDATE pipeline_book_summaries/.test(q)) {
          w.kitaplar[id].kaynak_kur_istegi_at = DB_T0;
          return tamam(`${DB_T0}\n1\n`);
        }
        if (/UPDATE pipeline_platform_summaries/.test(q)) {
          const p = /platform='([a-z-]+)'/.exec(q)[1];
          const satir = w.platformlar.find((x) => x.book_id === id && x.platform === p);
          if (satir.status === 'running') return tamam('0\n');
          satir.status = 'queued';
          return tamam('1\n');
        }
      }
      throw new Error(`beklenmeyen srv21 komutu: ${son}`);
    }
    if (cmd === 'ssh' && args.includes(CFG.kasa)) {
      if (son === 'echo set-yenile-ok') return tamam('set-yenile-ok\r\n');
      if (/^if exist/.test(son)) return w.oncelik === null ? { kod: 9, stdout: '', stderr: '' } : tamam(w.oncelik);
      if (/^powershell .* -File /.test(son)) {
        const betik = w.sonBetik;
        const yeni = /\$yeni = '([^']*)'/.exec(betik)[1];
        w.oncelik = Buffer.from(yeni, 'base64').toString('latin1');
        return tamam('YEDEK x\r\nTAMAM\r\n');
      }
      if (/^findstr/.test(son)) return w.bekciLog ? tamam(w.bekciLog) : { kod: 1, stdout: '', stderr: '' };
    }
    if (cmd === 'ssh' && args.includes(CFG.probook)) return tamam('set-yenile-ok\n');
    if (cmd === 'scp') return tamam();
    if (cmd === 'node') {
      w.ekCalisti = true;
      return { kod: w.ekKod, stdout: `[kabuk-ek] SONUÇ ${args[2]} durum=yuklendi girdiSha=abc123 sure=5ms\n`, stderr: '' };
    }
    if (cmd === CFG.bildir) { w.bildirimler.push(args); return tamam(); }
    throw new Error(`beklenmeyen çağrı: ${cmd} ${args.join(' ')}`);
  }
  const d = {
    calistir,
    simdi: () => w.simdi,
    bekle: async (ms) => { w.bekleler.push(ms); w.simdi += ms; w.tik += 1; w.tikHook(w); },
    getir: async () => ({ kod: 200, govde: JSON.stringify({ girdiSha: 'abc123', uretildi: new Date(w.simdi + 1000).toISOString() }) }),
    dosyaVar: (y) => (y === CFG.ekUret ? w.ekUretVar : w.arsiv.has(y)),
    dosyaOku: (y) => w.yazilan[y],
    dosyaYaz: (y, m) => { w.yazilan[y] = m; },
    geciciYaz: (ad, icerik) => { w.sonBetik = icerik; return `/tmp/${ad}`; },
    log: (s) => w.loglar.push(s),
    uyar: (s) => w.uyarilar.push(s),
  };
  return { w, d };
}

const YAZMA = (c) => (c.cmd === 'ssh' && /^(mkdir -p|mariadb |powershell )/.test(c.args[c.args.length - 1]))
  || c.cmd === 'scp' || c.cmd === 'node' || c.cmd === CFG.bildir;
const mariadbCagrilari = (w) => w.cagrilar.filter((c) => c.cmd === 'ssh' && /^mariadb /.test(c.args[c.args.length - 1]));
const durumOku = (w) => JSON.parse(Object.values(w.yazilan)[0]);

/** Kur isteğinden sonra n. tikte yeni geçerli kaynak satırı (olusturma > DB_T0) gelir. */
const kurBitir = (id, tik = 1, olusturma = '2026-10-06 09:30:00.000') => (w) => {
  if (w.tik === tik) w.tohum.push({ set_id: id, surum: '2.25.7', kaynak: 'probook', olusturma });
};

// ─── Saf birimler ─────────────────────────────────────────────────────────────────────────

test('argAyristir: book_id doğrulaması (enjeksiyon, sıfır, harf reddedilir)', () => {
  assert.match(S.argAyristir(["1' OR 1=1 --"]).hata, /pozitif tamsayı/);
  assert.match(S.argAyristir(['0123']).hata, /pozitif tamsayı/);
  assert.match(S.argAyristir(['12a']).hata, /pozitif tamsayı/);
  assert.match(S.argAyristir(['11845', '--platform', 'windows;drop']).hata, /platform izinli değil/);
  const o = S.argAyristir(['11845', '45550', '11845', '--uygula']);
  assert.equal(o.hata, null);
  assert.deepEqual(o.idler, ['11845', '45550']);
  assert.deepEqual(o.platformlar, ['windows', 'pardus']);
  assert.throws(() => S.sql.kurIstegi("1'; DROP TABLE x"), /geçersiz book_id/);
  assert.throws(() => S.yedekKomutu(CFG, { stamp: '20261006-090000', id: '1 OR 1', tablo: 'pipeline_book_summaries', etiket: 'kur' }), /geçersiz book_id/);
});

test('sql: requeue çalışan işi ezmez; okuma SQL ; içermez', () => {
  assert.match(S.sql.requeue('11845', 'windows'), /AND status <> 'running'/);
  assert.match(S.sql.kurIstegi('11845'), /^SELECT NOW\(3\);/);
  assert.match(S.sql.kurIstegi('11845'), /kaynak_modu <> 'manuel'/);
  for (const q of [S.sql.kitaplar(['1']), S.sql.platformlar(['1'], ['pardus']), S.sql.tohum(['1'])]) assert.ok(!q.includes(';'));
});

test('tsvAyristir: NULL → null; ERROR satırı istisna', () => {
  assert.deepEqual(S.tsvAyristir('a\tb\n1\tNULL\n'), [{ a: '1', b: null }]);
  assert.throws(() => S.tsvAyristir('ERROR 1054 (42S22) at line 1: Unknown column'), /DB hatası/);
});

test('kurDegerlendir: başarı = olusturma > t0 olan yeni geçerli satır; kurulum_* alanları yalnız bilgi', () => {
  const t0 = '2026-10-06 09:00:00.5';
  const eskiSatir = { set_id: '1', surum: '2.25.6', kaynak: 'otomatik', olusturma: '2026-10-01 10:00:00.000' };
  // kurulum_* dolu olsa da yeni satır yoksa bitmedi.
  assert.equal(S.kurDegerlendir({ kaynak_kurulum_bitis: '2026-10-06 09:10:00', kaynak_kurulum_surum: '2.1' }, [eskiSatir], t0).durum, 'bekliyor');
  assert.equal(S.kurDegerlendir({}, [{ ...eskiSatir, olusturma: '2026-10-06 09:00:00.400' }], t0).durum, 'bekliyor', 'ms düzeyinde t0 öncesi');
  const b = S.kurDegerlendir({}, [eskiSatir, { set_id: '1', surum: '2.25.7', kaynak: 'probook', olusturma: '2026-10-06 09:00:00.600' },
    { set_id: '1', surum: '2.25.8', kaynak: 'mac', olusturma: '2026-10-06 09:20:00.000' }], t0);
  assert.deepEqual([b.durum, b.surum, b.kaynak], ['bitti', '2.25.8', 'mac']);
  // t0 öncesi başlamış açık kilit bekletmez: yeni satır gelirse başarı, not taşır.
  const kilitli = { kaynak_kurulum_baslangic: '2026-10-05 19:31:44.250', kaynak_kurulum_ajan: 'probook-etap' };
  const k = S.kurDegerlendir(kilitli, [{ ...eskiSatir, olusturma: '2026-10-06 09:30:00.000' }], t0);
  assert.equal(k.durum, 'bitti');
  assert.equal(k.not, 'kurulum kilidi açık, ajan: probook-etap, başlangıç: 2026-10-05 19:31:44.250');
  assert.match(S.kurDegerlendir(kilitli, [], t0).not, /kilidi açık/);
  assert.equal(S.kilitNotu({ kaynak_kurulum_baslangic: '2026-10-05 19:31:44', kaynak_kurulum_bitis: '2026-10-05 20:00:00' }), null);
  const r = S.kurDegerlendir({ kaynak_kur_ret_at: '2026-10-06 09:05:00.000', kaynak_kur_ret_nedenleri: '[{"kod":"kitap-eksik","ayrinti":"6 ≠ 5"}]' }, [eskiSatir], t0);
  assert.equal(r.durum, 'ret');
  assert.deepEqual(r.nedenler, ['kitap-eksik: 6 ≠ 5']);
  assert.equal(S.kurDegerlendir({ kaynak_kur_ret_at: '2026-10-02 12:00:00.000' }, [], t0).durum, 'bekliyor', 'eski ret sayılmaz');
});

test('ekDegerlendir: çıkış kodu kanıt değil, son.json uretildi adım başlangıcından sonra olmalı', () => {
  const bas = Date.parse('2026-10-06T06:00:00Z');
  const cikti = '[kabuk-ek] SONUÇ 1 durum=yuklendi girdiSha=aa sure=1ms';
  assert.equal(S.ekDegerlendir({ kod: 0, cikti, son: { girdiSha: 'aa', uretildi: '2026-10-06T06:01:00Z' }, baslangicMs: bas }).tamam, true);
  assert.match(S.ekDegerlendir({ kod: 0, cikti, son: { girdiSha: 'aa', uretildi: '2026-10-05T06:01:00Z' }, baslangicMs: bas }).neden, /son.json eski/);
  assert.equal(S.ekDegerlendir({ kod: 0, cikti: 'zaten işlendi', son: { girdiSha: 'aa', uretildi: '2026-10-05T06:01:00Z' }, baslangicMs: bas }).tamam, true);
  assert.match(S.ekDegerlendir({ kod: 0, cikti, son: { girdiSha: 'bb', uretildi: '2026-10-06T06:01:00Z' }, baslangicMs: bas }).neden, /girdiSha/);
  assert.match(S.ekDegerlendir({ kod: 2, cikti: '', son: null, baslangicMs: bas }).neden, /eylem yok/);
  assert.match(S.ekDegerlendir({ kod: 0, cikti: '[kabuk-ek] SONUÇ 1 durum=ret — kapı RED', son: { uretildi: '2027-01-01T00:00:00Z' }, baslangicMs: bas }).neden, /durum=ret/);
});

test('oncelikBirlestir: id başa eklenir, tekrar kaldırılır, yorum korunur, CRLF', () => {
  assert.equal(S.oncelikBirlestir('# not\r\n73768\r\n11845\r\n', ['11845']), '11845\r\n# not\r\n73768\r\n');
  assert.equal(S.oncelikBirlestir('11845\r\n', ['11845']), '11845\r\n');
  assert.equal(S.oncelikBirlestir('', ['45550', '11845', '45550']), '45550\r\n11845\r\n');
  assert.equal(S.oncelikBirlestir('\uFEFF73768\n', ['1']), '1\r\n73768\r\n');
});

test('oncelikPs: büyük-küçük harf duyarlı kıyas, yedek yazmadan önce', () => {
  const p = S.oncelikPs({ yol: 'C:\\a\\imza-oncelik.txt', yedekYol: 'C:\\a\\imza-oncelik.txt.once-1', eskiB64: 'QQ==', yeniB64: 'Qg==' });
  assert.match(p, /\$simdi -cne \$eski/);
  assert.ok(p.indexOf('Copy-Item') < p.indexOf('WriteAllBytes'));
  assert.throws(() => S.oncelikPs({ yol: 'x', yedekYol: 'y', eskiB64: "a'", yeniB64: 'Qg==' }), /base64/);
});

test('yayinBul: id ve zaman eşiği', () => {
  const log = '2026-10-06T03:23:48.328Z imza-bekÃ§isi: 45449-2.65.5 â yayinlandi\n'
    + '2026-10-06T03:54:04.292Z imza-bekÃ§isi: 11811-2.51.5 â yayinlandi\n';
  assert.deepEqual(S.yayinBul(log, '11811', Date.parse('2026-10-06T03:00:00Z')), { surum: '2.51.5', zaman: '2026-10-06T03:54:04.292Z' });
  assert.equal(S.yayinBul(log, '11811', Date.parse('2026-10-06T04:00:00Z')), null);
  assert.equal(S.yayinBul(log, '1181', 0), null);
});

// ─── Akış ─────────────────────────────────────────────────────────────────────────────────

test('kuru kip: hiçbir yazma komutu çağrılmaz, durum dosyası yazılmaz', async () => {
  const { w, d } = sahteDunya();
  const kod = await S.ana(['11845', '45550', '--izle'], d, CFG);
  assert.equal(kod, 0);
  assert.deepEqual(w.cagrilar.filter(YAZMA), []);
  assert.deepEqual(Object.keys(w.yazilan), []);
  assert.ok(w.loglar.some((l) => /\(2\) SQL: SELECT NOW\(3\); UPDATE pipeline_book_summaries/.test(l)));
  assert.ok(w.loglar.some((l) => /11845: \(4\) kasa .*\[# 05\.10 Nadir \| 73768\] → \[11845 \| # 05\.10 Nadir \| 73768\]/.test(l)));
  assert.equal(w.oncelik, '# 05.10 Nadir\r\n73768\r\n', 'kasa dosyası değişmedi');
});

test('uygula: t0 DB\'den alınır (Mac saati değil), requeue + öncelik + izle özet', async () => {
  const { w, d } = sahteDunya({
    tikHook: (x) => {
      kurBitir('45550', 1)(x);
      if (x.tik === 2) {
        for (const p of x.platformlar.filter((y) => y.book_id === '45550')) Object.assign(p, { status: 'completed', last_run_at: '2026-10-06 11:00:00' });
        x.bekciLog = `${new Date(x.simdi).toISOString()} imza-bekçisi: 45550-2.25.7 → yayinlandi\n`;
      }
    },
  });
  const kod = await S.ana(['45550', '--uygula', '--izle'], d, CFG);
  assert.equal(kod, 0, w.loglar.join('\n'));
  const k = durumOku(w).kitaplar['45550'];
  assert.equal(k.adimlar.kur.kanit.t0, DB_T0);
  assert.equal(k.adimlar.bekle.durum, 'tamam');
  assert.equal(k.adimlar.requeue.platformlar.windows.durum, 'tamam');
  assert.equal(k.adimlar.requeue.platformlar.pardus.durum, 'tamam');
  assert.equal(w.oncelik, '45550\r\n# 05.10 Nadir\r\n73768\r\n');
  assert.equal(k.adimlar.izle.platformlar.windows.durum, 'yayinlandi');
  assert.equal(w.bildirimler.length, 1);
  assert.deepEqual(w.bildirimler[0].slice(0, 1), ['paket']);
  assert.match(w.bildirimler[0][1], /45550: windows yayınlandı, pardus üretildi/);
  assert.equal(w.bildirimler[0][3], 'Set yenileme bitti');
  // Her UPDATE'ten önce yedek alındı.
  const sira = w.cagrilar.map((c) => c.args && c.args[c.args.length - 1]).filter((s) => /^(mkdir -p|mariadb )/.test(s || ''));
  assert.match(sira[0], /^mkdir -p/);
  assert.match(sira[1], /^mariadb /);
});

test('yedek doğrulanmazsa UPDATE çağrılmaz ve kitap durur', async () => {
  const { w, d } = sahteDunya({ yedekBozuk: true });
  const kod = await S.ana(['45550', '--uygula', '--ek-atla'], d, CFG);
  assert.equal(kod, 1);
  assert.equal(mariadbCagrilari(w).length, 0);
  const k = durumOku(w).kitaplar['45550'];
  assert.equal(k.durdu.adim, 'kur');
  assert.match(k.durdu.neden, /yedek doğrulanamadı/);
});

test('running platform satırı atlanır, diğeri kuyruğa alınır; öncelik yalnız windows tamamsa', async () => {
  const { w, d } = sahteDunya({
    platformlar: [{ book_id: '45550', platform: 'windows', status: 'running' }, { book_id: '45550', platform: 'pardus', status: 'completed' }],
  });
  const kod = await S.ana(['45550', '--uygula', '--ek-atla', '--kur-atla'], d, CFG);
  assert.equal(kod, 0);
  const updates = mariadbCagrilari(w).map((c) => c.girdi);
  assert.equal(updates.length, 1);
  assert.match(updates[0], /platform='pardus'/);
  const k = durumOku(w).kitaplar['45550'];
  assert.equal(k.adimlar.requeue.platformlar.windows.durum, 'atlandi');
  assert.equal(k.adimlar.oncelik.durum, 'atlandi');
  assert.equal(w.cagrilar.filter((c) => c.cmd === 'scp').length, 0);
  assert.ok(w.uyarilar.some((u) => /running — requeue ATLANDI/.test(u)));
});

test('ret yolu o kitabı durdurur, diğer kitap sürer', async () => {
  const { w, d } = sahteDunya({
    tikHook: (x) => {
      if (x.tik === 1) {
        Object.assign(x.kitaplar['11845'], { kaynak_kur_ret_at: '2026-10-06 09:10:00.000', kaynak_kur_ret_nedenleri: '[{"kod":"kitap-eksik","ayrinti":"liste 5"}]' });
        kurBitir('45550', 1)(x);
      }
    },
  });
  const kod = await S.ana(['11845', '45550', '--uygula', '--ek-atla', '--platform', 'pardus'], d, CFG);
  assert.equal(kod, 1);
  const st = durumOku(w);
  assert.equal(st.kitaplar['11845'].durdu.adim, 'bekle');
  assert.match(st.kitaplar['11845'].durdu.neden, /REDDEDİLDİ.*kitap-eksik: liste 5/);
  assert.equal(st.kitaplar['45550'].durdu, null);
  assert.equal(st.kitaplar['45550'].adimlar.requeue.platformlar.pardus.durum, 'tamam');
  const requeueler = mariadbCagrilari(w).filter((c) => /UPDATE pipeline_platform_summaries/.test(c.girdi));
  // Requeue kur beklemesinden ÖNCE yapılır: iki kitap da kuyruğa alındı; ret yalnız 11845'i durdurdu.
  assert.equal(requeueler.length, 2);
  assert.match(st.kitaplar['11845'].durdu.neden, /asılı kalır/);
  assert.ok(w.bildirimler.some((b) => /11845 durdu/.test(b[1])));
});

test('kur tavanı dolunca eylemsiz durur ve bildirir (requeue önceden yapılmıştır)', async () => {
  const { w, d } = sahteDunya();
  const kod = await S.ana(['45550', '--uygula', '--ek-atla', '--platform', 'pardus', '--kur-tavan', '3'], d, CFG);
  assert.equal(kod, S.CIKIS.KUR_TAVAN, 'tavan doldu = çıkış 3');
  assert.match(durumOku(w).kitaplar['45550'].durdu.neden, /3 dk içinde bitmedi/);
  assert.equal(mariadbCagrilari(w).filter((c) => /pipeline_platform_summaries/.test(c.girdi)).length, 1);
  assert.ok(w.bildirimler.some((b) => /45550 durdu \(bekle\)/.test(b[1])));
});

test('manuel kaynak: ek, kur ve bekle atlanır; doğrudan requeue', async () => {
  const { w, d } = sahteDunya({ kitaplar: { 45550: { book_id: '45550', kaynak_modu: 'manuel' } } });
  const kod = await S.ana(['45550', '--uygula', '--platform', 'pardus'], d, CFG);
  assert.equal(kod, 0);
  assert.equal(w.ekCalisti, undefined);
  const k = durumOku(w).kitaplar['45550'];
  for (const a of ['ek', 'kur', 'bekle']) assert.equal(k.adimlar[a].durum, 'atlandi', a);
  const q = mariadbCagrilari(w).map((c) => c.girdi);
  assert.equal(q.length, 1);
  assert.match(q[0], /UPDATE pipeline_platform_summaries/);
});

test('tohum kaynak yoksa (DB ve arşiv) o kitap ön kontrolde durur; arşiv varsa sürer', async () => {
  const { w, d } = sahteDunya({ tohum: [], arsiv: ['/ev/.empp-agent/kaynak-arsivi/45550/kaynak.json'] });
  const kod = await S.ana(['11845', '45550', '--ek-atla', '--platform', 'pardus'], d, CFG);
  assert.equal(kod, 1);
  assert.ok(w.loglar.some((l) => /11845: onkontrol — tohum kaynak yok/.test(l)));
  assert.ok(w.loglar.some((l) => /45550: \(2\) SQL/.test(l)));
  assert.ok(!w.loglar.some((l) => /11845: \(2\) SQL/.test(l)));
});

test('imza önceliği zaten baştaysa kasaya yazılmaz', async () => {
  const { w, d } = sahteDunya({ oncelik: '45550\r\n73768\r\n' });
  await S.ana(['45550', '--uygula', '--ek-atla', '--kur-atla'], d, CFG);
  assert.equal(w.cagrilar.filter((c) => c.cmd === 'scp').length, 0);
  assert.equal(durumOku(w).kitaplar['45550'].adimlar.oncelik.kanit.zaten, true);
});

test('--devam biten adımları atlar (ek/kur yeniden koşmaz, t0 korunur)', async () => {
  const ilk = sahteDunya({ ekKod: 0, kitaplar: {} });
  // İlk koşu: kur tavanı dolar → bekle adımında durur.
  await S.ana(['45550', '--uygula', '--platform', 'pardus', '--kur-tavan', '2'], ilk.d, CFG);
  const yol = Object.keys(ilk.w.yazilan)[0];
  const kayit = ilk.w.yazilan[yol];
  assert.equal(JSON.parse(kayit).kitaplar['45550'].adimlar.ek.durum, 'tamam');

  const ikinci = sahteDunya({ tikHook: kurBitir('45550', 1) });
  ikinci.w.yazilan[yol] = kayit;
  ikinci.w.kitaplar['45550'].kaynak_kur_istegi_at = DB_T0;
  const kod = await S.ana(['--devam', yol, '--uygula'], ikinci.d, CFG);
  assert.equal(kod, 0, ikinci.w.loglar.join('\n'));
  assert.equal(ikinci.w.ekCalisti, undefined, 'ek yeniden koşmadı');
  assert.equal(mariadbCagrilari(ikinci.w).filter((c) => /UPDATE pipeline_book_summaries/.test(c.girdi)).length, 0, 'kur isteği yeniden atılmadı');
  const st = JSON.parse(ikinci.w.yazilan[yol]);
  assert.equal(st.kitaplar['45550'].adimlar.kur.kanit.t0, DB_T0);
  assert.equal(st.kitaplar['45550'].adimlar.requeue.platformlar.pardus.durum, 'tamam');
  assert.deepEqual(st.secenekler.platformlar, ['pardus']);
});

test('srv21 birincil rota bağlanamazsa ProBook atlamalı yedek rota kullanılır', async () => {
  const { w, d } = sahteDunya({ srv21Birincil255: true });
  await S.ana(['45550', '--ek-atla', '--platform', 'pardus'], d, CFG);
  const srv = w.cagrilar.filter((c) => c.cmd === 'ssh' && (c.args.includes('root@10.0.0.21') || c.args.includes('root@100.117.187.26')));
  assert.ok(srv[0].args.includes('root@100.117.187.26'));
  assert.ok(srv[1].args.includes('-J') && srv[1].args.includes('etapadmin@100.73.161.76') && srv[1].args.includes('root@10.0.0.21'));
  // Seçilen rota yapışkan: sonraki çağrılar birincili yeniden denemez.
  assert.equal(srv.filter((c) => c.args.includes('root@100.117.187.26')).length, 1);
  assert.ok(w.uyarilar.some((u) => /YEDEK rota/.test(u)));
});

test('srv21: bağlantı dışı 255 yedeğe geçmez; 0 satır (çıkış 1, boş) hata değil', async () => {
  const cagri = [];
  const d = { calistir: async (cmd, args) => { cagri.push(args); return { kod: 255, stdout: '', stderr: 'remote komut 255 döndü' }; }, uyar: () => {} };
  const db = S.srv21Istemci(CFG, d);
  await assert.rejects(db.oku('SELECT 1'), /pipeline-sql çıkış 255/);
  assert.equal(cagri.length, 1);
  const bos = S.srv21Istemci(CFG, { calistir: async () => ({ kod: 1, stdout: '', stderr: '' }), uyar: () => {} });
  assert.deepEqual(await bos.oku('SELECT 1'), []);
  await assert.rejects(bos.oku('SELECT 1; DELETE FROM x'), /tek SELECT/);
  await assert.rejects(bos.oku('UPDATE x SET a=1'), /tek SELECT/);
});

test('ek-uret yoksa kuru kip uyarır, uygula kipinde kitap durur (UPDATE yok)', async () => {
  const kuru = sahteDunya({ ekUretVar: false });
  await S.ana(['45550', '--platform', 'pardus'], kuru.d, CFG);
  assert.ok(kuru.w.loglar.some((l) => /ek-uret bulunamadı/.test(l)));
  const gercek = sahteDunya({ ekUretVar: false });
  const kod = await S.ana(['45550', '--uygula', '--platform', 'pardus'], gercek.d, CFG);
  assert.equal(kod, 1);
  assert.equal(mariadbCagrilari(gercek.w).length, 0);
});

test('akış: t0 öncesi açık kilit bekletmez; yeni geçerli satır gelince requeue, kanıtta sürüm + kaynak', async () => {
  const { w, d } = sahteDunya({
    kitaplar: { 45550: { book_id: '45550', kaynak_modu: 'otomatik', kaynak_kurulum_baslangic: '2026-10-05 19:31:44.250', kaynak_kurulum_ajan: 'probook-etap' } },
    tikHook: kurBitir('45550', 1),
  });
  const kod = await S.ana(['45550', '--uygula', '--ek-atla', '--platform', 'pardus'], d, CFG);
  assert.equal(kod, 0, w.loglar.join('\n'));
  const k = durumOku(w).kitaplar['45550'];
  assert.deepEqual(k.adimlar.bekle.kanit, { surum: '2.25.7', kaynak: 'probook', olusturma: '2026-10-06 09:30:00.000' });
  assert.match(k.adimlar.bekle.not, /kurulum kilidi açık, ajan: probook-etap/);
  assert.equal(k.adimlar.requeue.platformlar.pardus.durum, 'tamam');
  assert.ok(w.loglar.some((l) => /kilidi açık.*bilgi; bekletmez/.test(l)));
});

test('akış: kurulum_* dolsa da yeni geçerli satır yoksa başarı sayılmaz (tavanda durur)', async () => {
  const { w, d } = sahteDunya({
    tikHook: (x) => { if (x.tik === 1) Object.assign(x.kitaplar['45550'], { kaynak_kurulum_bitis: '2026-10-06 09:30:00.000', kaynak_kurulum_surum: '2.25.7' }); },
  });
  const kod = await S.ana(['45550', '--uygula', '--ek-atla', '--platform', 'pardus', '--kur-tavan', '3'], d, CFG);
  assert.equal(kod, S.CIKIS.KUR_TAVAN, 'tavan doldu = çıkış 3');
  const k = durumOku(w).kitaplar['45550'];
  assert.equal(k.adimlar.bekle.durum, 'hata');
  assert.match(k.durdu.neden, /bitmedi/);
});

test('sıra: kur isteği → requeue → öncelik → yeni build bekleme (requeue beklemeden önce)', async () => {
  const { w, d } = sahteDunya({ tikHook: kurBitir('45550', 1) });
  const kod = await S.ana(['45550', '--uygula', '--ek-atla'], d, CFG);
  assert.equal(kod, 0, w.loglar.join('\n'));
  const son = (c) => (c.args ? c.args[c.args.length - 1] : '');
  const i = (f) => w.cagrilar.findIndex(f);
  const kur = i((c) => /UPDATE pipeline_book_summaries/.test(c.girdi || ''));
  const rq = i((c) => /UPDATE pipeline_platform_summaries/.test(c.girdi || ''));
  const onc = i((c) => /^powershell /.test(son(c)));
  const bekleOku = w.cagrilar.findIndex((c, n) => n > kur && /FROM kaynak_build_surumleri/.test(c.girdi || ''));
  assert.ok(kur >= 0 && rq > kur, 'requeue kur isteğinden sonra');
  assert.ok(onc > rq, 'öncelik requeue sonrası');
  assert.ok(bekleOku > onc, 'yeni build bekleme okuması requeue ve öncelikten SONRA');
  assert.equal(durumOku(w).kitaplar['45550'].adimlar.bekle.durum, 'tamam');
});

test('--kur-atla: (2) kur isteği ve bekleme yok, requeue + öncelik yine yapılır', async () => {
  const { w, d } = sahteDunya();
  const kod = await S.ana(['45550', '--uygula', '--ek-atla', '--kur-atla'], d, CFG);
  assert.equal(kod, 0);
  const q = mariadbCagrilari(w).map((c) => c.girdi);
  assert.equal(q.filter((x) => /UPDATE pipeline_book_summaries/.test(x)).length, 0);
  assert.equal(q.filter((x) => /UPDATE pipeline_platform_summaries/.test(x)).length, 2);
  const k = durumOku(w).kitaplar['45550'];
  assert.equal(k.adimlar.kur.durum, 'atlandi');
  assert.equal(k.adimlar.bekle.durum, 'atlandi');
  assert.equal(k.adimlar.oncelik.durum, 'tamam');
  assert.equal(w.tik, 0, 'bekleme döngüsüne girmedi');
});

test('kur isteği başarısızsa (yedek yok) requeue YAPILMAZ: eski kaynakla üretim açılmaz', async () => {
  const { w, d } = sahteDunya({ yedekBozuk: true });
  await S.ana(['45550', '--uygula', '--ek-atla'], d, CFG);
  assert.equal(w.cagrilar.filter((c) => /mariadb-dump .*pipeline_platform_summaries/.test(c.args ? c.args[c.args.length - 1] : '')).length, 0);
  assert.equal(mariadbCagrilari(w).length, 0);
});

// ─── Dayanıklılık (06.10, 15 set canlı koşusu) ────────────────────────────────────────────

test('ssh: srv21, kasa ve ProBook çağrılarının hepsi ControlPath=none taşır (mux çakışması yok)', async () => {
  const { w, d } = sahteDunya();
  await S.ana(['45550', '--ek-atla'], d, CFG);
  const ssh = w.cagrilar.filter((c) => c.cmd === 'ssh');
  assert.ok(ssh.length >= 5);
  for (const c of ssh) {
    const i = c.args.indexOf('ControlPath=none');
    assert.ok(i > 0 && c.args[i - 1] === '-o', c.args.join(' '));
  }
});

test('izleme: okuma zaman aşımı → 15 sn arayla 3 deneme → ölçüm atlandı → döngü sürer, sonra tamamlanır', async () => {
  let izleOkuma = 0;
  const { w, d } = sahteDunya({
    // requeue sonrası izleme okumalarının ilk 3'ü zaman aşımı (bir tur tamamen atlanır).
    okumaHata: (q, x) => {
      if (!/FROM pipeline_platform_summaries/.test(q) || !x.izlemeBasladi) return false;
      izleOkuma += 1;
      return izleOkuma <= 3;
    },
    tikHook: (x) => {
      x.izlemeBasladi = true;
      if (izleOkuma > 3) for (const p of x.platformlar.filter((y) => y.book_id === '45550')) Object.assign(p, { status: 'completed', last_run_at: '2026-10-06 11:00:00' });
    },
  });
  w.izlemeBasladi = false;
  const kod = await S.ana(['45550', '--uygula', '--ek-atla', '--kur-atla', '--platform', 'pardus', '--izle'], d, CFG);
  assert.equal(kod, 0, w.loglar.join('\n'));
  assert.ok(w.uyarilar.filter((u) => /izleme ölçümü: okuma hatası \(\d\/3\)/.test(u)).length >= 3);
  assert.ok(w.uyarilar.some((u) => /izleme ölçümü: ölçüm atlandı/.test(u)));
  assert.ok(w.bekleler.filter((ms) => ms === 15000).length >= 2, 'denemeler arası 15 sn');
  assert.equal(durumOku(w).kitaplar['45550'].adimlar.izle.platformlar.pardus.durum, 'uretildi-bitti');
  assert.equal(w.bildirimler.filter((b) => b[3] === 'Set yenileme bitti').length, 1);
});

test('bekleme: iki zaman aşımından sonra üçüncü deneme başarılı → yeni kaynak görülür', async () => {
  let n = 0;
  const { w, d } = sahteDunya({
    okumaHata: (q, x) => x.tik >= 1 && /FROM pipeline_book_summaries/.test(q) && (n += 1) <= 2,
    tikHook: kurBitir('45550', 1),
  });
  const kod = await S.ana(['45550', '--uygula', '--ek-atla', '--platform', 'pardus'], d, CFG);
  assert.equal(kod, 0, w.loglar.join('\n'));
  assert.equal(durumOku(w).kitaplar['45550'].adimlar.bekle.durum, 'tamam');
  assert.ok(!w.uyarilar.some((u) => /ölçüm atlandı/.test(u)));
});

test('bekleme: ölçüm hep başarısızsa araç düşmez, tavan dolunca çıkış 3', async () => {
  const { w, d } = sahteDunya({ okumaHata: (q, x) => x.tik >= 1 && /FROM kaynak_build_surumleri/.test(q) });
  const kod = await S.ana(['45550', '--uygula', '--ek-atla', '--platform', 'pardus', '--kur-tavan', '2'], d, CFG);
  assert.equal(kod, S.CIKIS.KUR_TAVAN);
  assert.match(durumOku(w).kitaplar['45550'].durdu.neden, /son ölçüm atlandı/);
});

test('yazma hatası (requeue) ilk hatada o kitabı durdurur, yeniden denemez; diğer kitap sürer; çıkış 1', async () => {
  const { w, d } = sahteDunya({ yazmaHata: (q) => /UPDATE pipeline_platform_summaries/.test(q) && /book_id='11845'/.test(q) });
  const kod = await S.ana(['11845', '45550', '--uygula', '--ek-atla', '--kur-atla', '--platform', 'pardus'], d, CFG);
  assert.equal(kod, S.CIKIS.HATA);
  const st = durumOku(w);
  assert.equal(st.kitaplar['11845'].durdu.adim, 'requeue');
  assert.match(st.kitaplar['11845'].durdu.neden, /yazma adımı hatası.*Lost connection/);
  assert.equal(mariadbCagrilari(w).filter((c) => /book_id='11845'/.test(c.girdi)).length, 1, 'yazma yeniden denenmedi');
  assert.equal(st.kitaplar['45550'].adimlar.requeue.platformlar.pardus.durum, 'tamam');
  assert.equal(w.bekleler.filter((ms) => ms === 15000).length, 0, 'yazmada yeniden deneme beklemesi yok');
});

test('yazma hatası (kur isteği) o kitapta requeue yapılmaz', async () => {
  const { w, d } = sahteDunya({ yazmaHata: (q) => /UPDATE pipeline_book_summaries/.test(q) });
  const kod = await S.ana(['45550', '--uygula', '--ek-atla', '--platform', 'pardus'], d, CFG);
  assert.equal(kod, S.CIKIS.HATA);
  assert.equal(durumOku(w).kitaplar['45550'].durdu.adim, 'kur');
  assert.equal(mariadbCagrilari(w).filter((c) => /pipeline_platform_summaries/.test(c.girdi)).length, 0);
});

test('çıkış kodu: tavan + başka hata birlikte → 1 (3 yalnız bütün durmalar tavansa)', async () => {
  const { w, d } = sahteDunya({ yazmaHata: (q) => /UPDATE pipeline_book_summaries/.test(q) && /book_id='11845'/.test(q) });
  const kod = await S.ana(['11845', '45550', '--uygula', '--ek-atla', '--platform', 'pardus', '--kur-tavan', '2'], d, CFG);
  assert.equal(kod, S.CIKIS.HATA);
  assert.equal(durumOku(w).kitaplar['45550'].durdu.kod, S.CIKIS.KUR_TAVAN);
});
