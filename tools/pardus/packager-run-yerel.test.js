'use strict';
// packager-run-yerel.js: docker'daki packager-run-linux.js ile AYNI jobInfo'yu kurmalı.
const test = require('node:test');
const assert = require('node:assert/strict');
const { jobInfoKur } = require('./packager-run-yerel');

test('jobInfo docker yoluyla ayni alanlari tasir', () => {
  const j = jobInfoKur({ sessionId: 's1', appName: 'Bloktest', appVersion: '', env: { LOGO_PATH: '/l.png' } });
  assert.deepEqual(j, {
    sessionId: 's1', platforms: ['linux'], appName: 'Bloktest', appVersion: '1.0.0',
    packageOptions: {}, logoId: null, logoPath: '/l.png',
    setKimligi: null, guncellemeTabani: null, surum: null, kanonikSart: true,
  });
});

// Docker eşi (g-electron 9075bd0) jobInfo'yu SAF `jobInfoKur(argv, env)` ile kurar — parite artık
// kaynak metni kesip biçmeden, iki fonksiyonun ÇIKTISI üzerinden ölçülür (G alanları dahil).
test('docker esinin jobInfo anahtarlariyla birebir (parite)', () => {
  const docker = require('./packager-run-linux');
  const env = {
    LOGO_ID: 'l7', LOGO_PATH: '/l.png', EMPP_G_SET_KIMLIGI: '74390',
    EMPP_G_GUNCELLEME_TABANI: 'https://g.example/guncelleme', EMPP_G_SURUM: '2.51.3',
  };
  const d = docker.jobInfoKur(['s', 'a', '1.2.3'], env);
  const y = jobInfoKur({ sessionId: 's', appName: 'a', appVersion: '1.2.3', env });
  assert.deepEqual(Object.keys(y).sort(), Object.keys(d).sort());
  assert.deepEqual(y, d, 'aynı girdiyle iki şerit AYNI jobInfo kurmalı');
  assert.deepEqual(jobInfoKur({ sessionId: 's', appName: 'a', env: { EMPP_G_SURUM: '  ' } }),
    docker.jobInfoKur(['s', 'a'], { EMPP_G_SURUM: '  ' }), 'boş G alanı iki şeritte de null');
});
