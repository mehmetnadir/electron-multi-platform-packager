'use strict';
// Paketleyiciyi HTTP'siz, dogrudan modul olarak kosar — /api/package'in yaptigi ile ayni
// jobInfo (app.js:454: packageOptions = {}), ayni startPackaging(jobId, jobInfo, io).
// Kullanim: node packager-run-linux.js <sessionId> <appName> <appVersion> <jobId>

/**
 * jobInfo'yu kurar (SAF, test edilebilir). G kimligi (2026-09-26): claim'in setKimligi /
 * guncellemeTabani / surum alanlari runner'dan -e ile gelir (EMPP_G_*; runner dogrular) —
 * /api/package govdesindeki alanlarla AYNI adlar. Bos olan alan null: paketleyici o pakete
 * G guncelleyicisini enjekte ETMEZ (sahte tabanli paket uretilmez).
 */
function jobInfoKur(argv, env) {
  const [sessionId, appName, appVersion] = argv;
  const e = env || {};
  const al = (ad) => (typeof e[ad] === 'string' && e[ad].trim() ? e[ad].trim() : null);
  return {
    sessionId,
    platforms: ['linux'],
    appName,
    appVersion: appVersion || '1.0.0',
    packageOptions: {},
    logoId: e.LOGO_ID || null,
    logoPath: e.LOGO_PATH || null,
    setKimligi: al('EMPP_G_SET_KIMLIGI'),
    guncellemeTabani: al('EMPP_G_GUNCELLEME_TABANI'),
    surum: al('EMPP_G_SURUM'),
  };
}

if (require.main === module) {
  process.chdir('/app'); // startPackaging 'uploads/<sid>' ve 'temp/<job>' yollarini cwd'ye gore cozer
  const argv = process.argv.slice(2);
  const [sessionId, appName, , jobId] = argv;
  if (!sessionId || !appName) { console.error('kullanim: <sessionId> <appName> [appVersion] [jobId]'); process.exit(2); }

  const svc = require('/app/src/packaging/packagingService.js');
  const io = { emit: (ev, d) => console.log(`[io:${ev}]`, JSON.stringify(d).slice(0, 400)) };
  const jobInfo = jobInfoKur(argv, process.env);
  console.log(`[g-kimlik] set=${jobInfo.setKimligi || 'YOK'} surum=${jobInfo.surum || 'YOK'} `
    + `taban=${jobInfo.guncellemeTabani ? 'var' : 'YOK'}`);
  const t0 = Date.now();
  svc.startPackaging(jobId || `job-${t0}`, jobInfo, io).then((results) => {
    console.log('[sonuc]', JSON.stringify(results, null, 1));
    console.log(`[sure] ${Math.round((Date.now() - t0) / 1000)}s`);
    const r = results.linux;
    process.exit(r && r.success ? 0 : 1);
  }).catch((e) => { console.error('[hata]', e); process.exit(1); });
}

module.exports = { jobInfoKur };
