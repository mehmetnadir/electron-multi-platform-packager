const test = require('node:test');
const assert = require('node:assert/strict');
const { sentetikIdMi, SENTETIK_ID_TABAN } = require('./sentetik-id');
const { kaynakKarari, manuelKaynakUrl } = require('./kaynak-karari');

test('runner-sentetik: sentetikIdMi tanımı ve sınır kontrolleri', () => {
  assert.equal(SENTETIK_ID_TABAN, 9000000);
  assert.equal(sentetikIdMi(9000000), false);
  assert.equal(sentetikIdMi('9000000'), false);
  assert.equal(sentetikIdMi('9000001'), true);
  assert.equal(sentetikIdMi(9000001), true);
  assert.equal(sentetikIdMi('74430'), false);
  assert.equal(sentetikIdMi('9000001x'), false);
  assert.equal(sentetikIdMi(null), false);
  assert.equal(sentetikIdMi(undefined), false);
});

test('runner-sentetik: sentetik:// URL adresi manuel kaynak sayılmaz', () => {
  const job = {
    bookId: '9000001',
    downloadUrl: 'sentetik://set/9000001',
    kaynakTuru: 'manuel',
  };
  assert.equal(manuelKaynakUrl(job), null);
  const karar = kaynakKarari({ job });
  assert.equal(karar.tur, 'yok');
  assert.equal(karar.merdiven, false);
  assert.equal(karar.setEki, false);
});
