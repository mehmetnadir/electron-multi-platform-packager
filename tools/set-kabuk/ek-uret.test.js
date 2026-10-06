'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const E = require('./ek-uret');

const TABAN = Buffer.from('PK\u0003\u0004 sahte taban build içeriği');
const TABAN_SHA = crypto.createHash('sha256').update(TABAN).digest('hex');

function geciciDizin() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ek-uret-test-'));
}

function tsv(satirlar) {
  const baslik = ['book_id', 'kisa_kod', 'surum', 'r2_anahtar', 'sha256', 'boyut', 'bucket',
    'liste_hex', 'kaynak_kur_istegi_at'];
  return [baslik.join('\t'), ...satirlar.map((s) => baslik.map((b) => s[b] ?? 'NULL').join('\t'))]
    .join('\n');
}

function satir(id, ek = {}) {
  return {
    book_id: String(id), kisa_kod: 'abc12', surum: '2.25.6',
    r2_anahtar: `kaynak/${id}/2.25.6/build.zip`, sha256: TABAN_SHA, boyut: String(TABAN.length),
    bucket: 'ydsdigital', liste_hex: Buffer.from('111|A\n222|B').toString('hex'),
    kaynak_kur_istegi_at: '2026-10-05 22:15:56.883', ...ek,
  };
}

/** Sahte A modülü (kabuk-ek.js arayüzü). */
function sahteEk({ tavan = 4096 } = {}) {
  return {
    EK_TAVAN_BAYT: tavan,
    manifestKur: (m) => ({ sozlesme: 1, ...m, dosyalar: [...m.dosyalar.keys()].sort() }),
    ekPaketle: ({ manifest, dosyalar }) => Buffer.from(JSON.stringify({
      manifest: { ...manifest, uretildi: undefined },
      dosyalar: [...dosyalar].map(([k, v]) => [k, v.toString('base64')]),
    })),
    ekAnahtari: (b, s) => `kabuk-ek/${b}/${s}.zip`,
    retAnahtari: (b, s) => `kabuk-ek/${b}/${s}.ret.json`,
    sonAnahtari: (b) => `kabuk-ek/${b}/son.json`,
  };
}

/** Sahte bağımlılıklar; çağrılar `kayit`'a düşer. */
function sahteBag(ev, o = {}) {
  const kayit = { rclone: [], ssh: [], bildir: [], kabuk: [], merdiven: 0, setEki: [] };
  const dosyalar = o.dosyalar || new Map([
    ['index.html', Buffer.from('<html>kabuk</html>')],
    ['scripts/language-set.js', Buffer.from('sonrakiSatirDugmesi')],
  ]);
  const bag = {
    env: {}, ev, sinyalDinle: false,
    log: () => {}, warn: () => {},
    ssh: async (sql) => {
      kayit.ssh.push(sql);
      return { code: 0, stdout: o.tsv || tsv([satir(45550)]), stderr: '' };
    },
    rclone: async (args) => {
      kayit.rclone.push(args);
      if (args[0] === 'copyto' && String(args[1]).startsWith('ydsr2:')) {
        fs.writeFileSync(args[2], o.indirilen || TABAN);
        return { code: 0, stdout: '', stderr: '' };
      }
      if (o.yaziHatasi) return { code: 1, stdout: '', stderr: 'erişim yok' };
      return { code: 0, stdout: '', stderr: '' };
    },
    bildir: async (m) => { kayit.bildir.push(m); return { code: 0 }; },
    ek: () => sahteEk(o),
    kabukTazele: async (x) => {
      kayit.kabuk.push(x);
      if (o.kabuk) return o.kabuk(x);
      assert.equal(x.kabukKaynagi, 'ikili');
      await x.ekCikti({
        girdiSha: 'a'.repeat(64), kip: 'bookN', girdi: {}, dosyalar, kapaklar: {},
        a1Girdi: null, webzSettingsSha: 'b'.repeat(64),
      });
      return { durum: 'uygulandi', neden: null, girdiSha: 'a'.repeat(64) };
    },
    kaynakAdim: () => ({
      merdiven: async () => { kayit.merdiven += 1; },
      setEki: async (x) => { kayit.setEki.push(x); },
    }),
    r2Onbellek: async () => o.arsiv || null,
    merdivenAcik: () => Boolean(o.merdiven),
    setEki: () => ({
      ISARET: '[set-ek]', ekAcik: () => Boolean(o.setEki),
      setListesiCoz: ({ job }) => (job.setListesi
        ? { ham: job.setListesi, kaynak: 'claim' } : null),
    }),
    aracSurumu: () => ({ kaynak: 'a810e9f9', sha256: '6ccb35b1ae0c' }),
  };
  return { bag, kayit };
}

const yazmalar = (kayit) => kayit.rclone
  .filter((a) => a[0] === 'copyto' && String(a[2]).startsWith('ydsr2:'))
  .map((a) => a[2]);

// ─── Saf ─────────────────────────────────────────────────────────────────────────────────

test('argAyristir: kipler, hatalar', () => {
  assert.deepEqual(E.argAyristir(['--set', '45550,45485', '--kuru']).setler, ['45550', '45485']);
  assert.equal(E.argAyristir(['--bekleyen']).kip, 'bekleyen');
  assert.match(E.argAyristir([]).hata, /gerekli/);
  assert.match(E.argAyristir(['--set', '45x']).hata, /sayısal/);
  assert.match(E.argAyristir(['--set', '1', '--bekleyen']).hata, /birlikte/);
  assert.match(E.argAyristir(['--cikti']).hata, /değer/);
  assert.match(E.argAyristir(['--sil']).hata, /bilinmeyen/);
});

test('sqlKur: tek SELECT, uzak kabuğu bozan karakter yok, bekleyen koşulu', () => {
  const b = E.sqlKur({ kip: 'bekleyen' });
  assert.match(b, /^SELECT /);
  assert.doesNotMatch(b, /[;"$`\\]/);
  assert.match(b, /kaynak_kur_istegi_at > k\.olusturma/);
  assert.match(b, /<> 'manuel'/);
  assert.match(b, /kaynak_kur_ret_at IS NULL OR s\.kaynak_kur_ret_at < s\.kaynak_kur_istegi_at/);
  assert.match(E.sqlKur({ kip: 'set', setler: ['45550', '45485'] }), /IN \(45550, 45485\)/);
  assert.throws(() => E.sqlKur({ kip: 'set', setler: ['1; DROP'] }));
});

test('satirlariAyristir: hex liste, NULL, tekrar eden book_id', () => {
  const s = E.satirlariAyristir(tsv([satir(1), satir(1), satir(2, { liste_hex: 'NULL' })]));
  assert.equal(s.length, 2);
  assert.equal(s[0].setListesi, '111|A\n222|B');
  assert.equal(s[1].setListesi, null);
  assert.equal(s[0].boyut, TABAN.length);
  assert.throws(() => E.satirlariAyristir('book_id\tsurum\n1\t2'), /sütun yok/);
});

test('satirEngeli: YDS dışı bucket, kisaKod yok, bozuk anahtar', () => {
  const t = (ek) => E.satirEngeli(E.satirlariAyristir(tsv([satir(5, ek)]))[0]);
  assert.equal(t({}), null);
  assert.match(t({ bucket: 'akillitahtalar' }), /bucket/);
  assert.match(t({ kisa_kod: 'NULL' }), /kisaKod/);
  assert.match(t({ r2_anahtar: '../x' }), /anahtarı/);
});

test('aracSurumuAyristir + kaliciRetMi', () => {
  assert.deepEqual(E.aracSurumuAyristir('kaynak=a810e9f9 sha256=6ccb35b1ae0c kuruldu=x'),
    { kaynak: 'a810e9f9', sha256: '6ccb35b1ae0c' });
  assert.equal(E.kaliciRetMi('kapı RED (2; ilk: x)'), true);
  assert.equal(E.kaliciRetMi('Web-Z settings.json HTTP 503'), false);
});

// ─── Akış ────────────────────────────────────────────────────────────────────────────────

test('yükleme sırası: önce ek, sonra son.json; taban indirilip önbelleğe girer', async () => {
  const ev = geciciDizin();
  const { bag, kayit } = sahteBag(ev);
  assert.equal(await E.main(['--set', '45550'], bag), 0);
  assert.deepEqual(yazmalar(kayit), [
    `ydsr2:ydsdigital/kabuk-ek/45550/${'a'.repeat(64)}.zip`,
    'ydsr2:ydsdigital/kabuk-ek/45550/son.json',
  ]);
  const sonYerel = kayit.rclone.find((a) => String(a[2]).endsWith('son.json'))[1];
  const son = JSON.parse(fs.readFileSync(sonYerel, 'utf8'));
  assert.equal(son.girdiSha, 'a'.repeat(64));
  assert.equal(son.tabanSurum, '2.25.6');
  assert.ok(fs.existsSync(path.join(ev, 'kabuk-ek-onbellek', '45550', '2.25.6.zip')));
  assert.equal(kayit.kabuk[0].job.kisaKod, 'abc12');
});

test('tavan aşımında yükleme yok, bildirim var', async () => {
  const ev = geciciDizin();
  const { bag, kayit } = sahteBag(ev, { tavan: 10 });
  const s = E.satirlariAyristir(tsv([satir(45550)]))[0];
  const r = await E.setIsle(bag, s, { kuru: false });
  assert.equal(r.durum, 'tavan');
  assert.deepEqual(yazmalar(kayit), []);
  assert.match(kayit.bildir[0], /TAVANI/);
});

test('aynı girdiyle ikinci koşu aynı anahtar ve aynı ek baytı üretir', async () => {
  const ev = geciciDizin();
  const cikti = geciciDizin();
  const s = E.satirlariAyristir(tsv([satir(45550)]))[0];
  const r1 = await E.setIsle(sahteBag(ev).bag, s, { kuru: true, cikti });
  const b1 = fs.readFileSync(path.join(cikti, '45550', `${'a'.repeat(64)}.zip`));
  const { bag, kayit } = sahteBag(ev);
  const r2 = await E.setIsle(bag, s, { kuru: true, cikti });
  const b2 = fs.readFileSync(path.join(cikti, '45550', `${'a'.repeat(64)}.zip`));
  assert.equal(r1.anahtar, r2.anahtar);
  assert.ok(b1.equals(b2));
  assert.equal(r2.taban, '2.25.6/onbellek'); // ikinci koşu indirmedi
  assert.equal(kayit.rclone.length, 0);
});

test('--kuru hiç yüklemez, --cikti dosyaları bırakır, durum dosyası yazmaz', async () => {
  const ev = geciciDizin();
  const cikti = geciciDizin();
  const { bag, kayit } = sahteBag(ev);
  assert.equal(await E.main(['--set', '45550', '--kuru', '--cikti', cikti], bag), 0);
  assert.deepEqual(yazmalar(kayit), []);
  assert.ok(fs.existsSync(path.join(cikti, '45550', 'son.json')));
  assert.ok(!fs.existsSync(path.join(ev, 'kabuk-ek-durum.json')));
});

test('ek yüklenemezse son.json yüklenmez', async () => {
  const ev = geciciDizin();
  const { bag, kayit } = sahteBag(ev, { yaziHatasi: true });
  assert.equal(await E.main(['--set', '45550'], bag), 1);
  assert.equal(yazmalar(kayit).length, 1);
  assert.match(yazmalar(kayit)[0], /\.zip$/);
});

test('kalıcı ret: ek yok, .ret.json yazılır, bildirim', async () => {
  const ev = geciciDizin();
  const { bag, kayit } = sahteBag(ev, {
    kabuk: async () => ({
      durum: 'atlandi', neden: 'kapı RED (1; ilk: x)', girdiSha: 'c'.repeat(64),
    }),
  });
  assert.equal(await E.main(['--set', '45550'], bag), 0);
  assert.deepEqual(yazmalar(kayit), [`ydsr2:ydsdigital/kabuk-ek/45550/${'c'.repeat(64)}.ret.json`]);
  assert.match(kayit.bildir[0], /KALICI RET/);
});

test('geçici atlama (ağ) ret yazmaz, durum kaydı da düşmez', async () => {
  const ev = geciciDizin();
  const { bag, kayit } = sahteBag(ev, {
    kabuk: async () => ({ durum: 'atlandi', neden: 'Web-Z settings.json HTTP 503' }),
  });
  assert.equal(await E.main(['--bekleyen'], bag), 0);
  assert.deepEqual(yazmalar(kayit), []);
  assert.ok(!fs.existsSync(path.join(ev, 'kabuk-ek-durum.json')));
});

test('kilit tutulurken ikinci kopya çıkar; bayat kilit devralınır', async () => {
  const ev = geciciDizin();
  const kilit = path.join(ev, 'kabuk-ek.kilit');
  fs.mkdirSync(kilit);
  fs.writeFileSync(path.join(kilit, 'pid'), `${process.pid}\n`);
  const { bag, kayit } = sahteBag(ev);
  assert.equal(await E.main(['--set', '45550', '--kuru'], bag), 0);
  assert.equal(kayit.ssh.length, 0);

  const bayat = E.kilitAl(kilit, { pid: 4242, canli: () => false });
  assert.equal(typeof bayat, 'function');
  assert.equal(fs.readFileSync(path.join(kilit, 'pid'), 'utf8').trim(), '4242');
  assert.equal(E.kilitAl(kilit, { pid: 4343, canli: (p) => p === 4242 }), null);
  bayat();
  assert.ok(!fs.existsSync(kilit)); // os.tmpdir altına taşındı
  const yeni = E.kilitAl(kilit, { pid: 4343 });
  assert.equal(typeof yeni, 'function');
  yeni();
});

test('pid yazılmamış taze kilit meşgul sayılır', () => {
  const ev = geciciDizin();
  const kilit = path.join(ev, 'k');
  fs.mkdirSync(kilit);
  assert.equal(E.kilitAl(kilit, { pid: 1 }), null);
  assert.equal(typeof E.kilitAl(kilit, { pid: 1, simdi: () => Date.now() + 60000 }), 'function');
});

test('duraklat.istek varsa çalışmaz', async () => {
  const ev = geciciDizin();
  fs.writeFileSync(path.join(ev, 'duraklat.istek'), '');
  const { bag, kayit } = sahteBag(ev);
  assert.equal(await E.main(['--bekleyen'], bag), 0);
  assert.equal(kayit.ssh.length, 0);
  assert.ok(!fs.existsSync(path.join(ev, 'kabuk-ek.kilit')));
});

test('--bekleyen aynı istek + taban için ikinci kez üretmez', async () => {
  const ev = geciciDizin();
  const ilk = sahteBag(ev);
  assert.equal(await E.main(['--bekleyen'], ilk.bag), 0);
  assert.equal(yazmalar(ilk.kayit).length, 2);
  const ikinci = sahteBag(ev);
  assert.equal(await E.main(['--bekleyen'], ikinci.bag), 0);
  assert.equal(ikinci.kayit.kabuk.length, 0);
  const yeniSatir = satir(45550, { kaynak_kur_istegi_at: '2026-10-07 01:00:00' });
  const yeniIstek = sahteBag(ev, { tsv: tsv([yeniSatir]) });
  assert.equal(await E.main(['--bekleyen'], yeniIstek.bag), 0);
  assert.equal(yeniIstek.kayit.kabuk.length, 1);
});

test('taban: arşiv eşleşirse indirme yok; sha tutmazsa hata, yükleme yok', async () => {
  const ev = geciciDizin();
  const arsivZip = path.join(geciciDizin(), 'build.zip');
  fs.writeFileSync(arsivZip, TABAN);
  const a = sahteBag(ev, { arsiv: { zip: arsivZip } });
  const s = E.satirlariAyristir(tsv([satir(45550)]))[0];
  const r = await E.setIsle(a.bag, s, { kuru: true });
  assert.equal(r.taban, '2.25.6/arsiv');
  assert.equal(a.kayit.rclone.length, 0);

  const b = sahteBag(geciciDizin(), { indirilen: Buffer.from('bozuk') });
  const r2 = await E.setIsle(b.bag, s, { kuru: false });
  assert.equal(r2.durum, 'hata');
  assert.match(r2.neden, /doğrulanamadı/);
  assert.deepEqual(yazmalar(b.kayit), []);
  assert.equal(b.kayit.kabuk.length, 0);
});

test('merdiven + set eki env bayraklarıyla, liste DB satırından', async () => {
  const ev = geciciDizin();
  const { bag, kayit } = sahteBag(ev, { merdiven: true, setEki: true });
  const s = E.satirlariAyristir(tsv([satir(45550)]))[0];
  await E.setIsle(bag, s, { kuru: true });
  assert.equal(kayit.merdiven, 1);
  assert.equal(kayit.setEki[0].liste, '111|A\n222|B');
  assert.equal(kayit.kabuk[0].zip, kayit.setEki[0].zip);
});

test('YDS dışı set atlanır, taban okunmaz', async () => {
  const ev = geciciDizin();
  const { bag, kayit } = sahteBag(ev, { tsv: tsv([satir(74427, { bucket: 'akillitahtalar' })]) });
  assert.equal(await E.main(['--set', '74427'], bag), 0);
  assert.equal(kayit.rclone.length, 0);
  assert.equal(kayit.kabuk.length, 0);
});

test('ekCikti çağrılmazsa (kabuk atlandı) ek yok', async () => {
  const ev = geciciDizin();
  const { bag, kayit } = sahteBag(ev, {
    kabuk: async () => ({ durum: 'atlandi', neden: 'bookN düzeni yok' }),
  });
  assert.equal(await E.main(['--bekleyen'], bag), 0);
  assert.deepEqual(yazmalar(kayit), []);
  const d = JSON.parse(fs.readFileSync(path.join(ev, 'kabuk-ek-durum.json'), 'utf8'));
  assert.equal(d['45550'].durum, 'atlandi'); // uygun değil: aynı istekte yeniden denenmez
});
