'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('queue-empty temizliği tamamlanmış işlerin temp çıktısını korur (sentinel, 2026-08-27)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'queueService.js'), 'utf8');
  assert.ok(!/await fs\.emptyDir\(tempPath\)/.test(src), 'temp toptan boşaltılmamalı — ajan indirmeden çıktı silinir');
  assert.ok(/protectedIds/.test(src) && /job\.status === 'completed'/.test(src));
});

// GERÇEK davranış testi (kaynak taraması değil): kuyruk boş temizliği, kontrolden
// hemen sonra gelen taze yüklemeyi silmemeli. Kanıt 2026-09-17: srv21 şeridinde
// uploads toptan boşaltıldı, unzip build.zip'i bulamadı, iş "ZIP bekleniyor"da asıldı.
test('kuyruk boş temizliği TAZE uploads dizinini korur, eskisini siler', async () => {
  const os = require('node:os');
  const fsp = require('node:fs/promises');
  const kok = await fsp.mkdtemp(path.join(os.tmpdir(), 'empp-temizlik-'));
  const eskiCwd = process.cwd();
  try {
    await fsp.mkdir(path.join(kok, 'uploads', 'taze-oturum'), { recursive: true });
    await fsp.mkdir(path.join(kok, 'uploads', 'eski-oturum'), { recursive: true });
    await fsp.writeFile(path.join(kok, 'uploads', 'taze-oturum', 'build.zip'), 'x');
    await fsp.mkdir(path.join(kok, 'temp'), { recursive: true });
    const eski = new Date(Date.now() - 60 * 60 * 1000);
    await fsp.utimes(path.join(kok, 'uploads', 'eski-oturum'), eski, eski);

    process.chdir(kok);
    const queueService = require('./queueService');
    const yedek = queueService.getAllActiveJobs;
    queueService.getAllActiveJobs = () => ({ zipJobs: [], packagingJobs: [] });
    try {
      await queueService.checkAndCleanIfQueueEmpty('yok');
    } finally {
      queueService.getAllActiveJobs = yedek;
    }

    assert.ok(fs.existsSync(path.join(kok, 'uploads', 'taze-oturum', 'build.zip')),
      'taze yükleme silinmemeliydi');
    assert.ok(!fs.existsSync(path.join(kok, 'uploads', 'eski-oturum')),
      'eski oturum silinmeliydi');
  } finally {
    process.chdir(eskiCwd);
    await fsp.rm(kok, { recursive: true, force: true });
  }
});
