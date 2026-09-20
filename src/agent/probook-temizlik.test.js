'use strict';
// ProBook kabul kapısının gizleme + temizlik gövdelerinin GERÇEK koşumu (mock yok):
//   tools/pardus/probook-gizle.sh     — testten önce envanter + gizleme
//   tools/pardus/probook-temizlik.sh  — testten sonra geri alma + silme
// Sahte bir $HOME altında bash ile koşturulur.
//
// Neden bu testler var — üçü de ölçülmüş saha kusuru (2026-09-19):
//  1) Temizlik yalnız `.kabulgizli-<damga>` gizlilerini geziyordu; kitabın önceden
//     kurulumu yoksa taze kurulum ProBook'ta kalıyordu ("YDT Power 12 Set").
//  2) `trap` yoktu; anormal çıkışta hiç temizlenmiyordu (1029 MB'lık impark iki gün durdu).
//  3) İKİ kurulum kökü var, kapı birini biliyordu:
//       ~/DijiTap/DijiTap/<Set>        (SET paketi)
//       ~/DijiTap/<alan-adi>/<Kitap>   (tekil kitap)
//     İkincisinden 514 MB'lık Lingo-Land-Grade-3 kurulumu geride kaldı.

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ARAC = path.join(__dirname, '..', '..', 'tools', 'pardus');
const GIZLE = path.join(ARAC, 'probook-gizle.sh');
const TEMIZLIK = path.join(ARAC, 'probook-temizlik.sh');

function damgaUret() {
  return `test${process.pid}${Math.random().toString(36).slice(2, 8)}`;
}

// kurulumlar: "kok/ad" biçiminde yollar (örn. "DijiTap/Kitap A").
function evKur(kurulumlar = []) {
  const ev = fs.mkdtempSync(path.join(os.tmpdir(), 'probook-kapi-'));
  const taban = path.join(ev, 'DijiTap');
  fs.mkdirSync(taban, { recursive: true });
  for (const yol of kurulumlar) {
    const tam = path.join(taban, yol);
    fs.mkdirSync(tam, { recursive: true });
    fs.writeFileSync(path.join(tam, 'AppRun'), 'x');
  }
  return { ev, taban };
}

function kosGizle(ev, damga) {
  return execFileSync('bash', [GIZLE, damga], { env: { ...process.env, HOME: ev }, encoding: 'utf8' });
}

function kosTemizlik(ev, damga, kopyala = '0', uzak = '') {
  return execFileSync('bash', [TEMIZLIK, damga, kopyala, uzak], {
    env: { ...process.env, HOME: ev },
    encoding: 'utf8',
  });
}

// $HOME/DijiTap altındaki tüm kurulumlar, "kok/ad" biçiminde, sıralı.
function kurulumlar(taban) {
  const cikti = [];
  for (const kok of fs.readdirSync(taban)) {
    const kokYolu = path.join(taban, kok);
    if (!fs.statSync(kokYolu).isDirectory()) continue;
    for (const ad of fs.readdirSync(kokYolu)) {
      if (fs.statSync(path.join(kokYolu, ad)).isDirectory()) cikti.push(`${kok}/${ad}`);
    }
  }
  return cikti.sort();
}

function envanter(damga) {
  const yol = `/tmp/kabul-onceki-${damga}.txt`;
  return fs.existsSync(yol)
    ? fs.readFileSync(yol, 'utf8').split('\n').filter(Boolean).sort()
    : null;
}

// ---- gizleme ----

test('gizleme her iki kurulum kökünü de envantere yazar ve gizler', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur([
    'DijiTap/Super Monsters 3 Set',
    'akillitahta.ydspublishing.com/Lingo-Land-Grade-3',
  ]);
  const cikti = kosGizle(ev, damga);
  assert.deepStrictEqual(envanter(damga), [
    'DijiTap/Super Monsters 3 Set',
    'akillitahta.ydspublishing.com/Lingo-Land-Grade-3',
  ]);
  assert.deepStrictEqual(kurulumlar(taban), [
    `DijiTap/Super Monsters 3 Set.kabulgizli-${damga}`,
    `akillitahta.ydspublishing.com/Lingo-Land-Grade-3.kabulgizli-${damga}`,
  ]);
  assert.match(cikti, /gizlendi: akillitahta\.ydspublishing\.com\/Lingo-Land-Grade-3/);
  kosTemizlik(ev, damga);
});

test('hiç kurulum yokken gizleme boş envanter üretir (dosya yokluğu ≠ boşluk)', () => {
  const damga = damgaUret();
  const { ev } = evKur([]);
  kosGizle(ev, damga);
  assert.deepStrictEqual(envanter(damga), []);
  kosTemizlik(ev, damga);
});

// ---- temizlik ----

test('testin kurduğu kurulum silinir — kitabın ÖNCEDEN kurulumu olmasa bile', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Super Monsters 3 Set']);
  kosGizle(ev, damga);
  fs.mkdirSync(path.join(taban, 'DijiTap', 'YDT Power 12 Set'), { recursive: true });
  const cikti = kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), ['DijiTap/Super Monsters 3 Set']);
  assert.match(cikti, /silindi \(test kurulumu\): DijiTap\/YDT Power 12 Set/);
});

test('İKİNCİ kökteki test kurulumu da silinir (514 MB Lingo kalıntısının sınıfı)', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Super Monsters 3 Set']);
  kosGizle(ev, damga);
  fs.mkdirSync(path.join(taban, 'akillitahta.ydspublishing.com', 'Lingo-Land-Grade-3'), {
    recursive: true,
  });
  const cikti = kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), ['DijiTap/Super Monsters 3 Set']);
  assert.match(cikti, /silindi \(test kurulumu\): akillitahta\.ydspublishing\.com\/Lingo-Land-Grade-3/);
  // Test sirasinda dogan bos alan adi dizini de kalmaz.
  assert.strictEqual(fs.existsSync(path.join(taban, 'akillitahta.ydspublishing.com')), false);
});

test('testten ÖNCE var olan kurulumlar korunur (iki kökte de)', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Kitap A', 'akillitahta.ydspublishing.com/Kitap B']);
  kosGizle(ev, damga);
  kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), [
    'DijiTap/Kitap A',
    'akillitahta.ydspublishing.com/Kitap B',
  ]);
});

test('gizlenen eski kurulum geri konur, üstüne kurulan taze sürüm gider', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Kitap A']);
  kosGizle(ev, damga);
  // Test ayni kitabi yeniden kurdu; taze kurulumu TAZE isaretiyle ayirt ediyoruz.
  const taze = path.join(taban, 'DijiTap', 'Kitap A');
  fs.mkdirSync(taze, { recursive: true });
  fs.writeFileSync(path.join(taze, 'TAZE'), 'x');
  const cikti = kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), ['DijiTap/Kitap A']);
  assert.strictEqual(fs.existsSync(path.join(taze, 'TAZE')), false);
  assert.strictEqual(fs.existsSync(path.join(taze, 'AppRun')), true);
  assert.match(cikti, /geri konuldu: DijiTap\/Kitap A/);
});

test('başka koşunun gizlisine dokunulmaz', () => {
  const damga = damgaUret();
  const baska = damgaUret();
  const { ev, taban } = evKur([]);
  fs.mkdirSync(path.join(taban, 'DijiTap', `Yabanci.kabulgizli-${baska}`), { recursive: true });
  kosGizle(ev, damga);
  kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), [`DijiTap/Yabanci.kabulgizli-${baska}`]);
});

test('envanter YOKSA hiçbir kurulum silinmez (güvenli taraf)', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Kitap A']);
  kosTemizlik(ev, damga); // gizleme hiç koşmadı → envanter yok
  assert.deepStrictEqual(kurulumlar(taban), ['DijiTap/Kitap A']);
});

test('iki kez koşmak zararsız (trap + red() aynı anda çağırabilir)', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Kitap A']);
  kosGizle(ev, damga);
  fs.mkdirSync(path.join(taban, 'DijiTap', 'Taze Kitap'), { recursive: true });
  kosTemizlik(ev, damga);
  const ikinci = kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), ['DijiTap/Kitap A']);
  assert.strictEqual(ikinci.includes('silindi (test kurulumu)'), false);
});

test('envanter temizlikten sonra kalmaz', () => {
  const damga = damgaUret();
  const { ev } = evKur(['DijiTap/Kitap A']);
  kosGizle(ev, damga);
  assert.notStrictEqual(envanter(damga), null);
  kosTemizlik(ev, damga);
  assert.strictEqual(envanter(damga), null);
});

test('ad eşleşmesi TAM satır olmalı — önek eşleşmesi kalıntı bırakmaz', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Kitap A Deneme']);
  kosGizle(ev, damga);
  fs.mkdirSync(path.join(taban, 'DijiTap', 'Kitap A'), { recursive: true });
  kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), ['DijiTap/Kitap A Deneme']);
});

test('ad düz metin karşılaştırılır — regex özel karakteri kalıntı bırakmaz', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Kitap AX']);
  kosGizle(ev, damga);
  fs.mkdirSync(path.join(taban, 'DijiTap', 'Kitap A.'), { recursive: true });
  kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), ['DijiTap/Kitap AX']);
});

test('aynı ad iki farklı kökte ise yalnız testin kurduğu gider', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Kitap A']);
  kosGizle(ev, damga);
  fs.mkdirSync(path.join(taban, 'baska-alan.com', 'Kitap A'), { recursive: true });
  kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), ['DijiTap/Kitap A']);
});

test('KOPYALA=1 ise uzaktaki impark kopyası silinir', () => {
  const damga = damgaUret();
  const { ev } = evKur([]);
  const uzak = path.join(ev, `kabul-${damga}.impark`);
  fs.writeFileSync(uzak, 'paket');
  kosTemizlik(ev, damga, '1', uzak);
  assert.strictEqual(fs.existsSync(uzak), false);
});

test('KOPYALA=0 ise yerinde duran paket silinmez', () => {
  const damga = damgaUret();
  const { ev } = evKur([]);
  const yerinde = path.join(ev, 'yerinde.impark');
  fs.writeFileSync(yerinde, 'paket');
  kosTemizlik(ev, damga, '0', yerinde);
  assert.strictEqual(fs.existsSync(yerinde), true);
});
