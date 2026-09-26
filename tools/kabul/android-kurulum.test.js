'use strict';
/**
 * Android cihaz katmanı — `adb install` adımı, SAHTE adb ile (emülatör yok).
 * Geçici bir SDK kökü kurulur (platform-tools/adb, emulator/emulator, build-tools/x/aapt betikleri),
 * ANDROID_HOME ona çevrilir; cihazKabulu `mevcutSeri` ile açılış adımını atlar.
 * Senaryo: FAKE_ADB_KUR="hata-yer,basari" gibi; i. kurulum denemesi i. öğeyi (sonuncusu tekrar) kullanır.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('./android-cihaz');

const SAHTE_ADB = `#!/bin/bash
D="$FAKE_ADB_DIR"; echo "$*" >> "$D/cagri.log"
[ "$1" = "-s" ] && shift 2
case "$1" in
  devices) printf 'List of devices attached\\nemulator-5999\\tdevice\\n'; exit 0;;
  wait-for-device) exit 0;;
  get-state) echo device; exit 0;;
  install)
    n=$(( $(cat "$D/kur.sayac" 2>/dev/null || echo 0) + 1 )); echo $n > "$D/kur.sayac"
    IFS=',' read -ra S <<< "$FAKE_ADB_KUR"; i=$(( n - 1 )); [ $i -ge \${#S[@]} ] && i=$(( \${#S[@]} - 1 ))
    echo "Performing Streamed Install"
    case "\${S[$i]}" in
      basari) echo "Success"; exit 0;;
      hata-yer) echo "adb: failed to install /x/artifact.apk: Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE: Failed to override installation location]" >&2; exit 1;;
      hata-apk) echo "adb: failed to install /x/artifact.apk: Failure [INSTALL_PARSE_FAILED_NO_CERTIFICATES: no certificates]" >&2; exit 1;;
      *) echo "bilinmeyen senaryo" >&2; exit 1;;
    esac;;
  shell)
    shift; case "$*" in
      *"dumpsys connectivity"*) echo "NetworkAgentInfo{ ... Capabilities: INTERNET&VALIDATED }";;
    esac; exit 0;;
  *) exit 0;;
esac
`;

function sahteSdk(senaryo) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-adb-'));
  const yaz = (yol, icerik) => {
    fs.mkdirSync(path.dirname(yol), { recursive: true });
    fs.writeFileSync(yol, icerik, { mode: 0o755 });
  };
  yaz(path.join(kok, 'platform-tools', 'adb'), SAHTE_ADB);
  yaz(path.join(kok, 'emulator', 'emulator'), '#!/bin/bash\nexit 1\n');
  yaz(path.join(kok, 'build-tools', '34.0.0', 'aapt'),
    "#!/bin/bash\necho \"package: name='com.dijitap.deneme' versionCode='1'\"\n"
    + "echo \"launchable-activity: name='com.dijitap.deneme.MainActivity'  label=''\"\n");
  const kanit = path.join(kok, 'kanit');
  fs.mkdirSync(kanit);
  const eski = { ANDROID_HOME: process.env.ANDROID_HOME, FAKE_ADB_DIR: process.env.FAKE_ADB_DIR, FAKE_ADB_KUR: process.env.FAKE_ADB_KUR };
  process.env.ANDROID_HOME = kok;
  process.env.FAKE_ADB_DIR = kok;
  process.env.FAKE_ADB_KUR = senaryo;
  const geriAl = () => {
    for (const [k, v] of Object.entries(eski)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  };
  const cagrilar = () => {
    try { return fs.readFileSync(path.join(kok, 'cagri.log'), 'utf8').trim().split('\n'); } catch (_) { return []; }
  };
  return { kok, kanit, geriAl, cagrilar };
}

const kabul = (s) => A.cihazKabulu({
  apk: path.join(s.kok, 'artifact.apk'), kanit: s.kanit, beklenenKart: 0, setMi: false,
  mevcutSeri: 'emulator-5999', menuBekleSn: 1,
});

test('kurulumSebebi: stdout + stderr birlikte, çıkış kodu başta, son 300 karakter', () => {
  const r = {
    status: 1,
    stdout: 'Performing Streamed Install\n',
    stderr: 'adb: failed to install /a.apk: Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]\n',
  };
  assert.equal(A.kurulumSebebi(r),
    'rc=1 Performing Streamed Install | adb: failed to install /a.apk: Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]');
  const uzun = A.kurulumSebebi({ status: 1, stdout: 'x'.repeat(50), stderr: `${'y'.repeat(400)} SON` });
  assert.equal(uzun.length, 300);
  assert.ok(uzun.endsWith('SON'), 'kırpma sondan: gerçek hata satırı sonda kalır');
  assert.equal(A.kurulumSebebi({ status: null, signal: 'SIGKILL', stdout: '', stderr: '' }), 'rc=null (sinyal SIGKILL)');
  assert.equal(A.kurulumSebebi({ status: 1 }), 'rc=1 çıktı yok');
  assert.equal(A.kurulumSebebi(null), 'rc=? çıktı yok');
});

test('sahte adb: install stderr\'deki gerçek hata sebep satırına düşer, karar ÖLÇÜLEMEDİ', async () => {
  const s = sahteSdk('hata-apk');
  try {
    const r = await kabul(s);
    assert.equal(r.durum, 'OLCULEMEDI');
    assert.equal(r.sebepler.length, 1);
    assert.match(r.sebepler[0], /^adb install düştü: rc=1 Performing Streamed Install \| adb: failed to install/);
    assert.match(r.sebepler[0], /INSTALL_PARSE_FAILED_NO_CERTIFICATES/, 'stderr gizlenmez');
    assert.ok(Number.isInteger(r.kurulumSn));
    assert.ok(!s.cagrilar().some((c) => /\buninstall\b/.test(c)), 'kurulmayan paket kaldırılmaz');
    assert.equal(r.kurulumTanisi.durum, 'device');
    const tani = fs.readFileSync(path.join(s.kanit, 'android', 'kurulum-tani.txt'), 'utf8');
    assert.match(tani, /"durum": "device"/);
    assert.match(tani, /--- logcat \(PackageManager\)/);
  } finally { s.geriAl(); }
});

test('sahte adb: başarılı kurulum sebep üretmez, paket sonda kaldırılır', async () => {
  const s = sahteSdk('basari');
  try {
    const r = await kabul(s);
    assert.ok(!r.sebepler.some((x) => /adb install/.test(x)), JSON.stringify(r.sebepler));
    const kur = s.cagrilar().filter((c) => /\binstall -r -g\b/.test(c));
    assert.equal(kur.length, 1);
    assert.ok(s.cagrilar().some((c) => /uninstall com\.dijitap\.deneme/.test(c)));
  } finally { s.geriAl(); }
});
