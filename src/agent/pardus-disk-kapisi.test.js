'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  pardusGerekliDiskGb,
  ertelenebilirKaynakHatasi,
  DISK_KAPISI_ISARETI,
  isTransientNetworkError,
} = require('./runner-helpers');

// ---------------------------------------------------------------------------
// pardusGerekliDiskGb — kapı ARTIK sabit değil, kaynağın boyutundan türer.
// Ölçüm: 59834 zip 931 MB → açılmış 1085 MB (1,17×); tepe ≈ kaynak × 5.
// ---------------------------------------------------------------------------

test('GERİLEME: kapı düz sabit DEĞİL — büyük kaynak küçükten fazlasını ister', () => {
  const kucuk = pardusGerekliDiskGb({ kaynakBayt: 500e6, tabanGb: 1 });
  const buyuk = pardusGerekliDiskGb({ kaynakBayt: 5000e6, tabanGb: 1 });
  assert.ok(buyuk > kucuk, `orantı yok: ${kucuk} vs ${buyuk}`);
});

test('orantılı terim kaynak × kat (taban devre dışıyken)', () => {
  assert.strictEqual(pardusGerekliDiskGb({ kaynakBayt: 4e9, kat: 5, tabanGb: 1 }), 20);
});

test('kat ayarlanabilir', () => {
  assert.strictEqual(pardusGerekliDiskGb({ kaynakBayt: 4e9, kat: 3, tabanGb: 1 }), 12);
});

test('küsurat YUKARI yuvarlanır — aşağı yuvarlamak kapıyı sessizce gevşetir', () => {
  // 0,9 GB × 5 = 4,5 → 5 olmalı, 4 değil.
  assert.strictEqual(pardusGerekliDiskGb({ kaynakBayt: 0.9e9, kat: 5, tabanGb: 1 }), 5);
});

test('taban orantılı terimden büyükse taban kazanır (eşzamanlı işler payı)', () => {
  assert.strictEqual(pardusGerekliDiskGb({ kaynakBayt: 111e6, tabanGb: 15 }), 15);
});

test('varsayılan taban 15 GB — 2026-09-17 sessiz bozuk paket dersi', () => {
  assert.strictEqual(pardusGerekliDiskGb({ kaynakBayt: 111e6 }), 15);
});

test('kaynak ölçülemediyse taban uygulanır, tahmin ÜRETİLMEZ', () => {
  for (const v of [null, undefined, 0, -1, NaN, 'abc']) {
    assert.strictEqual(pardusGerekliDiskGb({ kaynakBayt: v, tabanGb: 15 }), 15, `değer: ${v}`);
  }
});

test('açık override her şeyi ezer — orantılıdan KÜÇÜK olsa bile', () => {
  assert.strictEqual(pardusGerekliDiskGb({ kaynakBayt: 10e9, tabanGb: 15, elleGb: 3 }), 3);
});

test('açık override orantılıdan büyükse de geçerli (eski 45 davranışı korunabilir)', () => {
  assert.strictEqual(pardusGerekliDiskGb({ kaynakBayt: 111e6, elleGb: 45 }), 45);
});

test('geçersiz override yok sayılır, normal hesaba düşülür', () => {
  for (const v of [0, -5, NaN, null]) {
    assert.strictEqual(pardusGerekliDiskGb({ kaynakBayt: 111e6, tabanGb: 15, elleGb: v }), 15, `değer: ${v}`);
  }
});

test('bozuk taban güvenli varsayılana düşer', () => {
  assert.strictEqual(pardusGerekliDiskGb({ kaynakBayt: 1e6, tabanGb: 0 }), 15);
  assert.strictEqual(pardusGerekliDiskGb({ kaynakBayt: 1e6, tabanGb: -3 }), 15);
});

test('argümansız çağrı çökmez', () => {
  assert.strictEqual(pardusGerekliDiskGb(), 15);
});

// ---------------------------------------------------------------------------
// ertelenebilirKaynakHatasi — disk darlığı PAKET KUSURU değildir.
// Bu ayrım olmadan satıra 'failed' yazılır ve panel "PARDUS HATALI" gösterir
// (2026-09-19: 8 iş böyle yanlış işaretlendi).
// ---------------------------------------------------------------------------

test('GERİLEME: disk kapısı hatası ertelenebilir sayılır', () => {
  const e = new Error(`${DISK_KAPISI_ISARETI} pardus disk kapısı — 3 GB boş < 15 GB gerekli`);
  assert.strictEqual(ertelenebilirKaynakHatasi(e), true);
});

test('düz metin hata da tanınır', () => {
  assert.strictEqual(ertelenebilirKaynakHatasi(`x ${DISK_KAPISI_ISARETI} y`), true);
});

test('GERİLEME: sıradan iş hatası ertelenebilir DEĞİL — yoksa gerçek kusur gizlenir', () => {
  assert.strictEqual(ertelenebilirKaynakHatasi(new Error('zenity gömülü değil')), false);
  assert.strictEqual(ertelenebilirKaynakHatasi('disk kapısı'), false); // işaretsiz metin yetmez
});

test('mesajsız/boş hatalar ertelenebilir SAYILMAZ (ağ sınıfından ayrı)', () => {
  for (const v of [null, undefined, '', {}, 0]) {
    assert.strictEqual(ertelenebilirKaynakHatasi(v), false, `değer: ${v}`);
  }
});

test('iki sınıf ayrıdır: ağ hatası disk değildir, disk hatası ağ değildir', () => {
  const ag = new Error('ECONNRESET');
  const disk = new Error(`${DISK_KAPISI_ISARETI} yer yok`);
  assert.strictEqual(ertelenebilirKaynakHatasi(ag), false);
  assert.strictEqual(isTransientNetworkError(disk), false);
});
