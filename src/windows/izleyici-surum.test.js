'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const m = require('./izleyici-surum.js');

const SIMDI = 1_800_000_000_000; // sabit referans zaman (vm-kapi-karar.test.js ile aynı üslup)

// bb53314-BENZERİ sahte içerik (2026-09-21 ölçülen kusuru taklit eder — GERÇEK
// dosya elde değil, yalnız ölçülmüş belirtiler modellenmiştir: kalp SENKRON,
// `& cmd /c $g.komut` 146. satırda, üç HEAD çapasının HİÇBİRİ yok).
const ESKI_BENZERI = `
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

const HEAD_YOLU = path.join(__dirname, '..', '..', 'tools', 'windows', 'vm-izleyici.ps1');
const HEAD_ICERIK = fs.readFileSync(HEAD_YOLU, 'utf8');

// --- surumTespit ---

test('SENTINEL: gerçek HEAD scripti guncel döner — çapalar çürürse bu test kırılır', () => {
  const r = m.surumTespit(HEAD_ICERIK);
  assert.strictEqual(r.surum, 'guncel');
  assert.deepStrictEqual(r.eksikYetenekler, []);
});

test('bb53314-benzeri eski içerik → eski + üç yetenek de eksik listelenir', () => {
  const r = m.surumTespit(ESKI_BENZERI);
  assert.strictEqual(r.surum, 'eski');
  assert.strictEqual(r.eksikYetenekler.length, 3);
  assert.ok(r.eksikYetenekler.includes('arka-plan-kalp'));
  assert.ok(r.eksikYetenekler.includes('makine-parametresi'));
  assert.ok(r.eksikYetenekler.includes('dogrudan-url'));
});

test('boş içerik → bilinmiyor (dosya okunamamış olabilir, şüphede eski say)', () => {
  const r = m.surumTespit('');
  assert.strictEqual(r.surum, 'bilinmiyor');
  assert.strictEqual(r.eksikYetenekler.length, 3);
});

test('null/undefined/sayı içerik → bilinmiyor, TİP hatası fırlatmaz', () => {
  assert.strictEqual(m.surumTespit(null).surum, 'bilinmiyor');
  assert.strictEqual(m.surumTespit(undefined).surum, 'bilinmiyor');
  assert.strictEqual(m.surumTespit(42).surum, 'bilinmiyor');
  assert.strictEqual(m.surumTespit('   ').surum, 'bilinmiyor'); // yalnız boşluk
});

test('üç çapadan yalnız BİRİ varsa yine ESKİ sayılır (yarım yükseltme kabul edilmez)', () => {
  const sadeceKalp = ESKI_BENZERI + "\nStart-Job -Name 'vm-kalp' -ScriptBlock {}\n";
  const r1 = m.surumTespit(sadeceKalp);
  assert.strictEqual(r1.surum, 'eski');
  assert.deepStrictEqual(r1.eksikYetenekler.sort(), ['dogrudan-url', 'makine-parametresi']);

  const sadeceMakine = ESKI_BENZERI + "\n[string]$Makine = 'vm'\n";
  const r2 = m.surumTespit(sadeceMakine);
  assert.strictEqual(r2.surum, 'eski');
  assert.deepStrictEqual(r2.eksikYetenekler.sort(), ['arka-plan-kalp', 'dogrudan-url']);

  const sadeceUrl = ESKI_BENZERI + '\nfunction f([string]$dogrudanUrl) {}\n';
  const r3 = m.surumTespit(sadeceUrl);
  assert.strictEqual(r3.surum, 'eski');
  assert.deepStrictEqual(r3.eksikYetenekler.sort(), ['arka-plan-kalp', 'makine-parametresi']);
});

test('üç çapa da varsa (sıra/boşluk fark etmez) guncel sayılır', () => {
  const sahte = [
    'function f([string]$dogrudanUrl) {}',
    "[string]$Makine = 'vm'",
    "Start-Job -Name 'vm-kalp' -ScriptBlock {}",
  ].join('\n\n# ara satır\n\n');
  const r = m.surumTespit(sahte);
  assert.strictEqual(r.surum, 'guncel');
  assert.deepStrictEqual(r.eksikYetenekler, []);
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

test('HEAD içerik + taze kalp → yükseltme GEREKMEZ, sebep yok', () => {
  const kalp = new Date(SIMDI - 5000).toISOString();
  const r = m.yukseltmeGerekliMi(HEAD_ICERIK, kalp, SIMDI);
  assert.strictEqual(r.gerekli, false);
  assert.deepStrictEqual(r.sebepler, []);
});

test('eski içerik + taze kalp → yükseltme GEREKİR, sebep eksik yetenekleri söyler', () => {
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

test('boş içerik (bilinmiyor) → yükseltme GEREKİR, şüphede güvenli tarafta kal', () => {
  const kalp = new Date(SIMDI - 5000).toISOString();
  const r = m.yukseltmeGerekliMi('', kalp, SIMDI);
  assert.strictEqual(r.gerekli, true);
  assert.match(r.sebepler[0], /belirlenemedi/);
});

test('HEAD içerik + BAYAT kalp → yükseltme GEREKMEZ (ayrı arıza, sürüm meselesi değil)', () => {
  const bayatKalp = new Date(SIMDI - 999_000).toISOString();
  const r = m.yukseltmeGerekliMi(HEAD_ICERIK, bayatKalp, SIMDI);
  assert.strictEqual(r.gerekli, false);
  assert.deepStrictEqual(r.sebepler, []);
});

// --- SURUM_ISARETI ihracatı ---

test('SURUM_ISARETI üç ayrı çapa içerir, her biri benzersiz', () => {
  assert.strictEqual(m.SURUM_ISARETI.length, 3);
  const capalar = m.SURUM_ISARETI.map((s) => s.capa);
  assert.strictEqual(new Set(capalar).size, 3);
  for (const s of m.SURUM_ISARETI) {
    assert.ok(s.anahtar && s.capa && s.aciklama, JSON.stringify(s));
  }
});
