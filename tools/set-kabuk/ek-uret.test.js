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
const SHA_A = 'a'.repeat(64);

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

/** Sahte A modülü (kabuk-ek.js arayüzü; imza gerçek ed25519). */
function sahteEk({ tavan = 4096 } = {}) {
  return {
    EK_TAVAN_BAYT: 1,
    tavanAl: () => tavan,
    manifestKur: (m) => ({ sozlesme: 1, ...m, dosyalar: [...m.dosyalar.keys()].sort() }),
    ekPaketle: ({ manifest, dosyalar }, s) => Buffer.from(JSON.stringify({
      klasorler: [...((s && s.klasorler) || [])],
      manifest: { ...manifest, uretildi: undefined },
      dosyalar: [...dosyalar].map(([k, v]) => [k, v.toString('base64')]),
    })),
    ekImzala: (buf, pem) => crypto.sign(null, buf, crypto.createPrivateKey(pem)).toString('base64'),
    ekImzaDogrula: (buf, b64, acik) => crypto.verify(null, buf, acik, Buffer.from(b64, 'base64')),
    ekAc: (buf, b) => {
      const j = JSON.parse(buf.toString('utf8'));
      if (j.manifest.girdiSha !== b.girdiSha) throw new Error('bayat');
      return { manifest: j.manifest, dosyalar: new Map() };
    },
    ekAnahtari: (b, s) => `kabuk-ek/${b}/${s}.zip`,
    imzaAnahtari: (b, s) => `kabuk-ek/${b}/${s}.imza`,
    retAnahtari: (b, s) => `kabuk-ek/${b}/${s}.ret.json`,
    sonAnahtari: (b) => `kabuk-ek/${b}/son.json`,
  };
}

/** Sahte bağımlılıklar; çağrılar `kayit`'a düşer. */
function sahteBag(ev, o = {}) {
  const kayit = {
    rclone: [], ssh: [], bildir: [], kabuk: [], merdiven: 0, setEki: [], webz: 0, log: [],
  };
  const r2 = o.r2 || new Map();
  const dosyalar = o.dosyalar || new Map([
    ['index.html', Buffer.from('<html>kabuk</html>')],
    ['scripts/language-set.js', Buffer.from('sonrakiSatirDugmesi')],
  ]);
  const bag = {
    env: {}, ev, sinyalDinle: false,
    log: (...a) => kayit.log.push(a.join(' ')), warn: (...a) => kayit.log.push(a.join(' ')),
    ssh: async (sql) => {
      kayit.ssh.push(sql);
      if (o.sshSonuc) return o.sshSonuc;
      return { code: 0, stdout: o.tsv || tsv([satir(45550)]), stderr: '' };
    },
    // R2 bellek deposu: kaynak/ anahtarları taban döner; kabuk-ek/ anahtarları yüklenen içerik.
    rclone: async (args) => {
      kayit.rclone.push(args);
      const [, kaynak, hedef] = args;
      if (args[0] === 'copyto' && String(kaynak).startsWith('ydsr2:')) {
        if (r2.has(kaynak)) fs.writeFileSync(hedef, r2.get(kaynak));
        else if (/:ydsdigital\/kaynak\//.test(kaynak)) {
          fs.writeFileSync(hedef, o.indirilen || TABAN);
        }
        else return { code: 3, stdout: '', stderr: 'object not found' };
        return { code: 0, stdout: '', stderr: '' };
      }
      if (o.yaziHatasi) return { code: 1, stdout: '', stderr: 'erişim yok' };
      r2.set(hedef, fs.readFileSync(kaynak));
      return { code: 0, stdout: '', stderr: '' };
    },
    bildir: async (m) => { kayit.bildir.push(m); return { code: 0 }; },
    ek: () => o.ekModulu || sahteEk(o),
    kabukTazele: async (x) => {
      kayit.kabuk.push(x);
      if (o.kabuk) return o.kabuk(x);
      assert.equal(x.kabukKaynagi, 'ikili');
      await x.ekCikti({
        girdiSha: SHA_A, kip: 'bookN', girdi: { kitaplar: [{ klasor: 'book1' }] },
        dosyalar, kapaklar: {}, a1Girdi: null, webzSettingsSha: o.ktWebz || 'b'.repeat(64),
      });
      return { durum: 'uygulandi', neden: null, girdiSha: SHA_A };
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
    uretec: () => ({
      uretecAcik: () => o.uretecKapali !== true,
      tabanUretecMi: () => (o.uretecTabani ? { atla: true, sebep: 'üreteç build\'i (işaret)' }
        : { atla: false, sebep: null }),
      tabanKitapEksik: () => (o.kitapEksik ? { atla: true, sebep: 'liste', eksik: o.kitapEksik }
        : { atla: false, sebep: null }),
    }),
    panelMenu: () => ({ kokIcerikVarMi: (z, id) => (o.kokteDuran || []).includes(id) }),
    tabanTekMotor: () => Boolean(o.tekMotor),
    aracDenetle: () => o.aracEksik || null,
    webzSha: async () => {
      kayit.webz += 1;
      return o.webzSha === undefined ? 'b'.repeat(64) : o.webzSha;
    },
  };
  return { bag, kayit, r2 };
}

/** Test ev dizinine imza anahtarı kurar. */
function anahtarKur(ev) {
  return E.anahtarUret(path.join(ev, 'kabuk-ek-imza'));
}

const yazmalar = (kayit) => kayit.rclone
  .filter((a) => a[0] === 'copyto' && String(a[2]).startsWith('ydsr2:'))
  .map((a) => a[2]);

const tekSatir = (ek) => E.satirlariAyristir(tsv([satir(45550, ek)]))[0];

// ─── Saf ─────────────────────────────────────────────────────────────────────────────────

test('argAyristir: kipler, hatalar', () => {
  assert.deepEqual(E.argAyristir(['--set', '45550,45485', '--kuru']).setler, ['45550', '45485']);
  assert.equal(E.argAyristir(['--bekleyen']).kip, 'bekleyen');
  assert.equal(E.argAyristir(['--anahtar-uret']).kip, 'anahtar');
  assert.match(E.argAyristir([]).hata, /gerekli/);
  assert.match(E.argAyristir(['--set', '45x']).hata, /sayısal/);
  assert.match(E.argAyristir(['--set', '1', '--bekleyen']).hata, /birlikte/);
  assert.match(E.argAyristir(['--anahtar-uret', '--bekleyen']).hata, /birlikte/);
  assert.match(E.argAyristir(['--cikti']).hata, /değer/);
  assert.match(E.argAyristir(['--sil']).hata, /bilinmeyen/);
});

test('sshHedefi: varsayılan ve EMPP_SRV21_SSH', () => {
  assert.deepEqual(E.sshHedefi({}).slice(-3), ['-p', '2222', 'root@100.117.187.26']);
  assert.deepEqual(E.sshHedefi({ EMPP_SRV21_SSH: ' -p 22  root@10.0.0.21 ' }).slice(-3),
    ['-p', '22', 'root@10.0.0.21']);
  assert.ok(E.sshHedefi({}).includes('BatchMode=yes'));
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

test('kaliciRetMi: kapı RED, eşleme, kapak 404/küçük gövde kalıcı; 5xx ve ağ geçici', () => {
  assert.equal(E.kaliciRetMi('kapı RED (2; ilk: x)'), true);
  assert.equal(E.kaliciRetMi('A1 atlandı — eşlenemeyen Web-Z üyesi: x (eski düzen korundu)'), true);
  assert.equal(E.kaliciRetMi('kapak geçersiz (book1): HTTP 404, 9 bayt'), true);
  assert.equal(E.kaliciRetMi('kapak geçersiz (book1): HTTP 200, 12 bayt'), true);
  assert.equal(E.kaliciRetMi('kapak geçersiz (book1): HTTP 503, 0 bayt'), false);
  assert.equal(E.kaliciRetMi('kapak geçersiz (book1): HTTP undefined, 0 bayt'), false);
  assert.equal(E.kaliciRetMi('kapak alınamadı (book1): fetch failed'), false);
  assert.equal(E.kaliciRetMi('Web-Z settings.json HTTP 503'), false);
});

test('aracSurumuAyristir', () => {
  assert.deepEqual(E.aracSurumuAyristir('kaynak=a810e9f9 sha256=6ccb35b1ae0c kuruldu=x'),
    { kaynak: 'a810e9f9', sha256: '6ccb35b1ae0c' });
});

test('geri çekilme: 15 → 30 → 60 → 120 dk, tavan 6 sa', () => {
  const dk = (n) => E.geriCekilmeMs(n) / 60000;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 10].map(dk), [15, 30, 60, 120, 240, 360, 360]);
});

test('atlamaNedeni: kesin/aynı → islendi; webz sha değişti → yeniden; geçici → geri', () => {
  const s = tekSatir();
  const kesin = { istekAt: s.istekAt, tabanSurum: s.surum, kesin: true, webzSettingsSha: 'x' };
  assert.equal(E.atlamaNedeni(kesin, s, { webzSha: 'x' }), 'islendi');
  assert.equal(E.atlamaNedeni(kesin, s, { webzSha: null }), 'islendi');
  assert.equal(E.atlamaNedeni(kesin, s, { webzSha: 'y' }), null);
  assert.equal(E.atlamaNedeni({ ...kesin, tabanSurum: '2.25.7' }, s, { webzSha: 'x' }), null);
  assert.equal(E.atlamaNedeni({ ...kesin, istekAt: 'eski' }, s, { webzSha: 'x' }), null);
  const simdi = Date.parse('2026-10-06T10:00:00Z');
  const gecici = (n, dkOnce) => ({
    istekAt: s.istekAt, kesin: false, hataSayisi: n,
    sonDeneme: new Date(simdi - dkOnce * 60000).toISOString(),
  });
  assert.equal(E.atlamaNedeni(gecici(1, 10), s, { simdi }), 'geri');
  assert.equal(E.atlamaNedeni(gecici(1, 16), s, { simdi }), null);
  assert.equal(E.atlamaNedeni(gecici(3, 59), s, { simdi }), 'geri');
  assert.equal(E.atlamaNedeni(gecici(3, 61), s, { simdi }), null);
});

test('durumKaydi: ret işareti yazılmadıysa kesin değil, hata sayacı artar', () => {
  const s = tekSatir();
  const r1 = E.durumKaydi(null, s, { durum: 'ret', retYazildi: false });
  assert.equal(r1.kesin, false);
  assert.equal(r1.hataSayisi, 1);
  const r2 = E.durumKaydi(r1, s, { durum: 'hata' });
  assert.equal(r2.hataSayisi, 2);
  const r3 = E.durumKaydi(r2, s, { durum: 'yuklendi', webzSettingsSha: 'w' });
  assert.equal(r3.kesin, true);
  assert.equal(r3.hataSayisi, 0);
  assert.equal(E.durumKaydi(null, s, { durum: 'ret', retYazildi: true }).kesin, true);
});

// ─── İmza anahtarı ───────────────────────────────────────────────────────────────────────

test('--anahtar-uret: 600 izinli özel anahtar, ikinci çağrı EZMEZ, özel anahtar loga düşmez',
  async () => {
    const ev = geciciDizin();
    const { bag, kayit } = sahteBag(ev);
    assert.equal(await E.main(['--anahtar-uret'], bag), 0);
    const ozel = path.join(ev, 'kabuk-ek-imza', 'ozel.pem');
    const pem = fs.readFileSync(ozel, 'utf8');
    assert.equal(fs.statSync(ozel).mode & 0o777, 0o600);
    assert.match(kayit.log[0], /üretildi.*parmak izi sha256:[0-9a-f]{64}/);
    assert.equal(await E.main(['--anahtar-uret'], bag), 0);
    assert.equal(fs.readFileSync(ozel, 'utf8'), pem);
    assert.match(kayit.log[1], /ZATEN VAR/);
    const govde = pem.split('\n').filter((l) => l && !l.startsWith('-----'))[0];
    assert.ok(kayit.log.every((l) => !l.includes(govde)));
    assert.equal(kayit.log[0].split('parmak izi ')[1], kayit.log[1].split('parmak izi ')[1]);
  });

// ─── Akış ────────────────────────────────────────────────────────────────────────────────

test('yükleme sırası: zip → imza → son.json; imza açık anahtarla doğrulanır', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const { bag, kayit } = sahteBag(ev);
  assert.equal(await E.main(['--set', '45550'], bag), 0);
  assert.deepEqual(yazmalar(kayit), [
    `ydsr2:ydsdigital/kabuk-ek/45550/${SHA_A}.zip`,
    `ydsr2:ydsdigital/kabuk-ek/45550/${SHA_A}.imza`,
    'ydsr2:ydsdigital/kabuk-ek/45550/son.json',
  ]);
  const yerel = (son) => kayit.rclone
    .find((a) => String(a[2]).startsWith('ydsr2:') && String(a[2]).endsWith(son))[1];
  const son = JSON.parse(fs.readFileSync(yerel('son.json'), 'utf8'));
  assert.equal(son.girdiSha, SHA_A);
  assert.equal(son.tabanSurum, '2.25.6');
  const acik = crypto.createPublicKey(fs.readFileSync(path.join(ev, 'kabuk-ek-imza', 'acik.pem')));
  const imza = Buffer.from(fs.readFileSync(yerel('.imza'), 'utf8'), 'base64');
  assert.ok(crypto.verify(null, fs.readFileSync(yerel('.zip')), acik, imza));
  assert.equal(kayit.kabuk[0].job.kisaKod, 'abc12');
});

test('özel anahtar yoksa: yükleme yok, DB sorgusu yok, bildirim', async () => {
  const ev = geciciDizin();
  const { bag, kayit } = sahteBag(ev);
  assert.equal(await E.main(['--set', '45550'], bag), 1);
  assert.equal(kayit.ssh.length, 0);
  assert.deepEqual(yazmalar(kayit), []);
  assert.match(kayit.bildir[0], /özel anahtar yok/);
});

test('araç eksikse taban indirilmez, DB sorgusu yok', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const { bag, kayit } = sahteBag(ev, { aracEksik: 'Swift ikilisi yok: /x' });
  assert.equal(await E.main(['--set', '45550'], bag), 1);
  assert.equal(kayit.ssh.length, 0);
  assert.equal(kayit.rclone.length, 0);
});

test('tavan (A tavanAl) aşımında yükleme yok, bildirim var', async () => {
  const ev = geciciDizin();
  const { bag, kayit } = sahteBag(ev, { tavan: 10 });
  const r = await E.setIsle(bag, tekSatir(), { kuru: false, ozelAnahtar: 'x' });
  assert.equal(r.durum, 'tavan');
  assert.deepEqual(yazmalar(kayit), []);
  assert.match(kayit.bildir[0], /TAVANI.*> 10 bayt/);
});

test('ikinci koşu: aynı anahtar, taban önbellekten, sabit çalışma dizini', async () => {
  const ev = geciciDizin();
  const cikti = geciciDizin();
  const s = tekSatir();
  const r1 = await E.setIsle(sahteBag(ev).bag, s, { kuru: true, cikti });
  const b1 = fs.readFileSync(path.join(cikti, '45550', `${SHA_A}.zip`));
  const { bag, kayit } = sahteBag(ev);
  const r2 = await E.setIsle(bag, s, { kuru: true, cikti });
  const b2 = fs.readFileSync(path.join(cikti, '45550', `${SHA_A}.zip`));
  assert.equal(r1.anahtar, r2.anahtar);
  assert.ok(b1.equals(b2));
  assert.equal(r2.taban, '2.25.6/onbellek');
  assert.equal(kayit.rclone.length, 0);
  assert.deepEqual(fs.readdirSync(path.join(ev, 'kabuk-ek-calisma')), ['45550']);
  assert.deepEqual(fs.readdirSync(path.join(ev, 'kabuk-ek-calisma', '45550')).sort(),
    ['build.zip', 'ek.zip', 'son.json']);
  assert.deepEqual(fs.readdirSync(path.join(ev, 'kabuk-ek-onbellek', '45550')).sort(),
    ['taban.json', 'taban.zip']);
});

test('yeni taban sürümü önbellekte eskisinin ÜZERİNE yazılır (tek dosya)', async () => {
  const ev = geciciDizin();
  await E.setIsle(sahteBag(ev).bag, tekSatir(), { kuru: true });
  const yeni = Buffer.from('PK\u0003\u0004 yeni sürüm tabanı, daha uzun içerik');
  const s2 = tekSatir({
    surum: '2.25.7', r2_anahtar: 'kaynak/45550/2.25.7/build.zip', boyut: String(yeni.length),
    sha256: crypto.createHash('sha256').update(yeni).digest('hex'),
  });
  const { bag, kayit } = sahteBag(ev, { indirilen: yeni });
  const r = await E.setIsle(bag, s2, { kuru: true });
  assert.equal(r.taban, '2.25.7/R2');
  assert.equal(r.indirilenBayt, yeni.length);
  assert.equal(kayit.rclone.length, 1);
  const dizin = path.join(ev, 'kabuk-ek-onbellek', '45550');
  assert.deepEqual(fs.readdirSync(dizin).sort(), ['taban.json', 'taban.zip']);
  assert.ok(fs.readFileSync(path.join(dizin, 'taban.zip')).equals(yeni));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dizin, 'taban.json'))).surum, '2.25.7');
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

test('ek yüklenemezse imza ve son.json yüklenmez', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const { bag, kayit } = sahteBag(ev, { yaziHatasi: true });
  assert.equal(await E.main(['--set', '45550'], bag), 1);
  assert.equal(yazmalar(kayit).length, 1);
  assert.match(yazmalar(kayit)[0], /\.zip$/);
});

test('kalıcı ret: ek yok, .ret.json yazılır, kayıt kesin', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const { bag, kayit } = sahteBag(ev, {
    kabuk: async () => ({
      durum: 'atlandi', neden: 'kapı RED (1; ilk: x)', girdiSha: 'c'.repeat(64),
    }),
  });
  assert.equal(await E.main(['--set', '45550'], bag), 0);
  assert.deepEqual(yazmalar(kayit), [`ydsr2:ydsdigital/kabuk-ek/45550/${'c'.repeat(64)}.ret.json`]);
  assert.match(kayit.bildir[0], /KALICI RET/);
  const d = JSON.parse(fs.readFileSync(path.join(ev, 'kabuk-ek-durum.json'), 'utf8'));
  assert.equal(d['45550'].kesin, true);
});

test('kalıcı ret ama girdiSha yok: ret yazılmaz, kayıt kesin DEĞİL', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const { bag, kayit } = sahteBag(ev, {
    kabuk: async () => ({ durum: 'atlandi', neden: 'kapak geçersiz (book1): HTTP 404, 9 bayt' }),
  });
  await E.main(['--bekleyen'], bag);
  assert.deepEqual(yazmalar(kayit), []);
  const d = JSON.parse(fs.readFileSync(path.join(ev, 'kabuk-ek-durum.json'), 'utf8'));
  assert.equal(d['45550'].kesin, false);
  assert.equal(d['45550'].hataSayisi, 1);
});

test('kapak HTTP 5xx: ret değil, geçici; ikinci koşu geri çekilir', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const kabuk = async () => ({
    durum: 'atlandi', neden: 'kapak geçersiz (book1): HTTP 503, 0 bayt', girdiSha: 'c'.repeat(64),
  });
  const ilk = sahteBag(ev, { kabuk });
  assert.equal(await E.main(['--bekleyen'], ilk.bag), 0);
  assert.deepEqual(yazmalar(ilk.kayit), []);
  assert.equal(ilk.kayit.bildir.length, 0);
  const ikinci = sahteBag(ev, { kabuk });
  await E.main(['--bekleyen'], ikinci.bag);
  assert.equal(ikinci.kayit.kabuk.length, 0);
  assert.ok(ikinci.kayit.log.some((l) => /45550:geri/.test(l)));
});

test('kilit: tutulurken ikinci kopya çıkar; bayat devralınır; taşınamazsa null', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const kilit = path.join(ev, 'kabuk-ek.kilit');
  fs.mkdirSync(kilit);
  fs.writeFileSync(path.join(kilit, 'pid'), `${process.pid}\n`);
  const { bag, kayit } = sahteBag(ev);
  assert.equal(await E.main(['--set', '45550', '--kuru'], bag), 0);
  assert.equal(kayit.ssh.length, 0);

  assert.equal(E.kilitAl(kilit, { pid: 4141, canli: () => false, kenar: () => false }), null);
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

test('--bekleyen: aynı istek + taban + Web-Z sha → üretmez; sha değişince üretir', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const ilk = sahteBag(ev);
  assert.equal(await E.main(['--bekleyen'], ilk.bag), 0);
  assert.equal(yazmalar(ilk.kayit).length, 3);
  const ikinci = sahteBag(ev);
  assert.equal(await E.main(['--bekleyen'], ikinci.bag), 0);
  assert.equal(ikinci.kayit.kabuk.length, 0);
  assert.equal(ikinci.kayit.webz, 1); // yalnız settings.json çekildi
  const degisti = sahteBag(ev, { webzSha: 'd'.repeat(64), ktWebz: 'd'.repeat(64) });
  assert.equal(await E.main(['--bekleyen'], degisti.bag), 0);
  assert.equal(degisti.kayit.kabuk.length, 1);
  const yeniSatir = satir(45550, { kaynak_kur_istegi_at: '2026-10-07 01:00:00' });
  const yeniIstek = sahteBag(ev, { tsv: tsv([yeniSatir]), webzSha: 'd'.repeat(64) });
  assert.equal(await E.main(['--bekleyen'], yeniIstek.bag), 0);
  assert.equal(yeniIstek.kayit.kabuk.length, 1);
});

test('taban: arşiv eşleşirse indirme yok; sha tutmazsa hata, yükleme yok', async () => {
  const ev = geciciDizin();
  const arsivZip = path.join(geciciDizin(), 'build.zip');
  fs.writeFileSync(arsivZip, TABAN);
  const a = sahteBag(ev, { arsiv: { zip: arsivZip } });
  const r = await E.setIsle(a.bag, tekSatir(), { kuru: true });
  assert.equal(r.taban, '2.25.6/arsiv');
  assert.equal(a.kayit.rclone.length, 0);
  assert.ok(fs.readFileSync(arsivZip).equals(TABAN)); // arşiv değişmedi

  const b = sahteBag(geciciDizin(), { indirilen: Buffer.from('bozuk') });
  const r2 = await E.setIsle(b.bag, tekSatir(), { kuru: false, ozelAnahtar: 'x' });
  assert.equal(r2.durum, 'hata');
  assert.match(r2.neden, /doğrulanamadı/);
  assert.deepEqual(yazmalar(b.kayit), []);
  assert.equal(b.kayit.kabuk.length, 0);
});

test('klonla: yarım kalmış .yeni dosyası üzerine yazılır, kaynak değişmez', async () => {
  const d = geciciDizin();
  fs.writeFileSync(path.join(d, 'kaynak'), 'yeni içerik');
  fs.writeFileSync(path.join(d, 'hedef'), 'eski');
  fs.writeFileSync(path.join(d, 'hedef.yeni'), 'yarım');
  await E.klonla(path.join(d, 'kaynak'), path.join(d, 'hedef'));
  assert.equal(fs.readFileSync(path.join(d, 'hedef'), 'utf8'), 'yeni içerik');
  assert.deepEqual(fs.readdirSync(d).sort(), ['hedef', 'kaynak']);
});

test('merdiven + set eki env bayraklarıyla, liste DB satırından', async () => {
  const ev = geciciDizin();
  const { bag, kayit } = sahteBag(ev, { merdiven: true, setEki: true });
  await E.setIsle(bag, tekSatir(), { kuru: true });
  assert.equal(kayit.merdiven, 1);
  assert.equal(kayit.setEki[0].liste, '111|A\n222|B');
  assert.equal(kayit.kabuk[0].zip, kayit.setEki[0].zip);
});

test('YDS dışı set atlanır, taban okunmaz', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const { bag, kayit } = sahteBag(ev, { tsv: tsv([satir(74427, { bucket: 'akillitahtalar' })]) });
  assert.equal(await E.main(['--set', '74427'], bag), 0);
  assert.equal(kayit.rclone.length, 0);
  assert.equal(kayit.kabuk.length, 0);
});

test('ekCikti çağrılmazsa (kabuk atlandı, uygun değil) ek yok, kayıt kesin', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const { bag, kayit } = sahteBag(ev, {
    kabuk: async () => ({ durum: 'atlandi', neden: 'bookN düzeni yok' }),
  });
  assert.equal(await E.main(['--bekleyen'], bag), 0);
  assert.deepEqual(yazmalar(kayit), []);
  const d = JSON.parse(fs.readFileSync(path.join(ev, 'kabuk-ek-durum.json'), 'utf8'));
  assert.equal(d['45550'].durum, 'atlandi');
  assert.equal(d['45550'].kesin, true);
});

test('ekPaketle beyaz liste klasörlerini girdi.kitaplar\'dan alır', async () => {
  const ev = geciciDizin();
  const cikti = geciciDizin();
  const { bag } = sahteBag(ev);
  await E.setIsle(bag, tekSatir(), { kuru: true, cikti });
  const paket = JSON.parse(fs.readFileSync(path.join(cikti, '45550', `${SHA_A}.zip`)));
  assert.deepEqual(paket.klasorler, ['book1']);
});

test('gerçek kabuk-ek modülü: üretilen ek ekAc doğrulamasından geçer', async (t) => {
  let A;
  try {
    A = require('../../src/agent/kabuk-ek');
  } catch (_) {
    t.skip('src/agent/kabuk-ek.js yok (Parça A birleşmedi)');
    return;
  }
  const ev = geciciDizin();
  const cikti = geciciDizin();
  const { bag } = sahteBag(ev, {
    ekModulu: A,
    dosyalar: new Map([
      ['index.html', Buffer.from('<html>kabuk</html>')],
      ['scripts/language-set.js', Buffer.from('sonrakiSatirDugmesi')],
      ['images/book1.png', Buffer.alloc(2048, 1)],
    ]),
  });
  const r = await E.setIsle(bag, tekSatir(), { kuru: true, cikti });
  assert.equal(r.durum, 'kuru');
  assert.equal(r.anahtar, `kabuk-ek/45550/${SHA_A}.zip`);
  const buf = fs.readFileSync(path.join(cikti, '45550', `${SHA_A}.zip`));
  const acik = A.ekAc(buf, {
    bookId: '45550', girdiSha: SHA_A, kip: 'bookN', klasorler: ['book1'],
  });
  assert.equal(acik.dosyalar.size, 3);
  assert.equal(acik.manifest.tabanSurum, '2.25.6');
  assert.deepEqual(acik.manifest.arac, { kaynak: 'a810e9f9', sha256: '6ccb35b1ae0c' });
});

test('--kuru: A modülünde ekImzala yoksa ek imzasız üretilir, çökme yok', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const ek = sahteEk();
  delete ek.ekImzala;
  const { bag, kayit } = sahteBag(ev, { ekModulu: ek });
  assert.equal(await E.main(['--set', '45550', '--kuru'], bag), 0);
  assert.ok(kayit.log.some((l) => /imza YOK/.test(l)));
});

test('gerçek kip: A modülünde ekImzala yoksa yükleme yok + bildir', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const ek = sahteEk();
  delete ek.ekImzala;
  const { bag, kayit } = sahteBag(ev, { ekModulu: ek });
  assert.equal(await E.main(['--set', '45550'], bag), 1);
  assert.equal(kayit.ssh.length, 0);
  assert.match(kayit.bildir[0], /ekImzala/);
});

test('sqlSonucu: rc=1 + boş çıktı = 0 satır; ssh 255 ya da stderr dolu = hata', () => {
  assert.equal(E.sqlSonucu({ code: 1, stdout: '', stderr: '' }).durum, 'bos');
  assert.equal(E.sqlSonucu({ code: 1, stdout: '\n', stderr: ' ' }).durum, 'bos');
  assert.equal(E.sqlSonucu({ code: 0, stdout: 'a\tb', stderr: '' }).durum, 'satir');
  const h = E.sqlSonucu({ code: 255, stdout: '', stderr: 'ssh: connect timed out' });
  assert.equal(h.durum, 'hata');
  assert.match(h.hata, /timed out/);
  assert.equal(E.sqlSonucu({ code: 1, stdout: '', stderr: 'ERROR 1054' }).durum, 'hata');
  assert.equal(E.sqlSonucu({ code: 255, stdout: '', stderr: '' }).durum, 'hata');
});

test('--set: hiçbir sette geçerli build yok (0 satır) → uyarı + bildir, çıkış 2', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const { bag, kayit } = sahteBag(ev, { sshSonuc: { code: 1, stdout: '', stderr: '' } });
  assert.equal(await E.main(['--set', '11845,11846'], bag), 2);
  assert.equal(kayit.bildir.length, 2);
  assert.match(kayit.bildir[0], /11845: geçerli kaynak build'i yok \(kaynak_build_surumleri\)/);
  assert.ok(kayit.log.every((l) => !/DB sorgusu başarısız/.test(l)));
  assert.equal(kayit.kabuk.length, 0);
});

test('--set: bir set eksik, diğeri işlenir → eksik için bildir, çıkış 0', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const { bag, kayit } = sahteBag(ev);
  assert.equal(await E.main(['--set', '45550,11845'], bag), 0);
  assert.equal(kayit.kabuk.length, 1);
  assert.match(kayit.bildir[0], /11845/);
});

test('--bekleyen: 0 satır → iş yok, çıkış 0, bildirim yok', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const { bag, kayit } = sahteBag(ev, { sshSonuc: { code: 1, stdout: '', stderr: '' } });
  assert.equal(await E.main(['--bekleyen'], bag), 0);
  assert.equal(kayit.bildir.length, 0);
});

test('gerçek ssh hatası (255, stderr dolu) → çıkış 1', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const { bag, kayit } = sahteBag(ev, {
    sshSonuc: { code: 255, stdout: '', stderr: 'ssh: connect to host port 2222: timed out' },
  });
  assert.equal(await E.main(['--set', '45550'], bag), 1);
  assert.ok(kayit.log.some((l) => /DB sorgusu başarısız \(ssh 255\)/.test(l)));
});

test('kullanım hatası → çıkış 1', async () => {
  const { bag } = sahteBag(geciciDizin());
  assert.equal(await E.main(['--sil'], bag), 1);
});

// ─── Yeniden inceleme (birleşik2) ────────────────────────────────────────────────────────

test('üreteç tabanı (R2 tabanı üreteç build\'i): ek üretilmez, bildir, kayıt kesin', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const { bag, kayit } = sahteBag(ev, { uretecTabani: true, merdiven: true });
  assert.equal(await E.main(['--bekleyen'], bag), 0);
  assert.equal(kayit.kabuk.length, 0);
  assert.equal(kayit.merdiven, 0); // karar merdivenden ÖNCE (runner sırası)
  assert.deepEqual(yazmalar(kayit), []);
  assert.match(kayit.bildir[0], /bookN üreteç tabanı: eşlik ölçülmedi/);
  const d = JSON.parse(fs.readFileSync(path.join(ev, 'kabuk-ek-durum.json'), 'utf8'));
  assert.equal(d['45550'].kesin, true);
  assert.match(d['45550'].durum, /atlandi/);
});

test('üreteç kapalıysa (EMPP_INDEX_URETECI=0 eşdeğeri) aynı taban işlenir', async () => {
  const ev = geciciDizin();
  const { bag, kayit } = sahteBag(ev, { uretecTabani: true, uretecKapali: true });
  const r = await E.setIsle(bag, tekSatir(), { kuru: true });
  assert.equal(r.durum, 'kuru');
  assert.equal(kayit.kabuk.length, 1);
});

test('taban kapsama: set eki sonrası eksik kitap → üreteç tabanı; içerik kökte duruyorsa işlenir',
  async () => {
    const a = sahteBag(geciciDizin(), { kitapEksik: ['333'] });
    const r1 = await E.setIsle(a.bag, tekSatir(), { kuru: true });
    assert.equal(r1.durum, 'atlandi');
    assert.match(r1.neden, /bookN üreteç tabanı: eşlik ölçülmedi — set eki sonrası eksik: 333/);
    assert.equal(a.kayit.kabuk.length, 0);
    const b = sahteBag(geciciDizin(), { kitapEksik: ['333'], kokteDuran: ['333'] });
    const r2 = await E.setIsle(b.bag, tekSatir(), { kuru: true });
    assert.equal(r2.durum, 'kuru');
  });

test('uretecTabaniNedeni: gerçek runner modülleriyle 45550 benzeri olmayan zip → null', () => {
  const U = { uretecAcik: () => true, tabanUretecMi: () => ({ atla: false }),
    tabanKitapEksik: () => ({ atla: false }) };
  assert.equal(E.uretecTabaniNedeni({ U, P: {}, zip: 'x', asama: 'taban', env: {} }), null);
  assert.equal(E.uretecTabaniNedeni({ U, P: {}, zip: 'x', asama: 'kapsama', env: {} }), null);
});

test('aynı girdiSha + Web-Z sha için R2\'de doğrulanmış ek varsa yüklenmez', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const ilk = sahteBag(ev);
  assert.equal(await E.main(['--set', '45550'], ilk.bag), 0);
  assert.equal(yazmalar(ilk.kayit).length, 3);
  const ikinci = sahteBag(ev, { r2: ilk.r2 });
  assert.equal(await E.main(['--set', '45550'], ikinci.bag), 0);
  assert.deepEqual(yazmalar(ikinci.kayit), []);
  assert.ok(ikinci.kayit.log.some((l) => /durum=mevcut/.test(l)));
  // Web-Z settings değişince yeniden yüklenir.
  const ucuncu = sahteBag(ev, { r2: ilk.r2, ktWebz: 'e'.repeat(64) });
  assert.equal(await E.main(['--set', '45550'], ucuncu.bag), 0);
  assert.equal(yazmalar(ucuncu.kayit).length, 3);
});

test('R2\'deki ekin imzası bozuksa yeniden yüklenir', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const ilk = sahteBag(ev);
  await E.main(['--set', '45550'], ilk.bag);
  ilk.r2.set(`ydsr2:ydsdigital/kabuk-ek/45550/${SHA_A}.imza`, Buffer.from('AAAA'));
  const ikinci = sahteBag(ev, { r2: ilk.r2 });
  await E.main(['--set', '45550'], ikinci.bag);
  assert.equal(yazmalar(ikinci.kayit).length, 3);
});

test('son.json webzSettingsSha taşır', async () => {
  const ev = geciciDizin();
  anahtarKur(ev);
  const { bag, r2 } = sahteBag(ev);
  await E.main(['--set', '45550'], bag);
  const son = JSON.parse(r2.get('ydsr2:ydsdigital/kabuk-ek/45550/son.json').toString('utf8'));
  assert.equal(son.webzSettingsSha, 'b'.repeat(64));
});

test('SONUÇ satırı: taban kaynağı, indirilen bayt, önbellek toplam boyutu', async () => {
  const ev = geciciDizin();
  const { bag, kayit } = sahteBag(ev);
  await E.setIsle(bag, tekSatir(), { kuru: true });
  const satirSonuc = kayit.log.find((l) => /SONUÇ 45550/.test(l));
  assert.match(satirSonuc, /taban=2\.25\.6\/R2/);
  assert.match(satirSonuc, new RegExp(`indirilenBayt=${TABAN.length}`));
  assert.match(satirSonuc, /onbellekBayt=\d+/);
  assert.ok(E.onbellekBoyutu(ev) >= TABAN.length);
});

test('kilit yarışı: kenara alınan dizindeki pid bayat pid değilse geri taşınır, meşgul', () => {
  const ev = geciciDizin();
  const kilit = path.join(ev, 'kabuk-ek.kilit');
  fs.mkdirSync(kilit);
  fs.writeFileSync(path.join(kilit, 'pid'), '4242\n');
  // Okuma ile taşıma arasında başka kopya kilidi devralıp kendi pid'ini yazdı.
  const kenar = (k) => {
    fs.writeFileSync(path.join(k, 'pid'), '5555\n');
    return E.kenaraAl(k);
  };
  assert.equal(E.kilitAl(kilit, { pid: 4343, canli: () => false, kenar }), null);
  assert.equal(fs.readFileSync(path.join(kilit, 'pid'), 'utf8').trim(), '5555');
});

test('--kuru: bildirim gönderilmez, loga düşer', async () => {
  const ev = geciciDizin();
  const { bag, kayit } = sahteBag(ev, { uretecTabani: true });
  assert.equal(await E.main(['--set', '45550', '--kuru'], bag), 0);
  assert.equal(kayit.bildir.length, 0);
  assert.ok(kayit.log.some((l) => /bildirim gönderilmedi.*üreteç tabanı/.test(l)));
});

test('A1 (tek motor) üreteç tabanı: kural yok, ek üretilir', async () => {
  const ev = geciciDizin();
  const { bag, kayit } = sahteBag(ev, { tekMotor: true, uretecTabani: true, kitapEksik: ['9'] });
  const r = await E.setIsle(bag, tekSatir(), { kuru: true });
  assert.equal(r.durum, 'kuru');
  assert.equal(kayit.kabuk.length, 1);
  assert.equal(kayit.bildir.length, 0);
});

test('tekMotorDuzeniMi: bookN yok + ImWin32 → true; bookN varsa false; sarmalayıcı soyulur', () => {
  const onEkBul = require('../../src/agent/set-kabuk-tazele').onEkBul;
  assert.equal(E.tekMotorDuzeniMi(['index.html', 'classlibraries/ImWin32.dll',
    'assets/1/data/BookContent.xml'], onEkBul), true);
  assert.equal(E.tekMotorDuzeniMi(['index.html', 'classlibraries/ImWin32.dll',
    'book1/index.html'], onEkBul), false);
  assert.equal(E.tekMotorDuzeniMi(['set/index.html', 'set/classlibraries/ImWin32.dll'], onEkBul),
    true);
  assert.equal(E.tekMotorDuzeniMi(['index.html', 'book2/index.html'], onEkBul), false);
});
