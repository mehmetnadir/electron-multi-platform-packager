'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { applyPublisherUpdate, isNewer, latestLocalUpdate, companyIdFrom } = require('./publisher-update');

function fixture() {
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-build-'));
  fs.writeFileSync(path.join(build, 'kurum.txt'), '60\r\n');
  fs.writeFileSync(path.join(build, 'version.txt'), '1.11.5');
  fs.writeFileSync(path.join(build, 'app.config.js'), '// eski');
  fs.writeFileSync(path.join(build, 'old.main.js'), 'old');
  const updRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-upd-'));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-updsrc-'));
  fs.writeFileSync(path.join(src, 'app.config.js'), '// yeni');
  fs.writeFileSync(path.join(src, 'new.main.js'), 'new');
  fs.writeFileSync(path.join(src, 'version.txt'), '1.13.1.3');
  fs.mkdirSync(path.join(updRoot, '060'), { recursive: true });
  for (const v of ['1.12.0', '1.13.1.3']) spawnSync('zip', ['-q', '-r', path.join(updRoot, '060', v + '.zip'), '.'], { cwd: src });
  return { build, updRoot };
}

test('kurum.txt "60" → "060"; sürüm karşılaştırma electron.js ile aynı', () => {
  const { build } = fixture();
  assert.strictEqual(companyIdFrom(build), '060');
  assert.strictEqual(isNewer('1.11.5', '1.12.0'), true);
  assert.strictEqual(isNewer('1.12.0', '1.11.5'), false);
  assert.strictEqual(isNewer('1.11.5', '1.13.1.3'), true, '4 parçalı sürüm → güncelle (yayıncı davranışı)');
  assert.strictEqual(isNewer('1.13.1.3', '1.13.1.3'), false);
  // 2026-09-21: normalleştirme SONRASI vaka — "1.13.1" ile "1.13.1.3" AYNI
  // sürümdür; "yeni" demek her işte ~350 MB zip'i yeniden açtırır.
  assert.strictEqual(isNewer('1.13.1', '1.13.1.3'), false, 'normalleştirilmiş hâl aynı sürümdür');
  assert.strictEqual(isNewer('1.13.1', '1.13.8'), true, 'gerçek ilerleme hâlâ "yeni"');
});

test('en yeni yerel zip seçilir ve build üstüne uygulanır, version.txt güncellenir', () => {
  const { build, updRoot } = fixture();
  assert.strictEqual(latestLocalUpdate('060', updRoot).version, '1.13.1.3');
  const r = applyPublisherUpdate(build, { updateDir: updRoot });
  assert.deepStrictEqual([r.applied, r.from, r.to], [true, '1.11.5', '1.13.1.3']);
  assert.strictEqual(fs.readFileSync(path.join(build, 'app.config.js'), 'utf8'), '// yeni');
  assert.ok(fs.existsSync(path.join(build, 'new.main.js')) && fs.existsSync(path.join(build, 'old.main.js')));
  // 2026-09-21 bug-fix: version.txt'ye 4 parçalı ham zip adı DEĞİL, normalize
  // edilmiş 3 parça yazılır (kök neden — yayıncının electron.js'i 3 parça
  // değilse koşulsuz "eski" sayıp update indiriyordu).
  assert.strictEqual(fs.readFileSync(path.join(build, 'version.txt'), 'utf8'), '1.13.1');
  // 2026-09-21 KARDEŞ UÇ ONARIMI — eskiden burada şu YAN ETKİ "beklenen" diye
  // çivilenmişti: version.txt normalize edilip "1.13.1" olduğu, zip adı ise
  // anomalik "1.13.1.3" kaldığı için eski `isNewer` her koşuda "farklı" görüp
  // AYNI ~350 MB zip'i yeniden uyguluyordu. Ölçüldü: 1./2./3. çağrının üçü de
  // "uygulandı" dönüyordu. Artık kıyas `surum-kiyas.dahaYeniMi`'den gelir ve
  // normalleştirilmiş hâl aynı sürüm sayılır → ikinci koşu İŞ YAPMAZ.
  // Bu satır bir GERİLEME KAPISI: yeniden "uygulandı" dönerse kıyas kardeş
  // uçlardan birinde tekrar ayrışmış demektir.
  const again = applyPublisherUpdate(build, { updateDir: updRoot });
  assert.strictEqual(again.applied, false, 'aynı zip ikinci kez uygulanmamalı (350 MB tekrar)');
  assert.strictEqual(again.reason, 'zaten güncel');
  const ucuncu = applyPublisherUpdate(build, { updateDir: updRoot });
  assert.strictEqual(ucuncu.applied, false);
  // version.txt ikinci/üçüncü koşuda da değişmemeli (idempotent kapı)
  assert.strictEqual(fs.readFileSync(path.join(build, 'version.txt'), 'utf8'), '1.13.1');
});

test('güncelleme dizini/kurum yoksa dokunmaz', () => {
  const { build } = fixture();
  const r = applyPublisherUpdate(build, { updateDir: path.join(os.tmpdir(), 'yok-' + Date.now()) });
  assert.strictEqual(r.applied, false);
  fs.unlinkSync(path.join(build, 'kurum.txt'));
  assert.strictEqual(applyPublisherUpdate(build, { updateDir: '/nonexistent' }).companyId, null);
});

// --- SENTINEL: 2026-09-21 bug-fix — version.txt normalize kapısı ---

test('SENTINEL: version.txt her zaman 3 parça yazılır', () => {
  const { build, updRoot } = fixture();
  applyPublisherUpdate(build, { updateDir: updRoot });
  const yazilan = fs.readFileSync(path.join(build, 'version.txt'), 'utf8').trim();
  assert.strictEqual(yazilan.split('.').length, 3, `version.txt 3 parça olmalı, oldu: "${yazilan}"`);
});

test('SENTINEL (GERİLEME kapısı): 4+ parçalı zip adı normalize edilmeden yazılmaz', () => {
  const { build, updRoot } = fixture();
  applyPublisherUpdate(build, { updateDir: updRoot });
  const yazilan = fs.readFileSync(path.join(build, 'version.txt'), 'utf8').trim();
  // Zip adı "1.13.1.3" idi; bu ham hali (4 parça) ASLA doğrudan yazılmamalı.
  assert.notStrictEqual(yazilan, '1.13.1.3');
  assert.strictEqual(yazilan, '1.13.1');
});

test('SENTINEL: normalize başarısızsa mevcut version.txt korunur (fail-safe)', () => {
  // 2 parçalı ("1.13") bir zip adı — ucParcayaCevir bunu normalize EDEMEZ (0 ile
  // doldurmak yasak). Bu durumda version.txt'ye DOKUNULMAMALI, eski değer kalmalı.
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-build-'));
  fs.writeFileSync(path.join(build, 'kurum.txt'), '60');
  fs.writeFileSync(path.join(build, 'version.txt'), '1.11.5');
  fs.writeFileSync(path.join(build, 'app.config.js'), '// eski');
  const updRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-upd-'));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-updsrc-'));
  fs.writeFileSync(path.join(src, 'app.config.js'), '// yeni-bozuk-surum');
  fs.writeFileSync(path.join(src, 'version.txt'), '1.13');
  fs.mkdirSync(path.join(updRoot, '060'), { recursive: true });
  spawnSync('zip', ['-q', '-r', path.join(updRoot, '060', '1.13.zip'), '.'], { cwd: src });

  assert.strictEqual(latestLocalUpdate('060', updRoot).version, '1.13');
  const r = applyPublisherUpdate(build, { updateDir: updRoot });
  assert.strictEqual(r.applied, true, 'unzip yine uygulanır (içerik/app.config.js güncellenir)');
  assert.strictEqual(fs.readFileSync(path.join(build, 'app.config.js'), 'utf8'), '// yeni-bozuk-surum');
  // ama version.txt normalize edilemediği için DOKUNULMAMIŞ olmalı:
  assert.strictEqual(fs.readFileSync(path.join(build, 'version.txt'), 'utf8'), '1.11.5');
});

test('SENTINEL: kapı EMPP_SURUM_NORMALLESTIR=0 ile kapatılırsa eski (ham) davranış geri gelir', () => {
  const { build, updRoot } = fixture();
  const eski = process.env.EMPP_SURUM_NORMALLESTIR;
  process.env.EMPP_SURUM_NORMALLESTIR = '0';
  try {
    applyPublisherUpdate(build, { updateDir: updRoot });
    assert.strictEqual(fs.readFileSync(path.join(build, 'version.txt'), 'utf8'), '1.13.1.3');
  } finally {
    if (eski !== undefined) process.env.EMPP_SURUM_NORMALLESTIR = eski;
    else delete process.env.EMPP_SURUM_NORMALLESTIR;
  }
});

// --- GERİLEME: 2026-09-26 SET KÖKÜ EZİLMESİ (73768 Pardus ProBook RED) ---
//
// Eski kod güncelleme zip'ini koşulsuz build KÖKÜNE açıyordu. SET'te kök index.html
// set menüsüdür (Web-Z kabuğu); okuyucunun index.html'i onun üstüne yazılıyor, paket
// sonsuza dek "yükleniyor"da kalıyordu. Yayıncının electron.js'i (downloadUpdates)
// kökte app.config.js yoksa YALNIZ app.config.js taşıyan alt klasörlere açar.
// Ek kural (bizim): kitabın KENDİ okuyucu sürümü (rozet) güncellemeden yeni değilse
// ya da bilinmiyorsa o kitaba UYGULANMAZ — sürüm düşürme yasak.

const crypto = require('node:crypto');
const { kitapOkuyucuSurumu } = require('./publisher-update');

const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
const UPD_MAIN = 'b'.repeat(20) + '.main.js';
const WEBZ_KOK_INDEX = '<!DOCTYPE html><html><head><title>SET menü</title></head><body>'
  + '<div id="bookSetContainer"></div><script src="scripts/language-set.js"></script></body></html>';

/** Okuyucu taşıyan kitap dizini. Rozet: index → <hash>.main.js → parça → e.exports={i8:"X"}. */
function okuyucuKitabi(dizin, surum, hash) {
  fs.mkdirSync(dizin, { recursive: true });
  fs.writeFileSync(path.join(dizin, 'app.config.js'), 'const AppConfig = { setBook: { enable: true } };');
  // version.txt BİLEREK yanlış (25.09 zip'lerindeki gibi) — karar ondan okunmamalı.
  fs.writeFileSync(path.join(dizin, 'version.txt'), '1.11.5');
  if (surum === null) {
    fs.writeFileSync(path.join(dizin, 'index.html'), '<html><body>rozetsiz okuyucu</body></html>');
    return;
  }
  const parca = 'c'.repeat(20);
  fs.writeFileSync(path.join(dizin, 'index.html'),
    `<html><head><script defer="defer" src="./${hash}.main.js"></script></head><body>${surum}</body></html>`);
  fs.writeFileSync(path.join(dizin, `${hash}.main.js`), `var m={923:"${parca}"};`);
  fs.writeFileSync(path.join(dizin, `${parca}.923.js`), `x=function(e){e.exports={i8:"${surum}"}}`);
}

/** SET build: kök = Web-Z kabuğu (app.config.js YOK); book1 1.11.5, book2 1.13.3, book3 rozetsiz. */
function setFixture() {
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-set-'));
  fs.writeFileSync(path.join(build, 'kurum.txt'), '60\r\n');
  fs.writeFileSync(path.join(build, 'version.txt'), '1.11.5');
  fs.writeFileSync(path.join(build, 'index.html'), WEBZ_KOK_INDEX);
  fs.mkdirSync(path.join(build, 'config'));
  fs.writeFileSync(path.join(build, 'config', 'settings.json'), '{}');
  fs.mkdirSync(path.join(build, 'scripts'));
  fs.writeFileSync(path.join(build, 'scripts', 'language-set.js'), '// kabuk');
  fs.mkdirSync(path.join(build, 'images'));
  fs.writeFileSync(path.join(build, 'images', 'book1.png'), 'png');
  okuyucuKitabi(path.join(build, 'book1'), '1.11.5', 'a'.repeat(20));
  okuyucuKitabi(path.join(build, 'book2'), '1.13.3', 'd'.repeat(20));
  okuyucuKitabi(path.join(build, 'book3'), null);
  // Güncelleme zip'i: yayıncının 1.13.1.3 okuyucusu (index.html + main.js + version.txt).
  const updRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-upd-'));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'empp-updsrc-'));
  fs.writeFileSync(path.join(src, 'index.html'),
    `<!doctype html><title>Akıllı Tahta Uygulaması</title><script defer="defer" src="./${UPD_MAIN}"></script>`);
  fs.writeFileSync(path.join(src, UPD_MAIN), 'x=function(e){e.exports={i8:"1.13.1.3"}}');
  fs.writeFileSync(path.join(src, 'version.txt'), '1.13.1.3');
  fs.mkdirSync(path.join(updRoot, '060'), { recursive: true });
  const zipPath = path.join(updRoot, '060', '1.13.1.3.zip');
  spawnSync('zip', ['-q', '-r', zipPath, '.'], { cwd: src });
  return { build, updRoot, updIndexMd5: md5(path.join(src, 'index.html')) };
}

function kos(build, updRoot) {
  const satirlar = [];
  const r = applyPublisherUpdate(build, { updateDir: updRoot, log: (s) => satirlar.push(s) });
  return { r, satirlar };
}

test('GERİLEME: SET kökü — güncelleme sonrası kök index.html md5 DEĞİŞMEZ, köke okuyucu açılmaz', () => {
  const { build, updRoot, updIndexMd5 } = setFixture();
  const once = md5(path.join(build, 'index.html'));
  const { r } = kos(build, updRoot);
  assert.strictEqual(md5(path.join(build, 'index.html')), once, 'kök set menüsü ezildi');
  assert.notStrictEqual(md5(path.join(build, 'index.html')), updIndexMd5);
  assert.ok(!fs.existsSync(path.join(build, UPD_MAIN)), 'okuyucu main.js köke açılmış');
  assert.ok(!fs.existsSync(path.join(build, 'app.config.js')), 'kökte app.config.js oluşmamalı');
  assert.ok(!fs.existsSync(path.join(build, 'images', 'index.html')), 'app.config.js taşımayan klasöre açılmış');
  assert.strictEqual(r.set, true);
  // Kök version.txt kararı: normalleştirilmiş güncelleme sürümüne ilerler (önbellek anahtarı).
  assert.strictEqual(fs.readFileSync(path.join(build, 'version.txt'), 'utf8'), '1.13.1');
});

test('SET bookN: eski okuyuculu kitap güncellenir (rozet 1.11.5 → 1.13.1.3)', () => {
  const { build, updRoot, updIndexMd5 } = setFixture();
  const { r } = kos(build, updRoot);
  const b1 = path.join(build, 'book1');
  assert.strictEqual(md5(path.join(b1, 'index.html')), updIndexMd5);
  assert.strictEqual(kitapOkuyucuSurumu(b1).surum, '1.13.1.3');
  assert.strictEqual(fs.readFileSync(path.join(b1, 'version.txt'), 'utf8'), '1.13.1', 'bookN version.txt da 3 parça');
  assert.strictEqual(r.applied, true);
  assert.deepStrictEqual(r.uygulanan.map((u) => [u.kitap, u.once]), [['book1', '1.11.5']]);
  assert.match(r.uygulanan[0].kaynak, /^rozet /);
});

test('SET bookN: yeni okuyuculu kitap DÜŞÜRÜLMEZ (version.txt 1.11.5 yalan söylese de)', () => {
  const { build, updRoot } = setFixture();
  const b2 = path.join(build, 'book2');
  const once = md5(path.join(b2, 'index.html'));
  const { r } = kos(build, updRoot);
  assert.strictEqual(md5(path.join(b2, 'index.html')), once, '1.13.3 okuyucu 1.13.1.3\'e düşürüldü');
  assert.ok(!fs.existsSync(path.join(b2, UPD_MAIN)));
  assert.strictEqual(kitapOkuyucuSurumu(b2).surum, '1.13.3');
  assert.strictEqual(fs.readFileSync(path.join(b2, 'version.txt'), 'utf8'), '1.11.5', 'atlanan kitaba dokunulmaz');
  const a = r.atlanan.find((x) => x.kitap === 'book2');
  assert.ok(a, 'book2 atlananlarda raporlanmalı');
  assert.strictEqual(a.surum, '1.13.3');
  assert.match(a.neden, /sürüm düşürme yasak/);
});

test('SET bookN: sürümü bilinmeyen kitap atlanır, dönüşte ve günlükte GÖRÜNÜR raporlanır', () => {
  const { build, updRoot } = setFixture();
  const b3 = path.join(build, 'book3');
  const once = md5(path.join(b3, 'index.html'));
  const { r, satirlar } = kos(build, updRoot);
  assert.strictEqual(md5(path.join(b3, 'index.html')), once);
  assert.ok(!fs.existsSync(path.join(b3, UPD_MAIN)));
  const a = r.atlanan.find((x) => x.kitap === 'book3');
  assert.ok(a, 'book3 atlananlarda raporlanmalı');
  assert.strictEqual(a.surum, null);
  assert.strictEqual(a.neden, 'sürüm bilinmiyor');
  assert.ok(satirlar.some((s) => s.includes('book3') && s.includes('UYGULANMADI')), 'sessiz atlama');
  assert.match(r.reason, /1\/3 kitaba uygulandı/);
  assert.match(r.reason, /book3: sürüm bilinmiyor/);
});

test('SET: ikinci koşu iş yapmaz (kök damgası ilerledi → önbellek STALE döngüsü yok)', () => {
  const { build, updRoot } = setFixture();
  kos(build, updRoot);
  const { r } = kos(build, updRoot);
  assert.strictEqual(r.applied, false);
  assert.strictEqual(r.reason, 'zaten güncel');
});

test('Tek kitap: bugünkü davranış aynı — kökte app.config.js var, alt kitap dizini YOK → zip köke açılır', () => {
  const { build, updRoot } = fixture();
  fs.writeFileSync(path.join(build, 'index.html'), '<html>eski okuyucu</html>');
  const r = applyPublisherUpdate(build, { updateDir: updRoot, log: () => {} });
  assert.strictEqual(r.set, false);
  assert.strictEqual(r.applied, true);
  assert.strictEqual(fs.readFileSync(path.join(build, 'app.config.js'), 'utf8'), '// yeni');
  assert.ok(fs.existsSync(path.join(build, 'new.main.js')), 'zip köke açılmalı');
  assert.deepStrictEqual(r.uygulanan.map((u) => u.kitap), ['.']);
});

// --- GERİLEME: 2026-09-26 KÖKTE app.config.js OLSA BİLE SET (59834 v47 dersi) ---
//
// Eski karar TEK BAŞINA "kökte app.config.js var mı?" idi: varsa "tek kitap" sayılıp zip
// köke açılıyordu. Ama yayıncı bazı SET paketlerinin köküne de kendi app.config.js'ini
// bırakabiliyor (59834 v47 kaynağında kökte `set_app.config` birebir `app.config.js` olarak
// duruyordu). Bu durumda eski kod güncellemeyi köke açar, SET menüsünün index.html'i
// okuyucunun index.html'iyle ezilirdi (aynı 73768 semptomu, farklı tetik). Karar artık ÖNCE
// "en az bir alt kitap dizini (bookN/app.config.js) var mı?" sorusuna bakıyor; varsa kökte
// app.config.js olsa da SET dalı çalışır, kök ASLA açılmaz.
test('GERİLEME: kökte app.config.js + alt kitap dizini birlikte varsa SET dalı öncelikli — köke açılmaz', () => {
  const { build, updRoot } = fixture();
  fs.writeFileSync(path.join(build, 'index.html'), '<html>set menüsü (kök)</html>');
  fs.mkdirSync(path.join(build, 'alt'));
  fs.writeFileSync(path.join(build, 'alt', 'app.config.js'), '// alt kitap');
  const kokAppConfigOnce = fs.readFileSync(path.join(build, 'app.config.js'), 'utf8');
  const kokIndexOnce = fs.readFileSync(path.join(build, 'index.html'), 'utf8');
  const r = applyPublisherUpdate(build, { updateDir: updRoot, log: () => {} });
  assert.strictEqual(r.set, true, 'alt kitap dizini varken (kökte app.config.js olsa bile) SET dalı seçilmeli');
  assert.strictEqual(fs.readFileSync(path.join(build, 'app.config.js'), 'utf8'), kokAppConfigOnce, 'kök app.config.js EZİLMEMELİ');
  assert.strictEqual(fs.readFileSync(path.join(build, 'index.html'), 'utf8'), kokIndexOnce, 'kök index.html (set menüsü) EZİLMEMELİ');
  assert.ok(!fs.existsSync(path.join(build, 'new.main.js')), 'güncelleme köke açılmamalı');
  assert.ok(!fs.existsSync(path.join(build, 'alt', 'new.main.js')), 'okuyucu rozeti bilinmeyen alt kitaba da açılmamalı (sürüm düşürme riski)');
});

test('GERİLEME (59834 v47 dersi): kök app.config.js + book1/book2 app.config.js taşıyan SET → köke açılmaz, kök index.html md5 korunur, kitaplara uygulanır', () => {
  const { build, updRoot, updIndexMd5 } = setFixture();
  // Yayıncının bazı SET kaynaklarında kökte de kendi app.config.js'i duruyor (59834 v47: set_app.config).
  fs.writeFileSync(path.join(build, 'app.config.js'), '// yayincinin kok app.config.js’i (set_app.config)');
  const kokAppConfigOnce = fs.readFileSync(path.join(build, 'app.config.js'), 'utf8');
  const kokIndexOnce = md5(path.join(build, 'index.html'));
  const { r } = kos(build, updRoot);
  assert.strictEqual(r.set, true, 'kökte app.config.js olsa bile book1/book2 varken SET dalı seçilmeli');
  assert.strictEqual(md5(path.join(build, 'index.html')), kokIndexOnce, 'kök index.html (set menüsü) EZİLMEMELİ');
  assert.notStrictEqual(md5(path.join(build, 'index.html')), updIndexMd5);
  assert.strictEqual(fs.readFileSync(path.join(build, 'app.config.js'), 'utf8'), kokAppConfigOnce, 'kök app.config.js EZİLMEMELİ');
  assert.ok(!fs.existsSync(path.join(build, UPD_MAIN)), 'okuyucu main.js köke açılmamalı');
  const b1 = path.join(build, 'book1');
  assert.strictEqual(md5(path.join(b1, 'index.html')), updIndexMd5, 'book1 (eski okuyucu) güncellenmeli — kitaplara uygulanır');
  assert.deepStrictEqual(r.uygulanan.map((u) => u.kitap), ['book1']);
});
