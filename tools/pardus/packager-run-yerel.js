'use strict';
// packager-run-linux.js'in DOCKER'SIZ eşi (ProBook şeridi, plan C4, 2026-09-24).
// Aynı jobInfo, aynı startPackaging(jobId, jobInfo, io) — tek fark: /app sabit yolu yok.
// Paketleyici `uploads/<sid>`, `temp/<job>` ve `node_modules/.bin/electron-builder`
// yollarını CWD'ye göre çözer (packagingService.js:413-414, 4130) — çağıran cwd'yi
// işe özel çalışma dizinine (src + node_modules symlink'li) ayarlar.
// Kullanım: node packager-run-yerel.js <repoKoku> <sessionId> <appName> <appVersion> <jobId>
const path = require('path');

// G kimliği (2026-09-26, docker eşi packager-run-linux.js `jobInfoKur` ile AYNI): claim'in
// setKimligi / guncellemeTabani / surum alanları runner'dan env ile gelir (EMPP_G_*; runner
// `pardusBetikEnv` doğrular). Boş alan null: paketleyici o pakete G güncelleyicisini enjekte ETMEZ.
function jobInfoKur({ sessionId, appName, appVersion, env = process.env }) {
  const al = (ad) => (typeof env[ad] === 'string' && env[ad].trim() ? env[ad].trim() : null);
  return {
    sessionId,
    platforms: ['linux'],
    appName,
    appVersion: appVersion || '1.0.0',
    packageOptions: {},
    logoId: env.LOGO_ID || null,
    logoPath: env.LOGO_PATH || null,
    setKimligi: al('EMPP_G_SET_KIMLIGI'),
    guncellemeTabani: al('EMPP_G_GUNCELLEME_TABANI'),
    surum: al('EMPP_G_SURUM'),
    kanonikSart: true, // üretim işi: kanonik kabuk/motor yoksa düşer (kanonik-sart.js)
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
  const jobInfo = jobInfoKur({ sessionId, appName, appVersion });
  console.log(`[g-kimlik] set=${jobInfo.setKimligi || 'YOK'} surum=${jobInfo.surum || 'YOK'} `
    + `taban=${jobInfo.guncellemeTabani ? 'var' : 'YOK'}`);
  const t0 = Date.now();
  svc.startPackaging(jobId || `job-${t0}`, jobInfo, io)
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
