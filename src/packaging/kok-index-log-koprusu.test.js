'use strict';

/**
 * KÖK INDEX DENETİMİ — agent.log KÖPRÜSÜ (2026-09-26, B açığı).
 * bkz. `~/.empp-agent/arastirma/set-koku-ezilmis-kok-neden-20260926.md` "packager.log
 * her başlatmada siliniyor" bölümü.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { ozetSatiriKur, pardusLogundanCikar, KOK_INDEX_LOG_DESENI } = require('./kok-index-log-koprusu');

// ---------------------------------------------------------------------------
// ozetSatiriKur — HTTP paketleyici (mac/android/windows) yolu
// ---------------------------------------------------------------------------

test('ozetSatiriKur: kitap, platform, sonuç ve fark özetini TEK satırda birleştirir', () => {
  const satir = ozetSatiriKur({
    bookId: 11845, platform: 'mac', mod: 'uyar', sonuc: 'ezilmis', detay: 'kök değişmiş',
  });
  assert.match(satir, /🔍 Kök index denetimi \(uyar\): ezilmis — kök değişmiş/);
  assert.match(satir, /kitap 11845/);
  assert.match(satir, /platform mac/);
});

test('ozetSatiriKur: mod veya sonuc eksikse null döner (basılacak bir şey yok)', () => {
  assert.strictEqual(ozetSatiriKur({ bookId: 1, platform: 'mac' }), null);
  assert.strictEqual(ozetSatiriKur(), null);
});

test('ozetSatiriKur: bookId/platform eksikse "?" ile doldurur, fırlatmaz', () => {
  const satir = ozetSatiriKur({ mod: 'uyar', sonuc: 'sadik', detay: 'aynı' });
  assert.match(satir, /kitap \?, platform \?/);
});

test('ozetSatiriKur: detay yoksa "-" ile doldurur', () => {
  const satir = ozetSatiriKur({ bookId: 1, platform: 'android', mod: 'uyar', sonuc: 'sadik' });
  assert.match(satir, /sadik — -/);
});

// ---------------------------------------------------------------------------
// pardusLogundanCikar — Docker konteynerinin stdout'u (packager.log) yolu
// ---------------------------------------------------------------------------

test('pardusLogundanCikar: packager.log içindeki tek satırı çıkarır (gürültü arasından)', () => {
  const log = [
    '[10:31:02] arch=x86_64 node=v20.11.0 npm=10.2.4',
    '🔍 Kök index denetimi (uyar): sadik — kök index, enjekte edilen script satırları dışında kaynakla birebir aynı',
    '[10:31:05] paketleyici rc=0 sure=180s',
  ].join('\n');
  const satir = pardusLogundanCikar(log);
  assert.match(satir, /^🔍 Kök index denetimi \(uyar\): sadik —/);
});

test('pardusLogundanCikar: satır yoksa (denetim kapalıysa) null döner', () => {
  assert.strictEqual(pardusLogundanCikar('arch=x86_64\npaketleyici rc=0\n'), null);
});

test('pardusLogundanCikar: boş/tanımsız metin için null döner (fırlatmaz)', () => {
  assert.strictEqual(pardusLogundanCikar(''), null);
  assert.strictEqual(pardusLogundanCikar(null), null);
  assert.strictEqual(pardusLogundanCikar(undefined), null);
});

test('pardusLogundanCikar: birden çok satır varsa İLKİNİ alır (m bayrağı — satır başına)', () => {
  const log = '🔍 Kök index denetimi (uyar): sadik — ilk\n'
    + '🔍 Kök index denetimi (uyar): ezilmis — ikinci (olmamalı, ama regex ilkini yakalar)';
  const satir = pardusLogundanCikar(log);
  assert.match(satir, /ilk$/);
});

test('KOK_INDEX_LOG_DESENI: emoji önekiyle başlamayan satırları yakalamaz', () => {
  assert.strictEqual(KOK_INDEX_LOG_DESENI.test('Kök index denetimi (uyar): sadik'), false);
});
