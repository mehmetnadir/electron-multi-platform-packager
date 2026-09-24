'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cikisKodu } = require('./motor-kapisi');

const r = (m, md, k, kd) => ({ kapi: { gecti: m }, damgaTutarli: md, kabuk: { gecti: k }, kabukDamgaTutarli: kd });

test('cikisKodu: motor/kabuk ayrımı', () => {
  assert.equal(cikisKodu(r(true, true, true, true)), 0);
  assert.equal(cikisKodu(r(false, true, true, true)), 1);
  assert.equal(cikisKodu(r(true, true, false, true)), 3);
  assert.equal(cikisKodu(r(true, true, true, false)), 3, 'damga eksikse kabuk düşer');
  assert.equal(cikisKodu(r(false, false, false, false)), 4);
  assert.equal(cikisKodu(r(null, false, true, true)), 2);
  assert.equal(cikisKodu(r(true, true, null, true)), 2);
});
