'use strict';
// tools/mac/paketleyici-bayat.sh testleri — sahte curl/git/paketleyici ile (gerçek 3001'e GİTMEZ).
// "Paketleyici" = `node -e ... app.js` süreci; sahte curl onun canlı olup olmadığına bakar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LIB = path.join(__dirname, 'paketleyici-bayat.sh');

function kos({ canli, disk, bayatMi = false, kuyrukDolu = false, kuyrukJson, bayrak, gitYok = false, surum }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-'));
  const bin = path.join(d, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(d, 'canli'), canli);
  fs.writeFileSync(path.join(d, 'disk'), disk || '');
  if (surum) fs.writeFileSync(path.join(d, '.surum'), surum);
  fs.writeFileSync(path.join(d, 'kuyruk'), kuyrukJson ? kuyrukJson : kuyrukDolu
    ? '{"success":true,"zipJobs":[],"packagingJobs":[],"activePackagingJobs":[{"id":"x","status":"building"}]}'
    : '{"success":true,"zipJobs":[],"packagingJobs":[],"activePackagingJobs":[]}');
  fs.writeFileSync(path.join(d, 'bayat'), bayatMi ? 'true' : 'false');
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/bash
D="${d}"
for a in "$@"; do u="$a"; done
case "$u" in
  */api/queue-status) cat "$D/kuyruk"; exit 0;;
  */api/health)
    [ -f "$D/pid" ] || exit 22
    kill -0 "$(cat "$D/pid")" 2>/dev/null || exit 22
    echo "{\\"status\\":\\"ok\\",\\"commit\\":\\"$(cat "$D/canli")\\",\\"pid\\":$(cat "$D/pid"),\\"bayatMi\\":$(cat "$D/bayat")}"; exit 0;;
esac
exit 22
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/bash
${gitYok ? 'exit 128' : `cat "${d}/disk"`}
`, { mode: 0o755 });
  const betik = `
set -u
export PATH="${bin}:$PATH"
export PB_REPO="${d}" PB_LOGDIR="${d}" PB_BEKLE_ARALIK=0.1
${bayrak !== undefined ? `export EMPP_PAKETLEYICI_BAYAT_YENIDEN=${bayrak}` : ''}
. "${LIB}"
spawn() { node -e 'setInterval(()=>{},1000)' app.js >/dev/null 2>&1 & echo $! > "${d}/pid"; }
paketleyici_baslat() { cp "${d}/disk" "${d}/canli"; echo false > "${d}/bayat"; spawn; }
spawn
ESKI=$(cat "${d}/pid")
sleep 0.5
paketleyici_bayat_yeniden; echo "RC=$?"
echo "ESKI_CANLI=$(kill -0 $ESKI 2>/dev/null && echo evet || echo hayir)"
echo "COMMIT=$(cat "${d}/canli")"
kill $(cat "${d}/pid") 2>/dev/null
`;
  const r = spawnSync('bash', ['-c', betik], { encoding: 'utf8', timeout: 60000 });
  const log = fs.existsSync(path.join(d, 'paketleyici-bayat.log'))
    ? fs.readFileSync(path.join(d, 'paketleyici-bayat.log'), 'utf8') : '';
  return { out: r.stdout + r.stderr, log };
}

test('commit eşit, bayatMi false: dokunmaz', () => {
  const r = kos({ canli: 'aaa111', disk: 'aaa111' });
  assert.match(r.out, /ESKI_CANLI=evet/);
  assert.match(r.out, /RC=0/);
  assert.match(r.log, /güncel/);
});

test('commit farklı + kuyruk boş: yeniden açar, commit eşitlenir, kanıt loglanır', () => {
  const r = kos({ canli: 'eski000', disk: 'yeni111' });
  assert.match(r.out, /ESKI_CANLI=hayir/);
  assert.match(r.out, /COMMIT=yeni111/);
  assert.match(r.out, /RC=0/);
  assert.match(r.log, /BAYAT: canlı=eski000 disk=yeni111/);
  assert.match(r.log, /kapatılıyor/);
  assert.match(r.log, /TAMAM: yeni commit=yeni111/);
});

test('commit eşit ama bayatMi true: yeniden açar', () => {
  const r = kos({ canli: 'aaa111', disk: 'aaa111', bayatMi: true });
  assert.match(r.out, /ESKI_CANLI=hayir/);
  assert.match(r.log, /bayatMi=1/);
  assert.match(r.log, /TAMAM/);
});

test('commit farklı + kuyruk dolu: dokunmaz ve loglar', () => {
  const r = kos({ canli: 'eski000', disk: 'yeni111', kuyrukDolu: true });
  assert.match(r.out, /ESKI_CANLI=evet/);
  assert.match(r.out, /COMMIT=eski000/);
  assert.match(r.log, /kuyruk DOLU.*dokunulmadı/);
});

test('bayrak 0: farklı olsa da dokunmaz', () => {
  const r = kos({ canli: 'eski000', disk: 'yeni111', bayrak: '0' });
  assert.match(r.out, /ESKI_CANLI=evet/);
  assert.match(r.out, /COMMIT=eski000/);
  assert.match(r.log, /kapalı/);
});

test('git yok: .surum dosyasına düşer', () => {
  const r = kos({ canli: 'eski000', disk: 'yeni111', gitYok: true, surum: 'yeni111\n' });
  assert.match(r.log, /BAYAT: canlı=eski000 disk=yeni111/);
  assert.match(r.out, /COMMIT=yeni111/);
});

test('git de .surum da yok: dokunmaz', () => {
  const r = kos({ canli: 'eski000', disk: 'x', gitYok: true });
  assert.match(r.out, /ESKI_CANLI=evet/);
  assert.match(r.log, /disk sürümü okunamadı/);
});

test('biten zip işleri kuyruğu meşgul saymaz (kasada ölçüldü: completed zip kayıtları kalır)', () => {
  const r = kos({ canli: 'eski000', disk: 'yeni111',
    kuyrukJson: '{"zipJobs":[{"status":"completed"},{"status":"completed"}],"packagingJobs":[{"status":"failed"}],"activePackagingJobs":[]}' });
  assert.match(r.out, /ESKI_CANLI=hayir/);
  assert.match(r.log, /TAMAM/);
});

test('çıktısı alınmamış completed paketleme işi: dokunmaz (iş kaydı kaybolur, download 404)', () => {
  const r = kos({ canli: 'eski000', disk: 'yeni111',
    kuyrukJson: '{"zipJobs":[],"packagingJobs":[{"status":"completed"}],"activePackagingJobs":[]}' });
  assert.match(r.out, /ESKI_CANLI=evet/);
  assert.match(r.log, /kuyruk DOLU/);
});

test('çalışan zip işi: dokunmaz', () => {
  const r = kos({ canli: 'eski000', disk: 'yeni111',
    kuyrukJson: '{"zipJobs":[{"status":"extracting"}],"packagingJobs":[],"activePackagingJobs":[]}' });
  assert.match(r.out, /ESKI_CANLI=evet/);
});

test('kuyruk JSON bozuk: dokunmaz', () => {
  const r = kos({ canli: 'eski000', disk: 'yeni111', kuyrukJson: 'bozuk' });
  assert.match(r.out, /ESKI_CANLI=evet/);
  assert.match(r.log, /okunamadı/);
});
