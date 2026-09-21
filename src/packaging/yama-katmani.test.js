'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  acikMi, yamaKancasiKodu, enjekteEt, yamaIcinGoreliYol, YAMA_DIZIN, ISARET,
} = require('./yama-katmani');

const COK_SATIR = `function createWindow() {
  const mainWindow = new BrowserWindow({ width: 1200, fullscreen: true });
  mainWindow.loadFile('index.html');
}
app.whenReady().then(createWindow);`;

const ON_READY = `function createWindow() {
  const win = new BrowserWindow({ width: 1200 });
  win.loadFile('index.html');
}
app.on('ready', () => { createWindow(); });`;

const CAPASIZ = `function createWindow() {
  const win = new BrowserWindow({ width: 1200 });
  win.loadFile('index.html');
}
createWindow();`;

const sozdizimiGecerli = (kod) => {
  try { new Function(kod); return true; } catch (e) { return false; }
};

// --- acikMi (bayrak) ---

test('bayrak varsayılan KAPALI (EMPP_YAMA yokken)', () => {
  assert.strictEqual(acikMi({}), false);
});

test('bayrak EMPP_YAMA=1 ile AÇILIR', () => {
  assert.strictEqual(acikMi({ EMPP_YAMA: '1' }), true);
});

test('bayrak başka değerlerde (0/true/yes) hâlâ KAPALI — yalnız tam "1" açar', () => {
  assert.strictEqual(acikMi({ EMPP_YAMA: '0' }), false);
  assert.strictEqual(acikMi({ EMPP_YAMA: 'true' }), false);
  assert.strictEqual(acikMi({ EMPP_YAMA: 'yes' }), false);
});

test('env verilmezse process.env kullanılır (mutasyona duyarlı, temizlenir)', () => {
  const eski = process.env.EMPP_YAMA;
  try {
    delete process.env.EMPP_YAMA;
    assert.strictEqual(acikMi(), false);
    process.env.EMPP_YAMA = '1';
    assert.strictEqual(acikMi(), true);
  } finally {
    if (eski === undefined) delete process.env.EMPP_YAMA; else process.env.EMPP_YAMA = eski;
  }
});

// --- enjekteEt: atomiklik / idempotentlik / çapa seçimi ---

test('GERİLEME: çapa (whenReady/on-ready) yoksa HİÇBİR ŞEY eklenmez', () => {
  const r = enjekteEt(CAPASIZ);
  assert.strictEqual(r.degisti, false);
  assert.strictEqual(r.sebep, 'capa-yok');
  assert.strictEqual(r.icerik, CAPASIZ, 'kaynak değişmemeliydi');
  assert.ok(!r.icerik.includes(ISARET), 'işaret yokken hiç konmamalı');
});

test('app.whenReady().then(...) çapası tanınır ve kanca önüne eklenir', () => {
  const r = enjekteEt(COK_SATIR);
  assert.strictEqual(r.degisti, true);
  assert.strictEqual(r.sebep, 'uygulandi');
  assert.ok(r.icerik.includes(ISARET));
  const kancaIdx = r.icerik.indexOf(ISARET);
  const capaIdx = r.icerik.indexOf('app.whenReady().then(createWindow)');
  assert.ok(kancaIdx < capaIdx, 'kanca çapanın ÖNÜNE eklenmeli (önce ateşlensin)');
});

test('app.on(\'ready\', ...) çapası da tanınır', () => {
  const r = enjekteEt(ON_READY);
  assert.strictEqual(r.degisti, true);
  assert.ok(r.icerik.includes(ISARET));
  const kancaIdx = r.icerik.indexOf(ISARET);
  const capaIdx = r.icerik.indexOf("app.on('ready'");
  assert.ok(kancaIdx < capaIdx, 'kanca on(\'ready\') çapasının önüne eklenmeli');
});

test('GERİLEME: idempotent — iki kez çalıştırılırsa ikinci kez eklenmez', () => {
  const ilk = enjekteEt(COK_SATIR);
  const ikinci = enjekteEt(ilk.icerik);
  assert.strictEqual(ikinci.degisti, false);
  assert.strictEqual(ikinci.sebep, 'zaten-var');
  assert.strictEqual(ikinci.icerik, ilk.icerik, 'ikinci koşuda içerik değişmemeli');
  const sayim = ilk.icerik.split(ISARET).length - 1;
  assert.strictEqual(sayim, 1, 'işaret ikinci koşuda tekrar eklenmiş');
});

test('enjekte edilen main.js sözdizimsel olarak geçerli kalır (çok satır + on-ready)', () => {
  assert.ok(sozdizimiGecerli(enjekteEt(COK_SATIR).icerik), 'whenReady formunda kırıldı');
  assert.ok(sozdizimiGecerli(enjekteEt(ON_READY).icerik), 'on(ready) formunda kırıldı');
});

test('boş/null girişte çökmez, capa-yok döner', () => {
  assert.strictEqual(enjekteEt('').sebep, 'capa-yok');
  assert.strictEqual(enjekteEt(null).sebep, 'capa-yok');
});

// --- yamaKancasiKodu: içerik doğrulama ---

test('üretilen kodda userData/<YAMA_DIZIN> yolu geçer', () => {
  const kod = yamaKancasiKodu();
  assert.match(kod, /app\.getPath\('userData'\)/);
  assert.ok(kod.includes(`'${YAMA_DIZIN}'`), 'YAMA_DIZIN sabiti kodda birebir geçmeli');
});

test('YAMA_DIZIN tek kaynak — sabit değişirse üretilen kod da onu izler', () => {
  // Doğrudan modülü ikinci kez yükleyip sabiti okumak yerine, üretilen kodun
  // AYNI export edilen sabitten geldiğini doğruluyoruz (drift testi: elle ikinci
  // bir 'yama' literali varsa bu test onu YAKALAMAZ ama üretim yolunun tek kaynağa
  // bağlı olduğunu kilitler).
  const kod = yamaKancasiKodu();
  const beklenen = `path.join(app.getPath('userData'), '${YAMA_DIZIN}')`;
  assert.ok(kod.includes(beklenen), 'YAMA_KOK ifadesi tek sabitten üretilmemiş');
});

test('protocol.handle(\'file\', ...) kullanılır — registerFileProtocol/interceptFileProtocol DEĞİL', () => {
  const kod = yamaKancasiKodu();
  assert.match(kod, /protocol\.handle\(\s*'file'/);
  assert.ok(!/registerFileProtocol|interceptFileProtocol/.test(kod), 'kaldırılmış API kullanılmamalı');
});

test('registerSchemesAsPrivileged KULLANILMAZ — file yerleşik şema, ihtiyaç yok', () => {
  const kod = yamaKancasiKodu();
  assert.ok(!kod.includes('registerSchemesAsPrivileged'));
});

test('sonsuz döngü önlemi: net.fetch bypassCustomProtocolHandlers ile çağrılır', () => {
  const kod = yamaKancasiKodu();
  const sayim = (kod.match(/bypassCustomProtocolHandlers:\s*true/g) || []).length;
  assert.strictEqual(sayim, 2, 'hem yama hem normal-yol dalı bypass ile çağrılmalı');
});

test('normal yola düşme dalı mevcut (yama bulunamazsa paket dosyası servis edilir)', () => {
  const kod = yamaKancasiKodu();
  assert.match(kod, /return net\.fetch\(request\.url, \{ bypassCustomProtocolHandlers: true \}\);/);
});

// --- yamaIcinGoreliYol: yol çözümü / kaçış reddi ---

test('paket içindeki dosya için doğru göreli yolu üretir', () => {
  const kok = path.join('/paket', 'kok');
  const dosya = path.join(kok, 'assets', 'index.html');
  assert.strictEqual(yamaIcinGoreliYol(kok, dosya), path.join('assets', 'index.html'));
});

test('GERİLEME: "../" ile paket dışına kaçış REDDEDİLİR', () => {
  const kok = path.join('/paket', 'kok');
  const disari = path.join(kok, '..', '..', 'etc', 'passwd');
  assert.strictEqual(yamaIcinGoreliYol(kok, disari), null);
});

test('kök dizinin kendisi (boş göreli yol) reddedilir', () => {
  const kok = path.join('/paket', 'kok');
  assert.strictEqual(yamaIcinGoreliYol(kok, kok), null);
});

test('yamaIcinGoreliYol kaynağı üretilen kodda BİREBİR gömülü (tek mantık, tek kaynak)', () => {
  const kod = yamaKancasiKodu();
  assert.ok(kod.includes(yamaIcinGoreliYol.toString()), 'gömülü fonksiyon kaynağı sapmış');
});
