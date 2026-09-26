'use strict';
/**
 * Başsız kabul kapısı — ENTEGRASYON testi: gerçek Electron koşumu, küçük sahte SET paketi.
 *   iyi menü → GEÇTİ;  ezilmiş kök (73768 biçimi) → RED;
 *   her kritik ölçüt bir kez bilerek bozulur → RED (mutasyon kanıtı).
 * Electron çalışma zamanı yoksa (CI) testler ÖLÇÜLEMEDİ'yi GEÇTİ saymaz: kendini atlar.
 * Koşum offscreen + LSUIElement'tir; odak ölçümü her koşuda karar.json'a düşer.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { calis, kitapIdTuret, kanitAdi, argumanCoz, icerikKarari } = require('./basliksiz-kabul');
const { calismaZamaniHazirla } = require('./calisma-zamani');

let zamanVar = true;
try { calismaZamaniHazirla({ surum: '27.3.11' }); } catch (_) { zamanVar = false; }

const RENKLI = 'background:linear-gradient(135deg,#e63946 0%,#f1c40f 30%,#2a9d8f 60%,#264653 100%);';

function menuHtml({ baslik = 'Deneme Seti', kartlar = ['book1', 'book2'], ekBody = '', ekHead = '', govdeStil = RENKLI, tiklamaEngeli = false } = {}) {
  const k = kartlar.map((b) => `<a class="kart" href="${b}/index.html"${tiklamaEngeli ? ' onclick="event.preventDefault()"' : ''}`
    + ` style="display:inline-block;width:260px;height:340px;margin:40px;background:#1d3557;color:#fff;font:28px sans-serif">${b}</a>`).join('');
  return `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>${baslik}</title>${ekHead}</head>`
    + `<body style="margin:0;height:100vh;${govdeStil}">${k}${ekBody}</body></html>`;
}

const OKUYUCU_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Kitap</title></head>'
  + '<body style="margin:0;background:#ddd"><canvas id="c" width="900" height="700"></canvas><script>'
  + 'const c=document.getElementById("c").getContext("2d");const g=c.createLinearGradient(0,0,900,700);'
  + 'g.addColorStop(0,"#003049");g.addColorStop(.5,"#d62828");g.addColorStop(1,"#fcbf49");c.fillStyle=g;'
  + 'c.fillRect(0,0,900,700);c.fillStyle="#000";c.font="48px sans-serif";c.fillText("Sayfa 1",60,120);</script></body></html>';

const BOS_OKUYUCU_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Kitap</title></head><body style="background:#fff"></body></html>';

/** 73768'in ezilmiş kökü: okuyucu başlığı, app.config.js yok, sonsuz "…" yükleyici. */
const EZILMIS_KOK_HTML = '<!doctype html><html lang="en"><head><meta charset="UTF-8"/><script src="app.config.js"></script>'
  + '<title>Akıllı Tahta Uygulaması</title><style>#loader-root{display:none}.loading{display:block!important}'
  + '.lds-ellipsis{display:inline-block;position:relative;width:80px;height:80px}.lds-ellipsis div{position:absolute;top:33px;'
  + 'width:13px;height:13px;border-radius:50%;background:#000}</style>'
  + '<script defer="defer" src="./a8f43f74c72b65a3dd05.main.js"></script></head><body>'
  + '<div id="loader-root" class="loading"><div class="lds-ellipsis"><div></div><div></div><div></div><div></div></div></div>'
  + '<div id="root"></div></body></html>';

function sahteSet(ad, { kok, okuyucu = OKUYUCU_HTML, kitaplar = ['book1', 'book2'] }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `bk-test-${ad}-`));
  fs.writeFileSync(path.join(d, 'index.html'), kok);
  fs.writeFileSync(path.join(d, 'version'), '27.3.11');
  for (const b of kitaplar) {
    fs.mkdirSync(path.join(d, b));
    fs.writeFileSync(path.join(d, b, 'app.config.js'), 'window.AppConfig={};');
    fs.writeFileSync(path.join(d, b, 'index.html'), okuyucu);
  }
  return d;
}

async function kos(d, ek = []) {
  const kanit = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-test-kanit-'));
  const calisma = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-test-calisma-'));
  const satirlar = [];
  const r = await calis([d, '--platform', 'dizin', '--kanit', kanit, '--calisma', calisma, '--tut',
    '--menu-bekle', '8', '--kitap-bekle', '8', ...ek], (s) => satirlar.push(s));
  const temizle = () => {
    for (const x of [d, kanit, calisma]) fs.rmSync(x, { recursive: true, force: true });
  };
  return { ...r, satirlar, kanit, temizle };
}

const secenek = { skip: !zamanVar && 'Electron çalışma zamanı yok', timeout: 300000 };

test('entegrasyon: sağlam SET menüsü → GEÇTİ (menü + ileri adım + okuyucu), odak korunur', secenek, async () => {
  const d = sahteSet('iyi', { kok: menuHtml() });
  const r = await kos(d);
  try {
    assert.equal(r.kod, 0, r.satirlar.join('\n'));
    const k = r.rapor.katmanlar.icerik;
    assert.equal(k.menu.kartSayisi, 2);
    assert.match(r.rapor.katmanlar.icerik.ileriAdim.gezinilen, /\/book1\/index\.html$/);
    assert.ok(k.kitap.tuval >= 1);
    assert.equal(r.rapor.odak.calindi, false);
    for (const f of ['karar.json', 'kosum.json', 'konsol.log', 'menu.png', 'kitap.png', 'odak-ornekleri.jsonl']) {
      assert.ok(fs.existsSync(path.join(r.kanit, f)), `kanıt eksik: ${f}`);
    }
  } finally { r.temizle(); }
});

test('entegrasyon: ezilmiş SET kökü (73768 biçimi) → RED', secenek, async () => {
  const d = sahteSet('ezik', { kok: EZILMIS_KOK_HTML });
  const r = await kos(d);
  try {
    assert.equal(r.kod, 1, r.satirlar.join('\n'));
    const sebep = r.rapor.sebepler.join(' | ');
    assert.match(sebep, /motorun tek-kitap sayfası/);
    assert.match(sebep, /okuyucu başlığı/);
    assert.match(sebep, /menü kartı 0 ≠ beklenen 2/);
    assert.match(sebep, /hâlâ yükleniyor/);
    assert.match(sebep, /ekranda içerik yok/);
    assert.ok(r.rapor.katmanlar.icerik.konsol.dosyaBulunamadi >= 1, 'kök app.config.js yokluğu ERR_FILE_NOT_FOUND olarak raporlanmalı');
  } finally { r.temizle(); }
});

const MUTANTLAR = [
  ['okuyucu başlığı', { kok: menuHtml({ baslik: 'Akıllı Tahta Uygulaması' }) }, /okuyucu başlığı/],
  ['eksik kart', { kok: menuHtml({ kartlar: ['book1'] }) }, /menü kartı 1 ≠ beklenen 2/],
  ['sonsuz yükleniyor', { kok: menuHtml({ ekBody: '<div style="position:fixed;top:10px;left:10px;background:#fff;padding:20px">Yükleniyor...</div>' }) }, /hâlâ yükleniyor/],
  ['beyaz ekran', { kok: menuHtml({ govdeStil: 'background:#fff;', kartlar: [] }).replace('</body>', '<a href="book1/index.html" style="color:#fafafa">.</a><a href="book2/index.html" style="color:#fafafa">.</a></body>') }, /ekranda içerik yok/],
  ['kart açmıyor', { kok: menuHtml({ tiklamaEngeli: true }) }, /kitap AÇILMADI/],
  ['okuyucu çizmiyor', { kok: menuHtml(), okuyucu: BOS_OKUYUCU_HTML }, /okuyucu: .*(sayfa çizmedi|ekranda içerik yok)/],
  ['K17 konsol imzası', { kok: menuHtml({ ekHead: '<script>console.error("Uncaught (in promise) Error: ImWin32.dll dosyası okunamadı.")</script>' }) }, /ImWin32/],
];

for (const [ad, kurulum, desen] of MUTANTLAR) {
  test(`mutasyon: ${ad} → RED`, secenek, async () => {
    const d = sahteSet(ad.replace(/\W+/g, '-'), kurulum);
    const r = await kos(d);
    try {
      assert.equal(r.kod, 1, `${ad} yakalanmadı:\n${r.satirlar.join('\n')}`);
      assert.match(r.rapor.sebepler.join(' | '), desen);
    } finally { r.temizle(); }
  });
}

test('tek kitap (SET değil): kök okuyucu doğrudan ölçülür, başlık/kart aranmaz → GEÇTİ', secenek, async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-test-tek-'));
  fs.writeFileSync(path.join(d, 'index.html'), OKUYUCU_HTML.replace('<title>Kitap</title>', '<title>Akıllı Tahta Uygulaması</title>'));
  fs.writeFileSync(path.join(d, 'app.config.js'), 'window.AppConfig={};');
  fs.writeFileSync(path.join(d, 'version'), '27.3.11');
  const r = await kos(d);
  try {
    assert.equal(r.kod, 0, r.satirlar.join('\n'));
    assert.equal(r.rapor.envanter.setMi, false);
  } finally { r.temizle(); }
});

// GERİLEME (26.09 73768 mac): runner ortamı NODE_OPTIONS'a Electron'un reddettiği bayrağı koyuyor
// ("--no-network-family-autoselection is not allowed in NODE_OPTIONS") → koşum açılmadan çıkıyor,
// her iş ÖLÇÜLEMEDİ ile erteleniyordu. Koşum NODE_OPTIONS'ı ortamdan çıkarmalı.
test('GERİLEME: runner NODE_OPTIONS (--no-network-family-autoselection) koşumu düşürmez → GEÇTİ', secenek, async () => {
  const onceki = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--dns-result-order=ipv4first --no-network-family-autoselection';
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-test-nodeopt-'));
  fs.writeFileSync(path.join(d, 'index.html'), OKUYUCU_HTML.replace('<title>Kitap</title>', '<title>Akıllı Tahta Uygulaması</title>'));
  fs.writeFileSync(path.join(d, 'app.config.js'), 'window.AppConfig={};');
  fs.writeFileSync(path.join(d, 'version'), '27.3.11');
  try {
    const r = await kos(d);
    try {
      assert.equal(r.kod, 0, r.satirlar.join('\n'));
    } finally { r.temizle(); }
  } finally {
    if (onceki === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = onceki;
  }
});

/**
 * Motor kitap rafı: beyaz zemin, dikey kapaklar, sayfa izi yok. `arkaplan` = BES 74451
 * biçimi (kapak <img> değil, `background-image` kutusu; tıklama kapsayıcı kartta).
 */
function rafHtml({ tiklaninca = "location.href='okuyucu.html'", arkaplan = false } = {}) {
  const renkler = [['#264653', '#e9c46a'], ['#9b2226', '#ee9b00'], ['#3a0ca3', '#4cc9f0']];
  const kapaklar = renkler.map(([a, b], i) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
      + `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`
      + `<rect width="160" height="240" fill="url(#g)"/><text x="20" y="60" font-size="28" fill="#fff">${i + 5}. SINIF</text></svg>`;
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    if (arkaplan) {
      return `<div title="${i + 5}. sınıf" onclick="${tiklaninca}" style="display:inline-block;margin:60px 30px;cursor:pointer">`
        + `<div style="width:160px;height:240px;background-image:url('${url}');background-size:cover"></div><h6>${i + 5}. sınıf</h6></div>`;
    }
    return `<img alt="${i + 5}. sınıf" width="160" height="240" style="margin:60px 30px;cursor:pointer" onclick="${tiklaninca}"`
      + ` src="${url}">`;
  }).join('');
  return '<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>Akıllı Tahta Uygulaması</title></head>'
    + `<body style="margin:0;background:#fff;font:20px sans-serif"><h1 style="margin:30px">Kitaplık</h1>${kapaklar}</body></html>`;
}

function sahteRaf(ad, kok) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `bk-test-${ad}-`));
  fs.writeFileSync(path.join(d, 'index.html'), kok);
  fs.writeFileSync(path.join(d, 'okuyucu.html'), OKUYUCU_HTML);
  fs.writeFileSync(path.join(d, 'app.config.js'), 'window.AppConfig={};');
  fs.writeFileSync(path.join(d, 'version'), '27.3.11');
  return d;
}

for (const [ad, arkaplan] of [['<img> kapak', false], ['arka plan görselli kapak (BES 74451)', true]]) {
  test(`tek kitap motor rafı, ${ad}: ilk kapağa tıklanır, okuyucu ölçülür → GEÇTİ`, secenek, async () => {
    const r = await kos(sahteRaf(arkaplan ? 'raf-bg' : 'raf', rafHtml({ arkaplan })));
    try {
      assert.equal(r.kod, 0, r.satirlar.join('\n'));
      const k = r.rapor.katmanlar.icerik;
      assert.equal(k.ileriAdim.tur, 'kitaplik');
      assert.match(k.ileriAdim.gezinilen, /okuyucu\.html$/);
      assert.ok(k.kitap.tuval >= 1);
    } finally { r.temizle(); }
  });
}

test('mutasyon: raftaki kapak okuyucuyu açmıyor → RED', secenek, async () => {
  const r = await kos(sahteRaf('raf-olu', rafHtml({ tiklaninca: 'void 0' })));
  try {
    assert.equal(r.kod, 1, r.satirlar.join('\n'));
    assert.match(r.rapor.sebepler.join(' | '), /rafta kapağa tıklandı .* okuyucu: .*sayfa çizmedi/);
  } finally { r.temizle(); }
});

test('kullanım hatası → 2; olmayan paket → 2', async () => {
  assert.equal((await calis([], () => {})).kod, 2);
  assert.equal((await calis(['/yok/boyle/bir/paket.dmg'], () => {})).kod, 2);
});

test('kitapIdTuret / kanitAdi / argumanCoz (saf)', () => {
  assert.equal(kitapIdTuret('https://cdn.x.com/softwares/73768/a.dmg'.replace('https://cdn.x.com', '')), '73768');
  assert.equal(kitapIdTuret('/Users/n/Downloads/Windows/PARDUS-73768/1.0.2/Super Monsters.impark'), '73768');
  assert.equal(kitapIdTuret('/tmp/SM3-bozuk.dmg'), 'SM3-bozuk');
  assert.equal(kanitAdi('73768', 'mac', new Date(2026, 8, 26, 10, 5, 7)), '73768-mac-20260926-100507');
  const s = argumanCoz(['p.apk', '--platform', 'android', '--kitap-sayisi', '3', '--cihaz-yok', '--tut']);
  assert.equal(s.platform, 'android');
  assert.equal(s.kitapSayisi, 3);
  assert.equal(s.cihaz, false);
  assert.equal(s.tut, true);
});

test('icerikKarari: koşum ölçüm üretmediyse ÖLÇÜLEMEDİ (GEÇTİ değil)', () => {
  const k = icerikKarari({ envanter: { setMi: true, indexHtml: '' }, kosum: null, beklenenKart: 3 });
  assert.equal(k.durum, 'OLCULEMEDI');
});
