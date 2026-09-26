'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const m = require('./izleyici-surum.js');

const SIMDI = 1_800_000_000_000; // sabit referans zaman (vm-kapi-karar.test.js ile aynı üslup)
const DEPO_KOK = path.join(__dirname, '..', '..');

// bb53314-BENZERİ sahte içerik (2026-09-21 ölçülen kusuru taklit eder — ÇOK ESKİ
// sürümün belirtilerini modeller: kalp SENKRON, `& cmd /c $g.komut` zaman aşımısız).
// Bu UYDURMA bir örnektir ve YALNIZCA "hiçbir çapası olmayan içerik" davranışını
// sınamak için durur. Asıl gerileme kapısı aşağıdaki GERÇEK 041bee8 metnidir.
const ESKI_BENZERI = `
# VM İZLEYİCİ — sahte/kısaltılmış kopya
param([string]$Adres, [string]$Belirtec, [string]$Kok)
$Kok = Split-Path -Parent $MyInvocation.MyCommand.Path
while ($true) {
  (Get-Date).ToUniversalTime().ToString('o') | Set-Content -Path (Join-Path $Kok 'kalp.txt')
  $g = Gorev-Al
  if ($g) {
    switch ($g.tur) {
      'komut' {
        $r = & cmd /c $g.komut 2>&1
        $cikis = $LASTEXITCODE
      }
    }
  }
  Start-Sleep -Seconds 5
}
`;

// Çalışma ağacındaki CANLI script — "yeni sürüm" tarafı.
const CALISAN_YOLU = path.join(DEPO_KOK, 'tools', 'windows', 'vm-izleyici.ps1');
const CALISAN_ICERIK = fs.readFileSync(CALISAN_YOLU, 'utf8');

// GERÇEK ESKİ METİN — 041bee8 commit'inin bayt-birebir kopyası (uydurma fixture
// DEĞİL; `git show 041bee8:tools/windows/vm-izleyici.ps1` çıktısı dondurulmuştur).
// 2026-09-21 arızasında guest'te koşan aileye ait son commit'li sürüm budur:
// komut zaman aşımı YOK, süreç ağacı öldürme YOK, döngü damgası YOK.
const ESKI_YOLU = path.join(__dirname, 'gecmis-surumler', 'vm-izleyici-041bee8.ps1');
const ESKI_GERCEK = fs.readFileSync(ESKI_YOLU, 'utf8');

const ozet = (s) => crypto.createHash('sha256').update(s).digest('hex');

// --- surumTespit: sürüm ayırt etme ---

test('SENTINEL: çalışma ağacındaki gerçek script guncel döner — çapalar çürürse bu test kırılır', () => {
  const r = m.surumTespit(CALISAN_ICERIK);
  assert.strictEqual(r.surum, 'guncel');
  assert.deepStrictEqual(r.eksikYetenekler, []);
  assert.strictEqual(r.belirsizlikSebebi, null);
});

test('GERİLEME: GERÇEK eski sürüm (041bee8) ASLA "guncel" DEMEZ — 2026-09-21 körlüğü', () => {
  // ÖLÇÜLMÜŞ KUSUR: eski üç çapa (arka-plan-kalp / makine-parametresi / dogrudan-url)
  // 041bee8'te de VARDI. Modül bu yüzden, ağ sürücüsünde 16+ dk asılan ve o gün
  // üretim hattını 50+ dk kilitleyen sürüme "guncel" diyordu. Bu test o yalanı çivi
  // ile tutar: karar ne olursa olsun 'guncel' OLAMAZ.
  const r = m.surumTespit(ESKI_GERCEK);
  assert.notStrictEqual(r.surum, 'guncel');
  assert.strictEqual(r.surum, 'eski');
  // Eksik olanlar TAM OLARAK bugünkü yükseltmenin üç yeteneğidir.
  assert.deepStrictEqual(
    r.eksikYetenekler.slice().sort(),
    ['dongu-damgasi', 'komut-zaman-asimi', 'surec-agaci-oldur']
  );
});

test('ÖLÇÜM ÇİVİSİ: yeni üç çapanın HİÇBİRİ gerçek eski metinde geçmez, üçü de yenisinde geçer', () => {
  // Çapa seçimi tahmin değil ölçümdür — seçim bozulursa (biri eski sürümde de
  // bulunan genel bir ifadeye çevrilirse) burada patlar.
  const yeniler = ['komut-zaman-asimi', 'surec-agaci-oldur', 'dongu-damgasi'];
  for (const anahtar of yeniler) {
    const isaret = m.SURUM_ISARETI.find((s) => s.anahtar === anahtar);
    assert.ok(isaret, `çapa kayıp: ${anahtar}`);
    assert.ok(!ESKI_GERCEK.includes(isaret.capa), `${anahtar}: ESKİ sürümde de var — ayırt etmiyor`);
    assert.ok(CALISAN_ICERIK.includes(isaret.capa), `${anahtar}: YENİ sürümde yok — çapa çürümüş`);
  }
});

test('KAYNAK ÇİVİSİ: donmuş eski metin git\'teki 041bee8 ile bayt-birebir aynı', (t) => {
  // Fixture "gerçek eski metin" iddiasını taşıyor; iddia doğrulanabilir olmalı.
  // git yoksa (tarball/export) ölçemeyiz — sessiz yeşil yerine AÇIK skip.
  let gitten;
  try {
    gitten = execFileSync('git', ['show', '041bee8:tools/windows/vm-izleyici.ps1'], {
      cwd: DEPO_KOK,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    t.skip('git veya 041bee8 commit\'i erişilebilir değil — köken doğrulanamadı');
    return;
  }
  assert.strictEqual(ozet(ESKI_GERCEK), ozet(gitten));
});

test('eski üç çapa gerçek eski metinde HÂLÂ var — kusur "çapa yok" değil "çapa ayırt etmiyor"du', () => {
  for (const anahtar of ['arka-plan-kalp', 'makine-parametresi', 'dogrudan-url']) {
    const isaret = m.SURUM_ISARETI.find((s) => s.anahtar === anahtar);
    assert.ok(ESKI_GERCEK.includes(isaret.capa), `${anahtar} eski metinde bulunmalıydı`);
  }
});

test('hiç çapası olmayan çok eski içerik → eski + ALTI yetenek de eksik listelenir', () => {
  const r = m.surumTespit(ESKI_BENZERI);
  assert.strictEqual(r.surum, 'eski');
  assert.strictEqual(r.eksikYetenekler.length, 6);
  for (const a of ['arka-plan-kalp', 'makine-parametresi', 'dogrudan-url',
    'komut-zaman-asimi', 'surec-agaci-oldur', 'dongu-damgasi']) {
    assert.ok(r.eksikYetenekler.includes(a), `eksik listesinde yok: ${a}`);
  }
});

test('KISMİ yükseltme (altıdan beşi) → guncel DEĞİL', () => {
  // Gerçek eski metne bugünkü yeteneklerden İKİSİ eklenmiş, biri (döngü damgası)
  // eksik bırakılmış: yarım yükseltme "güncel" sayılmaz.
  const yarim = ESKI_GERCEK
    + '\nfunction Surec-Agaci-Oldur([int]$sid) { }\n'
    + '\nif ($g.zamanAsimiSn) { }\n';
  const r = m.surumTespit(yarim);
  assert.notStrictEqual(r.surum, 'guncel');
  assert.strictEqual(r.surum, 'eski');
  assert.deepStrictEqual(r.eksikYetenekler, ['dongu-damgasi']);
});

test('altı çapa da varsa (sıra/boşluk fark etmez) guncel sayılır', () => {
  const sahte = [
    '# VM İZLEYİCİ — sıra karışık sentetik kopya',
    'function f([string]$dogrudanUrl) {}',
    "[string]$Makine = 'vm'",
    "Start-Job -Name 'vm-kalp' -ScriptBlock {}",
    'sonDonguDamgasi = 1',
    'function Surec-Agaci-Oldur([int]$sid) {}',
    'zamanAsimiSn',
  ].join('\n\n# ara satır\n\n');
  const r = m.surumTespit(sahte);
  assert.strictEqual(r.surum, 'guncel');
  assert.deepStrictEqual(r.eksikYetenekler, []);
});

// --- surumTespit: "bilmiyorum" ile "güncel"in ayrılması ---

test('boş içerik → bilinmiyor/icerik-yok (guncel DEĞİL — dosya okunamamış olabilir)', () => {
  const r = m.surumTespit('');
  assert.strictEqual(r.surum, 'bilinmiyor');
  assert.notStrictEqual(r.surum, 'guncel');
  assert.strictEqual(r.belirsizlikSebebi, 'icerik-yok');
  assert.strictEqual(r.eksikYetenekler.length, 6);
});

test('null/undefined/sayı/whitespace içerik → bilinmiyor, TİP hatası fırlatmaz', () => {
  assert.strictEqual(m.surumTespit(null).surum, 'bilinmiyor');
  assert.strictEqual(m.surumTespit(undefined).surum, 'bilinmiyor');
  assert.strictEqual(m.surumTespit(42).surum, 'bilinmiyor');
  assert.strictEqual(m.surumTespit('   ').surum, 'bilinmiyor'); // yalnız boşluk
  assert.strictEqual(m.surumTespit(null).belirsizlikSebebi, 'icerik-yok');
});

test('BEKLENMEDİK metin (izleyici scripti değil) → bilinmiyor, "eski" DEĞİL', () => {
  // Yanlış yol, kısmi okuma, HTTP hata gövdesi... "eski" demek ÖLÇTÜM demektir;
  // burada ölçemedik. Bu deponun tekrarlayan hata sınıfının aynadaki yüzü.
  for (const metin of ['merhaba dünya', '<html><body>404 Not Found</body></html>', '{"hata":"yetkisiz"}']) {
    const r = m.surumTespit(metin);
    assert.strictEqual(r.surum, 'bilinmiyor', metin);
    assert.strictEqual(r.belirsizlikSebebi, 'kimlik-eslesmedi', metin);
  }
});

test('çapaların HEPSİ tesadüfen geçse bile KİMLİK yoksa guncel DENMEZ', () => {
  const kimliksiz = m.SURUM_ISARETI.map((s) => s.capa).join('\n');
  const r = m.surumTespit(kimliksiz);
  assert.notStrictEqual(r.surum, 'guncel');
  assert.strictEqual(r.surum, 'bilinmiyor');
  assert.strictEqual(r.belirsizlikSebebi, 'kimlik-eslesmedi');
});

test('KİMLİK ÇİVİSİ: her kimlik işareti gerçek metinlerde ölçüldü', () => {
  assert.ok(m.KIMLIK_ISARETI.length >= 1);
  for (const k of m.KIMLIK_ISARETI) {
    assert.ok(CALISAN_ICERIK.includes(k), `kimlik işareti yeni sürümde yok: ${k}`);
    assert.ok(ESKI_GERCEK.includes(k), `kimlik işareti eski sürümde yok: ${k}`);
  }
});

// --- kalpBayatMi ---

test('taze kalp (eşiğin çok altında) → BAYAT DEĞİL', () => {
  const kalp = new Date(SIMDI - 10_000).toISOString();
  assert.strictEqual(m.kalpBayatMi(kalp, SIMDI), false);
});

test('tam eşikte (180 sn) → BAYAT DEĞİL — sınır AYAKTA sayılır (vm-kapi-karar ile aynı üslup)', () => {
  const kalp = new Date(SIMDI - 180_000).toISOString();
  assert.strictEqual(m.kalpBayatMi(kalp, SIMDI, 180), false);
});

test('eşiği 1 sn aşınca → BAYAT', () => {
  const kalp = new Date(SIMDI - 181_000).toISOString();
  assert.strictEqual(m.kalpBayatMi(kalp, SIMDI, 180), true);
});

test('özel eşik verilirse ona göre karar verir', () => {
  const kalp = new Date(SIMDI - 50_000).toISOString();
  assert.strictEqual(m.kalpBayatMi(kalp, SIMDI, 30), true);
  assert.strictEqual(m.kalpBayatMi(kalp, SIMDI, 60), false);
});

test('boş/whitespace kalp içeriği → BAYAT (şüphede bayat say)', () => {
  assert.strictEqual(m.kalpBayatMi('', SIMDI), true);
  assert.strictEqual(m.kalpBayatMi('   ', SIMDI), true);
});

test('null/undefined kalp içeriği → BAYAT, TİP hatası fırlatmaz', () => {
  assert.strictEqual(m.kalpBayatMi(null, SIMDI), true);
  assert.strictEqual(m.kalpBayatMi(undefined, SIMDI), true);
});

test('bozuk/parse edilemeyen tarih metni → BAYAT', () => {
  assert.strictEqual(m.kalpBayatMi('bu-bir-tarih-degil', SIMDI), true);
  assert.strictEqual(m.kalpBayatMi('##%%??', SIMDI), true);
});

test('guest saati host\'tan ileri (negatif yaş) → BAYAT DENMEZ, ölçülemez ama taze sayılır', () => {
  const ileriKalp = new Date(SIMDI + 60_000).toISOString();
  assert.strictEqual(m.kalpBayatMi(ileriKalp, SIMDI), false);
});

test('`simdi` sayı değilse → BAYAT (şüphede bayat say)', () => {
  const kalp = new Date(SIMDI - 1000).toISOString();
  assert.strictEqual(m.kalpBayatMi(kalp, NaN), true);
  assert.strictEqual(m.kalpBayatMi(kalp, 'simdi'), true);
});

// --- yukseltmeGerekliMi ---

test('çalışan (yeni) içerik + taze kalp → yükseltme GEREKMEZ, sebep yok', () => {
  const kalp = new Date(SIMDI - 5000).toISOString();
  const r = m.yukseltmeGerekliMi(CALISAN_ICERIK, kalp, SIMDI);
  assert.strictEqual(r.gerekli, false);
  assert.deepStrictEqual(r.sebepler, []);
});

test('GERİLEME: GERÇEK eski sürüm + taze kalp → yükseltme GEREKİR', () => {
  // Kalp taze olduğu için eski modül "her şey yolunda" derdi; asıl kusur sürümde.
  const kalp = new Date(SIMDI - 5000).toISOString();
  const r = m.yukseltmeGerekliMi(ESKI_GERCEK, kalp, SIMDI);
  assert.strictEqual(r.gerekli, true);
  assert.match(r.sebepler[0], /ESKİ sürüm/);
  assert.match(r.sebepler[0], /komut-zaman-asimi/);
});

test('hiç çapası olmayan içerik + taze kalp → GEREKİR, sebep eksik yetenekleri söyler', () => {
  const kalp = new Date(SIMDI - 5000).toISOString();
  const r = m.yukseltmeGerekliMi(ESKI_BENZERI, kalp, SIMDI);
  assert.strictEqual(r.gerekli, true);
  assert.strictEqual(r.sebepler.length, 1);
  assert.match(r.sebepler[0], /ESKİ sürüm/);
  assert.match(r.sebepler[0], /arka-plan-kalp/);
});

test('eski içerik + bayat kalp → iki sebep birden (sürüm + bilinen belirti)', () => {
  const bayatKalp = new Date(SIMDI - 999_000).toISOString();
  const r = m.yukseltmeGerekliMi(ESKI_BENZERI, bayatKalp, SIMDI);
  assert.strictEqual(r.gerekli, true);
  assert.strictEqual(r.sebepler.length, 2);
  assert.match(r.sebepler[1], /bilinen belirtisi/);
});

test('boş içerik (bilinmiyor) → GEREKİR; sebep "okunamadı" der', () => {
  const kalp = new Date(SIMDI - 5000).toISOString();
  const r = m.yukseltmeGerekliMi('', kalp, SIMDI);
  assert.strictEqual(r.gerekli, true);
  assert.match(r.sebepler[0], /belirlenemedi/);
  assert.match(r.sebepler[0], /okunamadı/);
});

test('beklenmedik metin (bilinmiyor) → GEREKİR; sebep "izleyici scripti DEĞİL" der', () => {
  const kalp = new Date(SIMDI - 5000).toISOString();
  const r = m.yukseltmeGerekliMi('<html>404</html>', kalp, SIMDI);
  assert.strictEqual(r.gerekli, true);
  assert.match(r.sebepler[0], /belirlenemedi/);
  assert.match(r.sebepler[0], /izleyici scripti DEĞİL/);
});

test('çalışan (yeni) içerik + BAYAT kalp → yükseltme GEREKMEZ (ayrı arıza, sürüm meselesi değil)', () => {
  const bayatKalp = new Date(SIMDI - 999_000).toISOString();
  const r = m.yukseltmeGerekliMi(CALISAN_ICERIK, bayatKalp, SIMDI);
  assert.strictEqual(r.gerekli, false);
  assert.deepStrictEqual(r.sebepler, []);
});

// --- SURUM_ISARETI ihracatı ---

test('SURUM_ISARETI ALTI ayrı çapa içerir, her biri benzersiz', () => {
  // SAYI NEDEN 3 DEĞİL 6 (2026-09-21): ilk küme üç çapaydı ve üçü de 041bee8'te
  // mevcuttu — yani zaman aşımı/süreç ağacı/döngü damgası yükseltmesini HİÇ
  // ayırt etmiyordu, eski sürüme "guncel" diyordu. Üç yeni çapa eklendi.
  // Bu çivi kasten durur: sessizce çapa düşürülmesini (ya da geri 3'e dönülmesini)
  // yakalar. Sayıyı değiştiren, ÜSTTEKİ gerekçeyi de yazmak zorundadır.
  assert.strictEqual(m.SURUM_ISARETI.length, 6);
  const capalar = m.SURUM_ISARETI.map((s) => s.capa);
  assert.strictEqual(new Set(capalar).size, 6);
  const anahtarlar = m.SURUM_ISARETI.map((s) => s.anahtar);
  assert.strictEqual(new Set(anahtarlar).size, 6);
  for (const s of m.SURUM_ISARETI) {
    assert.ok(s.anahtar && s.capa && s.aciklama && s.eklendi, JSON.stringify(s));
  }
});
