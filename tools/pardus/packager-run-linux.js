'use strict';
// Paketleyiciyi HTTP'siz, dogrudan modul olarak kosar — /api/package'in yaptigi ile ayni
// jobInfo (app.js:454: packageOptions = {}), ayni startPackaging(jobId, jobInfo, io).
// Kullanim: node packager-run-linux.js <sessionId> <appName> <appVersion> <jobId>
process.chdir('/app'); // startPackaging 'uploads/<sid>' ve 'temp/<job>' yollarini cwd'ye gore cozer
const [sessionId, appName, appVersion, jobId] = process.argv.slice(2);
if (!sessionId || !appName) { console.error('kullanim: <sessionId> <appName> [appVersion] [jobId]'); process.exit(2); }

const svc = require('/app/src/packaging/packagingService.js');
const io = { emit: (ev, d) => console.log(`[io:${ev}]`, JSON.stringify(d).slice(0, 400)) };
const jobInfo = {
  sessionId,
  platforms: ['linux'],
  appName,
  appVersion: appVersion || '1.0.0',
  packageOptions: {},
  logoId: process.env.LOGO_ID || null,
  logoPath: process.env.LOGO_PATH || null,
};
const t0 = Date.now();
svc.startPackaging(jobId || `job-${t0}`, jobInfo, io).then((results) => {
  console.log('[sonuc]', JSON.stringify(results, null, 1));
  console.log(`[sure] ${Math.round((Date.now() - t0) / 1000)}s`);
  const r = results.linux;
  process.exit(r && r.success ? 0 : 1);
}).catch((e) => { console.error('[hata]', e); process.exit(1); });
