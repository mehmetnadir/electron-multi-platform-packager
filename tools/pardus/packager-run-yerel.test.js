'use strict';
// packager-run-yerel.js: docker'daki packager-run-linux.js ile AYNI jobInfo'yu kurmalı.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { jobInfoKur } = require('./packager-run-yerel');

test('jobInfo docker yoluyla ayni alanlari tasir', () => {
  const j = jobInfoKur({ sessionId: 's1', appName: 'Bloktest', appVersion: '', env: { LOGO_PATH: '/l.png' } });
  assert.deepEqual(j, {
    sessionId: 's1', platforms: ['linux'], appName: 'Bloktest', appVersion: '1.0.0',
    packageOptions: {}, logoId: null, logoPath: '/l.png',
  });
});

test('docker esinin jobInfo anahtarlariyla birebir (parite)', () => {
  const docker = fs.readFileSync(path.join(__dirname, 'packager-run-linux.js'), 'utf8');
  const blok = docker.slice(docker.indexOf('const jobInfo = {'), docker.indexOf('};', docker.indexOf('const jobInfo = {')));
  const anahtarlar = [...blok.matchAll(/^\s+(\w+)[,:]/gm)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(jobInfoKur({ sessionId: 's', appName: 'a', env: {} })).sort(), anahtarlar);
});
