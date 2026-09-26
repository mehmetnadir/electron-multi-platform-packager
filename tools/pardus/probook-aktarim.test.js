'use strict';
/**
 * ProBook AKTARIM YOLU (probook-aktarim.sh) — ağsız testler.
 *
 * NEDEN (ölçüm 2026-09-26 21:57): evden Tailscale Mac↔ProBook DERP rölesinden ~238 kB/s
 * (1,2 GB ≈ 87 dk); srv21 atlaması (OpenVPN → IPsec LAN) 1392 kB/s (≈ 15 dk).
 * Yol değişse de kabul kapısının anlamı değişmemeli: ProBook'un test ettiği bayt =
 * Mac'teki bayt (sha256 iki uçta). Bu testler o sözleşmeyi çiviler.
 *
 * Sahte ssh/scp/route PATH başında; "uzak" makine yerel bir dizin. ssh uzak komutu
 * yerelde bash -c ile koşar (sha256sum sahtesi shasum'a düşer); machine-id sorusu
 * hedefe göre (atlama = ProxyCommand'lı çağrı, kontrol = düz çağrı) cevaplanır.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BETIK = path.join(__dirname, 'probook-aktarim.sh');
const KABUL = path.join(__dirname, 'probook-kabul.sh');

function ortam(ek = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'aktarim-'));
  const bin = path.join(kok, 'bin');
  const uzak = path.join(kok, 'uzak');
  const iz = path.join(kok, 'cagri.iz');
  fs.mkdirSync(bin);
  fs.mkdirSync(uzak);
  fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/bash
printf 'ssh %s\\n' "$*" >> "${iz}"
hedef=kontrol
for a in "$@"; do case "$a" in ProxyCommand=*) hedef=atlama ;; esac; done
komut="\${@: -1}"
if [[ "$komut" == *machine-id* ]]; then
  if [ "$hedef" = atlama ]; then m="\${SAHTE_MID_ATLAMA:-}"; else m="\${SAHTE_MID_KONTROL:-}"; fi
  [ "$m" = YOK ] && exit 255
  echo "$m"; exit 0
fi
exec bash -c "$komut"
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'scp'), `#!/bin/bash
printf 'scp %s\\n' "$*" >> "${iz}"
atlama=0
for a in "$@"; do case "$a" in ProxyCommand=*) atlama=1 ;; esac; done
[ "$atlama" = 1 ] && [ -n "\${SAHTE_SCP_ATLAMA_RC:-}" ] && exit "$SAHTE_SCP_ATLAMA_RC"
[ "$atlama" = 0 ] && [ -n "\${SAHTE_SCP_DUZ_RC:-}" ] && exit "$SAHTE_SCP_DUZ_RC"
kaynak="\${@: -2:1}"; hedef="\${@: -1}"; hedef="\${hedef#*:}"
cp "$kaynak" "$hedef" || exit 1
[ "\${SAHTE_SCP_BOZ:-0}" = 1 ] && printf 'X' >> "$hedef"
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'route'), '#!/bin/bash\necho "   gateway: ${SAHTE_GW:-192.168.2.1}"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sha256sum'), '#!/bin/bash\nexec shasum -a 256 "$@"\n', { mode: 0o755 });
  const yerel = path.join(kok, 'paket.impark');
  fs.writeFileSync(yerel, Buffer.from('impark-deneme-' + '0123456789'.repeat(1000)));
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    PROBOOK_HOST: 'etapadmin@100.73.161.76',
    PROBOOK_KEY: path.join(kok, 'yok-anahtar'),
    SAHTE_MID_ATLAMA: 'abc123', SAHTE_MID_KONTROL: 'abc123',
    ...ek,
  };
  return { kok, uzak, iz, yerel, env, hedef: path.join(uzak, 'kabul-1.impark'), kanit: path.join(kok, 'kanit') };
}

function kos(o, ekEnv = {}) {
  const r = spawnSync('bash', [BETIK, o.yerel, o.hedef, o.kanit], {
    encoding: 'utf8', env: { ...o.env, ...ekEnv }, timeout: 30000,
  });
  const iz = fs.existsSync(o.iz) ? fs.readFileSync(o.iz, 'utf8') : '';
  const kanit = fs.existsSync(path.join(o.kanit, 'aktarim.txt'))
    ? fs.readFileSync(path.join(o.kanit, 'aktarim.txt'), 'utf8') : '';
  return { ...r, iz, kanit };
}
const scpSatirlari = (iz) => iz.split('\n').filter((s) => s.startsWith('scp '));

test('bash sozdizimi gecerli (aktarim + kabul)', () => {
  for (const b of [BETIK, KABUL]) {
    const r = spawnSync('bash', ['-n', b], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${b}: ${r.stderr}`);
  }
});

test('srv21: atlama hazir → ProxyCommand ssh -W ile LAN hedefine gider, sha256 eslesir, kanit yazilir', () => {
  const o = ortam({ PROBOOK_AKTARIM: 'srv21' });
  const r = kos(o);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const scp = scpSatirlari(r.iz);
  assert.equal(scp.length, 1, r.iz);
  assert.match(scp[0], /ProxyCommand=ssh .*-p 2222 .*-W %h:%p root@10\.0\.0\.21/);
  assert.match(scp[0], /etapadmin@192\.168\.1\.55:/);
  assert.match(r.stdout, /aktarim yolu: srv21/);
  assert.match(r.stdout, /sha256 eslesti/);
  assert.deepEqual(fs.readFileSync(o.hedef), fs.readFileSync(o.yerel));
  assert.match(r.kanit, /^AKTARIM_YOL=srv21$/m);
  assert.match(r.kanit, /^AKTARIM_SONUC=ESLESTI$/m);
  const shaMac = (r.kanit.match(/^SHA256_MAC=([0-9a-f]{64})$/m) || [])[1];
  const shaPb = (r.kanit.match(/^SHA256_PROBOOK=([0-9a-f]{64})$/m) || [])[1];
  assert.ok(shaMac && shaMac === shaPb, r.kanit);
});

test('GUVENLIK: aktarimda bayt bozulursa sha256 UYUSMADI → donus 2 (kabul RED), ESLESTI yazilmaz', () => {
  const o = ortam({ PROBOOK_AKTARIM: 'srv21', SAHTE_SCP_BOZ: '1' });
  const r = kos(o);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /sha256 UYUSMADI/);
  assert.doesNotMatch(r.stdout, /sha256 eslesti/);
  assert.match(r.kanit, /^AKTARIM_SONUC=UYUSMADI$/m);
});

test('GUVENLIK: scp yolunda da bozulma yakalanir (yol ne olursa olsun sha256 iki uc)', () => {
  const o = ortam({ PROBOOK_AKTARIM: 'scp', SAHTE_SCP_BOZ: '1' });
  const r = kos(o);
  assert.equal(r.status, 2, r.stdout);
  assert.doesNotMatch(scpSatirlari(r.iz)[0], /ProxyCommand/);
});

test('GUVENLIK: ProBook tarafi sha256 alinamazsa (dosya yok) ESLESTI sayilmaz', () => {
  const o = ortam({ PROBOOK_AKTARIM: 'scp' });
  // scp "basarili" ama hedefe hic yazmiyor (yanlis makine/yol) — sahte scp'yi ez.
  fs.writeFileSync(path.join(o.kok, 'bin', 'scp'), `#!/bin/bash\nprintf 'scp %s\\n' "$*" >> "${o.iz}"\nexit 0\n`, { mode: 0o755 });
  const r = kos(o);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.kanit, /^SHA256_PROBOOK=yok$/m);
});

test('srv21: atlama hedefi baska makine (machine-id farkli) → srv21 KULLANILMAZ, dogrudan scp', () => {
  const o = ortam({ PROBOOK_AKTARIM: 'srv21', SAHTE_MID_ATLAMA: 'fff999' });
  const r = kos(o);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /ayni makine degil — scp/);
  const scp = scpSatirlari(r.iz);
  assert.equal(scp.length, 1);
  assert.doesNotMatch(scp[0], /ProxyCommand/);
  assert.match(scp[0], /etapadmin@100\.73\.161\.76:/);
});

test('srv21: atlama erisilemez (OpenVPN kapali) → scp yedek yolu', () => {
  const o = ortam({ PROBOOK_AKTARIM: 'srv21', SAHTE_MID_ATLAMA: 'YOK' });
  const r = kos(o);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /srv21 atlamasi ulasilamadi/);
  assert.doesNotMatch(scpSatirlari(r.iz)[0], /ProxyCommand/);
});

test('srv21: aktarim yarida duserse scp yedek yoluna gecer ve yine sha256 dogrular', () => {
  const o = ortam({ PROBOOK_AKTARIM: 'srv21', SAHTE_SCP_ATLAMA_RC: '1' });
  const r = kos(o);
  assert.equal(r.status, 0, r.stdout);
  const scp = scpSatirlari(r.iz);
  assert.equal(scp.length, 2, r.iz);
  assert.match(scp[0], /ProxyCommand/);
  assert.doesNotMatch(scp[1], /ProxyCommand/);
  assert.match(r.stdout, /srv21 yolu dustu/);
  assert.match(r.kanit, /^AKTARIM_YOL=scp$/m);
  assert.match(r.kanit, /^AKTARIM_SONUC=ESLESTI$/m);
});

test('iki yol da duserse donus 1 (kopyalanamadi), sha256 ESLESTI yazilmaz', () => {
  const o = ortam({ PROBOOK_AKTARIM: 'srv21', SAHTE_SCP_ATLAMA_RC: '1', SAHTE_SCP_DUZ_RC: '1' });
  const r = kos(o);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.kanit, /^AKTARIM_SONUC=KOPYALANAMADI$/m);
});

test('oto: ofis ag gecidinde atlama hic denenmez, dogrudan scp (ofiste LAN en hizli)', () => {
  const o = ortam({ PROBOOK_AKTARIM: 'oto', SAHTE_GW: '192.168.1.254' });
  const r = kos(o);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /oto: ofis agi/);
  assert.doesNotMatch(r.iz, /ProxyCommand/);
});

test('oto: ev ag gecidinde atlama hazirsa srv21', () => {
  const o = ortam({ PROBOOK_AKTARIM: 'oto', SAHTE_GW: '192.168.2.1' });
  const r = kos(o);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /aktarim yolu: srv21 \(oto: gw 192\.168\.2\.1/);
  assert.match(scpSatirlari(r.iz)[0], /ProxyCommand/);
});

test('hiz siniri verilirse scp -l ile gecer; verilmezse -l yok', () => {
  const o = ortam({ PROBOOK_AKTARIM: 'srv21', PROBOOK_AKTARIM_HIZ_KBIT: '8000' });
  assert.match(scpSatirlari(kos(o).iz)[0], / -l 8000 /);
  const o2 = ortam({ PROBOOK_AKTARIM: 'srv21' });
  assert.doesNotMatch(scpSatirlari(kos(o2).iz)[0], / -l /);
});

// ---------------------------------------------------------------------------
// probook-kabul.sh bağlantısı: bayrak BOŞKEN kopya adımı birebir eskisi.
// ---------------------------------------------------------------------------
test('kabul: PROBOOK_AKTARIM bosken eski tek scp satiri AYNEN durur (varsayilan kapali)', () => {
  const s = fs.readFileSync(KABUL, 'utf8');
  assert.match(s, /if \[ -n "\$\{PROBOOK_AKTARIM:-\}" \]; then\n/);
  assert.ok(
    s.includes('scp -q -o ConnectTimeout=10 -o BatchMode=yes -i "$KEY" "$GIRDI" "$HOST:$UZAK" \\\n'
      + '      || { say "RED: kopyalanamadi"; exit 1; }'),
    'eski scp satiri degismis',
  );
});

test('kabul: aktarim donus 2 (sha256) ve 1 RED ile cikar (exit 1 → temizlik trap uzak kopyayi siler)', () => {
  const s = fs.readFileSync(KABUL, 'utf8');
  const blok = s.slice(s.indexOf('probook_aktar "$GIRDI"'), s.indexOf('probook_aktar "$GIRDI"') + 300);
  assert.match(blok, /\[ "\$AKT_RC" = 2 \] && \{ say "RED: [^"]*sha256[^"]*"; exit 1; \}/);
  assert.match(blok, /\[ "\$AKT_RC" = 0 \] \|\| \{ say "RED: kopyalanamadi"; exit 1; \}/);
});
