'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BETIK = path.join(__dirname, 'gun-sonu-tablo.sh');
const BASLIK = 'CURDATE()\tbook_id\tplatform\tstatus\tkabuk_surum\tkabuk_durum\tlast_run_at\tlast_queued_at\tLEFT(IFNULL(last_result,\'\'),100)';
const G = '2026-10-06';

/** Sahte ssh: stdout/çıkış kodu dosyadan; sorguyu sorgu.txt'ye yazar. */
function kos(cikti, rc, args = ['--setler', '1 2 3']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gst-'));
  fs.writeFileSync(path.join(dir, 'cikti.txt'), cikti);
  fs.writeFileSync(path.join(dir, 'ssh'),
    `#!/bin/bash\nprintf '%s' "\${@: -1}" > "${dir}/sorgu.txt"\ncat "${dir}/cikti.txt"\nexit ${rc}\n`,
    { mode: 0o755 });
  const r = spawnSync('bash', [BETIK, ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
  });
  r.sorgu = fs.readFileSync(path.join(dir, 'sorgu.txt'), 'utf8');
  return r;
}
const satir = (...a) => a.join('\t') + '\n';
const ok = (b, p, st, ks = '1.13.14', kd = 'guncel', run = `${G} 09:00:00`, res = '') =>
  satir(G, b, p, st, ks, kd, run, `${G} 08:00:00`, res);

const VERI = BASLIK + '\n'
  + ok(1, 'windows', 'completed') + ok(1, 'pardus', 'completed', '1.13.13', 'eski')
  + ok(1, 'mac', 'queued', 'NULL', 'NULL', 'NULL') + ok(1, 'android', 'running', 'NULL', 'NULL', 'NULL')
  + ok(2, 'windows', 'failed', 'NULL', 'NULL', `${G} 11:10:00`, 'hata: imza yok')
  + ok(2, 'pardus', 'completed', '1.13.14', 'guncel', '2026-10-05 23:00:00')
  + ok(2, 'mac', 'completed') + ok(2, 'android', 'completed');

test('özet sayıları ve failed satır', () => {
  const r = kos(VERI, 0);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /windows\s+1\s+0\s+0\s+0\s+1\s+1/); // set 3 kayıt yok
  assert.match(r.stdout, /pardus\s+0\s+2\s+0\s+0\s+0\s+1/);
  assert.match(r.stdout, /mac\s+1\s+0\s+1\s+0\s+0\s+1/);
  assert.match(r.stdout, /android\s+1\s+0\s+0\s+1\s+0\s+1/);
  assert.match(r.stdout, /2\twindows\t11:10\thata: imza yok/);
  assert.match(r.sorgu, /book_id IN \(1,2,3\)/);
});

test('matris işaretleri', () => {
  const r = kos(VERI, 0, ['--setler', '1 2 3', '--matris']);
  assert.match(r.stdout, /^1\s+✓\s+·\s+○\s+▶/m);
  assert.match(r.stdout, /^2\s+✗\s+·\s+✓\s+✓/m);
  assert.match(r.stdout, /^3\s+-\s+-\s+-\s+-/m);
});

test('0 satır: çıkış 1 + boş çıktı hata sayılmaz', () => {
  const r = kos('', 1);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\(yok\)/);
});

test('SQL hatası: çıkış 2 ve metin gösterilir', () => {
  const r = kos("ERROR 1054 (42S22): Unknown column 'x'\n", 0);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ERROR 1054/);
});

test('ssh bağlantı hatası (255): çıkış 2', () => {
  const r = kos('ssh: connect refused\n', 255);
  assert.equal(r.status, 2);
});

test('--kabuk ezilir: eski sürüm sayılır', () => {
  const r = kos(VERI, 0, ['--setler', '1 2 3', '--kabuk', '9.9.9']);
  assert.match(r.stdout, /windows\s+0\s+1\s+0\s+0\s+1\s+1/);
});
