'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  birimAdi, birimYolu, serbestBirak, kapiyiUygula, KOK
} = require('./dmg-birim-kapisi');

function sahte({ bagli = [], ayrilabilir = [], zorlaAyrilabilir = [] } = {}) {
  const cagrilar = [];
  return {
    cagrilar,
    varMi: (yol) => bagli.includes(yol),
    ayir: (yol, zorla) => {
      cagrilar.push({ yol, zorla });
      if (!zorla) return ayrilabilir.includes(yol);
      return zorlaAyrilabilir.includes(yol);
    }
  };
}

test('birimAdi: dmg.title otoritedir', () => {
  assert.strictEqual(
    birimAdi({ productName: 'X', buildVersion: '9.9.9', dmg: { title: 'Lingoland Grade 2 1.0.0' } }),
    'Lingoland Grade 2 1.0.0'
  );
});

test('birimAdi: title yoksa productName + sürüm', () => {
  assert.strictEqual(birimAdi({ productName: 'Kitap', buildVersion: '1.0.0' }), 'Kitap 1.0.0');
  assert.strictEqual(birimAdi({ productName: 'Kitap', version: '2.0.0' }), 'Kitap 2.0.0');
  assert.strictEqual(birimAdi({ productName: 'Kitap' }), 'Kitap');
});

test('birimAdi: belirlenemezse null (kapı sessizce atlanır)', () => {
  assert.strictEqual(birimAdi(null), null);
  assert.strictEqual(birimAdi({}), null);
  assert.strictEqual(birimAdi({ dmg: { title: '   ' } }), null);
});

test('GERİLEME: yol ayıracı taşıyan ad /Volumes dışına çıkamaz', () => {
  assert.strictEqual(birimYolu('../../etc'), null);
  assert.strictEqual(birimYolu('a/b'), null);
  assert.strictEqual(birimYolu('..'), null);
  assert.strictEqual(birimYolu('Kitap 1.0.0'), path.join(KOK, 'Kitap 1.0.0'));
});

test('serbestBirak: bağlı değilse hdiutil HİÇ çağrılmaz', () => {
  const b = sahte({ bagli: [] });
  assert.strictEqual(serbestBirak('Kitap 1.0.0', b).durum, 'YOK');
  assert.strictEqual(b.cagrilar.length, 0);
});

test('serbestBirak: normal ayırma yeterse zorlamaya geçmez', () => {
  const yol = path.join(KOK, 'Kitap 1.0.0');
  const b = sahte({ bagli: [yol], ayrilabilir: [yol] });
  assert.strictEqual(serbestBirak('Kitap 1.0.0', b).durum, 'AYRILDI');
  assert.deepStrictEqual(b.cagrilar, [{ yol, zorla: false }]);
});

test('GERİLEME: meşgul birimde -force denenir (72378 vakası)', () => {
  const yol = path.join(KOK, 'Lingoland Grade 2 - Maarif Model 1.0.0');
  const b = sahte({ bagli: [yol], ayrilabilir: [], zorlaAyrilabilir: [yol] });
  assert.strictEqual(serbestBirak('Lingoland Grade 2 - Maarif Model 1.0.0', b).durum, 'ZORLA_AYRILDI');
  assert.deepStrictEqual(b.cagrilar, [{ yol, zorla: false }, { yol, zorla: true }]);
});

test('GERİLEME: hiç ayrılamayan birim build BAŞLAMADAN anlaşılır hata verir', () => {
  const yol = path.join(KOK, 'Kitap 1.0.0');
  const b = sahte({ bagli: [yol] });
  assert.throws(
    () => kapiyiUygula({ dmg: { title: 'Kitap 1.0.0' } }, { bagimliliklar: b, log() {} }),
    (e) => e.message.includes('serbest bırakılamadı') && e.message.includes(yol)
  );
});

test('kapiyiUygula: ayırabildiğinde hata atmaz ve durumu döner', () => {
  const yol = path.join(KOK, 'Kitap 1.0.0');
  const b = sahte({ bagli: [yol], ayrilabilir: [yol] });
  const satirlar = [];
  const s = kapiyiUygula({ dmg: { title: 'Kitap 1.0.0' } }, { bagimliliklar: b, log: (m) => satirlar.push(m) });
  assert.strictEqual(s.durum, 'AYRILDI');
  assert.ok(satirlar.some((m) => m.includes(yol)));
});

test('GERİLEME: canlı mac yolu kapıyı build ÖNCESİ çağırır', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, 'packagingService.js'), 'utf8');
  const govde = kaynak.split('\n').filter((s) => !s.trim().startsWith('//')).join('\n');
  const bas = govde.indexOf('async runElectronBuilder(');
  assert.notStrictEqual(bas, -1, 'runElectronBuilder bulunamadı');
  const spawnYeri = govde.indexOf('spawn(electronBuilderBin.command', bas);
  const kapiYeri = govde.indexOf('kapiyiUygula(', bas);
  assert.notStrictEqual(kapiYeri, -1, 'mac yolunda dmg birim kapısı çağrılmıyor');
  assert.ok(kapiYeri < spawnYeri, 'kapı electron-builder spawn edildikten SONRA çağrılıyor');
});
