const test = require('node:test');
const assert = require('node:assert');
const { SENTETIK_ID_TABAN, sentetikIdMi } = require('./sentetik-id');

test('SENTETIK_ID_TABAN 9000000 olmalı', () => {
  assert.strictEqual(SENTETIK_ID_TABAN, 9000000);
});

test('sentetikIdMi sınır ve tip testleri', () => {
  assert.strictEqual(sentetikIdMi(9000000), false);
  assert.strictEqual(sentetikIdMi('9000000'), false);
  assert.strictEqual(sentetikIdMi('9000001'), true);
  assert.strictEqual(sentetikIdMi(9000001), true);
  assert.strictEqual(sentetikIdMi('74430'), false);
  assert.strictEqual(sentetikIdMi(74430), false);
  assert.strictEqual(sentetikIdMi('9000001x'), false);
  assert.strictEqual(sentetikIdMi(null), false);
  assert.strictEqual(sentetikIdMi(undefined), false);
  assert.strictEqual(sentetikIdMi(NaN), false);
  assert.strictEqual(sentetikIdMi(''), false);
  assert.strictEqual(sentetikIdMi('-9000001'), false);
});
