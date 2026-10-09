'use strict';
/**
 * Süreç GRUBUNU öldürür. darwin/linux: `process.kill(-pid, 'SIGKILL')` (detached çocuk kendi
 * grubunun lideri). win32: eksi PID `process.kill`'de fırlatır (ESRCH); `taskkill /PID <pid> /T /F`
 * ağacı (Electron'un GPU/renderer çocukları dahil) kapatır. Hata yutulur: hedef zaten ölü olabilir.
 * `kill`/`kos` test için enjekte edilir.
 */
const { spawnSync } = require('child_process');

function surecGrubunuOldur(pid, secenek = {}) {
  const platform = secenek.platform || process.platform;
  const kill = secenek.kill || process.kill.bind(process);
  const kos = secenek.kos || spawnSync;
  if (!pid) return false;
  try {
    if (platform === 'win32') {
      const r = kos('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 15000 });
      return !r || r.status === 0;
    }
    kill(-pid, 'SIGKILL');
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { surecGrubunuOldur };
