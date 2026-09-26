'use strict';
// motor-kanonik.js — iki Pardus şeridinin ortak motor denetçisi (E3 / D-1). CLI gerçekten koşar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { onDenetim, sonDenetim } = require('./motor-kanonik');

const CLI = path.join(__dirname, 'motor-kanonik.js');
const MOTOR = '43e23fce2b7009474555a77.js';
const sha12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

function kanonik(icerik = 'KANONIK-v2') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'motor-cli-'));
  fs.writeFileSync(path.join(d, MOTOR), icerik);
  fs.writeFileSync(path.join(d, 'kanonik.json'), JSON.stringify({ sha12: sha12(icerik), surum: '2026.9.12' }));
  return { d, yol: path.join(d, 'kanonik.json'), sha: sha12(icerik) };
}
const kos = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8', timeout: 20000 });

test('on: doğrulanmış kanonik → rc 0, sha12 + sürüm satırı; UYARI yok', () => {
  const k = kanonik();
  const r = kos('on', k.yol);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), `motor: kanonik ${k.sha} 2026.9.12 (${k.yol})`);
  assert.doesNotMatch(r.stdout, /UYARI/);
});

test('on: kanonik yok ya da dosya hash tutmuyor → rc 3 + açık UYARI (sessiz geçmez)', () => {
  const r = kos('on', path.join(os.tmpdir(), 'olmayan-motor', 'kanonik.json'));
  assert.equal(r.status, 3);
  assert.match(r.stdout, /^UYARI motor: kanonik yok ya da doğrulanamadı .* DEĞİŞMEYECEK \(motorSurumu\.durum=bilinmiyor\)/);
  const k = kanonik();
  fs.writeFileSync(path.join(k.d, MOTOR), 'BOZUK');
  assert.equal(onDenetim(k.yol).rc, 3, 'json var ama motor dosyası farklı → doğrulanamadı');
});

test('son: guncel damga → tek bilgi satırı; bilinmiyor/kapali/karisik → ek UYARI satırı', () => {
  const g = sonDenetim('x\nEMPP_MOTOR durum=guncel sha12=03e8af70a0f3 kanonik=03e8af70a0f3 degisen=5\n');
  assert.deepEqual(g.satirlar, ['motor: paket durum=guncel sha12=03e8af70a0f3 kanonik=03e8af70a0f3 degisen=5']);
  for (const durum of ['bilinmiyor', 'kapali', 'karisik', 'hata']) {
    const s = sonDenetim(`EMPP_MOTOR durum=${durum} sha12=f44371530000 kanonik=YOK`);
    assert.equal(s.satirlar.length, 2, durum);
    assert.match(s.satirlar[1], new RegExp(`^UYARI motor: paket motoru kanonik DEĞİL \\(durum=${durum}`));
  }
});

test('son: damga satırı yoksa (eski paketleyici / log yok) UYARI "ölçülemedi"; rc her zaman 0 (D-1)', () => {
  const r = kos('son', path.join(os.tmpdir(), 'olmayan-packager.log'));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^UYARI motor: paketleyici EMPP_MOTOR damgası basmadı — motor ölçülemedi/);
  assert.equal(kos('yanlis').status, 2);
});
