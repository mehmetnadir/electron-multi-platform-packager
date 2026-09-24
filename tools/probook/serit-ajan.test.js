'use strict';
// serit-ajan.sh: runner'ı DEĞİŞTİRMEDEN ProBook kipine alan ortamı kurar. Gerçek betik,
// sahte depo: runner.js yerine ortamı döken bir taklit; logo-sunucu/nabiz-yaz/docker şimi GERÇEK.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('ProBook kipi ortami: pardus, yerel kabul, yerel build, docker simi, nabiz yazilir', () => {
  const serit = fs.mkdtempSync(path.join(os.tmpdir(), 'serit-ajan-'));
  const repo = path.join(serit, 'repo');
  const pb = path.join(repo, 'tools', 'probook');
  fs.mkdirSync(path.join(pb, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src', 'agent'), { recursive: true });
  for (const f of ['serit-ajan.sh', 'logo-sunucu.js', 'nabiz-yaz.js', 'bin/docker']) {
    fs.copyFileSync(path.join(__dirname, f), path.join(pb, f));
    fs.chmodSync(path.join(pb, f), 0o755);
  }
  // nabiz-yaz serit-secimi'ne değil yalnız fs'e bağlı; runner taklidi ortamı döker.
  fs.writeFileSync(path.join(repo, 'src', 'agent', 'runner.js'), `
    const { spawnSync } = require('child_process');
    const d = spawnSync('docker', ['info']); const p = spawnSync('docker', ['ps']);
    const e = process.env;
    require('fs').writeFileSync(process.argv[1] + '.ortam.json', JSON.stringify({
      caps: e.AGENT_CAPS, host: e.PROBOOK_HOST, build: e.PARDUS_BUILD_SCRIPT, kabul: e.EMPP_PARDUS_KABUL,
      deb: e.EMPP_LINUX_DEB, api: e.PACKAGER_API, tmp: e.TMPDIR, cache: e.EMPP_SOURCE_CACHE,
      dockerInfo: d.status, dockerPs: p.status, kabulTimeout: e.AGENT_PARDUS_KABUL_TIMEOUT_MS,
    }));
    setTimeout(() => process.exit(0), 1500);
  `);
  fs.writeFileSync(path.join(repo, '.serit-surum'), 'abc1234');
  const r = spawnSync('bash', [path.join(pb, 'serit-ajan.sh')], {
    encoding: 'utf8', timeout: 20000,
    env: { ...process.env, EMPP_SERIT_KOK: serit, EMPP_LOGO_PORT: '0', HOME: serit,
      AGENT_CAPS: '', PROBOOK_HOST: '', PARDUS_BUILD_SCRIPT: '', EMPP_PARDUS_KABUL: '', EMPP_LINUX_DEB: '', PACKAGER_API: '' },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const o = JSON.parse(fs.readFileSync(path.join(repo, 'src', 'agent', 'runner.js.ortam.json'), 'utf8'));
  assert.equal(o.caps, 'pardus');
  assert.equal(o.host, 'yerel');
  assert.equal(o.build, path.join(repo, 'tools', 'pardus', 'pardus-yerel-build.sh'));
  assert.equal(o.kabul, '1');
  assert.equal(o.deb, '0');
  assert.equal(o.tmp, path.join(serit, 'work'));
  assert.equal(o.cache, path.join(serit, 'cache', 'kaynak'));
  assert.equal(o.dockerInfo, 0, 'docker simi info=0 donmeli (runner ensureDockerReady)');
  assert.equal(o.dockerPs, 1, 'docker simi baska komutta DUSMELI');
  assert.ok(Number(o.kabulTimeout) >= 30 * 60 * 1000);
  const nabiz = JSON.parse(fs.readFileSync(path.join(serit, 'log', 'nabiz.json'), 'utf8'));
  assert.equal(nabiz.commit, 'abc1234');
  assert.equal(nabiz.bayraklar.probookHost, 'yerel');
  assert.match(r.stdout, /runner cikti rc=0/);
});
