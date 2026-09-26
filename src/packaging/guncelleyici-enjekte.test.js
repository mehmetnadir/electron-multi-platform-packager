'use strict';

/**
 * SET GÜNCELLEYİCİ ENJEKSİYONU TESTLERİ.
 *
 * Kapılar: ATOMİK (çapa yoksa ne yama ne modül), İDEMPOTENT (iki koşu tek blok),
 * AÇILIŞI BLOKLAMAZ (whenReady + setTimeout), ve enjekte edilen kodun
 * SÖZDİZİMSEL GEÇERLİLİĞİ (yarım yama açılışta patlar).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ge = require('./guncelleyici-enjekte');

const ANA = `'use strict';
const { app, BrowserWindow } = require('electron');
let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1200, fullscreen: true });
  mainWindow.loadFile('index.html');
}
app.whenReady().then(createWindow);
`;

/** Çapa yok: Electron ana süreci değil (ör. yardımcı betik). */
const CAPASIZ = `'use strict';
module.exports = function topla(a, b) { return a + b; };
`;

const sozdizimiGecerli = (kod) => {
  try { new Function(kod); return true; } catch (e) { return false; }
};

function gecici() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'empp-enjekte-'));
}

test('çapa var → blok eklenir, sözdizimi geçerli, orijinal kod DEĞİŞMEZ', () => {
  const r = ge.icerigeEnjekteEt(ANA);
  assert.strictEqual(r.uygulandi, true);
  assert.strictEqual(r.sebep, 'enjekte-edildi');
  assert.ok(r.icerik.startsWith(ANA), 'yayıncı kodunun tek karakteri değişmemeli');
  assert.ok(sozdizimiGecerli(r.icerik), 'enjekte edilen kod sözdizimsel olarak geçerli olmalı');
  assert.match(r.icerik, /EMPP_SET_GUNCELLEME/);
});

test('ÇAPA YOK → hiç yama konmaz, içerik BİREBİR aynı kalır', () => {
  const r = ge.icerigeEnjekteEt(CAPASIZ);
  assert.strictEqual(r.uygulandi, false);
  assert.strictEqual(r.sebep, 'capa-yok');
  assert.strictEqual(r.icerik, CAPASIZ, 'atomiklik: yarım yama YASAK');
});

test('İDEMPOTENT: iki kez koşmak tek blok üretir', () => {
  const bir = ge.icerigeEnjekteEt(ANA);
  const iki = ge.icerigeEnjekteEt(bir.icerik);
  assert.strictEqual(iki.uygulandi, false);
  assert.strictEqual(iki.sebep, 'zaten-yamali');
  assert.strictEqual(iki.icerik, bir.icerik);
  const adet = (bir.icerik.match(/guncellemeyiBaslat/g) || []).length;
  assert.strictEqual(adet, 1, 'çift enjeksiyon olmamalı');
});

test('AÇILIŞI BLOKLAMAZ: çağrı whenReady SONRASI ve setTimeout ile ötelenmiş', () => {
  const kod = ge.blokUret();
  assert.match(kod, /whenReady\(\)\.then\(/, 'pencere hazır olduktan sonra çalışmalı');
  assert.match(kod, /setTimeout\(/, 'ötelenmiş olmalı');
  const whenIdx = kod.indexOf('whenReady');
  const timeoutIdx = kod.indexOf('setTimeout');
  const cagriIdx = kod.indexOf('guncellemeyiBaslat');
  assert.ok(whenIdx < timeoutIdx && timeoutIdx < cagriIdx,
    'sıra: whenReady → setTimeout → çağrı');
  assert.ok(!/await\s+guncellemeyiBaslat/.test(kod), 'await ile açılış bekletilemez');
  assert.match(kod, /\.catch\(function \(\) \{\}\)/, 'ateşle-unut: hata yutulmalı');
});

test('gecikme parametresi bloğa yansır; bozuk değer varsayılana düşer', () => {
  assert.match(ge.blokUret(1234), /\}, 1234\);/);
  assert.match(ge.blokUret(), new RegExp('\\}, ' + ge.VARSAYILAN_GECIKME_MS + '\\);'));
  assert.match(ge.blokUret(NaN), new RegExp('\\}, ' + ge.VARSAYILAN_GECIKME_MS + '\\);'));
  assert.match(ge.blokUret(-5), new RegExp('\\}, ' + ge.VARSAYILAN_GECIKME_MS + '\\);'));
});

test('enjekte edilen blok çalışma anı modülünü DOĞRU adla ister', () => {
  const kod = ge.blokUret();
  assert.ok(kod.includes(`require('./${ge.MODUL_ADI}')`), 'modül adı bloğa gömülmeli');
  assert.strictEqual(ge.MODUL_ADI, 'empp-set-guncelleyici.js');
});

test('paketeUygula: çapa varsa hem yama hem MODÜL konur', async () => {
  const kok = gecici();
  fs.writeFileSync(path.join(kok, 'main.js'), ANA);
  const satirlar = [];
  const sonuc = await ge.paketeUygula(kok, { log: (m) => satirlar.push(m) });
  assert.strictEqual(sonuc.length, 1);
  assert.strictEqual(sonuc[0].uygulandi, true);
  assert.strictEqual(sonuc[0].modul, true);
  assert.ok(fs.existsSync(path.join(kok, ge.MODUL_ADI)), 'çalışma anı modülü kopyalanmalı');
  assert.match(fs.readFileSync(path.join(kok, 'main.js'), 'utf8'), /EMPP_SET_GUNCELLEME/);
  // Kopyalanan modül gerçekten yüklenebilir olmalı (yarım kopya açılışta patlar).
  const m = require(path.join(kok, ge.MODUL_ADI));
  assert.strictEqual(typeof m.guncellemeyiBaslat, 'function');
  assert.ok(satirlar.some((s) => /set güncelleyici/.test(s)));
});

test('paketeUygula: ÇAPA YOKSA modül de kopyalanmaz (pakete yetim dosya bırakılmaz)',
  async () => {
    const kok = gecici();
    fs.writeFileSync(path.join(kok, 'main.js'), CAPASIZ);
    const sonuc = await ge.paketeUygula(kok, {});
    assert.strictEqual(sonuc[0].uygulandi, false);
    assert.strictEqual(sonuc[0].sebep, 'capa-yok');
    assert.strictEqual(sonuc[0].modul, false);
    assert.ok(!fs.existsSync(path.join(kok, ge.MODUL_ADI)), 'yetim modül YASAK');
    assert.strictEqual(fs.readFileSync(path.join(kok, 'main.js'), 'utf8'), CAPASIZ);
  });

test('paketeUygula: SET paketinde alt dizinlerdeki girişler de yamalanır', async () => {
  const kok = gecici();
  fs.writeFileSync(path.join(kok, 'electron.js'), ANA);
  fs.mkdirSync(path.join(kok, 'book1'));
  fs.writeFileSync(path.join(kok, 'book1', 'main.js'), ANA);
  fs.mkdirSync(path.join(kok, 'book2'));
  fs.writeFileSync(path.join(kok, 'book2', 'main.js'), CAPASIZ);

  const sonuc = await ge.paketeUygula(kok, {});
  const bul = (d) => sonuc.find((s) => s.dosya === d);
  assert.strictEqual(bul('electron.js').uygulandi, true);
  assert.strictEqual(bul(path.join('book1', 'main.js')).uygulandi, true);
  assert.strictEqual(bul(path.join('book2', 'main.js')).uygulandi, false);
  assert.ok(fs.existsSync(path.join(kok, ge.MODUL_ADI)));
  assert.ok(fs.existsSync(path.join(kok, 'book1', ge.MODUL_ADI)));
  assert.ok(!fs.existsSync(path.join(kok, 'book2', ge.MODUL_ADI)));
});

test('paketeUygula İDEMPOTENT: ikinci koşu dosyayı değiştirmez', async () => {
  const kok = gecici();
  fs.writeFileSync(path.join(kok, 'main.js'), ANA);
  await ge.paketeUygula(kok, {});
  const birinci = fs.readFileSync(path.join(kok, 'main.js'), 'utf8');
  const sonuc = await ge.paketeUygula(kok, {});
  assert.strictEqual(sonuc[0].uygulandi, false);
  assert.strictEqual(sonuc[0].sebep, 'zaten-yamali');
  assert.strictEqual(fs.readFileSync(path.join(kok, 'main.js'), 'utf8'), birinci);
});

test('kapı: EMPP_SET_GUNCELLEME varsayılan AÇIK, `0` ile kapanır', () => {
  assert.strictEqual(ge.acikMi({}), true);
  assert.strictEqual(ge.acikMi({ EMPP_SET_GUNCELLEME: '1' }), true);
  assert.strictEqual(ge.acikMi({ EMPP_SET_GUNCELLEME: '0' }), false);
  assert.strictEqual(ge.ISARET, 'EMPP_SET_GUNCELLEME');
});

test('çapa örüntüsü: boşluklu yazımı yakalar, benzeyen ama farklı adı yakalamaz', () => {
  assert.ok(ge.CAPA_RE.test('app . whenReady ( )'));
  assert.ok(ge.CAPA_RE.test('app.whenReady().then(x)'));
  assert.ok(!ge.CAPA_RE.test('appWhenReady()'));
  assert.ok(!ge.CAPA_RE.test('myapp.whenReadyLater()'));
});

test('YER ÇİVİSİ: enjeksiyon ANA SÜRECE girer, index.html\'e GİRMEZ', async () => {
  // NEDEN ana süreç: güncelleyici DİSKE YAZAR (indir → doğrula → rename) ve
  // `app.whenReady()` zincirine bağlanır. `EMPP_ON_GETIRME` renderer işidir
  // (sayfa ısıtma) ve index.html'e enjekte edilir — bu kanal ONDAN FARKLIDIR;
  // ikisini karıştıran bir kapı betiği yanlış dosyaya bakar.
  const kok = gecici();
  const html = '<html><body><h1>menu</h1></body></html>';
  fs.writeFileSync(path.join(kok, 'index.html'), html);
  fs.writeFileSync(path.join(kok, 'main.js'), ANA);

  await ge.paketeUygula(kok, {});

  assert.strictEqual(fs.readFileSync(path.join(kok, 'index.html'), 'utf8'), html,
    'index.html\'e DOKUNULMAMALI — bu kanal renderer kanalı değil');
  assert.match(fs.readFileSync(path.join(kok, 'main.js'), 'utf8'), /EMPP_SET_GUNCELLEME/,
    'çağrı ana süreç giriş dosyasına girmeli');
  assert.ok(fs.existsSync(path.join(kok, ge.MODUL_ADI)));
  assert.deepStrictEqual(ge.GIRIS_ADLARI, ['electron.js', 'main.js'],
    'hedef dosyalar ana süreç girişleridir');
});

test('ZİNCİR: açılış ötelemesi yaması uygulanmış dosyada çapa hâlâ tutar', () => {
  const oteleme = require('./acilis-guncelleme-oteleme');
  const yayinci = `'use strict';
const { app, BrowserWindow } = require('electron');
function createWindow() {
  const win = new BrowserWindow({ width: 800 });
  win.loadFile('index.html');
}
app.whenReady().then(async () => {
  try { await checkForUpdates() } catch (err) {}
  createWindow();
});
`;
  const o = oteleme.icerigiDuzelt(yayinci);
  assert.strictEqual(o.uygulandi, true, 'önce öteleme yaması uygulanır (boru sırası)');
  const r = ge.icerigeEnjekteEt(o.icerik);
  assert.strictEqual(r.uygulandi, true, 'öteleme sonrası çapa kaybolmamalı');
  assert.ok(sozdizimiGecerli(r.icerik), 'iki yama üst üste geçerli kod üretmeli');
});

test('SENTİNEL: canlı paketleme yolu enjeksiyonu ÇAĞIRIYOR ve sırası doğru', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  assert.match(kaynak, /require\('\.\/guncelleyici-enjekte'\)/, 'canlı yolda require yok');
  const cagri = kaynak.indexOf('guncelleyiciEnjekte.paketeUygula');
  const setYaz = kaynak.indexOf('setKimligi.paketeYaz');
  const hazirla = kaynak.indexOf('this.prepareElectronFiles(');
  assert.ok(cagri !== -1, 'paketeUygula çağrılmıyor');
  assert.ok(setYaz !== -1 && setYaz < cagri,
    'empp-set.json enjeksiyondan ÖNCE yazılmalı (envanter hazır olsun)');
  assert.ok(hazirla !== -1 && cagri < hazirla,
    'enjeksiyon prepareElectronFiles ÖNCESİ olmalı — electron.js→main.js kopyası da yamalı doğsun');
});

test('kaynak modül gerçekten var ve enjeksiyonun beklediği kapıyı dışa veriyor', () => {
  assert.ok(fs.existsSync(ge.KAYNAK_MODUL), 'src/runtime/kitap-guncelleyici.js bulunmalı');
  const m = require(ge.KAYNAK_MODUL);
  assert.strictEqual(typeof m.guncellemeyiBaslat, 'function');
  assert.strictEqual(m.ISARET, ge.ISARET, 'kapı adı iki tarafta AYNI olmalı');
});

// ─── PLATFORM KAPSAMI (2026-09-26, Windows sözleşmesi ONAYLI — yalnız Windows) ───
// Bayrak virgüllü platform listesi alabilir; kapı yalnız işin platformlarının HEPSİ
// listedeyse açıktır (ortak workingPath: karışık işte mac çıktısına sızmasın).
// Kural kaynağı: platform-kapisi.js — burada bu modülün acikMi'si uçtan uca sınanır.
test('PLATFORM KAPSAMI: EMPP_SET_GUNCELLEME=windows — windows açık, macos kapalı, karışık kapalı', () => {
  const uyarilar = [];
  const s = { uyar: (x) => uyarilar.push(x) };
  const env = { EMPP_SET_GUNCELLEME: 'windows' };
  assert.strictEqual(ge.acikMi(env, ['windows'], s), true, 'yalnız windows işi açık olmalı');
  assert.strictEqual(ge.acikMi(env, ['macos'], s), false, 'yalnız macos işi kapalı olmalı');
  assert.strictEqual(ge.acikMi(env, ['windows', 'macos'], s), false, 'karışık iş kapalı olmalı');
  assert.strictEqual(ge.acikMi({ EMPP_SET_GUNCELLEME: 'windows,macos' }, ['windows', 'macos'], s), true);
  assert.deepStrictEqual(uyarilar, []);
});

test('PLATFORM KAPSAMI: EMPP_SET_GUNCELLEME eski değerler — 0 kapalı, 1 açık, tanımsız → varsayılan AÇIK', () => {
  for (const is of [['windows'], ['macos'], ['windows', 'macos'], undefined]) {
    assert.strictEqual(ge.acikMi({ EMPP_SET_GUNCELLEME: '0' }, is), false);
    assert.strictEqual(ge.acikMi({ EMPP_SET_GUNCELLEME: '1' }, is), true);
    assert.strictEqual(ge.acikMi({}, is), true);
  }
});

test('PLATFORM KAPSAMI: EMPP_SET_GUNCELLEME bilinmeyen platform adı → görünür UYARI, eşleşme yok', () => {
  const uyarilar = [];
  const s = { uyar: (x) => uyarilar.push(x) };
  assert.strictEqual(ge.acikMi({ EMPP_SET_GUNCELLEME: 'windows,mac' }, ['macos'], s), false);
  assert.strictEqual(uyarilar.length, 1);
  assert.match(uyarilar[0], /^UYARI: EMPP_SET_GUNCELLEME tanınmayan platform adı: mac /);
  assert.strictEqual(ge.acikMi({ EMPP_SET_GUNCELLEME: 'windows,mac' }, ['windows'], s), true, 'tanınan ad çalışmaya devam eder');
});

// ─── ÖRTÜ (mac + Pardus, 2026-09-26) ───────────────────────────────────────────
// Blok, main.js YÜKLENİRKEN örtü sunucusunu kurar (pencere yüklenmeden önce kanca şart);
// güncelleme yine whenReady + setTimeout arkasında. Sahte `require` ile blok GERÇEKTEN koşturulur.
function blokuKostur(kod, { modul, app }) {
  const cagrilar = [];
  const sahteElectron = { app, protocol: {}, net: {} };
  const sahteRequire = (ad) => {
    if (ad === 'electron') return sahteElectron;
    if (ad === `./${ge.MODUL_ADI}`) return modul(cagrilar);
    throw new Error('beklenmeyen require: ' + ad);
  };
  new Function('require', '__dirname', 'setTimeout', kod)(sahteRequire, '/paket/app.asar', (fn) => fn());
  return { cagrilar, sahteElectron };
}

function sahteApp() {
  let cozucu;
  const hazir = new Promise((c) => { cozucu = c; });
  return { whenReady: () => hazir, hazirla: () => cozucu() };
}

test('ÖRTÜ: blok yüklenirken ortuSunucusunuKur SENKRON çağrılır (whenReady beklenmez), kök = __dirname', async () => {
  const app = sahteApp();
  const { cagrilar, sahteElectron } = blokuKostur(ge.blokUret(0), {
    app,
    modul: (c) => ({
      ortuSunucusunuKur: (o) => c.push(['ortu', o]),
      guncellemeyiBaslat: (o) => { c.push(['baslat', o]); return Promise.resolve(); },
    }),
  });
  assert.strictEqual(cagrilar.length, 1, 'ready gelmeden yalnız örtü kurulumu koşmalı');
  assert.strictEqual(cagrilar[0][0], 'ortu');
  assert.strictEqual(cagrilar[0][1].kok, '/paket/app.asar');
  assert.strictEqual(cagrilar[0][1].electron, sahteElectron, 'electron modülü verilmeli (userData/protocol)');
  app.hazirla();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(cagrilar.length, 2, 'ready sonrası güncelleme başlamalı');
  assert.strictEqual(cagrilar[1][0], 'baslat');
  assert.strictEqual(cagrilar[1][1].electron, sahteElectron, 'güncelleyici aynı electron ile kip seçer');
});

test('ÖRTÜ: örtü kurulumu patlasa da güncelleme akışı ve uygulama açılışı sürer', async () => {
  const app = sahteApp();
  const { cagrilar } = blokuKostur(ge.blokUret(0), {
    app,
    modul: (c) => ({
      ortuSunucusunuKur: () => { throw new Error('örtü patladı'); },
      guncellemeyiBaslat: (o) => { c.push(['baslat', o]); return Promise.resolve(); },
    }),
  });
  app.hazirla();
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(cagrilar.map((x) => x[0]), ['baslat']);
});

test('ÖRTÜ: blok GERÇEK modülle Windows kipinde protokole dokunmaz (yerinde)', () => {
  const kg = require(ge.KAYNAK_MODUL);
  const kayit = [];
  const electron = {
    app: { whenReady: () => new Promise(() => {}), isReady: () => false, getPath: () => '/tmp/yok' },
    protocol: { interceptFileProtocol: () => { kayit.push('intercept'); return true; } },
  };
  const r = kg.ortuSunucusunuKur({ electron, kok: 'C:\\Program Files\\Kitap\\resources\\app', platform: 'win32', env: {} });
  assert.strictEqual(r.durum, 'yerinde');
  assert.deepStrictEqual(kayit, [], 'Windows yolunda file: kancası KURULMAZ');
});
