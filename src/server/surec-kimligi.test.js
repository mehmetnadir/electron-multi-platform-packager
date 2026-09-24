'use strict';
// K-surec-kimligi (2026-09-21) — "port açık" ile "doğru kod yüklü" iki AYRI şeydir.
// Bu testler ÖLÇÜMÜ kilitler: bayat require-cache, hiç yüklenmemiş modül, yetim süreç
// (PPID=1), ham env sızıntısı ve hata hâlinde "alan yok" yerine AÇIK null dönmesi.
// Karar mantığı (yesilSayilirMi/kimlikUyusuyorMu) saglik-kimligi.test.js'te kilitli —
// burada yeniden yazılmaz, yalnız çağrıldığı doğrulanır.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  KRITIK_MODULLER,
  parmakIzi,
  anlikGoruntu,
  yuklenmisMi,
  modulDurumu,
  surecKimligi,
} = require('./surec-kimligi');

const KOK = '/sahte-kok';
const A = 'src/packaging/a.js';
const B = 'src/runtime/b.js';
const yol = (rel) => path.join(KOK, rel);

/** Disk okuyucu taklidi: harita dışındaki her yol için ENOENT fırlatır (gerçek fs gibi). */
function okuyucu(harita) {
  return (p) => {
    if (!Object.prototype.hasOwnProperty.call(harita, p)) {
      const e = new Error(`ENOENT: ${p}`);
      e.code = 'ENOENT';
      throw e;
    }
    return harita[p];
  };
}

// ---------------------------------------------------------------------------
// parmakIzi / anlikGoruntu — içerikten türer (mtime DEĞİL)
// ---------------------------------------------------------------------------

test('parmakIzi: aynı içerik aynı, farklı içerik farklı, 12 hane hex', () => {
  const a = parmakIzi('merhaba');
  assert.strictEqual(a, parmakIzi('merhaba'));
  assert.notStrictEqual(a, parmakIzi('merhaba '));
  assert.match(a, /^[0-9a-f]{12}$/);
});

test('parmakIzi: string olmayan girdi → null (fırlatmaz)', () => {
  for (const girdi of [undefined, null, 42, {}, Buffer.from('x')]) {
    assert.strictEqual(parmakIzi(girdi), null);
  }
});

test('anlikGoruntu: okunamayan dosya için AÇIK null, çökme yok', () => {
  const g = anlikGoruntu({ liste: [A, B], kok: KOK, oku: okuyucu({ [yol(A)]: 'kod-a' }) });
  assert.strictEqual(g[A], parmakIzi('kod-a'));
  assert.strictEqual(g[B], null);
  assert.ok(Object.prototype.hasOwnProperty.call(g, B), 'ölçülemeyen alan SİLİNMEZ');
});

test('anlikGoruntu: aynı içerik farklı mtime ile aynı parmak izini verir (mtime kullanılmaz)', () => {
  const p = path.join(require('node:os').tmpdir(), `empp-kimlik-${process.pid}.js`);
  fs.writeFileSync(p, 'module.exports = 1;\n');
  const once = anlikGoruntu({ liste: ['x.js'], kok: path.dirname(p), oku: (q) => fs.readFileSync(q, 'utf8') });
  fs.utimesSync(p, new Date(0), new Date(0)); // mtime'ı geriye al, içerik AYNI
  const sonra = anlikGoruntu({ liste: ['x.js'], kok: path.dirname(p), oku: (q) => fs.readFileSync(q, 'utf8') });
  fs.unlinkSync(p);
  assert.strictEqual(once['x.js'], sonra['x.js']);
});

// ---------------------------------------------------------------------------
// yuklenmisMi — require.cache okuması
// ---------------------------------------------------------------------------

test('yuklenmisMi: cache kaydı varsa true, yoksa false; bozuk cache çökertmez', () => {
  assert.strictEqual(yuklenmisMi(yol(A), { [yol(A)]: { exports: {} } }), true);
  assert.strictEqual(yuklenmisMi(yol(B), { [yol(A)]: { exports: {} } }), false);
  assert.strictEqual(yuklenmisMi(yol(A), null), false);
  assert.strictEqual(yuklenmisMi(yol(A), { [yol(A)]: undefined }), false);
});

// ---------------------------------------------------------------------------
// modulDurumu — BAYATLIK (bu modülün var olma sebebi)
// ---------------------------------------------------------------------------

test('modulDurumu: yüklü modülün belleği diskten FARKLIysa bayatMi true [GERİLEME]', () => {
  // 2026-09-20 deseni: süreç 23:30'da başladı (bellek = eski kod), disk sonradan ilerledi.
  const d = modulDurumu({
    liste: [A], kok: KOK,
    cache: { [yol(A)]: { exports: {} } },
    baslangic: { [A]: parmakIzi('ESKI KOD') },
    oku: okuyucu({ [yol(A)]: 'YENI KOD' }),
  });
  assert.strictEqual(d.bayatMi, true);
  assert.strictEqual(d.moduller[A], parmakIzi('ESKI KOD'));
  assert.strictEqual(d.diskHash[A], parmakIzi('YENI KOD'));
  assert.ok(d.bayatSebepleri.some((s) => s.includes(A)), 'sebep dosya yolunu adıyla göstermeli');
});

test('modulDurumu: bellek = disk ise bayatMi false, sebep yok', () => {
  const d = modulDurumu({
    liste: [A], kok: KOK,
    cache: { [yol(A)]: { exports: {} } },
    baslangic: { [A]: parmakIzi('AYNI KOD') },
    oku: okuyucu({ [yol(A)]: 'AYNI KOD' }),
  });
  assert.strictEqual(d.bayatMi, false);
  assert.deepStrictEqual(d.bayatSebepleri, []);
});

test('modulDurumu: modül HİÇ yüklenmemişse moduller[yol] AÇIK null — "yok" ile karışmaz [GERİLEME]', () => {
  const d = modulDurumu({
    liste: [A], kok: KOK,
    cache: {}, // hiçbir şey yüklü değil
    baslangic: { [A]: parmakIzi('kod') },
    oku: okuyucu({ [yol(A)]: 'kod' }),
  });
  assert.ok(Object.prototype.hasOwnProperty.call(d.moduller, A), 'alan SİLİNMEZ');
  assert.strictEqual(d.moduller[A], null);
  assert.notStrictEqual(d.moduller[A], undefined);
  assert.strictEqual(d.diskHash[A], parmakIzi('kod'), 'disk tarafı yine de ölçülür');
  // JSON'a girince de null KALIR (undefined olsaydı alan sessizce kaybolurdu).
  assert.strictEqual(JSON.parse(JSON.stringify(d.moduller))[A], null);
});

test('modulDurumu: yüklenmemiş modül PASS sayılmaz — diskHash ile eşitmiş gibi raporlanmaz', () => {
  const d = modulDurumu({
    liste: [A], kok: KOK,
    cache: {},
    baslangic: { [A]: parmakIzi('kod') },
    oku: okuyucu({ [yol(A)]: 'kod' }),
  });
  assert.notStrictEqual(d.moduller[A], d.diskHash[A], 'yüklenmemiş modül "uyuyor" gibi görünmemeli');
  assert.strictEqual(d.bayatMi, false, 'yüklü olmayan modül bayatlık iddiası üretmez');
});

test('modulDurumu: YÜKLÜ ama bellek parmak izi ölçülemediyse bayatMi true (null ≠ geçti) [GERİLEME]', () => {
  const d = modulDurumu({
    liste: [A], kok: KOK,
    cache: { [yol(A)]: { exports: {} } },
    baslangic: {}, // başlangıç anında okunamamış
    oku: okuyucu({ [yol(A)]: 'kod' }),
  });
  assert.strictEqual(d.moduller[A], null);
  assert.strictEqual(d.bayatMi, true, 'kıyas yapılamıyorsa ŞÜPHEDE KIRMIZI');
  assert.ok(d.bayatSebepleri.some((s) => s.includes('bellek parmak izi ölçülemedi')));
});

test('modulDurumu: YÜKLÜ ama disk okunamıyorsa bayatMi true', () => {
  const d = modulDurumu({
    liste: [A], kok: KOK,
    cache: { [yol(A)]: { exports: {} } },
    baslangic: { [A]: parmakIzi('kod') },
    oku: okuyucu({}), // disk yok
  });
  assert.strictEqual(d.diskHash[A], null);
  assert.strictEqual(d.bayatMi, true);
  assert.ok(d.bayatSebepleri.some((s) => s.includes('disk okunamadı')));
});

test('modulDurumu: bellekteki fonksiyon kaynağı diskte hiç geçmiyorsa bayatMi true (tembel yükleme kaçağı)', () => {
  // Parmak izleri eşit OLSA BİLE (başlangıçtan sonra yüklenmiş modül) bellekteki
  // fonksiyon metni diskte yoksa yüklü kod eskidir — ikinci, bağımsız kanıt.
  function eskiFonksiyon() { return 'ESKI-DAVRANIS'; }
  const diskMetni = 'module.exports = { eskiFonksiyon: () => "YENI-DAVRANIS" };';
  const d = modulDurumu({
    liste: [A], kok: KOK,
    cache: { [yol(A)]: { exports: { eskiFonksiyon } } },
    baslangic: { [A]: parmakIzi(diskMetni) }, // kasten EŞİT — yalnız kaynak kıyası yakalar
    oku: okuyucu({ [yol(A)]: diskMetni }),
  });
  assert.strictEqual(d.moduller[A], d.diskHash[A], 'parmak izleri eşit (tuzak kurulumu)');
  assert.strictEqual(d.bayatMi, true);
  assert.ok(d.bayatSebepleri.some((s) => s.includes('diskte yok')));
});

test('modulDurumu: bellekteki fonksiyon kaynağı diskte AYNEN varsa bayat sayılmaz (yanlış alarm yok)', () => {
  function ayniFonksiyon() { return 1; }
  const diskMetni = `başlık\n${Function.prototype.toString.call(ayniFonksiyon)}\nson`;
  const d = modulDurumu({
    liste: [A], kok: KOK,
    cache: { [yol(A)]: { exports: { ayniFonksiyon } } },
    baslangic: { [A]: parmakIzi(diskMetni) },
    oku: okuyucu({ [yol(A)]: diskMetni }),
  });
  assert.strictEqual(d.bayatMi, false);
});

test('modulDurumu: bir modül bayatsa diğer sağlam modüller ölçülmeye devam eder', () => {
  const d = modulDurumu({
    liste: [A, B], kok: KOK,
    cache: { [yol(A)]: { exports: {} }, [yol(B)]: { exports: {} } },
    baslangic: { [A]: parmakIzi('eski-a'), [B]: parmakIzi('b') },
    oku: okuyucu({ [yol(A)]: 'yeni-a', [yol(B)]: 'b' }),
  });
  assert.strictEqual(d.bayatMi, true);
  assert.strictEqual(d.diskHash[B], parmakIzi('b'));
  assert.ok(d.bayatSebepleri.every((s) => !s.includes(B)), 'sağlam modül sebep listesine girmemeli');
});

// 2026-09-21: liste 5 → 7. Eklenen ikisi de ÜRETİM DAVRANIŞINI tayin eden modüller:
//   - set-kabuk.js    : güncelleme kanalının hangi dosyaları göndereceğini belirler.
//                       Ayrıca set-kimligi.js ondan fonksiyon yeniden dışa verir;
//                       listede olmazsa bekçi kaynağı bulamaz ve hash'ler birebir
//                       aynıyken "bayat" der (canlıda yaşandı).
//   - surum-kiyas.js  : "bu zip daha yeni mi?" kararı; yanlışı ~1 GB gereksiz indirme.
// Sayı çivisi KORUNUYOR — sessizce modül düşürülmesi hâlâ bu testi kırar.
test('modulDurumu: varsayılan liste yedi kritik modülü kapsar ve dosyalar gerçekten var', () => {
  assert.strictEqual(KRITIK_MODULLER.length, 7);
  for (const rel of [
    'src/packaging/set-kimligi.js',
    'src/packaging/set-kabuk.js',
    'src/packaging/guncelleyici-enjekte.js',
    'src/runtime/kitap-guncelleyici.js',
    'src/agent/surum-normallestir.js',
    'src/agent/surum-kiyas.js',
    'src/packaging/sayfa-webp.js',
  ]) {
    assert.ok(KRITIK_MODULLER.includes(rel), `${rel} listede olmalı`);
    assert.ok(fs.existsSync(path.join(__dirname, '..', '..', rel)), `${rel} diskte olmalı`);
  }
});

// ---------------------------------------------------------------------------
// surecKimligi — pid/ppid/yetimMi
// ---------------------------------------------------------------------------

const saglamOlcum = {
  liste: [A], kok: KOK,
  cache: { [yol(A)]: { exports: {} } },
  baslangic: { [A]: parmakIzi('kod') },
  oku: okuyucu({ [yol(A)]: 'kod' }),
};

test('surecKimligi: PPID=1 → yetimMi true (elle başlatılıp terminalden kopmuş süreç) [GERİLEME]', () => {
  const k = surecKimligi({ ...saglamOlcum, proc: { pid: 4242, ppid: 1, env: {} } });
  assert.strictEqual(k.ppid, 1);
  assert.strictEqual(k.yetimMi, true);
  assert.strictEqual(k.pid, 4242);
});

test('surecKimligi: PPID=1 dışında yetimMi false', () => {
  const k = surecKimligi({ ...saglamOlcum, proc: { pid: 4242, ppid: 991, env: {} } });
  assert.strictEqual(k.yetimMi, false);
});

test('surecKimligi: ppid ölçülemezse ppid null ve yetimMi null — "yetim değil" diye YEŞİL SAYILMAZ', () => {
  const k = surecKimligi({ ...saglamOlcum, proc: { pid: 4242, env: {} } });
  assert.strictEqual(k.ppid, null);
  assert.strictEqual(k.yetimMi, null);
  assert.notStrictEqual(k.yetimMi, false, 'bilinmiyor ile "yetim değil" aynı şey DEĞİL');
});

test('surecKimligi: pid tamsayı değilse null döner (alan silinmez)', () => {
  const k = surecKimligi({ ...saglamOlcum, proc: { pid: 'abc', ppid: 5, env: {} } });
  assert.ok(Object.prototype.hasOwnProperty.call(k, 'pid'));
  assert.strictEqual(k.pid, null);
});

test('surecKimligi: ölçüm patlarsa alanlar KAYBOLMAZ, açık null döner + bayatMi true [GERİLEME]', () => {
  const patlayan = { env: {} };
  Object.defineProperty(patlayan, 'pid', { get() { throw new Error('kasıtlı patlama'); } });
  let k;
  assert.doesNotThrow(() => { k = surecKimligi({ ...saglamOlcum, proc: patlayan }); });
  for (const alan of ['pid', 'ppid', 'yetimMi', 'moduller', 'diskHash', 'bayatMi']) {
    assert.ok(Object.prototype.hasOwnProperty.call(k, alan), `${alan} alanı VAR olmalı`);
  }
  assert.strictEqual(k.pid, null);
  assert.strictEqual(k.moduller, null);
  assert.strictEqual(k.diskHash, null);
  assert.strictEqual(k.bayatMi, true, 'ölçülemeyen süreç yeşil sayılmaz');
  // JSON'dan geçince de alanlar duruyor (undefined olsaydı sessizce silinirdi).
  const govde = JSON.parse(JSON.stringify(k));
  assert.strictEqual(govde.moduller, null);
  assert.ok('yetimMi' in govde);
});

test('surecKimligi: disk okuyucusu fırlatsa bile çökmez, kimlik döner', () => {
  let k;
  assert.doesNotThrow(() => {
    k = surecKimligi({ liste: [A], kok: KOK, cache: {}, baslangic: {},
      oku: () => { throw new Error('disk gitti'); }, proc: { pid: 7, ppid: 1, env: {} } });
  });
  assert.strictEqual(k.yetimMi, true);
  assert.strictEqual(k.diskHash[A], null);
});

// ---------------------------------------------------------------------------
// SIR SIZINTISI — ham env DEĞERİ hiçbir alana girmez
// ---------------------------------------------------------------------------

test('surecKimligi: env değeri ASLA yanıta girmez (sır sızıntısı) [GERİLEME]', () => {
  const SIR = 'r2-gizli-anahtar-DENEME-9f3a';
  const env = {
    EMPP_SAYFA_WEBP: '1',
    EMPP_R2_SECRET: SIR,
    AWS_SECRET_ACCESS_KEY: SIR,
    EMPP_UPDATE_DIR: '/gizli/dizin',
  };
  const k = surecKimligi({ ...saglamOlcum, proc: { pid: 1, ppid: 1, env } });
  const metin = JSON.stringify(k);
  assert.ok(!metin.includes(SIR), 'ham sır çıktıya girmiş!');
  assert.ok(!metin.includes('/gizli/dizin'), 'env yolu çıktıya girmiş!');
  assert.ok(!metin.includes('EMPP_R2_SECRET'), 'env ADI bile taşınmamalı');
});

test('/api/health gövdesi: kapılar yalnız boolean, ham env değeri yok [GERİLEME]', () => {
  const { kapilariOku } = require('./saglik-kimligi');
  const SIR = 'sk_live_DENEME_112233';
  const env = { EMPP_SET_MENU: '1', EMPP_SAYFA_WEBP: '1', STRIPE_KEY: SIR };
  const govde = {
    status: 'Sunucu çalışıyor',
    timestamp: new Date().toISOString(),
    commit: 'abc1234',
    startedAt: new Date().toISOString(),
    kapilar: kapilariOku(env),
    ...surecKimligi({ ...saglamOlcum, proc: { pid: 10, ppid: 1, env } }),
  };
  const metin = JSON.stringify(govde);
  assert.ok(!metin.includes(SIR));
  for (const deger of Object.values(govde.kapilar)) {
    assert.strictEqual(typeof deger, 'boolean', 'kapı değerleri YALNIZ boolean olmalı');
  }
  assert.strictEqual(govde.kapilar.setMenu, true);
  assert.strictEqual(govde.kapilar.sayfaWebp, true);
});

test('/api/health şeması: zorunlu kimlik alanlarının tamamı gövdede bulunur [GERİLEME]', () => {
  const k = surecKimligi(); // gerçek süreç + gerçek require.cache
  for (const alan of ['pid', 'ppid', 'yetimMi', 'moduller', 'diskHash', 'bayatMi']) {
    assert.ok(Object.prototype.hasOwnProperty.call(k, alan), `${alan} eksik`);
  }
  assert.strictEqual(typeof k.pid, 'number');
  assert.strictEqual(typeof k.bayatMi, 'boolean');
  // Her kritik modül için HEM moduller HEM diskHash anahtarı bulunmalı (ölçülemeyen null).
  for (const rel of KRITIK_MODULLER) {
    assert.ok(Object.prototype.hasOwnProperty.call(k.moduller, rel), `moduller.${rel} eksik`);
    assert.ok(Object.prototype.hasOwnProperty.call(k.diskHash, rel), `diskHash.${rel} eksik`);
    const m = k.moduller[rel];
    assert.ok(m === null || /^[0-9a-f]{12}$/.test(m), 'moduller değeri null ya da kısa hash olmalı');
  }
  // Bu test sürecinde saglik-kimligi zinciri sayfa-webp'yi yükler → null OLMAMALI.
  assert.match(k.moduller['src/packaging/sayfa-webp.js'], /^[0-9a-f]{12}$/);
  assert.strictEqual(k.bayatMi, false, 'çalışma ağacı temizken health bayat dememeli');
});

// ---------------------------------------------------------------------------
// app.js sözleşmesi (kaynak-sentinel — sunucuyu ayağa kaldırmadan)
// ---------------------------------------------------------------------------

test('app.js: /api/health bloğu kimlik alanlarını yayar ve ham env basmaz [GERİLEME]', () => {
  const SRC = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.match(SRC, /require\('\.\/surec-kimligi'\)/);
  const blok = SRC.slice(SRC.indexOf("app.get('/api/health'"), SRC.indexOf("app.post('/api/open-folder'"));
  assert.match(blok, /commit: GIT_COMMIT/);
  assert.match(blok, /startedAt: STARTED_AT/);
  assert.match(blok, /kapilar: kapilariOku\(process\.env\)/);
  assert.match(blok, /\.\.\.surecKimligi\(\)/);
  // Ham env ASLA serpilmez: `...process.env` ya da `env: process.env` yasak.
  assert.ok(!/\.\.\.process\.env/.test(blok), 'health bloğu ham env serpiyor!');
  assert.ok(!/env:\s*process\.env/.test(blok), 'health bloğu ham env basıyor!');
});

// ---------------------------------------------------------------------------
// YENİDEN DIŞA VURUM (re-export) — yanlış alarm kapısı
//
// 2026-09-21, canlıda yaşandı: paketleyici yeniden başlatıldıktan SONRA sağlık ucu
// `bayatMi: true` dedi, sebep "set-kimligi.js: bellekteki fonksiyon kaynağı diskte yok".
// Oysa hash'ler BİREBİR aynıydı (65d3ad2fd16b = 65d3ad2fd16b), yani modül günceldi.
// Gerçek sebep: `set-kimligi.js`, `set-kabuk.js`'ten fonksiyon yeniden dışa veriyor;
// o fonksiyonun kaynağı kendi dosyasında yok. Sürekli kırmızı bekçi, bekçi değildir —
// gerçek bayatlığı görünmez kılar.
// ---------------------------------------------------------------------------

test('modulDurumu: yeniden dışa vurulan fonksiyon BAYAT SAYILMAZ [GERİLEME KAPISI]', () => {
  // A modülü, B'de tanımlı fonksiyonu yeniden dışa veriyor.
  function bDeTanimli(x) { return x + 1; }
  const bKaynagi = Function.prototype.toString.call(bDeTanimli);

  const aMetni = `module.exports = { bDeTanimli: require('./b.js').bDeTanimli };`;
  const bMetni = `function bDeTanimli(x) { return x + 1; }\nmodule.exports = { bDeTanimli };`;

  const d = modulDurumu({
    liste: [A, B],
    kok: KOK,
    cache: {
      [yol(A)]: { exports: { bDeTanimli } },
      [yol(B)]: { exports: { bDeTanimli } },
    },
    baslangic: { [A]: parmakIzi(aMetni), [B]: parmakIzi(bMetni) },
    oku: okuyucu({ [yol(A)]: aMetni, [yol(B)]: bMetni }),
  });

  assert.ok(bMetni.includes(bKaynagi), 'kurulum: kaynak B metninde gerçekten var');
  assert.ok(!aMetni.includes(bKaynagi), 'kurulum: kaynak A metninde YOK (yeniden dışa vurum)');
  assert.strictEqual(d.bayatMi, false, 'yeniden dışa vurum bayatlık değildir');
  assert.deepStrictEqual(d.bayatSebepleri, []);
});

test('modulDurumu: HİÇBİR izlenen modülde olmayan fonksiyon kaynağı HÂLÂ bayat sayılır', () => {
  // Bekçinin gücü korunmalı: gerçekten eski kod yakalanmaya devam etmeli.
  function hicbirYerdeYok(y) { return y * 7919; }

  const aMetni = `module.exports = { baskaBirSey: 1 };`;
  const bMetni = `module.exports = { yineBaska: 2 };`;

  const d = modulDurumu({
    liste: [A, B],
    kok: KOK,
    cache: { [yol(A)]: { exports: { hicbirYerdeYok } } },
    baslangic: { [A]: parmakIzi(aMetni), [B]: parmakIzi(bMetni) },
    oku: okuyucu({ [yol(A)]: aMetni, [yol(B)]: bMetni }),
  });

  assert.strictEqual(d.bayatMi, true, 'kaynağı hiçbir izlenen modülde olmayan fonksiyon = bayat');
  assert.ok(
    d.bayatSebepleri.some((s) => s.includes('bellekteki fonksiyon kaynağı diskte yok')),
    'sebep açıkça bildirilmeli'
  );
});
