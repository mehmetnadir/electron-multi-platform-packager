'use strict';
/**
 * kabul-karar.sh — son karar matrisi (GEÇTİ 0 · RED-KUSUR 1 · RED-GÜNCEL-DEĞİL 3 · ÖLÇÜLEMEDİ 4).
 * Betik gerçekten `source` edilip koşturulur (bash). Bayraklar kapalıyken bugünkü kapı AYNEN.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const KARAR = path.join(__dirname, 'kabul-karar.sh');

function karar(env) {
  const r = spawnSync('bash', ['-c', `. "${KARAR}"; kabul_karar; printf '%s|%s|%s|%s' "$KARAR_KOD" "$KARAR" "$KARAR_SEBEP" "$KARAR_NOT"`], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ...env },
  });
  assert.equal(r.status, 0, r.stderr);
  const [kod, ad, sebep, not] = r.stdout.split('|');
  return { kod: Number(kod), ad, sebep, not };
}

test('bayraklar kapali (CDP yok, aktivasyon yok) → GECTI, bugunku kapi', () => {
  const k = karar({});
  assert.equal(k.kod, 0);
  assert.equal(k.ad, 'GECTI');
});

test('E7 DOLU → RED-GUNCEL-DEGIL (3); E6 RED olsa da oncelik gunceldir (motor guncellemeyi indirmeye kalkar)', () => {
  const k = karar({ CDP: '1', E6: 'RED', E6_SEBEP: 'hâlâ yükleniyor', E7: 'DOLU', E7_AYRINTI: '44187 v33 < İmpark v36' });
  assert.equal(k.kod, 3);
  assert.equal(k.ad, 'RED-GUNCEL-DEGIL');
  assert.match(k.sebep, /^E7 44187 v33 < İmpark v36/);
  assert.match(k.not, /E6=RED/);
  assert.equal(karar({ CDP: '1', E6: 'GECTI', E7: 'DOLU' }).kod, 3);
});

test('aktivasyon ekrani: bayrak kapali → GECTI "ICERIK dogrulanmadi"; KABUL_AKTIVASYON_OLCULEMEDI=1 → 4', () => {
  const k0 = karar({ AKT_EKRAN: '1', AKT_SERI: '1', AKT_OLC: '0' });
  assert.equal(k0.kod, 0);
  assert.match(k0.sebep, /ICERIK dogrulanmadi/);
  const k1 = karar({ AKT_EKRAN: '1', AKT_SERI: '1', AKT_OLC: '1' });
  assert.equal(k1.kod, 4);
  assert.equal(k1.ad, 'OLCULEMEDI');
  assert.match(k1.sebep, /KABUL_AKTIVASYON_OLCULEMEDI=1/);
  // CDP açıkken de aynı (E6/E7 aktivasyon ekranında koşmaz).
  assert.equal(karar({ CDP: '1', E6: 'ATLANDI', E7: 'ATLANDI', AKT_EKRAN: '1', AKT_OLC: '1' }).kod, 4);
});

test('CDP acik: E6 GECTI → 0 (E7 BOS/YOK/OLCULEMEDI karari degistirmez)', () => {
  for (const e7 of ['BOS', 'YOK', 'OLCULEMEDI']) {
    assert.equal(karar({ CDP: '1', E6: 'GECTI', E7: e7 }).kod, 0, e7);
  }
});

test('CDP acik: E6 RED → 1 RED-KUSUR; E6 OLCULEMEDI / bos → 4', () => {
  const r = karar({ CDP: '1', E6: 'RED', E6_SEBEP: 'URL değişmedi', E7: 'YOK' });
  assert.equal(r.kod, 1);
  assert.equal(r.ad, 'RED-KUSUR');
  assert.match(r.sebep, /URL değişmedi/);
  assert.equal(karar({ CDP: '1', E6: 'OLCULEMEDI', E7: 'OLCULEMEDI' }).kod, 4);
  assert.equal(karar({ CDP: '1' }).kod, 4, 'E6 sonucu yoksa GEÇTİ sayılmaz');
});

test('aktivasyon kodlu seri, menu renkli ama kitap acilamadi: bayrak kapali GECTI, acik 4', () => {
  const k0 = karar({ CDP: '1', AKT_SERI: '1', E6: 'RED', E6_SEBEP: 'URL değişmedi' });
  assert.equal(k0.kod, 0);
  assert.match(k0.sebep, /aktivasyon kodlu seri.*ICERIK dogrulanmadi/);
  assert.equal(karar({ CDP: '1', AKT_SERI: '1', AKT_OLC: '1', E6: 'RED' }).kod, 4);
  assert.equal(karar({ CDP: '1', AKT_SERI: '1', AKT_OLC: '1', E6: 'GECTI' }).kod, 0, 'kitap açıldıysa aktivasyon serisi de GEÇER');
});
