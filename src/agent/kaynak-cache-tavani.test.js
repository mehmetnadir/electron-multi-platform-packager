'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { kaynakCacheTavaniGb } = require('./runner-helpers');

// ---------------------------------------------------------------------------
// kaynakCacheTavaniGb — kaynak cache TAVANI artık düz sabit DEĞİL, cache'teki
// EN BÜYÜK tek girdiye ORANTILI (aynı desen: pardusGerekliDiskGb, 2026-09-19).
//
// Ölçüm (agent.log 2026-09-21 07:25:16): SM4 kaynağı v49→v50 arasında 14 MB'tan
// 1451 MB'a çıktı (~100×), TEK BAŞINA eski 2 GB tavanın %72'sini yiyordu.
// SM4-v50 girdisi başarısız bir denemeden 12 dk sonra tahliye edildi, yeniden
// deneme 1,45 GB'ı baştan indirmek zorunda kaldı.
// ---------------------------------------------------------------------------

test('GERİLEME: tavan düz sabit DEĞİL — büyük girdi küçükten fazlasını ister', () => {
  const kucuk = kaynakCacheTavaniGb({ enBuyukGirdiBayt: 200e6, tabanGb: 1 });
  const buyuk = kaynakCacheTavaniGb({ enBuyukGirdiBayt: 1451e6, tabanGb: 1 });
  assert.ok(buyuk > kucuk, `orantı yok: ${kucuk} vs ${buyuk}`);
});

test('orantılı terim enBuyukGirdiBayt × kat (taban devre dışıyken)', () => {
  assert.strictEqual(kaynakCacheTavaniGb({ enBuyukGirdiBayt: 4e9, kat: 3, tabanGb: 1 }), 12);
});

test('kat ayarlanabilir', () => {
  assert.strictEqual(kaynakCacheTavaniGb({ enBuyukGirdiBayt: 4e9, kat: 5, tabanGb: 1 }), 20);
});

test('küsurat YUKARI yuvarlanır — aşağı yuvarlamak tavanı sessizce gevşetir', () => {
  // 1,451 GB × 3 = 4,353 -> 5 olmalı, 4 değil.
  assert.strictEqual(kaynakCacheTavaniGb({ enBuyukGirdiBayt: 1451e6, kat: 3, tabanGb: 1 }), 5);
});

test('taban orantılı terimden büyükse taban kazanır', () => {
  assert.strictEqual(kaynakCacheTavaniGb({ enBuyukGirdiBayt: 111e6, tabanGb: 15 }), 15);
});

test('varsayılan taban 5 GB', () => {
  assert.strictEqual(kaynakCacheTavaniGb({ enBuyukGirdiBayt: 111e6 }), 5);
});

test('en büyük girdi ölçülemediyse (null/undefined/NaN/string) taban uygulanır, tahmin ÜRETİLMEZ', () => {
  for (const v of [null, undefined, NaN, 'abc']) {
    assert.strictEqual(kaynakCacheTavaniGb({ enBuyukGirdiBayt: v, tabanGb: 5 }), 5, `değer: ${v}`);
  }
});

test('sıfır/negatif girdi ayrıca elenmez — orantılı terim tabanın altına düşer, taban kazanır', () => {
  assert.strictEqual(kaynakCacheTavaniGb({ enBuyukGirdiBayt: 0, tabanGb: 5 }), 5);
  assert.strictEqual(kaynakCacheTavaniGb({ enBuyukGirdiBayt: -1e9, tabanGb: 5 }), 5);
});

test('açık override her şeyi ezer — orantılıdan KÜÇÜK olsa bile', () => {
  assert.strictEqual(kaynakCacheTavaniGb({ enBuyukGirdiBayt: 10e9, tabanGb: 5, elleGb: 2 }), 2);
});

test('açık override orantılıdan büyükse de geçerli (eski 35 davranışı korunabilir)', () => {
  assert.strictEqual(kaynakCacheTavaniGb({ enBuyukGirdiBayt: 111e6, elleGb: 35 }), 35);
});

test('geçersiz override yok sayılır, normal hesaba düşülür', () => {
  for (const v of [0, -5, NaN, null]) {
    assert.strictEqual(kaynakCacheTavaniGb({ enBuyukGirdiBayt: 111e6, tabanGb: 5, elleGb: v }), 5, `değer: ${v}`);
  }
});

test('bozuk taban güvenli varsayılana (5) düşer', () => {
  assert.strictEqual(kaynakCacheTavaniGb({ enBuyukGirdiBayt: 1e6, tabanGb: 0 }), 5);
  assert.strictEqual(kaynakCacheTavaniGb({ enBuyukGirdiBayt: 1e6, tabanGb: -3 }), 5);
});

test('argümansız çağrı çökmez', () => {
  assert.strictEqual(kaynakCacheTavaniGb(), 5);
});

// ---------------------------------------------------------------------------
// Üst sınır — disk emniyeti. "İçerik büyüdü, tavanı da büyüt" mantığı diski
// dolduracak kadar ileri gitmez: disk dolması üretimi durdurur, bu cache'in
// erken tahliyesinden DAHA KÖTÜdür.
// ---------------------------------------------------------------------------

test('GERİLEME: boş disk azsa tavan onu aşmaz — orantılı terim büyük olsa bile', () => {
  // Orantılı terim 30 GB ister ama diskte 4 GB boş var, pay 0.5 -> üst sınır 2 GB.
  const tavan = kaynakCacheTavaniGb({ enBuyukGirdiBayt: 10e9, kat: 3, tabanGb: 5, bosGb: 4, ustSinirPayi: 0.5 });
  assert.ok(tavan <= 2, `üst sınır aşıldı: ${tavan}`);
});

test('boş disk ölçülemezse (null) üst sınır uygulanmaz — sadece orantılı/taban geçerli', () => {
  assert.strictEqual(kaynakCacheTavaniGb({ enBuyukGirdiBayt: 4e9, kat: 3, tabanGb: 1, bosGb: null }), 12);
});

test('ustSinirPayi ayarlanabilir', () => {
  const dar = kaynakCacheTavaniGb({ enBuyukGirdiBayt: 4e9, kat: 3, tabanGb: 1, bosGb: 100, ustSinirPayi: 0.1 });
  const genis = kaynakCacheTavaniGb({ enBuyukGirdiBayt: 4e9, kat: 3, tabanGb: 1, bosGb: 100, ustSinirPayi: 0.9 });
  assert.ok(dar < genis, `pay etkisi yok: ${dar} vs ${genis}`);
});

test('bozuk ustSinirPayi güvenli varsayılana (0.5) düşer', () => {
  const varsayilan = kaynakCacheTavaniGb({ enBuyukGirdiBayt: 4e9, kat: 3, tabanGb: 1, bosGb: 100 });
  for (const v of [0, -1, NaN]) {
    assert.strictEqual(
      kaynakCacheTavaniGb({ enBuyukGirdiBayt: 4e9, kat: 3, tabanGb: 1, bosGb: 100, ustSinirPayi: v }),
      varsayilan,
      `pay: ${v}`,
    );
  }
});

test('disk tamamen doluysa (bosGb=0) tavan sıfıra iner — korunmayan girdiler tahliyeye açılır', () => {
  assert.strictEqual(kaynakCacheTavaniGb({ enBuyukGirdiBayt: 4e9, kat: 3, tabanGb: 5, bosGb: 0 }), 0);
});

test('açık override, dar disk üst sınırını da ezer', () => {
  assert.strictEqual(
    kaynakCacheTavaniGb({ enBuyukGirdiBayt: 10e9, tabanGb: 5, bosGb: 1, ustSinirPayi: 0.5, elleGb: 35 }),
    35,
  );
});

test('bol boş diskte (142 GB gibi) üst sınır orantılı terimi ETKİLEMEZ — bugünkü ortam', () => {
  // SM4-v50 (1451 MB) × kat 3 = ~5 GB; 142 GB'ın %50'si (71 GB) çok üstünde.
  assert.strictEqual(kaynakCacheTavaniGb({ enBuyukGirdiBayt: 1451e6, kat: 3, tabanGb: 5, bosGb: 142 }), 5);
});
