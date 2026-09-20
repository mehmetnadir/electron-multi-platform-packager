'use strict';
// K13 (2026-09-09, canlı-teşhis dersi) — canlı sürecin HANGİ kodu koştuğunu
// tek `curl /api/health` ile kanıtlamak için commit hash'ini okur.
//
// NEDEN: `packagingService.js` (ve genel olarak Express app modülü) Node'un
// require() önbelleğinde process ömrü boyunca SINGLETON'dır. Dosyaya yazılan
// yeni kod, systemd/pm2/launchd ile ayakta duran süreç yeniden başlatılmadan
// ASLA devreye girmez ("deploy ettim ama davranış değişmedi" şüphesi — bkz.
// CLAUDE.md "S21 servisleri", `.claude/docs/set-paketi-know-how.md`). Bu
// fonksiyon süreç başlarken BİR KEZ çağrılır (app.js'te `GIT_COMMIT` sabiti) —
// her istekte git çalıştırmak hem gereksiz I/O hem YANILTICI olurdu (süreç
// zaten o an checkout edilmiş HEAD'i koşuyor, restart olmadan git HEAD'in
// ilerlemesi sürecin gerçek davranışını DEĞİŞTİRMEZ).
//
// BOZARSAN: `git-commit.test.js`'teki testler kırılır; `app.test.js`'teki
// health-sözleşmesi sentinel'i de `commit`/`startedAt` alanlarını arar.
function getGitCommit(cwd) {
  try {
    const { execSync } = require('child_process');
    const out = execSync('git rev-parse --short HEAD', {
      cwd: cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    return out || 'bilinmiyor';
  } catch (gitErr) {
    // git kurulu değil / bu dizin bir git repo değil / detached çalışma kopyası
    // — health endpoint'i BU YÜZDEN çökmemeli, "bilinmiyor" ile devam eder.
    return 'bilinmiyor';
  }
}

module.exports = { getGitCommit };
