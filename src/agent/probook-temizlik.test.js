'use strict';
// ProBook kabul kapısının gizleme + temizlik + kilit gövdelerinin GERÇEK koşumu (mock yok):
//   tools/pardus/probook-gizle.sh     — testten önce gizleme + MANİFEST
//   tools/pardus/probook-temizlik.sh  — testten sonra YALNIZ manifestteki yollar
//   tools/pardus/probook-kilit.sh     — uzak/yerel kapıların ortak ~/.kabul.lock'u
// Sahte bir $HOME altında bash ile koşturulur.
//
// Ölçülmüş saha kusurları:
//  2026-09-19: (1) önceden kurulumu olmayan kitabın taze kurulumu kalıyordu ("YDT Power 12 Set");
//   (2) trap yoktu; (3) iki kurulum kökü (~/DijiTap/DijiTap/<Set>, ~/DijiTap/<alan>/<Kitap>).
//  2026-09-24 18:06: "başlangıç envanterinde yok → test kurulumu → SİL" yöntemi, eşzamanlı bir
//   sürecin oluşturduğu `DijiTap/Privilege Grade 11.yedek-20260924-180613`'ü SİLDİ. Artık
//   yalnız manifest (KURULUM/GIZLI/KOK) işlenir; manifestte olmayan dizin silinmez.

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ARAC = path.join(__dirname, '..', '..', 'tools', 'pardus');
const GIZLE = path.join(ARAC, 'probook-gizle.sh');
const TEMIZLIK = path.join(ARAC, 'probook-temizlik.sh');
const KILIT = path.join(ARAC, 'probook-kilit.sh');

function damgaUret() {
  return `test${process.pid}${Math.random().toString(36).slice(2, 8)}`;
}

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

// hedef: paketin kuracağı "kok/ad" (üretimde AppRun'dan okunur; burada açık verilir).
function kosGizle(ev, damga, hedef = '') {
  return execFileSync('bash', [GIZLE, damga, '', hedef], { env: { ...process.env, HOME: ev }, encoding: 'utf8' });
}
function kosTemizlik(ev, damga, kopyala = '0', uzak = '') {
  return execFileSync('bash', [TEMIZLIK, damga, kopyala, uzak], { env: { ...process.env, HOME: ev }, encoding: 'utf8' });
}
function kur(taban, yol, isaret = 'TAZE') {
  fs.mkdirSync(path.join(taban, yol), { recursive: true });
  fs.writeFileSync(path.join(taban, yol, isaret), 'x');
}
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
const manifest = (ev, damga) => {
  const y = path.join(ev, `.kabul-${damga}.manifest`);
  return fs.existsSync(y) ? fs.readFileSync(y, 'utf8').split('\n').filter(Boolean).sort() : null;
};

// ---- gizleme + manifest ----

test('gizleme iki kökü de gizler ve manifeste GIZLI + KURULUM yazar', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Super Monsters 3 Set', 'akillitahta.ydspublishing.com/Lingo-Land-Grade-3']);
  const cikti = kosGizle(ev, damga, 'DijiTap/Bloktest');
  assert.deepStrictEqual(manifest(ev, damga), [
    'GIZLI DijiTap/Super Monsters 3 Set',
    'GIZLI akillitahta.ydspublishing.com/Lingo-Land-Grade-3',
    'KURULUM DijiTap/Bloktest',
  ]);
  assert.deepStrictEqual(kurulumlar(taban), [
    `DijiTap/Super Monsters 3 Set.kabulgizli-${damga}`,
    `akillitahta.ydspublishing.com/Lingo-Land-Grade-3.kabulgizli-${damga}`,
  ]);
  assert.match(cikti, /hedef: DijiTap\/Bloktest/);
  kosTemizlik(ev, damga);
});

test('başkasının .yedek-/.kabulgizli-/.kaldirildi- dizinleri GİZLENMEZ ve manifeste girmez', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur([
    'DijiTap/Privilege Grade 11.yedek-20260924-180613', 'DijiTap/X.kabulgizli-baska', 'DijiTap/Y.kaldirildi-1',
  ]);
  kosGizle(ev, damga, 'DijiTap/Bloktest');
  assert.deepStrictEqual(manifest(ev, damga), ['KURULUM DijiTap/Bloktest']);
  kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), [
    'DijiTap/Privilege Grade 11.yedek-20260924-180613', 'DijiTap/X.kabulgizli-baska', 'DijiTap/Y.kaldirildi-1',
  ]);
});

test('yeni alan adı kökü manifeste KOK olarak girer ve boş kalınca kaldırılır', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Super Monsters 3 Set']);
  kosGizle(ev, damga, 'akillitahta.ydspublishing.com/Lingo-Land-Grade-3');
  assert.ok(manifest(ev, damga).includes('KOK akillitahta.ydspublishing.com'));
  kur(taban, 'akillitahta.ydspublishing.com/Lingo-Land-Grade-3');
  const cikti = kosTemizlik(ev, damga);
  assert.match(cikti, /silindi \(test kurulumu\): akillitahta\.ydspublishing\.com\/Lingo-Land-Grade-3/);
  assert.strictEqual(fs.existsSync(path.join(taban, 'akillitahta.ydspublishing.com')), false);
  assert.deepStrictEqual(kurulumlar(taban), ['DijiTap/Super Monsters 3 Set']);
});

// ---- temizlik ----

test('GERİLEME 18:06: test sırasında doğan, manifestte OLMAYAN dizin SİLİNMEZ (.yedek- olayı)', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Privilege Grade 11']);
  kosGizle(ev, damga, 'DijiTap/Bloktest');
  kur(taban, 'DijiTap/Bloktest');                                 // bizim kurulumumuz
  kur(taban, 'DijiTap/Privilege Grade 11.yedek-20260924-180613', 'YEDEK'); // eşzamanlı başka süreç
  kur(taban, 'baska-alan.com/Baska Kitap', 'BASKA');              // başka kapı/öğretmen kurulumu
  const cikti = kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), [
    'DijiTap/Privilege Grade 11',
    'DijiTap/Privilege Grade 11.yedek-20260924-180613',
    'baska-alan.com/Baska Kitap',
  ]);
  assert.match(cikti, /silindi \(test kurulumu\): DijiTap\/Bloktest/);
  assert.doesNotMatch(cikti, /yedek-20260924-180613/);
});

test('testin kurduğu kurulum silinir — kitabın ÖNCEDEN kurulumu olmasa bile', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Super Monsters 3 Set']);
  kosGizle(ev, damga, 'DijiTap/YDT Power 12 Set');
  kur(taban, 'DijiTap/YDT Power 12 Set');
  const cikti = kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), ['DijiTap/Super Monsters 3 Set']);
  assert.match(cikti, /silindi \(test kurulumu\): DijiTap\/YDT Power 12 Set/);
});

test('gizlenen eski kurulum geri konur, üstüne kurulan taze sürüm gider', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Kitap A']);
  kosGizle(ev, damga, 'DijiTap/Kitap A');
  kur(taban, 'DijiTap/Kitap A');
  const cikti = kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), ['DijiTap/Kitap A']);
  assert.strictEqual(fs.existsSync(path.join(taban, 'DijiTap', 'Kitap A', 'TAZE')), false);
  assert.strictEqual(fs.existsSync(path.join(taban, 'DijiTap', 'Kitap A', 'AppRun')), true);
  assert.match(cikti, /geri konuldu: DijiTap\/Kitap A/);
});

test('geri koyarken yerde BAŞKA bir dizin varsa ezilmez, gizli kopya bırakılır', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Kitap A']);
  kosGizle(ev, damga, 'DijiTap/Bloktest');
  kur(taban, 'DijiTap/Kitap A', 'BASKASI');
  const cikti = kosTemizlik(ev, damga);
  assert.match(cikti, /CAKISMA: DijiTap\/Kitap A/);
  assert.ok(fs.existsSync(path.join(taban, 'DijiTap', 'Kitap A', 'BASKASI')));
  assert.ok(fs.existsSync(path.join(taban, 'DijiTap', `Kitap A.kabulgizli-${damga}`, 'AppRun')));
});

test('hedef gizlemeden sonra da duruyorsa ONCEKI sayılır ve SİLİNMEZ', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur([]);
  // gizlenemeyen (korunan adla değil, gerçekten silinemeyen) durumu taklit: hedefi yalnız
  // okunur bir kökün altına koy → mv başarısız → ONCEKI.
  kur(taban, 'kilitli.com/Kitap', 'ORIJINAL');
  fs.chmodSync(path.join(taban, 'kilitli.com'), 0o555);
  try {
    kosGizle(ev, damga, 'kilitli.com/Kitap');
    assert.ok(manifest(ev, damga).includes('ONCEKI kilitli.com/Kitap'));
    assert.ok(!manifest(ev, damga).includes('KURULUM kilitli.com/Kitap'));
    kosTemizlik(ev, damga);
    assert.ok(fs.existsSync(path.join(taban, 'kilitli.com', 'Kitap', 'ORIJINAL')));
  } finally {
    fs.chmodSync(path.join(taban, 'kilitli.com'), 0o755);
  }
});

test('hedef bilinmiyorsa (AppRun okunamadı) hiçbir kurulum silinmez, gizliler yine geri konur', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Kitap A']);
  const cikti = kosGizle(ev, damga, '');
  assert.match(cikti, /hedef: BILINMIYOR/);
  kur(taban, 'DijiTap/Taze');
  kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), ['DijiTap/Kitap A', 'DijiTap/Taze']);
});

test('manifest YOKSA hiçbir şey silinmez (güvenli taraf)', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Kitap A']);
  const cikti = kosTemizlik(ev, damga);
  assert.match(cikti, /manifest yok/);
  assert.deepStrictEqual(kurulumlar(taban), ['DijiTap/Kitap A']);
});

test('manifestte güvensiz yol (.., mutlak, derin) SİLİNMEZ', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur([]);
  kur(taban, 'DijiTap/Kurban');
  fs.writeFileSync(path.join(ev, `.kabul-${damga}.manifest`),
    'KURULUM ../DijiTap\nKURULUM /etc/x\nKURULUM DijiTap/Kurban/alt\nKURULUM DijiTap\n');
  const cikti = kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), ['DijiTap/Kurban']);
  assert.match(cikti, /atlandi \(gecersiz yol\)/);
});

test('iki kez koşmak zararsız; manifest temizlikten sonra kalmaz', () => {
  const damga = damgaUret();
  const { ev, taban } = evKur(['DijiTap/Kitap A']);
  kosGizle(ev, damga, 'DijiTap/Taze Kitap');
  kur(taban, 'DijiTap/Taze Kitap');
  kosTemizlik(ev, damga);
  assert.strictEqual(manifest(ev, damga), null);
  const ikinci = kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), ['DijiTap/Kitap A']);
  assert.strictEqual(ikinci.includes('silindi (test kurulumu)'), false);
});

test('başka koşunun gizlisine dokunulmaz', () => {
  const damga = damgaUret();
  const baska = damgaUret();
  const { ev, taban } = evKur([]);
  fs.mkdirSync(path.join(taban, 'DijiTap', `Yabanci.kabulgizli-${baska}`), { recursive: true });
  kosGizle(ev, damga, 'DijiTap/Bloktest');
  kosTemizlik(ev, damga);
  assert.deepStrictEqual(kurulumlar(taban), [`DijiTap/Yabanci.kabulgizli-${baska}`]);
});

test('KOPYALA=1 ise uzaktaki impark kopyası silinir; KOPYALA=0 ise yerinde paket kalır', () => {
  const damga = damgaUret();
  const { ev } = evKur([]);
  const uzak = path.join(ev, `kabul-${damga}.impark`);
  fs.writeFileSync(uzak, 'paket');
  kosTemizlik(ev, damga, '1', uzak);
  assert.strictEqual(fs.existsSync(uzak), false);
  const yerinde = path.join(ev, 'yerinde.impark');
  fs.writeFileSync(yerinde, 'paket');
  kosTemizlik(ev, damga, '0', yerinde);
  assert.strictEqual(fs.existsSync(yerinde), true);
});

// ---- ortak kilit ----

const kilitKos = (ev, ...a) => spawnSync('bash', [KILIT, ...a], { env: { ...process.env, HOME: ev }, encoding: 'utf8' });

test('kilit: O_EXCL — ikinci kapı alamaz, sahibi bırakınca alır; başkası bırakamaz', () => {
  const { ev } = evKur([]);
  assert.strictEqual(kilitKos(ev, 'al', 'd1', 'mac', '111').status, 0);
  const ikinci = kilitKos(ev, 'al', 'd2', 'etap', String(process.pid));
  assert.strictEqual(ikinci.status, 3);
  assert.match(ikinci.stdout, /KILIT_MESGUL pid=111 damga=d1 kaynak=mac/);
  kilitKos(ev, 'birak', 'd2');
  assert.ok(fs.existsSync(path.join(ev, '.kabul.lock')), 'başkasının damgasıyla bırakılamaz');
  kilitKos(ev, 'birak', 'd1');
  assert.strictEqual(kilitKos(ev, 'al', 'd2', 'x', '1').status, 0);
});

test('kilit: aynı makinede sahibi ölü ise bayat sayılır, kenara alınır (silinmez)', () => {
  const { ev } = evKur([]);
  const host = execFileSync('hostname', { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(ev, '.kabul.lock'), `pid=999999 damga=eski kaynak=${host} zaman=1\n`);
  const r = kilitKos(ev, 'al', 'yeni', host, String(process.pid));
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /BAYAT KILIT kenara alindi \(sahibi pid 999999 olu\)/);
  assert.ok(fs.readdirSync(ev).some((f) => f.startsWith('.kabul.lock.kaldirildi-')));
});

test('kilit: uzak sahipli taze kilit pid kontrolüyle BOZULMAZ; yaş sınırı aşılınca bozulur', () => {
  const { ev } = evKur([]);
  fs.writeFileSync(path.join(ev, '.kabul.lock'), 'pid=999999 damga=uzak kaynak=baska-mac zaman=1\n');
  assert.strictEqual(kilitKos(ev, 'al', 'yerel', 'etap', '1').status, 3);
  const eski = new Date(Date.now() - 61 * 60 * 1000);
  fs.utimesSync(path.join(ev, '.kabul.lock'), eski, eski);
  const r = kilitKos(ev, 'al', 'yerel', 'etap', '1');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /60 dk'dan eski/);
});
