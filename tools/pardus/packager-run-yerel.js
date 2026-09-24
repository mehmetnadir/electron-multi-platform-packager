'use strict';
// packager-run-linux.js'in DOCKER'SIZ eşi (ProBook şeridi, plan C4, 2026-09-24).
// Aynı jobInfo, aynı startPackaging(jobId, jobInfo, io) — tek fark: /app sabit yolu yok.
// Paketleyici `uploads/<sid>`, `temp/<job>` ve `node_modules/.bin/electron-builder`
// yollarını CWD'ye göre çözer (packagingService.js:413-414, 4130) — çağıran cwd'yi
// işe özel çalışma dizinine (src + node_modules symlink'li) ayarlar.
// Kullanım: node packager-run-yerel.js <repoKoku> <sessionId> <appName> <appVersion> <jobId>
const path = require('path');

function jobInfoKur({ sessionId, appName, appVersion, env = process.env }) {
  return {
    sessionId,
    platforms: ['linux'],
    appName,
    appVersion: appVersion || '1.0.0',
    packageOptions: {},
    logoId: env.LOGO_ID || null,
    logoPath: env.LOGO_PATH || null,
  };
}

function main(argv = process.argv.slice(2)) {
  const [repo, sessionId, appName, appVersion, jobId] = argv;
  if (!repo || !sessionId || !appName) {
    console.error('kullanim: <repoKoku> <sessionId> <appName> [appVersion] [jobId]');
    process.exit(2);
  }
  const svc = require(path.join(path.resolve(repo), 'src', 'packaging', 'packagingService.js'));
  const io = { emit: (ev, d) => console.log(`[io:${ev}]`, JSON.stringify(d).slice(0, 400)) };
  const t0 = Date.now();
  svc.startPackaging(jobId || `job-${t0}`, jobInfoKur({ sessionId, appName, appVersion }), io)
    .then((results) => {
      console.log('[sonuc]', JSON.stringify(results, null, 1));
      console.log(`[sure] ${Math.round((Date.now() - t0) / 1000)}s`);
      const r = results.linux;
      process.exit(r && r.success ? 0 : 1);
    })
    .catch((e) => { console.error('[hata]', e); process.exit(1); });
}

if (require.main === module) main();

module.exports = { jobInfoKur };
