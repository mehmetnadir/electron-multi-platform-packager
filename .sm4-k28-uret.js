// SM4 Windows exe — yeni kurulum bilgilendirmesiyle (K27 açılış göstergesi (commit 623aa23)).
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const P = 'http://127.0.0.1:3001';
const ZIP = path.join(process.env.HOME, 'Downloads', 'yds-pketler', 'sm4.zip');
const LOGO = 'f89d2e30-c4c1-4ba9-bca6-b561f114627b'; // YDS Publishing
const CIKTI = path.join(process.env.HOME, 'Downloads', 'sm4-windows-exe',
  'SM4-K28-MANIFEST.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  log('zip:', (fs.statSync(ZIP).size / 1e6).toFixed(0), 'MB');
  const form = new FormData();
  form.append('files', fs.createReadStream(ZIP), 'build.zip');
  form.append('appName', 'Super Monsters 4');
  form.append('appVersion', '1.0.0');
  log('upload-build...');
  const up = await axios.post(`${P}/api/upload-build`, form, {
    headers: form.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity,
    timeout: 3_600_000, validateStatus: () => true,
  });
  if (up.status !== 200 || !up.data?.sessionId) throw new Error('upload HTTP ' + up.status);
  log('sessionId:', up.data.sessionId);

  const pk = await axios.post(`${P}/api/package`, {
    sessionId: up.data.sessionId,
    platforms: ['windows'],
    appName: 'Super Monsters 4',
    appVersion: '1.0.0',
    logoId: LOGO,
    packageOptions: { publisherName: 'YDS Publishing' },
  }, { timeout: 60_000, validateStatus: () => true });
  if (pk.status !== 200 || !pk.data?.jobId) {
    throw new Error('package HTTP ' + pk.status + ' ' + JSON.stringify(pk.data).slice(0, 200));
  }
  const job = pk.data.jobId;
  log('jobId:', job);

  for (let i = 0; i < 360; i++) {
    await sleep(10_000);
    const st = await axios.get(`${P}/api/package-status/${job}`, { timeout: 30_000, validateStatus: () => true });
    const q = st.data?.job || st.data?.queueStatus || {};
    if (i % 6 === 0) log('durum:', q.status, q.progress ?? '');
    if (q.status === 'completed') { log('BUILD OK'); break; }
    if (q.status === 'failed') throw new Error('failed: ' + (q.error || JSON.stringify(st.data).slice(0, 300)));
    if (i === 359) throw new Error('60 dk içinde bitmedi');
  }

  const { spawnSync } = require('child_process');
  const r = spawnSync('curl', ['-sfL', '-o', CIKTI, `${P}/api/download/${job}/windows`]);
  if (r.status !== 0 || !fs.existsSync(CIKTI) || fs.statSync(CIKTI).size < 1e6) {
    throw new Error('exe indirilemedi (curl rc=' + r.status + ')');
  }
  log('EXE OK:', (fs.statSync(CIKTI).size / 1e6).toFixed(0), 'MB →', CIKTI);
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
