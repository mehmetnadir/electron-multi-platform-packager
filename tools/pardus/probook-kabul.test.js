const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BETIK = path.join(__dirname, 'probook-kabul.sh');
const kaynak = () => fs.readFileSync(BETIK, 'utf8');

/**
 * NEDEN BU TEST VAR (ölçüldü 2026-09-21):
 * Kabul kapısının varsayılan adresi `etapadmin@192.168.1.55` (ofis LAN) idi.
 * Nadir ofis dışındayken ya da paketleyici başka ağdayken kapı
 * "ProBook'a baglanilamadi" verip işi bekletiyordu — 6 pardus paketi
 * (45481/45482/45487/45541/45549/73581) bu yüzden kuyrukta kaldı, oysa
 * paketlerin hepsi bit düzeyinde TAM çıktı. Aynı makine Tailscale'de
 * 100.73.161.76 adresinde ve her iki ağdan da erişilebilir.
 */
test('kabul kapisinin VARSAYILAN adresi LAN-only olamaz', () => {
  const satir = kaynak().split('\n').find((s) => s.trimStart().startsWith('HOST='));
  assert.ok(satir, 'HOST= varsayilan satiri bulunamadi');
  assert.doesNotMatch(
    satir,
    /(?:^|[^0-9.])(?:192\.168|10\.|172\.(?:1[6-9]|2\d|3[01]))\./,
    `Varsayilan LAN adresi olmamali (yalniz ofisten calisir): ${satir}`
  );
});

test('varsayilan adres Tailscale CGNAT araliginda (100.64.0.0/10)', () => {
  const satir = kaynak().split('\n').find((s) => s.trimStart().startsWith('HOST='));
  const ip = (satir.match(/@(\d+\.\d+\.\d+\.\d+)/) || [])[1];
  assert.ok(ip, `HOST satirinda IP yok: ${satir}`);
  const [a, b] = ip.split('.').map(Number);
  assert.equal(a, 100, `Tailscale araligi degil: ${ip}`);
  assert.ok(b >= 64 && b <= 127, `Tailscale araligi degil: ${ip}`);
});

test('PROBOOK_HOST ile elle gecersiz kilinabilir (LAN-a donus yolu acik)', () => {
  assert.match(kaynak(), /HOST="\$\{PROBOOK_HOST:-/);
});

test('bash sozdizimi gecerli', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync('bash', ['-n', BETIK], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
