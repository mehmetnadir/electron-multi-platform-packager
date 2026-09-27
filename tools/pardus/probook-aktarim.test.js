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
# Kabul temizligi (uzak kopyayi silme) yerel makinede KOSMAZ — yalniz iz dosyasinda kalir.
case "$komut" in "rm "*) exit 0 ;; esac
exec bash -c "$komut"
`, { mode: 0o755 });
  // SAHTE_*_HATA: gercek ssh gibi stderr'e dusus sebebi yazar (tani kaniti testleri).
  // SAHTE_SCP_ATLAMA_YARIM=N: srv21 yolu dusmeden once hedefe N bayt yazar (yarim aktarim).
  // SAHTE_UZAK_KOK: uzak yol (ornegin kabulun /tmp/kabul-*.impark'i) bu dizinin altina yazilir.
  fs.writeFileSync(path.join(bin, 'scp'), `#!/bin/bash
printf 'scp %s\\n' "$*" >> "${iz}"
atlama=0
for a in "$@"; do case "$a" in ProxyCommand=*) atlama=1 ;; esac; done
kaynak="\${@: -2:1}"; hedef="\${@: -1}"; hedef="\${SAHTE_UZAK_KOK:-}\${hedef#*:}"
if [ "$atlama" = 1 ] && [ -n "\${SAHTE_SCP_ATLAMA_RC:-}" ]; then
  [ -n "\${SAHTE_SCP_ATLAMA_YARIM:-}" ] && head -c "$SAHTE_SCP_ATLAMA_YARIM" "$kaynak" > "$hedef"
  [ -n "\${SAHTE_SCP_ATLAMA_HATA:-}" ] && printf '%s\\n' "$SAHTE_SCP_ATLAMA_HATA" >&2
  exit "$SAHTE_SCP_ATLAMA_RC"
fi
if [ "$atlama" = 0 ] && [ -n "\${SAHTE_SCP_DUZ_RC:-}" ]; then
  [ -n "\${SAHTE_SCP_DUZ_HATA:-}" ] && printf '%s\\n' "$SAHTE_SCP_DUZ_HATA" >&2
  exit "$SAHTE_SCP_DUZ_RC"
fi
cp "$kaynak" "$hedef" || exit 1
[ "\${SAHTE_SCP_BOZ:-0}" = 1 ] && printf 'X' >> "$hedef"
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'route'), '#!/bin/bash\necho "   gateway: ${SAHTE_GW:-192.168.2.1}"\n', { mode: 0o755 });
  // SAHTE_SHA_UZAK_ILK_BOS=1: uzak sha256sum ilk cagrida bos doner (dosya "henuz gorunmuyor"
  // gibi — kontrol baglantisi olcemedi), SAHTE_SHA_SAYAC isaretlendikten sonraki cagrilarda
  // gercek sha256'yi doner (retry basariyla sonuclanir senaryosu).
  fs.writeFileSync(path.join(bin, 'sha256sum'), `#!/bin/bash
if [ -n "\${SAHTE_SHA_UZAK_ILK_BOS:-}" ] && [ ! -e "\${SAHTE_SHA_SAYAC:-/dev/null/yok}" ]; then
  mkdir -p "$(dirname "\${SAHTE_SHA_SAYAC:-/tmp/yok}")" 2>/dev/null
  : > "\${SAHTE_SHA_SAYAC:-/tmp/yok}" 2>/dev/null
  exit 1
fi
exec shasum -a 256 "$@"
`, { mode: 0o755 });
  const yerel = path.join(kok, 'paket.impark');
  fs.writeFileSync(yerel, Buffer.from('impark-deneme-' + '0123456789'.repeat(1000)));
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    PROBOOK_HOST: 'etapadmin@100.73.161.76',
    PROBOOK_KEY: path.join(kok, 'yok-anahtar'),
    SAHTE_MID_ATLAMA: 'abc123', SAHTE_MID_KONTROL: 'abc123',
    // sha_u bosken retry oncesi gercek bekleme (varsayilan 5 sn) testleri yavaslatmasin.
    PROBOOK_AKTARIM_SHA_BEKLE: '0',
    SAHTE_SHA_SAYAC: path.join(kok, 'sha-sayac'),
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

// DUZELTME (2026-09-27, 45479 pardus): rc=0 (scp/aktarim TAMAMLANDI) ama ProBook sha256'si
// KONTROL baglantisindan (bir daha denense de) hic ALINAMAZSA bu bir OLCUM basarisizligidir
// (aktarim düşmedi — kontrol ssh'i o an ulasamadi), bayt bozulmasinin KANITI DEGIL. Eskiden
// bu senaryo "sha256 UYUSMADI" (donus 2, GERCEK RED) sayilip failed yazdiriyordu.
test('GUVENLIK->DUZELTME: scp rc=0 + ProBook sha256 (iki denemede de) alinamazsa donus 1 DOGRULANAMADI, UYUSMADI degil', () => {
  const o = ortam({ PROBOOK_AKTARIM: 'scp' });
  // scp "basarili" ama hedefe hic yazmiyor (yanlis makine/yol) — sahte scp'yi ez.
  fs.writeFileSync(path.join(o.kok, 'bin', 'scp'), `#!/bin/bash\nprintf 'scp %s\\n' "$*" >> "${o.iz}"\nexit 0\n`, { mode: 0o755 });
  const r = kos(o);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /sha256 alinamadi/);
  assert.doesNotMatch(r.stdout, /sha256 UYUSMADI/);
  assert.match(r.kanit, /^SHA256_PROBOOK=yok$/m);
  assert.match(r.kanit, /^AKTARIM_SONUC=DOGRULANAMADI$/m);
  assert.match(r.kanit, /^PROBOOK_BAYT=/m);
});

test('DUZELTME: ilk denemede sha_u bos, retry\'de dolu ve eslesiyor → donus 0 (ESLESTI)', () => {
  const o = ortam({ PROBOOK_AKTARIM: 'srv21', SAHTE_SHA_UZAK_ILK_BOS: '1' });
  const r = kos(o);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /sha256 eslesti/);
  assert.match(r.kanit, /^AKTARIM_SONUC=ESLESTI$/m);
});

test('GERILEME (degismedi): sha_u dolu ve GERCEK farkli (bayt bozuldu) → donus 2 kalir, DOGRULANAMADI degil', () => {
  const o = ortam({ PROBOOK_AKTARIM: 'srv21', SAHTE_SCP_BOZ: '1' });
  const r = kos(o);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.kanit, /^AKTARIM_SONUC=UYUSMADI$/m);
  assert.doesNotMatch(r.kanit, /AKTARIM_SONUC=DOGRULANAMADI/);
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
  const blok = s.slice(s.indexOf('probook_aktar "$GIRDI"'), s.indexOf('probook_aktar "$GIRDI"') + 700);
  assert.match(blok, /\[ "\$AKT_RC" = 2 \] && \{ say "RED: [^"]*sha256[^"]*"; exit 1; \}/);
  // Karar sozlugu ayni (exit 1); yalniz metin runner'in ertelenebilir sinifina girer.
  assert.match(blok, /\[ "\$AKT_RC" = 0 \] \|\| \{ say "RED: ProBook'a aktarim dustu[^"]*"; exit 1; \}/);
});

// ---------------------------------------------------------------------------
// AKTARIM DUSUSU (2026-09-27, 45477 pardus): srv21 atlamasi 6 dk sonra dustu, scp yedegi
// 600/1277 MB'ta kaldi (Mac kapak kapali pilde uyudu) → "RED: kopyalanamadi" → failed.
// (1) Tani: ssh'in dusus sebebi kanitta ve stdout'ta (eskiden scp -q ile hic yoktu).
// (2) Sinif: iki yol da duserse kabul "ProBook'a aktarim dustu" der, runner ERTELER.
// ---------------------------------------------------------------------------
const { probookErisilemezHatasi } = require('../../src/agent/runner-helpers');

test('tani: scp -q YOK — ssh dusus sebebini (LogLevel QUIET) susturmaz', () => {
  const o = ortam({ PROBOOK_AKTARIM: 'srv21', SAHTE_SCP_ATLAMA_RC: '1' });
  const scp = scpSatirlari(kos(o).iz);
  assert.equal(scp.length, 2, scp.join('\n'));
  for (const s of scp) assert.doesNotMatch(s, /(^| )-q( |$)/, s);
});

test('tani: iki yol da duserse ssh stderr son satirlari aktarim.txt\'ye ve stdout\'a, srv21 yarim bayt + UTC saat', () => {
  const o = ortam({
    PROBOOK_AKTARIM: 'srv21', SAHTE_SCP_ATLAMA_RC: '1', SAHTE_SCP_DUZ_RC: '1', SAHTE_SCP_ATLAMA_YARIM: '4096',
    SAHTE_SCP_ATLAMA_HATA: 'Timeout, server 192.168.1.55 not responding.',
    SAHTE_SCP_DUZ_HATA: 'ssh: connect to host 100.73.161.76 port 22: No route to host',
  });
  const r = kos(o);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.kanit, /^AKTARIM_SRV21_RC=1$/m);
  assert.match(r.kanit, /^AKTARIM_SRV21_SN=\d+$/m);
  assert.match(r.kanit, /^AKTARIM_SRV21_DUSUS_UTC=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/m);
  assert.match(r.kanit, /^AKTARIM_SRV21_PROBOOK_BAYT=4096$/m);
  assert.match(r.kanit, /^AKTARIM_SRV21_HATA=Timeout, server 192\.168\.1\.55 not responding\.$/m);
  assert.match(r.kanit, /^AKTARIM_HATA=ssh: connect to host 100\.73\.161\.76 port 22: No route to host$/m);
  assert.match(r.kanit, /^AKTARIM_RC=1$/m);
  assert.match(r.stdout, /srv21 yolu dustu \(rc=1, \d+ sn, ProBook'ta 4096 B, [^)]*Z\) — scp yedek yoluna geciliyor; ssh: Timeout/);
  assert.match(r.stdout, /kopyalanamadi \(yol=scp rc=1, \d+ sn, [^)]*Z\); ssh: ssh: connect to host/);
  assert.ok(fs.existsSync(path.join(o.kanit, 'aktarim-srv21.err')));
  assert.ok(fs.existsSync(path.join(o.kanit, 'aktarim-scp.err')));
});

test('tani: basarili aktarimda srv21 satirlari yazilmaz, AKTARIM_HATA bos', () => {
  const o = ortam({ PROBOOK_AKTARIM: 'srv21' });
  const r = kos(o);
  assert.equal(r.status, 0, r.stdout);
  assert.doesNotMatch(r.kanit, /AKTARIM_SRV21_/);
  assert.match(r.kanit, /^AKTARIM_HATA=$/m);
  assert.match(r.kanit, /^AKTARIM_RC=0$/m);
});

/** probook-kabul.sh'i uzak kipte, sahte ssh/scp ile, sandbox HOME + kilitle kosturur. */
function kabulKos(ek) {
  const o = ortam({ PROBOOK_AKTARIM: 'srv21', ...ek });
  const home = path.join(o.kok, 'home');
  const uzakKok = path.join(o.kok, 'probook');
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(uzakKok, 'tmp'), { recursive: true });
  const env = {
    ...o.env, HOME: home, KABUL_KILIT: path.join(o.kok, 'kabul.lock'), SAHTE_UZAK_KOK: uzakKok,
    KABUL_BOSLUK_TAVAN: '5', KABUL_BOSLUK_ARALIK: '1',
  };
  for (const k of ['KABUL_CDP', 'KABUL_AYRI_EV', 'KABUL_EV', 'KABUL_SET_TUM', 'KABUL_K4', 'EMPP_KANIT_ARSIV']) delete env[k];
  const r = spawnSync('bash', [KABUL, o.yerel, o.kanit], { encoding: 'utf8', env, timeout: 60000 });
  const iz = fs.existsSync(o.iz) ? fs.readFileSync(o.iz, 'utf8') : '';
  return { ...r, iz, o };
}

test('kabul uctan uca: srv21 + scp yedegi ikisi de duserse RED "ProBook\'a aktarim dustu", exit 1, runner ERTELER', () => {
  const r = kabulKos({
    SAHTE_SCP_ATLAMA_RC: '1', SAHTE_SCP_DUZ_RC: '1',
    SAHTE_SCP_ATLAMA_HATA: 'Timeout, server 192.168.1.55 not responding.',
    SAHTE_SCP_DUZ_HATA: 'ssh: connect to host 100.73.161.76 port 22: No route to host',
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /\[kabul\] RED: ProBook'a aktarim dustu — kopyalanamadi \(altyapi, paket kusuru degil\)/);
  assert.match(r.stdout, /srv21 yolu dustu .*ssh: Timeout, server 192\.168\.1\.55 not responding/);
  assert.equal(probookErisilemezHatasi(r.stdout), true, 'aktarim dususu altyapidir — runner failed YAZMAMALI');
  assert.match(r.iz, /rm -f '\/tmp\/kabul-\d+\.impark'/, 'temizlik uzak kopyayi silmeye calismali');
  assert.equal(fs.existsSync(path.join(r.o.kok, 'kabul.lock')), false, 'kilit birakilmali');
});

// DUZELTME (2026-09-27, 45479 pardus): scp "basarili" (rc=0) ama ProBook tarafinda sha256
// KONTROL baglantisindan (iki denemede de) ALINAMIYORSA artik "aktarim dogrulanamadi" (donus 2,
// GERCEK RED) DEGIL — donus 1 (DOGRULANAMADI), caginan probook-kabul.sh bunu genel "AKT_RC != 0"
// dalina dusurup "RED: ProBook'a aktarim dustu — kopyalanamadi (altyapi, paket kusuru degil)"
// yazar; runner probookErisilemezHatasi bunu ERTELENEBILIR sayar (failed YAZILMAZ). Eskiden
// (bu testin adi "runner ERTELEMEZ"di) bu tam da 45479'un kendisiydi: olcum basarisizligi
// paket kusuru gibi failed yazdiriyordu.
test('kabul uctan uca DUZELTME: sha256 (kontrol baglantisi) OLCULEMEZSE runner ERTELER, RED-paket-kusuru degil', () => {
  const r = kabulKos({});
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /sha256 alinamadi/);
  assert.match(r.stdout, /RED: ProBook'a aktarim dustu — kopyalanamadi \(altyapi, paket kusuru degil\)/);
  assert.doesNotMatch(r.stdout, /RED: aktarim dogrulanamadi/);
  assert.equal(probookErisilemezHatasi(r.stdout), true, 'olcum basarisizligi altyapidir — runner failed YAZMAMALI');
});

// NOT: kabulKos() harness'i SAHTE_UZAK_KOK ile scp hedefini yeniden yazar (dosya bu dizinin
// ALTINA iner) ama ssh uzerinden calisan aktarim_sha_uzak HALA remap-edilmemis $uzak yolunu
// sorar — bu yuzden bu harness'te ProBook sha256'si HER ZAMAN bos doner (gercek FARKLI-ama-dolu
// bir sha_u burada uretilemez). GERCEK uyusmazlik regresyonu direkt probook_aktar seviyesinde
// yukarida kilitli ("GUVENLIK: aktarimda bayt bozulursa" + "GERILEME (degismedi)" testleri).
