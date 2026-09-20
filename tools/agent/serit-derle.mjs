// KAYNAK KOPYA — canlı yeri: /opt/empp-packager/lane-build.mjs (srv21)
// srv21 şeridinin paketleyici istemcisi (:3093). /opt/empp-packager İÇİNDE durmalı — ESM çözümü node_modules gerektirir.
// Buradaki değişiklik sunucuya scp ile taşınır; sunucuda elle düzenlenirse
// geri buraya kopyalanır (tek kaynak: depo).
// srv21 ŞERİT derleyicisi — /opt/empp-packager kodu, İKİNCİ paketleyici örneği (3093).
// Kullanım: node /opt/lane-build.mjs <build.zip> <out.impark> "<appName>" "<yayınevi>"
// Not: 3091'deki ESKİ servis (Ağustos kopyası, SET düzeltmeleri YOK) kullanılmaz.
import fs from 'node:fs';
import axios from 'axios';
import FormData from 'form-data';
import { spawnSync } from 'node:child_process';

const P = 'http://127.0.0.1:3093';
const [ZIP, OUT, TITLE = 'Kitap', PUB = 'YDS Publishing'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const form = new FormData();
  form.append('files', fs.createReadStream(ZIP), 'build.zip');
  form.append('appName', TITLE);
  form.append('appVersion', '1.0.0');
  log('upload-build...');
  const up = await axios.post(`${P}/api/upload-build`, form, {
    headers: form.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity,
    timeout: 3_600_000, validateStatus: () => true,
  });
  if (up.status !== 200 || !up.data?.sessionId) throw new Error('upload HTTP ' + up.status);
  log('package linux...');
  const pk = await axios.post(`${P}/api/package`, {
    sessionId: up.data.sessionId, platforms: ['linux'], appName: TITLE,
    appVersion: '1.0.0', publisherName: PUB,
  }, { timeout: 60_000, validateStatus: () => true });
  if (pk.status !== 200 || !pk.data?.jobId) throw new Error('package HTTP ' + pk.status + ' ' + JSON.stringify(pk.data));
  const job = pk.data.jobId;
  log('jobId:', job);
  let bitti = false;
  for (let i = 0; i < 360; i++) {
    await sleep(10_000);
    const st = await axios.get(`${P}/api/package-status/${job}`, { timeout: 30_000, validateStatus: () => true });
    const q = st.data?.job || st.data?.queueStatus || {};
    if (i % 6 === 0) log('durum:', q.status, q.progress ?? '');
    if (q.status === 'completed') { bitti = true; log('BUILD OK'); break; }
    if (q.status === 'failed') throw new Error('failed: ' + (q.error || JSON.stringify(st.data).slice(0, 200)));
  }
  if (!bitti) throw new Error('derleme 60 dk içinde bitmedi');
  const r = spawnSync('curl', ['-sfL', '-o', OUT, `${P}/api/download/${job}/linux?type=impark`]);
  if (r.status !== 0 || !fs.existsSync(OUT) || fs.statSync(OUT).size < 100000) {
    throw new Error('impark indirilemedi (curl ' + r.status + ')');
  }
  log('impark OK:', (fs.statSync(OUT).size / 1e6).toFixed(0), 'MB →', OUT);
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
